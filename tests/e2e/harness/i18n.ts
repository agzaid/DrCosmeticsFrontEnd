/**
 * Independent oracle for the user-visible copy the specs assert (exact English and Arabic text). Deliberately NOT
 * imported from src/: a wrong or missing translation in the app must fail a spec, not be echoed by it.
 */
import type { Lang } from './browser.ts';

export interface Texts {
  allProducts: string;
  addToBag: string;
  selectShade: string;
  outOfStock: string;
  inStock: string;
  lowStock: (count: number) => string;
  resultsCount: (count: number) => string;
  shopEmptyTitle: string;
  bagEmpty: string;
  wishlistEmptyTitle: string;
  free: string;
  freeShippingUnlocked: string;
  freeShippingProgress: (amount: number) => string;
  couponInvalid: string;
  couponApplyLabel: string;
  checkoutBtn: string;
  placeOrder: string;
  errors: {
    fullName: string;
    mobileNumber: string;
    city: string;
    streetAddress: string;
    email: string;
  };
  orderUnavailableTitle: string;
  loadErrorTitle: string;
  retry: string;
  loginInvalid: string;
  emailTaken: string;
  signIn: string;
  register: string;
  noOrders: string;
  noAddresses: string;
  statusPending: string;
  statusCancelled: string;
  defaultBadge: string;
  cancelOrder: string;
  logout: string;
  roleCustomer: string;
  quoteUnavailable: string;
  maxQuantity: (limit: number) => string;
  stockIssueAr: string;
}

export const TEXTS: Record<Lang, Texts> = {
  en: {
    allProducts: 'All Products',
    addToBag: 'Add to Bag',
    selectShade: 'Select Shade',
    outOfStock: 'Out of Stock',
    inStock: 'In Stock',
    lowStock: (count) => `Only ${count} left in stock - order soon`,
    resultsCount: (count) => `Showing ${count} products`,
    shopEmptyTitle: 'No matching beauty products',
    bagEmpty: 'Your shopping bag is currently empty',
    wishlistEmptyTitle: 'Your wishlist is empty',
    free: 'FREE',
    freeShippingUnlocked: '🎉 You qualify for FREE Egypt delivery!',
    freeShippingProgress: (amount) => `Add ${amount} EGP more for FREE Delivery!`,
    couponInvalid: 'Invalid or inactive discount code',
    couponApplyLabel: 'Apply',
    checkoutBtn: 'Proceed to Checkout',
    placeOrder: 'Confirm & Place Order',
    errors: {
      fullName: 'Full name must be at least 3 characters',
      mobileNumber: 'Please enter a valid 11-digit Egyptian mobile number (e.g., 01012345678)',
      city: 'Please enter your city/district',
      streetAddress: 'Please enter a detailed street address',
      email: 'Please enter a valid email address',
    },
    orderUnavailableTitle: 'Order not available',
    loadErrorTitle: 'We could not load this content',
    retry: 'Try again',
    loginInvalid: 'Invalid email or password',
    emailTaken: 'An account with this email already exists',
    signIn: 'Sign In',
    register: 'Create Account',
    noOrders: 'No previous orders found.',
    noAddresses: 'No delivery addresses saved yet. Click "Add New Address" above.',
    statusPending: 'Pending',
    statusCancelled: 'Cancelled',
    defaultBadge: 'Default',
    cancelOrder: 'Cancel order',
    logout: 'Sign Out',
    roleCustomer: 'Customer',
    quoteUnavailable: 'Prices could not be confirmed with the store. Totals shown are estimates.',
    maxQuantity: (limit) => `Maximum available quantity is ${limit}`,
    stockIssueAr: 'Some items are no longer available in the requested quantity.',
  },
  ar: {
    allProducts: 'جميع المنتجات',
    addToBag: 'أضيفي للحقيبة',
    selectShade: 'اختاري الدرجة',
    outOfStock: 'نفذت الكمية',
    inStock: 'متوفر بالمخزون',
    lowStock: (count) => `متبقي ${count} قطع فقط - اطلبي الآن`,
    resultsCount: (count) => `عرض ${count} منتج`,
    shopEmptyTitle: 'لا توجد منتجات مطابقة',
    bagEmpty: 'حقيبة التسوق فارغة حالياً',
    wishlistEmptyTitle: 'قائمة المفضلة فارغة',
    free: 'مجاناً',
    freeShippingUnlocked: '🎉 لقد حصلتِ على شحن مجاني لطلبك!',
    freeShippingProgress: (amount) => `أضيفي منتجات بقيمة ${amount} ج.م للحصول على شحن مجاني!`,
    couponInvalid: 'كود الخصم غير صالح أو لم يعد متاحاً',
    couponApplyLabel: 'تطبيق',
    checkoutBtn: 'متابعة الشراء والدفع',
    placeOrder: 'تأكيد وإرسال الطلب',
    errors: {
      fullName: 'يجب ألا يقل الاسم عن 3 أحرف',
      mobileNumber: 'يرجى إدخال رقم موبايل مصري صحيح من 11 رقماً (مثال: 01012345678)',
      city: 'يرجى إدخال المدينة / المنطقة',
      streetAddress: 'يرجى إدخال عنوان الشارع بالتفصيل',
      email: 'يرجى إدخال بريد إلكتروني صحيح',
    },
    orderUnavailableTitle: 'الطلب غير متاح',
    loadErrorTitle: 'تعذر تحميل هذا المحتوى',
    retry: 'حاولي مرة أخرى',
    loginInvalid: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    emailTaken: 'يوجد حساب مسجل بهذا البريد الإلكتروني بالفعل',
    signIn: 'تسجيل الدخول',
    register: 'إنشاء حساب جديد',
    noOrders: 'لا توجد طلبات سابقة حتى الآن.',
    noAddresses: 'لا توجد عناوين توصيل محفوظة بعد. اضغطي على "إضافة عنوان جديد" أعلاه.',
    statusPending: 'قيد الانتظار',
    statusCancelled: 'ملغي',
    defaultBadge: 'افتراضي',
    cancelOrder: 'إلغاء الطلب',
    logout: 'تسجيل الخروج',
    roleCustomer: 'عميل',
    quoteUnavailable: 'تعذر تأكيد الأسعار مع المتجر. المبالغ المعروضة تقديرية.',
    maxQuantity: (limit) => `الكمية القصوى المتاحة هي ${limit}`,
    stockIssueAr: 'بعض المنتجات لم تعد متوفرة بالكمية المطلوبة.',
  },
};

/** Mirrors the storefront's EGP formatting (whole amounts without decimals, cents kept) for assertions. */
export function egp(amount: number, lang: Lang): string {
  const options = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  return lang === 'ar'
    ? `${amount.toLocaleString('ar-EG', options)} ج.م`
    : `${amount.toLocaleString('en-US', options)} EGP`;
}

/** Reads a rendered money string (Latin or Arabic-Indic digits) back to a number. */
export function parseMoney(text: string): number {
  const latin = text
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/\u066b/g, '.')
    .replace(/[\u066c,]/g, '');
  const match = /-?\d+(\.\d+)?/.exec(latin);
  if (!match) {
    throw new Error(`No amount in "${text}"`);
  }
  return Number(match[0]);
}
