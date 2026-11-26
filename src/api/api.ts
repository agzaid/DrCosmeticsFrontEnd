import { ApiError, apiRequest, buildQuery, invalidateCsrfToken } from './httpClient';
import type {
  AddressesResponse,
  AdminBrand,
  AuthUserResponse,
  BannersResponse,
  BrandWrite,
  BrandsAdminResponse,
  BrandsResponse,
  CartLineInput,
  CategoriesResponse,
  DeliverySettings,
  DeliverySettingsWrite,
  DiscountRecord,
  DiscountWrite,
  InventoryAdjustPayload,
  PagedOrders,
  PagedProducts,
  PagedScraperRows,
  AdminOrderSearchParams,
  AdminMetricsResponse,
  PlaceOrderPayload,
  PlaceOrderResult,
  ProductSearchParams,
  ProductWrite,
  QuoteResponse,
  RegisterPayload,
  ResetPasswordPayload,
  ScraperApplyResult,
  ScraperBulkSummary,
  ScraperCheckResult,
  ScraperHistory,
  ScraperLinkResult,
  ScraperSchedule,
  ScraperScheduleInput,
  ScraperSearchParams,
  ScraperTarget,
  ShippingAddressPayload,
  StoredFile,
  StoredFilesPage,
  WishlistResponse,
} from './types';
import type { BrandItem, Language, Order, Product, PromotionalBanner, User, UserAddress } from '../types';

const GUEST_MARKER = 'luma_guest_scope';

/** Sends one file to the files API, which stores it in the folder for its kind and records it. */
function uploadFile(kind: 'images' | 'documents', file: File): Promise<StoredFile> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<StoredFile>(`/files/${kind}`, { method: 'POST', formData: form });
}
let guestSessionReady = false;

