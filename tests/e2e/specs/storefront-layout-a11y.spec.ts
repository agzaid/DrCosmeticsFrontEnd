import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'puppeteer-core';
import { ApiClient, adminClient, e2eEnv, registerCustomer } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS } from '../harness/i18n.ts';
import { createSpecProduct, type SpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  VALID_ADDRESS,
  addProductToCart,
  apiClientFromPage,
  click,
  fill,
  fillCheckout,
  goToCheckout,
  gotoHome,
  horizontalOverflow,
  loginViaUi,
  navigateTo,
  openAccount,
  openProduct,
  openShop,
  rememberedOrderId,
  text,
  waitForPlaceOrderEnabled,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

/** Buttons and links a screen-reader user could not name: no text, aria-label, aria-labelledby or title. */
async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('button, a[href], [role="button"], input, select')).flatMap((node) => {
      if (node instanceof HTMLInputElement && node.type === 'hidden') {
        return [];
      }
      const name =
        node.getAttribute('aria-label') ||
        node.getAttribute('aria-labelledby') ||
        node.getAttribute('title') ||
        (node.textContent ?? '').trim() ||
        (node instanceof HTMLInputElement || node instanceof HTMLSelectElement ? (node.labels?.length ? 'labelled' : '') : '') ||
        (node instanceof HTMLInputElement ? node.placeholder : '');
      return name ? [] : [`${node.tagName.toLowerCase()}.${node.className.toString().slice(0, 60)}`];
    }),
  );
}

