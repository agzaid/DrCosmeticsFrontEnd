import React, { useState, useEffect } from 'react';
import { 
  X, 
  Heart, 
  ShoppingBag, 
  Star, 
  Check, 
  AlertCircle, 
  Plus, 
  Minus, 
  Sparkles, 
  ShieldCheck, 
  Info,
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import type { Product, ProductVariant } from '../../types';
import { catalogApi } from '../../api/api';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { ApiError } from '../../api/httpClient';
import { mediaUrl } from '../../api/config';
import { MAX_LINE_QUANTITY, formatPrice, startingPrice } from '../../utils/shopLogic';
import { useDialogBehavior } from '../common/useDialogBehavior';

interface ProductDetailsModalProps {
  product: Product | null;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
}

interface ProductDetailsModalContentProps {
  product: Product;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
}

const ProductDetailsModalContent: React.FC<ProductDetailsModalContentProps> = ({
  product,
  onClose,
  onSelectProduct,
}) => {
  const { language, l, t } = useLanguage();
  const { addToCart } = useCart();
  const { isInWishlist, toggleWishlist } = useWishlist();

  // Selected variant state
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    () => (product.variants.find((v) => v.stock > 0) ?? product.variants[0]).id,
  );
  // Resolved by id so a refreshed product (fresh stock from GET /products/{id}) replaces the snapshot.
  const selectedVariant = product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];
  const dialogRef = useDialogBehavior(onClose);

  // Selected image index
  const [activeImage, setActiveImage] = useState<string>(() => {
    return selectedVariant?.image || product.images[0] || '';
  });

  const [quantity, setQuantity] = useState<number>(1);
  const [activeAccordion, setActiveAccordion] = useState<'ingredients' | 'howToUse' | null>(null);

  // When variant changes, update active image if variant has its own image
  useEffect(() => {
    const variant = product.variants.find((v) => v.id === selectedVariantId);
    if (variant?.image) {
      setActiveImage(variant.image);
    } else if (product.images.length > 0) {
      setActiveImage(product.images[0]);
    }
    setQuantity(1);
  }, [selectedVariantId, product.id]);

  const isFavorited = isInWishlist(product.id);
  const isOutOfStock = selectedVariant.stock <= 0;
  const isLowStock = selectedVariant.stock > 0 && selectedVariant.stock <= 5;
  const maxQuantity = Math.min(selectedVariant.stock, MAX_LINE_QUANTITY);

  // Related products come from their own query so a partial catalog page is never assumed.
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    catalogApi
      .products({ category: product.category, pageSize: 4 }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setRelatedProducts(result.products.filter((entry) => entry.id !== product.id).slice(0, 3));
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [product.id, product.category]);

  const handleAddToCart = () => {
    if (isOutOfStock) return;
    addToCart(product, selectedVariant, quantity);
    onClose();
  };

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={l(product.name)}
        data-testid="product-modal"
        tabIndex={-1}
        className="relative w-full max-w-4xl bg-[#FAF7F5] rounded-3xl border border-[#E8D6D1] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col focus:outline-none"
      >
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rtl:right-auto rtl:left-4 z-20 w-9 h-9 rounded-full bg-white/90 backdrop-blur-xs border border-[#E8D6D1] text-[#3B2332] hover:bg-[#F3E7E4] flex items-center justify-center transition shadow-xs"
          aria-label={t('product.close')}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-5 sm:p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-10">
            
            {/* Left: Image Gallery */}
            <div className="space-y-4">
              <div className="aspect-square w-full rounded-2xl overflow-hidden bg-white border border-[#E8D6D1] relative">
                <img
                  src={mediaUrl(activeImage)}
                  alt={l(product.name)}
                  className="w-full h-full object-cover transition-all duration-300"
                />
                {isOutOfStock && (
                  <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center">
                    <span className="bg-[#2D1E2F] text-white text-xs font-bold px-4 py-1.5 rounded-full uppercase tracking-wider">
                      {t('product.outOfStock')}
                    </span>
                  </div>
                )}
              </div>

              {/* Thumbnails */}
              {product.images.length > 1 && (
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {product.images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setActiveImage(img)}
                      aria-label={`${l(product.name)} ${idx + 1}`}
                      className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition shrink-0 ${
                        activeImage === img ? 'border-[#8B263E] shadow-xs' : 'border-[#E8D6D1] opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img src={mediaUrl(img)} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              {/* Clean Guarantee Note */}
              <div className="p-3.5 rounded-2xl bg-[#F4E9E6] border border-[#E8D6D1] flex items-center gap-3 text-xs text-[#503E48]">
                <ShieldCheck className="w-5 h-5 text-[#8B263E] shrink-0" />
                <p>
                  <strong>{t('product.guaranteeTitle')}</strong> {t('product.guaranteeBody')}
                </p>
              </div>
            </div>

            {/* Right: Product Info & Variant Controls */}
            <div className="flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                
                {/* Brand & Title */}
                <div>
                  <p className="text-xs font-bold text-[#8B6E7E] uppercase tracking-widest">
                    {product.brand}
                  </p>
                  <h1 className="font-serif text-2xl sm:text-3xl font-bold text-[#2D1E2F] mt-1">
                    {l(product.name)}
                  </h1>
                </div>

                {/* Rating & Reviews */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center text-amber-500">
                    <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                    <span className="ml-1 rtl:ml-0 rtl:mr-1 font-bold text-sm text-[#2D1E2F]">
                      {product.rating.toFixed(1)}
                    </span>
                  </div>
                  <span className="text-stone-300">•</span>
                  <span className="text-xs text-[#8B6E7E]">
                    {t('product.ratings').replace('{count}', String(product.reviewsCount))}
                  </span>
                  <span className="text-stone-300">•</span>
                  <span className="text-[11px] font-mono text-[#8B6E7E] bg-white border border-[#E8D6D1] px-1.5 py-0.5 rounded">
                    {selectedVariant.sku}
                  </span>
                </div>

                {/* Price Display */}
                <div className="flex items-baseline gap-3">
                  <span data-testid="modal-price" className="font-serif text-3xl font-bold text-[#8B263E]">
                    {formatPrice(selectedVariant.price, language)}
                  </span>
                  {product.originalPrice && (
                    <span className="text-base text-[#9C7F8C] line-through">
                      {formatPrice(product.originalPrice, language)}
                    </span>
                  )}
                </div>

                {/* Stock status for the selected variant (shown for every product, with or without pickers) */}
                <p
                  data-testid="stock-status"
                  className={`text-xs font-semibold ${
                    selectedVariant.stock <= 0 ? 'text-rose-600' : isLowStock ? 'text-amber-700' : 'text-emerald-700'
                  }`}
                >
                  {selectedVariant.stock <= 0
                    ? t('product.outOfStock')
                    : isLowStock
                      ? t('product.lowStock').replace('{count}', selectedVariant.stock.toString())
                      : t('product.inStock')}
                </p>

                {/* Description */}
                <p className="text-xs sm:text-sm text-[#503E48] leading-relaxed">
                  {l(product.description)}
                </p>

                {/* --- VARIANT PICKER: SHADES --- */}
                {product.variants.some((v) => v.shadeName) && (
                  <div className="space-y-2 pt-2 border-t border-[#F0E3DF]">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#2D1E2F]">
                        {t('product.shade')}:{' '}
                        <span className="text-[#8B263E] font-semibold">
                          {selectedVariant.shadeName ? l(selectedVariant.shadeName) : ''}
                        </span>
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2.5">
                      {product.variants.map((v) => {
                        const isSelected = selectedVariant.id === v.id;
                        const isStockOut = v.stock <= 0;

                        return (
                          <button
                            key={v.id}
                            onClick={() => setSelectedVariantId(v.id)}
                            className={`group/swatch relative flex items-center gap-2 p-1.5 rounded-full border transition-all ${
                              isSelected
                                ? 'border-[#8B263E] ring-2 ring-[#8B263E]/20 bg-white shadow-xs'
                                : 'border-[#E8D6D1] hover:border-[#D48374] bg-[#FAF7F5]'
                            } ${isStockOut ? 'opacity-50' : ''}`}
                            aria-label={t('product.selectShadeNamed').replace('{name}', v.shadeName ? l(v.shadeName) : v.sku)}
                            aria-pressed={isSelected}
                            data-testid="variant-option"
                            data-variant-id={v.id}
                          >
                            {v.shadeHex && (
                              <span
                                className="w-5 h-5 rounded-full border border-black/20 shrink-0"
                                style={{ backgroundColor: v.shadeHex }}
                              />
                            )}
                            <span className="text-xs font-medium px-1 text-[#2D1E2F]">
                              {v.shadeName ? l(v.shadeName) : v.sku}
                            </span>
                            {isStockOut && (
                              <span className="text-[10px] text-rose-600 font-bold px-1">
                                ✕
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* --- VARIANT PICKER: SIZES --- */}
                {product.variants.some((v) => v.size && !v.shadeName) && (
                  <div className="space-y-2 pt-2 border-t border-[#F0E3DF]">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#2D1E2F]">
                        {t('product.size')}:{' '}
                        <span className="text-[#8B263E] font-semibold">{selectedVariant.size}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {product.variants.map((v) => {
                        const isSelected = selectedVariant.id === v.id;
                        const isStockOut = v.stock <= 0;

                        return (
                          <button
                            key={v.id}
                            onClick={() => setSelectedVariantId(v.id)}
                            aria-pressed={isSelected}
                            data-testid="variant-option"
                            data-variant-id={v.id}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                              isSelected
                                ? 'bg-[#3B2332] text-white border-[#3B2332] shadow-xs'
                                : 'bg-white text-[#2D1E2F] border-[#E8D6D1] hover:border-[#D48374]'
                            } ${isStockOut ? 'opacity-40 line-through' : ''}`}
                          >
                            {v.size} — {formatPrice(v.price, language)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quantity and Actions */}
                <div className="pt-4 border-t border-[#F0E3DF] space-y-3">
                  <div className="flex items-center gap-3">
                    
                    {/* Stepper */}
                    <div className="flex items-center border border-[#E8D6D1] rounded-xl bg-white overflow-hidden">
                      <button
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        disabled={quantity <= 1 || isOutOfStock}
                        className="p-2.5 hover:bg-[#F3E7E4] text-[#3B2332] disabled:opacity-30 transition"
                        aria-label={t('cart.decrease')}
                        data-testid="qty-decrease"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span data-testid="qty-value" className="px-4 text-sm font-bold text-[#2D1E2F] min-w-[32px] text-center">
                        {quantity}
                      </span>
                      <button
                        onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                        disabled={quantity >= maxQuantity || isOutOfStock}
                        className="p-2.5 hover:bg-[#F3E7E4] text-[#3B2332] disabled:opacity-30 transition"
                        aria-label={t('cart.increase')}
                        data-testid="qty-increase"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Add to Bag Button */}
                    <button
                      data-testid="modal-add-to-bag"
                      onClick={handleAddToCart}
                      disabled={isOutOfStock}
                      className="flex-1 py-3 px-6 bg-[#3B2332] hover:bg-[#523347] disabled:bg-stone-300 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm shadow-md transition flex items-center justify-center gap-2 group"
                    >
                      <ShoppingBag className="w-4 h-4 text-[#F3D8D3] group-hover:scale-110 transition" />
                      <span>{isOutOfStock ? t('product.outOfStock') : t('product.addToBag')}</span>
                    </button>

                    {/* Wishlist toggle */}
                    <button
                      onClick={() => toggleWishlist(product.id, l(product.name))}
                      className={`p-3 rounded-xl border border-[#E8D6D1] transition ${
                        isFavorited
                          ? 'bg-rose-50 text-rose-600 border-rose-200'
                          : 'bg-white text-[#3B2332] hover:bg-[#F3E7E4]'
                      }`}
                      aria-label={t('product.wishlistToggle')}
                      data-testid="modal-wishlist"
                      aria-pressed={isFavorited}
                    >
                      <Heart className={`w-5 h-5 ${isFavorited ? 'fill-rose-600' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Accordions: Ingredients & How to Use */}
                <div className="pt-2 border-t border-[#F0E3DF] divide-y divide-[#F0E3DF]">
                  
                  {/* Ingredients */}
                  <div className="py-2.5">
                    <button
                      onClick={() =>
                        setActiveAccordion(activeAccordion === 'ingredients' ? null : 'ingredients')
                      }
                      className="w-full flex items-center justify-between text-xs font-bold text-[#2D1E2F] hover:text-[#8B263E] transition"
                    >
                      <span>{t('product.ingredients')}</span>
                      {activeAccordion === 'ingredients' ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {activeAccordion === 'ingredients' && (
                      <p className="text-xs text-[#503E48] mt-2 leading-relaxed bg-white p-3 rounded-xl border border-[#E8D6D1]">
                        {l(product.ingredients)}
                      </p>
                    )}
                  </div>

                  {/* How to Use */}
                  <div className="py-2.5">
                    <button
                      onClick={() =>
                        setActiveAccordion(activeAccordion === 'howToUse' ? null : 'howToUse')
                      }
                      className="w-full flex items-center justify-between text-xs font-bold text-[#2D1E2F] hover:text-[#8B263E] transition"
                    >
                      <span>{t('product.howToUse')}</span>
                      {activeAccordion === 'howToUse' ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {activeAccordion === 'howToUse' && (
                      <p className="text-xs text-[#503E48] mt-2 leading-relaxed bg-white p-3 rounded-xl border border-[#E8D6D1]">
                        {l(product.howToUse)}
                      </p>
                    )}
                  </div>
                </div>

              </div>
            </div>

          </div>

          {/* Related Products Section */}
          {relatedProducts.length > 0 && (
            <div className="mt-10 pt-6 border-t border-[#E8D6D1]">
              <h3 className="font-serif text-lg font-bold text-[#2D1E2F] mb-4">
                {t('product.related')}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {relatedProducts.map((rel) => (
                  <div
                    key={rel.id}
                    onClick={() => onSelectProduct(rel)}
                    className="p-2.5 rounded-xl border border-[#E8D6D1] bg-white hover:border-[#D48374] transition cursor-pointer flex items-center gap-3 group"
                  >
                    <img
                      src={mediaUrl(rel.images[0])}
                      alt={l(rel.name)}
                      className="w-14 h-14 object-cover rounded-lg shrink-0 border border-[#F0E3DF]"
                    />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-[#8B6E7E] uppercase">{rel.brand}</p>
                      <h4 className="text-xs font-semibold text-[#2D1E2F] truncate group-hover:text-[#8B263E]">
                        {l(rel.name)}
                      </h4>
                      <p className="text-xs font-bold text-[#8B263E] mt-0.5">
                        {formatPrice(startingPrice(rel), language)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export const ProductDetailsModal: React.FC<ProductDetailsModalProps> = ({ product, ...rest }) => {
  const [fresh, setFresh] = useState<Product | null>(null);
  const productId = product?.id;
  const { onClose } = rest;

  // A-07: the modal reads GET /products/{id} so stock and price are current, not the list snapshot.
  useEffect(() => {
    setFresh(null);
    if (!productId) {
      return;
    }
    const controller = new AbortController();
    catalogApi
      .product(productId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setFresh(detail);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 404) {
          onClose();
        }
      });
    return () => controller.abort();
  }, [productId]);

  if (!product) return null;
  const current = fresh && fresh.id === product.id ? fresh : product;
  return <ProductDetailsModalContent key={product.id} product={current} {...rest} />;
};
