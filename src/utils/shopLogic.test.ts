import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartTotals,
  formatPrice,
  isValidEgyptianMobile,
  validateShippingAddress,
  checkStockStatus,
  DEFAULT_FREE_SHIPPING_THRESHOLD,
  DEFAULT_SHIPPING_FEE,
} from './shopLogic';
import { CartItem, DiscountCode } from '../types';

test('calculateCartTotals calculates subtotal and standard delivery for order under threshold', () => {
  const items: CartItem[] = [
    {
      id: 'item-1',
      productId: 'prod-1',
      productName: { en: 'Lipstick', ar: 'أحمر شفاه' },
      brand: 'Luma',
      variantId: 'v-1',
      variantSku: 'LUM-LIP-01',
      unitPrice: 250,
      quantity: 1,
      image: '',
      stock: 10,
    },
  ];

  const totals = calculateCartTotals(items);
  assert.equal(totals.subtotal, 250);
  assert.equal(totals.deliveryFee, DEFAULT_SHIPPING_FEE);
  assert.equal(totals.discountAmount, 0);
  assert.equal(totals.total, 300);
  assert.equal(totals.amountNeededForFreeDelivery, DEFAULT_FREE_SHIPPING_THRESHOLD - 250);
});

test('calculateCartTotals gives free delivery when subtotal meets or exceeds threshold', () => {
  const items: CartItem[] = [
    {
      id: 'item-1',
      productId: 'prod-1',
      productName: { en: 'Serum', ar: 'سيروم' },
      brand: 'Luma',
      variantId: 'v-1',
      variantSku: 'LUM-SER-01',
      unitPrice: 350,
      quantity: 2,
      image: '',
      stock: 5,
    },
  ];

  const totals = calculateCartTotals(items);
  assert.equal(totals.subtotal, 700);
  assert.equal(totals.deliveryFee, 0);
  assert.equal(totals.amountNeededForFreeDelivery, 0);
  assert.equal(totals.total, 700);
});

test('calculateCartTotals applies percentage discount with cap correctly', () => {
  const items: CartItem[] = [
    {
      id: 'item-1',
      productId: 'prod-1',
      productName: { en: 'Foundation', ar: 'كريم أساس' },
      brand: 'Luma',
      variantId: 'v-1',
      variantSku: 'LUM-FND-01',
      unitPrice: 800,
      quantity: 1,
      image: '',
      stock: 10,
    },
  ];

  const coupon: DiscountCode = {
    code: 'BEAUTY20',
    type: 'percentage',
    value: 20, // 20% of 800 = 160
    minOrderAmount: 300,
    maxDiscount: 100, // Capped at 100
    expiryDate: '2030-01-01T00:00:00Z',
    usageLimit: 100,
    currentUsage: 5,
    active: true,
  };

  const totals = calculateCartTotals(items, coupon);
  assert.equal(totals.subtotal, 800);
  assert.equal(totals.discountAmount, 100);
  assert.equal(totals.appliedDiscountCode, 'BEAUTY20');
  assert.equal(totals.deliveryFee, 0);
  assert.equal(totals.total, 700);
});

test('calculateCartTotals ignores expired coupon or insufficient minOrderAmount', () => {
  const items: CartItem[] = [
    {
      id: 'item-1',
      productId: 'prod-1',
      productName: { en: 'Lip Gloss', ar: 'ملمع شفاه' },
      brand: 'Luma',
      variantId: 'v-1',
      variantSku: 'LUM-GLS-01',
      unitPrice: 200,
      quantity: 1,
      image: '',
      stock: 10,
    },
  ];

  const minOrderCoupon: DiscountCode = {
    code: 'BIGSPENDER',
    type: 'fixed',
    value: 50,
    minOrderAmount: 500, // higher than subtotal 200
    expiryDate: '2030-01-01T00:00:00Z',
    usageLimit: 100,
    currentUsage: 0,
    active: true,
  };

  const totals = calculateCartTotals(items, minOrderCoupon);
  assert.equal(totals.discountAmount, 0);
  assert.equal(totals.appliedDiscountCode, undefined);
  assert.equal(totals.total, 250);
});

test('formatPrice correctly handles English and Arabic localization', () => {
  assert.equal(formatPrice(450, 'en'), '450 EGP');
  assert.match(formatPrice(450, 'ar'), /ج\.م/);
  // Server totals are decimal: cents are shown rather than rounded away (432.50 must not read as 433).
  assert.equal(formatPrice(432.5, 'en'), '432.5 EGP');
  assert.equal(formatPrice(67.5, 'en'), '67.5 EGP');
});

test('isValidEgyptianMobile correctly accepts valid 11-digit numbers and rejects invalid ones', () => {
  assert.equal(isValidEgyptianMobile('01012345678'), true);
  assert.equal(isValidEgyptianMobile('01198765432'), true);
  assert.equal(isValidEgyptianMobile('01200000000'), true);
  assert.equal(isValidEgyptianMobile('01555555555'), true);
  assert.equal(isValidEgyptianMobile('010 1234 5678'), true);
  assert.equal(isValidEgyptianMobile('01912345678'), false); // invalid carrier prefix 019
  assert.equal(isValidEgyptianMobile('0101234567'), false); // 10 digits
  assert.equal(isValidEgyptianMobile('12345678901'), false);
});

test('validateShippingAddress catches missing required fields and validates good payload', () => {
  const invalid = validateShippingAddress({});
  assert.equal(invalid.isValid, false);
  assert.ok(invalid.errors.fullName);
  assert.ok(invalid.errors.mobileNumber);
  assert.ok(invalid.errors.governorate);

  const valid = validateShippingAddress({
    fullName: 'Sarah Ahmed',
    mobileNumber: '01012345678',
    governorate: 'Cairo',
    city: 'New Cairo',
    streetAddress: 'Street 90, Villa 12',
  });
  assert.equal(valid.isValid, true);
  assert.equal(Object.keys(valid.errors).length, 0);
});

test('checkStockStatus flags out-of-stock and low stock correctly', () => {
  assert.deepEqual(checkStockStatus(0, 1), {
    available: false,
    isLowStock: false,
    maxPurchasable: 0,
  });

  assert.deepEqual(checkStockStatus(3, 1), {
    available: true,
    isLowStock: true,
    maxPurchasable: 3,
  });

  assert.deepEqual(checkStockStatus(20, 2), {
    available: true,
    isLowStock: false,
    maxPurchasable: 20,
  });
});
