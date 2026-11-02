import React, { useEffect, useState } from 'react';
import { 
  Search, 
  SlidersHorizontal, 
  X, 
  RotateCcw, 
  Sparkles, 
  ChevronDown,
  Check
} from 'lucide-react';
import type { Product, ProductCategory, BrandItem, SkinType, MakeupFinish, Coverage } from '../types';
import { catalogApi } from '../api/api';
import type { PagedProducts } from '../api/types';
import { useLanguage } from '../context/LanguageContext';
import { formatPrice } from '../utils/shopLogic';
import { ProductCard } from '../components/products/ProductCard';
import { ErrorState } from '../components/common/ErrorState';

interface ShopPageProps {
  brands: BrandItem[];
  initialCategory?: ProductCategory | 'all';
  initialSearch?: string;
  initialSort?: string;
  onSelectProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
}

export const ShopPage: React.FC<ShopPageProps> = ({
  brands,
  initialCategory = 'all',
  initialSearch = '',
  initialSort = 'featured',
  onSelectProduct,
  onQuickAdd,
}) => {
  const { t, l, language } = useLanguage();

  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState<ProductCategory | 'all'>(initialCategory);
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [maxPrice, setMaxPrice] = useState<number>(2000);
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);

  // Beauty-specific filters
  const [skinTypeFilter, setSkinTypeFilter] = useState<SkinType | 'all'>('all');
  const [finishFilter, setFinishFilter] = useState<MakeupFinish | 'all'>('all');
  const [coverageFilter, setCoverageFilter] = useState<Coverage | 'all'>('all');
  const [shadeFamilyFilter, setShadeFamilyFilter] = useState<string>('all');

  const [sortBy, setSortBy] = useState<string>(initialSort);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Category definitions
  const categoriesList: { id: ProductCategory | 'all'; label: string }[] = [
    { id: 'all', label: t('cat.all') },
    { id: 'makeup', label: t('cat.makeup') },
    { id: 'skincare', label: t('cat.skincare') },
    { id: 'haircare', label: t('cat.haircare') },
    { id: 'fragrance', label: t('cat.fragrance') },
    { id: 'tools', label: t('cat.tools') },
  ];

  // Reset all filters
  const resetFilters = () => {
    setSearch('');
    setCategory('all');
    setSelectedBrand('all');
    setMaxPrice(2000);
    setInStockOnly(false);
    setSkinTypeFilter('all');
    setFinishFilter('all');
    setCoverageFilter('all');
    setShadeFamilyFilter('all');
  };

  const hasActiveFilters = 
    search !== '' ||
    category !== 'all' ||
    selectedBrand !== 'all' ||
    maxPrice < 2000 ||
    inStockOnly ||
    skinTypeFilter !== 'all' ||
    finishFilter !== 'all' ||
    coverageFilter !== 'all' ||
    shadeFamilyFilter !== 'all';

  // Filter and sort products
  const [paged, setPaged] = useState<PagedProducts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!isMobileFiltersOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileFiltersOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isMobileFiltersOpen]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter change returns the customer to the first page.
  useEffect(() => {
    setPage(1);
  }, [
    category,
    selectedBrand,
    maxPrice,
    inStockOnly,
    skinTypeFilter,
    finishFilter,
    coverageFilter,
    shadeFamilyFilter,
    debouncedSearch,
    sortBy,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(false);

    catalogApi
      .products(
        {
          category,
          brand: selectedBrand,
          search: debouncedSearch.trim() || undefined,
          skinType: skinTypeFilter,
          finish: finishFilter,
          coverage: coverageFilter,
          shadeFamily: shadeFamilyFilter,
          inStock: inStockOnly || undefined,
          maxPrice: maxPrice < 2000 ? maxPrice : undefined,
          sort: sortBy,
          page,
          pageSize: 24,
        },
        controller.signal,
      )
      .then((result) => {
        if (!controller.signal.aborted) {
          setPaged(result);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('Failed to load catalog page:', error);
          // A failed read never leaves the previous page on screen as if it were current.
          setPaged(null);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    category,
    selectedBrand,
    maxPrice,
    inStockOnly,
    skinTypeFilter,
    finishFilter,
    coverageFilter,
    shadeFamilyFilter,
    debouncedSearch,
    sortBy,
    page,
    reloadNonce,
  ]);

  const visibleProducts = paged?.products ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      {/* 1. Header & Category Pill Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-bold text-[#2D1E2F]">
              {category === 'all' ? t('cat.all') : categoriesList.find((c) => c.id === category)?.label}
            </h1>
            <p data-testid="results-count" className="text-xs text-[#8B6E7E] mt-1">
              {loadError ? '' : t('filter.resultsCount').replace('{count}', String(paged?.total ?? 0))}
            </p>
          </div>

          {/* Search & Sort Row */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('nav.searchPlaceholder')}
                aria-label={t('nav.search')}
                data-testid="shop-search"
                className="w-full bg-white border border-[#E8D6D1] rounded-full py-2 px-9 text-xs focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
              />
              <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5 rtl:left-auto rtl:right-3" />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  aria-label={t('nav.clearSearch')}
                  className="absolute right-3 top-2.5 rtl:right-auto rtl:left-3 text-stone-400 hover:text-stone-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label={t('sort.by')}
              data-testid="shop-sort"
              className="bg-white border border-[#E8D6D1] rounded-xl py-2 px-3 text-xs font-semibold text-[#2D1E2F] focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
            >
              <option value="featured">{t('sort.featured')}</option>
              <option value="priceAsc">{t('sort.priceAsc')}</option>
              <option value="priceDesc">{t('sort.priceDesc')}</option>
              <option value="newest">{t('sort.newest')}</option>
              <option value="bestSellers">{t('sort.bestSellers')}</option>
            </select>

            {/* Mobile Filter Toggle */}
            <button
              onClick={() => setIsMobileFiltersOpen(true)}
              aria-label={t('filter.title')}
              className="lg:hidden p-2 rounded-xl bg-white border border-[#E8D6D1] text-[#3B2332] flex items-center gap-1.5 text-xs font-semibold"
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">{t('filter.title')}</span>
            </button>
          </div>
        </div>

        {/* Category Pill Buttons */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {categoriesList.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              aria-pressed={category === cat.id}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                category === cat.id
                  ? 'bg-[#3B2332] text-white shadow-xs'
                  : 'bg-white text-[#503E48] border border-[#E8D6D1] hover:bg-[#F3E7E4]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Main Content Grid (Sidebar Filters + Products Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        
        {/* Desktop Sidebar Filters */}
        <aside className="hidden lg:block bg-white p-5 rounded-2xl border border-[#E8D6D1] space-y-5 sticky top-24">
          <div className="flex items-center justify-between pb-3 border-b border-[#F0E3DF]">
            <h3 className="font-bold text-sm text-[#2D1E2F] flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#8B263E]" />
              <span>{t('filter.title')}</span>
            </h3>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                data-testid="filters-reset"
                className="text-xs text-[#8B263E] hover:underline flex items-center gap-1 font-semibold"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t('filter.clearAll')}</span>
              </button>
            )}
          </div>

          {/* Brand Filter */}
          <div className="space-y-2">
            <label htmlFor="filter-brand" className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">
              {t('filter.brand')}
            </label>
            <select
              id="filter-brand"
              data-testid="filter-brand"
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
            >
              <option value="all">{t('filter.allBrands')}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Price Range Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-[#2D1E2F]">
              <span className="text-[#8B6E7E] uppercase tracking-wider">{t('filter.priceRange')}</span>
              <span className="text-[#8B263E]">{formatPrice(maxPrice, language)}</span>
            </div>
            <input
              type="range"
              min="100"
              max="2000"
              step="50"
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              aria-label={t('filter.priceRange')}
              data-testid="filter-price"
              className="w-full accent-[#8B263E] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#9C7F8C]">
              <span>{formatPrice(100, language)}</span>
              <span>{formatPrice(2000, language)}</span>
            </div>
          </div>

          {/* In Stock Only Checkbox */}
          <label className="flex items-center gap-2.5 text-xs font-semibold text-[#2D1E2F] cursor-pointer pt-2 border-t border-[#F0E3DF]">
            <input
              data-testid="filter-instock"
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => setInStockOnly(e.target.checked)}
              className="w-4 h-4 rounded text-[#8B263E] focus:ring-[#8B263E] accent-[#8B263E]"
            />
            <span>{t('filter.inStockOnly')}</span>
          </label>

          {/* Category-Specific Beauty Filters */}
          {/* 1. Skin Type (relevant for Skincare & Makeup) */}
          {(category === 'all' || category === 'skincare' || category === 'makeup') && (
            <div className="space-y-2 pt-3 border-t border-[#F0E3DF]">
              <label className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">
                {t('filter.skinType')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'dry', 'oily', 'combination', 'sensitive'] as (SkinType | 'all')[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setSkinTypeFilter(st)}
                    data-testid={`chip-skin-${st}`}
                    aria-pressed={skinTypeFilter === st}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                      skinTypeFilter === st
                        ? 'bg-[#8B263E] text-white'
                        : 'bg-[#FAF7F5] border border-[#E8D6D1] text-[#503E48] hover:bg-[#F3E7E4]'
                    }`}
                  >
                    {st === 'all' ? t('filter.all') : t(`skin.${st}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 2. Makeup Finish (relevant for Makeup) */}
          {(category === 'all' || category === 'makeup') && (
            <div className="space-y-2 pt-3 border-t border-[#F0E3DF]">
              <label className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">
                {t('filter.finish')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'matte', 'dewy', 'satin', 'radiant', 'natural'] as (MakeupFinish | 'all')[]).map((fin) => (
                  <button
                    key={fin}
                    onClick={() => setFinishFilter(fin)}
                    data-testid={`chip-finish-${fin}`}
                    aria-pressed={finishFilter === fin}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                      finishFilter === fin
                        ? 'bg-[#8B263E] text-white'
                        : 'bg-[#FAF7F5] border border-[#E8D6D1] text-[#503E48] hover:bg-[#F3E7E4]'
                    }`}
                  >
                    {fin === 'all' ? t('filter.all') : t(`finish.${fin}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 3. Coverage (relevant for Makeup) */}
          {(category === 'all' || category === 'makeup') && (
            <div className="space-y-2 pt-3 border-t border-[#F0E3DF]">
              <label className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">
                {t('filter.coverage')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'sheer', 'medium', 'full'] as (Coverage | 'all')[]).map((cov) => (
                  <button
                    key={cov}
                    onClick={() => setCoverageFilter(cov)}
                    data-testid={`chip-coverage-${cov}`}
                    aria-pressed={coverageFilter === cov}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                      coverageFilter === cov
                        ? 'bg-[#8B263E] text-white'
                        : 'bg-[#FAF7F5] border border-[#E8D6D1] text-[#503E48] hover:bg-[#F3E7E4]'
                    }`}
                  >
                    {cov === 'all' ? t('filter.all') : t(`coverage.${cov}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. Shade Family */}
          {(category === 'all' || category === 'makeup') && (
            <div className="space-y-2 pt-3 border-t border-[#F0E3DF]">
              <label className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">
                {t('filter.shadeFamily')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {['all', 'Nude', 'Pink', 'Berry', 'Coral', 'Red'].map((sh) => (
                  <button
                    key={sh}
                    onClick={() => setShadeFamilyFilter(sh)}
                    data-testid={`chip-shade-${sh}`}
                    aria-pressed={shadeFamilyFilter === sh}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                      shadeFamilyFilter === sh
                        ? 'bg-[#8B263E] text-white'
                        : 'bg-[#FAF7F5] border border-[#E8D6D1] text-[#503E48] hover:bg-[#F3E7E4]'
                    }`}
                  >
                    {sh === 'all' ? t('filter.all') : t(`shade.${sh}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

        </aside>

        {/* Products Grid */}
        <main className="lg:col-span-3">
          {loadError ? (
            <ErrorState onRetry={() => setReloadNonce((current) => current + 1)} />
          ) : isLoading ? (
            <div role="status" aria-label={t('state.loading')} data-testid="shop-loading" className="py-20 text-center">
              <div className="w-9 h-9 border-3 border-[#3B2332] border-t-[#E8998D] rounded-full animate-spin mx-auto" />
            </div>
          ) : visibleProducts.length > 0 ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                {visibleProducts.map((prod) => (
                  <ProductCard
                    key={prod.id}
                    product={prod}
                    onSelect={onSelectProduct}
                    onQuickAdd={onQuickAdd}
                  />
                ))}
              </div>

              {paged && paged.totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-8">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                    className="px-4 py-2 rounded-xl border border-[#E8D6D1] bg-white text-xs font-bold text-[#3B2332] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F3E7E4] transition"
                  >
                    {language === 'ar' ? 'السابق' : 'Previous'}
                  </button>

                  {Array.from({ length: paged.totalPages }, (_, index) => index + 1).map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setPage(pageNumber)}
                      aria-current={pageNumber === page ? 'page' : undefined}
                      data-testid={`page-${pageNumber}`}
                      className={`w-9 h-9 rounded-xl text-xs font-bold transition ${
                        pageNumber === page
                          ? 'bg-[#3B2332] text-white'
                          : 'bg-white border border-[#E8D6D1] text-[#503E48] hover:bg-[#F3E7E4]'
                      }`}
                    >
                      {pageNumber}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(paged.totalPages, current + 1))}
                    disabled={page >= paged.totalPages}
                    className="px-4 py-2 rounded-xl border border-[#E8D6D1] bg-white text-xs font-bold text-[#3B2332] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#F3E7E4] transition"
                  >
                    {language === 'ar' ? 'التالي' : 'Next'}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-3xl border border-[#E8D6D1] p-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-[#F3E7E4] text-[#8B6E7E] flex items-center justify-center mx-auto">
                <Search className="w-8 h-8" />
              </div>
              <h3 data-testid="shop-empty" className="font-serif text-xl font-bold text-[#2D1E2F]">
                {t('shop.emptyTitle')}
              </h3>
              <p className="text-xs text-[#8B6E7E] max-w-sm mx-auto">
                {t('shop.emptyBody')}
              </p>
              <button
                onClick={resetFilters}
                data-testid="empty-reset"
                className="px-6 py-2.5 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition shadow-xs"
              >
                {t('filter.clearAll')}
              </button>
            </div>
          )}
        </main>

      </div>

      {/* Mobile Filters Drawer Modal */}
      {isMobileFiltersOpen && (
        <div role="dialog" aria-modal="true" aria-label={t('filter.title')} className="fixed inset-0 z-50 overflow-hidden lg:hidden">
          <div
            onClick={() => setIsMobileFiltersOpen(false)}
            className="absolute inset-0 bg-stone-900/50 backdrop-blur-xs"
          />
          <div className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 max-w-full flex pl-10 rtl:pl-0 rtl:pr-10">
            <div className="w-screen max-w-xs bg-[#FAF7F5] p-5 shadow-2xl flex flex-col justify-between">
              <div className="space-y-4 overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-[#E8D6D1]">
                  <h3 className="font-bold text-sm text-[#2D1E2F]">{t('filter.title')}</h3>
                  <button onClick={() => setIsMobileFiltersOpen(false)} aria-label={t('cart.close')}>
                    <X className="w-5 h-5 text-stone-500" />
                  </button>
                </div>

                {/* Mobile Filters Controls */}
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="font-bold block mb-1">{t('filter.brand')}</label>
                    <select
                      value={selectedBrand}
                      onChange={(e) => setSelectedBrand(e.target.value)}
                      className="w-full p-2 bg-white border border-[#E8D6D1] rounded-xl"
                    >
                      <option value="all">{t('filter.allBrands')}</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.name}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between font-bold mb-1">
                      <span>{t('filter.priceRange')}</span>
                      <span>{formatPrice(maxPrice, language)}</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(Number(e.target.value))}
                      className="w-full accent-[#8B263E]"
                    />
                  </div>

                  <label className="flex items-center gap-2 font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => setInStockOnly(e.target.checked)}
                      className="accent-[#8B263E]"
                    />
                    <span>{t('filter.inStockOnly')}</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-[#E8D6D1] flex gap-2">
                <button
                  onClick={resetFilters}
                  className="flex-1 py-2.5 border border-[#E8D6D1] rounded-xl text-xs font-bold text-[#503E48]"
                >
                  {t('filter.reset')}
                </button>
                <button
                  onClick={() => setIsMobileFiltersOpen(false)}
                  className="flex-1 py-2.5 bg-[#3B2332] text-white rounded-xl text-xs font-bold"
                >
                  {t('filter.apply')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
