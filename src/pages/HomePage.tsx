import React, { useEffect, useState } from 'react';
import { Sparkles, ArrowRight, ArrowLeft, Tag } from 'lucide-react';
import type { Product, PromotionalBanner, ProductCategory, CategoryItem } from '../types';
import { catalogApi } from '../api/api';
import { mediaUrl } from '../api/config';
import { useLanguage } from '../context/LanguageContext';
import { ProductCard } from '../components/products/ProductCard';
import { ErrorState } from '../components/common/ErrorState';

interface HomePageProps {
  banners: PromotionalBanner[];
  categories: CategoryItem[];
  onNavigateToShop: (filter?: { category?: ProductCategory; sort?: string }) => void;
  onSelectProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  banners,
  categories,
  onNavigateToShop,
  onSelectProduct,
  onQuickAdd,
}) => {
  const { t, l, language } = useLanguage();

  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [bestSellers, setBestSellers] = useState<Product[]>([]);
  const [newArrivals, setNewArrivals] = useState<Product[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(false);

    Promise.all([
      catalogApi.products({ sort: 'featured', pageSize: 4 }, controller.signal),
      catalogApi.products({ sort: 'bestSellers', pageSize: 4 }, controller.signal),
      catalogApi.products({ sort: 'newest', pageSize: 4 }, controller.signal),
    ])
      .then(([featured, bestSelling, newest]) => {
        if (controller.signal.aborted) {
          return;
        }
        setFeaturedProducts(featured.products);
        setBestSellers(bestSelling.products);
        setNewArrivals(newest.products);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('Failed to load home collections:', error);
          setFeaturedProducts([]);
          setBestSellers([]);
          setNewArrivals([]);
          setLoadError(true);
        }
      });

    return () => controller.abort();
  }, [reloadNonce]);

  // The hero comes only from the banners the API returned; with none active there is simply no hero.
  const heroBanner = banners[0];

  return (
    <div className="space-y-12 sm:space-y-16 pb-12">
      
      {/* 1. Hero Promotional Banner */}
      {heroBanner && (
      <section data-testid="hero-banner" className="relative rounded-3xl overflow-hidden bg-[#2D1E2F] text-white shadow-xl mx-4 sm:mx-6 lg:mx-8 mt-4">
        <div className="relative min-h-[420px] sm:min-h-[500px] flex items-center">
          
          {/* Background Image with Gradient Overlay */}
          <div className="absolute inset-0 z-0">
            <img
              src={mediaUrl(heroBanner.imageUrl)}
              alt=""
              className="w-full h-full object-cover object-center opacity-40 mix-blend-luminosity scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-[#2D1E2F] via-[#2D1E2F]/80 to-transparent" />
          </div>

          {/* Banner Content */}
          <div className="relative z-10 max-w-2xl px-6 sm:px-12 py-10 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8998D]/20 border border-[#E8998D]/40 text-[#F3D8D3] text-xs font-bold tracking-wider uppercase">
              <Sparkles className="w-3.5 h-3.5 text-[#E8998D]" />
              <span>{l(heroBanner.badge)}</span>
            </div>

            <h1 className="font-serif text-3xl sm:text-5xl font-bold tracking-tight leading-tight text-[#FAF7F5]">
              {l(heroBanner.title)}
            </h1>

            <p className="text-sm sm:text-base text-[#E5D7D3] leading-relaxed max-w-lg">
              {l(heroBanner.subtitle)}
            </p>

            {heroBanner.discountCode && (
              <div className="inline-flex items-center gap-2 bg-[#3B2332]/90 border border-[#E8998D]/30 px-3.5 py-1.5 rounded-xl text-xs text-[#FAF7F5]">
                <Tag className="w-4 h-4 text-[#E8998D]" />
                <span>
                  {t('home.useCodePrefix')} <strong className="text-[#E8998D]">{heroBanner.discountCode}</strong> {t('home.useCodeSuffix')}
                </span>
              </div>
            )}

            <div className="pt-2 flex flex-wrap gap-3">
              <button
                onClick={() => onNavigateToShop({ category: heroBanner.ctaCategory ?? undefined })}
                className="px-6 py-3.5 bg-gradient-to-r from-[#E8998D] to-[#D48374] hover:from-[#df8b7e] hover:to-[#c87667] text-[#2D1E2F] font-bold rounded-full text-sm shadow-lg transition flex items-center gap-2 group"
              >
                <span>{l(heroBanner.ctaText)}</span>
                {language === 'ar' ? (
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition" />
                ) : (
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                )}
              </button>

              <button
                onClick={() => onNavigateToShop()}
                className="px-6 py-3.5 bg-white/10 hover:bg-white/20 backdrop-blur-xs text-white border border-white/20 font-bold rounded-full text-sm transition"
              >
                {t('cat.all')}
              </button>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* 2. Service Notice Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="p-3.5 rounded-2xl bg-[#F4E9E6] border border-[#E8D6D1] flex items-center justify-between gap-3 text-xs text-[#503E48]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="font-medium">{t('banner.serviceNotice')}</span>
          </div>
          <span className="hidden sm:inline-block text-[11px] font-bold text-[#8B263E] bg-white px-2.5 py-1 rounded-lg border border-[#E8D6D1] shrink-0">
            {t('home.currencyNote')}
          </span>
        </div>
      </div>

      {/* 3. Category Shortcuts */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">{t('home.curated')}</p>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#2D1E2F]">
              {t('home.shopByCategory')}
            </h2>
          </div>
          <button
            onClick={() => onNavigateToShop()}
            className="text-xs sm:text-sm font-bold text-[#8B263E] hover:underline flex items-center gap-1"
          >
            <span>{t('cat.all')}</span>
            {language === 'ar' ? '←' : '→'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 sm:gap-4">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onNavigateToShop({ category: cat.id })}
              className="group relative rounded-2xl overflow-hidden aspect-4/5 text-left rtl:text-right border border-[#E8D6D1] shadow-xs hover:shadow-md transition-all duration-300"
            >
              <img
                src={mediaUrl(cat.imageUrl)}
                alt={l(cat.name)}
                className="w-full h-full object-cover group-hover:scale-108 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#2D1E2F]/90 via-[#2D1E2F]/30 to-transparent flex flex-col justify-end p-3.5 sm:p-4 text-white">
                <span className="font-serif text-base sm:text-lg font-bold leading-snug">
                  {l(cat.name)}
                </span>
                <span className="text-[10px] text-[#F3D8D3] opacity-80 group-hover:opacity-100 transition">
                  {l(cat.description)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {loadError ? (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ErrorState onRetry={() => setReloadNonce((current) => current + 1)} />
        </section>
      ) : (
        <>
          {/* 4. Featured Picks Section */}
          <section data-testid="home-featured" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">{t('home.editorsChoice')}</p>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#2D1E2F]">
                  {t('home.featuredTitle')}
                </h2>
              </div>
              <button
                onClick={() => onNavigateToShop({ sort: 'featured' })}
                className="text-xs sm:text-sm font-bold text-[#8B263E] hover:underline"
              >
                {t('home.viewAll')} {language === 'ar' ? '←' : '→'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {featuredProducts.map((prod) => (
                <ProductCard
                  key={prod.id}
                  product={prod}
                  onSelect={onSelectProduct}
                  onQuickAdd={onQuickAdd}
                />
              ))}
            </div>
          </section>

          {/* 5. Best Sellers Section */}
          <section data-testid="home-bestsellers" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">{t('home.communityFavorites')}</p>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#2D1E2F]">
                  {t('home.bestSellersTitle')}
                </h2>
              </div>
              <button
                onClick={() => onNavigateToShop({ sort: 'bestSellers' })}
                className="text-xs sm:text-sm font-bold text-[#8B263E] hover:underline"
              >
                {t('home.exploreBestSellers')} {language === 'ar' ? '←' : '→'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {bestSellers.map((prod) => (
                <ProductCard
                  key={prod.id}
                  product={prod}
                  onSelect={onSelectProduct}
                  onQuickAdd={onQuickAdd}
                />
              ))}
            </div>
          </section>

          {/* 6. New Arrivals */}
          <section data-testid="home-newarrivals" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-xs font-bold text-[#8B6E7E] uppercase tracking-wider">{t('home.freshIn')}</p>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold text-[#2D1E2F]">
                  {t('home.newArrivalsTitle')}
                </h2>
              </div>
              <button
                onClick={() => onNavigateToShop({ sort: 'newest' })}
                className="text-xs sm:text-sm font-bold text-[#8B263E] hover:underline"
              >
                {t('home.browseNewest')} {language === 'ar' ? '←' : '→'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {newArrivals.map((prod) => (
                <ProductCard
                  key={prod.id}
                  product={prod}
                  onSelect={onSelectProduct}
                  onQuickAdd={onQuickAdd}
                />
              ))}
            </div>
          </section>
        </>
      )}

    </div>
  );
};
