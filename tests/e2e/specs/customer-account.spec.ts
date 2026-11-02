import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { ApiClient, adminClient, e2eEnv, registerCustomer, uniqueEmail } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS } from '../harness/i18n.ts';
import { createSpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  VALID_ADDRESS,
  apiClientFromPage,
  click,
  fill,
  gotoHome,
  loginViaUi,
  logoutViaUi,
  navigateTo,
  openAccount,
  openShop,
  openProduct,
  searchShop,
  text,
  wishlistBadge,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];
const PASSWORD_FOR_WRONG_ATTEMPTS = 'Wrong1!password';

/** Retries an API read until it equals the expectation (the UI updates optimistically before the request lands). */
async function eventuallyEqual<T>(read: () => Promise<T>, expected: T, message: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT;
  let last: T = await read();
  while (JSON.stringify(last) !== JSON.stringify(expected)) {
    if (Date.now() > deadline) {
      assert.deepEqual(last, expected, message);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    last = await read();
  }
}

describe('customer account (A-22..A-29)', () => {
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

  async function addAddressViaUi(
    e2e: E2ePage,
    address: { label: string; fullName: string; mobileNumber: string; city: string; streetAddress: string },
    makeDefault: boolean,
  ): Promise<void> {
    await click(e2e.page, '[data-testid="add-address-btn"]');
    await e2e.page.waitForSelector('[data-testid="address-modal"]', { timeout: TIMEOUT });
    await fill(e2e.page, '#address-label', address.label);
    await fill(e2e.page, '#address-fullName', address.fullName);
    await fill(e2e.page, '#address-mobileNumber', address.mobileNumber);
    await e2e.page.select('#address-governorate', 'Giza');
    await fill(e2e.page, '#address-city', address.city);
    await fill(e2e.page, '#address-streetAddress', address.streetAddress);
    if (makeDefault) {
      await click(e2e.page, '#address-isDefault');
    }
    await click(e2e.page, '[data-testid="address-save"]');
    await e2e.page.waitForSelector('[data-testid="address-modal"]', { hidden: true, timeout: TIMEOUT });
  }

  it('locks the account after repeated wrong passwords and answers identically for unknown emails (A-22)', async () => {
    const { email, password } = await registerCustomer('lock');
    const client = new ApiClient(e2eEnv().baseUrl);
    const unknown = await client.request('POST', '/api/v1/auth/login', {
      body: { email: uniqueEmail('nobody'), password: PASSWORD_FOR_WRONG_ATTEMPTS },
    });
    const wrong = await client.request('POST', '/api/v1/auth/login', {
      body: { email, password: PASSWORD_FOR_WRONG_ATTEMPTS },
    });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(
      { ...(wrong.data as Record<string, unknown>), traceId: undefined, instance: undefined },
      { ...(unknown.data as Record<string, unknown>), traceId: undefined, instance: undefined },
      'unknown email must be indistinguishable from a wrong password',
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await client.request('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD_FOR_WRONG_ATTEMPTS } });
    }
    const afterLockout = await client.request('POST', '/api/v1/auth/login', { body: { email, password } });
    assert.notEqual(afterLockout.status, 200, 'the correct password must not work while the account is locked');
  });

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}]`, () => {
      it('registers through the UI, rejects bad logins with one localized message, signs out and back in (A-22, A-23)', async () => {
        const email = uniqueEmail('reg');
        const password = 'Aa1!registered-pw';
        const fullName = lang === 'ar' ? 'منى حسن' : 'Mona Hassan';
        await withPage(lang, async (e2e) => {
          e2e.allow({ statuses: [{ status: 401, method: 'POST', url: /\/api\/v1\/auth\/login$/ }] });
          await gotoHome(e2e);
          await openAccount(e2e);

          // register
          await click(e2e.page, '[data-testid="auth-tab-register"]');
          await fill(e2e.page, '#auth-fullName', fullName);
          await fill(e2e.page, '#auth-mobile', '01012345678');
          await fill(e2e.page, '#auth-email', email);
          await fill(e2e.page, '#auth-password', password);
          await click(e2e.page, '[data-testid="auth-submit"]');
          await e2e.page.waitForSelector('[data-testid="account-name"]', { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, '[data-testid="account-name"]'), fullName);
          assert.equal(await text(e2e.page, '[data-testid="account-email"]'), email);
          assert.ok((await text(e2e.page, '[data-testid="account-name"] + span')).includes(T.roleCustomer));

          const session = await apiClientFromPage(e2e);
          const me = await session.me();
          assert.equal(me.status, 200);
          assert.equal(me.data.user.email, email);
          assert.equal(me.data.user.role, 'customer');

          // sign out (the cookie is really gone), then bad logins
          await logoutViaUi(e2e);
          assert.equal((await (await apiClientFromPage(e2e)).me()).status, 401);

          await fill(e2e.page, '#auth-email', email);
          await fill(e2e.page, '#auth-password', PASSWORD_FOR_WRONG_ATTEMPTS);
          await click(e2e.page, '[data-testid="auth-submit"]');
          await e2e.page.waitForSelector('[data-testid="auth-error"]', { timeout: TIMEOUT });
          const wrongMessage = await text(e2e.page, '[data-testid="auth-error"]');
          assert.equal(wrongMessage, T.loginInvalid);

          await fill(e2e.page, '#auth-email', uniqueEmail('unknown'));
          await click(e2e.page, '[data-testid="auth-submit"]');
          await e2e.page.waitForFunction(
            () => document.querySelectorAll('[data-testid="auth-error"]').length === 1,
            { timeout: TIMEOUT },
          );
          assert.equal(await text(e2e.page, '[data-testid="auth-error"]'), wrongMessage, 'identical for unknown email');
          await e2e.screenshot(`account-login-error-${lang}`);

          // right password
          await fill(e2e.page, '#auth-email', email);
          await fill(e2e.page, '#auth-password', password);
          await click(e2e.page, '[data-testid="auth-submit"]');
          await e2e.page.waitForSelector('[data-testid="account-name"]', { timeout: TIMEOUT });
          assert.equal((await (await apiClientFromPage(e2e)).me()).status, 200);

          // duplicate registration is refused with a localized message
          await logoutViaUi(e2e);
          await click(e2e.page, '[data-testid="auth-tab-register"]');
          await fill(e2e.page, '#auth-fullName', fullName);
          await fill(e2e.page, '#auth-email', email);
          await fill(e2e.page, '#auth-password', password);
          e2e.allow({ statuses: [{ status: 409, method: 'POST', url: /\/api\/v1\/auth\/register$/ }] });
          await click(e2e.page, '[data-testid="auth-submit"]');
          await e2e.page.waitForSelector('[data-testid="auth-error"]', { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, '[data-testid="auth-error"]'), T.emailTaken);
        });
      });

      it('adds, defaults and deletes addresses with a real persisted outcome (A-28)', async () => {
        const { email, password, client } = await registerCustomer('addr', 'Address Tester');
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await loginViaUi(e2e, email, password);
          await click(e2e.page, '[data-testid="tab-addresses"]');
          assert.equal(await text(e2e.page, '[data-testid="addresses-empty"]'), T.noAddresses);

          // client-side validation is localized and sends nothing
          await click(e2e.page, '[data-testid="add-address-btn"]');
          await e2e.page.waitForSelector('[data-testid="address-modal"]', { timeout: TIMEOUT });
          await fill(e2e.page, '#address-city', '');
          await click(e2e.page, '[data-testid="address-save"]');
          await e2e.page.waitForSelector('#address-city-error', { timeout: TIMEOUT });
          assert.equal(await text(e2e.page, '#address-city-error'), T.errors.city);
          assert.equal(await text(e2e.page, '#address-streetAddress-error'), T.errors.streetAddress);
          await e2e.page.keyboard.press('Escape');
          await e2e.page.waitForSelector('[data-testid="address-modal"]', { hidden: true, timeout: TIMEOUT });
          assert.deepEqual(await client.addresses(), []);

          await addAddressViaUi(e2e, { label: 'Home', fullName: 'Address Tester', mobileNumber: '01012345678', city: 'Dokki', streetAddress: 'Street 90, Villa 12' }, true);
          await addAddressViaUi(e2e, { label: 'Work', fullName: 'Address Tester', mobileNumber: '01198765432', city: 'Maadi', streetAddress: '12 Road 9, Floor 3' }, false);

          const saved = await client.addresses();
          assert.equal(saved.length, 2);
          const home = saved.find((entry) => entry.label === 'Home')!;
          const work = saved.find((entry) => entry.label === 'Work')!;
          assert.equal(home.isDefault, true);
          assert.equal(work.isDefault ?? false, false);
          assert.equal(home.governorate, 'Giza');
          assert.equal(home.city, 'Dokki');
          assert.equal(await text(e2e.page, `[data-testid="address-default-${home.id}"]`), T.defaultBadge);
          assert.equal(await e2e.page.$(`[data-testid="address-default-${work.id}"]`), null);
          await e2e.screenshot(`account-addresses-${lang}`);

          await click(e2e.page, `[data-testid="delete-address-${work.id}"]`);
          await e2e.page.waitForSelector(`[data-testid="address-${work.id}"]`, { hidden: true, timeout: TIMEOUT });
          assert.deepEqual((await client.addresses()).map((entry) => entry.id), [home.id]);

          // reload: the account (cookie) and its addresses come back from the server
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await navigateTo(e2e, 'account');
          await click(e2e.page, '[data-testid="tab-addresses"]');
          await e2e.page.waitForSelector(`[data-testid="address-${home.id}"]`, { timeout: TIMEOUT });
        });
      });

      it('toggles the wishlist from the shop and the product modal and lists it (A-29)', async () => {
        const { email, password, client } = await registerCustomer('wish');
        const first = await createSpecProduct(admin, { price: 200, stock: 5 });
        const second = await createSpecProduct(admin, { price: 220, stock: 5 });
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await loginViaUi(e2e, email, password);
          assert.equal(await wishlistBadge(e2e), 0);
          await click(e2e.page, '[data-testid="nav-cat-all"]');
          await e2e.page.waitForSelector('[data-testid="shop-search"]', { timeout: TIMEOUT });

          // heart on the card
          await searchShop(e2e, first.token);
          const heart = `[data-testid="product-card-${first.product.id}"] button[aria-pressed]`;
          await click(e2e.page, heart);
          await e2e.page.waitForFunction((sel: string) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true', { timeout: TIMEOUT }, heart);
          await eventuallyEqual(() => client.wishlist(), [first.product.id], "heart on the card must persist");
          assert.equal(await wishlistBadge(e2e), 1);

          // heart inside the product modal
          await openProduct(e2e, second.product, second.token);
          await click(e2e.page, '[data-testid="modal-wishlist"]');
          await e2e.page.waitForFunction(
            () => document.querySelector('[data-testid="modal-wishlist"]')?.getAttribute('aria-pressed') === 'true',
            { timeout: TIMEOUT },
          );
          await eventuallyEqual(async () => (await client.wishlist()).sort(), [first.product.id, second.product.id].sort(), "heart in the modal must persist");
          await e2e.page.keyboard.press('Escape');

          // wishlist page lists both
          await click(e2e.page, '[data-testid="nav-wishlist"]');
          await e2e.page.waitForSelector(`[data-testid="product-card-${first.product.id}"]`, { timeout: TIMEOUT });
          await e2e.page.waitForSelector(`[data-testid="product-card-${second.product.id}"]`, { timeout: TIMEOUT });
          await e2e.screenshot(`account-wishlist-${lang}`);

          // remove both from the wishlist page
          for (const spec of [first, second]) {
            await click(e2e.page, `[data-testid="product-card-${spec.product.id}"] button[aria-pressed]`);
            await e2e.page.waitForSelector(`[data-testid="product-card-${spec.product.id}"]`, { hidden: true, timeout: TIMEOUT });
          }
          await eventuallyEqual(() => client.wishlist(), [], "removal must persist");
          assert.equal(await text(e2e.page, '[data-testid="wishlist-empty"] h3'), T.wishlistEmptyTitle);
        });
      });

      it('lists orders, expands detail and cancels a Pending order with stock restored exactly once (A-26, A-27)', async () => {
        const { email, password, client } = await registerCustomer('ord', 'Order Tester');
        const spec = await createSpecProduct(admin, { price: 300, stock: 10 });
        const variant = spec.product.variants[0];
        const placed = await client.placeOrder([{ variantId: variant.id, quantity: 2 }], VALID_ADDRESS);
        assert.equal(placed.status, 201);
        const orderId = placed.data.order.id;
        assert.equal(await anon.variantStock(spec.product.id, variant.id), 8);
        // another customer's order must never show up
        const other = await registerCustomer('ord-other');
        const foreign = await other.client.placeOrder([{ variantId: variant.id, quantity: 1 }], VALID_ADDRESS);
        assert.equal(foreign.status, 201);

        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await loginViaUi(e2e, email, password);
          await e2e.page.waitForSelector(`[data-testid="order-${orderId}"]`, { timeout: TIMEOUT });
          assert.equal(await e2e.page.$(`[data-testid="order-${foreign.data.order.id}"]`), null);
          assert.equal(await text(e2e.page, `[data-testid="order-status-${orderId}"]`), T.statusPending);

          await click(e2e.page, `[data-testid="order-${orderId}"] > button`);
          assert.ok((await text(e2e.page, `[data-testid="order-${orderId}"]`)).includes(VALID_ADDRESS.streetAddress));
          await e2e.screenshot(`account-order-detail-${lang}`);

          await click(e2e.page, `[data-testid="cancel-order-${orderId}"]`);
          await e2e.page.waitForFunction(
            (id: string, label: string) => document.querySelector(`[data-testid="order-status-${id}"]`)?.textContent === label,
            { timeout: TIMEOUT },
            orderId,
            T.statusCancelled,
          );
          assert.equal(await e2e.page.$(`[data-testid="cancel-order-${orderId}"]`), null, 'no cancel control on a cancelled order');

          const read = await client.order(orderId);
          assert.equal(read.data.order.status, 'Cancelled');
          assert.equal(await anon.variantStock(spec.product.id, variant.id), 9, 'only this order (2) is restored; the other customer still holds 1');
          // cancelling again restores nothing more
          const again = await client.request('POST', `/api/v1/orders/${orderId}/cancel`);
          assert.equal(again.status, 409);
          assert.equal(await anon.variantStock(spec.product.id, variant.id), 9);
        });
      });

      it('signs out and the session is really gone (A-24)', async () => {
        const { email, password } = await registerCustomer('out');
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await loginViaUi(e2e, email, password);
          const session = await apiClientFromPage(e2e);
          assert.equal((await session.me()).status, 200);
          const adminAttempt = await session.get('/api/v1/admin/metrics');
          assert.equal(adminAttempt.status, 403, 'a customer must not reach admin APIs');
          await logoutViaUi(e2e);
          assert.equal((await (await apiClientFromPage(e2e)).me()).status, 401);
          await e2e.page.reload({ waitUntil: 'domcontentloaded' });
          await navigateTo(e2e, 'account');
          await e2e.page.waitForSelector('[data-testid="auth-form"]', { timeout: TIMEOUT });
        });
      });
    });
  }

  it('is reachable by a shopper who only browses (no hidden admin entry for customers)', async () => {
    const { email, password } = await registerCustomer('noadmin');
    await withPage('en', async (e2e) => {
      await gotoHome(e2e);
      await loginViaUi(e2e, email, password);
      const adminLabels = await e2e.page.$$eval('button, a', (nodes) =>
        nodes.map((n) => n.textContent ?? '').filter((label) => /admin/i.test(label) && !/Signed in/.test(label)),
      );
      assert.deepEqual(adminLabels, []);
    });
  });

  it('keeps shop navigation working for a signed-in customer', async () => {
    const { email, password } = await registerCustomer('nav');
    await withPage('en', async (e2e) => {
      await gotoHome(e2e);
      await loginViaUi(e2e, email, password);
      await openShop(e2e);
    });
  });
});
