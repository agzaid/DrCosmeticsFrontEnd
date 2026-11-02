import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useLanguage } from './LanguageContext';

export type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { t } = useLanguage();

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast Render Container: on the side opposite the cart drawer (which opens at the inline-end), and
          click-through on small screens, so a toast never covers a drawer or modal action button. */}
      <div className="fixed bottom-20 md:bottom-6 inset-x-4 md:inset-x-auto md:start-4 md:w-96 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-none md:pointer-events-auto flex items-center justify-between p-3.5 rounded-xl shadow-lg border text-sm transition-all duration-300 animate-in fade-in slide-in-from-bottom-2 ${
              toast.type === 'success'
                ? 'bg-[#FAF7F5] border-[#D4A29C] text-[#2D1E2F]'
                : toast.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-stone-50 border-stone-200 text-stone-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#C47D76] shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
              {toast.type === 'info' && <Info className="w-4 h-4 text-stone-600 shrink-0" />}
              <span className="font-medium text-xs md:text-sm">{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="p-1 text-stone-400 hover:text-stone-700 transition"
              aria-label={t('toast.close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
