import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { DeliverySettings } from '../../../src/api/types';
import { ApiClient, adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage } from '../harness/browser.ts';
import { navigateTo } from '../harness/ui.ts';
import {
  adminPage,
  clickText,
  createTestProduct,
  fill,
  openTab,
  placeCustomerOrder,
  setOrderStatus,
  signInBrowser,
  waitForText,
  waitForToast,
} from './admin-helpers.ts';

async function settingsOf(api: ApiClient, path: string): Promise<DeliverySettings> {
  const result = await api.get<{ settings: DeliverySettings }>(path);
  assert.equal(result.status, 200, `${path} -> ${result.status}`);
  return result.data.settings;
}

describe('delivery settings and order progress', () => {
  let browser: Browser;
  let admin: ApiClient;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
  });

  after(async () => {
    await closeBrowser();
  });

  it('[en] delivery fees persist, apply to quotes, update the storefront banner and validate', async () => {
    const before = await settingsOf(admin, '/api/v1/admin/settings/delivery');
    assert.equal(before.deliveryFee, 50);
    assert.equal(before.freeShippingThreshold, 600);

    const updated = await admin.request<{ settings: DeliverySettings }>(
      'PUT',
      '/api/v1/admin/settings/delivery',
      { body: { deliveryFee: 125, freeShippingThreshold: 400 } },
    );
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.settings.deliveryFee, 125);
    assert.equal(updated.data.settings.freeShippingThreshold, 400);

    const publicSettings = await settingsOf(admin, '/api/v1/settings/delivery');
    assert.equal(publicSettings.deliveryFee, 125);
    assert.equal(publicSettings.freeShippingThreshold, 400);

    const fixture = await createTestProduct(admin, { stock: 20, price: 100 });
    const small = await admin.quote([{ variantId: fixture.variant.id, quantity: 1 }]);
    assert.equal(small.subtotal, 100);
    assert.equal(small.deliveryFee, 125);
    assert.equal(small.total, 225);

    const large = await admin.quote([{ variantId: fixture.variant.id, quantity: 4 }]);
    assert.equal(large.subtotal, 400);
    assert.equal(large.deliveryFee, 0);
    assert.equal(large.total, 400);

    const negative = await admin.request('PUT', '/api/v1/admin/settings/delivery', {
      body: { deliveryFee: -1, freeShippingThreshold: 400 },
    });
    assert.equal(negative.status, 400);

    const { e2e } = await adminPage(browser, 'en');
    try {
      await openTab(e2e, 'delivery');
      await e2e.page.waitForSelector('[role="dialog"], [data-panel="delivery"] form[data-form="delivery"]');
      await fill(e2e.page, 'Standard delivery fee (EGP) *', '75');
      await fill(e2e.page, 'Free delivery threshold (EGP) *', '250');
      await clickText(e2e.page, '[data-panel="delivery"] form[data-form="delivery"] button', 'Save delivery fees');
      await waitForToast(e2e.page, 'Delivery fees saved.');
      assert.equal((await settingsOf(admin, '/api/v1/admin/settings/delivery')).deliveryFee, 75);

      await e2e.goto('/');
      await waitForText(e2e.page, 'header', (text) => text.includes('250 EGP'), 15_000);
      e2e.assertClean();
    } finally {
      await e2e.close();
      await admin.request('PUT', '/api/v1/admin/settings/delivery', {
        body: { deliveryFee: 50, freeShippingThreshold: 600 },
      });
    }
  });

  it('[en] the customer order card shows every fulfilment step and where the order stands', async () => {
    const fixture = await createTestProduct(admin, { stock: 10, price: 100 });
    const { order, customer } = await placeCustomerOrder(fixture.variant.id, 1);
    assert.equal((await setOrderStatus(admin, order.id, 'Confirmed')).status, 200);
    assert.equal((await setOrderStatus(admin, order.id, 'Shipped')).status, 200);
    assert.equal((await setOrderStatus(admin, order.id, 'OutForDelivery')).status, 200);

    const shopper = await newPage(browser, { lang: 'en' });
    try {
      await signInBrowser(shopper, customer.client);
      await shopper.goto('/');
      await navigateTo(shopper, 'account');
      const progress = await shopper.page.waitForSelector(`[data-testid="order-progress-${order.id}"]`, {
        timeout: 20_000,
      });
      assert.equal(await progress.evaluate((node) => node.getAttribute('data-order-progress')), 'OutForDelivery');
      const text = await progress.evaluate((node) => node.textContent ?? '');
      for (const label of ['Pending', 'Confirmed', 'Shipped', 'Out for delivery', 'Delivered']) {
        assert.ok(text.includes(label), `progress shows ${label}: ${text}`);
      }
      shopper.assertClean();
    } finally {
      await shopper.close();
    }
  });
});
