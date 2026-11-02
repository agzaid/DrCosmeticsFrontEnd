/**
 * Thin HTTP client for assertions and setup. Keeps a cookie jar and bootstraps the antiforgery token the same way
 * the SPA does (GET /api/v1/auth/csrf -> X-XSRF-TOKEN header). Specs assert persistence through this client only.
 */
import { randomBytes } from 'node:crypto';
import type { Order, Product, User, UserAddress } from '../../../src/types';
import type {
  AddressesResponse,
  CheckoutQuote,
  DiscountWrite,
  PagedOrders,
  PagedProducts,
  PlaceOrderPayload,
  PlaceOrderResult,
  ProductWrite,
  QuoteResponse,
  WishlistResponse,
} from '../../../src/api/types';

export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiClient {
  readonly baseUrl: string;
  private readonly jar = new Map<string, string>();
  private csrf: { token: string; headerName: string } | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  cookie(name: string): string | undefined {
    return this.jar.get(name);
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  clearCookies(): void {
    this.jar.clear();
    this.csrf = null;
  }

  private storeCookies(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      if (separator < 0) {
        continue;
      }
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => {
        const [key, raw] = attribute.split('=');
        return key.trim().toLowerCase() === 'expires' && raw !== undefined && Date.parse(raw) < Date.now();
      });
      if (value === '' || expired) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async csrfToken(force = false): Promise<{ token: string; headerName: string }> {
    if (!this.csrf || force) {
      const response = await this.send('GET', '/api/v1/auth/csrf');
      const body = response.data as { token: string; headerName: string };
      this.csrf = { token: body.token, headerName: body.headerName };
    }
    return this.csrf;
  }

  private async send(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    const cookies = this.cookieHeader();
    if (cookies) {
      headers.cookie = cookies;
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
    });
    this.storeCookies(response.headers);
    const text = await response.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, ok: response.ok, data, headers: response.headers };
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const headers = { ...options.headers };
    if (UNSAFE.has(method.toUpperCase())) {
      const { token, headerName } = await this.csrfToken();
      headers[headerName] = token;
    }
    const result = await this.send(method.toUpperCase(), path, { ...options, headers });
    return result as ApiResult<T>;
  }

  get<T = unknown>(path: string): Promise<ApiResult<T>> {
    return this.request<T>('GET', path);
  }

  // ---- auth -------------------------------------------------------------------------------------------------

  async login(email: string, password: string): Promise<User> {
    // The antiforgery token belongs to the identity that fetched it; signing in changes the identity.
    this.csrf = null;
    const result = await this.request<{ user: User }>('POST', '/api/v1/auth/login', { body: { email, password } });
    if (!result.ok) {
      throw new Error(`login ${email} failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    this.csrf = null;
    return result.data.user;
  }

  async register(email: string, password: string, fullName = 'E2E Customer', mobileNumber?: string): Promise<User> {
    this.csrf = null;
    const result = await this.request<{ user: User }>('POST', '/api/v1/auth/register', {
      body: { email, fullName, password, mobileNumber },
    });
    if (!result.ok) {
      throw new Error(`register ${email} failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    this.csrf = null;
    return result.data.user;
  }

  async logout(): Promise<void> {
    await this.request('POST', '/api/v1/auth/logout');
    this.csrf = null;
  }

  async me(): Promise<ApiResult<{ user: User }>> {
    return this.get('/api/v1/auth/me');
  }

  // ---- catalog ----------------------------------------------------------------------------------------------

  async products(query: Record<string, string | number | boolean | undefined> = {}): Promise<PagedProducts> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        search.set(key, String(value));
      }
    }
    const result = await this.get<PagedProducts>(`/api/v1/products?${search.toString()}`);
    if (!result.ok) {
      throw new Error(`GET products failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return result.data;
  }

  async product(id: string): Promise<Product> {
    const result = await this.get<{ product: Product }>(`/api/v1/products/${encodeURIComponent(id)}`);
    if (!result.ok) {
      throw new Error(`GET product ${id} failed: ${result.status}`);
    }
    return result.data.product;
  }

  /** Sum of the stock of one variant, read fresh from the public API. */
  async variantStock(productId: string, variantId: string): Promise<number> {
    const product = await this.product(productId);
    const variant = product.variants.find((entry) => entry.id === variantId);
    if (!variant) {
      throw new Error(`Variant ${variantId} not found on ${productId}`);
    }
    return variant.stock;
  }

  // ---- checkout / orders ------------------------------------------------------------------------------------

  async quote(items: { variantId: string; quantity: number }[], discountCode?: string): Promise<CheckoutQuote> {
    const result = await this.request<QuoteResponse>('POST', '/api/v1/checkout/quote', {
      body: { items, discountCode: discountCode ?? null },
    });
    if (!result.ok) {
      throw new Error(`quote failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return result.data.quote;
  }

  async guestSession(): Promise<void> {
    await this.request('POST', '/api/v1/guest/session');
  }

  async placeOrder(
    items: { variantId: string; quantity: number }[],
    address: PlaceOrderPayload['shippingAddress'],
    idempotencyKey = newIdempotencyKey(),
  ): Promise<ApiResult<PlaceOrderResult>> {
    const quoted = await this.request<QuoteResponse>('POST', '/api/v1/checkout/quote', { body: { items } });
    return this.request<PlaceOrderResult>('POST', '/api/v1/orders', {
      body: { items, shippingAddress: address, quoteToken: quoted.data.quoteToken },
      headers: { 'x-idempotency-key': idempotencyKey },
    });
  }

  async order(id: string): Promise<ApiResult<{ order: Order }>> {
    return this.get(`/api/v1/orders/${encodeURIComponent(id)}`);
  }

  /** Changes one variant's price through the admin API (full-replace PUT built from the current product). */
  async setVariantPrice(productId: string, variantId: string, price: number): Promise<void> {
    const current = await this.get<{ product: Product }>(`/api/v1/admin/products/${productId}`);
    if (!current.ok) {
      throw new Error(`GET admin product failed: ${current.status}`);
    }
    const product = current.data.product;
    const body: ProductWrite = {
      name: product.name,
      brand: product.brand,
      category: product.category,
      subCategory: product.subCategory ?? null,
      description: product.description,
      ingredients: product.ingredients,
      howToUse: product.howToUse,
      price: variantId ? price : product.price,
      originalPrice: product.originalPrice ?? null,
      rating: product.rating,
      reviewsCount: product.reviewsCount,
      images: product.images,
      skinType: product.skinType ?? ['all'],
      finish: product.finish ?? null,
      coverage: product.coverage ?? null,
      shadeFamily: product.shadeFamily ?? null,
      isFeatured: product.isFeatured ?? false,
      isNewArrival: product.isNewArrival ?? false,
      isBestSeller: product.isBestSeller ?? false,
      status: product.status,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        shadeName: variant.shadeName ?? null,
        shadeHex: variant.shadeHex ?? null,
        size: variant.size ?? null,
        price: variant.id === variantId ? price : variant.price,
        stock: variant.stock,
        isActive: variant.isActive ?? true,
      })),
    };
    const result = await this.request('PUT', `/api/v1/admin/products/${productId}`, { body });
    if (!result.ok) {
      throw new Error(`update product failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
  }

  async createDiscount(body: DiscountWrite): Promise<void> {
    const result = await this.request('POST', '/api/v1/admin/discounts', { body });
    if (!result.ok) {
      throw new Error(`create discount failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
  }

  async customerOrders(page = 1, pageSize = 50): Promise<PagedOrders> {
    const result = await this.get<PagedOrders>(`/api/v1/customer/orders?page=${page}&pageSize=${pageSize}`);
    if (!result.ok) {
      throw new Error(`GET customer/orders failed: ${result.status}`);
    }
    return result.data;
  }

  async addresses(): Promise<UserAddress[]> {
    const result = await this.get<AddressesResponse>('/api/v1/customer/addresses');
    if (!result.ok) {
      throw new Error(`GET customer/addresses failed: ${result.status}`);
    }
    return result.data.addresses;
  }

  async wishlist(): Promise<string[]> {
    const result = await this.get<WishlistResponse>('/api/v1/customer/wishlist');
    if (!result.ok) {
      throw new Error(`GET customer/wishlist failed: ${result.status}`);
    }
    return result.data.productIds;
  }

  // ---- admin ------------------------------------------------------------------------------------------------

  async adminProducts(query: string): Promise<PagedProducts> {
    const result = await this.get<PagedProducts>(`/api/v1/admin/products?${query}`);
    if (!result.ok) {
      throw new Error(`GET admin/products failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return result.data;
  }

  async createProduct(body: ProductWrite): Promise<Product> {
    const result = await this.request<{ product: Product }>('POST', '/api/v1/admin/products', { body });
    if (!result.ok) {
      throw new Error(`create product failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
    return result.data.product;
  }

  async adjustStock(productId: string, variantId: string, delta: number, reason = 'e2e setup'): Promise<void> {
    const result = await this.request('POST', '/api/v1/admin/inventory/adjust', {
      body: { productId, variantId, delta, reason },
    });
    if (!result.ok) {
      throw new Error(`adjust stock failed: ${result.status} ${JSON.stringify(result.data)}`);
    }
  }
}

export function newIdempotencyKey(): string {
  return `e2e-${randomBytes(12).toString('hex')}`;
}

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}.${randomBytes(6).toString('hex')}@example.com`;
}

export function e2eEnv(): {
  baseUrl: string;
  adminEmail: string;
  adminPassword: string;
  customerEmail: string;
  customerPassword: string;
  runDir: string;
  attach: boolean;
} {
  const need = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing ${name}; run the specs through "npm run test:e2e".`);
    }
    return value;
  };
  return {
    baseUrl: need('E2E_BASE_URL'),
    adminEmail: need('E2E_ADMIN_EMAIL'),
    adminPassword: need('E2E_ADMIN_PASSWORD'),
    customerEmail: process.env.E2E_CUSTOMER_EMAIL ?? '',
    customerPassword: process.env.E2E_CUSTOMER_PASSWORD ?? '',
    runDir: need('E2E_RUN_DIR'),
    attach: process.env.E2E_ATTACH === '1',
  };
}

/** A logged-in administrator client built from the E2E_* environment. */
export async function adminClient(): Promise<ApiClient> {
  const env = e2eEnv();
  const client = new ApiClient(env.baseUrl);
  await client.login(env.adminEmail, env.adminPassword);
  return client;
}

/** A freshly registered customer (unique email) with its own cookie jar. */
export async function registerCustomer(
  prefix = 'e2e',
  fullName = 'E2E Customer',
): Promise<{ client: ApiClient; email: string; password: string; user: User }> {
  const env = e2eEnv();
  const client = new ApiClient(env.baseUrl);
  const email = uniqueEmail(prefix);
  const password = `Aa1!${randomBytes(9).toString('base64url')}`;
  const user = await client.register(email, password, fullName);
  return { client, email, password, user };
}
