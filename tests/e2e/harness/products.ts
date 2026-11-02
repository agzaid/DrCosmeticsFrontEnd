/**
 * Creates isolated, uniquely named products through the ADMIN API so each spec controls its own stock and prices
 * instead of relying on (or mutating) the seeded catalog.
 */
import { randomBytes } from 'node:crypto';
import type { Product } from '../../../src/types';
import type { LocalizedString } from '../../../src/types';
import type { ApiClient } from './api.ts';

export interface SpecVariant {
  shadeName?: LocalizedString | null;
  shadeHex?: string | null;
  size?: string | null;
  price?: number;
  stock: number;
  isActive?: boolean;
}

export interface SpecProductOptions {
  price?: number;
  stock?: number;
  variants?: SpecVariant[];
  category?: string;
  nameAr?: string;
  isFeatured?: boolean;
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  finish?: string | null;
  shadeFamily?: string | null;
  skinType?: string[];
  namePrefix?: string;
}

export interface SpecProduct {
  product: Product;
  /** Unique, searchable token contained in the English name. */
  token: string;
}

let brandNames: string[] | undefined;

export async function createSpecProduct(admin: ApiClient, options: SpecProductOptions = {}): Promise<SpecProduct> {
  if (!brandNames) {
    const brands = await admin.get<{ brands: { name: string }[] }>('/api/v1/brands');
    brandNames = brands.data.brands.map((brand) => brand.name);
  }
  const token = `Qx${randomBytes(4).toString('hex')}`;
  const price = options.price ?? 250;
  const variants: SpecVariant[] = options.variants ?? [{ size: '30ml', price, stock: options.stock ?? 10 }];
  const sku = `E2E-${randomBytes(5).toString('hex').toUpperCase()}`;
  const product = await admin.createProduct({
    name: { en: `${options.namePrefix ?? 'Spec Item'} ${token}`, ar: options.nameAr ?? `منتج اختبار ${token}` },
    brand: brandNames[0],
    category: options.category ?? 'makeup',
    subCategory: 'Spec',
    description: { en: `Spec product ${token}.`, ar: `منتج اختبار ${token}.` },
    ingredients: { en: 'Water.', ar: 'ماء.' },
    howToUse: { en: 'Use as directed.', ar: 'استخدمي حسب الإرشادات.' },
    price: Math.min(...variants.map((variant) => variant.price ?? price)),
    originalPrice: null,
    rating: 4.2,
    reviewsCount: 3,
    images: [],
    skinType: options.skinType ?? ['all'],
    finish: options.finish ?? null,
    coverage: null,
    shadeFamily: options.shadeFamily ?? null,
    isFeatured: options.isFeatured ?? false,
    isNewArrival: options.isNewArrival ?? false,
    isBestSeller: options.isBestSeller ?? false,
    status: 'published',
    variants: variants.map((variant, index) => ({
      sku: `${sku}-${index + 1}`,
      shadeName: variant.shadeName ?? null,
      shadeHex: variant.shadeHex ?? null,
      size: variant.size ?? null,
      price: variant.price ?? price,
      stock: variant.stock,
      isActive: variant.isActive ?? true,
    })),
  });
  return { product, token };
}
