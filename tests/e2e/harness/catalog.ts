/**
 * Deterministic catalog fixture (ACCEPTANCE.md section 5): tops the published catalog up to 61 products through the
 * ADMIN API. Fixture products carry a unique English token `Zorvex<NNN>` (searchable, one match each) and the
 * Arabic marker word "تجريبي". Prices start at 700 so that priceAsc puts them after every seeded product.
 */
import type { ApiClient } from './api.ts';

export const CATALOG_TARGET = 61;
export const FIXTURE_TOKEN_PREFIX = 'Zorvex';
export const FIXTURE_AR_WORD = 'تجريبي';

export function fixtureToken(index: number): string {
  return `${FIXTURE_TOKEN_PREFIX}${String(index).padStart(3, '0')}`;
}

export async function ensureCatalogFixture(admin: ApiClient, target = CATALOG_TARGET): Promise<number> {
  const current = await admin.products({ pageSize: 1 });
  const missing = target - current.total;
  if (missing <= 0) {
    return 0;
  }

  const categoriesResult = await admin.get<{ categories: { id: string }[] }>('/api/v1/categories');
  const brandsResult = await admin.get<{ brands: { id: string; name: string }[] }>('/api/v1/brands');
  const categories = categoriesResult.data.categories;
  const brands = brandsResult.data.brands;

  const existing = await admin.adminProducts(`status=all&search=${FIXTURE_TOKEN_PREFIX}&pageSize=60`);
  let next = existing.total + 1;

  for (let created = 0; created < missing; created += 1, next += 1) {
    const token = fixtureToken(next);
    const category = categories[next % categories.length].id;
    const brand = brands[next % brands.length].name;
    await admin.createProduct({
      name: { en: `Fixture Item ${token}`, ar: `منتج ${FIXTURE_AR_WORD} ${next}` },
      brand,
      category,
      subCategory: 'Fixture',
      description: { en: `Deterministic catalog fixture ${token}.`, ar: `منتج ${FIXTURE_AR_WORD} للفهرس رقم ${next}.` },
      ingredients: { en: 'Water.', ar: 'ماء.' },
      howToUse: { en: 'Use as directed.', ar: 'استخدمي حسب الإرشادات.' },
      price: 700 + next * 10,
      originalPrice: null,
      rating: 4.5,
      reviewsCount: 0,
      images: [],
      skinType: ['all'],
      finish: null,
      coverage: null,
      shadeFamily: null,
      isFeatured: false,
      isNewArrival: false,
      isBestSeller: false,
      status: 'published',
      variants: [
        {
          sku: `E2E-FIX-${String(next).padStart(3, '0')}`,
          shadeName: null,
          shadeHex: null,
          size: '10ml',
          price: 700 + next * 10,
          stock: 30,
          isActive: true,
        },
      ],
    });
  }
  return missing;
}
