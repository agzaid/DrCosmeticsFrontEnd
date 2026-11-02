import React, { useEffect, useState } from 'react';
import { 
  CheckCircle2, 
  Package, 
  Truck, 
  MapPin, 
  Phone, 
  Calendar, 
  Sparkles, 
  ShoppingBag,
  ArrowRight,
  ArrowLeft,
  Clock
} from 'lucide-react';
import type { Order, OrderStatus } from '../types';
import { checkoutApi } from '../api/api';
import { mediaUrl } from '../api/config';
import { useLanguage } from '../context/LanguageContext';
import { formatPrice } from '../utils/shopLogic';

interface OrderConfirmationPageProps {
  orderId: string | null;
  initialOrder: Order | null;
  onNavigateToShop: () => void;
  onNavigateToAccount: () => void;
}

export const OrderConfirmationPage: React.FC<OrderConfirmationPageProps> = ({
  orderId,
  initialOrder,
  onNavigateToShop,
  onNavigateToAccount,
}) => {
  const { t, l, language } = useLanguage();
  const [order, setOrder] = useState<Order | null>(initialOrder);
  const [error, setError] = useState<string | null>(null);

  // Reload recovery: the confirmation view re-fetches the order instead of trusting only in-memory state.
  useEffect(() => {
    if (initialOrder || !orderId) {
      return;
    }

    const controller = new AbortController();
    checkoutApi
      .order(orderId, controller.signal)
      .then((fetched) => {
        if (!controller.signal.aborted) {
          setOrder(fetched);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : 'This order is no longer accessible.');
        }
      });

    return () => controller.abort();
  }, [orderId, initialOrder]);

  if (!order) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <h2 className="font-serif text-2xl font-bold text-[#2D1E2F]">
          {error ? t('order.unavailableTitle') : t('order.loading')}
        </h2>
        {error && <p data-testid="order-unavailable" className="text-xs text-[#8B6E7E]">{t('order.unavailableBody')}</p>}
        <button
          onClick={onNavigateToShop}
          className="px-6 py-2.5 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition"
        >
          {t('cart.continueShopping')}
        </button>
      </div>
    );
  }

  const statuses: OrderStatus[] = ['Pending', 'Confirmed', 'Shipped', 'Delivered'];
  const currentStep = statuses.indexOf(order.status);

  return (
    <div data-testid="order-confirmation" className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      
      {/* 1. Celebration Header */}
      <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 sm:p-10 text-center shadow-sm space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <div>
          <span className="text-xs font-bold text-[#8B263E] uppercase tracking-widest">
            {t('orderSuccess.ref')}: <span data-testid="order-number" className="font-mono text-sm">{order.orderNumber}</span>
          </span>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-[#2D1E2F] mt-1">
            {t('orderSuccess.title')}
          </h1>
          <p className="text-xs sm:text-sm text-[#503E48] mt-2 max-w-lg mx-auto leading-relaxed">
            {t('orderSuccess.sub')}
          </p>
        </div>

        {/* Amount to pay courier banner */}
        <div className="inline-flex items-center gap-2 bg-[#FAF3F1] border border-[#E8D6D1] px-5 py-2.5 rounded-2xl text-xs sm:text-sm text-[#2D1E2F]">
          <span className="text-[#8B6E7E]">{t('orderSuccess.payCourier')}:</span>
          <span className="font-serif text-lg font-bold text-[#8B263E]">
            {formatPrice(order.total, language)} ({t('checkout.codTitle')})
          </span>
        </div>
      </div>

      {/* 2. Order Tracking Timeline */}
      <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-[#F0E3DF] pb-3">
          <h3 className="font-bold text-sm text-[#2D1E2F] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#8B263E]" />
            <span>{t('order.tracker')}</span>
          </h3>
          <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#F3D8D3] text-[#3B2332]">
            {t('order.statusLabel')}: {t(`order.status.${order.status}`)}
          </span>
        </div>

        {/* Step progress bar */}
        <div className="grid grid-cols-4 gap-2 text-center">
          {statuses.map((st, idx) => {
            const isCompleted = idx <= currentStep && order.status !== 'Cancelled';
            const isCurrent = idx === currentStep;

            return (
              <div key={st} className="flex flex-col items-center space-y-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition ${
                    isCompleted
                      ? 'bg-[#3B2332] text-white shadow-xs'
                      : 'bg-[#F3E7E4] text-[#8B6E7E]'
                  } ${isCurrent ? 'ring-4 ring-[#8B263E]/20' : ''}`}
                >
                  {idx + 1}
                </div>
                <span className={`text-[11px] font-semibold ${isCompleted ? 'text-[#2D1E2F]' : 'text-stone-400'}`}>
                  {t(`order.status.${st}`)}
                </span>
              </div>
            );
          })}
        </div>

        {order.statusHistory && order.statusHistory.length > 0 && (
          <div className="p-3 bg-[#FAF7F5] rounded-xl text-xs text-[#503E48] space-y-1">
            <p className="font-semibold text-[#8B6E7E]">{t('order.latestUpdate')}</p>
            <p className="font-medium text-[#2D1E2F]">
              {language === 'ar'
                ? `${t('order.statusNow')} ${t(`order.status.${order.status}`)}`
                : order.statusHistory[order.statusHistory.length - 1].note || `Status is now ${order.status}`}
            </p>
          </div>
        )}
      </div>

      {/* 3. Items and Delivery Details */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Items List */}
        <div className="md:col-span-7 bg-white rounded-3xl border border-[#E8D6D1] p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-[#2D1E2F] pb-3 border-b border-[#F0E3DF]">
            {t('order.items')} ({order.items.length})
          </h3>

          <div className="divide-y divide-[#F3E7E4]">
            {order.items.map((item) => (
              <div key={item.id} className="py-3 first:pt-0 flex items-center gap-3.5">
                <img
                  src={mediaUrl(item.image)}
                  alt={l(item.productName)}
                  className="w-14 h-14 object-cover rounded-xl border border-[#E8D6D1] shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-bold text-[#8B6E7E] uppercase">{item.brand}</p>
                  <p className="text-xs font-semibold text-[#2D1E2F] truncate">{l(item.productName)}</p>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-[#503E48]">
                    {item.shadeName && (
                      <span className="flex items-center gap-1">
                        {item.shadeHex && (
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-black/20"
                            style={{ backgroundColor: item.shadeHex }}
                          />
                        )}
                        <span>{l(item.shadeName)}</span>
                      </span>
                    )}
                    {item.size && <span>• {item.size}</span>}
                    <span>• {t('checkout.qty')}: {item.quantity}</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-[#2D1E2F]">
                  {formatPrice(item.unitPrice * item.quantity, language)}
                </span>
              </div>
            ))}
          </div>

          {/* Totals Summary */}
          <div className="pt-3 border-t border-[#F0E3DF] space-y-1.5 text-xs text-[#503E48]">
            <div className="flex justify-between">
              <span>{t('cart.subtotal')}</span>
              <span>{formatPrice(order.subtotal, language)}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>{t('cart.discount')} {order.discountCode && `(${order.discountCode})`}</span>
                <span>-{formatPrice(order.discountAmount, language)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t('cart.deliveryFee')}</span>
              <span>{order.deliveryFee === 0 ? t('shipping.free') : formatPrice(order.deliveryFee, language)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold text-[#2D1E2F] pt-2 border-t border-[#E8D6D1]">
              <span>{t('cart.total')}</span>
              <span className="text-[#8B263E] font-serif font-bold text-base">
                {formatPrice(order.total, language)}
              </span>
            </div>
          </div>
        </div>

        {/* Shipping Destination */}
        <div className="md:col-span-5 bg-white rounded-3xl border border-[#E8D6D1] p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-[#2D1E2F] pb-3 border-b border-[#F0E3DF] flex items-center gap-2">
            <Truck className="w-4 h-4 text-[#8B263E]" />
            <span>{t('order.destination')}</span>
          </h3>

          <div className="space-y-3 text-xs text-[#503E48]">
            <div>
              <p className="font-bold text-sm text-[#2D1E2F]">{order.shippingAddress.fullName}</p>
              <p className="font-mono text-stone-600 mt-0.5">{order.shippingAddress.mobileNumber}</p>
            </div>

            <div className="p-3 bg-[#FAF7F5] rounded-xl border border-[#E8D6D1] space-y-1">
              <p className="font-semibold text-[#2D1E2F]">
                {order.shippingAddress.streetAddress}
              </p>
              {order.shippingAddress.buildingApt && (
                <p className="text-[#503E48]">{order.shippingAddress.buildingApt}</p>
              )}
              <p className="text-[#8B6E7E]">
                {order.shippingAddress.city}, {order.shippingAddress.governorate}, {t('order.egypt')}
              </p>
              {order.shippingAddress.deliveryNotes && (
                <p className="text-[11px] text-amber-800 pt-1 border-t border-[#E8D6D1] mt-1">
                  {t('order.note')}: {order.shippingAddress.deliveryNotes}
                </p>
              )}
            </div>

            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-900 text-[11px]">
              <p className="font-bold">{t('order.codReady')}</p>
              <p className="mt-0.5">{t('order.prepareCash').replace('{amount}', formatPrice(order.total, language))}</p>
            </div>
          </div>
        </div>

      </div>

      {/* 4. Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
        <button
          onClick={onNavigateToShop}
          className="w-full sm:w-auto px-8 py-3 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition shadow-xs flex items-center justify-center gap-2"
        >
          <span>{t('orderSuccess.shopMore')}</span>
          {language === 'ar' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={onNavigateToAccount}
          className="w-full sm:w-auto px-8 py-3 bg-white border border-[#E8D6D1] text-[#3B2332] rounded-full text-xs font-bold hover:bg-[#F3E7E4] transition shadow-xs"
        >
          {t('orderSuccess.trackOrder')}
        </button>
      </div>

    </div>
  );
};
