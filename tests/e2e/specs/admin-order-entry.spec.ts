/**
 * The new-order page (/admin/orders/new) in a real browser, under the same Content-Security-Policy as production:
 * the item search, the figures the server answers with while the order is being put together, the customer search,
 * and the confirmation before the order is placed. What counts as proof is what the API reports afterwards: the order
 * with the server's prices, its customer, and the stock that was taken.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import { adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage } from '../harness/browser.ts';
import { ADDRESS, adminOrder, adminProduct, createTestProduct, placeCustomerOrder, signInBrowser } from './admin-helpers.ts';

const text = (e2e: E2ePage, selector: string) => e2e.page.$eval(selector, (node) => (node.textContent ?? '').trim());

const value = (e2e: E2ePage, selector: string) => e2e.page.$eval(selector, (node) => (node as HTMLInputElement).value);

async function waitForTotal(e2e: E2ePage, name: string, expected: string): Promise<void> {
  await e2e.page.waitForFunction(
    (selector: string, wanted: string) => (document.querySelector(selector)?.textContent ?? '').trim() === wanted,
    { timeout: 10_000 },
    `[data-total="${name}"]`,
    expected,
  );
}

/** Finds the product by its SKU in the item search and adds it; returns the selector of its row. */
async function addItem(e2e: E2ePage, sku: string, variantId: string): Promise<string> {
  await e2e.page.type('[data-variant-search]', sku);
  const result = `[data-variant-results] button[data-variant-id="${variantId}"]`;
  await e2e.page.waitForSelector(result);
  await e2e.page.click(result);

  const row = `[data-lines] [data-line][data-variant-id="${variantId}"]`;
  await e2e.page.waitForSelector(row);
  return row;
}

async function setQuantity(e2e: E2ePage, row: string, quantity: string): Promise<void> {
  const field = `${row} [data-line-qty]`;
  await e2e.page.focus(field);
  await e2e.page.keyboard.down('Control');
  await e2e.page.keyboard.press('KeyA');
  await e2e.page.keyboard.up('Control');
  await e2e.page.keyboard.type(quantity);
}

async function typeInto(e2e: E2ePage, selector: string, content: string): Promise<void> {
  await e2e.page.$eval(selector, (node) => {
    (node as HTMLInputElement).value = '';
  });
  await e2e.page.type(selector, content);
}

async function fillDelivery(e2e: E2ePage, options: { keepName?: boolean } = {}): Promise<void> {
  if (!options.keepName) {
    await typeInto(e2e, '#FullName', ADDRESS.fullName);
  }
  await typeInto(e2e, '#MobileNumber', ADDRESS.mobileNumber);
  await e2e.page.select('#Governorate', ADDRESS.governorate);
  await typeInto(e2e, '#City', ADDRESS.city);
  await typeInto(e2e, '#StreetAddress', ADDRESS.streetAddress);
}

/** Presses "Place order", confirms in the dialog, and returns the number of the order the page opens. */
async function placeOrder(e2e: E2ePage): Promise<string> {
  await e2e.page.click('[data-place]');
  await e2e.page.waitForFunction(() => {
    const modal = document.querySelector('#confirmModal');
    return !!modal && modal.classList.contains('show') && getComputedStyle(modal).opacity === '1';
  });
  await Promise.all([
    e2e.page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    e2e.page.click('#confirmModal [data-confirm-accept]'),
  ]);

  assert.match(new URL(e2e.page.url()).pathname, /^\/admin\/orders\/details\/[^/]+$/);
  const flash = await text(e2e, '.alert');
  const placed = /Order (\S+) placed\./.exec(flash);
  assert.ok(placed, `the page did not say the order was placed: ${flash}`);
  return placed[1];
}

