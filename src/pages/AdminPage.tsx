import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Banknote,
  CheckCircle2,
  Clock,
  Edit3,
  Image as ImageIcon,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Tag,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { adminApi, catalogApi } from '../api/api';
import { ApiError } from '../api/httpClient';
import { mediaUrl } from '../api/config';
import type {
  DiscountRecord,
  DiscountWrite,
  InventoryAdjustPayload,
  ProductWrite,
  VariantWrite,
} from '../api/types';
import type {
  AdminMetrics,
  BrandItem,
  CategoryItem,
  Language,
  LocalizedString,
  Order,
  OrderStatus,
  Product,
  PromotionalBanner,
} from '../types';
import { AdminModal } from '../components/admin/AdminModal';

type AdminTab = 'overview' | 'products' | 'orders' | 'inventory' | 'discounts' | 'banners';

const SKIN_TYPE_OPTIONS = ['all', 'dry', 'oily', 'combination', 'sensitive'];
const FINISH_OPTIONS = ['matte', 'dewy', 'radiant', 'satin', 'natural'];
const COVERAGE_OPTIONS = ['sheer', 'medium', 'full'];

const ORDER_STATUSES: OrderStatus[] = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];

const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Shipped', 'Cancelled'],
  Shipped: ['Delivered'],
  Delivered: [],
  Cancelled: [],
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Display labels for every enumerated value the admin UI prints (the API returns English keys). */
const ENUM_LABELS: Record<string, LocalizedString> = {
  Unpaid: { en: 'Unpaid', ar: 'غير مدفوع' },
  Collected: { en: 'Collected', ar: 'تم التحصيل' },
  published: { en: 'Published', ar: 'منشور' },
  archived: { en: 'Archived', ar: 'مؤرشف' },
  all: { en: 'All', ar: 'الكل' },
  dry: { en: 'Dry', ar: 'جافة' },
  oily: { en: 'Oily', ar: 'دهنية' },
  combination: { en: 'Combination', ar: 'مختلطة' },
  sensitive: { en: 'Sensitive', ar: 'حساسة' },
  matte: { en: 'Matte', ar: 'مطفية' },
  dewy: { en: 'Dewy', ar: 'منتعشة' },
  radiant: { en: 'Radiant', ar: 'مشرقة' },
  satin: { en: 'Satin', ar: 'ساتان' },
  natural: { en: 'Natural', ar: 'طبيعية' },
  sheer: { en: 'Sheer', ar: 'خفيفة' },
  medium: { en: 'Medium', ar: 'متوسطة' },
  full: { en: 'Full', ar: 'كاملة' },
};

interface ErrorCopy {
  /** Absent = show the server's own English detail. */
  en?: string;
  ar: string;
}

const SERVER_ERROR: LocalizedString = {
  en: 'The server could not complete this request. Try again in a moment.',
  ar: 'تعذّر على الخادم إكمال هذا الطلب. حاول مرة أخرى بعد قليل.',
};

const NETWORK_ERROR: LocalizedString = {
  en: 'Could not reach the server. Check your connection and try again.',
  ar: 'تعذّر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.',
};

const ERROR_COPY: Record<string, ErrorCopy> = {
  NotAuthenticated: {
    en: 'Your session has ended. Sign in again.',
    ar: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
  },
  Forbidden: {
    en: 'You do not have permission to do that.',
    ar: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
  },
  NotFound: {
    en: 'This item no longer exists. Refresh and try again.',
    ar: 'هذا العنصر لم يعد موجوداً. حدّث الصفحة وحاول مرة أخرى.',
  },
  ValidationFailed: { ar: 'يرجى مراجعة الحقول المُدخلة ثم المحاولة مرة أخرى.' },
  InventoryConflict: {
    en: 'The stock changed while you were working. The current stock is shown now; review it and try again.',
    ar: 'تغيّر المخزون أثناء عملك. يظهر الآن المخزون الحالي؛ راجعه وحاول مرة أخرى.',
  },
  InvalidOrderTransition: {
    en: 'This order cannot move to that status from its current state. Its latest state is shown.',
    ar: 'لا يمكن نقل هذا الطلب إلى تلك الحالة من حالته الحالية. تظهر الآن أحدث حالة له.',
  },
  PaymentCollectedCannotCancel: {
    en: 'Cash has already been collected for this order, so it can no longer be cancelled.',
    ar: 'تم تحصيل نقدية هذا الطلب بالفعل، لذلك لا يمكن إلغاؤه.',
  },
  PaymentNotEligible: {
    en: 'Cash can only be collected after the order has been shipped.',
    ar: 'لا يمكن تحصيل النقدية إلا بعد شحن الطلب.',
  },
  PaymentConflict: {
    en: 'The payment state of this order changed. Its latest state is shown.',
    ar: 'تغيّرت حالة دفع هذا الطلب. تظهر الآن أحدث حالة.',
  },
  OutcomeUnknown: {
    en: 'We could not confirm whether this change was saved. The current values are shown; check them before trying again.',
    ar: 'تعذّر التأكد من حفظ هذا التغيير. تظهر الآن القيم الحالية؛ راجعها قبل المحاولة مرة أخرى.',
  },
  SkuAlreadyExists: { ar: 'كود SKU هذا مستخدم بالفعل في منتج آخر. اختر كوداً مختلفاً.' },
  DuplicateDiscountCode: { ar: 'كود الخصم هذا موجود بالفعل. اختر كوداً مختلفاً.' },
  InvalidPaging: { en: 'That page is out of range.', ar: 'هذه الصفحة خارج النطاق.' },
  CsrfVerificationFailed: {
    en: 'Your session security token expired. Refresh the page and try again.',
    ar: 'انتهت صلاحية رمز أمان الجلسة. حدّث الصفحة وحاول مرة أخرى.',
  },
};

const INPUT_CLASS = 'w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5';
const SELECT_CLASS = 'w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 font-semibold';

interface VariantDraft {
  id: string | null;
  sku: string;
  shadeEn: string;
  shadeAr: string;
  shadeHex: string;
  size: string;
  price: string;
  stock: string;
  isActive: boolean;
}

interface ProductDraft {
  id: string | null;
  name: LocalizedString;
  brand: string;
  category: string;
  subCategory: string;
  description: LocalizedString;
  ingredients: LocalizedString;
  howToUse: LocalizedString;
  price: string;
  originalPrice: string;
  rating: string;
  reviewsCount: string;
  images: string[];
  skinType: string[];
  finish: string;
  coverage: string;
  shadeFamily: string;
  isFeatured: boolean;
  isNewArrival: boolean;
  isBestSeller: boolean;
  status: 'published' | 'archived';
  variants: VariantDraft[];
}

interface DiscountDraft {
  code: string;
  type: 'percentage' | 'fixed';
  value: string;
  minOrderAmount: string;
  maxDiscount: string;
  expiryDate: string;
  usageLimit: string;
  active: boolean;
}

function errorMessage(error: unknown, language: Language): string {
  const ar = language === 'ar';
  if (error instanceof ApiError) {
    if (error.code === 'ValidationFailed' && !ar) {
      const messages = Object.values(error.fields ?? {}).map((entries) => entries[0]);
      return messages.length > 0 ? messages.join(' ') : error.detail;
    }
    const copy = ERROR_COPY[error.code];
    if (copy) {
      return ar ? copy.ar : (copy.en ?? error.detail);
    }
    if (error.status >= 500) {
      return ar ? SERVER_ERROR.ar : SERVER_ERROR.en;
    }
    return ar ? 'تعذّر إكمال الطلب. راجع البيانات وحاول مرة أخرى.' : error.detail;
  }
  return ar ? NETWORK_ERROR.ar : NETWORK_ERROR.en;
}

async function looksLikeSupportedImage(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => head[index] === byte);
  const text = (from: number, to: number): string => String.fromCharCode(...head.slice(from, to));
  const webp = head.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
  return jpeg || png || webp;
}

