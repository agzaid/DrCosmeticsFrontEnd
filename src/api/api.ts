import { ApiError, apiRequest, buildQuery, invalidateCsrfToken } from './httpClient';
import type {
  AddressesResponse,
  AuthUserResponse,
  BannersResponse,
  BrandsResponse,
  CartLineInput,
  CategoriesResponse,
  DiscountRecord,
  DiscountWrite,
  InventoryAdjustPayload,
  PagedOrders,
  PagedProducts,
  AdminOrderSearchParams,
  AdminMetricsResponse,
  PlaceOrderPayload,
  PlaceOrderResult,
  ProductSearchParams,
  ProductWrite,
  QuoteResponse,
  RegisterPayload,
  ShippingAddressPayload,
  WishlistResponse,
} from './types';
import type { Order, Product, PromotionalBanner, User, UserAddress } from '../types';

const GUEST_MARKER = 'luma_guest_scope';
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

  async uploadImage(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const data = await apiRequest<{ url: string }>('/admin/images', { method: 'POST', formData: form });
    return data.url;
  },
};
