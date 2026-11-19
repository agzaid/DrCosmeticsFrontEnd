/**
 * The server-rendered administration area (/admin) in a real browser: the sign-in form, the dashboard against the
 * API's own figures, the sign-in refusal, and sign-out. The area answers in English only; the storefront's language
 * setting does not apply to it.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { adminClient, e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage } from '../harness/browser.ts';

/** "1,234.50 EGP" -> 1234.5 */
function parseMoney(text: string): number {
  return Number(text.replace(/[^0-9.-]/g, ''));
}

describe('administration area', () => {
  let browser: Browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    await closeBrowser();
  });

  it('refuses a wrong password on the sign-in page and keeps the visitor out', async () => {
    const env = e2eEnv();
    const e2e = await newPage(browser, { lang: 'en' });
    try {
      await e2e.goto('/admin');
      await e2e.page.waitForSelector('#Email');
      await e2e.page.type('#Email', env.adminEmail);
      await e2e.page.type('#Password', 'definitely-not-the-password');
      await Promise.all([e2e.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), e2e.page.click('button[type="submit"]')]);

      assert.equal(new URL(e2e.page.url()).pathname, '/admin/account/login');
      const message = await e2e.page.$eval('.validation-summary-errors', (node) => (node.textContent ?? '').trim());
      assert.match(message, /Invalid email or password/);
      assert.equal(await e2e.page.$$eval('[data-metric]', (nodes) => nodes.length), 0);

      await e2e.goto('/admin');
      assert.equal(new URL(e2e.page.url()).pathname, '/admin/account/login', 'still not signed in');
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });

  it('an administrator signs in, sees the same figures as the API, and signs out', async () => {
    const env = e2eEnv();
    const api = await adminClient();
    const metrics = (await api.get<{ metrics: { totalSales: number; totalOrders: number; totalProducts: number } }>('/api/v1/admin/metrics'))
      .data.metrics;

    const e2e = await newPage(browser, { lang: 'en' });
    try {
      await e2e.goto('/admin');
      await e2e.page.waitForSelector('#Email');
      await e2e.page.type('#Email', env.adminEmail);
      await e2e.page.type('#Password', env.adminPassword);
      await Promise.all([e2e.page.waitForNavigation({ waitUntil: 'domcontentloaded' }), e2e.page.click('button[type="submit"]')]);

      // Signing in from the page the visitor was sent from lands back on it.
      assert.equal(new URL(e2e.page.url()).pathname, '/admin');
      await e2e.page.waitForSelector('[data-metric="total-sales"]');
      const read = (name: string) => e2e.page.$eval(`[data-metric="${name}"] .metric-value`, (node) => (node.textContent ?? '').trim());
      assert.equal(parseMoney(await read('total-sales')), metrics.totalSales);
      assert.equal(Number(await read('orders')), metrics.totalOrders);
      assert.equal(Number(await read('products')), metrics.totalProducts);
      await e2e.screenshot('admin-area-dashboard');

      // The same browser session is an administrator for the JSON API too.
      const status = await e2e.page.evaluate(async () => (await fetch('/api/v1/admin/metrics', { credentials: 'include' })).status);
      assert.equal(status, 200);

      await e2e.page.click('.admin-user');
      await e2e.page.waitForSelector('.dropdown-menu.show');
      await Promise.all([
        e2e.page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        e2e.page.click('form[action$="/admin/account/logout"] button[type="submit"]'),
      ]);
      assert.equal(new URL(e2e.page.url()).pathname, '/admin/account/login');
      assert.match(await e2e.page.$eval('.alert', (node) => (node.textContent ?? '').trim()), /signed out/);

      await e2e.goto('/admin');
      assert.equal(new URL(e2e.page.url()).pathname, '/admin/account/login', 'the session ended');
      e2e.allow({ statuses: [{ status: 401, method: 'GET', url: /\/api\/v1\/admin\/metrics$/ }] });
      const after = await e2e.page.evaluate(async () => (await fetch('/api/v1/admin/metrics', { credentials: 'include' })).status);
      assert.equal(after, 401, 'signing out in the area ends the API session as well');
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });
});
