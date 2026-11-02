/**
 * (b) Dashboard honesty (A-31): every figure equals what the admin API returns, the labels match the calculation
 * (cancelled orders excluded from order value, collected revenue = collected only), and the figures move correctly
 * after a customer order, a cancellation and a cash collection.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser, Page } from 'puppeteer-core';
import type { AdminMetrics, Order } from '../../../src/types';
import type { PagedProducts } from '../../../src/api/types';
import { adminClient, type ApiClient } from '../harness/api.ts';
import { closeBrowser, launchBrowser, type Lang } from '../harness/browser.ts';
import {
  LANGS,
  adminPage,
  allAdminOrders,
  collectOrder,
  createTestProduct,
  placeCustomerOrder,
  setOrderStatus,
  waitForText,
} from './admin-helpers.ts';

const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'] as const;

function money(amount: number, lang: Lang): string {
  const text = amount.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return lang === 'ar' ? `${text} ج.م` : `${text} EGP`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function readMetrics(admin: ApiClient): Promise<AdminMetrics> {
  const result = await admin.get<{ metrics: AdminMetrics }>('/api/v1/admin/metrics');
  assert.equal(result.status, 200);
  return result.data.metrics;
}

interface ExpectedFigures {
  totalSales: number;
  collectedRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  byStatus: Record<string, number>;
  lowStock: Set<string>;
  activeProducts: number;
}

/** Recomputes every dashboard figure independently from the order and product lists. */
async function expectedFromLists(admin: ApiClient): Promise<ExpectedFigures> {
  const orders: Order[] = await allAdminOrders(admin);
  const live = orders.filter((order) => order.status !== 'Cancelled');
  const totalSales = round2(live.reduce((sum, order) => sum + order.total, 0));
  const collectedRevenue = round2(
    orders.filter((order) => order.paymentStatus === 'Collected').reduce((sum, order) => sum + order.total, 0),
  );
  const byStatus: Record<string, number> = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const order of orders) {
    byStatus[order.status] += 1;
  }

  const lowStock = new Set<string>();
  let activeProducts = 0;
  for (let page = 1; ; page += 1) {
    const result = await admin.get<PagedProducts>(`/api/v1/admin/products?status=all&page=${page}&pageSize=60`);
    assert.equal(result.status, 200);
    for (const product of result.data.products) {
      if (product.status === 'archived') {
        continue;
      }
      activeProducts += 1;
      for (const variant of product.variants) {
        if (variant.isActive !== false && variant.stock > 0 && variant.stock <= 5) {
          lowStock.add(variant.sku);
        }
      }
    }
    if (page >= result.data.totalPages) {
      break;
    }
  }

  return {
    totalSales,
    collectedRevenue,
    totalOrders: orders.length,
    averageOrderValue: live.length === 0 ? 0 : round2(totalSales / live.length),
    byStatus,
    lowStock,
    activeProducts,
  };
}

async function refresh(page: Page): Promise<void> {
  await page.click('[data-panel="overview"] button');
}

async function metricText(page: Page, key: string): Promise<string> {
  return waitForText(page, `[data-metric="${key}"] [data-field="value"]`, (text) => text.length > 0);
}

async function readStatusCounts(page: Page): Promise<Record<string, number>> {
  return page.$$eval('[data-status]', (rows) =>
    Object.fromEntries(
      rows.map((row) => [row.getAttribute('data-status') ?? '', Number(row.querySelector('span:last-child')?.textContent ?? 'NaN')]),
    ),
  );
}

