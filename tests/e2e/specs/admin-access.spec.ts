/**
 * (a) Admin access control in the browser: anonymous and customer sessions get no admin entry points and no admin
 * data; an administrator signs in and out through the real login form.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'puppeteer-core';
import { ApiClient, e2eEnv, registerCustomer } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage } from '../harness/browser.ts';
import { COPY, LANGS, openAdmin, signInBrowser } from './admin-helpers.ts';

const ADMIN_PATHS = ['/api/v1/admin/metrics', '/api/v1/admin/orders?status=all', '/api/v1/admin/products?status=all', '/api/v1/admin/discounts', '/api/v1/admin/banners'];

async function adminEntryPointCount(page: Page, lang: 'en' | 'ar'): Promise<number> {
  return page.evaluate(
    (entry: string, title: string) =>
      Array.from(document.querySelectorAll('button')).filter((button) => {
        const text = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
        return text === entry || text === title;
      }).length,
    COPY.adminEntry[lang],
    COPY.adminTitle[lang],
  );
}

async function waitForStorefront(e2e: E2ePage): Promise<void> {
  await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: 20_000 });
}

function assertNoAdminTraffic(e2e: E2ePage): void {
  const adminCalls = e2e.requests.filter((request) => request.url.includes('/api/v1/admin/'));
  assert.deepEqual(adminCalls, [], 'the storefront must not call admin endpoints for non-admin sessions');
}

async function openAccountMenu(page: Page): Promise<void> {
  await page.click('[data-testid="nav-account"]');
  await page.waitForSelector('[data-testid="nav-account"] + div button');
}

describe('admin access control', () => {
  let browser: Browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    await closeBrowser();
  });

  it('admin API rejects anonymous callers with 401 and customers with 403', async () => {
    const { baseUrl } = e2eEnv();
    const anonymous = new ApiClient(baseUrl);
    const customer = await registerCustomer('acc');
    for (const path of ADMIN_PATHS) {
      assert.equal((await anonymous.get(path)).status, 401, `anonymous GET ${path}`);
      assert.equal((await customer.client.get(path)).status, 403, `customer GET ${path}`);
    }
    const write = await customer.client.request('POST', '/api/v1/admin/inventory/adjust', {
      body: { productId: 'x', variantId: 'y', delta: 1, reason: 'no' },
    });
    assert.equal(write.status, 403, 'customer admin write');
  });

  for (const lang of LANGS) {
    it(`[${lang}] anonymous visitor: no admin entry points, /admin deep link shows no admin data`, async () => {
      const e2e = await newPage(browser, { lang });
      try {
        await e2e.goto('/');
        await waitForStorefront(e2e);
        assert.equal(await adminEntryPointCount(e2e.page, lang), 0, 'admin entry point rendered for an anonymous visitor');

        await openAccountMenu(e2e.page);
        assert.equal(await adminEntryPointCount(e2e.page, lang), 0, 'admin entry in the anonymous account menu');

        await e2e.goto('/admin');
        await waitForStorefront(e2e);
        assert.equal(await e2e.page.$$eval('[data-tab],[data-panel]', (nodes) => nodes.length), 0, 'admin UI visible at /admin');
        assert.equal(await adminEntryPointCount(e2e.page, lang), 0);
        assertNoAdminTraffic(e2e);
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] customer session: no admin entry points anywhere, no admin requests`, async () => {
      const customer = await registerCustomer('cust');
      const e2e = await newPage(browser, { lang });
      try {
        await signInBrowser(e2e, customer.client);
        await e2e.goto('/');
        await waitForStorefront(e2e);
        await e2e.page.waitForFunction(() => document.querySelector('header')?.textContent?.includes('E2E') ?? false, { timeout: 15_000 });
        assert.equal(await adminEntryPointCount(e2e.page, lang), 0, 'admin entry visible to a customer');

        await openAccountMenu(e2e.page);
        // The signed-in menu shows the account and logout actions only.
        assert.equal(await adminEntryPointCount(e2e.page, lang), 0, 'admin entry in the customer account menu');
        const menuButtons = await e2e.page.$$eval('[data-testid="nav-account"] + div button', (nodes) => nodes.length);
        assert.equal(menuButtons, 2, 'customer menu = account + logout');

        await e2e.goto('/admin');
        await waitForStorefront(e2e);
        assert.equal(await e2e.page.$$eval('[data-tab],[data-panel]', (nodes) => nodes.length), 0);
        assertNoAdminTraffic(e2e);
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] administrator signs in through the form, reaches the console, signs out and loses access`, async () => {
      const env = e2eEnv();
      const e2e = await newPage(browser, { lang });
      try {
        await e2e.goto('/');
        await waitForStorefront(e2e);
        await openAccountMenu(e2e.page);
        await e2e.page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="nav-account"] + div button')?.click());
        await e2e.page.waitForSelector('input[type="email"]');
        await e2e.page.type('input[type="email"]', env.adminEmail);
        await e2e.page.type('input[type="password"]', env.adminPassword);
        await e2e.page.keyboard.press('Enter');

        await e2e.page.waitForFunction(
          (entry: string) => Array.from(document.querySelectorAll('header button')).some((b) => (b.textContent ?? '').trim() === entry),
          { timeout: 15_000 },
          COPY.adminEntry[lang],
        );
        await openAdmin(e2e);
        await e2e.page.waitForSelector('[data-metric="totalSales"]', { timeout: 15_000 });
        assert.equal(await e2e.page.$eval('html', (html) => html.dir), lang === 'ar' ? 'rtl' : 'ltr');
        await e2e.screenshot(`admin-access-signed-in-${lang}`);

        await openAccountMenu(e2e.page);
        await e2e.page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="nav-account"] + div button'));
          buttons[buttons.length - 1]?.click();
        });
        await e2e.page.waitForFunction(
          (entry: string) => !Array.from(document.querySelectorAll('header button')).some((b) => (b.textContent ?? '').trim() === entry),
          { timeout: 15_000 },
          COPY.adminEntry[lang],
        );
        // Still on the admin view after sign-out: no admin dataset may remain on screen.
        assert.equal(await e2e.page.$$eval('[data-tab],[data-panel],[data-metric]', (nodes) => nodes.length), 0, 'admin UI survived sign-out');

        e2e.allow({ statuses: [{ status: 401, url: /\/api\/v1\/admin\/metrics$/ }] });
        const status = await e2e.page.evaluate(async () => (await fetch('/api/v1/admin/metrics', { credentials: 'include' })).status);
        assert.equal(status, 401, 'the browser session must not reach admin data after sign-out');
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }
});
