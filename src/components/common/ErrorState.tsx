import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface ErrorStateProps {
  onRetry: () => void;
  message?: string;
}

/** Shown instead of data whenever a required API read fails; never falls back to stored or sample data. */
export const ErrorState: React.FC<ErrorStateProps> = ({ onRetry, message }) => {
  const { t } = useLanguage();

  return (
    <div
      role="alert"
      data-testid="load-error"
      className="bg-white rounded-3xl border border-[#E8D6D1] p-10 text-center space-y-4 max-w-lg mx-auto"
    >
      <div className="w-14 h-14 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
        <AlertCircle className="w-7 h-7" />
      </div>
      <h3 className="font-serif text-xl font-bold text-[#2D1E2F]">{t('error.loadTitle')}</h3>
      <p className="text-xs text-[#8B6E7E]">{message || t('error.loadBody')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-6 py-2.5 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition shadow-xs inline-flex items-center gap-2"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>{t('error.retry')}</span>
      </button>
    </div>
  );
};
