import React from 'react';
import { Check, XCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import type { OrderStatus } from '../../types';

const STEPS: OrderStatus[] = ['Pending', 'Confirmed', 'Shipped', 'OutForDelivery', 'Delivered'];

interface OrderProgressProps {
  status: OrderStatus;
  testId?: string;
}

/**
 * The whole fulfilment path with the step the order stands on. Cancelled orders show the path greyed out and a
 * cancellation notice, so the customer still sees where the order stopped.
 */
export const OrderProgress: React.FC<OrderProgressProps> = ({ status, testId }) => {
  const { t } = useLanguage();
  const cancelled = status === 'Cancelled';
  const currentIndex = cancelled ? -1 : STEPS.indexOf(status);
  const progress = currentIndex <= 0 ? 0 : (currentIndex / (STEPS.length - 1)) * 80;

  return (
    <div data-testid={testId} data-order-progress={status} className="w-full space-y-2">
      <div className="relative pt-1">
        <div
          className="absolute left-[10%] right-[10%] top-4 h-0.5 bg-[#E8D6D1]"
          aria-hidden="true"
        />
        {!cancelled && currentIndex > 0 && (
          <div
            className="absolute left-[10%] top-4 h-0.5 bg-[#8B263E] transition-all"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        )}

        <div className="relative grid grid-cols-5 gap-1">
          {STEPS.map((step, index) => {
            const reached = !cancelled && index <= currentIndex;
            const current = !cancelled && index === currentIndex;
            return (
              <div key={step} className="flex flex-col items-center gap-1.5">
                <span
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition ${
                    reached
                      ? 'bg-[#8B263E] border-[#8B263E] text-white'
                      : 'bg-white border-[#E8D6D1] text-[#B49AA6]'
                  } ${current ? 'ring-4 ring-[#8B263E]/15' : ''}`}
                >
                  {index < currentIndex ? (
                    <Check className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`text-[9px] sm:text-[10px] leading-tight text-center ${
                    current
                      ? 'font-bold text-[#8B263E]'
                      : reached
                        ? 'font-semibold text-[#2D1E2F]'
                        : 'text-[#B49AA6]'
                  }`}
                >
                  {t(`order.status.${step}`)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {cancelled && (
        <div className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 border border-rose-200 px-3 py-1.5 text-[11px] font-bold text-rose-800">
          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
          {t('order.status.Cancelled')}
        </div>
      )}
    </div>
  );
};
