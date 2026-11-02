export type Language = 'en' | 'ar';

export type Currency = 'EGP' | 'USD';

export type ProductCategory = 
  | 'makeup'
  | 'skincare'
  | 'haircare'
  | 'fragrance'
  | 'tools';

export interface LocalizedString {
  en: string;
  ar: string;
}

export interface ProductVariant {
  id: string;
  sku: string;
  shadeName?: LocalizedString;
  shadeHex?: string;
  size?: string;
  price: number;
  stock: number;
  isActive?: boolean;
  version?: string;
  image?: string;
}

export type SkinType = 'all' | 'dry' | 'oily' | 'combination' | 'sensitive';
export type MakeupFinish = 'matte' | 'dewy' | 'radiant' | 'satin' | 'natural';
export type Coverage = 'sheer' | 'medium' | 'full';

export interface Product {
  id: string;
  name: LocalizedString;
  brand: string;
  category: ProductCategory;
  subCategory?: string;
  description: LocalizedString;
  ingredients: LocalizedString;
  howToUse: LocalizedString;
  price: number; // base / starting price
  originalPrice?: number; // for showing sale discounts
  rating: number;
  reviewsCount: number;
  images: string[];
  variants: ProductVariant[];
  skinType?: SkinType[];
  finish?: MakeupFinish;
  coverage?: Coverage;
  shadeFamily?: string;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  status: 'published' | 'archived';
  createdAt: string;
}

export interface CategoryItem {
  id: ProductCategory;
  name: LocalizedString;
  description: LocalizedString;
  iconName: string;
  imageUrl: string;
}

export interface BrandItem {
  id: string;
  name: string;
  origin: string;
  logoUrl?: string;
}

export interface PromotionalBanner {
  id: string;
  title: LocalizedString;
  subtitle: LocalizedString;
  badge: LocalizedString;
  ctaText: LocalizedString;
  ctaCategory?: ProductCategory;
  imageUrl: string;
  discountCode?: string;
  active: boolean;
  order: number;
}

export interface DiscountCode {
  code: string;
  type: 'percentage' | 'fixed';
  value: number; // percentage (e.g. 15 for 15%) or fixed amount (e.g. 50 EGP)
  minOrderAmount: number;
  maxDiscount?: number;
  expiryDate: string; // ISO string
  usageLimit: number;
  currentUsage: number;
  active: boolean;
}

export interface CartItem {
  id: string; // unique item id in cart (productId + variantId)
  productId: string;
  productName: LocalizedString;
  brand: string;
  variantId: string;
  variantSku: string;
  shadeName?: LocalizedString;
  shadeHex?: string;
  size?: string;
  unitPrice: number;
  quantity: number;
  image: string;
  stock: number;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  appliedDiscountCode?: string;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  amountNeededForFreeDelivery: number;
  total: number;
}

export type OrderStatus = 'Pending' | 'Confirmed' | 'Shipped' | 'Delivered' | 'Cancelled';

export interface ShippingAddress {
  fullName: string;
  mobileNumber: string;
  governorate: string;
  city: string;
  streetAddress: string;
  buildingApt?: string;
  deliveryNotes?: string;
}

export interface UserAddress extends ShippingAddress {
  id: string;
  label?: string;
  isDefault?: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId?: string;
  customerEmail?: string;
  shippingAddress: ShippingAddress;
  items: CartItem[];
  subtotal: number;
  discountAmount: number;
  discountCode?: string;
  deliveryFee: number;
  total: number;
  paymentMethod: 'cash_on_delivery';
  currency?: string;
  paymentStatus?: 'Unpaid' | 'Collected';
  paymentCollectedAt?: string;
  paymentCollectedAmount?: number;
  status: OrderStatus;
  statusHistory: {
    status: OrderStatus;
    changedAt: string;
    note?: string;
  }[];
  stockRestored?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  mobileNumber?: string;
  role: 'admin' | 'customer';
  addresses: UserAddress[];
  wishlist: string[]; // product IDs
}

export interface AdminMetrics {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  ordersByStatus: Record<OrderStatus, number>;
  lowStockCount: number;
  collectedRevenue?: number;
  totalProducts: number;
  lowStockItems: {
    productId: string;
    productName: LocalizedString;
    variantSku: string;
    shadeName?: LocalizedString;
    size?: string;
    stock: number;
  }[];
}

export type NavigationExtra =
  | { category?: ProductCategory; search?: string; sort?: string }
  | Product;
