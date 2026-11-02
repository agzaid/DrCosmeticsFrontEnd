/**
 * (d) Inventory adjustments through the admin UI (A-35): delta mode, low-stock classification (0 < stock <= 5),
 * validation, a stale view forced with a second admin session, and the exact-count (version-guarded) mode.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { AdminMetrics, Product } from '../../../src/types';
import { ApiClient, adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, type E2ePage, type Lang } from '../harness/browser.ts';
import {
  LANGS,
  adminPage,
  adminProduct,
  clickText,
  control,
  createTestProduct,
  fill,
  openTab,
  pick,
  productBody,
  setValue,
  token,
  waitForText,
} from './admin-helpers.ts';

async function stockOf(api: ApiClient, productId: string, variantId: string): Promise<number> {
  const variant = (await adminProduct(api, productId)).variants.find((entry) => entry.id === variantId);
  assert.ok(variant, 'variant exists');
  return variant.stock;
}

async function lowStockSkus(api: ApiClient): Promise<Set<string>> {
  const metrics = (await api.get<{ metrics: AdminMetrics }>('/api/v1/admin/metrics')).data.metrics;
  return new Set(metrics.lowStockItems.map((item) => item.variantSku));
}

/** Opens the Inventory tab and selects `product` (and optionally one of its variants). */
async function selectVariant(e2e: E2ePage, lang: Lang, product: Product, variantId = product.variants[0].id): Promise<void> {
  await openTab(e2e, 'inventory');
  const search = await e2e.page.waitForSelector('[data-panel="inventory"] input[type="text"]');
  assert.ok(search);
  await setValue(search, product.variants[0].sku);
  await e2e.page.waitForSelector(`[data-panel="inventory"] select option[value="${product.id}"]`, { timeout: 15_000 });
  await setValue(await control(e2e.page, pick(lang, 'Product', 'المنتج')), product.id);
  await e2e.page.waitForSelector(`[data-panel="inventory"] select option[value="${variantId}"]`);
  await setValue(await control(e2e.page, pick(lang, 'Variant', 'الدرجة')), variantId);
}

async function applyDelta(e2e: E2ePage, lang: Lang, delta: string, reason: string): Promise<void> {
  await fill(e2e.page, pick(lang, 'Adjustment (+/−)', 'التعديل (+/−)'), delta);
  await fill(e2e.page, pick(lang, 'Reason *', 'السبب *'), reason);
  await clickText(e2e.page, '[data-panel="inventory"] button', pick(lang, 'Apply adjustment', 'تطبيق التعديل'));
}

async function currentStockCard(e2e: E2ePage, expected: number, state: string): Promise<void> {
  await waitForText(e2e.page, '[data-field="current-stock"]', (text) => text.includes(String(expected)));
  assert.equal(await e2e.page.$eval('[data-field="current-stock"]', (element) => element.getAttribute('data-stock-state')), state);
}

function adjustPosts(e2e: E2ePage): number {
  return e2e.requests.filter((request) => request.method === 'POST' && request.url.endsWith('/api/v1/admin/inventory/adjust')).length;
}

