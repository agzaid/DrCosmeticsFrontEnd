/**
 * Shared helpers for the admin specs. Not a spec itself (no `.spec.ts` suffix), so the runner never executes it.
 * Persistence is always asserted through the HTTP API, never SQL.
 */
import { randomBytes } from 'node:crypto';
import type { ElementHandle, Page } from 'puppeteer-core';
import type { Order, Product, ProductVariant, User } from '../../../src/types';
import type { PagedOrders, ProductWrite } from '../../../src/api/types';
import { ApiClient, adminClient, registerCustomer } from '../harness/api.ts';
import { newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import type { Browser } from 'puppeteer-core';

export const LANGS: Lang[] = ['en', 'ar'];

/** Visible copy the specs rely on, per language (kept next to the spec so a missing translation fails loudly). */
export const COPY = {
  adminEntry: { en: 'Admin Portal', ar: 'لوحة الإدارة' },
  adminTitle: { en: 'Luma Beauty Store Admin', ar: 'لوحة تحكم متجر لوما بيوتي' },
} as const satisfies Record<string, Record<Lang, string>>;

export function pick(lang: Lang, en: string, ar: string): string {
  return lang === 'ar' ? ar : en;
}

export function token(prefix = 'E2E'): string {
  return `${prefix}${randomBytes(4).toString('hex').toUpperCase()}`;
}

export const ADDRESS = {
  fullName: 'Sara Ahmed',
  mobileNumber: '01012345678',
  governorate: 'Cairo',
  city: 'Nasr City',
  streetAddress: 'Street 90, Villa 12',
};

/** Makes the browser context authenticated as whoever owns `client`'s session (HttpOnly cookie copied over CDP). */
export async function signInBrowser(e2e: E2ePage, client: ApiClient): Promise<void> {
  const value = client.cookie('luma_auth');
  if (!value) {
    throw new Error('client has no luma_auth cookie; log in first');
  }
  await e2e.page.setCookie({ name: 'luma_auth', value, url: e2e.baseUrl, httpOnly: true });
}

export async function clickText(page: Page, selector: string, text: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    (sel: string, wanted: string) =>
      Array.from(document.querySelectorAll(sel)).some(
        (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim() === wanted,
      ),
    { timeout },
    selector,
    text,
  );
  await page.evaluate(
    (sel: string, wanted: string) => {
      const element = Array.from(document.querySelectorAll<HTMLElement>(sel)).find(
        (candidate) => (candidate.textContent ?? '').replace(/\s+/g, ' ').trim() === wanted,
      );
      element?.click();
    },
    selector,
    text,
  );
}

export async function openAdmin(e2e: E2ePage): Promise<void> {
  await clickText(e2e.page, 'header button', COPY.adminEntry[e2e.lang]);
  await e2e.page.waitForSelector('[data-tab="overview"]', { timeout: 15_000 });
}

export async function openTab(e2e: E2ePage, tab: string): Promise<void> {
  await e2e.page.click(`[data-tab="${tab}"]`);
  await e2e.page.waitForSelector(`[data-panel="${tab}"]`, { timeout: 15_000 });
}

/** A browser page already signed in as a fresh admin session, sitting on the admin overview. */
export async function adminPage(
  browser: Browser,
  lang: Lang,
  viewport?: { width: number; height: number },
): Promise<{ e2e: E2ePage; api: ApiClient }> {
  const api = await adminClient();
  const e2e = await newPage(browser, { lang, viewport });
  await signInBrowser(e2e, api);
  await e2e.goto('/');
  await openAdmin(e2e);
  return { e2e, api };
}

/** XPath for the form control inside `<label><span>{label}</span>control</label>`. */
export function labelled(label: string, control = '*[self::input or self::select or self::textarea]'): string {
  return `xpath///label[normalize-space(span[1])=${JSON.stringify(label)}]//${control}`;
}

export async function control(page: Page, label: string): Promise<ElementHandle<Element>> {
  const handle = await page.waitForSelector(labelled(label), { timeout: 10_000 });
  if (!handle) {
    throw new Error(`No control labelled "${label}"`);
  }
  return handle;
}

/** Sets a React-controlled input/select/textarea value exactly (no IME / typing side effects). */
export async function setValue(handle: ElementHandle<Element>, value: string): Promise<void> {
  await handle.evaluate((element, next) => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, next);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }, value);
}

export async function fill(page: Page, label: string, value: string): Promise<void> {
  await setValue(await control(page, label), value);
}

export async function textOf(page: Page, selector: string): Promise<string> {
  const handle = await page.waitForSelector(selector, { timeout: 10_000 });
  return ((await handle?.evaluate((element) => element.textContent ?? '')) ?? '').replace(/\s+/g, ' ').trim();
}

export async function waitForText(page: Page, selector: string, predicate: (text: string) => boolean, timeout = 10_000): Promise<string> {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await page
      .$eval(selector, (element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim())
      .catch(() => '');
    if (predicate(last)) {
      return last;
    }
    await page.evaluate(() => new Promise<void>((done) => setTimeout(done, 100)));
  }
  throw new Error(`Timed out waiting on ${selector}; last text: "${last}"`);
}

/** Toast messages currently on screen (role=status containers). */
export async function toasts(page: Page): Promise<string[]> {
  return page.$$eval('[role="status"]', (nodes) => nodes.map((node) => (node.textContent ?? '').trim()));
}

