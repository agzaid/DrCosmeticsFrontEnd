import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Truck, 
  MapPin, 
  Phone, 
  User as UserIcon, 
  FileText, 
  CreditCard, 
  Banknote, 
  Sparkles, 
  ArrowRight, 
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Lock
} from 'lucide-react';
import type { Order, ShippingAddress } from '../types';
import { checkoutApi } from '../api/api';
import { ApiError } from '../api/httpClient';
import { mediaUrl } from '../api/config';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ADDRESS_ERROR_MESSAGES, formatPrice, validateShippingAddress } from '../utils/shopLogic';
import { EGYPT_GOVERNORATES, formatShippingDays } from '../utils/egyptGovernorates';

interface CheckoutPageProps {
  onOrderSuccess: (order: Order) => void;
  onNavigateToShop: () => void;
}

interface CheckoutAttempt {
  key: string;
  quoteToken: string;
}

const ATTEMPT_STORAGE_KEY = 'luma_checkout_attempt';

const EMAIL_ERROR = 'Please enter a valid email address';

// Arabic copy for the API error codes a customer can hit while placing an order (the API text is English).
const AR_ORDER_ERRORS: Record<string, string> = {
  QuoteChanged: 'تغيّرت الأسعار أو الكميات. راجعي الإجمالي الجديد ثم أكدي الطلب مرة أخرى.',
  QuoteExpired: 'انتهت صلاحية عرض السعر. تم تحديثه، يرجى المراجعة والتأكيد مرة أخرى.',
  CouponNotApplicable: 'كود الخصم غير صالح أو لم يعد متاحاً.',
  InsufficientStock: 'إحدى القطع لم تعد متوفرة بالكمية المطلوبة.',
  CheckoutInProgress: 'جاري إتمام طلبك، يرجى الانتظار لحظات.',
  RateLimited: 'محاولات كثيرة جداً. يرجى الانتظار لحظة ثم المحاولة مرة أخرى.',
  ValidationFailed: 'يرجى مراجعة بيانات العنوان والتواصل.',
  InvalidQuantity: 'كمية غير صالحة في الحقيبة.',
  EmptyCart: 'حقيبة التسوق فارغة.',
};

function createAttempt(quoteToken = ''): CheckoutAttempt {
  const key =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

  return { key, quoteToken };
}

function readAttempt(): CheckoutAttempt | null {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'key' in parsed &&
      typeof parsed.key === 'string' &&
      'quoteToken' in parsed &&
      typeof parsed.quoteToken === 'string'
    ) {
      return { key: parsed.key, quoteToken: parsed.quoteToken };
    }

    return null;
  } catch {
    return null;
  }
}

function saveAttempt(attempt: CheckoutAttempt): void {
  sessionStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
}

