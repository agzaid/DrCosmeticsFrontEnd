import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Browser } from 'puppeteer-core';
import type { PromotionalBanner } from '../../../src/types';
import { ApiClient, adminClient, e2eEnv } from '../harness/api.ts';
import { closeBrowser, launchBrowser, newPage, type E2ePage, type Lang } from '../harness/browser.ts';
import { TEXTS, egp, parseMoney } from '../harness/i18n.ts';
import { createSpecProduct, type SpecProduct } from '../harness/products.ts';
import {
  TIMEOUT,
  afterProductsResponse,
  click,
  closeModal,
  gotoHome,
  openProduct,
  openShop,
  searchShop,
  selectVariant,
  setRange,
  shopProductIds,
  text,
  waitForShopIdle,
} from '../harness/ui.ts';

const LANGS: Lang[] = ['en', 'ar'];
const PAGE_SIZE = 24;

describe('storefront catalog (A-01..A-07, C-1..C-5)', () => {
  let browser: Browser;
  let admin: ApiClient;
  let anon: ApiClient;
  let shades: SpecProduct;
  let sizes: SpecProduct;
  let soldOut: SpecProduct;

  before(async () => {
    browser = await launchBrowser();
    admin = await adminClient();
    anon = new ApiClient(e2eEnv().baseUrl);
    shades = await createSpecProduct(admin, {
      variants: [
        { shadeName: { en: 'Rose Dawn', ar: 'فجر وردي' }, shadeHex: '#C97B84', price: 260, stock: 12 },
        { shadeName: { en: 'Coral Dusk', ar: 'غسق مرجاني' }, shadeHex: '#E8998D', price: 260, stock: 3 },
        { shadeName: { en: 'Plum Night', ar: 'ليل برقوقي' }, shadeHex: '#5B2A47', price: 260, stock: 0 },
      ],
    });
    sizes = await createSpecProduct(admin, {
      category: 'skincare',
      variants: [
        { size: '30ml', price: 300, stock: 8 },
        { size: '50ml', price: 450, stock: 2 },
      ],
    });
    soldOut = await createSpecProduct(admin, { stock: 0 });
  });

  after(async () => {
    await closeBrowser();
  });

  async function withPage(lang: Lang, body: (e2e: E2ePage) => Promise<void>): Promise<void> {
    const e2e = await newPage(browser, { lang });
    try {
      await body(e2e);
      e2e.assertOnlyApiTraffic();
      e2e.assertClean();
    } finally {
      await e2e.close();
    }
  }

  async function sectionIds(e2e: E2ePage, testId: string): Promise<string[]> {
    return e2e.page.$$eval(`[data-testid="${testId}"] [data-testid^="product-card-"]`, (nodes) =>
      nodes.map((node) => node.getAttribute('data-testid')?.replace('product-card-', '') ?? ''),
    );
  }

  for (const lang of LANGS) {
    const T = TEXTS[lang];

    describe(`[${lang}] browsing`, () => {
      it('home renders the hero, categories and the three collection strips straight from the API (A-01, A-02)', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          const [featured, bestSellers, newest] = await Promise.all(
            ['featured', 'bestSellers', 'newest'].map((sort) => anon.products({ sort, pageSize: 4 })),
          );
          assert.deepEqual(await sectionIds(e2e, 'home-featured'), featured.products.map((p) => p.id));
          assert.deepEqual(await sectionIds(e2e, 'home-bestsellers'), bestSellers.products.map((p) => p.id));
          assert.deepEqual(await sectionIds(e2e, 'home-newarrivals'), newest.products.map((p) => p.id));

          const banners = (await anon.get<{ banners: PromotionalBanner[] }>('/api/v1/banners')).data.banners;
          if (banners.length > 0) {
            assert.equal(await text(e2e.page, '[data-testid="hero-banner"] h1'), banners[0].title[lang]);
          } else {
            assert.equal(await e2e.page.$('[data-testid="hero-banner"]'), null, 'hero rendered without any banner');
          }

          const categories = (await anon.get<{ categories: unknown[] }>('/api/v1/categories')).data.categories;
          const tiles = await e2e.page.$$eval('section button.aspect-4\\/5', (nodes) => nodes.length);
          assert.equal(tiles, categories.length);

          assert.deepEqual(
            await e2e.page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]),
            [lang, lang === 'ar' ? 'rtl' : 'ltr'],
          );
          await e2e.screenshot(`catalog-home-${lang}`);
        });
      });

      it('shop search finds products by English token and by the Arabic term, and shows the empty state (A-06, AR-2)', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);

          const arabicTerm = 'أحمر';
          const arabic = await anon.products({ search: arabicTerm, pageSize: PAGE_SIZE });
          await searchShop(e2e, arabicTerm);
          assert.deepEqual(await shopProductIds(e2e), arabic.products.map((p) => p.id));
          assert.equal(await text(e2e.page, '[data-testid="results-count"]'), T.resultsCount(arabic.total));
          for (const product of arabic.products) {
            const nameInCard = await text(e2e.page, `[data-testid="product-card-${product.id}"] h3`);
            assert.equal(nameInCard, product.name[lang] || product.name.en);
          }

          await searchShop(e2e, shades.token);
          assert.deepEqual(await shopProductIds(e2e), [shades.product.id]);
          assert.equal(await text(e2e.page, '[data-testid="results-count"]'), T.resultsCount(1));
          assert.equal(
            await text(e2e.page, `[data-testid="product-card-${shades.product.id}"] h3`),
            shades.product.name[lang],
          );

          await searchShop(e2e, 'zz-no-such-product-zz');
          assert.equal(await text(e2e.page, '[data-testid="shop-empty"]'), T.shopEmptyTitle);
          assert.deepEqual(await shopProductIds(e2e), []);
          await e2e.screenshot(`catalog-search-empty-${lang}`);
        });
      });

      it('category, brand, price and stock filters compose and match the API result (A-03)', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);

          const brands = (await anon.get<{ brands: { name: string }[] }>('/api/v1/brands')).data.brands;
          const brand = brands.find((entry) => entry.name === 'Luma Signature')?.name ?? brands[0].name;

          const expectIds = async (query: Record<string, string | number | boolean>): Promise<void> => {
            const expected = await anon.products({ ...query, pageSize: PAGE_SIZE });
            assert.deepEqual(await shopProductIds(e2e), expected.products.map((p) => p.id), JSON.stringify(query));
            assert.equal(await text(e2e.page, '[data-testid="results-count"]'), T.resultsCount(expected.total));
          };

          await afterProductsResponse(e2e, () => click(e2e.page, '[data-testid="nav-cat-makeup"]'));
          await expectIds({ category: 'makeup' });

          await afterProductsResponse(e2e, () => e2e.page.select('#filter-brand', brand).then(() => undefined));
          await expectIds({ category: 'makeup', brand });

          await afterProductsResponse(e2e, () => setRange(e2e, '[data-testid="filter-price"]', 400));
          await expectIds({ category: 'makeup', brand, maxPrice: 400 });
          for (const price of await e2e.page.$$eval('[data-testid^="product-card-"] .font-bold.text-sm', (nodes) =>
            nodes.map((node) => node.textContent ?? ''),
          )) {
            assert.ok(parseMoney(price) <= 400, `card priced ${price} above the 400 filter`);
          }

          await afterProductsResponse(e2e, () => click(e2e.page, '[data-testid="filter-instock"]'));
          await expectIds({ category: 'makeup', brand, maxPrice: 400, inStock: true });

          await afterProductsResponse(e2e, () => click(e2e.page, '[data-testid="chip-finish-matte"]'));
          await expectIds({ category: 'makeup', brand, maxPrice: 400, inStock: true, finish: 'matte' });

          await afterProductsResponse(e2e, () => click(e2e.page, '[data-testid="filters-reset"]'));
          await expectIds({});
          await e2e.screenshot(`catalog-filters-${lang}`);
        });
      });

      it('every sort option returns the API order (A-05)', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          for (const sort of ['priceAsc', 'priceDesc', 'newest', 'bestSellers', 'featured']) {
            await afterProductsResponse(e2e, () => e2e.page.select('[data-testid="shop-sort"]', sort).then(() => undefined));
            const expected = await anon.products({ sort, pageSize: PAGE_SIZE });
            assert.deepEqual(await shopProductIds(e2e), expected.products.map((p) => p.id), sort);
          }
          // priceAsc really is ascending on the rendered prices
          await afterProductsResponse(e2e, () => e2e.page.select('[data-testid="shop-sort"]', 'priceAsc').then(() => undefined));
          const prices = (
            await e2e.page.$$eval('[data-testid^="product-card-"] .font-bold.text-sm', (nodes) =>
              nodes.map((node) => node.textContent ?? ''),
            )
          ).map(parseMoney);
          assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
        });
      });

      it('pages through the whole catalog without repeating or skipping a product (A-04, C-1..C-5)', async (t) => {
        const first = await anon.products({ sort: 'priceAsc', page: 1, pageSize: PAGE_SIZE });
        if (first.total <= PAGE_SIZE) {
          t.skip(`catalog has only ${first.total} products (no second page); fixture not present on this instance`);
          return;
        }
        const totalPages = Math.ceil(first.total / PAGE_SIZE);
        assert.equal(first.totalPages, totalPages);
        assert.equal(first.products.length, PAGE_SIZE); // C-1
        const lastPage = await anon.products({ sort: 'priceAsc', page: totalPages, pageSize: PAGE_SIZE });
        assert.equal(lastPage.products.length, first.total - PAGE_SIZE * (totalPages - 1)); // C-2

        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await afterProductsResponse(e2e, () => e2e.page.select('[data-testid="shop-sort"]', 'priceAsc').then(() => undefined));

          const seen: string[] = [];
          for (let page = 1; page <= totalPages; page += 1) {
            if (page > 1) {
              await afterProductsResponse(e2e, () => click(e2e.page, `[data-testid="page-${page}"]`));
            }
            const expected = await anon.products({ sort: 'priceAsc', page, pageSize: PAGE_SIZE });
            const ids = await shopProductIds(e2e);
            assert.deepEqual(ids, expected.products.map((p) => p.id), `page ${page}`);
            assert.equal(
              await e2e.page.$eval(`[data-testid="page-${page}"]`, (node) => node.getAttribute('aria-current')),
              'page',
            );
            seen.push(...ids);
          }
          assert.equal(seen.length, first.total);
          assert.equal(new Set(seen).size, seen.length, 'a product repeated across pages'); // C-4

          // C-3: a unique term that matches only the product sorted onto the last page.
          const target = lastPage.products[lastPage.products.length - 1];
          const token = /Zorvex\d+|Qx[0-9a-f]+/.exec(target.name.en)?.[0] ?? target.name.en;
          const byToken = await anon.products({ search: token, pageSize: PAGE_SIZE });
          assert.equal(byToken.total, 1, `search term "${token}" is not unique`);
          await searchShop(e2e, token);
          assert.deepEqual(await shopProductIds(e2e), [target.id]);

          // C-5: changing a filter returns to page 1.
          await searchShop(e2e, '');
          await afterProductsResponse(e2e, () => click(e2e.page, '[data-testid="page-2"]'));
          assert.equal(await e2e.page.$eval('[data-testid="page-2"]', (n) => n.getAttribute('aria-current')), 'page');
          await afterProductsResponse(e2e, () => e2e.page.select('[data-testid="shop-sort"]', 'priceDesc').then(() => undefined));
          assert.equal(await e2e.page.$eval('[data-testid="page-1"]', (n) => n.getAttribute('aria-current')), 'page');
          await e2e.screenshot(`catalog-paging-${lang}`);
        });
      });
    });

    describe(`[${lang}] product modal`, () => {
      it('selects shades with the right price/stock state and reads GET /products/{id} (A-07)', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await openProduct(e2e, shades.product, shades.token);
          assert.ok(e2e.requests.some((r) => r.url.endsWith(`/api/v1/products/${shades.product.id}`)));

          const byShade = (name: string) => shades.product.variants.find((v) => v.shadeName?.en === name)!;
          const rose = byShade('Rose Dawn');
          const coral = byShade('Coral Dusk');
          const plum = byShade('Plum Night');
          const opening = (await anon.product(shades.product.id)).variants.find((v) => v.stock > 0)!;
          assert.equal(
            await text(e2e.page, '[data-testid="stock-status"]'),
            opening.stock <= 5 ? T.lowStock(opening.stock) : T.inStock,
          );

          await selectVariant(e2e, coral.id);
          assert.equal(await text(e2e.page, '[data-testid="stock-status"]'), T.lowStock(3));
          assert.equal(await text(e2e.page, '[data-testid="modal-price"]'), egp(260, lang));
          assert.equal(
            await e2e.page.$eval('[data-testid="modal-add-to-bag"]', (n) => (n as HTMLButtonElement).disabled),
            false,
          );
          assert.equal(await text(e2e.page, '[data-testid="modal-add-to-bag"]'), T.addToBag);

          await selectVariant(e2e, plum.id);
          assert.equal(await text(e2e.page, '[data-testid="stock-status"]'), T.outOfStock);
          assert.equal(
            await e2e.page.$eval('[data-testid="modal-add-to-bag"]', (n) => (n as HTMLButtonElement).disabled),
            true,
          );
          assert.equal(await text(e2e.page, '[data-testid="modal-add-to-bag"]'), T.outOfStock);

          await selectVariant(e2e, rose.id);
          assert.equal(await text(e2e.page, '[data-testid="stock-status"]'), T.inStock);
          assert.equal(
            await e2e.page.$eval('[data-testid="variant-option"][aria-pressed="true"]', (n) => n.getAttribute('data-variant-id')),
            rose.id,
          );

          // the stepper never offers more than the variant's stock
          await selectVariant(e2e, coral.id);
          for (let i = 0; i < 6; i += 1) {
            await e2e.page.$eval('[data-testid="qty-increase"]', (n) => (n as HTMLButtonElement).click());
          }
          assert.equal(await text(e2e.page, '[data-testid="qty-value"]'), '3');
          assert.equal(
            await e2e.page.$eval('[data-testid="qty-increase"]', (n) => (n as HTMLButtonElement).disabled),
            true,
          );
          await e2e.screenshot(`catalog-modal-shades-${lang}`);
          await closeModal(e2e);
        });
      });

      it('shows size options with their own price and low stock', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await openProduct(e2e, sizes.product, sizes.token);
          const small = sizes.product.variants.find((v) => v.size === '30ml')!;
          const large = sizes.product.variants.find((v) => v.size === '50ml')!;
          // the modal opens on the first in-stock variant in the order the API returns them
          const defaultVariant = (await anon.product(sizes.product.id)).variants.find((v) => v.stock > 0)!;
          assert.equal(await text(e2e.page, '[data-testid="modal-price"]'), egp(defaultVariant.price, lang));
          await selectVariant(e2e, large.id);
          assert.equal(await text(e2e.page, '[data-testid="modal-price"]'), egp(450, lang));
          assert.equal(await text(e2e.page, '[data-testid="stock-status"]'), T.lowStock(2));
          await selectVariant(e2e, small.id);
          assert.equal(await text(e2e.page, '[data-testid="stock-status"]'), T.inStock);
        });
      });

      it('marks a fully sold-out product on the card and blocks adding it', async () => {
        await withPage(lang, async (e2e) => {
          await gotoHome(e2e);
          await openShop(e2e);
          await searchShop(e2e, soldOut.token);
          const card = `[data-testid="product-card-${soldOut.product.id}"]`;
          assert.ok((await text(e2e.page, card)).includes(T.outOfStock), 'sold-out overlay missing on the card');
          assert.equal(
            await e2e.page.$eval(`${card} button[aria-label^="${T.addToBag}"]`, (n) => (n as HTMLButtonElement).disabled),
            true,
            'quick-add must be disabled when sold out',
          );
          await openProduct(e2e, soldOut.product, soldOut.token);
          assert.equal(await text(e2e.page, '[data-testid="stock-status"]'), T.outOfStock);
          assert.equal(
            await e2e.page.$eval('[data-testid="modal-add-to-bag"]', (n) => (n as HTMLButtonElement).disabled),
            true,
          );
          await waitForShopIdle(e2e);
          await e2e.screenshot(`catalog-soldout-${lang}`);
        });
      });
    });
  }
});
