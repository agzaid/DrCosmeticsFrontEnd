/**
 * Every admin list shows ten rows at a time instead of growing into one endless scroll. Products, orders and the price
 * scraper are paged by the server; coupons arrive whole and are paged in the browser. The page bar keeps the ends one
 * click away, and the last page holds only the rows that are left.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { DiscountRecord, PagedOrders, PagedScraperRows } from '../../../src/api/types';
import { ApiClient, adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, type E2ePage } from '../harness/browser.ts';
import { LANGS, adminPage, createTestProduct, openTab, placeCustomerOrder, token } from './admin-helpers.ts';

const PAGE = 10;

async function values(e2e: E2ePage, panel: string, attribute: string): Promise<string[]> {
  return e2e.page.$$eval(
    `[data-panel="${panel}"] [${attribute}]`,
    (rows, name) => rows.map((row) => row.getAttribute(name) ?? ''),
    attribute,
  );
}

async function waitForRows(e2e: E2ePage, selector: string, expected: number): Promise<void> {
  await e2e.page.waitForFunction(
    (target: string, count: number) => document.querySelectorAll(target).length === count,
    { timeout: 15_000 },
    selector,
    expected,
  );
}

/** Waits for a reload: the row that opened the page is gone. */
async function waitForReplaced(e2e: E2ePage, selector: string, attribute: string, previous: string): Promise<void> {
  await e2e.page.waitForFunction(
    (target: string, name: string, gone: string) =>
      !Array.from(document.querySelectorAll(target)).some((row) => row.getAttribute(name) === gone),
    { timeout: 15_000 },
    selector,
    attribute,
    previous,
  );
}