export const CheckoutPage: React.FC<CheckoutPageProps> = ({
  onOrderSuccess,
  onNavigateToShop,
}) => {
  const { items, totals, quote, isQuoting, quoteUnavailable, appliedCouponCode, clearCart, refreshQuote } = useCart();
  const { t, l, language } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useToast();

  // Stable English texts (the API returns the same ones per field) are shown in Arabic when the UI is Arabic.
  const localizeError = (field: string, message: string): string =>
    language === 'ar' && (ADDRESS_ERROR_MESSAGES[field] === message || (field === 'email' && message === EMAIL_ERROR))
      ? t(`checkout.error.${field}`)
      : message;

  const orderErrorMessage = (apiError: ApiError | null): string => {
    if (language === 'ar') {
      return (apiError && AR_ORDER_ERRORS[apiError.code]) || t('checkout.errorGeneric');
    }
    return apiError ? apiError.detail : 'Network error occurred. Your order was not confirmed.';
  };

  const lineTotalOf = (item: (typeof items)[number]): number => {
    const line = quote?.quote.lines.find((entry) => entry.variantId === item.variantId);
    return line && line.quantity === item.quantity ? line.lineTotal : item.unitPrice * item.quantity;
  };

  const fieldClass = (field: string, extra = ''): string =>
    `w-full bg-[#FAF7F5] border rounded-xl p-2.5 text-xs focus:outline-none focus:ring-1 ${extra} ${
      errors[field] ? 'border-rose-500 focus:ring-rose-500' : 'border-[#E8D6D1] focus:ring-[#8B263E]'
    }`;

  // Shipping Address Form State
  const [formData, setFormData] = useState<ShippingAddress>(() => {
    const defaultAddr = user?.addresses.find((a) => a.isDefault) || user?.addresses[0];
    return {
      fullName: user?.fullName || defaultAddr?.fullName || '',
      mobileNumber: user?.mobileNumber || defaultAddr?.mobileNumber || '',
      governorate: defaultAddr?.governorate || 'Cairo',
      city: defaultAddr?.city || '',
      streetAddress: defaultAddr?.streetAddress || '',
      buildingApt: defaultAddr?.buildingApt || '',
      deliveryNotes: defaultAddr?.deliveryNotes || '',
    };
  });

  const [guestEmail, setGuestEmail] = useState(user?.email || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attempt, setAttempt] = useState<CheckoutAttempt>(() => readAttempt() ?? createAttempt());

  // Selected saved address if user has any
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState<string | null>(
    (user?.addresses.find((a) => a.isDefault) ?? user?.addresses[0])?.id || null
  );

  const handleSelectSavedAddress = (addrId: string) => {
    setSelectedSavedAddressId(addrId);
    const addr = user?.addresses.find((a) => a.id === addrId);
    if (addr) {
      setFormData({
        fullName: addr.fullName,
        mobileNumber: addr.mobileNumber,
        governorate: addr.governorate,
        city: addr.city,
        streetAddress: addr.streetAddress,
        buildingApt: addr.buildingApt || '',
        deliveryNotes: addr.deliveryNotes || '',
      });
      setErrors({});
    }
  };

  const handleChange = (field: keyof ShippingAddress, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Lost-response recovery: a persisted attempt key is resolved before a new order is created.
  useEffect(() => {
    const saved = readAttempt();
    if (!saved || !saved.quoteToken) {
      return;
    }

    let cancelled = false;
    checkoutApi
      .attempt(saved.key)
      .then((result) => {
        if (!cancelled) {
          sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
          clearCart();
          onOrderSuccess(result.order);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();

    if (items.length === 0) {
      showToast(language === 'ar' ? 'حقيبة التسوق فارغة' : 'Your cart is empty', 'error');
      onNavigateToShop();
      return;
    }

    if (isSubmitting) return; // Prevent duplicate clicks

    const validation = validateShippingAddress(formData);
    const emailProvided = !user && guestEmail.trim().length > 0;
    const emailInvalid = emailProvided && !/^\S+@\S+\.\S+$/.test(guestEmail.trim());
    if (!validation.isValid || emailInvalid) {
      setErrors(emailInvalid ? { ...validation.errors, email: EMAIL_ERROR } : validation.errors);
      showToast(
        language === 'ar'
          ? 'يرجى استكمال بيانات العنوان ورقم الهاتف الصحيح'
          : 'Please complete all required shipping fields',
        'error',
      );
      return;
    }

    if (!quote) {
      showToast(
        language === 'ar'
          ? 'جارٍ حساب الأسعار، حاول مرة أخرى بعد لحظة'
          : 'Prices are still being calculated. Try again in a moment.',
        'info',
      );
      return;
    }

    if (!user) {
      // The guest credential must exist before the order is sent, so a lost response can always be recovered.
      setIsSubmitting(true);
      try {
        await checkoutApi.ensureGuestSession();
      } catch {
        showToast(orderErrorMessage(null), 'error');
        setIsSubmitting(false);
        return;
      }
    }

    // The attempt key is persisted BEFORE sending so a lost response can be recovered.
    const current: CheckoutAttempt = { key: attempt.key, quoteToken: quote.quoteToken };
    saveAttempt(current);
    setAttempt(current);
    setIsSubmitting(true);

    try {
      const result = await checkoutApi.placeOrder(
        {
          items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
          shippingAddress: formData,
          discountCode: appliedCouponCode,
          customerEmail: user?.email || guestEmail || null,
          quoteToken: current.quoteToken,
        },
        current.key,
      );

      sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
      showToast(
        language === 'ar'
          ? `تم تأكيد طلبك بنجاح! رقم الطلب: ${result.order.orderNumber}`
          : `Order placed successfully! Ref: ${result.order.orderNumber}`,
        'success',
      );

      clearCart();
      onOrderSuccess(result.order);
      return;
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;

      if (apiError?.fields) {
        const fieldErrors: Record<string, string> = {};
        Object.entries(apiError.fields).forEach(([key, messages]) => {
          const field = key.replace(/^shippingAddress\./, '').replace(/^customerEmail$/, 'email');
          if (messages[0]) {
            fieldErrors[field] = messages[0];
          }
        });
        setErrors(fieldErrors);
      }

      const ambiguous = !apiError || apiError.status >= 500 || apiError.code === 'CheckoutInProgress';
      if (ambiguous) {
        const recovered = await checkoutApi.attempt(current.key).catch(() => null);
        if (recovered) {
          sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
          clearCart();
          onOrderSuccess(recovered.order);
          return;
        }
      }

      if (
        apiError &&
        (apiError.code === 'QuoteChanged' ||
          apiError.code === 'QuoteExpired' ||
          apiError.code === 'CouponNotApplicable')
      ) {
        // The displayed total must never be silently replaced: refresh it and require a new click.
        refreshQuote();
      }

      showToast(orderErrorMessage(apiError), 'error');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="font-serif text-2xl font-bold text-[#2D1E2F]">
          {t('cart.empty')}
        </h2>
        <p className="text-xs text-[#8B6E7E]">{t('cart.emptySub')}</p>
        <button
          onClick={onNavigateToShop}
          className="px-6 py-2.5 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition"
        >
          {t('cart.continueShopping')}
        </button>
      </div>
    );
  }

  const selectedGovernorateObj = EGYPT_GOVERNORATES.find(
    (g) => g.name.en.toLowerCase() === formData.governorate.toLowerCase() || g.id === formData.governorate.toLowerCase()
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-[#2D1E2F]">
          {t('checkout.title')}
        </h1>
        <p className="text-xs text-[#8B6E7E] mt-1 flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-emerald-600" />
          <span>{t('checkout.secureNote')}</span>
        </p>
      </div>

      <form onSubmit={handlePlaceOrder} noValidate className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column: Contact & Address Form */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Saved Addresses (if logged in and has addresses) */}
          {user && user.addresses.length > 0 && (
            <div className="bg-white p-5 rounded-2xl border border-[#E8D6D1] space-y-3">
              <h3 className="font-bold text-sm text-[#2D1E2F] flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#8B263E]" />
                <span>{t('checkout.savedAddresses')}</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {user.addresses.map((addr) => (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => handleSelectSavedAddress(addr.id)}
                    aria-pressed={selectedSavedAddressId === addr.id}
                    className={`p-3 rounded-xl border text-left rtl:text-right transition ${
                      selectedSavedAddressId === addr.id
                        ? 'border-[#8B263E] bg-[#FAF3F1]'
                        : 'border-[#E8D6D1] hover:border-[#D48374] bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-[#2D1E2F]">{addr.label || t('account.defaultLabel')}</span>
                      {selectedSavedAddressId === addr.id && (
                        <CheckCircle2 className="w-4 h-4 text-[#8B263E]" />
                      )}
                    </div>
                    <p className="text-[11px] text-[#503E48] mt-1 truncate">{addr.streetAddress}</p>
                    <p className="text-[11px] text-[#8B6E7E]">{addr.city}, {addr.governorate}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 1. Contact Information */}
          <div className="bg-white p-5 rounded-2xl border border-[#E8D6D1] space-y-4">
            <h3 className="font-bold text-sm text-[#2D1E2F] flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-[#8B263E]" />
              <span>{t('checkout.contactInfo')}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="checkout-fullName" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.fullName')} *
                </label>
                <input
                  id="checkout-fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  value={formData.fullName}
                  onChange={(e) => handleChange('fullName', e.target.value)}
                  placeholder={t('checkout.ph.fullName')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.fullName)}
                  aria-describedby={errors.fullName ? 'checkout-fullName-error' : undefined}
                  className={fieldClass('fullName')}
                />
                {errors.fullName && (
                  <p id="checkout-fullName-error" role="alert" className="text-[11px] text-rose-600 mt-1">
                    {localizeError('fullName', errors.fullName)}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="checkout-mobileNumber" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.mobileNumber')} *
                </label>
                <input
                  id="checkout-mobileNumber"
                  name="mobileNumber"
                  type="tel"
                  autoComplete="tel"
                  dir="ltr"
                  value={formData.mobileNumber}
                  onChange={(e) => handleChange('mobileNumber', e.target.value)}
                  placeholder={t('checkout.ph.mobileNumber')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.mobileNumber)}
                  aria-describedby={errors.mobileNumber ? 'checkout-mobileNumber-error' : undefined}
                  className={fieldClass('mobileNumber', 'font-mono rtl:text-right')}
                />
                {errors.mobileNumber && (
                  <p id="checkout-mobileNumber-error" role="alert" className="text-[11px] text-rose-600 mt-1">
                    {localizeError('mobileNumber', errors.mobileNumber)}
                  </p>
                )}
              </div>
            </div>

            {!user && (
              <div>
                <label htmlFor="checkout-email" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.email')}
                </label>
                <input
                  id="checkout-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  dir="ltr"
                  value={guestEmail}
                  onChange={(e) => {
                    setGuestEmail(e.target.value);
                    if (errors.email) {
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.email;
                        return next;
                      });
                    }
                  }}
                  placeholder="sarah@example.com"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'checkout-email-error' : undefined}
                  className={fieldClass('email', 'rtl:text-right')}
                />
                {errors.email && (
                  <p id="checkout-email-error" role="alert" className="text-[11px] text-rose-600 mt-1">
                    {localizeError('email', errors.email)}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 2. Delivery Address */}
          <div className="bg-white p-5 rounded-2xl border border-[#E8D6D1] space-y-4">
            <h3 className="font-bold text-sm text-[#2D1E2F] flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#8B263E]" />
              <span>{t('checkout.deliveryAddress')}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="checkout-governorate" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.governorate')} *
                </label>
                <select
                  id="checkout-governorate"
                  name="governorate"
                  value={formData.governorate}
                  onChange={(e) => handleChange('governorate', e.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(errors.governorate)}
                  aria-describedby={errors.governorate ? 'checkout-governorate-error' : undefined}
                  className={fieldClass('governorate')}
                >
                  {EGYPT_GOVERNORATES.map((gov) => (
                    <option key={gov.id} value={gov.name.en}>
                      {language === 'ar' ? gov.name.ar : gov.name.en} ({formatShippingDays(gov.shippingDays, language)})
                    </option>
                  ))}
                </select>
                {errors.governorate && (
                  <p id="checkout-governorate-error" role="alert" className="text-[11px] text-rose-600 mt-1">
                    {localizeError('governorate', errors.governorate)}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="checkout-city" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.city')} *
                </label>
                <input
                  id="checkout-city"
                  name="city"
                  type="text"
                  autoComplete="address-level2"
                  value={formData.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder={t('checkout.ph.city')}
                  aria-required="true"
                  aria-invalid={Boolean(errors.city)}
                  aria-describedby={errors.city ? 'checkout-city-error' : undefined}
                  className={fieldClass('city')}
                />
                {errors.city && (
                  <p id="checkout-city-error" role="alert" className="text-[11px] text-rose-600 mt-1">
                    {localizeError('city', errors.city)}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="checkout-streetAddress" className="block text-xs font-semibold text-[#503E48] mb-1">
                {t('checkout.streetAddress')} *
              </label>
              <input
                id="checkout-streetAddress"
                name="streetAddress"
                type="text"
                autoComplete="street-address"
                value={formData.streetAddress}
                onChange={(e) => handleChange('streetAddress', e.target.value)}
                placeholder={t('checkout.ph.streetAddress')}
                aria-required="true"
                aria-invalid={Boolean(errors.streetAddress)}
                aria-describedby={errors.streetAddress ? 'checkout-streetAddress-error' : undefined}
                className={fieldClass('streetAddress')}
              />
              {errors.streetAddress && (
                <p id="checkout-streetAddress-error" role="alert" className="text-[11px] text-rose-600 mt-1">
                  {localizeError('streetAddress', errors.streetAddress)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="checkout-buildingApt" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.buildingApt')}
                </label>
                <input
                  id="checkout-buildingApt"
                  name="buildingApt"
                  type="text"
                  value={formData.buildingApt}
                  onChange={(e) => handleChange('buildingApt', e.target.value)}
                  placeholder={t('checkout.ph.buildingApt')}
                  className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
                />
              </div>

              <div>
                <label htmlFor="checkout-deliveryNotes" className="block text-xs font-semibold text-[#503E48] mb-1">
                  {t('checkout.deliveryNotes')}
                </label>
                <input
                  id="checkout-deliveryNotes"
                  name="deliveryNotes"
                  type="text"
                  value={formData.deliveryNotes}
                  onChange={(e) => handleChange('deliveryNotes', e.target.value)}
                  placeholder={t('checkout.ph.deliveryNotes')}
                  className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
                />
              </div>
            </div>
          </div>

          {/* 3. Payment Method */}
          <div className="bg-white p-5 rounded-2xl border border-[#E8D6D1] space-y-3">
            <h3 className="font-bold text-sm text-[#2D1E2F] flex items-center gap-2">
              <Banknote className="w-4 h-4 text-[#8B263E]" />
              <span>{t('checkout.paymentMethod')}</span>
            </h3>

            {/* Cash on Delivery is the only payment method */}
            <div className="p-4 rounded-xl border-2 border-[#8B263E] bg-[#FAF3F1] flex items-start gap-3">
              <div className="mt-0.5 w-4 h-4 rounded-full border-2 border-[#8B263E] flex items-center justify-center shrink-0">
                <span className="w-2 h-2 rounded-full bg-[#8B263E]" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs text-[#2D1E2F]">
                    {t('checkout.codTitle')}
                  </span>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {t('checkout.recommended')}
                  </span>
                </div>
                <p className="text-xs text-[#503E48] leading-relaxed">
                  {t('checkout.codDesc')}
                </p>
              </div>
            </div>

            {/* Card payments: informational only, not selectable */}
            <div className="p-3 rounded-xl border border-dashed border-[#D4C3BF] bg-stone-50/60 flex items-center justify-between text-xs text-stone-500">
              <div className="flex items-center gap-2.5">
                <CreditCard className="w-4 h-4 text-stone-400" />
                <span>{t('checkout.cardLabel')}</span>
              </div>
              <span className="text-[10px] bg-stone-200 px-2 py-0.5 rounded font-medium">
                {t('checkout.comingSoon')}
              </span>
            </div>
            <p className="text-[11px] text-[#8B6E7E] px-1">
              {t('checkout.cardNotice')}
            </p>
          </div>

        </div>

        {/* Right Column: Order Summary & Confirmation Button */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white p-5 rounded-2xl border border-[#E8D6D1] space-y-4 sticky top-24 shadow-sm">
            <h3 className="font-bold text-sm text-[#2D1E2F] pb-3 border-b border-[#F0E3DF]">
              {t('checkout.orderSummary')} ({items.reduce((s, i) => s + i.quantity, 0)})
            </h3>

            {/* Line items review */}
            <div className="max-h-60 overflow-y-auto divide-y divide-[#F3E7E4] pr-1">
              {items.map((it) => (
                <div key={it.id} className="py-2.5 first:pt-0 flex items-center gap-3">
                  <img
                    src={mediaUrl(it.image)}
                    alt={l(it.productName)}
                    className="w-12 h-12 object-cover rounded-lg border border-[#E8D6D1] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#2D1E2F] truncate">{l(it.productName)}</p>
                    <div className="flex items-center gap-2 text-[11px] text-[#8B6E7E]">
                      {it.shadeName && <span>{l(it.shadeName)}</span>}
                      {it.size && <span>• {it.size}</span>}
                      <span>• {t('checkout.qty')}: {it.quantity}</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-[#2D1E2F] shrink-0">
                    {formatPrice(lineTotalOf(it), language)}
                  </span>
                </div>
              ))}
            </div>

            {/* Calculation Totals (server quote) */}
            <div className="space-y-2 pt-3 border-t border-[#F0E3DF] text-xs text-[#503E48]">
              <div data-testid="checkout-subtotal" className="flex justify-between">
                <span>{t('cart.subtotal')}</span>
                <span className="font-semibold">{formatPrice(totals.subtotal, language)}</span>
              </div>

              {totals.discountAmount > 0 && (
                <div data-testid="checkout-discount" className="flex justify-between text-emerald-700">
                  <span>
                    {t('cart.discount')} {appliedCouponCode && `(${appliedCouponCode})`}
                  </span>
                  <span className="font-semibold">-{formatPrice(totals.discountAmount, language)}</span>
                </div>
              )}

              <div data-testid="checkout-delivery" className="flex justify-between">
                <span>{t('cart.deliveryFee')}</span>
                <span className="font-semibold">
                  {totals.deliveryFee === 0 ? (
                    <span className="text-emerald-700 font-bold">{t('shipping.free')}</span>
                  ) : (
                    formatPrice(totals.deliveryFee, language)
                  )}
                </span>
              </div>

              <div data-testid="checkout-total" className="flex justify-between text-base font-bold text-[#2D1E2F] pt-3 border-t border-[#E8D6D1]">
                <span>{t('cart.total')}</span>
                <span className="text-lg text-[#8B263E] font-serif font-bold">
                  {formatPrice(totals.total, language)}
                </span>
              </div>
            </div>

            {quote && quote.quote.issues.length > 0 && (
              <div data-testid="checkout-issues" className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                {quote.quote.issues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`}>
                    {language === 'ar'
                      ? issue.code === 'InsufficientStock'
                        ? t('cart.stockIssue')
                        : t('quote.issueGeneric')
                      : issue.message}
                  </p>
                ))}
              </div>
            )}

            {quoteUnavailable && (
              <div
                role="alert"
                data-testid="quote-unavailable"
                className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-center justify-between gap-2"
              >
                <span>{t('cart.quoteUnavailable')}</span>
                <button type="button" onClick={refreshQuote} className="font-bold underline shrink-0">
                  {t('error.retry')}
                </button>
              </div>
            )}

            {/* Dispatch ETA Note */}
            <div className="p-3 bg-[#FAF7F5] rounded-xl border border-[#E8D6D1] text-[11px] text-[#503E48] flex items-center gap-2">
              <Truck className="w-4 h-4 text-[#C47D76] shrink-0" />
              <span>
                {t('checkout.estimatedDeliveryTo')}{' '}
                <strong>
                  {selectedGovernorateObj && language === 'ar' ? selectedGovernorateObj.name.ar : formData.governorate}
                </strong>
                : {selectedGovernorateObj ? formatShippingDays(selectedGovernorateObj.shippingDays, language) : t('checkout.defaultEta')}
              </span>
            </div>

            {/* Submit Button */}
            <button
              data-testid="place-order-btn"
              type="submit"
              disabled={isSubmitting || isQuoting || !quote || quote.quote.issues.some((issue) => issue.code === 'InsufficientStock')}
              className="w-full py-3.5 bg-gradient-to-r from-[#3B2332] to-[#552A42] hover:from-[#2B1724] hover:to-[#452135] disabled:opacity-60 text-white rounded-xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2"
            >
              <ShieldCheck className="w-4 h-4 text-[#F3D8D3]" />
              <span>
                {isSubmitting ? t('checkout.placingOrder') : `${t('checkout.placeOrder')} • ${formatPrice(totals.total, language)}`}
              </span>
            </button>

            <p className="text-[10px] text-center text-[#8B6E7E]">
              {t('checkout.confirmNote')}
            </p>
          </div>
        </div>

      </form>
    </div>
  );
};
