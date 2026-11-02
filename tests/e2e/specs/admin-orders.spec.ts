/**
 * (f) Fulfilment through the admin UI: filter/search, legal actions only, the full status chain, cancellation with
 * exactly-once restock, cash-on-delivery collection rules (A-36, A-37) and what the customer sees afterwards.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { Order } from '../../../src/types';
import { ApiClient, adminClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { navigateTo } from '../harness/ui.ts';
import {
  ADDRESS,
  LANGS,
  adminOrder,
  adminPage,
  allAdminOrders,
  collectOrder,
  createTestProduct,
  openTab,
  pick,
  placeCustomerOrder,
  setOrderStatus,
  setValue,
  signInBrowser,
  token,
  waitForText,
  waitForToast,
  type TestProduct,
} from './admin-helpers.ts';

const STATUS_LABEL: Record<string, Record<Lang, string>> = {
  Pending: { en: 'Pending', ar: 'قيد الانتظار' },
  Confirmed: { en: 'Confirmed', ar: 'تم التأكيد' },
  Shipped: { en: 'Shipped', ar: 'تم الشحن' },
  Delivered: { en: 'Delivered', ar: 'تم التسليم' },
  Cancelled: { en: 'Cancelled', ar: 'ملغي' },
};

const PAYMENT_LABEL: Record<string, Record<Lang, string>> = {
  Unpaid: { en: 'Unpaid', ar: 'غير مدفوع' },
  Collected: { en: 'Collected', ar: 'تم التحصيل' },
};

function rowOf(order: Order): string {
  return `[data-order="${order.orderNumber}"]`;
}

async function showOrder(e2e: E2ePage, order: Order): Promise<void> {
  await openTab(e2e, 'orders');
  const search = await e2e.page.waitForSelector('[data-panel="orders"] input[type="text"]');
  assert.ok(search);
  await setValue(search, order.orderNumber);
  await e2e.page.waitForSelector(rowOf(order), { timeout: 15_000 });
}

async function rowState(e2e: E2ePage, order: Order): Promise<{ status: string; payment: string; actions: string[]; canCollect: boolean }> {
  return e2e.page.$eval(rowOf(order), (row) => ({
    status: row.getAttribute('data-order-status') ?? '',
    payment: row.getAttribute('data-payment-status') ?? '',
    actions: Array.from(row.querySelectorAll('select option'))
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== ''),
    canCollect: row.querySelector('button[aria-label^="Collect cash"],button[aria-label^="تحصيل نقدية"]') !== null,
  }));
}

async function waitForRowStatus(e2e: E2ePage, order: Order, status: string, payment?: string): Promise<void> {
  await e2e.page.waitForFunction(
    (selector: string, wantedStatus: string, wantedPayment: string | undefined) => {
      const row = document.querySelector(selector);
      return (
        row?.getAttribute('data-order-status') === wantedStatus &&
        (wantedPayment === undefined || row.getAttribute('data-payment-status') === wantedPayment)
      );
    },
    { timeout: 15_000 },
    rowOf(order),
    status,
    payment,
  );
}

async function changeStatus(e2e: E2ePage, order: Order, next: string): Promise<void> {
  const select = await e2e.page.waitForSelector(`${rowOf(order)} select`);
  assert.ok(select, 'a status select is offered');
  await setValue(select, next);
}

async function stockOf(api: ApiClient, product: TestProduct): Promise<number> {
  const result = await api.get<{ product: { variants: { id: string; stock: number }[] } }>(
    `/api/v1/admin/products/${encodeURIComponent(product.product.id)}`,
  );
  const variant = result.data.product.variants.find((entry) => entry.id === product.variant.id);
  assert.ok(variant);
  return variant.stock;
}

async function customerStatusBadge(e2e: E2ePage, order: Order): Promise<{ status: string; payment: string }> {
  await e2e.goto('/');
  await navigateTo(e2e, 'account');
  await e2e.page.waitForSelector(`[data-testid="order-status-${order.id}"]`, { timeout: 20_000 });
  const status = await e2e.page.$eval(`[data-testid="order-status-${order.id}"]`, (node) => (node.textContent ?? '').trim());
  await e2e.page.click(`[data-testid="order-${order.id}"] button[aria-expanded]`);
  const payment = await waitForText(e2e.page, `[data-testid="order-payment-${order.id}"]`, (text) => text.length > 0);
  return { status, payment };
}

describe('admin fulfilment', () => {
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
    it(`[${lang}] Pending -> Confirmed -> Shipped -> collect cash -> Delivered; legal actions only; customer sees each change (A-36, A-37)`, async () => {
      const fixture = await createTestProduct(admin, { stock: 10, price: 200 });
      const { order, customer } = await placeCustomerOrder(fixture.variant.id, 2);
      assert.equal(await stockOf(admin, fixture), 8);
      const { e2e } = await adminPage(browser, lang);
      const shopper = await newPage(browser, { lang });
      try {
        await signInBrowser(shopper, customer.client);
        await showOrder(e2e, order);

        // Pending: confirm or cancel only; nothing to collect.
        assert.deepEqual(await rowState(e2e, order), { status: 'Pending', payment: 'Unpaid', actions: ['Confirmed', 'Cancelled'], canCollect: false });
        const rowText = await waitForText(e2e.page, rowOf(order), (text) => text.includes(STATUS_LABEL.Pending[lang]));
        assert.ok(rowText.includes(PAYMENT_LABEL.Unpaid[lang]), `payment badge localised: ${rowText}`);
        await e2e.screenshot(`admin-orders-${lang}-pending`);

        await changeStatus(e2e, order, 'Confirmed');
        await waitForRowStatus(e2e, order, 'Confirmed', 'Unpaid');
        assert.equal((await adminOrder(admin, order.orderNumber)).status, 'Confirmed');
        assert.deepEqual(await rowState(e2e, order), { status: 'Confirmed', payment: 'Unpaid', actions: ['Shipped', 'Cancelled'], canCollect: false });
        await waitForToast(e2e.page, pick(lang, `Order ${order.orderNumber} is now Confirmed.`, `أصبح الطلب ${order.orderNumber} بحالة «تم التأكيد».`));

        const afterConfirm = await customerStatusBadge(shopper, order);
        assert.equal(afterConfirm.status, STATUS_LABEL.Confirmed[lang]);
        assert.match(afterConfirm.payment, lang === 'en' ? /Unpaid/ : /غير مدفوع/);

        // Shipped never sets payment; cancel is no longer offered; collection becomes available.
        await changeStatus(e2e, order, 'Shipped');
        await waitForRowStatus(e2e, order, 'Shipped', 'Unpaid');
        const shipped = await adminOrder(admin, order.orderNumber);
        assert.equal(shipped.status, 'Shipped');
        assert.equal(shipped.paymentStatus, 'Unpaid', 'Shipped must not set payment');
        assert.equal(shipped.paymentCollectedAmount ?? null, null);
        assert.deepEqual(await rowState(e2e, order), { status: 'Shipped', payment: 'Unpaid', actions: ['Delivered'], canCollect: true });

        // Collect the exact total (the UI asks first and names the amount).
        await e2e.page.click(`${rowOf(order)} button[aria-label*="${order.orderNumber}"]`);
        await waitForRowStatus(e2e, order, 'Shipped', 'Collected');
        const collected = await adminOrder(admin, order.orderNumber);
        assert.equal(collected.paymentStatus, 'Collected');
        assert.equal(collected.paymentCollectedAmount, order.total, 'the collected amount is exactly the order total');
        assert.ok(e2e.dialogs.some((message) => message.includes(order.orderNumber)), 'collection asked for confirmation naming the order');
        assert.deepEqual(await rowState(e2e, order), { status: 'Shipped', payment: 'Collected', actions: ['Delivered'], canCollect: false });
        await waitForToast(e2e.page, pick(lang, `Cash collected for ${order.orderNumber}.`, `تم تحصيل نقدية الطلب ${order.orderNumber}.`));

        // After collection the order can no longer be cancelled: not offered in the UI, refused by the API.
        const cancelAttempt = await setOrderStatus(admin, order.id, 'Cancelled');
        assert.equal(cancelAttempt.status, 409);
        assert.equal(await stockOf(admin, fixture), 8, 'a refused cancellation restores nothing');

        const afterCollect = await customerStatusBadge(shopper, order);
        assert.equal(afterCollect.status, STATUS_LABEL.Shipped[lang]);
        assert.match(afterCollect.payment, lang === 'en' ? /Collected/ : /تم التحصيل/);

        await changeStatus(e2e, order, 'Delivered');
        await waitForRowStatus(e2e, order, 'Delivered', 'Collected');
        const delivered = await adminOrder(admin, order.orderNumber);
        assert.equal(delivered.status, 'Delivered');
        assert.equal(delivered.paymentStatus, 'Collected');
        assert.deepEqual(await rowState(e2e, order), { status: 'Delivered', payment: 'Collected', actions: [], canCollect: false });
        assert.deepEqual(
          delivered.statusHistory.map((entry) => entry.status),
          ['Pending', 'Confirmed', 'Shipped', 'Delivered'],
        );

        const final = await customerStatusBadge(shopper, order);
        assert.equal(final.status, STATUS_LABEL.Delivered[lang]);
        assert.equal((await customer.client.customerOrders()).orders.find((entry) => entry.id === order.id)?.status, 'Delivered');
        assert.equal(await stockOf(admin, fixture), 8, 'a delivered order keeps its stock deduction');

        await e2e.screenshot(`admin-orders-${lang}-delivered`);
        e2e.assertClean();
        shopper.assertClean();
      } finally {
        await shopper.close();
        await e2e.close();
      }
    });

    it(`[${lang}] admin cancel of Pending and Confirmed orders restores stock exactly once`, async () => {
      const fixture = await createTestProduct(admin, { stock: 10, price: 150 });
      const pending = await placeCustomerOrder(fixture.variant.id, 3);
      const confirmed = await placeCustomerOrder(fixture.variant.id, 2);
      assert.equal((await setOrderStatus(admin, confirmed.order.id, 'Confirmed')).status, 200);
      assert.equal(await stockOf(admin, fixture), 5);
      const { e2e } = await adminPage(browser, lang);
      try {
        await showOrder(e2e, pending.order);
        await changeStatus(e2e, pending.order, 'Cancelled');
        await waitForRowStatus(e2e, pending.order, 'Cancelled');
        assert.ok(e2e.dialogs.length > 0, 'cancelling asks for confirmation');
        assert.equal((await adminOrder(admin, pending.order.orderNumber)).status, 'Cancelled');
        assert.equal(await stockOf(admin, fixture), 8, 'the 3 units came back');
        assert.deepEqual((await rowState(e2e, pending.order)).actions, [], 'a cancelled order has no actions');

        // Replaying the cancellation (another admin, a retry) must not restock again.
        const replay = await setOrderStatus(admin, pending.order.id, 'Cancelled');
        assert.equal(replay.status, 200, 'repeating the same status is an idempotent no-op');
        assert.equal(replay.data.order.status, 'Cancelled');
        assert.equal(await stockOf(admin, fixture), 8, 'exactly once');
        assert.equal((await pending.customer.client.request('POST', `/api/v1/orders/${pending.order.id}/cancel`)).status, 409, 'customer cancel after admin cancel is refused');
        assert.equal(await stockOf(admin, fixture), 8);

        await showOrder(e2e, confirmed.order);
        assert.deepEqual((await rowState(e2e, confirmed.order)).actions, ['Shipped', 'Cancelled']);
        await changeStatus(e2e, confirmed.order, 'Cancelled');
        await waitForRowStatus(e2e, confirmed.order, 'Cancelled');
        assert.equal(await stockOf(admin, fixture), 10, 'both orders restored in full, once each');
        const cancelled = await adminOrder(admin, confirmed.order.orderNumber);
        assert.equal(cancelled.stockRestored, true);
        assert.equal(cancelled.paymentStatus, 'Unpaid');
        e2e.assertClean({ statuses: [{ status: 409 }] });
      } finally {
        await e2e.close();
      }
    });

    it(`[${lang}] filter by status, search by order number / customer / phone, empty state`, async () => {
      const fixture = await createTestProduct(admin, { stock: 20, price: 100 });
      const tok = token('FLT');
      const phone = `011${Math.floor(1_000_0000 + Math.random() * 8_999_9999)}`;
      const named = await placeCustomerOrder(fixture.variant.id, 1, { ...ADDRESS, fullName: `Nadia ${tok}`, mobileNumber: phone });
      const shippedOrder = await placeCustomerOrder(fixture.variant.id, 1);
      assert.equal((await setOrderStatus(admin, shippedOrder.order.id, 'Confirmed')).status, 200);
      assert.equal((await setOrderStatus(admin, shippedOrder.order.id, 'Shipped')).status, 200);
      const { e2e } = await adminPage(browser, lang);
      try {
        await openTab(e2e, 'orders');
        const search = await e2e.page.waitForSelector('[data-panel="orders"] input[type="text"]');
        assert.ok(search);
        const rowsFor = async (): Promise<string[]> =>
          e2e.page.$$eval('[data-panel="orders"] [data-order]', (rows) => rows.map((row) => row.getAttribute('data-order') ?? ''));
        const settle = async (predicate: (rows: string[]) => boolean): Promise<string[]> => {
          const deadline = Date.now() + 10_000;
          let rows: string[] = [];
          while (Date.now() < deadline) {
            rows = await rowsFor();
            if (predicate(rows)) {
              return rows;
            }
            await e2e.page.evaluate(() => new Promise<void>((done) => setTimeout(done, 100)));
          }
          throw new Error(`rows never settled: ${rows.join(',')}`);
        };

        // By order number, customer name and phone: exactly that order.
        for (const query of [named.order.orderNumber, `Nadia ${tok}`, phone]) {
          await setValue(search, query);
          const rows = await settle((current) => current.length === 1 && current[0] === named.order.orderNumber);
          assert.deepEqual(rows, [named.order.orderNumber], `search "${query}"`);
        }
        await setValue(search, '');

        // Status filter agrees with the API and offers every status.
        const filterSelector = '[data-panel="orders"] select[aria-label="' + pick(lang, 'Filter by status', 'تصفية حسب الحالة') + '"]';
        const select = await e2e.page.waitForSelector(filterSelector);
        assert.ok(select);
        const options = await e2e.page.$$eval(filterSelector + ' option', (nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
        assert.deepEqual(options, ['all', 'Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled']);
        await setValue(select, 'Shipped');
        const shippedRows = await settle((rows) => rows.includes(shippedOrder.order.orderNumber) && !rows.includes(named.order.orderNumber));
        const statuses = await e2e.page.$$eval('[data-panel="orders"] [data-order]', (rows) => rows.map((row) => row.getAttribute('data-order-status')));
        assert.ok(statuses.every((status) => status === 'Shipped'), `filter shows only Shipped, got ${statuses.join(',')}`);
        const apiShipped = (await allAdminOrders(admin)).filter((order) => order.status === 'Shipped').length;
        assert.equal(shippedRows.length, Math.min(apiShipped, 100));
        await waitForText(e2e.page, '[data-field="order-count"]', (text) => text.includes(String(apiShipped)));

        await setValue(select, 'Pending');
        await settle((rows) => rows.includes(named.order.orderNumber) && !rows.includes(shippedOrder.order.orderNumber));

        // Filter + search combine; no match -> localised empty state, no stale rows.
        await setValue(select, 'Shipped');
        await setValue(search, named.order.orderNumber);
        const text = await waitForText(e2e.page, '[data-empty="orders"]', (value) => value.length > 0);
        assert.equal(text, pick(lang, 'No orders match these filters.', 'لا توجد طلبات مطابقة.'));
        assert.deepEqual(await rowsFor(), []);
        await e2e.screenshot(`admin-orders-${lang}-empty`);
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }

  it('[en] amounts keep their cents: the table, the confirmation and the recorded collection all use the exact total', async () => {
    const fixture = await createTestProduct(admin, { stock: 10, price: 33.33 });
    const { order } = await placeCustomerOrder(fixture.variant.id, 3);
    assert.equal(order.total, 149.99, 'fixture: 3 x 33.33 + 50 delivery');
    assert.equal((await setOrderStatus(admin, order.id, 'Confirmed')).status, 200);
    assert.equal((await setOrderStatus(admin, order.id, 'Shipped')).status, 200);
    const { e2e } = await adminPage(browser, 'en');
    try {
      await showOrder(e2e, order);
      const rowText = await waitForText(e2e.page, rowOf(order), (text) => text.includes('EGP'));
      assert.ok(rowText.includes('149.99 EGP'), `total shown with cents: ${rowText}`);
      await e2e.page.click(`${rowOf(order)} button[aria-label*="${order.orderNumber}"]`);
      await waitForRowStatus(e2e, order, 'Shipped', 'Collected');
      assert.ok(e2e.dialogs.some((message) => message.includes('149.99 EGP')), 'confirmation names the exact amount');
      assert.equal((await adminOrder(admin, order.orderNumber)).paymentCollectedAmount, 149.99);
      const after = await waitForText(e2e.page, rowOf(order), (text) => text.includes('Collected'));
      assert.ok(after.includes('149.99 EGP'));
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  });

  it('API: collection rules — only after shipment, exact total, replay-safe, never twice with another amount (A-37)', async () => {
    const fixture = await createTestProduct(admin, { stock: 10, price: 120 });
    const { order } = await placeCustomerOrder(fixture.variant.id, 1);

    const early = await collectOrder(admin, order.id, order.total);
    assert.equal(early.status, 409, 'Pending cannot be collected');
    assert.equal((await setOrderStatus(admin, order.id, 'Confirmed')).status, 200);
    assert.equal((await collectOrder(admin, order.id, order.total)).status, 409, 'Confirmed cannot be collected');
    assert.equal((await setOrderStatus(admin, order.id, 'Shipped')).status, 200);
    assert.equal((await adminOrder(admin, order.orderNumber)).paymentStatus, 'Unpaid', 'Shipped alone never sets payment');

    assert.equal((await collectOrder(admin, order.id, order.total - 1)).status, 409, 'a partial amount is refused');
    assert.equal((await adminOrder(admin, order.orderNumber)).paymentStatus, 'Unpaid');

    const before = (await admin.get<{ metrics: { collectedRevenue: number } }>('/api/v1/admin/metrics')).data.metrics.collectedRevenue;
    const first = await collectOrder(admin, order.id, order.total);
    assert.equal(first.status, 200);
    const replay = await collectOrder(admin, order.id, order.total);
    assert.equal(replay.status, 200, 'the same collection replays safely');
    assert.equal(replay.data.order.paymentCollectedAt, first.data.order.paymentCollectedAt, 'replay does not re-stamp');
    const after = (await admin.get<{ metrics: { collectedRevenue: number } }>('/api/v1/admin/metrics')).data.metrics.collectedRevenue;
    assert.equal(Math.round((after - before) * 100) / 100, order.total, 'revenue counted once');
    assert.equal((await collectOrder(admin, order.id, order.total + 5)).status, 409, 'a different amount after collection is a conflict');

    assert.equal((await setOrderStatus(admin, order.id, 'Cancelled')).status, 409, 'collected then cancel is impossible');
    assert.equal((await setOrderStatus(admin, order.id, 'Pending')).status, 409, 'no backwards transitions');
    assert.equal((await setOrderStatus(admin, order.id, 'Delivered')).status, 200);
    assert.equal((await setOrderStatus(admin, order.id, 'Cancelled')).status, 409, 'Delivered is final');
    const final = (await allAdminOrders(admin)).find((entry) => entry.id === order.id);
    assert.equal(final?.status, 'Delivered');
    assert.equal(final?.paymentCollectedAmount, order.total);
  });

  it('API: a customer cannot reach admin order operations (403)', async () => {
    const fixture = await createTestProduct(admin, { stock: 3, price: 90 });
    const { order, customer } = await placeCustomerOrder(fixture.variant.id, 1);
    assert.equal((await setOrderStatus(customer.client, order.id, 'Confirmed')).status, 403);
    assert.equal((await collectOrder(customer.client, order.id, order.total)).status, 403);
    assert.equal((await adminOrder(admin, order.orderNumber)).status, 'Pending');
  });
});