describe('admin inventory', () => {
  let browser: Browser;
  let admin: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
  });

  after(async () => {
    await closeBrowser();
  });

  for (const lang of LANGS) {
    it(`[${lang}] delta adjustments persist, classify low/out of stock and validate before any request`, async () => {
      const fixture = await createTestProduct(admin, { stock: 10, price: 100 });
      const { e2e } = await adminPage(browser, lang);
      try {
        await selectVariant(e2e, lang, fixture.product);
        await currentStockCard(e2e, 10, 'ok');

        // Validation happens client-side: nothing is sent.
        await applyDelta(e2e, lang, '0', 'zero');
        const zero = await waitForText(e2e.page, '[data-error="inventory"]', (text) => text.length > 0);
        assert.match(zero, lang === 'en' ? /non-zero adjustment/ : /لا تساوي صفراً/);
        await applyDelta(e2e, lang, '3', '   ');
        const noReason = await waitForText(e2e.page, '[data-error="inventory"]', (text) => (lang === 'en' ? /reason is required/ : /سبب التعديل مطلوب/).test(text));
        assert.ok(noReason.length > 0);
        assert.equal(adjustPosts(e2e), 0, 'invalid input never reaches the API');
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 10);

        // +5 -> 15 (in stock).
        await applyDelta(e2e, lang, '5', 'E2E restock');
        await currentStockCard(e2e, 15, 'ok');
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 15);
        assert.ok(!(await lowStockSkus(admin)).has(fixture.sku));

        // -12 -> 3 (low stock, listed on the dashboard).
        await applyDelta(e2e, lang, '-12', 'E2E damaged');
        await currentStockCard(e2e, 3, 'low');
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 3);
        assert.ok((await lowStockSkus(admin)).has(fixture.sku));
        await e2e.screenshot(`admin-inventory-${lang}-low`);

        // -3 -> 0 (out of stock, no longer "low").
        await applyDelta(e2e, lang, '-3', 'E2E sold out');
        await currentStockCard(e2e, 0, 'out');
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 0);
        assert.ok(!(await lowStockSkus(admin)).has(fixture.sku));
        assert.equal(adjustPosts(e2e), 3);

        // The inactive/zero variant cannot be pushed below zero: the server refuses, the message is localised and
        // the screen keeps showing the stored stock.
        await applyDelta(e2e, lang, '-1', 'E2E below zero');
        const refused = await waitForText(e2e.page, '[data-error="inventory"]', (text) => text.length > 0);
        assert.match(refused, lang === 'en' ? /stock changed while you were working/i : /تغيّر المخزون أثناء عملك/);
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 0);
        await currentStockCard(e2e, 0, 'out');
        e2e.assertClean({ statuses: [{ status: 409, method: 'POST', url: /\/api\/v1\/admin\/inventory\/adjust$/ }] });
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] stale view: a second admin session changes stock first, the first session gets a conflict and fresh stock (A-35)`, async () => {
      const fixture = await createTestProduct(admin, { stock: 5, price: 100 });
      const { e2e } = await adminPage(browser, lang);
      const secondAdmin = await adminClient();
      try {
        await selectVariant(e2e, lang, fixture.product);
        await currentStockCard(e2e, 5, 'low');

        // Second session removes 4 units while the first still displays 5.
        await secondAdmin.adjustStock(fixture.product.id, fixture.variant.id, -4, 'second admin');
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 1);

        await applyDelta(e2e, lang, '-3', 'based on a stale count');
        const message = await waitForText(e2e.page, '[data-error="inventory"]', (text) => text.length > 0);
        assert.match(message, lang === 'en' ? /stock changed while you were working/i : /تغيّر المخزون أثناء عملك/);
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 1, 'the conflicting request changed nothing');
        await currentStockCard(e2e, 1, 'low');
        await e2e.screenshot(`admin-inventory-${lang}-conflict`);

        // After the refresh the admin can act on the real number.
        await applyDelta(e2e, lang, '-1', 'based on the fresh count');
        await currentStockCard(e2e, 0, 'out');
        assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 0);
        e2e.assertClean({ statuses: [{ status: 409, method: 'POST', url: /\/api\/v1\/admin\/inventory\/adjust$/ }] });
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] low-stock boundaries 0/1/5/6 are classified identically on screen and in the API`, async () => {
      const sku = `E2E-${token('LS')}`;
      const product = await admin.createProduct(
        productBody({
          sku,
          variants: [0, 1, 5, 6].map((stock) => ({
            sku: `${sku}-S${stock}`,
            shadeName: null,
            shadeHex: null,
            size: `${stock}u`,
            price: 100,
            stock,
            isActive: true,
          })),
        }),
      );
      const { e2e } = await adminPage(browser, lang);
      try {
        const expected: Record<number, string> = { 0: 'out', 1: 'low', 5: 'low', 6: 'ok' };
        const listed = await lowStockSkus(admin);
        for (const variant of product.variants) {
          await selectVariant(e2e, lang, product, variant.id);
          await currentStockCard(e2e, variant.stock, expected[variant.stock]);
          assert.equal(listed.has(variant.sku), expected[variant.stock] === 'low', `dashboard list membership for stock ${variant.stock}`);
        }
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] an empty search shows the empty state`, async () => {
      const { e2e } = await adminPage(browser, lang);
      try {
        await openTab(e2e, 'inventory');
        const search = await e2e.page.waitForSelector('[data-panel="inventory"] input[type="text"]');
        assert.ok(search);
        await setValue(search, `no-such-product-${token('NX')}`);
        const text = await waitForText(e2e.page, '[data-empty="inventory"]', (value) => value.length > 0);
        assert.match(text, lang === 'en' ? /No products available/ : /لا توجد منتجات متاحة/);
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }

  it('exact-count mode: guarded by the variant row version; a stale or invalid version is a 409 / 400 (A-35)', async () => {
    const fixture = await createTestProduct(admin, { stock: 12, price: 100 });
    const stale = await admin.request<{ error?: unknown; errorCode?: string }>('POST', '/api/v1/admin/inventory/adjust', {
      body: { productId: fixture.product.id, variantId: fixture.variant.id, newStock: 20, expectedVersion: 'AAAAAAAAB9E=', reason: 'stale version' },
    });
    assert.equal(stale.status, 409, 'a stale version is refused');
    assert.equal(stale.data.errorCode, 'InventoryConflict');
    const invalid = await admin.request('POST', '/api/v1/admin/inventory/adjust', {
      body: { productId: fixture.product.id, variantId: fixture.variant.id, newStock: 20, expectedVersion: '%%%', reason: 'bad version' },
    });
    assert.equal(invalid.status, 400);
    assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 12, 'refused requests changed nothing');
  });

  it('[en] exact-count UI: a fresh count applies and a count taken before another admin\'s change is refused', async () => {
    const fixture = await createTestProduct(admin, { stock: 12, price: 100 });
    const { e2e } = await adminPage(browser, 'en');
    try {
      await selectVariant(e2e, 'en', fixture.product);
      const absolute = 'input[name="inventory-mode"][value="absolute"]';
      await e2e.page.waitForSelector(absolute);
      assert.equal(
        await e2e.page.$eval(absolute, (element) => (element as HTMLInputElement).disabled),
        false,
        'exact count is offered because the server sends the variant row version',
      );
      await e2e.page.click(absolute);

      // The count the admin sees is current, so it applies.
      await fill(e2e.page, 'New stock count', '20');
      await fill(e2e.page, 'Reason *', 'physical count');
      await clickText(e2e.page, '[data-panel="inventory"] button', 'Apply adjustment');
      await currentStockCard(e2e, 20, 'ok');
      assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 20);

      // Another admin changes the stock; the first session still holds the previous row version.
      const secondAdmin = await adminClient();
      await secondAdmin.adjustStock(fixture.product.id, fixture.variant.id, 3, 'second admin');
      await fill(e2e.page, 'New stock count', '40');
      await fill(e2e.page, 'Reason *', 'physical count after the change');
      await clickText(e2e.page, '[data-panel="inventory"] button', 'Apply adjustment');
      const refused = await waitForText(e2e.page, '[data-error="inventory"]', (text) => text.length > 0);
      assert.match(refused, /stock changed while you were working/i);
      assert.equal(await stockOf(admin, fixture.product.id, fixture.variant.id), 23, 'the stale exact count changed nothing');
      await currentStockCard(e2e, 23, 'ok');
      e2e.assertClean({ statuses: [{ status: 409, method: 'POST', url: /\/api\/v1\/admin\/inventory\/adjust$/ }] });
    } finally {
      await e2e.close();
    }
  });

  it('admin product API exposes the variant row version required by exact-count mode', async () => {
    const fixture = await createTestProduct(admin, { stock: 4 });
    const variant = (await adminProduct(admin, fixture.product.id)).variants[0];
    assert.ok(variant.version, 'GET /admin/products/{id} must return variants[].version');
  });
});
