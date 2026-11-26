import React, { useState, useEffect, lazy, Suspense } from 'react';
import { LanguageProvider } from './context/LanguageContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { CartProvider } from './context/CartContext';
import { DeliverySettingsProvider } from './context/DeliverySettingsContext';
import { WishlistProvider } from './context/WishlistContext';

import { Navbar } from './components/layout/Navbar';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { Footer } from './components/layout/Footer';
import { CartDrawer } from './components/cart/CartDrawer';
import { ProductDetailsModal } from './components/products/ProductDetailsModal';

import { HomePage } from './pages/HomePage';
// Every page but the landing page is split into its own chunk, so the first load carries only what the home page
// needs; checkout and the administration page (the largest) download when first visited.
const ShopPage = lazy(() => import('./pages/ShopPage').then((m) => ({ default: m.ShopPage })));
const WishlistPage = lazy(() => import('./pages/WishlistPage').then((m) => ({ default: m.WishlistPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const OrderConfirmationPage = lazy(() =>
  import('./pages/OrderConfirmationPage').then((m) => ({ default: m.OrderConfirmationPage })),
);
const AccountPage = lazy(() => import('./pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));

import type { Product, ProductCategory, PromotionalBanner, CategoryItem, BrandItem, Order, NavigationExtra } from './types';
import type { PasswordResetLink } from './api/types';
import { catalogApi } from './api/api';
import { ErrorState } from './components/common/ErrorState';

const LAST_ORDER_STORAGE_KEY = 'luma_last_order_id';
const RESET_HASH_PREFIX = '#reset-password';

function isProduct(value: NavigationExtra): value is Product {
  return 'variants' in value;
}

// The reset email links to `/#reset-password?email=...&token=...`. The data sits in the fragment so it never
// reaches a server, an access log or a Referer header.
function readPasswordResetLink(): PasswordResetLink | null {
  const { hash } = window.location;
  if (!hash.startsWith(`${RESET_HASH_PREFIX}?`)) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(RESET_HASH_PREFIX.length + 1));
  const email = params.get('email');
  const token = params.get('token');
  return email && token ? { email, token } : null;
}

function AppContent() {
  const [resetLink, setResetLink] = useState<PasswordResetLink | null>(readPasswordResetLink);
  const [currentView, setCurrentView] = useState<string>(() => {
    if (resetLink) {
      return 'account';
    }
    return localStorage.getItem(LAST_ORDER_STORAGE_KEY) ? 'order-confirmation' : 'home';
  });
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'all'>('all');
  const [shopFilter, setShopFilter] = useState<{ search?: string; sort?: string }>({});

  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [brands, setBrands] = useState<BrandItem[]>([]);
  const [banners, setBanners] = useState<PromotionalBanner[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Navigation that sets shop filters remounts ShopPage so its (initial-prop) filter state really changes.
  const [shopKey, setShopKey] = useState(0);

  const [activeModalProduct, setActiveModalProduct] = useState<Product | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [completedOrderId, setCompletedOrderId] = useState<string | null>(() =>
    localStorage.getItem(LAST_ORDER_STORAGE_KEY),
  );

  // Remove the token from the address bar and the history entry as soon as it has been read.
  useEffect(() => {
    const scrubHash = () => {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    const handleHashChange = () => {
      const link = readPasswordResetLink();
      if (link) {
        setResetLink(link);
        setCurrentView('account');
        scrubHash();
      }
    };

    if (window.location.hash.startsWith(RESET_HASH_PREFIX)) {
      scrubHash();
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError(false);

    Promise.all([
      catalogApi.categories(controller.signal),
      catalogApi.brands(controller.signal),
      catalogApi.banners(controller.signal),
    ])
      .then(([categoryList, brandList, bannerList]) => {
        if (controller.signal.aborted) {
          return;
        }
        setCategories(categoryList);
        setBrands(brandList);
        setBanners(bannerList);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn('Failed to load store data:', error);
          setCategories([]);
          setBrands([]);
          setBanners([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [reloadNonce]);

  const handleNavigate = (view: string, extra?: NavigationExtra) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (view === 'product-details' && extra && isProduct(extra)) {
      setActiveModalProduct(extra);
      return;
    }

    if (view !== 'order-confirmation') {
      localStorage.removeItem(LAST_ORDER_STORAGE_KEY);
      setCompletedOrderId(null);
    }

    if (view === 'shop' && extra && !isProduct(extra)) {
      if (extra.category) {
        setSelectedCategory(extra.category);
      }
      if (extra.search !== undefined || extra.sort !== undefined) {
        setShopFilter({ search: extra.search, sort: extra.sort });
      }
      setShopKey((current) => current + 1);
    }

    setCurrentView(view);
  };

  const handleOrderSuccess = (order: Order) => {
    setCompletedOrder(order);
    setCompletedOrderId(order.id);
    localStorage.setItem(LAST_ORDER_STORAGE_KEY, order.id);
    setCurrentView('order-confirmation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F5] text-[#2D1E2F]">
      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        selectedCategory={selectedCategory}
        onSelectCategory={(category) => {
          setSelectedCategory(category);
          setShopFilter({});
          setShopKey((current) => current + 1);
          setCurrentView('shop');
        }}
      />

      <main className="flex-1">
        {isLoading ? (
          <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-3 border-[#3B2332] border-t-[#E8998D] rounded-full animate-spin" />
            <p className="text-xs font-serif font-bold text-[#8B6E7E] tracking-widest uppercase">Dr Cosmetics</p>
          </div>
        ) : loadError && currentView !== 'admin' ? (
          <div className="px-4 py-16">
            <ErrorState onRetry={() => setReloadNonce((current) => current + 1)} />
          </div>
        ) : (
          <Suspense fallback={<div className="min-h-[50vh]" />}>
            {currentView === 'home' && (
              <HomePage
                banners={banners}
                categories={categories}
                onNavigateToShop={(filter) => {
                  setSelectedCategory(filter?.category ?? 'all');
                  setShopFilter({ sort: filter?.sort });
                  setShopKey((current) => current + 1);
                  setCurrentView('shop');
                }}
                onSelectProduct={(product) => setActiveModalProduct(product)}
                onQuickAdd={(product) => setActiveModalProduct(product)}
              />
            )}

            {currentView === 'shop' && (
              <ShopPage
                key={shopKey}
                brands={brands}
                initialCategory={selectedCategory}
                initialSearch={shopFilter.search || ''}
                initialSort={shopFilter.sort || 'featured'}
                onSelectProduct={(product) => setActiveModalProduct(product)}
                onQuickAdd={(product) => setActiveModalProduct(product)}
              />
            )}

            {currentView === 'wishlist' && (
              <WishlistPage
                onSelectProduct={(product) => setActiveModalProduct(product)}
                onQuickAdd={(product) => setActiveModalProduct(product)}
                onNavigateToShop={() => handleNavigate('shop')}
              />
            )}

            {currentView === 'checkout' && (
              <CheckoutPage
                onOrderSuccess={handleOrderSuccess}
                onNavigateToShop={() => handleNavigate('shop')}
              />
            )}

            {currentView === 'order-confirmation' && (
              <OrderConfirmationPage
                orderId={completedOrderId}
                initialOrder={completedOrder}
                onNavigateToShop={() => handleNavigate('shop')}
                onNavigateToAccount={() => handleNavigate('account')}
              />
            )}

            {currentView === 'account' && (
              <AccountPage
                onNavigateToShop={() => handleNavigate('shop')}
                onNavigateToAdmin={() => handleNavigate('admin')}
                resetLink={resetLink}
                onResetFinished={() => setResetLink(null)}
              />
            )}

            {currentView === 'admin' && <AdminPage />}
          </Suspense>
        )}
      </main>

      <CartDrawer
        onNavigateToCheckout={() => handleNavigate('checkout')}
        onNavigateToShop={() => handleNavigate('shop')}
      />

      <ProductDetailsModal
        product={activeModalProduct}
        onClose={() => setActiveModalProduct(null)}
        onSelectProduct={(product) => setActiveModalProduct(product)}
      />

      <Footer onNavigate={handleNavigate} />

      <MobileBottomNav currentView={currentView} onNavigate={handleNavigate} />
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <ToastProvider>
        <AuthProvider>
          <DeliverySettingsProvider>
            <CartProvider>
              <WishlistProvider>
                <AppContent />
              </WishlistProvider>
            </CartProvider>
          </DeliverySettingsProvider>
        </AuthProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}