export const authApi = {
  async me(): Promise<User | null> {
    try {
      const data = await apiRequest<AuthUserResponse>('/auth/me');
      return data.user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },

  async login(email: string, password: string): Promise<User> {
    const data = await apiRequest<AuthUserResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    invalidateCsrfToken();
    return data.user;
  },

  async register(payload: RegisterPayload): Promise<User> {
    const data = await apiRequest<AuthUserResponse>('/auth/register', {
      method: 'POST',
      body: payload,
    });
    invalidateCsrfToken();
    return data.user;
  },

  async logout(): Promise<void> {
    await apiRequest<void>('/auth/logout', { method: 'POST' });
    invalidateCsrfToken();
    guestSessionReady = false;
  },

  async requestPasswordReset(email: string, language: Language): Promise<void> {
    await apiRequest<void>('/auth/forgot-password', { method: 'POST', body: { email, language } });
  },

  async resetPassword(payload: ResetPasswordPayload): Promise<void> {
    await apiRequest<void>('/auth/reset-password', { method: 'POST', body: payload });
    invalidateCsrfToken();
  },
};

export const catalogApi = {
  products(params: ProductSearchParams = {}, signal?: AbortSignal): Promise<PagedProducts> {
    return apiRequest<PagedProducts>(`/products${buildQuery(params as Record<string, unknown>)}`, { signal });
  },

  async product(id: string, signal?: AbortSignal): Promise<Product> {
    const data = await apiRequest<{ product: Product }>(`/products/${encodeURIComponent(id)}`, { signal });
    return data.product;
  },

  async productsByIds(ids: string[], signal?: AbortSignal): Promise<Product[]> {
    if (ids.length === 0) {
      return [];
    }
    const page = await catalogApi.products({ ids: ids.join(','), pageSize: 60 }, signal);
    return page.products;
  },

  async categories(signal?: AbortSignal): Promise<CategoriesResponse['categories']> {
    const data = await apiRequest<CategoriesResponse>('/categories', { signal });
    return data.categories;
  },

  async brands(signal?: AbortSignal): Promise<BrandsResponse['brands']> {
    const data = await apiRequest<BrandsResponse>('/brands', { signal });
    return data.brands;
  },

  async banners(signal?: AbortSignal): Promise<PromotionalBanner[]> {
    const data = await apiRequest<BannersResponse>('/banners', { signal });
    return data.banners;
  },

  async deliverySettings(signal?: AbortSignal): Promise<DeliverySettings> {
    const data = await apiRequest<{ settings: DeliverySettings }>('/settings/delivery', { signal });
    return data.settings;
  },
};

export const checkoutApi = {
  quote(items: CartLineInput[], discountCode?: string | null, signal?: AbortSignal): Promise<QuoteResponse> {
    return apiRequest<QuoteResponse>('/checkout/quote', {
      method: 'POST',
      body: { items, discountCode: discountCode ?? null },
      signal,
    });
  },

  async ensureGuestSession(force = false): Promise<void> {
    if (!force && (guestSessionReady || sessionStorage.getItem(GUEST_MARKER))) {
      guestSessionReady = true;
      return;
    }

    await apiRequest('/guest/session', { method: 'POST' });
    sessionStorage.setItem(GUEST_MARKER, '1');
    guestSessionReady = true;
  },

  async placeOrder(payload: PlaceOrderPayload, idempotencyKey: string): Promise<PlaceOrderResult> {
    try {
      return await apiRequest<PlaceOrderResult>('/orders', {
        method: 'POST',
        body: payload,
        idempotencyKey,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NotAuthenticated') {
        await checkoutApi.ensureGuestSession(true);
        return apiRequest<PlaceOrderResult>('/orders', {
          method: 'POST',
          body: payload,
          idempotencyKey,
        });
      }
      throw error;
    }
  },

  async order(id: string, signal?: AbortSignal): Promise<PlaceOrderResult['order']> {
    const data = await apiRequest<{ order: PlaceOrderResult['order'] }>(`/orders/${encodeURIComponent(id)}`, { signal });
    return data.order;
  },

  /** Issues the order's invoice on first call; later calls return the same stored number. */
  async issueInvoice(id: string): Promise<Order> {
    const data = await apiRequest<{ order: Order }>(`/orders/${encodeURIComponent(id)}/invoice`, {
      method: 'POST',
    });
    return data.order;
  },

  async attempt(idempotencyKey: string): Promise<PlaceOrderResult> {
    return apiRequest<PlaceOrderResult>(`/checkout/attempts/${encodeURIComponent(idempotencyKey)}`);
  },
};

export const customerApi = {
  async orders(page = 1, pageSize = 10): Promise<PagedOrders> {
    return apiRequest<PagedOrders>(`/customer/orders${buildQuery({ page, pageSize })}`);
  },

  async cancelOrder(id: string): Promise<Order> {
    const data = await apiRequest<{ order: Order }>(`/orders/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
    return data.order;
  },

  async addresses(): Promise<UserAddress[]> {
    const data = await apiRequest<AddressesResponse>('/customer/addresses');
    return data.addresses;
  },

  async addAddress(address: ShippingAddressPayload & { label?: string; isDefault?: boolean }): Promise<UserAddress[]> {
    const data = await apiRequest<AddressesResponse>('/customer/addresses', {
      method: 'POST',
      body: address,
    });
    return data.addresses;
  },

  async deleteAddress(id: string): Promise<UserAddress[]> {
    const data = await apiRequest<AddressesResponse>(`/customer/addresses/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return data.addresses;
  },

  async wishlist(): Promise<string[]> {
    const data = await apiRequest<WishlistResponse>('/customer/wishlist');
    return data.productIds;
  },

  addWishlistItem(productId: string): Promise<void> {
    return apiRequest<void>(`/customer/wishlist/${encodeURIComponent(productId)}`, { method: 'PUT' });
  },

  removeWishlistItem(productId: string): Promise<void> {
    return apiRequest<void>(`/customer/wishlist/${encodeURIComponent(productId)}`, { method: 'DELETE' });
  },
};

export const adminApi = {
  async metrics(): Promise<AdminMetricsResponse['metrics']> {
    const data = await apiRequest<AdminMetricsResponse>('/admin/metrics');
    return data.metrics;
  },

  async brands(): Promise<AdminBrand[]> {
    const data = await apiRequest<BrandsAdminResponse>('/admin/brands');
    return data.brands;
  },

  async deliverySettings(): Promise<DeliverySettings> {
    const data = await apiRequest<{ settings: DeliverySettings }>('/admin/settings/delivery');
    return data.settings;
  },

  async updateDeliverySettings(payload: DeliverySettingsWrite): Promise<DeliverySettings> {
    const data = await apiRequest<{ settings: DeliverySettings }>('/admin/settings/delivery', {
      method: 'PUT',
      body: payload,
    });
    return data.settings;
  },

  async createBrand(payload: BrandWrite): Promise<BrandItem> {
    const data = await apiRequest<{ brand: BrandItem }>('/admin/brands', { method: 'POST', body: payload });
    return data.brand;
  },

  async updateBrand(id: string, payload: BrandWrite): Promise<BrandItem> {
    const data = await apiRequest<{ brand: BrandItem }>(`/admin/brands/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
    });
    return data.brand;
  },

  async deleteBrand(id: string): Promise<BrandItem> {
    const data = await apiRequest<{ brand: BrandItem }>(`/admin/brands/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return data.brand;
  },

  orders(params: AdminOrderSearchParams = {}): Promise<PagedOrders> {
    return apiRequest<PagedOrders>(`/admin/orders${buildQuery(params as Record<string, unknown>)}`);
  },

  async changeOrderStatus(id: string, status: string, note?: string): Promise<Order> {
    const data = await apiRequest<{ order: Order }>(`/admin/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status, note: note ?? null },
    });
    return data.order;
  },

  async collectPayment(id: string, amount?: number, note?: string): Promise<Order> {
    const data = await apiRequest<{ order: Order }>(`/admin/orders/${encodeURIComponent(id)}/payment/collect`, {
      method: 'POST',
      body: { amount: amount ?? null, note: note ?? null },
    });
    return data.order;
  },

  async issueInvoice(id: string): Promise<Order> {
    const data = await apiRequest<{ order: Order }>(`/admin/orders/${encodeURIComponent(id)}/invoice`, {
      method: 'POST',
    });
    return data.order;
  },

  products(params: ProductSearchParams = {}): Promise<PagedProducts> {
    return apiRequest<PagedProducts>(`/admin/products${buildQuery(params as Record<string, unknown>)}`);
  },

  async product(id: string): Promise<Product> {
    const data = await apiRequest<{ product: Product }>(`/admin/products/${encodeURIComponent(id)}`);
    return data.product;
  },

  async createProduct(payload: ProductWrite): Promise<Product> {
    const data = await apiRequest<{ product: Product }>('/admin/products', { method: 'POST', body: payload });
    return data.product;
  },

  async updateProduct(id: string, payload: ProductWrite): Promise<Product> {
    const data = await apiRequest<{ product: Product }>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: payload,
    });
    return data.product;
  },

  async archiveProduct(id: string): Promise<Product> {
    const data = await apiRequest<{ product: Product }>(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return data.product;
  },

  async adjustInventory(payload: InventoryAdjustPayload): Promise<Product> {
    const data = await apiRequest<{ product: Product }>('/admin/inventory/adjust', {
      method: 'POST',
      body: payload,
    });
    return data.product;
  },

  async discounts(): Promise<DiscountRecord[]> {
    const data = await apiRequest<{ discounts: DiscountRecord[] }>('/admin/discounts');
    return data.discounts;
  },

  async createDiscount(payload: DiscountWrite): Promise<DiscountRecord> {
    const data = await apiRequest<{ discount: DiscountRecord }>('/admin/discounts', {
      method: 'POST',
      body: payload,
    });
    return data.discount;
  },

  async archiveDiscount(code: string): Promise<DiscountRecord> {
    const data = await apiRequest<{ discount: DiscountRecord }>(
      `/admin/discounts/${encodeURIComponent(code)}`,
      { method: 'DELETE' },
    );
    return data.discount;
  },

  async banners(): Promise<PromotionalBanner[]> {
    const data = await apiRequest<BannersResponse>('/admin/banners');
    return data.banners;
  },

  async saveBanners(banners: PromotionalBanner[]): Promise<PromotionalBanner[]> {
    const data = await apiRequest<BannersResponse>('/admin/banners', {
      method: 'PUT',
      body: { banners },
    });
    return data.banners;
  },

  /** One page of the price scraper list: every variant with its link to another shop and the newest reading of it. */
  scraperRows(params: ScraperSearchParams = {}): Promise<PagedScraperRows> {
    return apiRequest<PagedScraperRows>(`/admin/scraper${buildQuery(params as Record<string, unknown>)}`);
  },

  /** Every linked variant, for the "check all" loop. */
  async scraperTargets(): Promise<ScraperTarget[]> {
    const data = await apiRequest<{ targets: ScraperTarget[] }>('/admin/scraper/targets');
    return data.targets;
  },

  scraperHistory(variantId: string): Promise<ScraperHistory> {
    return apiRequest<ScraperHistory>(`/admin/scraper/${encodeURIComponent(variantId)}/history`);
  },

  /** Links the variant to a page of another shop, or moves the link. A blank address removes it. */
  setScraperLink(variantId: string, url: string): Promise<ScraperLinkResult> {
    return apiRequest<ScraperLinkResult>(`/admin/scraper/${encodeURIComponent(variantId)}/link`, {
      method: 'PUT',
      body: { url },
    });
  },

  removeScraperLink(variantId: string): Promise<ScraperLinkResult> {
    return apiRequest<ScraperLinkResult>(`/admin/scraper/${encodeURIComponent(variantId)}/link`, {
      method: 'DELETE',
    });
  },

  /** Reads the price on the variant's linked page. The server may take up to a minute for a shop that needs a browser. */
  checkScraperPrice(variantId: string): Promise<ScraperCheckResult> {
    return apiRequest<ScraperCheckResult>(`/admin/scraper/${encodeURIComponent(variantId)}/check`, {
      method: 'POST',
    });
  },

  /** Sets the variant's price to the newest reading, less the reduction (in EGP). */
  applyScraperPrice(variantId: string, decrease: number): Promise<ScraperApplyResult> {
    return apiRequest<ScraperApplyResult>(`/admin/scraper/${encodeURIComponent(variantId)}/apply`, {
      method: 'POST',
      body: { decrease },
    });
  },

  /** Applies every fresh reading in EGP that has not been applied yet; variants that cannot be applied are skipped with a reason. */
  async applyAllScraperPrices(decrease: number): Promise<ScraperBulkSummary> {
    const data = await apiRequest<{ summary: ScraperBulkSummary }>('/admin/scraper/apply-all', {
      method: 'POST',
      body: { decrease },
    });
    return data.summary;
  },

  /** The automatic daily price check: on or off, its time, when it runs next and how its latest run went. */
  async scraperSchedule(): Promise<ScraperSchedule> {
    const data = await apiRequest<{ schedule: ScraperSchedule }>('/admin/scraper/schedule');
    return data.schedule;
  },

  /** Switches the automatic price check on or off and sets the time it starts each day (on the shop's clock). */
  async saveScraperSchedule(input: ScraperScheduleInput): Promise<ScraperSchedule> {
    const data = await apiRequest<{ schedule: ScraperSchedule }>('/admin/scraper/schedule', {
      method: 'PUT',
      body: input,
    });
    return data.schedule;
  },

  /**
   * One page of everything that has been uploaded, newest first. It is how a stored picture is found again and the
   * only way to reach a document, which has no public address.
   */
  files(params: { kind?: 'image' | 'document'; search?: string; page?: number; pageSize?: number } = {}): Promise<StoredFilesPage> {
    return apiRequest<StoredFilesPage>(`/files${buildQuery(params as Record<string, unknown>)}`);
  },

  /** Stores an image and answers with its public address (/media/...). */
  async uploadImage(file: File): Promise<string> {
    return (await uploadFile('images', file)).url;
  },

  /** Stores a document (PDF, Word, Excel, CSV or text). Its `url` is an API address that needs an administrator. */
  uploadDocument(file: File): Promise<StoredFile> {
    return uploadFile('documents', file);
  },
};
