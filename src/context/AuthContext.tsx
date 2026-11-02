import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Language, User, UserAddress } from '../types';
import { useToast } from './ToastContext';
import { useLanguage } from './LanguageContext';
import { authApi } from '../api/api';
import { ApiError } from '../api/httpClient';

interface AuthResult {
  success: boolean;
  error?: string;
}

interface RegisterInput {
  email: string;
  fullName: string;
  mobileNumber?: string;
  password: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (data: RegisterInput) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUserAddresses: (addresses: UserAddress[]) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Server problem details are English; the storefront maps the known customer-facing ones to Arabic.
const AR_SERVER_MESSAGES: Record<string, string> = {
  'Invalid email or password': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  'An account with this email already exists': 'يوجد حساب مسجل بهذا البريد الإلكتروني بالفعل',
  'Please correct the highlighted fields': 'يرجى مراجعة الحقول المدخلة',
  'Password must be at least 8 characters': 'يجب ألا تقل كلمة المرور عن 8 أحرف',
  'Too many requests. Please wait a moment and try again.': 'محاولات كثيرة جداً. يرجى الانتظار لحظة ثم المحاولة مرة أخرى.',
};

function messageOf(error: unknown, language: Language): string {
  if (error instanceof ApiError) {
    const detail = error.fields ? Object.values(error.fields)[0]?.[0] || error.detail : error.detail;
    return language === 'ar' ? AR_SERVER_MESSAGES[detail] ?? AR_SERVER_MESSAGES[error.detail] ?? detail : detail;
  }
  if (language === 'ar') {
    return 'تعذر الاتصال بالخادم، حاولي مرة أخرى';
  }
  return error instanceof Error ? error.message : 'Network error';
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const { showToast } = useToast();
  const { language } = useLanguage();

  useEffect(() => {
    let cancelled = false;

    authApi
      .me()
      .then((profile) => {
        if (!cancelled) {
          setUser(profile);
        }
      })
      .catch((error) => {
        console.warn('Failed to restore session:', messageOf(error, 'en'));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const profile = await authApi.login(email, password);
      setUser(profile);
      showToast(language === 'ar' ? `أهلاً بعودتك، ${profile.fullName}!` : `Welcome back, ${profile.fullName}!`, 'success');
      return { success: true };
    } catch (error) {
      return { success: false, error: messageOf(error, language) };
    }
  };

  const register = async (data: RegisterInput): Promise<AuthResult> => {
    try {
      const profile = await authApi.register(data);
      setUser(profile);
      showToast(language === 'ar' ? 'أهلاً بك في لوما بيوتي!' : 'Welcome to Luma Beauty!', 'success');
      return { success: true };
    } catch (error) {
      return { success: false, error: messageOf(error, language) };
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch (error) {
      console.warn('Logout request failed:', messageOf(error, 'en'));
    } finally {
      setUser(null);
      showToast(language === 'ar' ? 'تم تسجيل الخروج' : 'Signed out successfully', 'info');
    }
  };

  const refreshUser = async (): Promise<void> => {
    const profile = await authApi.me();
    setUser(profile);
  };

  const updateUserAddresses = (addresses: UserAddress[]): void => {
    setUser((current) => (current ? { ...current, addresses } : current));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAdmin: user?.role === 'admin',
        login,
        register,
        logout,
        refreshUser,
        updateUserAddresses,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
