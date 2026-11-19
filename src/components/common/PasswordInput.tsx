import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  required?: boolean;
}

// The field is always left-to-right, so the toggle is positioned physically: right in LTR, left in RTL.
export const PasswordInput: React.FC<PasswordInputProps> = ({
  id,
  value,
  onChange,
  autoComplete,
  placeholder = '••••••••',
  required,
}) => {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        dir="ltr"
        autoComplete={autoComplete}
        aria-required={required ? 'true' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-[#8B263E] rtl:text-right pr-10 rtl:pr-2.5 rtl:pl-10"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? t('account.hidePassword') : t('account.showPassword')}
        aria-controls={id}
        data-testid={`${id}-toggle`}
        className="absolute inset-y-0 right-0 rtl:right-auto rtl:left-0 flex items-center px-3 rounded-xl text-[#8B6E7E] hover:text-[#3B2332] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B263E]"
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};
