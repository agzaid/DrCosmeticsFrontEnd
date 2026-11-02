import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { Order } from '../../../src/types';
import { ApiClient, adminClient, e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { createSpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  VALID_ADDRESS,
  addProductToCart,
  fillCheckout,
  goToCheckout,
  gotoHome,
  openCart,
  openShop,
  orderNumber,
  rememberedOrderId,
  submitOrder,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];

async function pollUntil(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('storefront lost-response recovery (A-19)', () => {
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

  async function ordersFor(email: string): Promise<Order[]> {
    const result = await admin.get<{ orders: Order[] }>('/api/v1/admin/orders?page=1&pageSize=100');
    assert.ok(result.ok, `admin orders failed: ${result.status}`);
    return result.data.orders.filter((order) => order.customerEmail === email);
  }

  async function storedCartLines(e2e: E2ePage): Promise<number> {
    return e2e.page.evaluate(() => {
      const raw = localStorage.getItem('luma_beauty_cart_items');
      return raw ? (JSON.parse(raw) as unknown[]).length : 0;
    });
  }

  for (const lang of LANGS) {
    describe(`[${lang}]`, () => {
      it('recovers the committed order automatically when only the POST response is lost', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 300, stock: 10 });
        const variant = product.variants[0];
        const email = `lost1.${Date.now()}@example.com`;
        const e2e = await newPage(browser, { lang });
        try {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await goToCheckout(e2e);
          await fillCheckout(e2e, VALID_ADDRESS, email);

          const lost = e2e.failResponses(/\/api\/v1\/orders$/, { method: 'POST', times: 1 });
          await submitOrder(e2e);

          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });
          assert.equal(lost.hits, 1, 'the response of exactly one POST /orders must have been dropped');

          const orders = await ordersFor(email);
          assert.equal(orders.length, 1, 'exactly one order must exist');
          assert.equal(await orderNumber(e2e), orders[0].orderNumber, 'the confirmation shows the ORIGINAL order');
          assert.equal(await rememberedOrderId(e2e), orders[0].id);
          assert.equal(await anon.variantStock(product.id, variant.id), 9, 'stock deducted once');
          assert.equal(await storedCartLines(e2e), 0, 'the bag is cleared after the confirmed success');

          const posts = e2e.requests.filter((r) => r.method === 'POST' && r.url.endsWith('/api/v1/orders'));
          assert.equal(posts.length, 1, 'no blind second order POST is needed when the attempt lookup finds the order');
          await e2e.screenshot(`lost-response-auto-${lang}`);
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('keeps the bag after an unconfirmed attempt and a retry returns the same order, not a second one', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 300, stock: 10 });
        const variant = product.variants[0];
        const email = `lost2.${Date.now()}@example.com`;
        const e2e = await newPage(browser, { lang });
        try {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await goToCheckout(e2e);
          await fillCheckout(e2e, VALID_ADDRESS, email);

          // The server commits, the client sees a network error AND the recovery lookup fails too.
          const lost = e2e.failResponses(/\/api\/v1\/orders$/, { method: 'POST', times: 1 });
          const lookup = e2e.abortRequests(/\/api\/v1\/checkout\/attempts\//, { times: 1 });
          await submitOrder(e2e);
          await pollUntil(() => lost.hits === 1 && lookup.hits === 1, 'the failure injection did not run');
          await e2e.page.waitForFunction(
            () => !document.querySelector<HTMLButtonElement>('[data-testid="place-order-btn"]')?.disabled,
            { timeout: TIMEOUT },
          );

          assert.equal(await e2e.page.$('[data-testid="order-confirmation"]'), null, 'not confirmed yet');
          assert.equal(await storedCartLines(e2e), 1, 'the bag must NOT be cleared before success is confirmed');
          const committed = await ordersFor(email);
          assert.equal(committed.length, 1, 'the server did commit the order');
          assert.equal(await anon.variantStock(product.id, variant.id), 9);

          // retry: same idempotency key, same payload -> the original order is replayed
          await submitOrder(e2e);
          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });
          const after = await ordersFor(email);
          assert.equal(after.length, 1, 'retry must not create a second order');
          assert.equal(await orderNumber(e2e), committed[0].orderNumber);
          assert.equal(await anon.variantStock(product.id, variant.id), 9, 'stock deducted exactly once');
          assert.equal(await storedCartLines(e2e), 0);
          await e2e.screenshot(`lost-response-retry-${lang}`);
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });

      it('recovers the original order after a reload when the confirmation was never shown', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 300, stock: 10 });
        const variant = product.variants[0];
        const email = `lost3.${Date.now()}@example.com`;
        const e2e = await newPage(browser, { lang });
        try {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await goToCheckout(e2e);
          await fillCheckout(e2e, VALID_ADDRESS, email);

          const lost = e2e.failResponses(/\/api\/v1\/orders$/, { method: 'POST', times: 1 });
          const lookup = e2e.abortRequests(/\/api\/v1\/checkout\/attempts\//, { times: 1 });
          await submitOrder(e2e);
          await pollUntil(() => lost.hits === 1 && lookup.hits === 1, 'the failure injection did not run');
          await e2e.page.waitForFunction(
            () => !document.querySelector<HTMLButtonElement>('[data-testid="place-order-btn"]')?.disabled,
            { timeout: TIMEOUT },
          );
          assert.equal(await storedCartLines(e2e), 1);

          // hard reload, then back to checkout: the persisted attempt is resolved before anything new is created
          const mark = e2e.requests.length;
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
          await openCart(e2e);
          await goToCheckout(e2e);
          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });

          const orders = await ordersFor(email);
          assert.equal(orders.length, 1);
          assert.equal(await orderNumber(e2e), orders[0].orderNumber);
          assert.equal(await anon.variantStock(product.id, variant.id), 9);
          assert.equal(await storedCartLines(e2e), 0, 'cleared only once the original order was confirmed');
          const posts = e2e.requests.slice(mark).filter((r) => r.method === 'POST' && r.url.endsWith('/api/v1/orders'));
          assert.equal(posts.length, 0, 'recovery after reload must not POST again');
          e2e.assertClean();
        } finally {
          await e2e.close();
        }
      });
    });
  }
});
