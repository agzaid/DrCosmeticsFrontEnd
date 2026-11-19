import { useEffect, useState } from 'react';
import { catalogApi } from '../../api/api';
import type { Product } from '../../types';

/** How many products the live preview lists; the rest are one "view all results" click away. */
export const SEARCH_PREVIEW_SIZE = 4;

const DEBOUNCE_MS = 250;

interface SettledSearch {
  term: string;
  products: Product[];
  total: number;
}

export interface ProductSearch {
  /** The best matches, in the shop's default order (the same order "view all results" opens with). */
  products: Product[];
  /** Every product matching the term, not only the ones listed. */
  total: number;
  /** The response for the current term has not arrived; `products` may still hold the previous term's matches. */
  isLoading: boolean;
  /** The request for the current term failed. */
  hasError: boolean;
  retry: () => void;
}

/**
 * Live product search for the navbar. Requests are debounced, a newer term aborts the one before it and a superseded
 * answer is never applied. The previous matches stay listed while the next ones load, so the panel does not flash
 * empty between keystrokes. An empty query keeps the hook idle.
 */
export function useProductSearch(query: string): ProductSearch {
  const term = query.trim();
  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const [failedTerm, setFailedTerm] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!term) {
      return undefined;
    }

    setFailedTerm(null);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      catalogApi
        .products({ search: term, pageSize: SEARCH_PREVIEW_SIZE }, controller.signal)
        .then((page) => {
          if (!controller.signal.aborted) {
            setSettled({ term, products: page.products, total: page.total });
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFailedTerm(term);
          }
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, attempt]);

  const hasError = term !== '' && failedTerm === term;

  return {
    products: term ? (settled?.products ?? []) : [],
    total: term ? (settled?.total ?? 0) : 0,
    isLoading: term !== '' && settled?.term !== term && !hasError,
    hasError,
    retry: () => setAttempt((current) => current + 1),
  };
}
