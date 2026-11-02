import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface AdminModalProps {
  title: string;
  closeLabel: string;
  onClose: () => void;
  widthClass: string;
  children: React.ReactNode;
}

/**
 * Accessible modal shell for admin forms: dialog semantics, Escape closes, Tab is trapped inside the
 * panel, focus moves to the first field on open and returns to the opener on close.
 */
export const AdminModal: React.FC<AdminModalProps> = ({ title, closeLabel, onClose, widthClass, children }) => {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>('form input:not([type="hidden"]), form select, form textarea');
    (firstField ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`bg-white rounded-3xl border border-[#E8D6D1] p-6 sm:p-8 ${widthClass} w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto focus:outline-none`}
      >
        <div className="flex justify-between items-center pb-3 border-b border-[#E8D6D1]">
          <h3 id={titleId} className="font-serif text-xl font-bold text-[#2D1E2F]">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
            className="p-1 rounded-lg hover:bg-[#F3E7E4]"
          >
            <X className="w-5 h-5 text-stone-500" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
