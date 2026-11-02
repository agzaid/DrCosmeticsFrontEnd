import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  ShoppingBag, 
  Heart, 
  User as UserIcon, 
  ShieldCheck, 
  Globe, 
  Menu, 
  X,
  Sparkles,
  ChevronDown
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';
import { useAuth } from '../../context/AuthContext';
import { formatPrice, startingPrice } from '../../utils/shopLogic';
import type { NavigationExtra, Product, ProductCategory } from '../../types';
import { catalogApi } from '../../api/api';
import { mediaUrl } from '../../api/config';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string, extra?: NavigationExtra) => void;
  selectedCategory?: string;
  onSelectCategory?: (category: ProductCategory | 'all') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onNavigate,
  selectedCategory,
  onSelectCategory,
}) => {
  const { language, setLanguage, t, l } = useLanguage();
  const { itemCount, totals, setIsDrawerOpen } = useCart();
  const { wishlistIds } = useWishlist();
  const { user, isAdmin, logout } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [searchResults, setSearchResults] = useState<Product[]>([]);

  useEffect(() => {
    const term = searchQuery.trim();
    if (!term) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      catalogApi
        .products({ search: term, pageSize: 5 }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setSearchResults(result.products);
          }
        })
        .catch(() => undefined);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const handleProductSelect = (product: Product) => {
    setSearchQuery('');
    setIsSearchFocused(false);
    onNavigate('product-details', product);
  };

  const categoriesList: { id: ProductCategory | 'all'; labelKey: string }[] = [
    { id: 'all', labelKey: 'cat.all' },
    { id: 'makeup', labelKey: 'cat.makeup' },
    { id: 'skincare', labelKey: 'cat.skincare' },
    { id: 'haircare', labelKey: 'cat.haircare' },
    { id: 'fragrance', labelKey: 'cat.fragrance' },
    { id: 'tools', labelKey: 'cat.tools' },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#FAF7F5]/95 backdrop-blur-md border-b border-[#F0E3DF] shadow-xs">
      {/* 1. Top Announcement Bar */}
      <div className="bg-[#3B2332] text-[#F9EBE7] text-xs py-1.5 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap min-w-0 pr-2">
            <Sparkles className="w-3.5 h-3.5 text-[#E8998D] shrink-0" />
            <span className="font-medium tracking-wide truncate">
              {language === 'ar' ? 'شحن مجاني فوق 600 ج.م' : 'Free Egypt shipping over 600 EGP'}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs shrink-0">
            {/* Language Switcher */}
            <button
              onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
              className="flex items-center gap-1.5 hover:text-[#E8998D] transition font-medium"
              aria-label={t('nav.switchLanguage')}
              data-testid="nav-language"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{language === 'en' ? 'العربية' : 'English'}</span>
            </button>

            {/* Admin Portal Quick Jump */}
            {isAdmin && (
              <button
                onClick={() => onNavigate('admin')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold transition ${
                  currentView === 'admin'
                    ? 'bg-[#E8998D] text-[#2D1E2F]'
                    : 'bg-[#523347] hover:bg-[#68425b] text-[#FAF7F5]'
                }`}
              >
                <ShieldCheck className="w-3 h-3 text-[#E8998D]" />
                <span>{t('nav.admin')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18 gap-3 sm:gap-6">
          
          {/* Mobile menu button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-[#3B2332] hover:bg-[#F3E7E4] rounded-lg transition"
            aria-label={t('nav.toggleMenu')}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          {/* Brand Logo */}
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-2.5 text-left group"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#3B2332] to-[#603951] flex items-center justify-center text-[#FAF7F5] shadow-xs group-hover:scale-105 transition duration-300">
              <span className="font-serif text-2xl font-bold tracking-tighter text-[#F3D8D3]">L</span>
            </div>
            <div>
              <span className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-[#3B2332] group-hover:text-[#603951] transition">
                {t('brand.name')}
              </span>
              <span className="hidden sm:block text-[10px] tracking-widest uppercase font-semibold text-[#8B6E7E]">
                {t('brand.subtitle')}
              </span>
            </div>
          </button>

          {/* Search Bar with Live Preview */}
          <div ref={searchRef} className="hidden md:flex flex-1 max-w-md relative">
            <div className="relative w-full">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsSearchFocused(true);
                }}
                onFocus={() => setIsSearchFocused(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    setIsSearchFocused(false);
                    onNavigate('shop', { search: searchQuery.trim() });
                  } else if (e.key === 'Escape') {
                    setIsSearchFocused(false);
                  }
                }}
                aria-label={t('nav.search')}
                data-testid="nav-search"
                placeholder={t('nav.searchPlaceholder')}
                className="w-full bg-[#FAF7F5] border border-[#E4D1CC] rounded-full py-2.5 px-10 text-sm text-[#2D1E2F] placeholder-[#9C7F8C] focus:outline-none focus:ring-2 focus:ring-[#D48374] focus:border-transparent transition shadow-2xs"
              />
              <Search className="w-4 h-4 text-[#9C7F8C] absolute left-3.5 top-3 rtl:left-auto rtl:right-3.5" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3.5 top-3 rtl:right-auto rtl:left-3.5 text-stone-400 hover:text-stone-700"
                  aria-label={t('nav.clearSearch')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Instant Search Results Dropdown */}
            {isSearchFocused && searchQuery.trim().length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-[#FAF7F5] border border-[#E8D6D1] rounded-2xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1">
                {searchResults.length > 0 ? (
                  <div className="p-2 divide-y divide-[#F3E7E4]">
                    <div className="px-3 py-1.5 text-[11px] font-bold text-[#8B6E7E] uppercase tracking-wider">
                      {t('nav.matching')}
                    </div>
                    {searchResults.map((prod) => (
                      <button
                        key={prod.id}
                        onClick={() => handleProductSelect(prod)}
                        className="w-full flex items-center gap-3 p-2 hover:bg-[#F3E7E4] rounded-xl text-left transition"
                      >
                        <img
                          src={mediaUrl(prod.images[0])}
                          alt={l(prod.name)}
                          className="w-11 h-11 object-cover rounded-lg shrink-0 border border-[#E8D6D1]"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[#8B6E7E] font-medium">{prod.brand}</p>
                          <p className="text-sm font-semibold text-[#2D1E2F] truncate">{l(prod.name)}</p>
                          <p className="text-xs font-bold text-[#3B2332]">{formatPrice(startingPrice(prod), language)}</p>
                        </div>
                      </button>
                    ))}
                    <div className="p-2 text-center bg-[#F7EFEF]/60">
                      <button
                        onClick={() => {
                          setIsSearchFocused(false);
                          onNavigate('shop', { search: searchQuery });
                        }}
                        className="text-xs font-bold text-[#3B2332] hover:text-[#7A3A54] transition"
                      >
                        {t('nav.viewAllResults').replace('{query}', searchQuery)}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-[#8B6E7E]">
                    {t('nav.noResults').replace('{query}', searchQuery)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Action Icons: Wishlist, Account, Cart */}
          <div className="flex items-center gap-2 sm:gap-4">
            
            {/* Wishlist Button */}
            <button
              onClick={() => onNavigate('wishlist')}
              className={`p-2 sm:p-2.5 rounded-full hover:bg-[#F3E7E4] transition relative ${
                currentView === 'wishlist' ? 'bg-[#F3E7E4] text-[#8B263E]' : 'text-[#3B2332]'
              }`}
              aria-label={t('nav.wishlist')}
              data-testid="nav-wishlist"
            >
              <Heart className="w-5 h-5 sm:w-6 sm:h-6" />
              {wishlistIds.length > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 sm:w-5 sm:h-5 bg-[#C47D76] text-white rounded-full text-[10px] sm:text-xs font-bold flex items-center justify-center shadow-xs">
                  {wishlistIds.length}
                </span>
              )}
            </button>

            {/* Account Dropdown */}
            <div ref={userMenuRef} className="relative">
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className={`flex items-center gap-1.5 p-2 sm:p-2.5 rounded-full hover:bg-[#F3E7E4] transition text-[#3B2332] ${
                  currentView === 'account' ? 'bg-[#F3E7E4]' : ''
                }`}
                aria-label={t('nav.accountMenu')}
                aria-expanded={isUserMenuOpen}
                data-testid="nav-account"
              >
                <UserIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                {user && (
                  <span className="hidden lg:inline text-xs font-semibold max-w-[100px] truncate">
                    {user.fullName.split(' ')[0]}
                  </span>
                )}
                <ChevronDown className="w-3.5 h-3.5 hidden sm:block text-[#8B6E7E]" />
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 rtl:right-auto rtl:left-0 mt-2 w-56 bg-[#FAF7F5] border border-[#E8D6D1] rounded-2xl shadow-xl p-2 z-50 animate-in fade-in slide-in-from-top-1">
                  {user ? (
                    <div className="divide-y divide-[#F3E7E4]">
                      <div className="px-3 py-2">
                        <p className="text-xs text-[#8B6E7E]">{t('nav.signedInAs')}</p>
                        <p className="text-sm font-bold text-[#2D1E2F] truncate">{user.fullName}</p>
                        <span className="inline-block px-2 py-0.5 mt-1 text-[10px] font-semibold rounded bg-[#F3D8D3] text-[#3B2332]">
                          {user.role === 'admin' ? t('role.admin') : t('role.customer')}
                        </span>
                      </div>
                      <div className="py-1">
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            onNavigate('account');
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-[#2D1E2F] hover:bg-[#F3E7E4] rounded-lg transition"
                        >
                          {t('account.orders')} & {t('account.savedAddresses')}
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              onNavigate('admin');
                            }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-[#682F48] hover:bg-[#F3E7E4] rounded-lg transition flex items-center justify-between"
                          >
                            <span>{t('admin.title')}</span>
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="pt-1">
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            logout();
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-lg transition"
                        >
                          {t('account.logout')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2 space-y-2">
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('account');
                        }}
                        className="w-full py-2 px-3 bg-[#3B2332] text-white rounded-xl text-xs font-bold hover:bg-[#523347] transition shadow-xs"
                      >
                        {t('account.signIn')} / {t('account.register')}
                      </button>

                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Shopping Bag Drawer Trigger */}
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="flex items-center gap-2 py-2 px-3 sm:px-4 bg-[#3B2332] hover:bg-[#523347] text-white rounded-full transition shadow-xs group"
              aria-label={t('nav.cart')}
              data-testid="nav-cart"
            >
              <div className="relative">
                <ShoppingBag className="w-5 h-5 text-[#F3D8D3] group-hover:scale-110 transition" />
                {itemCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#E8998D] text-[#2D1E2F] font-bold rounded-full w-4 h-4 text-[10px] flex items-center justify-center">
                    {itemCount}
                  </span>
                )}
              </div>
              <span className="hidden sm:inline font-bold text-xs tracking-wide">
                {formatPrice(totals.total, language)}
              </span>
            </button>
          </div>
        </div>

        {/* 3. Category Navigation Row (Desktop) */}
        <nav className="hidden md:flex items-center justify-center space-x-8 rtl:space-x-reverse py-2 border-t border-[#F0E3DF]">
          {categoriesList.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                data-testid={`nav-cat-${cat.id}`}
                onClick={() => {
                  if (onSelectCategory) onSelectCategory(cat.id);
                  if (currentView !== 'shop') onNavigate('shop');
                }}
                className={`text-sm font-semibold tracking-wide transition relative py-1 ${
                  isActive
                    ? 'text-[#8B263E]'
                    : 'text-[#503E48] hover:text-[#8B263E]'
                }`}
              >
                {t(cat.labelKey)}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8B263E] rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* 4. Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-[#FAF7F5] border-b border-[#E8D6D1] px-4 py-4 space-y-4 animate-in fade-in slide-in-from-top-2">
          {/* Mobile Search */}
          <div className="relative w-full">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery.trim()) {
                  setIsMobileMenuOpen(false);
                  onNavigate('shop', { search: searchQuery.trim() });
                }
              }}
              aria-label={t('nav.search')}
              placeholder={t('nav.searchPlaceholder')}
              className="w-full bg-white border border-[#E4D1CC] rounded-full py-2.5 px-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#D48374]"
            />
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3 rtl:left-auto rtl:right-3.5" />
          </div>

          {/* Categories */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            {categoriesList.map((cat) => (
              <button
                key={cat.id}
                data-testid={`mobile-cat-${cat.id}`}
                onClick={() => {
                  if (onSelectCategory) onSelectCategory(cat.id);
                  onNavigate('shop');
                  setIsMobileMenuOpen(false);
                }}
                className="py-2.5 px-3 rounded-xl bg-white border border-[#E8D6D1] text-xs font-bold text-[#3B2332] text-center hover:bg-[#F3E7E4] transition"
              >
                {t(cat.labelKey)}
              </button>
            ))}
          </div>
          <div className="pt-2 border-t border-[#E8D6D1] flex items-center justify-between">
            <button
              onClick={() => {
                setLanguage(language === 'en' ? 'ar' : 'en');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-2 text-xs font-bold text-[#3B2332]"
            >
              <Globe className="w-4 h-4" />
              <span>{language === 'en' ? 'العربية' : 'English'}</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => {
                  onNavigate('admin');
                  setIsMobileMenuOpen(false);
                }}
                className="text-xs font-bold text-[#8B263E] flex items-center gap-1"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{t('nav.admin')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
};
