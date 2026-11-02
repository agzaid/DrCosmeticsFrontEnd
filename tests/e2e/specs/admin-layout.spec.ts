/**
 * (g)+(h) Layout, keyboard, accessibility, localisation, empty and failure states of the admin console.
 * Every flow ends with assertClean().
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { Order } from '../../../src/types';
import { ApiClient, adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, type E2ePage, type Lang } from '../harness/browser.ts';
import {
  LANGS,
  adminPage,
  clickText,
  createTestProduct,
  fill,
  openTab,
  pick,
  placeCustomerOrder,
  setValue,
  token,
  waitForText,
  waitForToast,
} from './admin-helpers.ts';

const TABS = ['overview', 'products', 'orders', 'inventory', 'discounts', 'banners'] as const;
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
];

async function overflow(e2e: E2ePage): Promise<{ scrollWidth: number; clientWidth: number; bodyScrollWidth: number }> {
  return e2e.page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
}

async function assertNoOverflow(e2e: E2ePage, label: string): Promise<void> {
  const sizes = await overflow(e2e);
  assert.ok(sizes.scrollWidth <= sizes.clientWidth, `${label}: horizontal overflow ${sizes.scrollWidth} > ${sizes.clientWidth}`);
  assert.ok(sizes.bodyScrollWidth <= sizes.clientWidth, `${label}: body overflow ${sizes.bodyScrollWidth} > ${sizes.clientWidth}`);
}

/** Controls inside <main> that lack an accessible name. */
async function unnamedControls(e2e: E2ePage): Promise<string[]> {
  return e2e.page.evaluate(() => {
    const problems: string[] = [];
    for (const element of Array.from(document.querySelectorAll('main button, main input, main select, main textarea'))) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') {
        continue;
      }
      if (element instanceof HTMLInputElement && element.type === 'hidden') {
        continue;
      }
      const labelled = element as HTMLInputElement;
      const name =
        (element.getAttribute('aria-label') ?? '').trim() ||
        Array.from(labelled.labels ?? [])
          .map((label) => label.textContent ?? '')
          .join('')
          .trim() ||
        (element instanceof HTMLButtonElement ? (element.textContent ?? '').trim() : '') ||
        (element.getAttribute('title') ?? '').trim();
      if (!name) {
        problems.push(element.outerHTML.slice(0, 140));
      }
    }
    return problems;
  });
}

/** Static UI copy (headings, headers, buttons, field labels) that still contains English words in the Arabic UI. */
async function untranslatedChrome(e2e: E2ePage): Promise<string[]> {
  return e2e.page.evaluate(() => {
    const allowed = new Set(['SKU', 'English', 'EGP', 'EN', 'AR']);
    const found: string[] = [];
    const selector = 'main h1, main h3, main h4, main th, main legend, main button, main label > span:first-child, main nav button';
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const words = (text.match(/[A-Za-z]{3,}/g) ?? []).filter((word) => !allowed.has(word));
      if (words.length > 0 && !element.closest('[data-order],[data-product-id],[data-coupon],[data-banner] [dir="ltr"]')) {
        found.push(`${element.tagName.toLowerCase()}: ${text}`);
      }
    }
    return found;
  });
}

async function openProductForm(e2e: E2ePage, lang: Lang): Promise<void> {
  await openTab(e2e, 'products');
  await clickText(e2e.page, '[data-panel="products"] button', pick(lang, 'Add New Product', 'إضافة منتج جديد'));
  await e2e.page.waitForSelector('[role="dialog"] form[data-form="product"]');
}

async function openDiscountForm(e2e: E2ePage, lang: Lang): Promise<void> {
  await openTab(e2e, 'discounts');
  await clickText(e2e.page, '[data-panel="discounts"] button', pick(lang, 'Create coupon', 'إنشاء كوبون'));
  await e2e.page.waitForSelector('[role="dialog"] form[data-form="discount"]');
}

async function focusInsideDialog(e2e: E2ePage): Promise<boolean> {
  return e2e.page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false);
}