describe('layout and accessibility of the changed controls (A-30)', () => {
  let browser: Browser;
  let admin: ApiClient;
  let anon: ApiClient;
  let product: SpecProduct;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    anon = new ApiClient(e2eEnv().baseUrl);
    product = await createSpecProduct(admin, { price: 320, stock: 12 });
  });

  after(async () => {
    await closeBrowser();
  });

  async function withPage(
    lang: Lang,
    viewport: { width: number; height: number } | undefined,
    body: (e2e: E2ePage) => Promise<void>,
  ): Promise<void> {
    const e2e = await newPage(browser, { lang, viewport });
    try {
      await body(e2e);
      e2e.assertOnlyApiTraffic();
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  }

  async function assertNoOverflow(e2e: E2ePage, label: string): Promise<void> {
    const { scrollWidth, clientWidth } = await horizontalOverflow(e2e);
    assert.ok(scrollWidth <= clientWidth, `${label}: horizontal overflow ${scrollWidth} > ${clientWidth}`);
  }

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}]`, () => {
      it('applies lang/dir and keeps the chosen language across a reload', async () => {
        await withPage(lang, undefined, async (e2e) => {
          await gotoHome(e2e);
          const state = () => e2e.page.evaluate(() => [document.documentElement.lang, document.documentElement.dir, localStorage.getItem('luma_language')]);
          assert.deepEqual(await state(), [lang, lang === 'ar' ? 'rtl' : 'ltr', lang]);

          // switch through the real control, then reload
          await click(e2e.page, '[data-testid="nav-language"]');
          const other: Lang = lang === 'en' ? 'ar' : 'en';
          assert.deepEqual(await state(), [other, other === 'ar' ? 'rtl' : 'ltr', other]);
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
          assert.deepEqual(await state(), [other, other === 'ar' ? 'rtl' : 'ltr', other], 'language must survive a reload');
          assert.equal(await text(e2e.page, '[data-testid="nav-cat-all"]'), TEXTS[other].allProducts);

          await click(e2e.page, '[data-testid="nav-language"]');
          assert.deepEqual(await state(), [lang, lang === 'ar' ? 'rtl' : 'ltr', lang]);
        });
      });

      for (const viewport of VIEWPORTS) {
        it(`has no horizontal overflow on any storefront screen at ${viewport.width}x${viewport.height}`, async () => {
          const { email, password } = await registerCustomer('layout');
          await withPage(lang, viewport, async (e2e) => {
            await gotoHome(e2e);
            await assertNoOverflow(e2e, 'home');
            await e2e.screenshot(`layout-home-${lang}-${viewport.name}`);

            await openShop(e2e);
            await assertNoOverflow(e2e, 'shop');
            await openProduct(e2e, product.product, product.token);
            await assertNoOverflow(e2e, 'product modal');
            await e2e.screenshot(`layout-modal-${lang}-${viewport.name}`);
            await click(e2e.page, '[data-testid="modal-add-to-bag"]');
            await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { timeout: TIMEOUT });
            await assertNoOverflow(e2e, 'cart drawer');
            await e2e.screenshot(`layout-cart-${lang}-${viewport.name}`);

            await goToCheckout(e2e);
            await waitForPlaceOrderEnabled(e2e);
            await assertNoOverflow(e2e, 'checkout');
            await click(e2e.page, '[data-testid="place-order-btn"]'); // invalid form -> error layout
            await e2e.page.waitForSelector('#checkout-fullName-error', { timeout: TIMEOUT });
            await assertNoOverflow(e2e, 'checkout with errors');
            await e2e.screenshot(`layout-checkout-${lang}-${viewport.name}`);

            await openAccount(e2e);
            await assertNoOverflow(e2e, 'sign-in');
            await loginViaUi(e2e, email, password);
            await assertNoOverflow(e2e, 'account');
            await click(e2e.page, '[data-testid="tab-addresses"]');
            await click(e2e.page, '[data-testid="add-address-btn"]');
            await e2e.page.waitForSelector('[data-testid="address-modal"]', { timeout: TIMEOUT });
            await assertNoOverflow(e2e, 'address modal');
            await e2e.screenshot(`layout-address-${lang}-${viewport.name}`);
            await e2e.page.keyboard.press('Escape');

            await navigateTo(e2e, 'wishlist');
            await assertNoOverflow(e2e, 'wishlist');
          });
        });
      }

      it('gives every icon-only control an accessible name on the main screens', async () => {
        await withPage(lang, undefined, async (e2e) => {
          await gotoHome(e2e);
          assert.deepEqual(await unnamedControls(e2e.page), [], 'home');
          await openShop(e2e);
          assert.deepEqual(await unnamedControls(e2e.page), [], 'shop');
          await openProduct(e2e, product.product, product.token);
          assert.deepEqual(await unnamedControls(e2e.page), [], 'product modal');
          await click(e2e.page, '[data-testid="modal-add-to-bag"]');
          await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { timeout: TIMEOUT });
          assert.deepEqual(await unnamedControls(e2e.page), [], 'cart drawer');
          await goToCheckout(e2e);
          assert.deepEqual(await unnamedControls(e2e.page), [], 'checkout');
          await openAccount(e2e);
          assert.deepEqual(await unnamedControls(e2e.page), [], 'sign-in');
        });
      });

      it('closes the drawer and the modal with Escape, traps Tab inside them and returns focus to the opener', async () => {
        await withPage(lang, undefined, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await openProduct(e2e, product.product, product.token);
          assert.equal(await e2e.page.evaluate(() => document.querySelector('[data-testid="product-modal"]')?.getAttribute('role')), 'dialog');
          assert.equal(await e2e.page.evaluate(() => document.querySelector('[data-testid="product-modal"]')?.getAttribute('aria-modal')), 'true');
          for (let i = 0; i < 25; i += 1) {
            await e2e.page.keyboard.press('Tab');
            assert.ok(
              await e2e.page.evaluate(() => document.querySelector('[data-testid="product-modal"]')?.contains(document.activeElement) ?? false),
              'focus escaped the modal',
            );
          }
          await e2e.page.keyboard.press('Escape');
          await e2e.page.waitForSelector('[data-testid="product-modal"]', { hidden: true, timeout: TIMEOUT });

          // keyboard-open the drawer from the bag button, trap focus, Escape, focus returns to the bag button
          await e2e.page.focus('[data-testid="nav-cart"]');
          await e2e.page.keyboard.press('Enter');
          await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { timeout: TIMEOUT });
          for (let i = 0; i < 12; i += 1) {
            await e2e.page.keyboard.press('Tab');
            assert.ok(
              await e2e.page.evaluate(() => document.querySelector('[data-testid="cart-drawer"]')?.contains(document.activeElement) ?? false),
              'focus escaped the drawer',
            );
          }
          await e2e.page.keyboard.press('Escape');
          await e2e.page.waitForSelector('[data-testid="cart-drawer"]', { hidden: true, timeout: TIMEOUT });
          assert.equal(await e2e.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'nav-cart');
        });
      });

      it('supports the checkout form by keyboard: label association, Tab order, visible focus, Enter submits', async () => {
        const spec = await createSpecProduct(admin, { price: 320, stock: 12 });
        await withPage(lang, undefined, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, spec.product, spec.token);
          await goToCheckout(e2e);
          await waitForPlaceOrderEnabled(e2e);

          // every field is programmatically labelled
          const unlabeled = await e2e.page.$$eval('form input, form select', (nodes) =>
            nodes.filter((n) => !(n as HTMLInputElement).labels?.length).map((n) => n.id || n.tagName),
          );
          assert.deepEqual(unlabeled, []);

          // Tab order follows the visual/logical order
          await e2e.page.focus('#checkout-fullName');
          const order: string[] = [];
          for (let i = 0; i < 7; i += 1) {
            await e2e.page.keyboard.press('Tab');
            order.push(await e2e.page.evaluate(() => document.activeElement?.id ?? ''));
          }
          assert.deepEqual(order, [
            'checkout-mobileNumber',
            'checkout-email',
            'checkout-governorate',
            'checkout-city',
            'checkout-streetAddress',
            'checkout-buildingApt',
            'checkout-deliveryNotes',
          ]);
          await e2e.page.keyboard.press('Tab');
          assert.equal(await e2e.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'place-order-btn');

          // focus is visible on fields (ring or outline)
          await e2e.page.focus('#checkout-city');
          const ring = await e2e.page.$eval('#checkout-city', (node) => {
            const style = getComputedStyle(node);
            return { shadow: style.boxShadow, outline: style.outlineStyle, outlineWidth: style.outlineWidth };
          });
          assert.ok(ring.shadow !== 'none' || (ring.outline !== 'none' && ring.outlineWidth !== '0px'), `no visible focus indicator: ${JSON.stringify(ring)}`);

          // Enter inside a field submits: invalid -> messages
          await e2e.page.focus('#checkout-fullName');
          await e2e.page.keyboard.press('Enter');
          await e2e.page.waitForSelector('#checkout-fullName-error', { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, '#checkout-fullName-error'), T.errors.fullName);

          // valid + Enter places the order
          await fillCheckout(e2e, VALID_ADDRESS);
          await e2e.page.focus('#checkout-deliveryNotes');
          await e2e.page.keyboard.press('Enter');
          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });
          const own = await apiClientFromPage(e2e);
          const placed = await own.order((await rememberedOrderId(e2e)) ?? '');
          assert.equal(placed.status, 200);
          assert.equal(await anon.variantStock(spec.product.id, spec.product.variants[0].id), 11);
        });
      });

      it('keeps the RTL layout mirrored where it matters (drawer side, inputs)', async () => {
        await withPage(lang, undefined, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product.product, product.token);
          const box = await e2e.page.$eval('[data-testid="cart-drawer"]', (node) => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: window.innerWidth };
          });
          if (lang === 'ar') {
            assert.ok(box.left <= 1, 'the drawer must open on the left in RTL');
          } else {
            assert.ok(box.right >= box.width - 1, 'the drawer must open on the right in LTR');
          }
          await fill(e2e.page, '[data-testid="coupon-input"]', 'abc');
          await e2e.screenshot(`layout-rtl-drawer-${lang}`);
        });
      });
    });
  }
});
