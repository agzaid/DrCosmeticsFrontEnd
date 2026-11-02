import React, { useState } from 'react';
import { X, Trash2, Plus, Minus, Tag, ArrowRight, ArrowLeft, ShoppingBag, Sparkles, AlertCircle } from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useLanguage } from '../../context/LanguageContext';
import { MAX_LINE_QUANTITY, formatPrice } from '../../utils/shopLogic';
import { useDialogBehavior } from '../common/useDialogBehavior';
import { mediaUrl } from '../../api/config';

interface CartDrawerProps {
  onNavigateToCheckout: () => void;
  onNavigateToShop: () => void;
}

const CartDrawerPanel: React.FC<CartDrawerProps> = ({ onNavigateToCheckout, onNavigateToShop }) => {
  const {
    items,
    totals,
    quote,
    quoteUnavailable,
    appliedCouponCode,
    setIsDrawerOpen,
    updateQuantity,
    removeFromCart,
    applyCoupon,
    removeCoupon,
    refreshQuote,
  } = useCart();
  const { t, l, language } = useLanguage();
  const dialogRef = useDialogBehavior(() => setIsDrawerOpen(false));

  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState('');

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;

    setCouponLoading(true);
    setCouponError('');
    const res = await applyCoupon(couponCode);
    setCouponLoading(false);

    if (res.success) {
      setCouponCode('');
    } else {
      setCouponError(res.message);
    }
  };

  const freeDeliveryProgress = Math.min(
    100,
    Math.round((totals.subtotal / totals.freeDeliveryThreshold) * 100)
  );

  const stockIssues = quote?.quote.issues.filter((issue) => issue.code !== 'CouponNotApplicable') ?? [];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={() => setIsDrawerOpen(false)}
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-300"
      />

      <div className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 max-w-full flex pl-10 rtl:pl-0 rtl:pr-10">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('cart.title')}
          data-testid="cart-drawer"
          tabIndex={-1}
          className="w-screen max-w-md bg-[#FAF7F5] border-l rtl:border-l-0 rtl:border-r border-[#E8D6D1] shadow-2xl flex flex-col animate-in slide-in-from-right rtl:slide-in-from-left duration-300 focus:outline-none"
        >
          
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-[#E8D6D1] flex items-center justify-between bg-[#FAF7F5]">
            <div className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-[#8B263E]" />
              <h3 className="font-serif text-xl font-bold text-[#2D1E2F]">
                {t('cart.title')}
              </h3>
              <span data-testid="cart-count" className="text-xs bg-[#F3D8D3] text-[#3B2332] font-bold px-2 py-0.5 rounded-full">
                {items.reduce((s, i) => s + i.quantity, 0)}
              </span>
            </div>
            <button
              onClick={() => setIsDrawerOpen(false)}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-full hover:bg-[#F3E7E4] transition"
              aria-label={t('cart.close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Free Shipping Progress Indicator */}
          <div className="px-4 py-3 bg-[#F4E9E6] border-b border-[#E8D6D1]">
            <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
              <span data-testid="free-shipping-message" className="flex items-center gap-1.5 text-[#3B2332]">
                <Sparkles className="w-3.5 h-3.5 text-[#C47D76]" />
                {totals.amountNeededForFreeDelivery === 0
                  ? t('cart.unlockedFreeShipping')
                  : t('cart.freeShippingProgress').replace('{amount}', totals.amountNeededForFreeDelivery.toString())}
              </span>
              <span className="text-[11px] text-[#8B6E7E]">{freeDeliveryProgress}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={freeDeliveryProgress}
              aria-label={t('cart.freeShippingBar')}
              className="w-full bg-[#E8D6D1] h-1.5 rounded-full overflow-hidden"
            >
              <div
                className="bg-gradient-to-r from-[#C47D76] to-[#8B263E] h-full rounded-full transition-all duration-500"
                style={{ width: `${freeDeliveryProgress}%` }}
              />
            </div>
          </div>

          {/* Item List / Empty State */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 divide-y divide-[#F3E7E4]">
            {items.length === 0 ? (
              <div data-testid="cart-empty" className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
                <div className="w-16 h-16 rounded-full bg-[#F3E7E4] flex items-center justify-center text-[#8B6E7E]">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="font-serif text-lg font-bold text-[#2D1E2F]">
                    {t('cart.empty')}
                  </h4>
                  <p className="text-xs text-[#8B6E7E] mt-1 max-w-xs leading-relaxed">
                    {t('cart.emptySub')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsDrawerOpen(false);
                    onNavigateToShop();
                  }}
                  className="px-6 py-2.5 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition shadow-xs"
                >
                  {t('cart.continueShopping')}
                </button>
              </div>
            ) : (
              items.map((item) => {
                const quoteLine = quote?.quote.lines.find((line) => line.variantId === item.variantId);
                const lineTotal =
                  quoteLine && quoteLine.quantity === item.quantity
                    ? quoteLine.lineTotal
                    : item.unitPrice * item.quantity;
                const limit = Math.min(item.stock, MAX_LINE_QUANTITY);

                return (
                <div key={item.id} data-testid={`cart-line-${item.variantId}`} className="py-4 first:pt-0 flex gap-3.5">
                  {/* Thumbnail */}
                  <img
                    src={mediaUrl(item.image)}
                    alt={l(item.productName)}
                    className="w-20 h-20 object-cover rounded-xl border border-[#E8D6D1] shrink-0 bg-white"
                  />

                  {/* Details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <p className="text-[11px] font-semibold text-[#8B6E7E] uppercase tracking-wider">
                            {item.brand}
                          </p>
                          <h4 className="text-sm font-bold text-[#2D1E2F] leading-snug line-clamp-1">
                            {l(item.productName)}
                          </h4>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.id)}
                          className="text-stone-400 hover:text-rose-600 p-1 transition"
                          aria-label={t('cart.removeItem').replace('{name}', l(item.productName))}
                          data-testid={`cart-remove-${item.variantId}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Variant Badges */}
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-[#503E48]">
                        {item.shadeName && (
                          <div className="flex items-center gap-1.5 bg-[#FAF7F5] border border-[#E8D6D1] px-2 py-0.5 rounded-full">
                            {item.shadeHex && (
                              <span
                                className="w-2.5 h-2.5 rounded-full border border-black/15 shrink-0"
                                style={{ backgroundColor: item.shadeHex }}
                              />
                            )}
                            <span className="text-[11px] font-medium">{l(item.shadeName)}</span>
                          </div>
                        )}
                        {item.size && (
                          <span className="bg-[#FAF7F5] border border-[#E8D6D1] px-2 py-0.5 rounded-full text-[11px] font-medium">
                            {item.size}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Price and Quantity Stepper */}
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center border border-[#E8D6D1] rounded-lg bg-white overflow-hidden">
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="p-1 hover:bg-[#F3E7E4] text-[#3B2332] transition"
                          aria-label={t('cart.decrease')}
                          data-testid={`cart-decrease-${item.variantId}`}
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span
                          data-testid={`cart-qty-${item.variantId}`}
                          className="px-2.5 text-xs font-bold text-[#2D1E2F] min-w-[24px] text-center"
                        >
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          disabled={item.quantity >= limit}
                          className="p-1 hover:bg-[#F3E7E4] text-[#3B2332] disabled:opacity-30 disabled:cursor-not-allowed transition"
                          aria-label={t('cart.increase')}
                          data-testid={`cart-increase-${item.variantId}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="text-right rtl:text-left">
                        <p className="text-xs text-[#8B6E7E]">
                          {item.quantity > 1 && `${item.quantity} × `}
                          <span className="font-bold text-sm text-[#2D1E2F]">
                            {formatPrice(lineTotal, language)}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>

          {/* Drawer Footer with Coupon & Checkout */}
          {items.length > 0 && (
            <div className="p-4 sm:p-5 border-t border-[#E8D6D1] bg-[#FAF7F5] space-y-3.5">

              {quoteUnavailable && (
                <div
                  role="alert"
                  data-testid="quote-unavailable"
                  className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {t('cart.quoteUnavailable')}
                  </span>
                  <button type="button" onClick={refreshQuote} className="font-bold underline shrink-0">
                    {t('error.retry')}
                  </button>
                </div>
              )}

              {stockIssues.length > 0 && (
                <div data-testid="cart-issues" className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                  {stockIssues.map((issue, index) => (
                    <p key={`${issue.code}-${index}`}>{language === 'ar' ? t('cart.stockIssue') : issue.message}</p>
                  ))}
                </div>
              )}
              
              {/* Discount Code Input */}
              {appliedCouponCode ? (
                <div data-testid="coupon-applied" className="flex items-center justify-between p-2.5 rounded-xl bg-[#EAF5EC] border border-[#C6E2CA] text-xs">
                  <div className="flex items-center gap-2 text-emerald-800">
                    <Tag className="w-3.5 h-3.5" />
                    <span className="font-bold">{appliedCouponCode}</span>
                    <span className="text-emerald-700">
                      (-{formatPrice(totals.discountAmount, language)})
                    </span>
                  </div>
                  <button
                    onClick={removeCoupon}
                    className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
                  >
                    {t('cart.remove')}
                  </button>
                </div>
              ) : (
                <div>
                  <form onSubmit={handleApplyCoupon} className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        data-testid="coupon-input"
                        value={couponCode}
                        onChange={(e) => {
                          setCouponCode(e.target.value.toUpperCase());
                          setCouponError('');
                        }}
                        placeholder={t('cart.couponPlaceholder')}
                        aria-label={t('cart.couponPlaceholder')}
                        className="w-full bg-white border border-[#E8D6D1] rounded-xl px-3 py-2 text-xs uppercase font-medium placeholder:normal-case placeholder-[#9C7F8C] focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
                      />
                    </div>
                    <button
                      type="submit"
                      data-testid="coupon-apply"
                      disabled={couponLoading || !couponCode.trim()}
                      className="px-3.5 py-2 bg-[#3B2332] text-white rounded-xl text-xs font-bold hover:bg-[#523347] disabled:opacity-50 transition"
                    >
                      {couponLoading ? '...' : t('cart.applyCoupon')}
                    </button>
                  </form>
                  {couponError && (
                    <p role="alert" data-testid="coupon-error" className="text-[11px] text-rose-600 mt-1">{couponError}</p>
                  )}
                </div>
              )}

              {/* Price Breakdown */}
              <div className="space-y-1.5 text-xs text-[#503E48] pt-1">
                <div data-testid="totals-subtotal" className="flex justify-between">
                  <span>{t('cart.subtotal')}</span>
                  <span className="font-semibold">{formatPrice(totals.subtotal, language)}</span>
                </div>

                {totals.discountAmount > 0 && (
                  <div data-testid="totals-discount" className="flex justify-between text-emerald-700">
                    <span>{t('cart.discount')}</span>
                    <span className="font-semibold">-{formatPrice(totals.discountAmount, language)}</span>
                  </div>
                )}

                <div data-testid="totals-delivery" className="flex justify-between">
                  <span>{t('cart.deliveryFee')}</span>
                  <span className="font-semibold">
                    {totals.deliveryFee === 0 ? (
                      <span className="text-emerald-700 font-bold">{t('shipping.free')}</span>
                    ) : (
                      formatPrice(totals.deliveryFee, language)
                    )}
                  </span>
                </div>

                <div data-testid="totals-total" className="flex justify-between text-sm font-bold text-[#2D1E2F] pt-2 border-t border-[#E8D6D1]">
                  <span>{t('cart.total')}</span>
                  <span className="text-base text-[#8B263E] font-serif font-bold">
                    {formatPrice(totals.total, language)}
                  </span>
                </div>
              </div>

              {/* Checkout Action Button */}
              <button
                data-testid="drawer-checkout-btn"
                onClick={() => {
                  setIsDrawerOpen(false);
                  onNavigateToCheckout();
                }}
                className="w-full py-3 bg-gradient-to-r from-[#3B2332] to-[#552A42] hover:from-[#2B1724] hover:to-[#452135] text-white rounded-xl font-bold text-sm shadow-md transition flex items-center justify-center gap-2 group"
              >
                <span>{t('cart.checkout')}</span>
                {language === 'ar' ? (
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition" />
                ) : (
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                )}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export const CartDrawer: React.FC<CartDrawerProps> = (props) => {
  const { isDrawerOpen } = useCart();
  return isDrawerOpen ? <CartDrawerPanel {...props} /> : null;
};