describe('admin layout, keyboard and accessibility', () => {
  let browser: Browser;
  let admin: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    // Make sure the tables have rows to lay out.
    const fixture = await createTestProduct(admin, { stock: 4, price: 100 });
    await placeCustomerOrder(fixture.variant.id, 1);
  });

  after(async () => {
    await closeBrowser();
  });

  for (const lang of LANGS) {
    for (const viewport of VIEWPORTS) {
      it(`[${lang}] ${viewport.width}x${viewport.height}: dir, no horizontal overflow on every tab and form, named controls`, async () => {
        const { e2e } = await adminPage(browser, lang, viewport);
        try {
          assert.equal(await e2e.page.$eval('html', (html) => html.dir), lang === 'ar' ? 'rtl' : 'ltr');
          assert.equal(await e2e.page.$eval('[data-tab="overview"]', (element) => getComputedStyle(element).direction), lang === 'ar' ? 'rtl' : 'ltr');

          for (const tab of TABS) {
            await openTab(e2e, tab);
            await e2e.page.waitForFunction(
              (name: string) => {
                const panel = document.querySelector(`[data-panel="${name}"]`);
                return panel !== null && panel.querySelector('svg.animate-spin') === null;
              },
              { timeout: 15_000 },
              tab,
            );
            await assertNoOverflow(e2e, `${tab} (${lang}, ${viewport.width})`);
            assert.deepEqual(await unnamedControls(e2e), [], `${tab}: controls without an accessible name`);
            if (lang === 'ar') {
              assert.deepEqual(await untranslatedChrome(e2e), [], `${tab}: English UI copy in the Arabic admin`);
              // RTL mirrors the table: the first column sits at the right edge.
              if (tab === 'orders' || tab === 'products') {
                const xs = await e2e.page.$$eval(`[data-panel="${tab}"] thead th`, (cells) => cells.map((cell) => cell.getBoundingClientRect().left));
                assert.ok(xs.length >= 5);
                assert.ok(xs[0] > xs[xs.length - 1], `${tab} table is mirrored in RTL`);
              }
            }
            await e2e.screenshot(`admin-layout-${lang}-${viewport.width}-${tab}`);
          }

          for (const open of [openProductForm, openDiscountForm]) {
            await open(e2e, lang);
            await assertNoOverflow(e2e, `${open.name} (${lang}, ${viewport.width})`);
            const box = await e2e.page.$eval('[role="dialog"]', (dialog) => {
              const rect = dialog.getBoundingClientRect();
              return { left: rect.left, right: rect.right, width: window.innerWidth };
            });
            assert.ok(box.left >= 0 && box.right <= box.width, `dialog fits the viewport (${JSON.stringify(box)})`);
            assert.deepEqual(await unnamedControls(e2e), [], `${open.name}: controls without an accessible name`);
            if (lang === 'ar') {
              assert.deepEqual(await untranslatedChrome(e2e), [], `${open.name}: English UI copy in the Arabic form`);
            }
            await e2e.screenshot(`admin-layout-${lang}-${viewport.width}-${open.name}`);
            await e2e.page.keyboard.press('Escape');
            await e2e.page.waitForSelector('[role="dialog"]', { hidden: true });
          }
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });
    }

    it(`[${lang}] keyboard: Enter opens a form, focus lands inside and is trapped, Esc closes and restores focus, Enter submits`, async () => {
      const { e2e } = await adminPage(browser, lang);
      try {
        await openTab(e2e, 'products');
        const addLabel = pick(lang, 'Add New Product', 'إضافة منتج جديد');
        await e2e.page.waitForSelector('[data-panel="products"] button');
        await e2e.page.evaluate((label: string) => {
          const button = Array.from(document.querySelectorAll<HTMLElement>('[data-panel="products"] button')).find((candidate) => (candidate.textContent ?? '').trim() === label);
          button?.focus();
        }, addLabel);
        await e2e.page.keyboard.press('Enter');
        await e2e.page.waitForSelector('[role="dialog"] form[data-form="product"]');
        assert.equal(await e2e.page.$eval('[role="dialog"]', (dialog) => dialog.getAttribute('aria-modal')), 'true');
        assert.ok(await e2e.page.$eval('[role="dialog"]', (dialog) => Boolean(dialog.getAttribute('aria-labelledby'))), 'dialog is labelled');
        assert.ok(await focusInsideDialog(e2e), 'focus moves into the dialog on open');

        for (let step = 0; step < 90; step += 1) {
          await e2e.page.keyboard.press('Tab');
          assert.ok(await focusInsideDialog(e2e), `Tab #${step + 1} escaped the dialog`);
        }
        for (let step = 0; step < 6; step += 1) {
          await e2e.page.keyboard.down('Shift');
          await e2e.page.keyboard.press('Tab');
          await e2e.page.keyboard.up('Shift');
          assert.ok(await focusInsideDialog(e2e), `Shift+Tab #${step + 1} escaped the dialog`);
        }

        await e2e.page.keyboard.press('Escape');
        await e2e.page.waitForSelector('[role="dialog"]', { hidden: true });
        assert.equal(
          await e2e.page.evaluate(() => (document.activeElement?.textContent ?? '').trim()),
          addLabel,
          'focus returns to the control that opened the dialog',
        );

        // Keyboard-only coupon creation: the first field is focused; type the code and press Enter to submit.
        const code = `KBD${token('K')}`;
        await openTab(e2e, 'discounts');
        await e2e.page.evaluate((label: string) => {
          Array.from(document.querySelectorAll<HTMLElement>('[data-panel="discounts"] button'))
            .find((candidate) => (candidate.textContent ?? '').trim() === label)
            ?.focus();
        }, pick(lang, 'Create coupon', 'إنشاء كوبون'));
        await e2e.page.keyboard.press('Enter');
        await e2e.page.waitForSelector('[role="dialog"] form[data-form="discount"]');
        assert.ok(await focusInsideDialog(e2e));
        await e2e.page.keyboard.type(code.toLowerCase());
        await e2e.page.keyboard.press('Enter');
        await e2e.page.waitForSelector('[role="dialog"]', { hidden: true, timeout: 15_000 });
        const created = (await admin.get<{ discounts: { code: string; active: boolean }[] }>('/api/v1/admin/discounts')).data.discounts.find((discount) => discount.code === code);
        assert.ok(created?.active, 'the coupon typed and submitted from the keyboard exists, upper-cased');
        await waitForToast(e2e.page, pick(lang, 'Discount code created.', 'تم إنشاء كود الخصم.'));
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }

  describe('empty and failure states', () => {
    for (const lang of LANGS) {
      it(`[${lang}] empty states render for no low stock, no coupons, no banners, no matching products`, async () => {
        const { e2e } = await adminPage(browser, lang);
        try {
          const metricsRule = e2e.fulfillRequests(/\/api\/v1\/admin\/metrics$/, 200, {
            body: {
              metrics: {
                totalSales: 0,
                totalOrders: 0,
                averageOrderValue: 0,
                ordersByStatus: { Pending: 0, Confirmed: 0, Shipped: 0, Delivered: 0, Cancelled: 0 },
                lowStockCount: 0,
                collectedRevenue: 0,
                totalProducts: 0,
                lowStockItems: [],
              },
            },
          });
          await e2e.page.click('[data-panel="overview"] button');
          const empty = await waitForText(e2e.page, '[data-empty="low-stock"]', (text) => text.length > 0);
          assert.equal(empty, pick(lang, 'No low-stock variants.', 'لا توجد خيارات منخفضة المخزون.'));
          assert.equal(await e2e.page.$eval('[data-metric="totalSales"] [data-field="value"]', (node) => node.textContent), pick(lang, '0 EGP', '٠ ج.م'));
          metricsRule.remove();

          e2e.fulfillRequests(/\/api\/v1\/admin\/discounts$/, 200, { method: 'GET', body: { discounts: [] } });
          await openTab(e2e, 'orders');
          await openTab(e2e, 'discounts');
          const coupons = await e2e.page.waitForFunction(
            (text: string) => document.querySelector('[data-panel="discounts"]')?.textContent?.includes(text) ?? false,
            { timeout: 10_000 },
            pick(lang, 'No coupons yet.', 'لا توجد كوبونات بعد.'),
          );
          assert.ok(coupons);

          e2e.fulfillRequests(/\/api\/v1\/admin\/banners$/, 200, { method: 'GET', body: { banners: [] } });
          await openTab(e2e, 'orders');
          await openTab(e2e, 'banners');
          await clickText(e2e.page, '[data-panel="banners"] button', pick(lang, 'Reload', 'إعادة تحميل'));
          await e2e.page.waitForFunction(
            (text: string) => document.querySelector('[data-panel="banners"]')?.textContent?.includes(text) ?? false,
            { timeout: 10_000 },
          pick(lang, 'No banners configured.', 'لا توجد بانرات مُعدّة.'),
          );
          assert.equal(
            await e2e.page.$$eval('[data-panel="banners"] button', (buttons) =>
              buttons.filter((button) => (button as HTMLButtonElement).disabled).length,
            ),
            1,
            'Save is disabled when there is nothing to save',
          );

          await openTab(e2e, 'products');
          const search = await e2e.page.waitForSelector('[data-panel="products"] input[type="text"]');
          assert.ok(search);
          await setValue(search, `zz-no-such-product-${token('Z')}`);
          await waitForText(e2e.page, '[data-panel="products"] tbody', (text) => text.includes(pick(lang, 'No products match this view.', 'لا توجد منتجات مطابقة.')));
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it(`[${lang}] failures are shown as errors, never as stale data or fake success`, async () => {
        const fixture = await createTestProduct(admin, { stock: 9, price: 100 });
        const { order } = await placeCustomerOrder(fixture.variant.id, 1);
        const { e2e } = await adminPage(browser, lang);
        const serverError = pick(lang, 'The server could not complete this request. Try again in a moment.', 'تعذّر على الخادم إكمال هذا الطلب. حاول مرة أخرى بعد قليل.');
        try {
          // Dashboard: 500 on refresh -> alert, the cards disappear (no stale numbers), refresh again recovers.
          await e2e.page.waitForSelector('[data-metric="totalSales"]');
          const metrics = e2e.fulfillRequests(/\/api\/v1\/admin\/metrics$/, 500, { times: 1 });
          await e2e.page.click('[data-panel="overview"] button');
          assert.equal(await waitForText(e2e.page, '[data-panel="overview"] [role="alert"]', (text) => text.length > 0), serverError);
          assert.equal(await e2e.page.$('[data-metric]'), null, 'no stale metrics next to the error');
          assert.equal(metrics.hits, 1);
          await e2e.page.click('[data-panel="overview"] button');
          await e2e.page.waitForSelector('[data-metric="totalSales"]');
          assert.equal(await e2e.page.$('[data-panel="overview"] [role="alert"]'), null);

          // Orders list: network failure -> localised error + Retry; no rows; Retry recovers.
          const orders = e2e.abortRequests(/\/api\/v1\/admin\/orders\?/, { times: 1 });
          await openTab(e2e, 'orders');
          const networkMessage = pick(lang, 'Could not reach the server. Check your connection and try again.', 'تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.');
          assert.equal(await waitForText(e2e.page, '[data-panel="orders"] [role="alert"] span', (text) => text.length > 0), networkMessage);
          assert.equal(await e2e.page.$('[data-panel="orders"] [data-order]'), null, 'no stale rows');
          assert.equal(orders.hits, 1);
          await clickText(e2e.page, '[data-panel="orders"] [role="alert"] button', pick(lang, 'Retry', 'إعادة المحاولة'));
          await e2e.page.waitForSelector(`[data-panel="orders"] [data-order="${order.orderNumber}"]`, { timeout: 15_000 });

          // Status change refused by the server: error toast, status stays, never a success toast.
          const search = await e2e.page.waitForSelector('[data-panel="orders"] input[type="text"]');
          assert.ok(search);
          await setValue(search, order.orderNumber);
          await e2e.page.waitForSelector(`[data-order="${order.orderNumber}"]`);
          const patch = e2e.fulfillRequests(/\/api\/v1\/admin\/orders\/[^/]+\/status$/, 409, {
            method: 'PATCH',
            times: 1,
            body: { title: 'Conflict', status: 409, errorCode: 'InvalidOrderTransition', detail: 'An order in Pending cannot move to Confirmed.' },
          });
          const select = await e2e.page.waitForSelector(`[data-order="${order.orderNumber}"] select`);
          assert.ok(select);
          await setValue(select, 'Confirmed');
          await waitForToast(e2e.page, pick(lang, 'cannot move to that status', 'لا يمكن نقل هذا الطلب'));
          assert.equal(patch.hits, 1);
          assert.ok(!(await e2e.page.evaluate(() => document.body.textContent ?? '')).includes(pick(lang, 'is now Confirmed', 'بحالة «تم التأكيد»')), 'no success message');
          assert.equal((await adminOrderStatus(admin, order)), 'Pending', 'server state unchanged');
          assert.equal(await e2e.page.$eval(`[data-order="${order.orderNumber}"]`, (row) => row.getAttribute('data-order-status')), 'Pending');

          // Product save failing with a 500: the form stays open with an inline error, nothing is created.
          const create = e2e.fulfillRequests(/\/api\/v1\/admin\/products$/, 500, { method: 'POST', times: 1 });
          await openProductForm(e2e, lang);
          const tok = token('FAIL');
          const nameLabel = pick(lang, 'Product name', 'اسم المنتج');
          await fill(e2e.page, `${nameLabel} (English) *`, `E2E fail ${tok}`);
          await fill(e2e.page, `${nameLabel} (العربية) *`, `فشل ${tok}`);
          await fill(e2e.page, pick(lang, 'Base price (EGP) *', 'السعر الأساسي (ج.م) *'), '10');
          const url = await e2e.page.waitForSelector(`input[aria-label="${pick(lang, 'Image URL', 'رابط الصورة')} 1"]`);
          assert.ok(url);
          await setValue(url, 'https://images.example.com/f.png');
          const sku = await e2e.page.waitForSelector('input[aria-label="SKU 1"]');
          assert.ok(sku);
          await setValue(sku, `E2E-FAIL-${tok}`);
          const variantPrice = await e2e.page.waitForSelector(`input[aria-label="${pick(lang, 'Price', 'السعر')} 1"]`);
          assert.ok(variantPrice);
          await setValue(variantPrice, '10');
          await e2e.page.click('[role="dialog"] button[type="submit"]');
          assert.equal(await waitForText(e2e.page, '[role="dialog"] [role="alert"]', (text) => text.length > 0), serverError);
          assert.equal(create.hits, 1);
          assert.equal((await admin.adminProducts(`status=all&search=${tok}&pageSize=10`)).total, 0, 'nothing was created');
          assert.ok(!(await e2e.page.evaluate(() => document.body.textContent ?? '')).includes(pick(lang, 'Product created.', 'تم إنشاء المنتج.')));
          await e2e.page.keyboard.press('Escape');

          // Inventory adjustment lost on the network: inline error, stock unchanged on screen and on the server.
          const adjust = e2e.abortRequests(/\/api\/v1\/admin\/inventory\/adjust$/, { times: 1 });
          await openTab(e2e, 'inventory');
          const invSearch = await e2e.page.waitForSelector('[data-panel="inventory"] input[type="text"]');
          assert.ok(invSearch);
          await setValue(invSearch, fixture.sku);
          await e2e.page.waitForSelector(`[data-panel="inventory"] select option[value="${fixture.product.id}"]`, { timeout: 15_000 });
          await fill(e2e.page, pick(lang, 'Product', 'المنتج'), fixture.product.id);
          await fill(e2e.page, pick(lang, 'Adjustment (+/−)', 'التعديل (+/−)'), '-2');
          await fill(e2e.page, pick(lang, 'Reason *', 'السبب *'), 'network failure');
          await clickText(e2e.page, '[data-panel="inventory"] button', pick(lang, 'Apply adjustment', 'تطبيق التعديل'));
          assert.equal(await waitForText(e2e.page, '[data-error="inventory"]', (text) => text.length > 0), networkMessage);
          assert.equal(adjust.hits, 1);
          assert.match(await waitForText(e2e.page, '[data-field="current-stock"]', (text) => text.length > 0), /8 /);
          const stock = (await admin.adminProducts(`status=all&search=${fixture.sku}&pageSize=5`)).products[0].variants[0].stock;
          assert.equal(stock, 8);

          // Coupon creation failing: modal stays, inline error, no success.
          const coupon = e2e.fulfillRequests(/\/api\/v1\/admin\/discounts$/, 500, { method: 'POST', times: 1 });
          await openDiscountForm(e2e, lang);
          await fill(e2e.page, pick(lang, 'Coupon code *', 'كود الكوبون *'), `FAIL${tok}`);
          await e2e.page.click('[role="dialog"] button[type="submit"]');
          assert.equal(await waitForText(e2e.page, '[role="dialog"] [role="alert"]', (text) => text.length > 0), serverError);
          assert.equal(coupon.hits, 1);
          assert.equal((await admin.get<{ discounts: { code: string }[] }>('/api/v1/admin/discounts')).data.discounts.some((discount) => discount.code === `FAIL${tok}`), false);
          await e2e.page.keyboard.press('Escape');

          // Banner save failing: error toast, never the success message.
          const banners = e2e.fulfillRequests(/\/api\/v1\/admin\/banners$/, 500, { method: 'PUT', times: 1 });
          await openTab(e2e, 'orders');
          await openTab(e2e, 'banners');
          await e2e.page.waitForSelector('[data-banner]');
          await clickText(e2e.page, '[data-panel="banners"] button', pick(lang, 'Save banners', 'حفظ البانرات'));
          await waitForToast(e2e.page, serverError);
          assert.equal(banners.hits, 1);
          assert.ok(!(await e2e.page.evaluate(() => document.body.textContent ?? '')).includes(pick(lang, 'Homepage banners saved.', 'تم حفظ بانرات الصفحة الرئيسية.')));

          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });
    }
  });
});

async function adminOrderStatus(admin: ApiClient, order: Order): Promise<string | undefined> {
  const orders = await admin.get<{ orders: Order[] }>(`/api/v1/admin/orders?status=all&search=${order.orderNumber}&pageSize=5`);
  return orders.data.orders.find((entry) => entry.id === order.id)?.status;
}

