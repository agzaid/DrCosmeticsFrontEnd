import React from 'react';
import { useLanguage } from '../../context/LanguageContext';
import type { LocalizedString } from '../../types';

/**
 * Rows on a page of an admin list. Ten keeps a tab short: an administrator pages through the catalogue instead of
 * scrolling an endless table.
 */
export const ADMIN_PAGE_SIZE = 10;

/** 1 … 4 5 6 … 12: the ends are always one click away, and the current page has one neighbour either side. */
function pageTokens(page: number, totalPages: number): (number | 'gap')[] {
  const wanted = [1, page - 1, page, page + 1, totalPages]
    .filter((candidate) => candidate >= 1 && candidate <= totalPages)
    .sort((left, right) => left - right);
  const tokens: (number | 'gap')[] = [];
  let previous = 0;
  for (const candidate of wanted) {
    if (candidate === previous) {
      continue;
    }
    if (previous > 0 && candidate - previous > 1) {
      tokens.push('gap');
    }
    tokens.push(candidate);
    previous = candidate;
  }
  return tokens;
}

export interface AdminPaginationProps {
  /** Test hook: the list this bar pages, e.g. "products". */
  id: string;
  page: number;
  totalPages: number;
  /** Rows in the whole list, not on this page. */
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** What the list holds, for the "Showing 1–10 of 61 products" line. Omit when the tab already prints its own count. */
  unit?: LocalizedString;
  disabled?: boolean;
}

/**
 * The page bar under every admin list: previous, the page numbers, next. Nothing renders for a list that fits on one page.
 */
export const AdminPagination: React.FC<AdminPaginationProps> = ({
  id,
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  unit,
  disabled = false,
}) => {
  const { language } = useLanguage();
  const tr = (en: string, ar: string): string => (language === 'ar' ? ar : en);
  const pages = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), pages);

  if (pages <= 1) {
    return null;
  }

  const go = (target: number): void => {
    if (disabled || target === current || target < 1 || target > pages) {
      return;
    }
    onPage(target);
    // The bar sits under the rows: bring the top of the list back into view instead of leaving the reader at the old page's end.
    window.scrollTo({ top: 0 });
  };

  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  const buttonClass =
    'min-w-9 h-9 px-2 rounded-xl text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-2" data-pagination={id}>
      {unit !== undefined && (
        <p className="text-center text-[11px] text-[#8B6E7E]" data-field={`${id}-range`}>
          {tr(`Showing ${from}–${to} of ${total} ${unit.en}`, `عرض ${from}–${to} من ${total} ${unit.ar}`)}
        </p>
      )}

      <nav
        aria-label={tr('Pages', 'الصفحات')}
        className="flex flex-wrap items-center justify-center gap-2 text-xs"
      >
        <button
          type="button"
          data-step="previous"
          onClick={() => go(current - 1)}
          disabled={disabled || current <= 1}
          aria-label={tr('Previous page', 'الصفحة السابقة')}
          className={`${buttonClass} bg-white border border-[#E8D6D1] text-[#3B2332] hover:bg-[#F3E7E4]`}
        >
          {tr('Previous', 'السابق')}
        </button>

        {pageTokens(current, pages).map((token, index) =>
          token === 'gap' ? (
            <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-[#B49AA6]">
              …
            </span>
          ) : (
            <button
              key={token}
              type="button"
              data-page={token}
              aria-current={token === current ? 'page' : undefined}
              aria-label={tr(`Page ${token}`, `الصفحة ${token}`)}
              onClick={() => go(token)}
              disabled={disabled}
              className={`${buttonClass} ${
                token === current
                  ? 'bg-[#3B2332] text-white'
                  : 'bg-white border border-[#E8D6D1] text-[#503E48] hover:bg-[#F3E7E4]'
              }`}
            >
              {token}
            </button>
          ),
        )}

        <button
          type="button"
          data-step="next"
          onClick={() => go(current + 1)}
          disabled={disabled || current >= pages}
          aria-label={tr('Next page', 'الصفحة التالية')}
          className={`${buttonClass} bg-white border border-[#E8D6D1] text-[#3B2332] hover:bg-[#F3E7E4]`}
        >
          {tr('Next', 'التالي')}
        </button>
      </nav>
    </div>
  );
};