describe('admin dashboard figures are honest and live', () => {
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
    it(`[${lang}] labels match calculations; UI equals the API; figures move after order, cancel and collection`, async () => {
      // Deterministic starting data: one low-stock variant, one sold-out variant, three fresh orders.
      const low = await createTestProduct(admin, { stock: 3, price: 100 });
      const soldOut = await createTestProduct(admin, { stock: 0, price: 100 });
      const stocked = await createTestProduct(admin, { stock: 40, price: 250 });
      const pending = await placeCustomerOrder(stocked.variant.id, 1);
      const toCancel = await placeCustomerOrder(stocked.variant.id, 2);
      const toCollect = await placeCustomerOrder(stocked.variant.id, 1);
      assert.equal((await setOrderStatus(admin, toCollect.order.id, 'Confirmed')).status, 200);
      assert.equal((await setOrderStatus(admin, toCollect.order.id, 'Shipped')).status, 200);

      const { e2e } = await adminPage(browser, lang);
      try {
        await e2e.page.waitForSelector('[data-metric="totalSales"]');

        // 1. Labels say what the calculation does.
        const labels = await e2e.page.$$eval('[data-metric]', (cards) =>
          Object.fromEntries(cards.map((card) => [card.getAttribute('data-metric') ?? '', (card.textContent ?? '').trim()])),
        );
        const expectLabel = (key: string, en: string, ar: string): void => {
          const wanted = lang === 'ar' ? ar : en;
          assert.ok(labels[key]?.includes(wanted), `metric ${key} label should contain "${wanted}", got "${labels[key]}"`);
        };
        expectLabel('totalSales', 'Order value (non-cancelled)', 'قيمة الطلبات (بدون الملغاة)');
        expectLabel('collectedRevenue', 'Collected revenue', 'الإيراد المحصّل');
        expectLabel('totalOrders', 'Total orders (incl. cancelled)', 'إجمالي الطلبات (شاملة الملغاة)');
        expectLabel('averageOrderValue', 'Average order value', 'متوسط قيمة الطلب');
        expectLabel('totalProducts', 'Active products', 'المنتجات النشطة');
        expectLabel('lowStockCount', 'Low-stock variants', 'خيارات قاربت على النفاد');

        // 2. API figures equal an independent recomputation, and the UI shows exactly the API figures.
        const check = async (): Promise<{ metrics: AdminMetrics; expected: ExpectedFigures }> => {
          await refresh(e2e.page);
          const expected = await expectedFromLists(admin);
          const metrics = await readMetrics(admin);
          assert.equal(metrics.totalSales, expected.totalSales, 'totalSales = sum of non-cancelled order totals');
          assert.equal(metrics.collectedRevenue, expected.collectedRevenue, 'collectedRevenue = sum of collected orders only');
          assert.equal(metrics.totalOrders, expected.totalOrders, 'totalOrders counts every order');
          assert.equal(metrics.averageOrderValue, expected.averageOrderValue, 'average = non-cancelled sales / non-cancelled orders');
          assert.equal(metrics.totalProducts, expected.activeProducts, 'active products = non-archived');
          assert.deepEqual(new Set(metrics.lowStockItems.map((item) => item.variantSku)), expected.lowStock, 'low-stock list (0 < stock <= 5)');
          assert.equal(metrics.lowStockCount, expected.lowStock.size);
          for (const status of STATUSES) {
            assert.equal(metrics.ordersByStatus[status], expected.byStatus[status], `orders ${status}`);
          }

          await waitForText(e2e.page, '[data-metric="totalSales"] [data-field="value"]', (text) => text === money(metrics.totalSales, lang));
          assert.equal(await metricText(e2e.page, 'collectedRevenue'), money(metrics.collectedRevenue ?? 0, lang));
          assert.equal(await metricText(e2e.page, 'totalOrders'), String(metrics.totalOrders));
          assert.equal(await metricText(e2e.page, 'averageOrderValue'), money(metrics.averageOrderValue, lang));
          assert.equal(await metricText(e2e.page, 'totalProducts'), String(metrics.totalProducts));
          assert.equal(await metricText(e2e.page, 'lowStockCount'), String(metrics.lowStockCount));
          const counts = await readStatusCounts(e2e.page);
          for (const status of STATUSES) {
            assert.equal(counts[status], metrics.ordersByStatus[status], `UI count for ${status}`);
          }
          const listed = await e2e.page.$$eval('[data-low-stock-sku]', (rows) => rows.map((row) => row.getAttribute('data-low-stock-sku') ?? ''));
          assert.deepEqual(new Set(listed), new Set(metrics.lowStockItems.map((item) => item.variantSku)));
          return { metrics, expected };
        };

        const before = await check();
        assert.ok(before.expected.lowStock.has(low.sku), 'a stock-3 variant is low stock');
        assert.ok(!before.expected.lowStock.has(soldOut.sku), 'a stock-0 variant is out of stock, not low stock');
        await e2e.screenshot(`admin-dashboard-${lang}-before`);

        // 3. A new customer order raises order value and the Pending count; collected revenue is untouched.
        const fresh = await placeCustomerOrder(stocked.variant.id, 1);
        const afterOrder = await check();
        assert.equal(round2(afterOrder.metrics.totalSales - before.metrics.totalSales), fresh.order.total);
        assert.equal(afterOrder.metrics.totalOrders, before.metrics.totalOrders + 1);
        assert.equal(afterOrder.metrics.ordersByStatus.Pending, before.metrics.ordersByStatus.Pending + 1);
        assert.equal(afterOrder.metrics.collectedRevenue, before.metrics.collectedRevenue);

        // 4. Cancelling removes the order from order value but not from the all-orders count.
        assert.equal((await setOrderStatus(admin, toCancel.order.id, 'Cancelled')).status, 200);
        const afterCancel = await check();
        assert.equal(round2(afterOrder.metrics.totalSales - afterCancel.metrics.totalSales), toCancel.order.total);
        assert.equal(afterCancel.metrics.totalOrders, afterOrder.metrics.totalOrders);
        assert.equal(afterCancel.metrics.ordersByStatus.Cancelled, afterOrder.metrics.ordersByStatus.Cancelled + 1);

        // 5. Collection moves collected revenue by exactly the order total and leaves order value alone.
        const collected = await collectOrder(admin, toCollect.order.id, toCollect.order.total);
        assert.equal(collected.status, 200);
        const afterCollect = await check();
        assert.equal(round2(afterCollect.metrics.collectedRevenue! - afterCancel.metrics.collectedRevenue!), toCollect.order.total);
        assert.equal(afterCollect.metrics.totalSales, afterCancel.metrics.totalSales);

        // 6. Restocking removes the variant from the low-stock list.
        await admin.adjustStock(low.product.id, low.variant.id, 30, 'e2e restock');
        const afterRestock = await check();
        assert.ok(!afterRestock.expected.lowStock.has(low.sku));
        assert.equal(afterRestock.metrics.lowStockCount, afterCollect.metrics.lowStockCount - 1);

        // The untouched pending order is still pending.
        assert.equal((await allAdminOrders(admin)).find((order) => order.id === pending.order.id)?.status, 'Pending');
        await e2e.screenshot(`admin-dashboard-${lang}-after`);
        e2e.assertOnlyApiTraffic();
        e2e.assertClean();
      } finally {
        await e2e.close();
      }
    });
  }
});
