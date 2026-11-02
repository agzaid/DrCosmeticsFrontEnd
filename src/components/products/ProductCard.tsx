import React from 'react';
import { Heart, Plus, Sparkles, Star } from 'lucide-react';
import { Product } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { useWishlist } from '../../context/WishlistContext';
import { useCart } from '../../context/CartContext';
import { formatPrice, startingPrice } from '../../utils/shopLogic';
import { mediaUrl } from '../../api/config';

interface ProductCardProps {
  product: Product;
  onSelect: (product: Product) => void;
  onQuickAdd?: (product: Product) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onSelect,
  onQuickAdd,
}) => {
  const { language, l, t } = useLanguage();
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { addToCart } = useCart();

  const isFavorited = isInWishlist(product.id);

  // Check total stock across variants
  const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
  const isOutOfStock = totalStock <= 0;

  // Shade variants with hex colors
  const shadeVariants = product.variants.filter((v) => v.shadeHex);

  const handleQuickAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (product.variants.length === 1 && product.variants[0].stock > 0) {
      // Direct add to bag if only 1 variant exists
      addToCart(product, product.variants[0], 1);
    } else if (onQuickAdd) {
      onQuickAdd(product);
    } else {
      onSelect(product);
    }
  };

  return (
    <div
      data-testid={`product-card-${product.id}`}
      onClick={() => onSelect(product)}
      className="group relative bg-[#FAF7F5] border border-[#EBE0DC] hover:border-[#D48374] rounded-2xl p-3.5 transition-all duration-300 hover:shadow-lg flex flex-col justify-between cursor-pointer"
    >
      <div>
        {/* Top Badges & Wishlist Heart */}
        <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-[#F3E7E4] mb-3">
          <img
            src={mediaUrl(product.images[0])}
            alt={l(product.name)}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          {/* Badges */}
          <div className="absolute top-2.5 left-2.5 rtl:left-auto rtl:right-2.5 flex flex-col gap-1 items-start rtl:items-end">
            {product.isBestSeller && (
              <span className="bg-[#3B2332] text-[#F3D8D3] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-xs">
                {t('sort.bestSellers')}
              </span>
            )}
            {product.isNewArrival && (
              <span className="bg-[#E8998D] text-[#2D1E2F] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shadow-xs">
                {t('sort.newest')}
              </span>
            )}
            {product.originalPrice && (
              <span className="bg-rose-700 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-xs">
                {t('product.sale')}
              </span>
            )}
          </div>

          {/* Wishlist Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleWishlist(product.id, l(product.name));
            }}
            className={`absolute top-2.5 right-2.5 rtl:right-auto rtl:left-2.5 w-8 h-8 rounded-full flex items-center justify-center transition shadow-xs ${
              isFavorited
                ? 'bg-rose-50 text-rose-600'
                : 'bg-white/80 backdrop-blur-xs text-stone-600 hover:text-rose-600'
            }`}
            aria-label={t('product.wishlistNamed').replace('{name}', l(product.name))}
            aria-pressed={isFavorited}
          >
            <Heart className={`w-4 h-4 ${isFavorited ? 'fill-rose-600' : ''}`} />
          </button>

          {/* Out of Stock Overlay */}
          {isOutOfStock && (
            <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-[1px] flex items-center justify-center">
              <span className="bg-[#2D1E2F] text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                {t('product.outOfStock')}
              </span>
            </div>
          )}
        </div>

        {/* Product Brand & Name */}
        <p className="text-[11px] font-bold text-[#8B6E7E] uppercase tracking-wider">
          {product.brand}
        </p>

        <h3 className="font-semibold text-sm text-[#2D1E2F] mt-1 group-hover:text-[#8B263E] transition">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(product);
            }}
            className="block w-full text-left rtl:text-right truncate"
          >
            {l(product.name)}
          </button>
        </h3>

        {/* Rating & Reviews */}
        <div className="flex items-center gap-1.5 mt-1 text-xs">
          <div className="flex items-center text-amber-500">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span className="ml-1 rtl:ml-0 rtl:mr-1 font-bold text-[#2D1E2F]">
              {product.rating.toFixed(1)}
            </span>
          </div>
          <span className="text-[#8B6E7E] text-[11px]">({product.reviewsCount})</span>
        </div>

        {/* Shade Swatches Preview */}
        {shadeVariants.length > 0 && (
          <div className="flex items-center gap-1 mt-2.5">
            {shadeVariants.slice(0, 4).map((v) => (
              <span
                key={v.id}
                title={v.shadeName ? l(v.shadeName) : ''}
                className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-2xs"
                style={{ backgroundColor: v.shadeHex }}
              />
            ))}
            {shadeVariants.length > 4 && (
              <span className="text-[10px] text-[#8B6E7E] font-medium">
                +{shadeVariants.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Bottom Row: Price and Quick Add */}
      <div className="flex items-center justify-between mt-3.5 pt-2.5 border-t border-[#F0E3DF]">
        <div>
          <span className="font-bold text-sm sm:text-base text-[#2D1E2F]">
            {formatPrice(startingPrice(product), language)}
          </span>
          {product.originalPrice && (
            <span className="ml-1.5 rtl:ml-0 rtl:mr-1.5 text-xs text-[#9C7F8C] line-through">
              {formatPrice(product.originalPrice, language)}
            </span>
          )}
        </div>

        <button
          onClick={handleQuickAddClick}
          disabled={isOutOfStock}
          className="p-2 sm:px-3 sm:py-1.5 bg-[#F3E7E4] hover:bg-[#3B2332] text-[#3B2332] hover:text-[#FAF7F5] disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-xs font-bold transition flex items-center gap-1 group/btn"
          aria-label={`${product.variants.length > 1 ? t('product.selectShade') : t('product.addToBag')} — ${l(product.name)}`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {product.variants.length > 1 ? t('product.selectShade') : t('product.addToBag')}
          </span>
        </button>
      </div>
    </div>
  );
};
