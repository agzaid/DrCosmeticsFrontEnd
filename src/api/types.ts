import type { AdminMetrics, BrandItem, CategoryItem, LocalizedString, Order, Product, PromotionalBanner, User, UserAddress } from '../types';

export interface Paged {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PagedProducts extends Paged {
  products: Product[];
}

export interface PagedOrders extends Paged {
  orders: Order[];
}

export interface ProductSearchParams {
  ids?: string;
  category?: string;
  brand?: string;
  search?: string;
  skinType?: string;
  finish?: string;
  coverage?: string;
  shadeFamily?: string;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
  status?: string;
}

export interface CartLineInput {
  variantId: string;
  quantity: number;
}

export interface QuoteIssue {
  code: string;
  message: string;
  variantId?: string | null;
}

export interface QuoteLine {
  variantId: string;
  productId: string;
  productName: LocalizedString;
  brand: string;
  variantSku: string;
  shadeName?: LocalizedString | null;
  shadeHex?: string | null;
  size?: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  availableStock: number;
  image: string;
}

export interface CheckoutQuote {
  lines: QuoteLine[];
  subtotal: number;
  discountAmount: number;
  appliedDiscountCode?: string | null;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  amountNeededForFreeDelivery: number;
  total: number;
  currency: string;
  issues: QuoteIssue[];
}

export interface QuoteResponse {
  quote: CheckoutQuote;
  quoteToken: string;
  expiresAt: string;
}

export interface ShippingAddressPayload {
  fullName: string;
  mobileNumber: string;
  governorate: string;
  city: string;
  streetAddress: string;
  buildingApt?: string;
  deliveryNotes?: string;
}

export interface PlaceOrderPayload {
  items: CartLineInput[];
  shippingAddress: ShippingAddressPayload;
  discountCode?: string | null;
  customerEmail?: string | null;
  quoteToken: string;
}

export interface PlaceOrderResult {
  order: Order;
  isDuplicate: boolean;
  guestAccessHint?: string | null;
}

export interface AuthUserResponse {
  user: User;
}

export interface CsrfResponse {
  token: string;
  headerName: string;
}

export interface AddressesResponse {
  addresses: UserAddress[];
}

export interface WishlistResponse {
  productIds: string[];
}

export interface CategoriesResponse {
  categories: CategoryItem[];
}

export interface BrandsResponse {
  brands: BrandItem[];
}

export interface BannersResponse {
  banners: PromotionalBanner[];
}

export interface RegisterPayload {
  email: string;
  fullName: string;
  mobileNumber?: string;
  password: string;
}

export interface VariantWrite {
  id?: string | null;
  sku: string;
  shadeName?: LocalizedString | null;
  shadeHex?: string | null;
  size?: string | null;
  price: number;
  stock: number;
  isActive: boolean;
}

export interface ProductWrite {
  name: LocalizedString;
  brand: string;
  category: string;
  subCategory?: string | null;
  description: LocalizedString;
  ingredients: LocalizedString;
  howToUse: LocalizedString;
  price: number;
  originalPrice?: number | null;
  rating: number;
  reviewsCount: number;
  images: string[];
  skinType: string[];
  finish?: string | null;
  coverage?: string | null;
  shadeFamily?: string | null;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  status: 'published' | 'archived';
  variants: VariantWrite[];
}

export interface InventoryAdjustPayload {
  productId: string;
  variantId: string;
  delta?: number;
  newStock?: number;
  expectedVersion?: string;
  reason?: string;
}

export interface DiscountWrite {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderAmount: number;
  maxDiscount?: number | null;
  expiryDate: string;
  usageLimit: number;
  active: boolean;
}

export interface AdminOrderSearchParams {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminMetricsResponse {
  metrics: AdminMetrics;
}

export interface DiscountRecord {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderAmount: number;
  maxDiscount?: number | null;
  expiryDate: string;
  usageLimit: number;
  currentUsage: number;
  active: boolean;
}
