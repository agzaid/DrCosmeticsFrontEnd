import React from 'react';
import { Sparkles, Shield, Truck, RotateCcw, Heart } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';

export const Footer: React.FC<{ onNavigate: (view: string) => void }> = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { isAdmin } = useAuth();

  return (
    <footer className="bg-[#2D1E2F] text-[#F9EBE7] pt-14 pb-24 md:pb-12 border-t border-[#463143]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Value Propositions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pb-12 border-b border-[#4A3245] text-center md:text-left rtl:md:text-right">
          <div className="flex flex-col items-center md:items-start rtl:md:items-start space-y-2">
            <div className="w-10 h-10 rounded-full bg-[#4A3245] flex items-center justify-center text-[#E8998D]">
              <Truck className="w-5 h-5" />
            </div>
            <h4 className="font-bold text-sm text-white">{t('footer.deliveryTitle')}</h4>
            <p className="text-xs text-[#C7B5BD]">{t('footer.deliveryBody')}</p>
          </div>

          <div className="flex flex-col items-center md:items-start rtl:md:items-start space-y-2">
            <div className="w-10 h-10 rounded-full bg-[#4A3245] flex items-center justify-center text-[#E8998D]">
              <Shield className="w-5 h-5" />
            </div>
            <h4 className="font-bold text-sm text-white">{t('footer.authenticTitle')}</h4>
            <p className="text-xs text-[#C7B5BD]">{t('footer.authenticBody')}</p>
          </div>

          <div className="flex flex-col items-center md:items-start rtl:md:items-start space-y-2">
            <div className="w-10 h-10 rounded-full bg-[#4A3245] flex items-center justify-center text-[#E8998D]">
              <RotateCcw className="w-5 h-5" />
            </div>
            <h4 className="font-bold text-sm text-white">{t('footer.codTitle')}</h4>
            <p className="text-xs text-[#C7B5BD]">{t('footer.codBody')}</p>
          </div>

          <div className="flex flex-col items-center md:items-start rtl:md:items-start space-y-2">
            <div className="w-10 h-10 rounded-full bg-[#4A3245] flex items-center justify-center text-[#E8998D]">
              <Sparkles className="w-5 h-5" />
            </div>
            <h4 className="font-bold text-sm text-white">{t('footer.samplesTitle')}</h4>
            <p className="text-xs text-[#C7B5BD]">{t('footer.samplesBody')}</p>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 py-10">
          {/* Brand Story */}
          <div className="md:col-span-7 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#E8998D] text-[#2D1E2F] flex items-center justify-center font-serif font-bold text-lg">
                L
              </div>
              <span className="font-serif text-2xl font-bold tracking-tight text-white">
                {t('brand.name')}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#C7B5BD] max-w-sm">
              {t('footer.story')}
            </p>
            <div className="pt-2 text-xs text-[#C7B5BD] flex items-center gap-1.5">
              <span>{t('footer.madeWith')}</span>
              <Heart className="w-3.5 h-3.5 text-[#E8998D] fill-[#E8998D]" />
              <span>{t('footer.forLovers')}</span>
            </div>
          </div>

          {/* Quick Links */}
          <div className="md:col-span-5 space-y-3">
            <h5 className="font-bold text-sm text-white uppercase tracking-wider">{t('footer.quickNav')}</h5>
            <ul className="space-y-2 text-xs text-[#C7B5BD]">
              <li>
                <button onClick={() => onNavigate('shop')} className="hover:text-white transition">
                  {t('nav.shop')}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('wishlist')} className="hover:text-white transition">
                  {t('nav.wishlist')}
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('account')} className="hover:text-white transition">
                  {t('account.orders')}
                </button>
              </li>
              {isAdmin && (
                <li>
                  <button onClick={() => onNavigate('admin')} className="hover:text-[#E8998D] transition flex items-center gap-1">
                    <span>{t('admin.title')}</span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="pt-8 border-t border-[#4A3245] flex flex-col sm:flex-row items-center justify-between text-[11px] text-[#A6939C] gap-3">
          <p>© {new Date().getFullYear()} {t('footer.rights')}</p>
          <div className="flex items-center gap-4">
            <span>{t('footer.codTitle')}</span>
            <span>•</span>
            <span>{t('footer.city')}</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
