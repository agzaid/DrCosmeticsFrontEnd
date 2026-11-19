import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { mediaUrl } from '../../api/config';
import { discountPercent, formatPrice, isSoldOut, startingPrice } from '../../utils/shopLogic';
import type { Product } from '../../types';
import { SEARCH_PREVIEW_SIZE, type ProductSearch } from './useProductSearch';

const HEADING_ID = 'search-panel-heading';

interface SearchResultCardProps {
  product: Product;
  onSelect: (product: Product) => void;
}

const SearchResultCard: React.FC<SearchResultCardProps> = ({ product, onSelect }) => {
  const { language, l, t } = useLanguage();
  const image = mediaUrl(product.images[0]);
  const percent = discountPercent(product);
  // A positive percentage means the struck-through original price exists and is above the price.
  const originalPrice = percent > 0 ? product.originalPrice : undefined;

  // A product that cannot be bought says so; otherwise a real discount is announced with its size.
  const badge = isSoldOut(product)
    ? { label: t('product.outOfStock'), tone: 'bg-stone-600' }
    : percent > 0
      ? { label: t('product.salePercent').replace('{percent}', String(percent)), tone: 'bg-rose-700' }
      : null;

  return (
    <button
      type="button"
      data-testid={`search-result-${product.id}`}
      onClick={() => onSelect(product)}
      className="group flex h-full w-full flex-col rounded-2xl border border-[#EBE0DC] bg-[#FAF7F5] p-2.5 text-left transition hover:border-[#D48374] hover:shadow-md focus-visible:border-[#D48374] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D48374]/50 rtl:text-right"
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-xl bg-[#F3E7E4]">
        {image && (
          <img
            src={image}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        {badge && (
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-xs rtl:left-auto rtl:right-2 ${badge.tone}`}
          >
            {badge.label}
          </span>
        )}
      </span>

      <span className="mt-2.5 block truncate text-[11px] font-bold uppercase tracking-wider text-[#8B6E7E]">
        {product.brand}
      </span>
      <span className="mt-0.5 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-[#2D1E2F] transition group-hover:text-[#8B263E]">
        {l(product.name)}
      </span>

      <span className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-sm font-bold ${originalPrice !== undefined ? 'text-[#8B263E]' : 'text-[#2D1E2F]'}`}>
          {formatPrice(startingPrice(product), language)}
        </span>
        {originalPrice !== undefined && (
          <s className="text-xs text-[#9C7F8C]">{formatPrice(originalPrice, language)}</s>
        )}
      </span>
    </button>
  );
};

interface SearchResultsPanelProps {
  /** The trimmed term the results are for. */
  term: string;
  search: ProductSearch;
  onSelectProduct: (product: Product) => void;
  onViewAll: () => void;
}

/**
 * The navbar's live results: the best matches as product cards under the header, with the full match count on the
 * "view all results" action. Positions itself against the sticky header, so it must sit inside it and outside any
 * other positioned ancestor.
 */
export const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  term,
  search,
  onSelectProduct,
  onViewAll,
}) => {
  const { t } = useLanguage();
  const { products, total, isLoading, hasError, retry } = search;
  const hasResults = products.length > 0;

  const announcement = isLoading
    ? t('state.loading')
    : hasError
      ? ''
      : hasResults
        ? t('filter.resultsCount').replace('{count}', String(total))
        : t('nav.noResults').replace('{query}', term);

  return (
    <div
      role="region"
      aria-labelledby={HEADING_ID}
      aria-busy={isLoading}
      data-testid="search-panel"
      className="absolute left-1/2 top-full z-50 mt-1 max-h-[calc(100vh_-_10rem)] w-[min(56rem,calc(100%_-_2rem))] -translate-x-1/2 overflow-y-auto rounded-2xl border border-[#E8D6D1] bg-white shadow-xl"
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <p
        id={HEADING_ID}
        className="border-b border-[#F0E3DF] px-5 pb-3 pt-4 text-sm font-bold uppercase tracking-wider text-[#3B2332]"
      >
        {t('nav.matching')}
      </p>

      {hasError ? (
        <div role="alert" data-testid="search-error" className="flex flex-col items-center gap-3 px-5 py-10 text-center">
          <AlertCircle className="h-6 w-6 text-rose-600" />
          <p className="text-sm text-[#8B6E7E]">{t('error.loadBody')}</p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-2 rounded-full bg-[#3B2332] px-5 py-2 text-xs font-bold text-white transition hover:bg-[#523347]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{t('error.retry')}</span>
          </button>
        </div>
      ) : !isLoading && !hasResults ? (
        <p data-testid="search-empty" className="break-words px-5 py-10 text-center text-sm text-[#8B6E7E]">
          {t('nav.noResults').replace('{query}', term)}
        </p>
      ) : (
        // While the next term loads the previous matches stay, dimmed together with their count.
        <div className={`transition-opacity ${isLoading && hasResults ? 'opacity-60' : ''}`}>
          <ul className="grid grid-cols-4 gap-3 p-5">
            {hasResults
              ? products.map((product) => (
                  <li key={product.id}>
                    <SearchResultCard product={product} onSelect={onSelectProduct} />
                  </li>
                ))
              : Array.from({ length: SEARCH_PREVIEW_SIZE }, (_, index) => (
                  <li
                    key={index}
                    aria-hidden="true"
                    className="animate-pulse rounded-2xl border border-[#EBE0DC] bg-[#FAF7F5] p-2.5"
                  >
                    <div className="aspect-square w-full rounded-xl bg-[#EBDCD7]" />
                    <div className="mt-3 h-2.5 w-1/3 rounded bg-[#EBDCD7]" />
                    <div className="mt-2 h-3.5 w-5/6 rounded bg-[#EBDCD7]" />
                    <div className="mt-1.5 h-3.5 w-2/3 rounded bg-[#EBDCD7]" />
                    <div className="mt-3 h-4 w-1/2 rounded bg-[#EBDCD7]" />
                  </li>
                ))}
          </ul>

          {hasResults && (
            <button
              type="button"
              data-testid="search-view-all"
              onClick={onViewAll}
              className="block w-full border-t border-[#F0E3DF] px-5 py-4 text-center text-sm font-bold uppercase tracking-wider text-[#3B2332] transition hover:bg-[#F3E7E4] hover:text-[#8B263E] focus-visible:bg-[#F3E7E4] focus-visible:outline-none"
            >
              {t('nav.viewAllResults').replace('{count}', String(total))}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