export async function waitForToast(page: Page, includes: string, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    (needle: string) => Array.from(document.querySelectorAll('[role="status"]')).some((node) => (node.textContent ?? '').includes(needle)),
    { timeout },
    includes,
  );
}

// ---- API-side fixtures --------------------------------------------------------------------------------------------

export interface TestProduct {
  product: Product;
  variant: ProductVariant;
  sku: string;
}

export function productBody(overrides: Partial<ProductWrite> & { sku: string; stock?: number; price?: number }): ProductWrite {
  const { sku, stock = 20, price = 120, ...rest } = overrides;
  return {
    name: { en: `E2E Product ${sku}`, ar: `منتج اختبار ${sku}` },
    brand: 'Luma Signature',
    category: 'makeup',
    subCategory: 'E2E',
    description: { en: 'E2E fixture', ar: 'منتج اختبار' },
    ingredients: { en: 'Water.', ar: 'ماء.' },
    howToUse: { en: 'Use.', ar: 'استخدمي.' },
    price,
    originalPrice: null,
    rating: 0,
    reviewsCount: 0,
    images: [],
    skinType: ['all'],
    finish: null,
    coverage: null,
    shadeFamily: null,
    isFeatured: false,
    isNewArrival: false,
    isBestSeller: false,
    status: 'published',
    variants: [{ sku, shadeName: null, shadeHex: null, size: '10ml', price, stock, isActive: true }],
    ...rest,
  };
}

export async function createTestProduct(
  admin: ApiClient,
  options: { stock?: number; price?: number; name?: { en: string; ar: string } } = {},
): Promise<TestProduct> {
  const sku = `E2E-${token()}`;
  const product = await admin.createProduct(
    productBody({ sku, stock: options.stock, price: options.price, ...(options.name ? { name: options.name } : {}) }),
  );
  return { product, variant: product.variants[0], sku };
}

export interface TestCustomer {
  client: ApiClient;
  email: string;
  password: string;
  user: User;
}

export async function placeCustomerOrder(
  variantId: string,
  quantity = 1,
  address: typeof ADDRESS = ADDRESS,
): Promise<{ order: Order; customer: TestCustomer }> {
  const customer = await registerCustomer('adm');
  const result = await customer.client.placeOrder([{ variantId, quantity }], address);
  if (result.status !== 201) {
    throw new Error(`placeOrder failed: ${result.status} ${JSON.stringify(result.data)}`);
  }
  return { order: result.data.order, customer };
}

export async function allAdminOrders(admin: ApiClient): Promise<Order[]> {
  const orders: Order[] = [];
  for (let page = 1; ; page += 1) {
    const result = await admin.get<PagedOrders>(`/api/v1/admin/orders?status=all&page=${page}&pageSize=100`);
    if (!result.ok) {
      throw new Error(`admin orders failed: ${result.status}`);
    }
    orders.push(...result.data.orders);
    if (page >= result.data.totalPages) {
      return orders;
    }
  }
}

export async function setOrderStatus(admin: ApiClient, orderId: string, status: string) {
  return admin.request<{ order: Order }>('PATCH', `/api/v1/admin/orders/${encodeURIComponent(orderId)}/status`, {
    body: { status, note: null },
  });
}

export async function collectOrder(admin: ApiClient, orderId: string, amount?: number) {
  return admin.request<{ order: Order }>('POST', `/api/v1/admin/orders/${encodeURIComponent(orderId)}/payment/collect`, {
    body: { amount: amount ?? null, note: null },
  });
}

export async function adminOrder(admin: ApiClient, orderNumber: string): Promise<Order> {
  const found = (await allAdminOrders(admin)).find((order) => order.orderNumber === orderNumber);
  if (!found) {
    throw new Error(`order ${orderNumber} not found`);
  }
  return found;
}

export async function adminProduct(admin: ApiClient, id: string): Promise<Product> {
  const result = await admin.get<{ product: Product }>(`/api/v1/admin/products/${encodeURIComponent(id)}`);
  if (!result.ok) {
    throw new Error(`admin product ${id} failed: ${result.status}`);
  }
  return result.data.product;
}

export async function publicProductStatus(id: string, baseUrl: string): Promise<number> {
  return (await new ApiClient(baseUrl).get(`/api/v1/products/${encodeURIComponent(id)}`)).status;
}

export interface RawUploadResult {
  status: number;
  body: { url?: string; errorCode?: string; detail?: string } | undefined;
}

/** Multipart upload straight to the API with the admin session (the harness client only speaks JSON). */
export async function rawUpload(
  admin: ApiClient,
  baseUrl: string,
  bytes: Buffer,
  filename: string,
  contentType: string,
): Promise<RawUploadResult> {
  const { token, headerName } = await admin.csrfToken();
  const cookie = ['luma_auth', 'luma_csrf']
    .flatMap((name) => {
      const value = admin.cookie(name);
      return value ? [`${name}=${value}`] : [];
    })
    .join('; ');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
  const response = await fetch(`${baseUrl}/api/v1/admin/images`, {
    method: 'POST',
    headers: { cookie, [headerName]: token },
    body: form,
  });
  const text = await response.text();
  let body: RawUploadResult['body'];
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

/** A valid 1x1 PNG. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
