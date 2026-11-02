import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';
import { customerApi } from '../api/api';

interface WishlistContextType {
  wishlistIds: string[];
  isInWishlist: (productId: string) => boolean;
  toggleWishlist: (productId: string, productName?: string) => void;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);
const WISHLIST_STORAGE_KEY = 'luma_beauty_wishlist';

function readStoredIds(): string[] {
  try {
    const saved = localStorage.getItem(WISHLIST_STORAGE_KEY);
    if (!saved) {
      return [];
    }
    const parsed: unknown = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export const WishlistProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { language } = useLanguage();

  const [wishlistIds, setWishlistIds] = useState<string[]>(readStoredIds);
  const previousUserId = useRef<string | null>(null);

  // Only a guest's wishlist lives in the browser (merged into the account at sign-in). An authenticated
  // wishlist is server state and is never left on disk where another account on this browser could adopt it.
  useEffect(() => {
    if (user) {
      localStorage.removeItem(WISHLIST_STORAGE_KEY);
    } else {
      localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(wishlistIds));
    }
  }, [wishlistIds, user]);

  // Account change policy: union local + server on sign-in, and clear per-user state on sign-out.
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const previous = previousUserId.current;
    previousUserId.current = currentUserId;

    if (!currentUserId) {
      if (previous) {
        setWishlistIds([]);
      }
      return;
    }

    let cancelled = false;

    customerApi
      .wishlist()
      .then((serverIds) => {
        if (cancelled) {
          return;
        }

        setWishlistIds((local) => {
          const merged = Array.from(new Set([...local, ...serverIds]));

          local
            .filter((id) => !serverIds.includes(id))
            .forEach((id) => {
              customerApi.addWishlistItem(id).catch(() => undefined);
            });

          return merged;
        });
      })
      .catch((error) => {
        console.warn('Failed to load wishlist:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const isInWishlist = (productId: string): boolean => wishlistIds.includes(productId);

  const toggleWishlist = (productId: string, productName?: string): void => {
    const isAdding = !wishlistIds.includes(productId);

    setWishlistIds((previous) =>
      isAdding ? [...previous, productId] : previous.filter((id) => id !== productId),
    );

    if (isAdding) {
      showToast(
        language === 'ar'
          ? `تمت إضافة ${productName || 'المنتج'} إلى المفضلة ❤️`
          : `Added ${productName || 'item'} to your wishlist ❤️`,
        'success',
      );
    } else {
      showToast(language === 'ar' ? 'تمت الإزالة من المفضلة' : 'Removed from wishlist', 'info');
    }

    if (!user) {
      return;
    }

    const request = isAdding
      ? customerApi.addWishlistItem(productId)
      : customerApi.removeWishlistItem(productId);

    request.catch((error) => {
      setWishlistIds((previous) =>
        isAdding ? previous.filter((id) => id !== productId) : [...previous, productId],
      );
      showToast(
        language === 'ar' ? 'تعذر تحديث المفضلة' : 'Could not update your wishlist',
        'error',
      );
      console.warn('Wishlist sync failed:', error);
    });
  };

  return (
    <WishlistContext.Provider value={{ wishlistIds, isInWishlist, toggleWishlist }}>
      {children}
    </WishlistContext.Provider>
  );
};

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) {
    throw new Error('useWishlist must be used within a WishlistProvider');
  }
  return context;
}
