import { CartItem, CartTotals, DiscountCode, ShippingAddress } from '../types';

export const DEFAULT_FREE_SHIPPING_THRESHOLD = 600; // EGP
export const DEFAULT_SHIPPING_FEE = 50; // EGP
export const MAX_LINE_QUANTITY = 99; // API contract: quantity is an integer in 1..99

/**
 * Calculates subtotal, discount, shipping fee, and grand total for a cart.
 */
export function calculateCartTotals(
  items: CartItem[],
  discount?: DiscountCode | null,
  freeShippingThreshold = DEFAULT_FREE_SHIPPING_THRESHOLD,
  standardShippingFee = DEFAULT_SHIPPING_FEE
): CartTotals {
  const subtotal = items.reduce((acc, item) => {
    const price = Math.max(0, item.unitPrice || 0);
    const qty = Math.max(0, item.quantity || 0);
    return acc + price * qty;
  }, 0);

  let discountAmount = 0;
  let appliedDiscountCode: string | undefined = undefined;

  if (discount && discount.active && subtotal >= (discount.minOrderAmount || 0)) {
    const isExpired = discount.expiryDate && new Date(discount.expiryDate).getTime() < Date.now();
    const isLimitExceeded = discount.usageLimit > 0 && discount.currentUsage >= discount.usageLimit;

    if (!isExpired && !isLimitExceeded) {
      if (discount.type === 'percentage') {
        const calculated = (subtotal * discount.value) / 100;
        discountAmount = discount.maxDiscount ? Math.min(calculated, discount.maxDiscount) : calculated;
      } else if (discount.type === 'fixed') {
        discountAmount = Math.min(discount.value, subtotal);
      }
      appliedDiscountCode = discount.code;
    }
  }

  // Round discount to 2 decimal places
  discountAmount = Math.round(discountAmount * 100) / 100;

  const deliveryFee = subtotal === 0 ? 0 : subtotal >= freeShippingThreshold ? 0 : standardShippingFee;
  const amountNeededForFreeDelivery = subtotal === 0 ? freeShippingThreshold : Math.max(0, freeShippingThreshold - subtotal);
  const total = Math.max(0, subtotal - discountAmount + deliveryFee);

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountAmount,
    appliedDiscountCode,
    deliveryFee,
    freeDeliveryThreshold: freeShippingThreshold,
    amountNeededForFreeDelivery: Math.round(amountNeededForFreeDelivery * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * Formats monetary amounts in EGP with locale support. Whole amounts print without decimals; amounts with
 * cents (server totals are decimal, e.g. 432.5) keep up to two decimals so the displayed lines add up.
 */
export function formatPrice(amount: number, locale: 'en' | 'ar' = 'en'): string {
  const options = { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  if (locale === 'ar') {
    return `${amount.toLocaleString('ar-EG', options)} ج.م`;
  }
  return `${amount.toLocaleString('en-US', options)} EGP`;
}

/**
 * Validates Egyptian phone numbers (11 digits, starts with 010, 011, 012, or 015).
 */
export function isValidEgyptianMobile(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  return /^01[0125][0-9]{8}$/.test(cleaned);
}

/**
 * The exact legacy English messages (also returned by the API for the same field keys). The storefront keeps
 * them as the stable text and maps each one to its Arabic counterpart through `checkout.error.<field>`.
 */
export const ADDRESS_ERROR_MESSAGES: Record<string, string> = {
  fullName: 'Full name must be at least 3 characters',
  mobileNumber: 'Please enter a valid 11-digit Egyptian mobile number (e.g., 01012345678)',
  governorate: 'Please select a governorate',
  city: 'Please enter your city/district',
  streetAddress: 'Please enter a detailed street address',
};

/**
 * Validates shipping address payload for checkout.
 */
export function validateShippingAddress(address: Partial<ShippingAddress>): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!address.fullName || address.fullName.trim().length < 3) {
    errors.fullName = ADDRESS_ERROR_MESSAGES.fullName;
  }

  if (!address.mobileNumber || !isValidEgyptianMobile(address.mobileNumber)) {
    errors.mobileNumber = ADDRESS_ERROR_MESSAGES.mobileNumber;
  }

  if (!address.governorate || address.governorate.trim().length < 2) {
    errors.governorate = ADDRESS_ERROR_MESSAGES.governorate;
  }

  if (!address.city || address.city.trim().length < 2) {
    errors.city = ADDRESS_ERROR_MESSAGES.city;
  }

  if (!address.streetAddress || address.streetAddress.trim().length < 5) {
    errors.streetAddress = ADDRESS_ERROR_MESSAGES.streetAddress;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Checks variant stock availability.
 */
export function checkStockStatus(stock: number, requestedQty: number = 1): {
  available: boolean;
  isLowStock: boolean;
  maxPurchasable: number;
} {
  const safeStock = Math.max(0, stock || 0);
  return {
    available: safeStock >= requestedQty,
    isLowStock: safeStock > 0 && safeStock <= 5,
    maxPurchasable: safeStock,
  };
}

/**
 * The "from" price shown on cards and search results: the cheapest active variant, which is what the API sorts
 * and filters by. The product-level price is only a fallback and can lag behind variant edits.
 */
export function startingPrice(product: { price: number; variants: { price: number; isActive?: boolean }[] }): number {
  const prices = product.variants.filter((variant) => variant.isActive !== false).map((variant) => variant.price);
  return prices.length > 0 ? Math.min(...prices) : product.price;
}
