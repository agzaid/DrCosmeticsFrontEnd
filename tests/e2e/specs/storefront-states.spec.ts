import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { ApiClient, adminClient, e2eEnv, registerCustomer } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS } from '../harness/i18n.ts';
import { createSpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  addProductToCart,
  click,
  closeCart,
  gotoHome,
  loginViaUi,
  navigateTo,
  openCart,
  openShop,
  searchShop,
  shopProductIds,
  text,
  waitForShopIdle,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];
const PRODUCT_API = /\/api\/v1\/products(\?|$)/;

describe('storefront states: empty, loading, failure, offline, no fallback data', () => {
  let browser: Browser;
  let admin: ApiClient;
  let anon: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    anon = new ApiClient(e2eEnv().baseUrl);
  });

  after(async () => {
    await closeBrowser();
  });

  async function cardCount(e2e: E2ePage): Promise<number> {
    return e2e.page.$$eval('[data-testid^="product-card-"]', (nodes) => nodes.length);
  }

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}]`, () => {
      it('shows the empty bag, the empty wishlist and the no-results state with a working reset', async () => {
        const e2e = await newPage(browser, { lang });
        try {
          await gotoHome(e2e);
          await openCart(e2e);
          assert.equal(await text(e2e.page, '[data-testid="cart-empty"] h4'), T.bagEmpty);
          assert.equal(await e2e.page.$('[data-testid="drawer-checkout-btn"]'), null, 'no checkout button for an empty bag');
          await closeCart(e2e);

          await navigateTo(e2e, 'wishlist');
          assert.equal(await text(e2e.page, '[data-testid="wishlist-empty"] h3'), T.wishlistEmptyTitle);

          await openShop(e2e);
          const baseline = await shopProductIds(e2e);
          await searchShop(e2e, 'zz-nothing-matches-this');
          assert.equal(await text(e2e.page, '[data-testid="shop-empty"]'), T.shopEmptyTitle);
          assert.equal(await cardCount(e2e), 0);
          await click(e2e.page, '[data-testid="empty-reset"]');
          await e2e.page.waitForFunction(() => document.querySelectorAll('[data-testid^="product-card-"]').length > 0, { timeout: TIMEOUT });
          assert.deepEqual(await shopProductIds(e2e), baseline);
          await e2e.screenshot(`states-empty-${lang}`);
          e2e.assertOnlyApiTraffic();
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('shows a loading state with no products while the catalog is slow', async () => {
        const e2e = await newPage(browser, { lang });
        try {
          await gotoHome(e2e);
          await openShop(e2e);
          const slow = e2e.delayRequests(/search=slow-term/, 1500, { times: 1 });
          const typing = e2e.page.type('[data-testid="shop-search"]', 'slow-term');
          await typing;
          await e2e.page.waitForSelector('[data-testid="shop-loading"]', { timeout: TIMEOUT });
          assert.equal(await e2e.page.$eval('[data-testid="shop-loading"]', (n) => n.getAttribute('role')), 'status');
          assert.equal(await cardCount(e2e), 0, 'no product may be shown while loading');
          await e2e.screenshot(`states-loading-${lang}`);
          await waitForShopIdle(e2e);
          assert.equal(slow.hits, 1);
          assert.equal(await text(e2e.page, '[data-testid="shop-empty"]'), T.shopEmptyTitle);
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('shows an error with retry and NO product data when /api/v1/products fails (home and shop)', async () => {
        const seen = await anon.products({ pageSize: 6 });
        const names = seen.products.map((product) => product.name[lang] || product.name.en);
        const e2e = await newPage(browser, { lang });
        try {
          const outage = e2e.fulfillRequests(PRODUCT_API, 500);
          await e2e.goto('/');
          await e2e.page.waitForSelector('[data-testid="load-error"]', { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, '[data-testid="load-error"] h3'), T.loadErrorTitle);
          assert.equal(await cardCount(e2e), 0, 'home must not show any product while the API is failing');

          await click(e2e.page, '[data-testid="nav-cat-all"]');
          await e2e.page.waitForSelector('[data-testid="shop-search"]', { timeout: TIMEOUT });
          await e2e.page.waitForSelector('[data-testid="load-error"]', { timeout: TIMEOUT });
          assert.equal(await cardCount(e2e), 0);
          assert.equal(await e2e.page.$('[data-testid="results-count"]').then((n) => n?.evaluate((x) => x.textContent?.trim())), '');
          const body = (await e2e.page.evaluate(() => document.body.textContent)) ?? '';
          for (const name of names) {
            assert.ok(!body.includes(name), `product "${name}" rendered although the API failed (hidden fallback data)`);
          }
          await e2e.screenshot(`states-api-failure-${lang}`);

          // retry still fails -> still an error; once the API recovers, retry brings the real catalog back
          await click(e2e.page, '[data-testid="load-error"] button');
          await e2e.page.waitForSelector('[data-testid="load-error"]', { timeout: TIMEOUT });
          outage.remove();
          await click(e2e.page, '[data-testid="load-error"] button');
          await e2e.page.waitForFunction(() => document.querySelectorAll('[data-testid^="product-card-"]').length > 0, { timeout: TIMEOUT });
          assert.equal(await e2e.page.$('[data-testid="load-error"]'), null);
          assert.ok(outage.hits >= 2);
          e2e.assertOnlyApiTraffic();
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('shows a retry state when the boot reference data (categories) cannot be loaded', async () => {
        const e2e = await newPage(browser, { lang });
        try {
          const outage = e2e.abortRequests(/\/api\/v1\/categories$/);
          await e2e.goto('/');
          await e2e.page.waitForSelector('[data-testid="load-error"]', { timeout: TIMEOUT });
          assert.equal(await cardCount(e2e), 0);
          outage.remove();
          await click(e2e.page, '[data-testid="load-error"] button');
          await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('shows an error when the wishlist products or the order history cannot be read', async () => {
        const { email, password, client } = await registerCustomer('states');
        const spec = await createSpecProduct(admin, { price: 100, stock: 5 });
        await client.request('PUT', `/api/v1/customer/wishlist/${spec.product.id}`);
        const e2e = await newPage(browser, { lang });
        try {
          await gotoHome(e2e);
          await loginViaUi(e2e, email, password);
          const ordersOutage = e2e.fulfillRequests(/\/api\/v1\/customer\/orders/, 500);
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await navigateTo(e2e, 'account');
          await e2e.page.waitForSelector('[data-testid="load-error"]', { timeout: TIMEOUT });
          ordersOutage.remove();
          await click(e2e.page, '[data-testid="load-error"] button');
          await e2e.page.waitForSelector('[data-testid="orders-empty"]', { timeout: TIMEOUT });

          const wishlistOutage = e2e.fulfillRequests(/\/api\/v1\/products\?ids=/, 500);
          await navigateTo(e2e, 'wishlist');
          await e2e.page.waitForSelector('[data-testid="load-error"]', { timeout: TIMEOUT });
          assert.equal(await cardCount(e2e), 0);
          wishlistOutage.remove();
          await click(e2e.page, '[data-testid="load-error"] button');
          await e2e.page.waitForSelector(`[data-testid="product-card-${spec.product.id}"]`, { timeout: TIMEOUT });
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('copes with going offline: errors are explained, totals are marked as estimates, recovery works', async () => {
        const spec = await createSpecProduct(admin, { price: 150, stock: 10 });
        const e2e = await newPage(browser, { lang });
        try {
          e2e.allow({ console: [/Failed to load resource/], failedRequests: [/\/api\/v1\//] });
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, spec.product, spec.token);
          await e2e.page.waitForFunction(
            () => !document.querySelector<HTMLButtonElement>('[data-testid="drawer-checkout-btn"]')?.disabled,
            { timeout: TIMEOUT },
          );

          await e2e.page.setOfflineMode(true);
          await click(e2e.page, `[data-testid="cart-increase-${spec.product.variants[0].id}"]`);
          await e2e.page.waitForSelector('[data-testid="quote-unavailable"]', { timeout: TIMEOUT });
          assert.ok((await text(e2e.page, '[data-testid="quote-unavailable"]')).includes(T.quoteUnavailable));
          await e2e.screenshot(`states-offline-${lang}`);

          await closeCart(e2e);
          await e2e.page.setOfflineMode(false);
          await openCart(e2e);
          await click(e2e.page, '[data-testid="quote-unavailable"] button');
          await e2e.page.waitForSelector('[data-testid="quote-unavailable"]', { hidden: true, timeout: TIMEOUT });
          assert.equal(await e2e.page.$('[data-testid="load-error"]'), null);
        } finally {
          await e2e.page.setOfflineMode(false).catch(() => undefined);
          await e2e.close();
        }
      });
    });
  }

  it('ships no mock/seed data in the built app and never reads a static data file (no hidden fallback)', async (t) => {
    const env = e2eEnv();
    const seeded = await anon.products({ pageSize: 60, sort: 'newest' });
    const names = seeded.products.flatMap((product) => [product.name.en, product.name.ar]).filter((name) => name.length > 6);
    assert.ok(names.length > 0);

    if (env.attach) {
      t.skip('--attach mode has no local build output to scan; the traffic assertions below still run');
    } else {
      const assets = path.join(env.runDir, 'web', 'assets');
      const bundle = readdirSync(assets)
        .filter((file) => file.endsWith('.js'))
        .map((file) => readFileSync(path.join(assets, file), 'utf8'))
        .join('\n');
      for (const name of names.slice(0, 40)) {
        assert.ok(!bundle.includes(name), `product name "${name}" is embedded in the JavaScript bundle`);
      }
    }

    const e2e = await newPage(browser, { lang: 'en' });
    try {
      await gotoHome(e2e);
      await openShop(e2e);
      await e2e.page.reload({ waitUntil: 'domcontentloaded' });
      await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
      e2e.assertOnlyApiTraffic();
      for (const request of e2e.requests) {
        const { pathname } = new URL(request.url);
        assert.ok(!/\.(json|csv|xml)$/i.test(pathname), `static data file requested: ${pathname}`);
      }
      assert.ok(e2e.externalRequests.every((request) => ['image', 'stylesheet', 'font', 'other'].includes(request.resourceType)));
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });
});