describe('new order page', () => {
  let browser: Browser;

  before(async () => {
    browser = await launchBrowser();
  });

  after(async () => {
    await closeBrowser();
  });

  it('finds a product, shows the server\'s figures as the quantity changes, and places the order after a confirmation', async () => {
    const api = await adminClient();
    const { product, variant, sku } = await createTestProduct(api, { stock: 5, price: 150 });

    const e2e = await newPage(browser, { lang: 'en' });
    try {
      await signInBrowser(e2e, api);
      await e2e.goto('/admin/orders/new');
      await e2e.page.waitForSelector('[data-variant-search]');

      await e2e.page.type('[data-variant-search]', sku);
      const result = `[data-variant-results] button[data-variant-id="${variant.id}"]`;
      await e2e.page.waitForSelector(result);
      const offered = await text(e2e, result);
      assert.match(offered, /150\.00 EGP/);
      assert.match(offered, /5 in stock/);
      await e2e.page.click(result);

      const row = `[data-lines] [data-line][data-variant-id="${variant.id}"]`;
      await e2e.page.waitForSelector(row);
      assert.equal(await e2e.page.$eval('[data-lines-empty]', (node) => (node as HTMLElement).hidden), true);

      // 150 is under the free-delivery threshold, so the standard fee is added. The page only shows what the server says.
      await waitForTotal(e2e, 'total', '200.00 EGP');
      await setQuantity(e2e, row, '2');
      await waitForTotal(e2e, 'total', '350.00 EGP');
      assert.equal(await text(e2e, '[data-total="subtotal"]'), '300.00 EGP');
      assert.equal(await text(e2e, '[data-total="delivery"]'), '50.00 EGP');
      assert.equal(await text(e2e, `${row} [data-line-total]`), '300.00 EGP');

      // More than there is: the row says so before the order is sent.
      await setQuantity(e2e, row, '9');
      await e2e.page.waitForFunction(
        (selector: string) => !(document.querySelector(selector) as HTMLElement).hidden,
        { timeout: 10_000 },
        `${row} [data-line-warning]`,
      );
      assert.equal(await text(e2e, `${row} [data-line-warning]`), 'Only 5 in stock');

      await setQuantity(e2e, row, '2');
      await e2e.page.waitForFunction(
        (selector: string) => (document.querySelector(selector) as HTMLElement).hidden,
        { timeout: 10_000 },
        `${row} [data-line-warning]`,
      );

      // Waiving the delivery fee is the server's call too.
      await e2e.page.click('[data-waive]');
      await waitForTotal(e2e, 'total', '300.00 EGP');
      assert.equal(await text(e2e, '[data-total="delivery"]'), 'Free');
      await e2e.page.click('[data-waive]');
      await waitForTotal(e2e, 'total', '350.00 EGP');

      await fillDelivery(e2e);
      await e2e.screenshot('admin-new-order-filled');
      const orderNumber = await placeOrder(e2e);

      const order = await adminOrder(api, orderNumber);
      assert.equal(order.status, 'Pending');
      assert.equal(order.subtotal, 300);
      assert.equal(order.deliveryFee, 50);
      assert.equal(order.total, 350);
      assert.equal(order.items.length, 1);
      assert.equal(order.items[0].variantId, variant.id);
      assert.equal(order.items[0].quantity, 2);
      assert.equal(order.items[0].unitPrice, 150);
      assert.equal(order.shippingAddress.fullName, ADDRESS.fullName);
      assert.ok(!order.customerId, 'no account was attached');
      assert.equal((await adminProduct(api, product.id)).variants[0].stock, 3);
      assert.equal(await text(e2e, '[data-total="total"]'), '350.00 EGP');
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });

  it('attaches a registered customer found by e-mail, fills their name in, and the order appears in their account', async () => {
    const api = await adminClient();
    const { variant, sku } = await createTestProduct(api, { stock: 6, price: 100 });
    const { customer } = await placeCustomerOrder(variant.id);

    const e2e = await newPage(browser, { lang: 'en' });
    try {
      await signInBrowser(e2e, api);
      await e2e.goto('/admin/orders/new');
      await e2e.page.waitForSelector('[data-customer-search]');

      await e2e.page.type('[data-customer-search]', customer.email);
      const pick = `[data-customer-results] button[data-customer-id="${customer.user.id}"]`;
      await e2e.page.waitForSelector(pick);
      await e2e.page.click(pick);

      await e2e.page.waitForSelector('[data-customer-chip]:not([hidden])');
      assert.ok((await text(e2e, '[data-customer-name]')).includes(customer.email));
      assert.equal(await e2e.page.$eval('[data-customer-finder]', (node) => (node as HTMLElement).hidden), true);
      assert.equal(await value(e2e, '[data-customer-id]'), customer.user.id);
      await e2e.page.waitForFunction(
        (wanted: string) => (document.querySelector('#FullName') as HTMLInputElement).value === wanted,
        { timeout: 10_000 },
        customer.user.fullName,
      );

      await addItem(e2e, sku, variant.id);
      await waitForTotal(e2e, 'total', '150.00 EGP');
      await fillDelivery(e2e, { keepName: true });
      const orderNumber = await placeOrder(e2e);

      const mine = await customer.client.get<{ orders: { orderNumber: string }[] }>('/api/v1/customer/orders');
      assert.ok(
        mine.data.orders.some((order) => order.orderNumber === orderNumber),
        'the order is in the customer\'s own history',
      );
      assert.ok(await e2e.page.$(`a[href="/admin/customers/details/${customer.user.id}"]`), 'the order links to the customer');
      assert.equal((await adminOrder(api, orderNumber)).customerId, customer.user.id);
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });
});