/** Admin figures keep their cents (the storefront formatter rounds to whole pounds, which would misstate COD amounts). */
function formatMoney(amount: number, language: Language): string {
  const text = amount.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return language === 'ar' ? `${text} ج.م` : `${text} EGP`;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createVariantDraft(price: string): VariantDraft {
  return {
    id: null,
    sku: '',
    shadeEn: '',
    shadeAr: '',
    shadeHex: '#BD6B73',
    size: '',
    price,
    stock: '0',
    isActive: true,
  };
}

function createProductDraft(brand: string, category: string): ProductDraft {
  return {
    id: null,
    name: { en: '', ar: '' },
    brand,
    category,
    subCategory: '',
    description: { en: '', ar: '' },
    ingredients: { en: '', ar: '' },
    howToUse: { en: '', ar: '' },
    price: '',
    originalPrice: '',
    rating: '0',
    reviewsCount: '0',
    images: [''],
    skinType: [],
    finish: '',
    coverage: '',
    shadeFamily: '',
    isFeatured: false,
    isNewArrival: false,
    isBestSeller: false,
    status: 'published',
    variants: [createVariantDraft('')],
  };
}

function productToDraft(product: Product, brandName: string): ProductDraft {
  return {
    id: product.id,
    name: { en: product.name.en, ar: product.name.ar },
    brand: brandName,
    category: product.category,
    subCategory: product.subCategory ?? '',
    description: { en: product.description.en, ar: product.description.ar },
    ingredients: { en: product.ingredients.en, ar: product.ingredients.ar },
    howToUse: { en: product.howToUse.en, ar: product.howToUse.ar },
    price: String(product.price),
    originalPrice:
      product.originalPrice === undefined || product.originalPrice === null ? '' : String(product.originalPrice),
    rating: String(product.rating),
    reviewsCount: String(product.reviewsCount),
    images: product.images.length > 0 ? [...product.images] : [''],
    skinType: [...(product.skinType ?? [])],
    finish: product.finish ?? '',
    coverage: product.coverage ?? '',
    shadeFamily: product.shadeFamily ?? '',
    isFeatured: product.isFeatured ?? false,
    isNewArrival: product.isNewArrival ?? false,
    isBestSeller: product.isBestSeller ?? false,
    status: product.status,
    variants: product.variants.map((variant) => ({
      id: variant.id ? variant.id : null,
      sku: variant.sku,
      shadeEn: variant.shadeName?.en ?? '',
      shadeAr: variant.shadeName?.ar ?? '',
      shadeHex: variant.shadeHex ?? '',
      size: variant.size ?? '',
      price: String(variant.price),
      stock: String(variant.stock),
      isActive: variant.isActive ?? true,
    })),
  };
}

function draftToPayload(draft: ProductDraft): ProductWrite {
  return {
    name: { en: draft.name.en.trim(), ar: draft.name.ar.trim() },
    brand: draft.brand.trim(),
    category: draft.category,
    subCategory: optionalText(draft.subCategory),
    description: { en: draft.description.en.trim(), ar: draft.description.ar.trim() },
    ingredients: { en: draft.ingredients.en.trim(), ar: draft.ingredients.ar.trim() },
    howToUse: { en: draft.howToUse.en.trim(), ar: draft.howToUse.ar.trim() },
    price: toNumber(draft.price),
    originalPrice: draft.originalPrice.trim().length > 0 ? toNumber(draft.originalPrice) : null,
    rating: Math.min(5, Math.max(0, toNumber(draft.rating))),
    reviewsCount: Math.max(0, Math.round(toNumber(draft.reviewsCount))),
    images: draft.images.map((image) => image.trim()).filter((image) => image.length > 0),
    skinType: draft.skinType,
    finish: optionalText(draft.finish),
    coverage: optionalText(draft.coverage),
    shadeFamily: optionalText(draft.shadeFamily),
    isFeatured: draft.isFeatured,
    isNewArrival: draft.isNewArrival,
    isBestSeller: draft.isBestSeller,
    status: draft.status,
    variants: draft.variants.map((variant): VariantWrite => {
      const shadeEn = variant.shadeEn.trim();
      const shadeAr = variant.shadeAr.trim();
      return {
        id: variant.id,
        sku: variant.sku.trim(),
        shadeName: shadeEn.length > 0 || shadeAr.length > 0 ? { en: shadeEn, ar: shadeAr } : null,
        shadeHex: optionalText(variant.shadeHex),
        size: optionalText(variant.size),
        price: toNumber(variant.price),
        stock: Math.max(0, Math.round(toNumber(variant.stock))),
        isActive: variant.isActive,
      };
    }),
  };
}

function createDiscountDraft(): DiscountDraft {
  return {
    code: '',
    type: 'percentage',
    value: '10',
    minOrderAmount: '200',
    maxDiscount: '100',
    expiryDate: '2028-12-31T23:59',
    usageLimit: '500',
    active: true,
  };
}

const Field: React.FC<{ label: string; className?: string; children: React.ReactNode }> = ({
  label,
  className,
  children,
}) => (
  <label className={`block ${className ?? ''}`}>
    <span className="block font-bold mb-1">{label}</span>
    {children}
  </label>
);

const BilingualText: React.FC<{
  label: string;
  value: LocalizedString;
  onChange: (next: LocalizedString) => void;
  required?: boolean;
  rows?: number;
}> = ({ label, value, onChange, required = false, rows }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    <Field label={`${label} (English)${required ? ' *' : ''}`}>
      {rows ? (
        <textarea
          rows={rows}
          required={required}
          value={value.en}
          onChange={(event) => onChange({ ...value, en: event.target.value })}
          className={INPUT_CLASS}
        />
      ) : (
        <input
          type="text"
          required={required}
          value={value.en}
          onChange={(event) => onChange({ ...value, en: event.target.value })}
          className={INPUT_CLASS}
        />
      )}
    </Field>
    <Field label={`${label} (العربية)${required ? ' *' : ''}`}>
      {rows ? (
        <textarea
          rows={rows}
          required={required}
          value={value.ar}
          onChange={(event) => onChange({ ...value, ar: event.target.value })}
          className={INPUT_CLASS}
          dir="rtl"
        />
      ) : (
        <input
          type="text"
          required={required}
          value={value.ar}
          onChange={(event) => onChange({ ...value, ar: event.target.value })}
          className={INPUT_CLASS}
          dir="rtl"
        />
      )}
    </Field>
  </div>
);

const MetricCard: React.FC<{ metricKey: string; icon: React.ReactNode; label: string; value: string }> = ({
  metricKey,
  icon,
  label,
  value,
}) => (
  <div data-metric={metricKey} className="bg-white rounded-2xl border border-[#E8D6D1] p-4 shadow-xs">
    <div className="flex items-center gap-2 text-[#8B6E7E]">
      {icon}
      <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
    </div>
    <p data-field="value" className="font-serif text-xl font-bold text-[#2D1E2F] mt-2">
      {value}
    </p>
  </div>
);

export const AdminPage: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { t, l, language } = useLanguage();
  const { showToast } = useToast();

  const tr = (en: string, ar: string): string => (language === 'ar' ? ar : en);

  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  const describeError = useCallback((error: unknown): string => errorMessage(error, languageRef.current), []);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Catalog reference data
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [productSaving, setProductSaving] = useState(false);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<{ target: string; message: string } | null>(null);
  const [skuError, setSkuError] = useState<string | null>(null);
  const [productPage, setProductPage] = useState(1);
  const [productTotalPages, setProductTotalPages] = useState(0);

  // Inventory
  const [inventoryProductId, setInventoryProductId] = useState('');
  const [inventoryVariantId, setInventoryVariantId] = useState('');
  const [inventoryDelta, setInventoryDelta] = useState('1');
  const [inventoryNewStock, setInventoryNewStock] = useState('0');
  const [inventoryModeChoice, setInventoryMode] = useState<'delta' | 'absolute'>('delta');
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryReason, setInventoryReason] = useState('');
  const [inventorySaving, setInventorySaving] = useState(false);

  // Discounts
  const [discounts, setDiscounts] = useState<DiscountRecord[]>([]);
  const [discountsLoading, setDiscountsLoading] = useState(true);
  const [discountsError, setDiscountsError] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft | null>(null);
  const [discountSaving, setDiscountSaving] = useState(false);
  const [discountFormError, setDiscountFormError] = useState<string | null>(null);
  const [archivingCode, setArchivingCode] = useState<string | null>(null);

  // Banners
  const [banners, setBanners] = useState<PromotionalBanner[]>([]);
  const [bannersLoading, setBannersLoading] = useState(true);
  const [bannersError, setBannersError] = useState<string | null>(null);
  const [bannersSaving, setBannersSaving] = useState(false);

  // Orders
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const [brandList, categoryList] = await Promise.all([catalogApi.brands(), catalogApi.categories()]);
      setBrands(brandList);
      setCategories(categoryList);
    } catch (error) {
      showToast(describeError(error), 'error');
    }
  }, [showToast, describeError]);

  const productRequestId = useRef(0);

  const loadProducts = useCallback(
    async (search: string, page: number): Promise<void> => {
      const requestId = productRequestId.current + 1;
      productRequestId.current = requestId;
      setProductsLoading(true);
      setProductsError(null);
      try {
        const result = await adminApi.products({
          status: 'all',
          search: search.trim().length > 0 ? search.trim() : undefined,
          page,
          pageSize: 60,
        });
        if (requestId !== productRequestId.current) {
          return;
        }
        setProducts(result.products);
        setProductTotal(result.total);
        setProductTotalPages(result.totalPages);
      } catch (error) {
        if (requestId !== productRequestId.current) {
          return;
        }
        const message = describeError(error);
        // Never leave the previous page on screen next to an error.
        setProducts([]);
        setProductTotal(0);
        setProductTotalPages(0);
        setProductsError(message);
        showToast(message, 'error');
      } finally {
        if (requestId === productRequestId.current) {
          setProductsLoading(false);
        }
      }
    },
    [showToast, describeError],
  );

  const loadDiscounts = useCallback(async (): Promise<void> => {
    setDiscountsLoading(true);
    setDiscountsError(null);
    try {
      setDiscounts(await adminApi.discounts());
    } catch (error) {
      const message = describeError(error);
      setDiscounts([]);
      setDiscountsError(message);
      showToast(message, 'error');
    } finally {
      setDiscountsLoading(false);
    }
  }, [showToast, describeError]);

  const loadBanners = useCallback(async (): Promise<void> => {
    setBannersLoading(true);
    setBannersError(null);
    try {
      setBanners(await adminApi.banners());
    } catch (error) {
      const message = describeError(error);
      setBanners([]);
      setBannersError(message);
      showToast(message, 'error');
    } finally {
      setBannersLoading(false);
    }
  }, [showToast, describeError]);

  const loadMetrics = useCallback(async (): Promise<void> => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      setMetrics(await adminApi.metrics());
    } catch (error) {
      const message = describeError(error);
      setMetrics(null);
      setMetricsError(message);
      showToast(message, 'error');
    } finally {
      setMetricsLoading(false);
    }
  }, [showToast, describeError]);

  const loadOrders = useCallback(
    async (status: string, search: string): Promise<void> => {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const result = await adminApi.orders({
          status,
          search: search.trim().length > 0 ? search.trim() : undefined,
          page: 1,
          pageSize: 100,
        });
        setOrders(result.orders);
        setOrderTotal(result.total);
      } catch (error) {
        const message = describeError(error);
        setOrders([]);
        setOrderTotal(0);
        setOrdersError(message);
        showToast(message, 'error');
      } finally {
        setOrdersLoading(false);
      }
    },
    [showToast, describeError],
  );

  const applyOrderStatus = async (order: Order, status: string): Promise<void> => {
    setOrderBusyId(order.id);
    try {
      const updated = await adminApi.changeOrderStatus(
        order.id,
        status,
        status === 'Cancelled' ? 'Cancelled by administrator' : undefined,
      );
      setOrders((previous) => previous.map((entry) => (entry.id === updated.id ? updated : entry)));
      showToast(
        tr(
          `Order ${updated.orderNumber} is now ${enumLabel(updated.status)}.`,
          `أصبح الطلب ${updated.orderNumber} بحالة «${enumLabel(updated.status)}».`,
        ),
        'success',
      );
      void loadMetrics();
      void loadOrders(orderStatusFilter, orderSearch);
      if (status === 'Cancelled') {
        void loadProducts(productSearch, productPage);
      }
    } catch (error) {
      showToast(describeError(error), 'error');
      // Another actor may have changed the order: show what is really stored.
      void loadOrders(orderStatusFilter, orderSearch);
    } finally {
      setOrderBusyId(null);
    }
  };

  const collectCash = async (order: Order): Promise<void> => {
    const total = formatMoney(order.total, language);
    if (
      !window.confirm(
        tr(
          `Confirm that ${total} in cash was collected for order ${order.orderNumber}? A collected order can no longer be cancelled.`,
          `هل تؤكد تحصيل ${total} نقداً للطلب ${order.orderNumber}؟ لا يمكن إلغاء الطلب بعد التحصيل.`,
        ),
      )
    ) {
      return;
    }
    setOrderBusyId(order.id);
    try {
      const updated = await adminApi.collectPayment(order.id, order.total);
      setOrders((previous) => previous.map((entry) => (entry.id === updated.id ? updated : entry)));
      showToast(
        tr(`Cash collected for ${updated.orderNumber}.`, `تم تحصيل نقدية الطلب ${updated.orderNumber}.`),
        'success',
      );
      void loadMetrics();
    } catch (error) {
      showToast(describeError(error), 'error');
      void loadOrders(orderStatusFilter, orderSearch);
    } finally {
      setOrderBusyId(null);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      // Signed out (or switched to a customer): drop every admin dataset from memory.
      clearAdminState();
      return;
    }
    void loadCatalog();
    void loadDiscounts();
    void loadBanners();
  }, [isAdmin, loadCatalog, loadDiscounts, loadBanners]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'overview') {
      return;
    }
    void loadMetrics();
  }, [isAdmin, activeTab, loadMetrics]);

  useEffect(() => {
    if (!isAdmin || activeTab !== 'orders') {
      return undefined;
    }
    const timer = window.setTimeout(
      () => {
        void loadOrders(orderStatusFilter, orderSearch);
      },
      orderSearch.trim().length > 0 ? 300 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [isAdmin, activeTab, orderStatusFilter, orderSearch, loadOrders]);

  // Orders and checkouts change stock and coupon usage while this page stays open: re-read on tab entry.
  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    if (activeTab === 'discounts') {
      void loadDiscounts();
    } else if (activeTab === 'products' || activeTab === 'inventory') {
      void loadProducts(productSearch, productPage);
    }
    // Search/page changes are handled by the debounced effect below; only tab entry matters here.
  }, [isAdmin, activeTab]);

  // Server-side product search + paging (debounced search).
  useEffect(() => {
    if (!isAdmin) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void loadProducts(productSearch, productPage);
    }, productSearch.trim().length > 0 ? 300 : 0);

    return () => window.clearTimeout(timer);
  }, [isAdmin, productSearch, productPage, loadProducts]);

  const brandLabel = useCallback(
    (value: string): string => {
      const match = brands.find((brand) => brand.id === value);
      return match ? match.name : value;
    },
    [brands],
  );

  const categoryLabel = useCallback(
    (value: string): string => {
      const match = categories.find((category) => category.id === value);
      return match ? l(match.name) : value;
    },
    [categories, l],
  );

  const inventoryProduct = useMemo(
    () => products.find((product) => product.id === inventoryProductId) ?? null,
    [products, inventoryProductId],
  );

  const inventoryVariant = useMemo(
    () => inventoryProduct?.variants.find((variant) => variant.id === inventoryVariantId) ?? null,
    [inventoryProduct, inventoryVariantId],
  );

  useEffect(() => {
    if (!products.some((product) => product.id === inventoryProductId)) {
      setInventoryProductId(products[0]?.id ?? '');
    }
  }, [products, inventoryProductId]);

  useEffect(() => {
    if (!inventoryProduct) {
      if (inventoryVariantId) {
        setInventoryVariantId('');
      }
      return;
    }
    if (!inventoryProduct.variants.some((variant) => variant.id === inventoryVariantId)) {
      setInventoryVariantId(inventoryProduct.variants[0]?.id ?? '');
    }
  }, [inventoryProduct, inventoryVariantId]);

  const canSetExact = Boolean(inventoryVariant?.version);
  const inventoryMode = canSetExact ? inventoryModeChoice : 'delta';
  const stockState = !inventoryVariant
    ? null
    : inventoryVariant.stock === 0
      ? 'out'
      : inventoryVariant.stock <= 5
        ? 'low'
        : 'ok';

  const clearAdminState = (): void => {
    setMetrics(null);
    setMetricsError(null);
    setOrders([]);
    setOrderTotal(0);
    setOrdersError(null);
    setProducts([]);
    setProductTotal(0);
    setProductTotalPages(0);
    setProductsError(null);
    setDiscounts([]);
    setDiscountsError(null);
    setBanners([]);
    setBannersError(null);
    setProductDraft(null);
    setDiscountDraft(null);
    setInventoryError(null);
  };

  const changeProductSearch = (value: string): void => {
    setProductSearch(value);
    setProductPage(1);
  };

  const enumLabel = (value: string): string => {
    if (value in ORDER_STATUS_FLOW) {
      // Same wording the shopper sees on their own order.
      return t(`order.status.${value}`);
    }
    const entry = ENUM_LABELS[value];
    return entry ? l(entry) : value;
  };

  const openCreateProduct = (): void => {
    setProductFormError(null);
    setSkuError(null);
    setUploadError(null);
    setProductDraft(createProductDraft(brands[0]?.name ?? '', categories[0]?.id ?? 'makeup'));
  };

  const openEditProduct = async (product: Product): Promise<void> => {
    setProductFormError(null);
    setSkuError(null);
    setUploadError(null);
    setLoadingProductId(product.id);
    try {
      const fresh = await adminApi.product(product.id);
      setProductDraft(productToDraft(fresh, brandLabel(fresh.brand)));
    } catch (error) {
      showToast(describeError(error), 'error');
    } finally {
      setLoadingProductId(null);
    }
  };

  const patchProductDraft = (updater: (draft: ProductDraft) => ProductDraft): void => {
    setProductDraft((current) => (current ? updater(current) : current));
  };

  const updateVariant = (index: number, patch: Partial<VariantDraft>): void => {
    patchProductDraft((draft) => ({
      ...draft,
      variants: draft.variants.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, ...patch } : variant,
      ),
    }));
  };

  const patchBanner = (id: string, updater: (banner: PromotionalBanner) => PromotionalBanner): void => {
    setBanners((previous) => previous.map((banner) => (banner.id === id ? updater(banner) : banner)));
  };

  /** Validates (type by magic bytes, size) before upload so the admin gets a precise message. */
  const handleUploadImage = async (file: File, target: string): Promise<void> => {
    const reject = (message: string): void => {
      setUploadError({ target, message });
    };

    setUploadError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      reject(
        tr(
          'This image is larger than 5 MB. Choose a smaller JPEG, PNG or WebP file.',
          'حجم هذه الصورة أكبر من 5 ميجابايت. اختر ملف JPEG أو PNG أو WebP أصغر.',
        ),
      );
      return;
    }
    if (!(await looksLikeSupportedImage(file))) {
      reject(
        tr(
          'This file is not a real JPEG, PNG or WebP image (renaming a file does not change its type).',
          'هذا الملف ليس صورة JPEG أو PNG أو WebP حقيقية (تغيير اسم الملف لا يغيّر نوعه).',
        ),
      );
      return;
    }

    setUploadingImage(true);
    try {
      const url = await adminApi.uploadImage(file);
      if (target === 'product') {
        patchProductDraft((draft) => ({
          ...draft,
          images: draft.images.some((image) => image.trim().length === 0)
            ? draft.images.map((image) => (image.trim().length === 0 ? url : image))
            : [...draft.images, url],
        }));
      } else {
        patchBanner(target, (banner) => ({ ...banner, imageUrl: url }));
      }
    } catch (error) {
      reject(
        error instanceof ApiError && error.status >= 500
          ? tr(
              'The server could not accept this image. Use a JPEG, PNG or WebP file under 5 MB.',
              'تعذّر على الخادم قبول هذه الصورة. استخدم ملف JPEG أو PNG أو WebP أقل من 5 ميجابايت.',
            )
          : describeError(error),
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveProduct = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!productDraft) {
      return;
    }

    const fail = (message: string, sku = false): void => {
      if (sku) {
        setSkuError(message);
        setProductFormError(null);
      } else {
        setProductFormError(message);
        setSkuError(null);
      }
    };

    const images = productDraft.images.map((image) => image.trim()).filter((image) => image.length > 0);
    if (images.length === 0) {
      fail(
        tr(
          'Add at least one product image: upload a file or paste an image URL.',
          'أضف صورة واحدة على الأقل للمنتج: ارفع ملفاً أو الصق رابط صورة.',
        ),
      );
      return;
    }

    if (productDraft.variants.length === 0) {
      fail(tr('A product needs at least one variant.', 'يحتاج المنتج إلى درجة واحدة على الأقل.'));
      return;
    }

    const skus = productDraft.variants.map((variant) => variant.sku.trim().toUpperCase());
    if (skus.some((sku) => sku.length === 0)) {
      fail(tr('Every variant needs a SKU.', 'كل درجة تحتاج إلى كود SKU.'), true);
      return;
    }
    if (new Set(skus).size !== skus.length) {
      fail(
        tr(
          'Two variants of this product use the same SKU. SKUs must be unique.',
          'درجتان في هذا المنتج تستخدمان نفس كود SKU. يجب أن تكون الأكواد فريدة.',
        ),
        true,
      );
      return;
    }

    if (
      productDraft.variants.some(
        (variant) => variant.shadeHex.trim().length > 0 && !/^#[0-9a-fA-F]{6}$/.test(variant.shadeHex.trim()),
      )
    ) {
      fail(
        tr(
          'Shade colour must be a hex value such as #BD6B73.',
          'يجب أن يكون لون الدرجة بصيغة hex مثل ‎#BD6B73.',
        ),
      );
      return;
    }

    const payload = draftToPayload(productDraft);
    setProductSaving(true);
    setProductFormError(null);
    setSkuError(null);
    try {
      if (productDraft.id) {
        await adminApi.updateProduct(productDraft.id, payload);
      } else {
        await adminApi.createProduct(payload);
      }

      setProductDraft(null);
      showToast(
        productDraft.id
          ? tr('Product updated.', 'تم تحديث المنتج.')
          : tr('Product created.', 'تم إنشاء المنتج.'),
        'success',
      );
      void loadProducts(productSearch, productPage);
    } catch (error) {
      fail(describeError(error), error instanceof ApiError && error.code === 'SkuAlreadyExists');
    } finally {
      setProductSaving(false);
    }
  };

  const handleArchiveProduct = async (product: Product): Promise<void> => {
    if (!window.confirm(tr(`Archive "${product.name.en}"?`, `أرشفة "${product.name.ar || product.name.en}"؟`))) {
      return;
    }
    try {
      const archived = await adminApi.archiveProduct(product.id);
      setProducts((previous) =>
        previous.map((entry) => (entry.id === archived.id ? archived : entry)),
      );
      showToast(tr('Product archived.', 'تمت أرشفة المنتج.'), 'success');
    } catch (error) {
      showToast(describeError(error), 'error');
    }
  };

  const handleAdjustInventory = async (): Promise<void> => {
    if (!inventoryProduct || !inventoryVariant) {
      return;
    }

    const fail = (message: string): void => {
      setInventoryError(message);
    };

    setInventoryError(null);
    const reason = inventoryReason.trim();
    if (reason.length === 0) {
      fail(tr('A reason is required for stock adjustments.', 'سبب التعديل مطلوب لتعديل المخزون.'));
      return;
    }

    let payload: InventoryAdjustPayload;
    if (inventoryMode === 'delta') {
      const delta = Math.trunc(toNumber(inventoryDelta));
      if (delta === 0) {
        fail(tr('Enter a non-zero adjustment, e.g. +3 or -2.', 'أدخل قيمة تعديل لا تساوي صفراً، مثل +3 أو -2.'));
        return;
      }
      payload = { productId: inventoryProduct.id, variantId: inventoryVariant.id, delta, reason };
    } else {
      const newStock = Math.trunc(toNumber(inventoryNewStock));
      if (inventoryNewStock.trim().length === 0 || newStock < 0) {
        fail(tr('Enter a stock count of 0 or more.', 'أدخل عدداً للمخزون يساوي 0 أو أكثر.'));
        return;
      }
      payload = {
        productId: inventoryProduct.id,
        variantId: inventoryVariant.id,
        newStock,
        expectedVersion: inventoryVariant.version,
        reason,
      };
    }

    setInventorySaving(true);
    try {
      const updated = await adminApi.adjustInventory(payload);
      setProducts((previous) => previous.map((product) => (product.id === updated.id ? updated : product)));
      const nextStock = updated.variants.find((variant) => variant.id === inventoryVariant.id)?.stock ?? 0;
      showToast(
        tr(
          `Stock updated. New stock: ${nextStock}.`,
          `تم تحديث المخزون. المخزون الحالي: ${nextStock}.`,
        ),
        'success',
      );
      setInventoryReason('');
    } catch (error) {
      fail(describeError(error));
      if (error instanceof ApiError && (error.code === 'InventoryConflict' || error.code === 'OutcomeUnknown')) {
        // Show the stock that is actually stored now, never the stale figure (a lost commit acknowledgement
        // must not invite a blind retry of a relative adjustment).
        void loadProducts(productSearch, productPage);
      }
    } finally {
      setInventorySaving(false);
    }
  };

  const handleCreateDiscount = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!discountDraft) {
      return;
    }

    const fail = (message: string): void => {
      setDiscountFormError(message);
    };

    const code = discountDraft.code.trim().toUpperCase();
    if (code.length === 0) {
      fail(tr('Coupon code is required.', 'كود الخصم مطلوب.'));
      return;
    }

    const expiryDate = toIsoDate(discountDraft.expiryDate);
    if (!expiryDate) {
      fail(tr('Choose a valid expiry date.', 'اختر تاريخ انتهاء صالحاً.'));
      return;
    }

    const value = toNumber(discountDraft.value);
    if (value <= 0) {
      fail(tr('Discount value must be greater than zero.', 'قيمة الخصم يجب أن تكون أكبر من صفر.'));
      return;
    }
    if (discountDraft.type === 'percentage' && value > 100) {
      fail(tr('A percentage discount cannot exceed 100.', 'لا يمكن أن تتجاوز نسبة الخصم 100.'));
      return;
    }

    const payload: DiscountWrite = {
      code,
      type: discountDraft.type,
      value,
      minOrderAmount: Math.max(0, toNumber(discountDraft.minOrderAmount)),
      maxDiscount: discountDraft.maxDiscount.trim().length > 0 ? Math.max(0, toNumber(discountDraft.maxDiscount)) : null,
      expiryDate,
      usageLimit: Math.max(0, Math.round(toNumber(discountDraft.usageLimit))),
      active: discountDraft.active,
    };

    setDiscountSaving(true);
    setDiscountFormError(null);
    try {
      const created = await adminApi.createDiscount(payload);
      setDiscounts((previous) => [created, ...previous.filter((record) => record.code !== created.code)]);
      setDiscountDraft(null);
      showToast(tr('Discount code created.', 'تم إنشاء كود الخصم.'), 'success');
    } catch (error) {
      fail(describeError(error));
    } finally {
      setDiscountSaving(false);
    }
  };

  const handleArchiveDiscount = async (record: DiscountRecord): Promise<void> => {
    if (!window.confirm(tr(`Archive coupon "${record.code}"?`, `أرشفة كود الخصم "${record.code}"؟`))) {
      return;
    }
    setArchivingCode(record.code);
    try {
      const archived = await adminApi.archiveDiscount(record.code);
      setDiscounts((previous) =>
        previous.map((entry) => (entry.code === archived.code ? archived : entry)),
      );
      showToast(tr('Discount code archived.', 'تمت أرشفة كود الخصم.'), 'success');
    } catch (error) {
      showToast(describeError(error), 'error');
    } finally {
      setArchivingCode(null);
    }
  };

  const handleSaveBanners = async (): Promise<void> => {
    setBannersSaving(true);
    try {
      const saved = await adminApi.saveBanners(banners);
      setBanners(saved);
      showToast(tr('Homepage banners saved.', 'تم حفظ بانرات الصفحة الرئيسية.'), 'success');
    } catch (error) {
      showToast(describeError(error), 'error');
    } finally {
      setBannersSaving(false);
    }
  };

  const tabs: { id: AdminTab; label: string }[] = [
    { id: 'overview', label: t('admin.tabOverview') },
    { id: 'products', label: t('admin.tabProducts') },
    { id: 'orders', label: t('admin.tabOrders') },
    { id: 'inventory', label: t('admin.tabInventory') },
    { id: 'discounts', label: t('admin.tabDiscounts') },
    { id: 'banners', label: t('admin.tabBanners') },
  ];

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto px-4 py-16">
        <div className="bg-white rounded-3xl border border-[#E8D6D1] p-8 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-[#FAF3F1] text-[#8B263E] flex items-center justify-center mx-auto">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h2 className="font-serif text-2xl font-bold text-[#2D1E2F]">{t('admin.title')}</h2>
            <p className="text-xs text-[#8B6E7E] mt-1.5 leading-relaxed">
              {tr(
                'This area is restricted to store administrators. Sign in with an administrator account to manage products, inventory, discounts, and banners. Server-side role checks enforce the same rule.',
                'هذه المنطقة مخصصة لمسؤولي المتجر فقط. سجّل الدخول بحساب مسؤول لإدارة المنتجات والمخزون والخصومات والبانرات. يفرض الخادم نفس القاعدة على مستوى الصلاحيات.',
              )}
            </p>
            {user && (
              <p className="text-[11px] text-[#8B6E7E] mt-3">
                {tr(`Signed in as ${user.email}.`, `تم تسجيل الدخول باسم ${user.email}.`)}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="bg-[#2D1E2F] text-white rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#E8998D]" aria-hidden="true" />
            <span className="text-xs font-bold text-[#E8998D] uppercase tracking-wider">
              {tr('Administrator session', 'جلسة مسؤول')}
            </span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold">{t('admin.title')}</h1>
          <p className="text-xs text-[#C7B5BD]">
            {tr(
              'Manage products, inventory, orders, discount codes, and homepage banners.',
              'إدارة المنتجات والمخزون والطلبات وأكواد الخصم وبانرات الصفحة الرئيسية.',
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs bg-[#4A3245] px-3 py-1.5 rounded-full text-[#F3D8D3] font-semibold">
            {tr('Admin', 'المسؤول')}: {user?.fullName}
          </span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav
        aria-label={tr('Admin sections', 'أقسام لوحة الإدارة')}
        className="flex border-b border-[#E8D6D1] space-x-2 sm:space-x-6 rtl:space-x-reverse overflow-x-auto text-xs sm:text-sm font-bold scrollbar-none"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-tab={tab.id}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
            className={`pb-3 px-2 whitespace-nowrap transition relative ${
              activeTab === tab.id ? 'text-[#8B263E]' : 'text-[#8B6E7E] hover:text-[#2D1E2F]'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8B263E] rounded-full" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>

      {/* ---------------- 1. OVERVIEW TAB ---------------- */}
      {activeTab === 'overview' && (
        <div className="space-y-5" data-panel="overview">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-sm text-[#2D1E2F]">{tr('Store performance', 'أداء المتجر')}</h3>
              <p className="text-xs text-[#8B6E7E]">
                {tr(
                  'Calculated from stored orders and inventory. Cancelled orders are excluded from order value; collected revenue counts only cash actually collected.',
                  'محسوبة من الطلبات والمخزون الفعلي. الطلبات الملغاة مستبعدة من قيمة الطلبات، والإيراد المحصّل يشمل النقدية المحصّلة فعلياً فقط.',
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadMetrics()}
              className="px-4 py-2 rounded-xl border border-[#E8D6D1] bg-white text-xs font-bold text-[#3B2332] hover:bg-[#F3E7E4] transition flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${metricsLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {tr('Refresh', 'تحديث')}
            </button>
          </div>

          {metricsError && (
            <div role="alert" className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs text-rose-800">
              {metricsError}
            </div>
          )}

          {metricsLoading && !metrics ? (
            <div className="py-16 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#8B263E] mx-auto" aria-hidden="true" />
            </div>
          ) : metrics ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <MetricCard
                  metricKey="totalSales"
                  icon={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
                  label={tr('Order value (non-cancelled)', 'قيمة الطلبات (بدون الملغاة)')}
                  value={formatMoney(metrics.totalSales, language)}
                />
                <MetricCard
                  metricKey="collectedRevenue"
                  icon={<Banknote className="w-4 h-4" aria-hidden="true" />}
                  label={tr('Collected revenue', 'الإيراد المحصّل')}
                  value={formatMoney(metrics.collectedRevenue ?? 0, language)}
                />
                <MetricCard
                  metricKey="totalOrders"
                  icon={<ShoppingBag className="w-4 h-4" aria-hidden="true" />}
                  label={tr('Total orders (incl. cancelled)', 'إجمالي الطلبات (شاملة الملغاة)')}
                  value={String(metrics.totalOrders)}
                />
                <MetricCard
                  metricKey="averageOrderValue"
                  icon={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
                  label={tr('Average order value', 'متوسط قيمة الطلب')}
                  value={formatMoney(metrics.averageOrderValue, language)}
                />
                <MetricCard
                  metricKey="totalProducts"
                  icon={<Package className="w-4 h-4" aria-hidden="true" />}
                  label={tr('Active products', 'المنتجات النشطة')}
                  value={String(metrics.totalProducts)}
                />
                <MetricCard
                  metricKey="lowStockCount"
                  icon={<AlertTriangle className="w-4 h-4" aria-hidden="true" />}
                  label={tr('Low-stock variants', 'خيارات قاربت على النفاد')}
                  value={String(metrics.lowStockCount)}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="bg-white rounded-3xl border border-[#E8D6D1] p-5 shadow-xs space-y-2">
                  <h4 className="font-bold text-sm text-[#2D1E2F] pb-2 border-b border-[#F0E3DF]">
                    {tr('Orders by status', 'الطلبات حسب الحالة')}
                  </h4>
                  {ORDER_STATUSES.map((status) => (
                    <div key={status} data-status={status} className="flex items-center justify-between text-xs py-1">
                      <span className="font-semibold text-[#503E48]">{enumLabel(status)}</span>
                      <span className="font-bold text-[#2D1E2F]">{metrics.ordersByStatus[status] ?? 0}</span>
                    </div>
                  ))}
                </div>

                <div className="lg:col-span-2 bg-white rounded-3xl border border-[#E8D6D1] p-5 shadow-xs space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-[#F0E3DF]">
                    <h4 className="font-bold text-sm text-[#2D1E2F]">{tr('Low stock', 'المخزون المنخفض')}</h4>
                    <span className="text-[11px] text-[#8B6E7E]">
                      {tr('0 < stock ≤ 5, active variants', '٠ < المخزون ≤ ٥، للدرجات المفعّلة')}
                    </span>
                  </div>
                  {metrics.lowStockItems.length === 0 ? (
                    <p data-empty="low-stock" className="text-xs text-[#8B6E7E] py-4 text-center">
                      {tr('No low-stock variants.', 'لا توجد خيارات منخفضة المخزون.')}
                    </p>
                  ) : (
                    <div className="divide-y divide-[#F3E7E4]">
                      {metrics.lowStockItems.map((item) => (
                        <div
                          key={`${item.productId}-${item.variantSku}`}
                          data-low-stock-sku={item.variantSku}
                          className="py-2 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[#2D1E2F] truncate">{l(item.productName)}</p>
                            <p className="text-[11px] text-[#8B6E7E]">
                              {item.variantSku}
                              {item.shadeName ? ` • ${l(item.shadeName)}` : ''}
                              {item.size ? ` • ${item.size}` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 font-bold text-[#8B263E]">{item.stock}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ---------------- 2. PRODUCTS TAB ---------------- */}
      {activeTab === 'products' && (
        <div className="space-y-4" data-panel="products">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                value={productSearch}
                onChange={(event) => changeProductSearch(event.target.value)}
                aria-label={tr('Search products', 'ابحث في المنتجات')}
                placeholder={tr('Search products by title or brand...', 'ابحث عن المنتجات بالاسم أو الماركة...')}
                className="w-full bg-white border border-[#E8D6D1] rounded-xl py-2 px-9 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5 rtl:left-auto rtl:right-3" aria-hidden="true" />
            </div>

            <button
              onClick={openCreateProduct}
              className="px-4 py-2 bg-[#3B2332] text-white rounded-xl text-xs font-bold hover:bg-[#523347] transition flex items-center justify-center gap-1.5 shadow-xs"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{t('admin.addProduct')}</span>
            </button>
          </div>

          <p className="text-[11px] text-[#8B6E7E]" data-field="product-count">
            {tr(
              `Showing ${products.length} of ${productTotal} products (page ${productPage} of ${Math.max(1, productTotalPages)}).`,
              `عرض ${products.length} من ${productTotal} منتجاً (الصفحة ${productPage} من ${Math.max(1, productTotalPages)}).`,
            )}
          </p>

          {productsError && (
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-900 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                <span>{productsError}</span>
              </span>
              <button
                onClick={() => void loadProducts(productSearch, productPage)}
                className="px-3 py-1.5 bg-white border border-rose-200 rounded-lg font-bold flex items-center gap-1.5 hover:bg-rose-100"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                {tr('Retry', 'إعادة المحاولة')}
              </button>
            </div>
          )}

          {/* Products Table */}
          <div className="bg-white rounded-3xl border border-[#E8D6D1] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="bg-[#FAF7F5] border-b border-[#E8D6D1] text-[#8B6E7E] uppercase text-[10px]">
                    <th className="py-3 px-4 text-start">{tr('Product', 'المنتج')}</th>
                    <th className="py-3 px-4 text-start">{tr('Category', 'الفئة')}</th>
                    <th className="py-3 px-4 text-start">{tr('Base price', 'السعر الأساسي')}</th>
                    <th className="py-3 px-4 text-start">{tr('Variants & stock', 'الدرجات والمخزون')}</th>
                    <th className="py-3 px-4 text-start">{tr('Status', 'الحالة')}</th>
                    <th className="py-3 px-4 text-end">{tr('Actions', 'إجراءات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3E7E4]">
                  {productsLoading ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-[#8B6E7E]">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" aria-hidden="true" />
                        {tr('Loading products...', 'جارٍ تحميل المنتجات...')}
                      </td>
                    </tr>
                  ) : products.length === 0 ? (
                    !productsError && (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-[#8B6E7E] space-y-2">
                          <Package className="w-8 h-8 mx-auto text-[#D4A29C]" aria-hidden="true" />
                          <p className="font-bold text-[#2D1E2F]">
                            {tr('No products match this view.', 'لا توجد منتجات مطابقة.')}
                          </p>
                          <p>
                            {tr(
                              'Create a product or clear the search to see the catalogue.',
                              'أنشئ منتجاً جديداً أو امسح البحث لعرض الكتالوج.',
                            )}
                          </p>
                        </td>
                      </tr>
                    )
                  ) : (
                    products.map((product) => {
                      const lowestStock = Math.min(...product.variants.map((variant) => variant.stock));
                      const totalStock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
                      return (
                        <tr
                          key={product.id}
                          data-product-id={product.id}
                          data-product-status={product.status}
                          className="hover:bg-[#FAF7F5]"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              {product.images[0] ? (
                                <img
                                  src={mediaUrl(product.images[0])}
                                  alt={l(product.name)}
                                  className="w-10 h-10 object-cover rounded-lg border border-[#E8D6D1] shrink-0"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg border border-[#E8D6D1] bg-[#FAF7F5] flex items-center justify-center text-[#B49AA6] shrink-0">
                                  <ImageIcon className="w-4 h-4" aria-hidden="true" />
                                </div>
                              )}
                              <div>
                                <p className="font-bold text-[#2D1E2F]">{l(product.name)}</p>
                                <p className="text-[11px] text-[#8B6E7E]">{brandLabel(product.brand)}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 uppercase text-[11px] font-semibold text-[#503E48]">
                            {categoryLabel(product.category)}
                          </td>
                          <td className="py-3 px-4 font-bold text-[#8B263E]">
                            {formatMoney(product.price, language)}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`font-semibold ${lowestStock <= 5 ? 'text-rose-600' : 'text-[#2D1E2F]'}`}>
                              {tr(
                                `${product.variants.length} variants (${totalStock} units total)`,
                                `${product.variants.length} درجة (${totalStock} وحدة إجمالاً)`,
                              )}
                            </span>
                            <span className="block text-[10px] text-[#8B6E7E] font-mono" dir="ltr">
                              {product.variants.map((variant) => variant.sku).join(', ')}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                product.status === 'published'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-stone-200 text-stone-800'
                              }`}
                            >
                              {enumLabel(product.status)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-end whitespace-nowrap">
                            <button
                              onClick={() => void openEditProduct(product)}
                              disabled={loadingProductId === product.id}
                              className="p-1.5 hover:bg-[#F3E7E4] rounded-lg text-[#3B2332] transition disabled:opacity-50"
                              aria-label={`${t('admin.editProduct')}: ${l(product.name)}`}
                              title={t('admin.editProduct')}
                            >
                              {loadingProductId === product.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Edit3 className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                            <button
                              onClick={() => void handleArchiveProduct(product)}
                              disabled={product.status === 'archived'}
                              className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition disabled:opacity-40"
                              aria-label={`${tr('Archive', 'أرشفة')}: ${l(product.name)}`}
                              title={tr('Archive', 'أرشفة')}
                            >
                              <Archive className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {productTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                disabled={productPage <= 1 || productsLoading}
                className="px-3 py-1.5 border border-[#E8D6D1] rounded-lg font-bold hover:bg-[#F3E7E4] disabled:opacity-40"
              >
                {tr('Previous', 'السابق')}
              </button>
              <span className="text-[#8B6E7E]">
                {productPage} / {productTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setProductPage((page) => Math.min(productTotalPages, page + 1))}
                disabled={productPage >= productTotalPages || productsLoading}
                className="px-3 py-1.5 border border-[#E8D6D1] rounded-lg font-bold hover:bg-[#F3E7E4] disabled:opacity-40"
              >
                {tr('Next', 'التالي')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---------------- 3. ORDERS TAB ---------------- */}
      {activeTab === 'orders' && (
        <div className="space-y-4" data-panel="orders">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <input
                type="text"
                value={orderSearch}
                onChange={(event) => setOrderSearch(event.target.value)}
                aria-label={tr('Search orders', 'ابحث في الطلبات')}
                placeholder={tr('Search by order number, name or phone...', 'ابحث برقم الطلب أو الاسم أو الهاتف...')}
                className={`${INPUT_CLASS} pe-9`}
              />
              <Search className="w-4 h-4 text-stone-400 absolute right-3 top-3 rtl:right-auto rtl:left-3" aria-hidden="true" />
            </div>

            <select
              value={orderStatusFilter}
              onChange={(event) => setOrderStatusFilter(event.target.value)}
              aria-label={tr('Filter by status', 'تصفية حسب الحالة')}
              className={`${SELECT_CLASS} sm:w-48`}
            >
              <option value="all">{tr('All statuses', 'كل الحالات')}</option>
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {enumLabel(status)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void loadOrders(orderStatusFilter, orderSearch)}
              className="px-4 py-2.5 rounded-xl border border-[#E8D6D1] bg-white text-xs font-bold text-[#3B2332] hover:bg-[#F3E7E4] transition flex items-center justify-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ordersLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {tr('Refresh', 'تحديث')}
            </button>

            <span className="text-[11px] text-[#8B6E7E]" data-field="order-count">
              {orderTotal > orders.length
                ? tr(`Showing ${orders.length} of ${orderTotal} orders`, `عرض ${orders.length} من ${orderTotal} طلب`)
                : tr(`${orderTotal} orders`, `${orderTotal} طلب`)}
            </span>
          </div>

          {ordersError && (
            <div role="alert" className="p-4 rounded-2xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-center justify-between gap-2">
              <span>{ordersError}</span>
              <button
                type="button"
                onClick={() => void loadOrders(orderStatusFilter, orderSearch)}
                className="px-3 py-1.5 bg-white border border-rose-200 rounded-lg font-bold hover:bg-rose-100"
              >
                {tr('Retry', 'إعادة المحاولة')}
              </button>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-[#E8D6D1] shadow-xs overflow-x-auto">
            {ordersLoading && orders.length === 0 ? (
              <div className="py-16 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-[#8B263E] mx-auto" aria-hidden="true" />
              </div>
            ) : orders.length === 0 ? (
              !ordersError && (
                <div data-empty="orders" className="py-16 text-center text-xs text-[#8B6E7E]">
                  {tr('No orders match these filters.', 'لا توجد طلبات مطابقة.')}
                </div>
              )
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-[#FAF7F5] text-[#8B6E7E] uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="text-start px-4 py-3 font-bold">{tr('Order', 'الطلب')}</th>
                    <th className="text-start px-4 py-3 font-bold">{tr('Customer', 'العميل')}</th>
                    <th className="text-start px-4 py-3 font-bold">{tr('Total', 'الإجمالي')}</th>
                    <th className="text-start px-4 py-3 font-bold">{tr('Fulfilment', 'الشحن')}</th>
                    <th className="text-start px-4 py-3 font-bold">{tr('Payment', 'الدفع')}</th>
                    <th className="text-start px-4 py-3 font-bold">{tr('Placed', 'التاريخ')}</th>
                    <th className="text-start px-4 py-3 font-bold">{tr('Actions', 'إجراءات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3E7E4]">
                  {orders.map((order) => {
                    const nextStatuses = ORDER_STATUS_FLOW[order.status] ?? [];
                    const canCollect =
                      (order.status === 'Shipped' || order.status === 'Delivered') &&
                      order.paymentStatus !== 'Collected';
                    const busy = orderBusyId === order.id;

                    return (
                      <tr
                        key={order.id}
                        data-order={order.orderNumber}
                        data-order-status={order.status}
                        data-payment-status={order.paymentStatus ?? 'Unpaid'}
                        className="align-top"
                      >
                        <td className="px-4 py-3">
                          <p className="font-bold text-[#2D1E2F]" dir="ltr">{order.orderNumber}</p>
                          <p className="text-[11px] text-[#8B6E7E]">
                            {order.items.length} {tr('items', 'عناصر')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-[#2D1E2F]">{order.shippingAddress.fullName}</p>
                          <p className="text-[11px] text-[#8B6E7E]" dir="ltr">{order.shippingAddress.mobileNumber}</p>
                        </td>
                        <td className="px-4 py-3 font-bold text-[#8B263E]">
                          {formatMoney(order.total, language)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-block px-2 py-0.5 rounded-full bg-[#F3D8D3] text-[#3B2332] font-bold text-[10px]">
                            {enumLabel(order.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full font-bold text-[10px] ${
                              order.paymentStatus === 'Collected'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-stone-100 text-stone-600'
                            }`}
                          >
                            {enumLabel(order.paymentStatus ?? 'Unpaid')}
                          </span>
                          {order.paymentCollectedAmount != null && (
                            <p className="text-[10px] text-[#8B6E7E] mt-1">
                              {formatMoney(order.paymentCollectedAmount, language)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[#8B6E7E]">
                          {new Date(order.createdAt).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5 min-w-[150px]">
                            {nextStatuses.length > 0 && (
                              <select
                                value=""
                                disabled={busy}
                                aria-label={`${tr('Change status of order', 'تغيير حالة الطلب')} ${order.orderNumber}`}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  if (!next) {
                                    return;
                                  }
                                  if (
                                    next === 'Cancelled' &&
                                    !window.confirm(
                                      tr(
                                        'Cancel this order and restore its stock?',
                                        'إلغاء هذا الطلب واستعادة مخزونه؟',
                                      ),
                                    )
                                  ) {
                                    return;
                                  }
                                  void applyOrderStatus(order, next);
                                }}
                                className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-lg p-1.5 text-[11px] font-semibold"
                              >
                                <option value="">{tr('Change status…', 'تغيير الحالة…')}</option>
                                {nextStatuses.map((status) => (
                                  <option key={status} value={status}>
                                    {enumLabel(status)}
                                  </option>
                                ))}
                              </select>
                            )}

                            {canCollect && (
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={`${tr('Collect cash for order', 'تحصيل نقدية الطلب')} ${order.orderNumber}`}
                                onClick={() => void collectCash(order)}
                                className="w-full px-2 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50 transition flex items-center justify-center gap-1"
                              >
                                <Banknote className="w-3 h-3" aria-hidden="true" />
                                {tr('Collect cash', 'تحصيل نقدي')}
                              </button>
                            )}

                            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#8B263E] mx-auto" aria-hidden="true" />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ---------------- 4. INVENTORY TAB ---------------- */}
      {activeTab === 'inventory' && (
        <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 shadow-xs space-y-5" data-panel="inventory">
          <div className="pb-3 border-b border-[#F0E3DF]">
            <h3 className="font-bold text-sm text-[#2D1E2F]">{tr('Variant inventory', 'مخزون الدرجات')}</h3>
            <p className="text-xs text-[#8B6E7E]">
              {tr(
                'Add or remove units with a reason. The server rejects adjustments that would drive stock below zero. Every change is recorded in the audit log.',
                'أضف وحدات أو اخصمها مع ذكر السبب. يرفض الخادم أي تعديل يؤدي إلى مخزون سالب. يُسجَّل كل تغيير في سجل المراجعة.',
              )}
            </p>
          </div>

          <div className="relative max-w-sm">
            <input
              type="text"
              value={productSearch}
              onChange={(event) => changeProductSearch(event.target.value)}
              aria-label={tr('Search products', 'ابحث في المنتجات')}
              placeholder={tr('Search products by title or brand...', 'ابحث عن المنتجات بالاسم أو الماركة...')}
              className="w-full bg-white border border-[#E8D6D1] rounded-xl py-2 px-9 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
            />
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5 rtl:left-auto rtl:right-3" aria-hidden="true" />
          </div>

          {productsError && (
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-900 flex items-center justify-between gap-2">
              <span>{productsError}</span>
              <button
                onClick={() => void loadProducts(productSearch, productPage)}
                className="px-3 py-1.5 bg-white border border-rose-200 rounded-lg font-bold hover:bg-rose-100"
              >
                {tr('Retry', 'إعادة المحاولة')}
              </button>
            </div>
          )}

          {products.length === 0 ? (
            !productsError && (
              <div data-empty="inventory" className="py-10 text-center text-xs text-[#8B6E7E]">
                <Package className="w-8 h-8 mx-auto text-[#D4A29C] mb-2" aria-hidden="true" />
                <p className="font-bold text-[#2D1E2F]">{tr('No products available.', 'لا توجد منتجات متاحة.')}</p>
                <p>{tr('Add a product or clear the search before adjusting stock.', 'أضف منتجاً أو امسح البحث قبل تعديل المخزون.')}</p>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <Field label={tr('Product', 'المنتج')}>
                <select
                  value={inventoryProductId}
                  onChange={(event) => {
                    setInventoryProductId(event.target.value);
                    setInventoryVariantId('');
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">{tr('Select a product', 'اختر منتجاً')}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {l(product.name)} — {brandLabel(product.brand)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={tr('Variant', 'الدرجة')}>
                <select
                  value={inventoryVariantId}
                  onChange={(event) => setInventoryVariantId(event.target.value)}
                  disabled={!inventoryProduct}
                  className={SELECT_CLASS}
                >
                  <option value="">{tr('Select a variant', 'اختر درجة')}</option>
                  {inventoryProduct?.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.sku} —{' '}
                      {variant.shadeName ? l(variant.shadeName) : variant.size ?? tr('Standard', 'افتراضي')} (
                      {variant.stock})
                    </option>
                  ))}
                </select>
              </Field>

              <div
                className="bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-3"
                data-field="current-stock"
                data-stock-state={stockState ?? undefined}
              >
                <span className="block text-[10px] font-bold uppercase text-[#8B6E7E]">
                  {tr('Current stock', 'المخزون الحالي')}
                </span>
                <p className="font-serif text-2xl font-bold text-[#2D1E2F]">
                  {inventoryVariant ? `${inventoryVariant.stock} ${tr('units', 'وحدة')}` : '—'}
                </p>
                {stockState && (
                  <span
                    className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      stockState === 'out'
                        ? 'bg-rose-100 text-rose-800'
                        : stockState === 'low'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {stockState === 'out'
                      ? tr('Out of stock', 'نفد المخزون')
                      : stockState === 'low'
                        ? tr('Low stock (1–5)', 'مخزون منخفض (1–5)')
                        : tr('In stock', 'متوفر')}
                  </span>
                )}
                {inventoryVariant && inventoryVariant.isActive === false && (
                  <span className="block text-[10px] font-bold text-stone-600 mt-1">
                    {tr('Inactive variant', 'درجة غير مفعّلة')}
                  </span>
                )}
              </div>

              <fieldset className="space-y-1">
                <legend className="block font-bold mb-1">{tr('Adjustment type', 'نوع التعديل')}</legend>
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="radio"
                    name="inventory-mode"
                    value="delta"
                    checked={inventoryMode === 'delta'}
                    onChange={() => setInventoryMode('delta')}
                    className="accent-[#8B263E]"
                  />
                  <span>{tr('Add / remove units (+/−)', 'إضافة / خصم وحدات (+/−)')}</span>
                </label>
                <label
                  className={`flex items-center gap-2 font-semibold ${canSetExact ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                  title={
                    canSetExact
                      ? undefined
                      : tr(
                          'Exact-count mode needs the variant row version from the server, which is not available for this variant.',
                          'يحتاج وضع العدد الدقيق إلى إصدار صف الدرجة من الخادم وهو غير متاح لهذه الدرجة.',
                        )
                  }
                >
                  <input
                    type="radio"
                    name="inventory-mode"
                    value="absolute"
                    checked={inventoryMode === 'absolute'}
                    disabled={!canSetExact}
                    onChange={() => setInventoryMode('absolute')}
                    className="accent-[#8B263E]"
                  />
                  <span>{tr('Set exact count (stock count correction)', 'تحديد العدد الدقيق (تصحيح الجرد)')}</span>
                </label>
                {!canSetExact && (
                  <p className="text-[10px] text-[#8B6E7E]" data-field="exact-unavailable">
                    {tr(
                      'Exact-count mode is unavailable: the server did not provide a row version for this variant, so a stale count could not be detected.',
                      'وضع العدد الدقيق غير متاح: لم يوفّر الخادم إصدار الصف لهذه الدرجة، لذا لا يمكن اكتشاف عدّ قديم.',
                    )}
                  </p>
                )}
              </fieldset>

              {inventoryMode === 'delta' ? (
                <Field label={tr('Adjustment (+/−)', 'التعديل (+/−)')}>
                  <input
                    type="number"
                    step="1"
                    value={inventoryDelta}
                    onChange={(event) => setInventoryDelta(event.target.value)}
                    className={INPUT_CLASS}
                  />
                  <span className="block text-[10px] text-[#8B6E7E] mt-1">
                    {tr('Use a negative number to remove units.', 'استخدم رقماً سالباً لخفض الكمية.')}
                  </span>
                </Field>
              ) : (
                <Field label={tr('New stock count', 'العدد الجديد للمخزون')}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={inventoryNewStock}
                    onChange={(event) => setInventoryNewStock(event.target.value)}
                    className={INPUT_CLASS}
                  />
                  <span className="block text-[10px] text-[#8B6E7E] mt-1">
                    {tr(
                      'Rejected if the stock changed since this page loaded.',
                      'يُرفض التعديل إذا تغيّر المخزون منذ تحميل هذه الصفحة.',
                    )}
                  </span>
                </Field>
              )}

              <Field label={tr('Reason *', 'السبب *')} className="md:col-span-2">
                <input
                  type="text"
                  value={inventoryReason}
                  onChange={(event) => setInventoryReason(event.target.value)}
                  placeholder={tr('e.g. Stock count correction', 'مثال: تصحيح جرد المخزون')}
                  className={INPUT_CLASS}
                />
              </Field>

              {inventoryError && (
                <p
                  role="alert"
                  data-error="inventory"
                  className="md:col-span-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 font-semibold"
                >
                  {inventoryError}
                </p>
              )}

              <div className="md:col-span-2 flex justify-end">
                <button
                  onClick={() => void handleAdjustInventory()}
                  disabled={inventorySaving || !inventoryProduct || !inventoryVariant}
                  className="px-5 py-2.5 bg-[#3B2332] text-white rounded-xl font-bold hover:bg-[#523347] transition flex items-center gap-2 disabled:opacity-50"
                >
                  {inventorySaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                  {tr('Apply adjustment', 'تطبيق التعديل')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- 5. DISCOUNT CODES TAB ---------------- */}
      {activeTab === 'discounts' && (
        <div className="space-y-4" data-panel="discounts">
          <div className="flex justify-between items-center gap-3">
            <div>
              <h3 className="font-bold text-sm text-[#2D1E2F]">{tr('Store promotional coupons', 'كوبونات المتجر الترويجية')}</h3>
              <p className="text-xs text-[#8B6E7E]">
                {tr(
                  'Percentage or fixed vouchers with usage limits. Archiving keeps the coupon record.',
                  'كوبونات بنسبة أو مبلغ ثابت مع حدود استخدام. الأرشفة تحفظ سجل الكوبون.',
                )}
              </p>
            </div>
            <button
              onClick={() => {
                setDiscountFormError(null);
                setDiscountDraft(createDiscountDraft());
              }}
              className="px-4 py-2 bg-[#3B2332] text-white rounded-xl text-xs font-bold hover:bg-[#523347] transition flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>{tr('Create coupon', 'إنشاء كوبون')}</span>
            </button>
          </div>

          {discountsError && (
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-900 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                <span>{discountsError}</span>
              </span>
              <button
                onClick={() => void loadDiscounts()}
                className="px-3 py-1.5 bg-white border border-rose-200 rounded-lg font-bold flex items-center gap-1.5 hover:bg-rose-100"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                {tr('Retry', 'إعادة المحاولة')}
              </button>
            </div>
          )}

          {discountsLoading ? (
            <div className="bg-white rounded-3xl border border-[#E8D6D1] p-10 text-center text-xs text-[#8B6E7E]">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" aria-hidden="true" />
              {tr('Loading coupons...', 'جارٍ تحميل الكوبونات...')}
            </div>
          ) : discounts.length === 0 ? (
            !discountsError && (
              <div className="bg-white rounded-3xl border border-[#E8D6D1] p-10 text-center text-xs text-[#8B6E7E]">
                <Tag className="w-8 h-8 mx-auto text-[#D4A29C] mb-2" aria-hidden="true" />
                <p className="font-bold text-[#2D1E2F]">{tr('No coupons yet.', 'لا توجد كوبونات بعد.')}</p>
                <p>{tr('Create a coupon to offer a storewide discount.', 'أنشئ كوبوناً لتقديم خصم على المتجر.')}</p>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {discounts.map((discount) => {
                const expired = new Date(discount.expiryDate).getTime() <= Date.now();
                const state = !discount.active ? 'archived' : expired ? 'expired' : 'active';
                return (
                  <div
                    key={discount.code}
                    data-coupon={discount.code}
                    data-coupon-state={state}
                    className="bg-white rounded-2xl border border-[#E8D6D1] p-5 space-y-3 relative shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Tag className="w-4 h-4 text-[#8B263E] shrink-0" aria-hidden="true" />
                        <span className="font-mono text-base font-bold text-[#2D1E2F] truncate" dir="ltr">
                          {discount.code}
                        </span>
                      </div>
                      <span className="text-xs font-bold bg-[#EAF5EC] text-emerald-800 px-2 py-0.5 rounded-full shrink-0">
                        {discount.type === 'percentage'
                          ? tr(`${discount.value}% off`, `خصم ${discount.value}%`)
                          : tr(`${formatMoney(discount.value, language)} off`, `خصم ${formatMoney(discount.value, language)}`)}
                      </span>
                    </div>

                    <div className="text-xs text-[#503E48] space-y-1">
                      <p>
                        {tr('Min. order', 'أقل قيمة للطلب')}: <strong>{formatMoney(discount.minOrderAmount, language)}</strong>
                      </p>
                      {discount.maxDiscount !== undefined && discount.maxDiscount !== null && (
                        <p>
                          {tr('Max discount', 'أقصى خصم')}: <strong>{formatMoney(discount.maxDiscount, language)}</strong>
                        </p>
                      )}
                      <p data-field="usage">
                        {tr('Usage', 'الاستخدام')}:{' '}
                        <strong>
                          {discount.currentUsage} /{' '}
                          {discount.usageLimit > 0 ? discount.usageLimit : tr('unlimited', 'غير محدود')}
                        </strong>
                      </p>
                      <p className="text-[11px] text-[#8B6E7E]">
                        {tr('Expires', 'ينتهي')}: {new Date(discount.expiryDate).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-GB')}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-[#F0E3DF] flex items-center justify-between gap-2">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          state === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'
                        }`}
                      >
                        {state === 'active'
                          ? tr('Active', 'مفعّل')
                          : state === 'expired'
                            ? tr('Expired', 'منتهي')
                            : tr('Archived', 'مؤرشف')}
                      </span>
                      <button
                        onClick={() => void handleArchiveDiscount(discount)}
                        disabled={!discount.active || archivingCode === discount.code}
                        aria-label={`${tr('Archive coupon', 'أرشفة الكوبون')} ${discount.code}`}
                        className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 disabled:opacity-40"
                      >
                        {archivingCode === discount.code ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{tr('Archive', 'أرشفة')}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---------------- 6. BANNERS TAB ---------------- */}
      {activeTab === 'banners' && (
        <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 shadow-xs space-y-4" data-panel="banners">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0E3DF]">
            <div>
              <h3 className="font-bold text-sm text-[#2D1E2F]">{tr('Homepage promotional banners', 'بانرات الصفحة الرئيسية الترويجية')}</h3>
              <p className="text-xs text-[#8B6E7E]">
                {tr(
                  'Edit banner copy in both languages, then save the full list.',
                  'عدّل نصوص البانرات باللغتين ثم احفظ القائمة كاملة.',
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadBanners()}
                disabled={bannersLoading || bannersSaving}
                className="px-3 py-2 border border-[#E8D6D1] rounded-xl text-xs font-bold text-[#503E48] hover:bg-[#FAF7F5] transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${bannersLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                {tr('Reload', 'إعادة تحميل')}
              </button>
              <button
                onClick={() => void handleSaveBanners()}
                disabled={bannersLoading || bannersSaving || banners.length === 0}
                className="px-4 py-2 bg-[#3B2332] text-white rounded-xl text-xs font-bold hover:bg-[#523347] transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {bannersSaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {tr('Save banners', 'حفظ البانرات')}
              </button>
            </div>
          </div>

          {bannersError && (
            <div role="alert" className="bg-rose-50 border border-rose-200 rounded-2xl p-3 text-xs text-rose-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
              <span>{bannersError}</span>
            </div>
          )}

          {bannersLoading ? (
            <div className="py-10 text-center text-xs text-[#8B6E7E]">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" aria-hidden="true" />
              {tr('Loading banners...', 'جارٍ تحميل البانرات...')}
            </div>
          ) : banners.length === 0 ? (
            !bannersError && (
              <div className="py-10 text-center text-xs text-[#8B6E7E]">
                <ImageIcon className="w-8 h-8 mx-auto text-[#D4A29C] mb-2" aria-hidden="true" />
                <p className="font-bold text-[#2D1E2F]">{tr('No banners configured.', 'لا توجد بانرات مُعدّة.')}</p>
                <p>{tr('Banners defined in the store configuration appear here.', 'تظهر هنا البانرات المعرّفة في إعدادات المتجر.')}</p>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {banners.map((banner) => (
                <div key={banner.id} data-banner={banner.id} className="p-4 rounded-2xl border border-[#E8D6D1] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[10px] font-bold uppercase text-[#8B263E]" dir="ltr">
                      {banner.id}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        banner.active ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {banner.active ? tr('Active', 'مفعّل') : tr('Inactive', 'غير مفعّل')}
                    </span>
                  </div>

                  <div className="flex flex-col lg:flex-row gap-4">
                    {banner.imageUrl ? (
                      <img
                        src={mediaUrl(banner.imageUrl)}
                        alt={l(banner.title)}
                        className="w-full lg:w-44 h-28 object-cover rounded-xl border border-[#E8D6D1]"
                      />
                    ) : (
                      <div className="w-full lg:w-44 h-28 rounded-xl border border-[#E8D6D1] bg-[#FAF7F5] flex items-center justify-center text-[#B49AA6]">
                        <ImageIcon className="w-6 h-6" aria-hidden="true" />
                      </div>
                    )}

                    <div className="flex-1 space-y-3 text-xs">
                      <BilingualText
                        label={tr('Title', 'العنوان')}
                        value={banner.title}
                        onChange={(next) => patchBanner(banner.id, (current) => ({ ...current, title: next }))}
                      />
                      <BilingualText
                        label={tr('Subtitle', 'العنوان الفرعي')}
                        value={banner.subtitle}
                        onChange={(next) => patchBanner(banner.id, (current) => ({ ...current, subtitle: next }))}
                      />
                      <BilingualText
                        label={tr('Badge', 'الشارة')}
                        value={banner.badge}
                        onChange={(next) => patchBanner(banner.id, (current) => ({ ...current, badge: next }))}
                      />
                      <BilingualText
                        label={tr('CTA text', 'نص زر الإجراء')}
                        value={banner.ctaText}
                        onChange={(next) => patchBanner(banner.id, (current) => ({ ...current, ctaText: next }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    <div className="lg:col-span-2 space-y-2">
                      <Field label={tr('Image URL', 'رابط الصورة')}>
                        <input
                          type="text"
                          inputMode="url"
                          dir="ltr"
                          value={banner.imageUrl}
                          onChange={(event) =>
                            patchBanner(banner.id, (current) => ({ ...current, imageUrl: event.target.value }))
                          }
                          className={INPUT_CLASS}
                        />
                      </Field>
                      <label className="inline-flex px-3 py-2 bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl font-bold text-[#3B2332] hover:bg-[#F3E7E4] transition items-center gap-1.5 cursor-pointer focus-within:ring-2 focus-within:ring-[#8B263E]">
                        {uploadingImage ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>{tr('Upload image', 'رفع صورة')}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          data-upload={banner.id}
                          disabled={uploadingImage}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) {
                              void handleUploadImage(file, banner.id);
                            }
                          }}
                        />
                      </label>
                      {uploadError?.target === banner.id && (
                        <p role="alert" data-error="upload" className="text-rose-700 font-semibold">
                          {uploadError.message}
                        </p>
                      )}
                    </div>
                    <Field label={tr('Discount code', 'كود الخصم')}>
                      <input
                        type="text"
                        value={banner.discountCode ?? ''}
                        onChange={(event) =>
                          patchBanner(banner.id, (current) => ({
                            ...current,
                            discountCode: event.target.value.trim().length > 0
                              ? event.target.value.toUpperCase()
                              : undefined,
                          }))
                        }
                        placeholder="WELCOME15"
                        dir="ltr"
                        className={`${INPUT_CLASS} font-mono uppercase`}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={tr('Order', 'الترتيب')}>
                        <input
                          type="number"
                          step="1"
                          value={banner.order}
                          onChange={(event) =>
                            patchBanner(banner.id, (current) => ({
                              ...current,
                              order: Math.round(toNumber(event.target.value)),
                            }))
                          }
                          className={INPUT_CLASS}
                        />
                      </Field>
                      <label className="flex items-end gap-2 pb-2.5 font-bold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={banner.active}
                          onChange={(event) =>
                            patchBanner(banner.id, (current) => ({ ...current, active: event.target.checked }))
                          }
                          className="w-4 h-4 accent-[#8B263E]"
                        />
                        <span>{tr('Active', 'مفعّل')}</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Product Modal */}
      {productDraft && (
        <AdminModal
          title={productDraft.id ? t('admin.editProduct') : t('admin.addProduct')}
          closeLabel={tr('Close', 'إغلاق')}
          onClose={() => setProductDraft(null)}
          widthClass="max-w-4xl"
        >
          <form onSubmit={(event) => void handleSaveProduct(event)} className="space-y-5 text-xs" data-form="product">
            {productFormError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{productFormError}</span>
              </div>
            )}

            <BilingualText
              label={tr('Product name', 'اسم المنتج')}
              value={productDraft.name}
              onChange={(next) => patchProductDraft((draft) => ({ ...draft, name: next }))}
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={tr('Brand *', 'الماركة *')}>
                {brands.length > 0 ? (
                  <select
                    required
                    value={productDraft.brand}
                    onChange={(event) => patchProductDraft((draft) => ({ ...draft, brand: event.target.value }))}
                    className={SELECT_CLASS}
                  >
                    {productDraft.brand && !brands.some((brand) => brand.name === productDraft.brand) && (
                      <option value={productDraft.brand}>{productDraft.brand}</option>
                    )}
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.name}>
                        {brand.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={productDraft.brand}
                    onChange={(event) => patchProductDraft((draft) => ({ ...draft, brand: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                )}
              </Field>

              <Field label={tr('Category *', 'الفئة *')}>
                {categories.length > 0 ? (
                  <select
                    required
                    value={productDraft.category}
                    onChange={(event) => patchProductDraft((draft) => ({ ...draft, category: event.target.value }))}
                    className={SELECT_CLASS}
                  >
                    {productDraft.category && !categories.some((category) => category.id === productDraft.category) && (
                      <option value={productDraft.category}>{productDraft.category}</option>
                    )}
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {l(category.name)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={productDraft.category}
                    onChange={(event) => patchProductDraft((draft) => ({ ...draft, category: event.target.value }))}
                    className={INPUT_CLASS}
                  />
                )}
              </Field>

              <Field label={tr('Subcategory', 'قسم فرعي')}>
                <input
                  type="text"
                  value={productDraft.subCategory}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, subCategory: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label={tr('Base price (EGP) *', 'السعر الأساسي (ج.م) *')}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={productDraft.price}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, price: event.target.value }))}
                  className={`${INPUT_CLASS} font-bold text-[#8B263E]`}
                />
              </Field>
              <Field label={tr('Original price', 'السعر قبل الخصم')}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={productDraft.originalPrice}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, originalPrice: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label={tr('Rating (0-5)', 'التقييم (0-5)')}>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={productDraft.rating}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, rating: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label={tr('Reviews count', 'عدد المراجعات')}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={productDraft.reviewsCount}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, reviewsCount: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>
            <p className="text-[10px] text-[#8B6E7E] -mt-3">
              {tr(
                'Rating and review count are displayed to shoppers as entered. New products start at 0 — there is no review system behind these numbers.',
                'يُعرض التقييم وعدد المراجعات للعملاء كما تُدخلهما. تبدأ المنتجات الجديدة من 0 — لا يوجد نظام مراجعات خلف هذه الأرقام.',
              )}
            </p>

            <BilingualText
              label={tr('Description', 'الوصف')}
              value={productDraft.description}
              onChange={(next) => patchProductDraft((draft) => ({ ...draft, description: next }))}
              rows={2}
            />
            <BilingualText
              label={tr('Ingredients', 'المكونات')}
              value={productDraft.ingredients}
              onChange={(next) => patchProductDraft((draft) => ({ ...draft, ingredients: next }))}
              rows={2}
            />
            <BilingualText
              label={tr('How to use', 'طريقة الاستخدام')}
              value={productDraft.howToUse}
              onChange={(next) => patchProductDraft((draft) => ({ ...draft, howToUse: next }))}
              rows={2}
            />

            {/* Images */}
            <div className="space-y-2" data-section="images">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-[#8B263E]" aria-hidden="true" />
                <span className="font-bold">{tr('Images', 'الصور')}</span>
              </div>
              {productDraft.images.map((image, index) => (
                <div key={index} className="flex items-center gap-2">
                  {image.trim().length > 0 && (
                    <img
                      src={mediaUrl(image)}
                      alt={`${tr('Image', 'صورة')} ${index + 1}`}
                      className="w-9 h-9 object-cover rounded-lg border border-[#E8D6D1] shrink-0"
                    />
                  )}
                  <input
                    type="text"
                    inputMode="url"
                    value={image}
                    onChange={(event) =>
                      patchProductDraft((draft) => ({
                        ...draft,
                        images: draft.images.map((entry, imageIndex) =>
                          imageIndex === index ? event.target.value : entry,
                        ),
                      }))
                    }
                    aria-label={`${tr('Image URL', 'رابط الصورة')} ${index + 1}`}
                    placeholder="https://..."
                    dir="ltr"
                    className={INPUT_CLASS}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patchProductDraft((draft) => ({
                        ...draft,
                        images: draft.images.filter((_, imageIndex) => imageIndex !== index),
                      }))
                    }
                    disabled={productDraft.images.length === 1}
                    className="p-2 rounded-lg border border-[#E8D6D1] text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    aria-label={`${tr('Remove image', 'إزالة الصورة')} ${index + 1}`}
                    title={tr('Remove image', 'إزالة الصورة')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => patchProductDraft((draft) => ({ ...draft, images: [...draft.images, ''] }))}
                  className="px-3 py-2 border border-[#E8D6D1] rounded-xl font-bold text-[#503E48] hover:bg-[#FAF7F5] transition flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {tr('Add image URL', 'إضافة رابط صورة')}
                </button>
                <label className="px-3 py-2 bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl font-bold text-[#3B2332] hover:bg-[#F3E7E4] transition flex items-center gap-1.5 cursor-pointer focus-within:ring-2 focus-within:ring-[#8B263E]">
                  {uploadingImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>{uploadingImage ? tr('Uploading...', 'جارٍ الرفع...') : tr('Upload image', 'رفع صورة')}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    data-upload="product"
                    disabled={uploadingImage}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) {
                        void handleUploadImage(file, 'product');
                      }
                    }}
                  />
                </label>
                <span className="text-[10px] text-[#8B6E7E]">
                  {tr('JPEG, PNG or WebP, up to 5 MB.', 'JPEG أو PNG أو WebP حتى 5 ميجابايت.')}
                </span>
              </div>
              {uploadError?.target === 'product' && (
                <p role="alert" data-error="upload" className="text-rose-700 font-semibold">
                  {uploadError.message}
                </p>
              )}
            </div>

            {/* Attributes */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={tr('Finish', 'اللمسة النهائية')}>
                <select
                  value={productDraft.finish}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, finish: event.target.value }))}
                  className={SELECT_CLASS}
                >
                  <option value="">—</option>
                  {FINISH_OPTIONS.map((finish) => (
                    <option key={finish} value={finish}>
                      {enumLabel(finish)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Coverage', 'التغطية')}>
                <select
                  value={productDraft.coverage}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, coverage: event.target.value }))}
                  className={SELECT_CLASS}
                >
                  <option value="">—</option>
                  {COVERAGE_OPTIONS.map((coverage) => (
                    <option key={coverage} value={coverage}>
                      {enumLabel(coverage)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('Shade family', 'عائلة الدرجات')}>
                <input
                  type="text"
                  value={productDraft.shadeFamily}
                  onChange={(event) => patchProductDraft((draft) => ({ ...draft, shadeFamily: event.target.value }))}
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

            <fieldset>
              <legend className="block font-bold mb-1">{tr('Skin types', 'أنواع البشرة')}</legend>
              <div className="flex flex-wrap gap-3">
                {SKIN_TYPE_OPTIONS.map((skinType) => (
                  <label key={skinType} className="flex items-center gap-1.5 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productDraft.skinType.includes(skinType)}
                      onChange={() =>
                        patchProductDraft((draft) => ({
                          ...draft,
                          skinType: draft.skinType.includes(skinType)
                            ? draft.skinType.filter((entry) => entry !== skinType)
                            : [...draft.skinType, skinType],
                        }))
                      }
                      className="w-4 h-4 accent-[#8B263E]"
                    />
                    <span>{enumLabel(skinType)}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-wrap items-center gap-4">
                {(
                  [
                    ['isFeatured', tr('Featured', 'مميز')],
                    ['isNewArrival', tr('New arrival', 'وصل حديثاً')],
                    ['isBestSeller', tr('Best seller', 'الأكثر مبيعاً')],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="flex items-center gap-1.5 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={productDraft[field]}
                      onChange={(event) => patchProductDraft((draft) => ({ ...draft, [field]: event.target.checked }))}
                      className="w-4 h-4 accent-[#8B263E]"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <Field label={tr('Status', 'الحالة')}>
                <select
                  value={productDraft.status}
                  onChange={(event) =>
                    patchProductDraft((draft) => ({
                      ...draft,
                      status: event.target.value === 'archived' ? 'archived' : 'published',
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  <option value="published">{enumLabel('published')}</option>
                  <option value="archived">{enumLabel('archived')}</option>
                </select>
              </Field>
            </div>

            {/* Variants */}
            <div className="space-y-2" data-section="variants">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-bold">{tr('Variants & shades', 'الدرجات والخيارات')}</span>
                  <p className="text-[10px] text-[#8B6E7E]">
                    {tr(
                      'Existing variant stock is read-only — use the Inventory tab. Deactivate instead of removing.',
                      'مخزون الدرجات الحالية للقراءة فقط — استخدم تبويب المخزون. عطّل الدرجة بدلاً من حذفها.',
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patchProductDraft((draft) => ({
                      ...draft,
                      variants: [...draft.variants, createVariantDraft(draft.price)],
                    }))
                  }
                  className="px-3 py-2 border border-[#E8D6D1] rounded-xl font-bold text-[#503E48] hover:bg-[#FAF7F5] transition flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  {tr('Add variant', 'إضافة درجة')}
                </button>
              </div>

              <div className="overflow-x-auto border border-[#E8D6D1] rounded-xl">
                <table className="w-full text-[11px] min-w-[860px]">
                  <thead>
                    <tr className="bg-[#FAF7F5] text-[#8B6E7E] uppercase text-[10px]">
                      <th className="py-2 px-2 text-start">SKU *</th>
                      <th className="py-2 px-2 text-start">{tr('Shade (EN)', 'الدرجة (EN)')}</th>
                      <th className="py-2 px-2 text-start">{tr('Shade (AR)', 'الدرجة (AR)')}</th>
                      <th className="py-2 px-2 text-start">{tr('Shade colour', 'لون الدرجة')}</th>
                      <th className="py-2 px-2 text-start">{tr('Size', 'الحجم')}</th>
                      <th className="py-2 px-2 text-start">{tr('Price *', 'السعر *')}</th>
                      <th className="py-2 px-2 text-start">{tr('Stock', 'المخزون')}</th>
                      <th className="py-2 px-2 text-center">{tr('Active', 'مفعّل')}</th>
                      <th className="py-2 px-2">
                        <span className="sr-only">{tr('Actions', 'إجراءات')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0E3DF]">
                    {productDraft.variants.map((variant, index) => {
                      const rowNo = index + 1;
                      return (
                        <tr key={variant.id ?? `new-${index}`} data-variant-row={rowNo}>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              required
                              value={variant.sku}
                              onChange={(event) => updateVariant(index, { sku: event.target.value })}
                              aria-label={`SKU ${rowNo}`}
                              aria-invalid={skuError ? true : undefined}
                              dir="ltr"
                              className={`w-32 bg-white border rounded-lg p-1.5 font-mono ${
                                skuError ? 'border-rose-400' : 'border-[#E8D6D1]'
                              }`}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={variant.shadeEn}
                              onChange={(event) => updateVariant(index, { shadeEn: event.target.value })}
                              aria-label={`${tr('Shade (EN)', 'الدرجة (EN)')} ${rowNo}`}
                              className="w-28 bg-white border border-[#E8D6D1] rounded-lg p-1.5"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              dir="rtl"
                              value={variant.shadeAr}
                              onChange={(event) => updateVariant(index, { shadeAr: event.target.value })}
                              aria-label={`${tr('Shade (AR)', 'الدرجة (AR)')} ${rowNo}`}
                              className="w-28 bg-white border border-[#E8D6D1] rounded-lg p-1.5"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="color"
                                value={/^#[0-9a-fA-F]{6}$/.test(variant.shadeHex) ? variant.shadeHex : '#BD6B73'}
                                onChange={(event) => updateVariant(index, { shadeHex: event.target.value.toUpperCase() })}
                                className="w-7 h-7 rounded border border-[#E8D6D1] bg-white"
                                aria-label={`${tr('Pick shade colour', 'اختر لون الدرجة')} ${rowNo}`}
                                title={tr('Pick shade colour', 'اختر لون الدرجة')}
                              />
                              <input
                                type="text"
                                value={variant.shadeHex}
                                onChange={(event) => updateVariant(index, { shadeHex: event.target.value })}
                                aria-label={`${tr('Shade hex', 'كود اللون')} ${rowNo}`}
                                placeholder="#BD6B73"
                                dir="ltr"
                                className="w-20 bg-white border border-[#E8D6D1] rounded-lg p-1.5 font-mono"
                              />
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="text"
                              value={variant.size}
                              onChange={(event) => updateVariant(index, { size: event.target.value })}
                              aria-label={`${tr('Size', 'الحجم')} ${rowNo}`}
                              className="w-20 bg-white border border-[#E8D6D1] rounded-lg p-1.5"
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              required
                              value={variant.price}
                              onChange={(event) => updateVariant(index, { price: event.target.value })}
                              aria-label={`${tr('Price', 'السعر')} ${rowNo}`}
                              className="w-20 bg-white border border-[#E8D6D1] rounded-lg p-1.5 font-bold"
                            />
                          </td>
                          <td className="py-2 px-2">
                            {variant.id ? (
                              <div>
                                <input
                                  type="number"
                                  value={variant.stock}
                                  readOnly
                                  aria-label={`${tr('Current stock (read-only)', 'المخزون الحالي (للقراءة فقط)')} ${rowNo}`}
                                  className="w-20 bg-[#F3E7E4] border border-[#E8D6D1] rounded-lg p-1.5 font-bold text-[#503E48] cursor-not-allowed"
                                />
                                <span className="block text-[9px] text-[#8B6E7E]">
                                  {tr('Use Inventory tab', 'استخدم تبويب المخزون')}
                                </span>
                              </div>
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={variant.stock}
                                onChange={(event) => updateVariant(index, { stock: event.target.value })}
                                aria-label={`${tr('Initial stock', 'المخزون الابتدائي')} ${rowNo}`}
                                className="w-20 bg-white border border-[#E8D6D1] rounded-lg p-1.5"
                                title={tr('Initial stock for a new variant', 'المخزون الابتدائي للدرجة الجديدة')}
                              />
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <input
                              type="checkbox"
                              checked={variant.isActive}
                              onChange={(event) => updateVariant(index, { isActive: event.target.checked })}
                              className="w-4 h-4 accent-[#8B263E]"
                              aria-label={`${tr('Active', 'مفعّل')} ${rowNo}`}
                              title={tr(
                                'Inactive variants are kept but hidden from shoppers',
                                'الدرجات غير المفعّلة تُحفظ ولكن لا تظهر للعملاء',
                              )}
                            />
                          </td>
                          <td className="py-2 px-2">
                            {variant.id ? (
                              <span
                                className="text-[10px] text-[#B49AA6]"
                                title={tr('Existing variants are never deleted', 'لا يتم حذف الدرجات الحالية')}
                              >
                                —
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  patchProductDraft((draft) => ({
                                    ...draft,
                                    variants: draft.variants.filter((_, variantIndex) => variantIndex !== index),
                                  }))
                                }
                                className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50"
                                aria-label={`${tr('Remove new variant', 'إزالة الدرجة الجديدة')} ${rowNo}`}
                                title={tr('Remove new variant', 'إزالة الدرجة الجديدة')}
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {skuError && (
                <p role="alert" data-error="sku" className="text-rose-700 font-semibold">
                  {skuError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#E8D6D1]">
              <button
                type="button"
                onClick={() => setProductDraft(null)}
                className="px-5 py-2.5 border border-[#E8D6D1] rounded-xl font-bold"
              >
                {tr('Cancel', 'إلغاء')}
              </button>
              <button
                type="submit"
                disabled={productSaving}
                className="px-6 py-2.5 bg-[#3B2332] text-white rounded-xl font-bold hover:bg-[#523347] transition flex items-center gap-2 disabled:opacity-60"
              >
                {productSaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {tr('Save Product', 'حفظ المنتج')}
              </button>
            </div>
          </form>
        </AdminModal>
      )}

      {/* Create Discount Modal */}
      {discountDraft && (
        <AdminModal
          title={tr('Create new discount coupon', 'إنشاء كوبون خصم جديد')}
          closeLabel={tr('Close', 'إغلاق')}
          onClose={() => setDiscountDraft(null)}
          widthClass="max-w-md"
        >
          <form onSubmit={(event) => void handleCreateDiscount(event)} className="space-y-3 text-xs" data-form="discount">
            {discountFormError && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{discountFormError}</span>
              </div>
            )}

            <Field label={tr('Coupon code *', 'كود الكوبون *')}>
              <input
                type="text"
                required
                value={discountDraft.code}
                onChange={(event) =>
                  setDiscountDraft((current) => (current ? { ...current, code: event.target.value.toUpperCase() } : current))
                }
                placeholder={tr('e.g. SUMMER25', 'مثال: SUMMER25')}
                dir="ltr"
                className={`${INPUT_CLASS} font-mono uppercase font-bold`}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label={tr('Type', 'النوع')}>
                <select
                  value={discountDraft.type}
                  onChange={(event) =>
                    setDiscountDraft((current) =>
                      current ? { ...current, type: event.target.value === 'fixed' ? 'fixed' : 'percentage' } : current,
                    )
                  }
                  className={SELECT_CLASS}
                >
                  <option value="percentage">{tr('Percentage (%)', 'نسبة مئوية (%)')}</option>
                  <option value="fixed">{tr('Fixed amount (EGP)', 'مبلغ ثابت (ج.م)')}</option>
                </select>
              </Field>
              <Field label={tr('Discount value *', 'قيمة الخصم *')}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={discountDraft.value}
                  onChange={(event) =>
                    setDiscountDraft((current) => (current ? { ...current, value: event.target.value } : current))
                  }
                  className={`${INPUT_CLASS} font-bold`}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label={tr('Min. order (EGP)', 'أقل قيمة للطلب (ج.م)')}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountDraft.minOrderAmount}
                  onChange={(event) =>
                    setDiscountDraft((current) => (current ? { ...current, minOrderAmount: event.target.value } : current))
                  }
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label={tr('Max cap (EGP)', 'أقصى خصم (ج.م)')}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountDraft.maxDiscount}
                  onChange={(event) =>
                    setDiscountDraft((current) => (current ? { ...current, maxDiscount: event.target.value } : current))
                  }
                  className={INPUT_CLASS}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label={tr('Expiry date *', 'تاريخ الانتهاء *')}>
                <input
                  type="datetime-local"
                  required
                  value={discountDraft.expiryDate}
                  onChange={(event) =>
                    setDiscountDraft((current) => (current ? { ...current, expiryDate: event.target.value } : current))
                  }
                  className={INPUT_CLASS}
                />
              </Field>
              <Field label={tr('Usage limit', 'حد الاستخدام')}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={discountDraft.usageLimit}
                  onChange={(event) =>
                    setDiscountDraft((current) => (current ? { ...current, usageLimit: event.target.value } : current))
                  }
                  className={INPUT_CLASS}
                />
                <span className="block text-[10px] text-[#8B6E7E] mt-1">{tr('0 = unlimited', '0 = غير محدود')}</span>
              </Field>
            </div>

            <label className="flex items-center gap-2 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={discountDraft.active}
                onChange={(event) =>
                  setDiscountDraft((current) => (current ? { ...current, active: event.target.checked } : current))
                }
                className="w-4 h-4 accent-[#8B263E]"
              />
              <span>{tr('Active', 'مفعّل')}</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDiscountDraft(null)}
                className="flex-1 py-2.5 border border-[#E8D6D1] rounded-xl font-bold text-[#503E48]"
              >
                {tr('Cancel', 'إلغاء')}
              </button>
              <button
                type="submit"
                disabled={discountSaving}
                className="flex-1 py-2.5 bg-[#3B2332] text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {discountSaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {tr('Create code', 'إنشاء الكود')}
              </button>
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  );
};
