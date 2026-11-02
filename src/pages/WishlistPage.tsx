import React, { useEffect, useState } from 'react';
import { Heart, ShoppingBag, ArrowRight, ArrowLeft } from 'lucide-react';
import type { Product } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { useWishlist } from '../context/WishlistContext';
import { ProductCard } from '../components/products/ProductCard';
import { ErrorState } from '../components/common/ErrorState';
import { catalogApi } from '../api/api';

interface WishlistPageProps {
  onSelectProduct: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onNavigateToShop: () => void;
}

export const WishlistPage: React.FC<WishlistPageProps> = ({
  onSelectProduct,
  onQuickAdd,
  onNavigateToShop,
}) => {
  const { t, language } = useLanguage();
  const { wishlistIds } = useWishlist();

  const [favoritedProducts, setFavoritedProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (wishlistIds.length === 0) {
      setFavoritedProducts([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(false);

    catalogApi
      .productsByIds(wishlistIds, controller.signal)
      .then((products) => {
        if (!controller.signal.aborted) {
          setFavoritedProducts(products);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('Failed to load wishlist products:', error);
          setFavoritedProducts([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [wishlistIds.join(','), reloadNonce]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between border-b border-[#E8D6D1] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Heart className="w-6 h-6 text-[#8B263E] fill-[#8B263E]" />
            <h1 className="font-serif text-3xl font-bold text-[#2D1E2F]">{t('nav.wishlist')}</h1>
          </div>
          <p className="text-xs text-[#8B6E7E] mt-1">
            {t('wishlist.count').replace('{count}', String(favoritedProducts.length))}
          </p>
        </div>

        <button
          onClick={onNavigateToShop}
          className="text-xs font-bold text-[#8B263E] hover:underline flex items-center gap-1"
        >
          <span>{t('cart.continueShopping')}</span>
          {language === 'ar' ? <ArrowLeft className="w-3.5 h-3.5" /> : <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      </div>

      {loadError ? (
        <ErrorState onRetry={() => setReloadNonce((current) => current + 1)} />
      ) : isLoading ? (
        <div className="py-16 text-center">
          <div className="w-9 h-9 border-3 border-[#3B2332] border-t-[#E8998D] rounded-full animate-spin mx-auto" />
        </div>
      ) : favoritedProducts.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {favoritedProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onSelect={onSelectProduct}
              onQuickAdd={onQuickAdd}
            />
          ))}
        </div>
      ) : (
        <div data-testid="wishlist-empty" className="bg-white rounded-3xl border border-[#E8D6D1] p-12 text-center space-y-4 max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-[#F3E7E4] text-[#8B6E7E] flex items-center justify-center mx-auto">
            <Heart className="w-8 h-8" />
          </div>
          <h3 className="font-serif text-xl font-bold text-[#2D1E2F]">{t('wishlist.emptyTitle')}</h3>
          <p className="text-xs text-[#8B6E7E] leading-relaxed">
            {t('wishlist.emptyBody')}
          </p>
          <button
            onClick={onNavigateToShop}
            className="px-6 py-2.5 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition shadow-xs"
          >
            {t('cart.continueShopping')}
          </button>
        </div>
      )}
    </div>
  );
};
