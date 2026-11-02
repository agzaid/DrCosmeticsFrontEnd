import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { CartItem, CartTotals, Product, ProductVariant } from '../types';
import { MAX_LINE_QUANTITY, calculateCartTotals } from '../utils/shopLogic';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';
import { checkoutApi } from '../api/api';
import { ApiError } from '../api/httpClient';
import type { QuoteIssue, QuoteResponse } from '../api/types';

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  totals: CartTotals;
  quote: QuoteResponse | null;
  isQuoting: boolean;
  quoteUnavailable: boolean;
  appliedCouponCode: string | null;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  addToCart: (product: Product, variant: ProductVariant, quantity?: number) => boolean;
  updateQuantity: (itemId: string, quantity: number) => void;
  removeFromCart: (itemId: string) => void;
  clearCart: () => void;
  applyCoupon: (code: string) => Promise<{ success: boolean; message: string }>;
  removeCoupon: () => void;
  refreshQuote: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = 'luma_beauty_cart_items';
const COUPON_STORAGE_KEY = 'luma_beauty_cart_coupon';

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const { language, l } = useLanguage();

  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });

  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(() => {
    try {
      return localStorage.getItem(COUPON_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    if (appliedCouponCode) {
      localStorage.setItem(COUPON_STORAGE_KEY, appliedCouponCode);
    } else {
      localStorage.removeItem(COUPON_STORAGE_KEY);
    }
  }, [appliedCouponCode]);

  const couponMessage = (issue?: QuoteIssue): string =>
    language === 'ar' ? 'كود الخصم غير صالح أو لم يعد متاحاً' : issue?.message || 'This coupon cannot be applied';

  // A persisted coupon that the server no longer accepts is dropped loudly; cart lines adopt the server's
  // current price and stock so the stepper limits and line totals never rely on a stale browser snapshot.
  const reconcileWithQuote = (response: QuoteResponse): void => {
    if (appliedCouponCode && !response.quote.appliedDiscountCode) {
      const issue = response.quote.issues.find((entry) => entry.code === 'CouponNotApplicable');
      setAppliedCouponCode(null);
      showToast(couponMessage(issue), 'error');
    }

    setItems((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        const line = response.quote.lines.find((entry) => entry.variantId === item.variantId);
        if (!line || (line.unitPrice === item.unitPrice && line.availableStock === item.stock)) {
          return item;
        }
        changed = true;
        return { ...item, unitPrice: line.unitPrice, stock: line.availableStock };
      });
      return changed ? next : previous;
    });
  };

  // Server quote is authoritative for every displayed total; the local calculation is only an estimate shown
  // while the first quote is in flight. A failed quote clears the stale one so checkout cannot use it.
  useEffect(() => {
    if (items.length === 0) {
      setQuote(null);
      setIsQuoting(false);
      return;
    }
    setIsQuoting(true);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsQuoting(true);
      try {
        const response = await checkoutApi.quote(
          items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
          appliedCouponCode,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setQuote(response);
          reconcileWithQuote(response);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setQuote(null);
          console.warn('Quote refresh failed:', error instanceof ApiError ? error.detail : error);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsQuoting(false);
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [items, appliedCouponCode, refreshNonce]);

  const fallbackTotals = useMemo(() => calculateCartTotals(items, null), [items]);

  const totals: CartTotals = useMemo(() => {
    if (!quote) {
      return fallbackTotals;
    }

    return {
      subtotal: quote.quote.subtotal,
      discountAmount: quote.quote.discountAmount,
      appliedDiscountCode: quote.quote.appliedDiscountCode ?? undefined,
      deliveryFee: quote.quote.deliveryFee,
      freeDeliveryThreshold: quote.quote.freeDeliveryThreshold,
      amountNeededForFreeDelivery: quote.quote.amountNeededForFreeDelivery,
      total: quote.quote.total,
    };
  }, [quote, fallbackTotals]);

  const itemCount = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);

  const limitMessage = (limit: number): string =>
    language === 'ar' ? `الكمية القصوى المتاحة هي ${limit}` : `Maximum available quantity is ${limit}`;

  const addToCart = (product: Product, variant: ProductVariant, quantity = 1): boolean => {
    if (variant.stock <= 0) {
      showToast(
        language === 'ar' ? 'عذراً، هذه الدرجة نفذت من المخزن' : 'Sorry, this variant is out of stock',
        'error',
      );
      return false;
    }

    const itemId = `${product.id}_${variant.id}`;
    const limit = Math.min(variant.stock, MAX_LINE_QUANTITY);
    const existing = items.find((item) => item.id === itemId);
    const nextQuantity = (existing?.quantity ?? 0) + quantity;

    if (!Number.isInteger(quantity) || quantity < 1 || nextQuantity > limit) {
      showToast(limitMessage(limit), 'error');
      return false;
    }

    if (existing) {
      setItems((previous) =>
        previous.map((item) => (item.id === itemId ? { ...item, quantity: nextQuantity, stock: variant.stock } : item)),
      );
    } else {
      const newItem: CartItem = {
        id: itemId,
        productId: product.id,
        productName: product.name,
        brand: product.brand,
        variantId: variant.id,
        variantSku: variant.sku,
        shadeName: variant.shadeName,
        shadeHex: variant.shadeHex,
        size: variant.size,
        unitPrice: variant.price,
        quantity,
        image: variant.image || product.images[0] || '',
        stock: variant.stock,
      };
      setItems((previous) => [...previous, newItem]);
    }

    const description = variant.shadeName ? l(variant.shadeName) : variant.size || '';
    showToast(
      language === 'ar'
        ? `تمت إضافة ${l(product.name)} ${description ? `(${description})` : ''} إلى الحقيبة`
        : `Added ${l(product.name)} ${description ? `(${description})` : ''} to bag`,
      'success',
    );
    setIsDrawerOpen(true);
    return true;
  };

  // The UI disables the stepper at the limit; a request beyond it is refused with a message, never clamped.
  const updateQuantity = (itemId: string, newQuantity: number): void => {
    if (newQuantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    const target = items.find((item) => item.id === itemId);
    if (!target || !Number.isInteger(newQuantity)) {
      return;
    }

    const limit = Math.min(target.stock, MAX_LINE_QUANTITY);
    if (newQuantity > limit) {
      showToast(limitMessage(limit), 'error');
      return;
    }

    setItems((previous) => previous.map((item) => (item.id === itemId ? { ...item, quantity: newQuantity } : item)));
  };

  const removeFromCart = (itemId: string): void => {
    setItems((previous) => previous.filter((item) => item.id !== itemId));
    showToast(language === 'ar' ? 'تمت إزالة المنتج من الحقيبة' : 'Removed item from bag', 'info');
  };

  const clearCart = (): void => {
    setItems([]);
    setAppliedCouponCode(null);
    setQuote(null);
  };

  const applyCoupon = async (code: string): Promise<{ success: boolean; message: string }> => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      return {
        success: false,
        message: language === 'ar' ? 'يرجى إدخال كود الخصم' : 'Please enter a coupon code',
      };
    }

    try {
      const response = await checkoutApi.quote(
        items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        trimmed,
      );

      const issue = response.quote.issues.find((entry) => entry.code === 'CouponNotApplicable');
      if (issue || !response.quote.appliedDiscountCode) {
        return { success: false, message: couponMessage(issue) };
      }

      setAppliedCouponCode(response.quote.appliedDiscountCode);
      setQuote(response);

      const message =
        language === 'ar'
          ? `تم تطبيق الكوبون ${trimmed} بنجاح!`
          : `Promo code ${trimmed} applied successfully!`;
      showToast(message, 'success');
      return { success: true, message };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof ApiError && language !== 'ar'
            ? error.detail
            : language === 'ar'
              ? 'تعذر التحقق من كود الخصم الآن'
              : 'Failed to validate discount code',
      };
    }
  };

  const removeCoupon = (): void => {
    setAppliedCouponCode(null);
    showToast(language === 'ar' ? 'تمت إزالة كود الخصم' : 'Promo code removed', 'info');
  };

  return (
    <CartContext.Provider
      value={{
        items,
        itemCount,
        totals,
        quote,
        isQuoting,
        quoteUnavailable: items.length > 0 && !quote && !isQuoting,
        appliedCouponCode,
        isDrawerOpen,
        setIsDrawerOpen,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        applyCoupon,
        removeCoupon,
        refreshQuote: () => setRefreshNonce((current) => current + 1),
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
