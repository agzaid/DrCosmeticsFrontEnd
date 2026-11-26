import type { AdminMetrics, BrandItem, CategoryItem, LocalizedString, Order, Product, PromotionalBanner, User, UserAddress } from '../types';

/** What the server answers when it stores a file (POST /files/images or /files/documents), and one library row. */
export interface StoredFile {
  id: string;
  kind: 'image' | 'document';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** An image's public address (/media/...), or the API address a signed-in administrator downloads a document from. */
  url: string;
  uploadedAtUtc: string;
}

/** One page of the file library (GET /files). It carries no totalPages: the caller has the page size. */
export interface StoredFilesPage {
  items: StoredFile[];
  page: number;
  pageSize: number;
  total: number;
}

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

export interface ResetPasswordPayload {
  email: string;
  token: string;
  newPassword: string;
}

export interface PasswordResetLink {
  email: string;
  token: string;
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

/** A brand as the admin console lists it: the storefront fields plus how many products carry it. */
export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  origin: string;
  logoUrl?: string | null;
  productCount: number;
}

export interface BrandsAdminResponse {
  brands: AdminBrand[];
}

/** The delivery terms quoted to shoppers; the admin response also carries who last changed them. */
export interface DeliverySettings {
  deliveryFee: number;
  freeShippingThreshold: number;
  updatedAtUtc?: string;
  updatedBy?: string | null;
}

export interface DeliverySettingsWrite {
  deliveryFee: number;
  freeShippingThreshold: number;
}

/** What the admin brand form posts; the server mints the id and the slug. */
export interface BrandWrite {
  name: string;
  origin?: string | null;
  logoUrl?: string | null;
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
  brandId: string;
  categoryId: string;
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

/** One price read from another shop's page. */
export interface ScraperReading {
  id: number;
  price: number;
  /** ISO code the page states for the price; null when it does not say. */
  currency: string | null;
  /** Where on the page the price was found: json-ld, meta, microdata or markup. */
  strategy: string;
  /** How the page was got: http, or browser (a real browser that runs the page's scripts). */
  engine: string;
  /** The product name the page gives, so a link to the wrong product is easy to spot. */
  title: string | null;
  readAtUtc: string;
  appliedPrice: number | null;
  appliedAtUtc: string | null;
}

/** Which way a check failed, as the server names it; null when there is no failure or the text is not one it worded. */
export type ScraperFailureKind =
  | 'NoPrice'
  | 'Blocked'
  | 'Refused'
  | 'NotFound'
  | 'Unreachable'
  | 'TimedOut'
  | 'TooLarge'
  | 'NotAPage'
  | 'Failed';

/** One variant of the price scraper list: what the shop charges, the link to the other shop and the newest reading of it. */
export interface ScraperRow {
  variantId: string;
  productId: string;
  productName: LocalizedString;
  imageUrl: string | null;
  sku: string;
  shade: LocalizedString | null;
  size: string | null;
  variantActive: boolean;
  /** What the shop charges for the variant now. */
  price: number;
  /** The other shop's product page; null when the variant is not linked. */
  url: string | null;
  lastCheckedAtUtc: string | null;
  /** The last check's failure (English), kept until a later check succeeds. */
  lastError: string | null;
  lastErrorKind: ScraperFailureKind | null;
  latest: ScraperReading | null;
  /** How much dearer (positive) or cheaper (negative) the other shop is, as a fraction of our price; null when they cannot be compared. */
  gap: number | null;
  /** True only when the variant is linked and its newest reading is in EGP, recent and usable. */
  canApply: boolean;
}

export type ScraperState = 'all' | 'linked' | 'unlinked' | 'cheaper' | 'dearer' | 'failed';

export type ScraperSort = 'product' | 'gap' | 'checked';

export interface ScraperSearchParams {
  search?: string;
  state?: ScraperState;
  sort?: ScraperSort;
  page?: number;
  pageSize?: number;
}

export interface PagedScraperRows extends Paged {
  rows: ScraperRow[];
}

/** A linked variant, for the "check all" loop. */
export interface ScraperTarget {
  variantId: string;
  label: string;
}

export interface ScraperHistory {
  row: ScraperRow;
  readings: ScraperReading[];
}

export interface ScraperLinkResult {
  row: ScraperRow;
  /** True when an existing link was removed. */
  removed: boolean;
}

/** A check that finds no price is still a result (found: false); the reason is on the row. */
export interface ScraperCheckResult {
  found: boolean;
  message: string;
  checkedAtUtc: string;
  row: ScraperRow;
}

export interface ScraperApplied {
  variantId: string;
  sku: string;
  previousPrice: number;
  newPrice: number;
}

export interface ScraperApplyResult {
  applied: ScraperApplied;
  row: ScraperRow;
}

export interface ScraperBulkSummary {
  applied: number;
  /** Readings whose price was already what the variant costs. */
  unchanged: number;
  skipped: { variantId: string; sku: string; reason: string }[];
}

/** How an automatic run of the price scraper went (or is going). */
export interface ScraperRun {
  startedAtUtc: string;
  /** Null while the run is going. */
  finishedAtUtc: string | null;
  /** How many linked pages the run set out to read. */
  total: number;
  /** How many it has read so far, with or without finding a price. */
  done: number;
  /** How many of those pages showed a price. */
  found: number;
  /** The run ended before it had read every page (the host stopped, or something failed). */
  interrupted: boolean;
}

/** The automatic daily price check. It only reads pages: no price changes by itself. */
export interface ScraperSchedule {
  enabled: boolean;
  /** 24-hour HH:mm on the shop's clock. */
  time: string;
  /** The time zone that clock is in (an IANA name when the server knows one). */
  timeZone: string;
  /** When the next run starts; null while the schedule is off. */
  nextRunAtUtc: string | null;
  lastRun: ScraperRun | null;
}

export interface ScraperScheduleInput {
  enabled: boolean;
  /** 24-hour HH:mm on the shop's clock. */
  time: string;
}
