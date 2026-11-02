import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { ApiClient, adminClient, e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS } from '../harness/i18n.ts';
import { createSpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  addProductToCart,
  cartCount,
  click,
  closeCart,
  gotoHome,
  goToCheckout,
  openCart,
  openProduct,
  openShop,
  text,
  waitForDrawerTotal,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];

async function toastTexts(e2e: E2ePage): Promise<string[]> {
  return e2e.page.$$eval('[role="status"]', (nodes) => nodes.map((node) => node.textContent ?? ''));
}

async function waitForToast(e2e: E2ePage, expected: string): Promise<void> {
  await e2e.page.waitForFunction(
    (needle: string) => Array.from(document.querySelectorAll('[role="status"]')).some((n) => n.textContent?.includes(needle)),
    { timeout: TIMEOUT },
    expected,
  );
}

/** Records the JSON bodies of every POST /checkout/quote the page sends. */
async function pollUntil(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function recordQuoteBodies(e2e: E2ePage): { items: { variantId: string; quantity: number }[] }[] {
  const bodies: { items: { variantId: string; quantity: number }[] }[] = [];
  e2e.page.on('request', (request) => {
    if (request.url().includes('/api/v1/checkout/quote') && request.method() === 'POST') {
      bodies.push(JSON.parse(request.postData() ?? '{}'));
    }
  });
  return bodies;
}

describe('storefront cart (A-08, quantity rules)', () => {
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

  async function withPage(lang: Lang, body: (e2e: E2ePage) => Promise<void>): Promise<void> {
    const e2e = await newPage(browser, { lang });
    try {
      await body(e2e);
      e2e.assertOnlyApiTraffic();
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  }

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}]`, () => {
      it('adds, increases, decreases and removes lines; the drawer empties to the empty state', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 250, stock: 5 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token, { quantity: 2 });
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '2');
          assert.equal(await cartCount(e2e), 2);

          await click(e2e.page, `[data-testid="cart-increase-${variant.id}"]`);
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '3');
          await click(e2e.page, `[data-testid="cart-decrease-${variant.id}"]`);
          await click(e2e.page, `[data-testid="cart-decrease-${variant.id}"]`);
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '1');
          assert.equal(await cartCount(e2e), 1);

          // decrease at 1 removes the line
          await click(e2e.page, `[data-testid="cart-decrease-${variant.id}"]`);
          assert.equal(await text(e2e.page, '[data-testid="cart-empty"] h4'), T.bagEmpty);

          // add again and use the explicit remove button
          await closeCart(e2e);
          await openProduct(e2e, product, token);
          await click(e2e.page, '[data-testid="modal-add-to-bag"]');
          await e2e.page.waitForSelector(`[data-testid="cart-remove-${variant.id}"]`, { timeout: TIMEOUT });
          await click(e2e.page, `[data-testid="cart-remove-${variant.id}"]`);
          assert.equal(await text(e2e.page, '[data-testid="cart-empty"] h4'), T.bagEmpty);
          await e2e.screenshot(`cart-empty-${lang}`);
        });
      });

      it('never exceeds stock: the stepper stops at the limit and an over-limit add is refused with a message, not clamped', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 120, stock: 3 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          const quoteBodies = recordQuoteBodies(e2e);
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token, { quantity: 3 });
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '3');
          assert.equal(
            await e2e.page.$eval(`[data-testid="cart-increase-${variant.id}"]`, (n) => (n as HTMLButtonElement).disabled),
            true,
          );

          // adding one more from the product page is refused loudly and the line stays at 3
          await closeCart(e2e);
          await openProduct(e2e, product, token);
          await click(e2e.page, '[data-testid="modal-add-to-bag"]');
          await waitForToast(e2e, T.maxQuantity(3));
          assert.ok((await toastTexts(e2e)).some((entry) => entry.includes(T.maxQuantity(3))));
          await openCart(e2e).catch(() => undefined);
          await e2e.page.waitForSelector(`[data-testid="cart-qty-${variant.id}"]`, { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '3');
          await pollUntil(() => quoteBodies.length > 0, 'the page never asked the server for a quote');
          for (const body of quoteBodies) {
            for (const line of body.items) {
              assert.ok(Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 99, `invalid quantity ${line.quantity}`);
            }
          }
        });
        assert.equal(await anon.variantStock(product.id, variant.id), 3, 'adding to the cart must not touch stock');
      });

      it('caps a line at 99 even when stock is higher (API contract 1..99)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 10, stock: 150 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          const quoteBodies = recordQuoteBodies(e2e);
          await gotoHome(e2e);
          await openShop(e2e);
          await openProduct(e2e, product, token);
          // click the stepper until it disables itself
          await e2e.page.evaluate(() => {
            const plus = document.querySelector<HTMLButtonElement>('[data-testid="qty-increase"]');
            for (let i = 0; i < 200 && plus && !plus.disabled; i += 1) {
              plus.click();
            }
          });
          assert.equal(await text(e2e.page, '[data-testid="qty-value"]'), '99');
          await click(e2e.page, '[data-testid="modal-add-to-bag"]');
          await e2e.page.waitForSelector(`[data-testid="cart-qty-${variant.id}"]`, { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '99');
          assert.equal(
            await e2e.page.$eval(`[data-testid="cart-increase-${variant.id}"]`, (n) => (n as HTMLButtonElement).disabled),
            true,
          );
          await waitForDrawerTotal(e2e, 99 * 10);
          for (const body of quoteBodies) {
            for (const line of body.items) {
              assert.ok(line.quantity >= 1 && line.quantity <= 99, `invalid quantity ${line.quantity}`);
            }
          }
        });
      });

      it('keeps the cart across a reload, sends no write and reserves no stock (A-08)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 180, stock: 7 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          const before = e2e.requests.length;
          await addProductToCart(e2e, product, token, { quantity: 2 });
          await waitForDrawerTotal(e2e, 2 * 180 + 50);
          await pollUntil(() => e2e.requests.slice(before).some((r) => r.method === 'POST'), 'no quote was requested');

          const writes = e2e.requests
            .slice(before)
            .filter((request) => request.method !== 'GET' && !request.url.endsWith('/api/v1/checkout/quote'));
          assert.deepEqual(writes, [], 'adding to the cart must perform no network write besides the read-only quote');
          assert.equal(await anon.variantStock(product.id, variant.id), 7, 'no stock may be reserved by the cart');

          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
          const afterReload = e2e.requests.length;
          await openCart(e2e);
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '2');
          await waitForDrawerTotal(e2e, 2 * 180 + 50);
          const reloadWrites = e2e.requests
            .slice(afterReload)
            .filter((request) => request.method !== 'GET' && !request.url.endsWith('/api/v1/checkout/quote'));
          assert.deepEqual(reloadWrites, []);
          assert.equal(await anon.variantStock(product.id, variant.id), 7);
        });
      });

      it('flags lines that exceed the stock that is left after a reload instead of silently changing them', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 90, stock: 5 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token, { quantity: 5 });
          await closeCart(e2e);

          await admin.adjustStock(product.id, variant.id, -3, 'e2e: stock drops while a cart is open');
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: TIMEOUT });
          await openCart(e2e);
          await e2e.page.waitForSelector('[data-testid="cart-issues"]', { timeout: TIMEOUT });
          const issueText = await text(e2e.page, '[data-testid="cart-issues"]');
          if (lang === 'ar') {
            assert.equal(issueText, T.stockIssueAr);
          } else {
            const quote = await anon.quote([{ variantId: variant.id, quantity: 5 }]);
            assert.equal(issueText, quote.issues.find((issue) => issue.code === 'InsufficientStock')?.message);
          }
          // the quantity is NOT silently clamped; the customer decides
          assert.equal(await text(e2e.page, `[data-testid="cart-qty-${variant.id}"]`), '5');
          assert.equal(
            await e2e.page.$eval(`[data-testid="cart-increase-${variant.id}"]`, (n) => (n as HTMLButtonElement).disabled),
            true,
          );
          await goToCheckout(e2e);
          await e2e.page.waitForSelector('[data-testid="checkout-issues"]', { timeout: TIMEOUT });
          assert.equal(
            await e2e.page.$eval('[data-testid="place-order-btn"]', (n) => (n as HTMLButtonElement).disabled),
            true,
            'an order that exceeds stock must not be submittable',
          );
        });
      });
    });
  }
});
