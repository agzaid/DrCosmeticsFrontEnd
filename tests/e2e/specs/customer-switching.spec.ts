import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { ApiClient, adminClient, registerCustomer } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
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
  text,
  wishlistBadge,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];

interface Seeded {
  email: string;
  password: string;
  client: ApiClient;
  fullName: string;
  street: string;
  orderId: string;
  orderNumber: string;
  wishlistProductId: string;
  wishlistToken: string;
}

describe('account switching in one tab (A-25)', () => {
  let browser: Browser;
  let admin: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
  });

  after(async () => {
    await closeBrowser();
  });

  async function seedCustomer(name: string): Promise<Seeded> {
    const { email, password, client } = await registerCustomer(name.toLowerCase(), `${name} Switch`);
    const street = `${name} Street 77, Block 5`;
    const added = await client.request('POST', '/api/v1/customer/addresses', {
      body: {
        label: `${name}Home`,
        fullName: `${name} Switch`,
        mobileNumber: '01012345678',
        governorate: 'Cairo',
        city: `${name}City`,
        streetAddress: street,
        isDefault: true,
      },
    });
    assert.equal(added.status, 201, JSON.stringify(added.data));
    const spec = await createSpecProduct(admin, { price: 200, stock: 20 });
    const wish = await client.request('PUT', `/api/v1/customer/wishlist/${spec.product.id}`);
    assert.equal(wish.status, 204);
    const orderProduct = await createSpecProduct(admin, { price: 210, stock: 20 });
    const order = await client.placeOrder([{ variantId: orderProduct.product.variants[0].id, quantity: 1 }], VALID_ADDRESS);
    assert.equal(order.status, 201);
    return {
      email,
      password,
      client,
      fullName: `${name} Switch`,
      street,
      orderId: order.data.order.id,
      orderNumber: order.data.order.orderNumber,
      wishlistProductId: spec.product.id,
      wishlistToken: spec.token,
    };
  }

  for (const lang of LANGS) {
    it(`[${lang}] user B never sees user A's orders, addresses or wishlist and gets a fresh CSRF token`, async () => {
      const a = await seedCustomer('Alice');
      const b = await seedCustomer('Bob');
      const e2e: E2ePage = await newPage(browser, { lang });
      try {
        await gotoHome(e2e);

        // --- A signs in and sees A's data
        await loginViaUi(e2e, a.email, a.password);
        assert.equal(await text(e2e.page, '[data-testid="account-name"]'), a.fullName);
        await e2e.page.waitForSelector(`[data-testid="order-${a.orderId}"]`, { timeout: TIMEOUT });
        await click(e2e.page, '[data-testid="tab-addresses"]');
        assert.ok((await text(e2e.page, '[data-testid="tab-addresses"] + *, body')).length > 0);
        await e2e.page.waitForFunction((street: string) => document.body.textContent?.includes(street), { timeout: TIMEOUT }, a.street);
        await e2e.page.waitForFunction(() => Number(document.querySelector('[data-testid="nav-wishlist"] span')?.textContent) === 1, { timeout: TIMEOUT });
        assert.equal(await wishlistBadge(e2e), 1);
        await click(e2e.page, '[data-testid="nav-wishlist"]');
        await e2e.page.waitForSelector(`[data-testid="product-card-${a.wishlistProductId}"]`, { timeout: TIMEOUT });

        // --- A signs out: every per-user cache is dropped immediately
        await navigateTo(e2e, 'account');
        await click(e2e.page, '[data-testid="tab-orders"]');
        await logoutViaUi(e2e);
        await e2e.page.waitForFunction(() => !document.querySelector('[data-testid="nav-wishlist"] span'), { timeout: TIMEOUT });
        assert.equal(await wishlistBadge(e2e), 0);
        assert.equal(await e2e.page.evaluate(() => localStorage.getItem('luma_beauty_wishlist')), '[]');
        const bodyAfterLogout = (await e2e.page.evaluate(() => document.body.textContent)) ?? '';
        assert.ok(!bodyAfterLogout.includes(a.orderNumber) && !bodyAfterLogout.includes(a.street), 'A data still rendered after sign-out');
        const csrfBeforeB = e2e.requests.filter((r) => r.url.endsWith('/api/v1/auth/csrf')).length;

        // --- B signs in, same tab, no reload
        await fill(e2e.page, '#auth-email', b.email);
        await fill(e2e.page, '#auth-password', b.password);
        await click(e2e.page, '[data-testid="auth-submit"]');
        await e2e.page.waitForSelector('[data-testid="account-name"]', { timeout: TIMEOUT });
        assert.equal(await text(e2e.page, '[data-testid="account-name"]'), b.fullName);
        const me = await (await apiClientFromPage(e2e)).me();
        assert.equal(me.data.user.email, b.email);

        await e2e.page.waitForSelector(`[data-testid="order-${b.orderId}"]`, { timeout: TIMEOUT });
        assert.equal(await e2e.page.$(`[data-testid="order-${a.orderId}"]`), null, "A's order leaked into B's list");

        await click(e2e.page, '[data-testid="tab-addresses"]');
        await e2e.page.waitForFunction((street: string) => document.body.textContent?.includes(street), { timeout: TIMEOUT }, b.street);
        const bodyAsB = (await e2e.page.evaluate(() => document.body.textContent)) ?? '';
        assert.ok(!bodyAsB.includes(a.street), "A's address leaked into B's list");
        assert.ok(!bodyAsB.includes(a.orderNumber));

        await e2e.page.waitForFunction(() => Number(document.querySelector('[data-testid="nav-wishlist"] span')?.textContent) === 1, { timeout: TIMEOUT });
        await click(e2e.page, '[data-testid="nav-wishlist"]');
        await e2e.page.waitForSelector(`[data-testid="product-card-${b.wishlistProductId}"]`, { timeout: TIMEOUT });
        assert.equal(await e2e.page.$(`[data-testid="product-card-${a.wishlistProductId}"]`), null, "A's wishlist leaked");
        assert.deepEqual(await b.client.wishlist(), [b.wishlistProductId]);

        // B's add-address form must not be prefilled with A's name, and a state-changing call must work with a fresh token
        await navigateTo(e2e, 'account');
        await click(e2e.page, '[data-testid="tab-addresses"]');
        await click(e2e.page, '[data-testid="add-address-btn"]');
        await e2e.page.waitForSelector('[data-testid="address-modal"]', { timeout: TIMEOUT });
        assert.equal(await e2e.page.$eval('#address-fullName', (n) => (n as HTMLInputElement).value), b.fullName);
        await fill(e2e.page, '#address-label', 'Second');
        await fill(e2e.page, '#address-mobileNumber', '01012345678');
        await fill(e2e.page, '#address-city', 'Maadi');
        await fill(e2e.page, '#address-streetAddress', '45 Road 9, Maadi');
        await click(e2e.page, '[data-testid="address-save"]');
        await e2e.page.waitForSelector('[data-testid="address-modal"]', { hidden: true, timeout: TIMEOUT });

        const csrfAfterB = e2e.requests.filter((r) => r.url.endsWith('/api/v1/auth/csrf')).length;
        assert.ok(csrfAfterB > csrfBeforeB, 'a fresh CSRF token must be fetched after the account change');
        assert.equal((await b.client.addresses()).length, 2);

        // Signing out ends every session of the account, not only this tab's: A's separate API session (a copy of
        // the same credential kind) is dead, and a fresh sign-in shows that B's write did not touch A.
        await assert.rejects(a.client.addresses(), /401/, "A's other session must not survive A's sign-out");
        await a.client.login(a.email, a.password);
        assert.equal((await a.client.addresses()).length, 1, "B's write must not touch A");
        await e2e.screenshot(`switching-${lang}`);

        e2e.assertOnlyApiTraffic();
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }
});