describe('admin pagination', () => {
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
    it(`[${lang}] the products table pages at 10 rows and the last page holds only the rest`, async () => {
      const total = (await admin.adminProducts('status=all&pageSize=1')).total;
      assert.ok(total > PAGE, `the catalogue needs more than one page (${total})`);
      const last = Math.ceil(total / PAGE);
      const { e2e } = await adminPage(browser, lang);
      const rows = '[data-panel="products"] [data-product-id]';
      const bar = '[data-pagination="products"]';
      try {
        await openTab(e2e, 'products');
        await waitForRows(e2e, rows, PAGE);
        const firstPage = await values(e2e, 'products', 'data-product-id');
        assert.equal(
          await e2e.page.$eval(`${bar} [data-page="1"]`, (button) => button.getAttribute('aria-current')),
          'page',
          'the first page is marked as the current one',
        );

        // Page 2 is one click away and repeats nothing from page 1.
        await e2e.page.click(`${bar} [data-page="2"]`);
        await waitForReplaced(e2e, rows, 'data-product-id', firstPage[0]);
        await waitForRows(e2e, rows, Math.min(PAGE, total - PAGE));
        const secondPage = await values(e2e, 'products', 'data-product-id');
        assert.equal(secondPage.some((id) => firstPage.includes(id)), false, 'page 2 repeats a product from page 1');

        if (last > 2) {
          // The last page number jumps straight to the end and shows the leftover rows, not a full page.
          await e2e.page.click(`${bar} [data-page="${last}"]`);
          await waitForReplaced(e2e, rows, 'data-product-id', secondPage[0]);
          await waitForRows(e2e, rows, total - PAGE * (last - 1));
        } else {
          await e2e.page.click(`${bar} [data-step="previous"]`);
          await waitForReplaced(e2e, rows, 'data-product-id', secondPage[0]);
          await waitForRows(e2e, rows, PAGE);
        }

        // Paging scrolls the list back into view instead of leaving the reader at the old page's end.
        assert.equal(await e2e.page.evaluate(() => window.scrollY), 0);
      } finally {
        await e2e.close();
      }
    });
  }

  it('[en] orders are read one page at a time and page 2 holds only the rest', async () => {
    const fixture = await createTestProduct(admin, { stock: 80 });
    const current = (await admin.get<PagedOrders>('/api/v1/admin/orders?status=all&pageSize=1')).data.total;
    // Make sure a second page exists whatever the earlier specs left behind.
    for (let count = current; count <= PAGE; count += 1) {
      await placeCustomerOrder(fixture.variant.id, 1);
    }
    const total = (await admin.get<PagedOrders>('/api/v1/admin/orders?status=all&pageSize=1')).data.total;
    assert.ok(total > PAGE, `the order list needs more than one page (${total})`);

    const { e2e } = await adminPage(browser, 'en');
    const rows = '[data-panel="orders"] [data-order]';
    const bar = '[data-pagination="orders"]';
    try {
      await openTab(e2e, 'orders');
      await waitForRows(e2e, rows, PAGE);
      const firstPage = await values(e2e, 'orders', 'data-order');

      await e2e.page.click(`${bar} [data-page="2"]`);
      await waitForReplaced(e2e, rows, 'data-order', firstPage[0]);
      await waitForRows(e2e, rows, Math.min(PAGE, total - PAGE));
      const secondPage = await values(e2e, 'orders', 'data-order');
      assert.equal(secondPage.some((order) => firstPage.includes(order)), false, 'page 2 repeats no order');
    } finally {
      await e2e.close();
    }
  });

  it('[en] the scraper pages at the same 10 rows as every other list', async () => {
    const total = (await admin.get<PagedScraperRows>('/api/v1/admin/scraper?pageSize=1')).data.total;
    assert.ok(total > PAGE, `the scraper lists more than one page (${total})`);

    const { e2e } = await adminPage(browser, 'en');
    const rows = '[data-panel="scraper"] [data-scraper-row]';
    const bar = '[data-pagination="scraper"]';
    try {
      await openTab(e2e, 'scraper');
      await waitForRows(e2e, rows, PAGE);
      assert.equal(await e2e.page.$(`${bar} [data-field="page-size"]`), null, 'there is no larger page to choose');

      const firstPage = await values(e2e, 'scraper', 'data-scraper-row');
      await e2e.page.click(`${bar} [data-page="2"]`);
      await waitForReplaced(e2e, rows, 'data-scraper-row', firstPage[0]);
      await waitForRows(e2e, rows, Math.min(PAGE, total - PAGE));
    } finally {
      await e2e.close();
    }
  });

  it('[en] coupons are paged in the browser and the last page holds the rest', async () => {
    const existing = (await admin.get<{ discounts: DiscountRecord[] }>('/api/v1/admin/discounts')).data.discounts;
    const expiry = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
    let created = 0;
    while (existing.length + created <= PAGE) {
      await admin.createDiscount({
        code: token('PGG'),
        type: 'fixed',
        value: 5,
        minOrderAmount: 0,
        maxDiscount: null,
        expiryDate: expiry,
        usageLimit: 0,
        active: true,
      });
      created += 1;
    }
    const total = existing.length + created;
    assert.ok(total > PAGE, `the coupon list needs more than one page (${total})`);

    const { e2e } = await adminPage(browser, 'en');
    const cards = '[data-panel="discounts"] [data-coupon]';
    const bar = '[data-pagination="discounts"]';
    try {
      await openTab(e2e, 'discounts');
      await waitForRows(e2e, cards, PAGE);
      const firstPage = await values(e2e, 'discounts', 'data-coupon');
      assert.ok(
        (await e2e.page.$eval(`${bar} [data-field="discounts-range"]`, (range) => range.textContent ?? '')).includes(
          `Showing 1–10 of ${total} coupons`,
        ),
        'the bar says which rows are on screen',
      );

      await e2e.page.click(`${bar} [data-step="next"]`);
      await waitForReplaced(e2e, cards, 'data-coupon', firstPage[0]);
      await waitForRows(e2e, cards, Math.min(PAGE, total - PAGE));
      assert.equal((await values(e2e, 'discounts', 'data-coupon')).some((code) => firstPage.includes(code)), false);

      await e2e.page.click(`${bar} [data-step="previous"]`);
      await waitForRows(e2e, cards, PAGE);
    } finally {
      await e2e.close();
    }
  });
});
