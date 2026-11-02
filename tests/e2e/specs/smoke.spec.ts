import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { ApiClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage } from '../harness/browser.ts';

describe('smoke: published SPA renders the live catalog', () => {
  let browser: Browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    await closeBrowser();
  });

  it('home page shows products that exist in the API', async () => {
    const api = new ApiClient(process.env.E2E_BASE_URL ?? '');
    const featured = await api.products({ sort: 'featured', pageSize: 8 });
    assert.ok(featured.total > 0, 'API reports no published products');

    const e2e = await newPage(browser, { lang: 'en' });
    try {
      await e2e.goto('/');
      await e2e.page.waitForSelector('[data-testid^="product-card-"]', { timeout: 20_000 });
      const ids = await e2e.page.$$eval('[data-testid^="product-card-"]', (nodes) =>
        nodes.map((node) => node.getAttribute('data-testid')?.replace('product-card-', '') ?? ''),
      );
      assert.ok(ids.length > 0);
      for (const id of new Set(ids)) {
        const product = await api.product(id);
        assert.equal(product.id, id, `rendered product ${id} is not in the API catalog`);
      }
      await e2e.screenshot('smoke-home-en');
      e2e.assertOnlyApiTraffic();
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });
});
