import React from 'react';
import { Home, Sparkles, Heart, ShoppingBag, User } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { useWishlist } from '../../context/WishlistContext';

interface MobileBottomNavProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ currentView, onNavigate }) => {
  const { t } = useLanguage();
  const { itemCount, setIsDrawerOpen } = useCart();
  const { wishlistIds } = useWishlist();

  const navItems = [
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'shop', label: t('nav.shop'), icon: Sparkles },
    { id: 'wishlist', label: t('nav.wishlist'), icon: Heart, badge: wishlistIds.length },
    { id: 'cart', label: t('nav.cart'), icon: ShoppingBag, badge: itemCount, action: () => setIsDrawerOpen(true) },
    { id: 'account', label: t('nav.account'), icon: User },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#FAF7F5]/95 backdrop-blur-md border-t border-[#E8D6D1] px-2 py-1 shadow-lg">
      <div className="grid grid-cols-5 items-center">
        {navItems.map((item) => {
          const isActive = currentView === item.id;
          const Icon = item.icon;

          return (
            <button
              key={item.id}
              data-testid={`mobile-nav-${item.id}`}
              onClick={() => {
                if (item.action) {
                  item.action();
                } else {
                  onNavigate(item.id);
                }
              }}
              className={`flex flex-col items-center justify-center py-1.5 px-1 relative transition ${
                isActive ? 'text-[#8B263E]' : 'text-[#8B6E7E] hover:text-[#3B2332]'
              }`}
              aria-label={item.label}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition ${isActive ? 'scale-110 stroke-[2.5]' : 'stroke-[1.75]'}`} />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-[#E8998D] text-[#2D1E2F] font-bold rounded-full w-4 h-4 text-[9px] flex items-center justify-center shadow-xs">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-1 font-semibold truncate ${isActive ? 'text-[#8B263E]' : ''}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
