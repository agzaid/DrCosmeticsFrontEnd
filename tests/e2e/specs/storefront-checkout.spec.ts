import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { ApiClient, adminClient, e2eEnv, newIdempotencyKey } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS, egp } from '../harness/i18n.ts';
import { createSpecProduct } from '../harness/products.ts';
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
  money,
  openCart,
  openShop,
  orderNumber,
  rememberedOrderId,
  submitOrder,
  text,
  waitForPlaceOrderEnabled,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];

const ARABIC_ADDRESS = {
  fullName: 'سارة أحمد',
  mobileNumber: '010 1234 5678',
  governorate: 'Cairo',
  city: 'القاهرة الجديدة',
  streetAddress: 'شارع التسعين، فيلا 12',
};

describe('storefront guest checkout (A-13..A-21)', () => {
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

  async function errorText(e2e: E2ePage, field: string): Promise<string | null> {
    const node = await e2e.page.$(`#checkout-${field}-error`);
    return node ? ((await node.evaluate((n) => n.textContent)) ?? '').trim() : null;
  }

  it('returns the exact legacy validation messages from the API for the same fields (A-14)', async () => {
    const { product } = await createSpecProduct(admin, { price: 300, stock: 5 });
    const items = [{ variantId: product.variants[0].id, quantity: 1 }];
    const client = new ApiClient(e2eEnv().baseUrl);
    await client.guestSession();
    const result = await client.placeOrder(items, {
      fullName: 'Ab',
      mobileNumber: '01912345678',
      governorate: 'C',
      city: '',
      streetAddress: 'St 9',
    });
    assert.equal(result.status, 400);
    const errors = (result.data as unknown as { errors: Record<string, string[]> }).errors;
    assert.equal(errors.fullName[0], TEXTS.en.errors.fullName);
    assert.equal(errors.mobileNumber[0], TEXTS.en.errors.mobileNumber);
    assert.equal(errors.city[0], TEXTS.en.errors.city);
    assert.equal(errors.streetAddress[0], TEXTS.en.errors.streetAddress);
    assert.ok(errors.governorate?.length > 0);
    assert.equal(await anon.variantStock(product.id, items[0].variantId), 5, 'a rejected order must not deduct stock');
  });

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}]`, () => {
      it('shows every address validation message in the UI language and sends nothing while invalid (AR-7)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 300, stock: 5 });
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await goToCheckout(e2e);
          await waitForPlaceOrderEnabled(e2e);

          // everything empty
          await click(e2e.page, '[data-testid="place-order-btn"]');
          await e2e.page.waitForSelector('#checkout-fullName-error', { timeout: TIMEOUT });
          assert.equal(await errorText(e2e, 'fullName'), T.errors.fullName);
          assert.equal(await errorText(e2e, 'mobileNumber'), T.errors.mobileNumber);
          assert.equal(await errorText(e2e, 'city'), T.errors.city);
          assert.equal(await errorText(e2e, 'streetAddress'), T.errors.streetAddress);
          assert.equal(await errorText(e2e, 'governorate'), null, 'Cairo is preselected');
          assert.equal(await e2e.page.$eval('#checkout-fullName', (n) => n.getAttribute('aria-invalid')), 'true');
          assert.equal(await e2e.page.$eval('#checkout-fullName-error', (n) => n.getAttribute('role')), 'alert');

          // the fixtures from ACCEPTANCE.md section 3
          await fillCheckout(e2e, { fullName: 'Ab', mobileNumber: '01912345678', city: ' ', streetAddress: 'St 9' }, 'not-an-email');
          await click(e2e.page, '[data-testid="place-order-btn"]');
          await e2e.page.waitForSelector('#checkout-email-error', { timeout: TIMEOUT });
          assert.equal(await errorText(e2e, 'fullName'), T.errors.fullName);
          assert.equal(await errorText(e2e, 'mobileNumber'), T.errors.mobileNumber);
          assert.equal(await errorText(e2e, 'city'), T.errors.city);
          assert.equal(await errorText(e2e, 'streetAddress'), T.errors.streetAddress);
          assert.equal(await errorText(e2e, 'email'), T.errors.email);

          await fill(e2e.page, '#checkout-mobileNumber', '0101234567');
          await click(e2e.page, '[data-testid="place-order-btn"]');
          assert.equal(await errorText(e2e, 'mobileNumber'), T.errors.mobileNumber, '10 digits is invalid');
          await e2e.screenshot(`checkout-validation-${lang}`);

          // valid values clear their own message as the shopper types
          await fill(e2e.page, '#checkout-fullName', 'Sarah Ahmed');
          assert.equal(await errorText(e2e, 'fullName'), null);
          await fill(e2e.page, '#checkout-mobileNumber', '010 1234 5678');
          assert.equal(await errorText(e2e, 'mobileNumber'), null);
          await fill(e2e.page, '#checkout-streetAddress', 'Street 90, Villa 12');
          assert.equal(await errorText(e2e, 'streetAddress'), null);
          await fill(e2e.page, '#checkout-city', lang === 'ar' ? 'القاهرة الجديدة' : 'New Cairo');
          assert.equal(await errorText(e2e, 'city'), null);

          const posts = e2e.requests.filter((r) => r.method === 'POST' && r.url.includes('/api/v1/orders'));
          assert.deepEqual(posts, [], 'no order may be sent while the form is invalid');
        });
      });

      it('places a guest order, shows the confirmation, survives a hard reload and deducts stock (A-17, A-21)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 300, stock: 10 });
        const variant = product.variants[0];
        const address = lang === 'ar' ? ARABIC_ADDRESS : { ...VALID_ADDRESS, buildingApt: 'Apt 4', deliveryNotes: 'Call before delivery' };
        const email = `guest.${Date.now()}@example.com`;
        let orderId = '';

        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token, { quantity: 2 });
          await goToCheckout(e2e);
          await fillCheckout(e2e, address, email);
          const quote = await anon.quote([{ variantId: variant.id, quantity: 2 }]);
          assert.equal(quote.total, 600, '2 x 300 reaches the free-delivery threshold');
          assert.equal(await money(e2e.page, '[data-testid="checkout-total"] span:last-child'), quote.total);
          await submitOrder(e2e);

          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });
          const shownNumber = await orderNumber(e2e);
          assert.match(shownNumber, /^LUM-\d+$/);
          const stored = await rememberedOrderId(e2e);
          assert.ok(stored, 'the storefront must remember the order id for reload recovery');
          orderId = stored;
          assert.ok((await text(e2e.page, '[data-testid="order-confirmation"]')).includes(egp(600, lang)));
          await e2e.screenshot(`checkout-confirmation-${lang}`);

          // persisted through the API with the browser's guest cookie
          const own = await apiClientFromPage(e2e);
          const read = await own.order(orderId);
          assert.equal(read.status, 200);
          const order = read.data.order;
          assert.equal(order.orderNumber, shownNumber);
          assert.equal(order.status, 'Pending');
          assert.equal(order.customerId ?? null, null);
          assert.equal(order.customerEmail, email);
          assert.equal(order.total, 600);
          assert.equal(order.items.length, 1);
          assert.equal(order.items[0].quantity, 2);
          assert.equal(order.shippingAddress.fullName, address.fullName);
          assert.equal(order.shippingAddress.city, address.city, 'the address (incl. Arabic text) is stored as entered');
          assert.equal(order.shippingAddress.streetAddress, address.streetAddress);
          assert.equal(await anon.variantStock(product.id, variant.id), 8, 'stock must drop by the ordered quantity');

          // the bag was cleared only after the confirmed success
          await openCart(e2e);
          assert.equal(await text(e2e.page, '[data-testid="cart-empty"] h4'), T.bagEmpty);
          assert.equal(await e2e.page.evaluate(() => localStorage.getItem('luma_beauty_cart_items')), '[]');
          await e2e.page.keyboard.press('Escape');

          // a hard reload keeps the confirmation (A-19)
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });
          assert.equal(await orderNumber(e2e), shownNumber);
          assert.ok(e2e.requests.some((r) => r.url.endsWith(`/api/v1/orders/${orderId}`)), 'reload must re-read the order');
        });

        // A-21: a second browser without the guest cookie gets the not-found state
        const stranger = await newPage(browser, { lang });
        try {
          stranger.allow({ statuses: [{ status: 404, method: 'GET', url: /\/api\/v1\/orders\// }] });
          await stranger.page.evaluateOnNewDocument((id: string) => localStorage.setItem('luma_last_order_id', id), orderId);
          await stranger.goto('/');
          await stranger.page.waitForSelector('[data-testid="order-unavailable"]', { timeout: TIMEOUT });
          assert.equal(await text(stranger.page, '[data-testid="order-confirmation"], main h2'), T.orderUnavailableTitle);
          assert.equal(await stranger.page.$('[data-testid="order-confirmation"]'), null);
          stranger.assertClean();
        } finally {
          await stranger.close();
        }
        // no credential at all and a different guest scope both get 404 (A-21): a stranger cannot tell an unknown
        // order from somebody else's.
        const nobody = await new ApiClient(e2eEnv().baseUrl).order(orderId);
        assert.equal(nobody.status, 404);
        const otherGuest = new ApiClient(e2eEnv().baseUrl);
        await otherGuest.guestSession();
        assert.equal((await otherGuest.order(orderId)).status, 404);
      });

      it('requires explicit re-acceptance when the price changes between quote and placement (A-20)', async () => {
        const { product, token } = await createSpecProduct(admin, { price: 300, stock: 10 });
        const variant = product.variants[0];
        await withPage(lang, async (e2e) => {
          e2e.allow({ statuses: [{ status: 409, method: 'POST', url: /\/api\/v1\/orders$/ }] });
          await gotoHome(e2e);
          await openShop(e2e);
          await addProductToCart(e2e, product, token);
          await goToCheckout(e2e);
          await fillCheckout(e2e, VALID_ADDRESS);
          await waitForPlaceOrderEnabled(e2e);

          await admin.setVariantPrice(product.id, variant.id, 340);
          await click(e2e.page, '[data-testid="place-order-btn"]');

          // the stale total is refused, the new total is shown, nothing was ordered or deducted
          const fresh = await anon.quote([{ variantId: variant.id, quantity: 1 }]);
          assert.equal(fresh.subtotal, 340);
          await e2e.page.waitForFunction(
            (expected: string) => document.querySelector('[data-testid="checkout-subtotal"]')?.textContent?.includes(expected),
            { timeout: TIMEOUT },
            egp(340, lang).replace(/\s/g, ' '),
          );
          assert.equal(await money(e2e.page, '[data-testid="checkout-total"] span:last-child'), fresh.total);
          assert.equal(await e2e.page.$('[data-testid="order-confirmation"]'), null, 'must not confirm silently');
          assert.equal(await anon.variantStock(product.id, variant.id), 10);

          // explicit second click accepts the new total
          await submitOrder(e2e);
          await e2e.page.waitForSelector('[data-testid="order-confirmation"]', { timeout: TIMEOUT });
          const own = await apiClientFromPage(e2e);
          const order = (await own.order((await rememberedOrderId(e2e)) ?? '')).data.order;
          assert.equal(order.total, fresh.total);
          assert.equal(order.items[0].unitPrice, 340);
          assert.equal(await anon.variantStock(product.id, variant.id), 9);
        });
      });
    });
  }

  it('replays the same idempotency key as one order (A-17 over HTTP)', async () => {
    const { product } = await createSpecProduct(admin, { price: 300, stock: 4 });
    const items = [{ variantId: product.variants[0].id, quantity: 1 }];
    const client = new ApiClient(e2eEnv().baseUrl);
    await client.guestSession();
    const key = newIdempotencyKey();
    const first = await client.placeOrder(items, VALID_ADDRESS, key);
    const second = await client.placeOrder(items, VALID_ADDRESS, key);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.data.order.id, first.data.order.id);
    assert.equal(second.data.isDuplicate, true);
    assert.equal(await anon.variantStock(product.id, items[0].variantId), 3);
  });
});
