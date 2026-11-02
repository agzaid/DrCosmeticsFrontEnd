import React, { useState, useEffect } from 'react';
import { 
  User as UserIcon, 
  Package, 
  MapPin, 
  LogOut, 
  Plus, 
  Trash2, 
  ShieldCheck, 
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import type { Order, UserAddress } from '../types';
import { customerApi } from '../api/api';
import { ApiError } from '../api/httpClient';
import { mediaUrl } from '../api/config';
import { ADDRESS_ERROR_MESSAGES, formatPrice, validateShippingAddress } from '../utils/shopLogic';
import { EGYPT_GOVERNORATES } from '../utils/egyptGovernorates';
import { ErrorState } from '../components/common/ErrorState';
import { useDialogBehavior } from '../components/common/useDialogBehavior';

interface AccountPageProps {
  onNavigateToShop: () => void;
  onNavigateToAdmin: () => void;
}

const ORDERS_PAGE_SIZE = 10;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

interface AddressModalProps {
  onClose: () => void;
  onSaved: (addresses: UserAddress[]) => void;
}

// The modal owns its form state and is mounted only while open, so a previous account's name or phone can never
// be carried into the next account's form.
const AddressModal: React.FC<AddressModalProps> = ({ onClose, onSaved }) => {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { showToast } = useToast();
  const dialogRef = useDialogBehavior(onClose);

  const [form, setForm] = useState({
    label: t('account.defaultLabel'),
    fullName: user?.fullName || '',
    mobileNumber: user?.mobileNumber || '',
    governorate: 'Cairo',
    city: '',
    streetAddress: '',
    buildingApt: '',
    deliveryNotes: '',
    isDefault: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const localizeError = (field: string, message: string): string =>
    language === 'ar' && ADDRESS_ERROR_MESSAGES[field] === message ? t(`checkout.error.${field}`) : message;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const validation = validateShippingAddress(form);
    if (!validation.isValid || !form.label.trim()) {
      setErrors(form.label.trim() ? validation.errors : { ...validation.errors, label: t('account.labelRequired') });
      return;
    }

    setSaving(true);
    try {
      const addresses = await customerApi.addAddress(form);
      showToast(t('account.addressSaved'), 'success');
      onSaved(addresses);
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        const fieldErrors: Record<string, string> = {};
        Object.entries(error.fields).forEach(([key, messages]) => {
          if (messages[0]) {
            fieldErrors[key.replace(/^address\./, '')] = messages[0];
          }
        });
        setErrors(fieldErrors);
      }
      showToast(t('account.addressSaveFailed'), 'error');
      setSaving(false);
    }
  };

  const setField = (field: keyof typeof form, value: string | boolean) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  };

  const inputClass = (field: string, extra = ''): string =>
    `w-full bg-[#FAF7F5] border rounded-xl p-2.5 ${extra} ${errors[field] ? 'border-rose-500' : 'border-[#E8D6D1]'}`;

  const fieldError = (field: string) =>
    errors[field] ? (
      <p id={`address-${field}-error`} role="alert" className="text-[11px] text-rose-600 mt-1">
        {localizeError(field, errors[field])}
      </p>
    ) : null;

  return (
    <div
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="address-modal-title"
        data-testid="address-modal"
        tabIndex={-1}
        className="bg-white rounded-3xl border border-[#E8D6D1] p-6 max-w-md w-full shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto focus:outline-none"
      >
        <h3 id="address-modal-title" className="font-bold text-sm text-[#2D1E2F]">{t('account.addressModalTitle')}</h3>
        
        <form onSubmit={handleSubmit} noValidate className="space-y-3 text-xs">
          <div>
            <label htmlFor="address-label" className="block font-semibold mb-1">{t('account.label')}</label>
            <input
              id="address-label"
              type="text"
              value={form.label}
              onChange={(e) => setField('label', e.target.value)}
              placeholder={t('account.labelPlaceholder')}
              aria-invalid={Boolean(errors.label)}
              aria-describedby={errors.label ? 'address-label-error' : undefined}
              className={inputClass('label')}
            />
            {fieldError('label')}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="address-fullName" className="block font-semibold mb-1">{t('checkout.fullName')}</label>
              <input
                id="address-fullName"
                type="text"
                autoComplete="name"
                value={form.fullName}
                onChange={(e) => setField('fullName', e.target.value)}
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={errors.fullName ? 'address-fullName-error' : undefined}
                className={inputClass('fullName')}
              />
              {fieldError('fullName')}
            </div>
            <div>
              <label htmlFor="address-mobileNumber" className="block font-semibold mb-1">{t('checkout.mobileNumber')}</label>
              <input
                id="address-mobileNumber"
                type="tel"
                dir="ltr"
                autoComplete="tel"
                value={form.mobileNumber}
                onChange={(e) => setField('mobileNumber', e.target.value)}
                placeholder="01012345678"
                aria-invalid={Boolean(errors.mobileNumber)}
                aria-describedby={errors.mobileNumber ? 'address-mobileNumber-error' : undefined}
                className={inputClass('mobileNumber', 'font-mono rtl:text-right')}
              />
              {fieldError('mobileNumber')}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="address-governorate" className="block font-semibold mb-1">{t('checkout.governorate')}</label>
              <select
                id="address-governorate"
                value={form.governorate}
                onChange={(e) => setField('governorate', e.target.value)}
                className={inputClass('governorate')}
              >
                {EGYPT_GOVERNORATES.map((gov) => (
                  <option key={gov.id} value={gov.name.en}>
                    {language === 'ar' ? gov.name.ar : gov.name.en}
                  </option>
                ))}
              </select>
              {fieldError('governorate')}
            </div>
            <div>
              <label htmlFor="address-city" className="block font-semibold mb-1">{t('checkout.city')}</label>
              <input
                id="address-city"
                type="text"
                value={form.city}
                onChange={(e) => setField('city', e.target.value)}
                aria-invalid={Boolean(errors.city)}
                aria-describedby={errors.city ? 'address-city-error' : undefined}
                className={inputClass('city')}
              />
              {fieldError('city')}
            </div>
          </div>

          <div>
            <label htmlFor="address-streetAddress" className="block font-semibold mb-1">{t('checkout.streetAddress')}</label>
            <input
              id="address-streetAddress"
              type="text"
              autoComplete="street-address"
              value={form.streetAddress}
              onChange={(e) => setField('streetAddress', e.target.value)}
              aria-invalid={Boolean(errors.streetAddress)}
              aria-describedby={errors.streetAddress ? 'address-streetAddress-error' : undefined}
              className={inputClass('streetAddress')}
            />
            {fieldError('streetAddress')}
          </div>

          <label htmlFor="address-isDefault" className="flex items-center gap-2 font-semibold cursor-pointer">
            <input
              id="address-isDefault"
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => setField('isDefault', e.target.checked)}
              className="accent-[#8B263E]"
            />
            <span>{t('account.setDefault')}</span>
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-[#E8D6D1] rounded-xl font-bold text-[#503E48]"
            >
              {t('account.cancel')}
            </button>
            <button
              type="submit"
              data-testid="address-save"
              disabled={saving}
              className="flex-1 py-2.5 bg-[#3B2332] text-white rounded-xl font-bold disabled:opacity-50"
            >
              {t('account.saveAddress')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const AccountPage: React.FC<AccountPageProps> = ({
  onNavigateToShop,
  onNavigateToAdmin,
}) => {
  const { user, login, register, logout, isAdmin, updateUserAddresses } = useAuth();
  const { t, l, language } = useLanguage();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'orders' | 'addresses'>('orders');
  
  // Auth Form State (when not logged in)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  // Customer orders state
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [ordersReload, setOrdersReload] = useState(0);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);

  // Credentials typed by one person must never survive into the next sign-in: whenever the account changes
  // (sign-in or sign-out) the form returns to a blank sign-in.
  useEffect(() => {
    setAuthMode('login');
    setEmail('');
    setPassword('');
    setFullName('');
    setMobileNumber('');
    setAuthError('');
  }, [user?.id]);

  // Fetch orders when a user signs in; everything per-user is dropped as soon as the account changes.
  useEffect(() => {
    setOrders([]);
    setExpandedOrderId(null);
    setOrdersPage(1);
    setOrdersTotalPages(1);
    setOrdersError(false);
    setActiveTab('orders');
    setIsAddressModalOpen(false);

    if (!user) {
      return;
    }

    let cancelled = false;
    setOrdersLoading(true);
    customerApi
      .orders(1, ORDERS_PAGE_SIZE)
      .then((page) => {
        if (!cancelled) {
          setOrders(page.orders);
          setOrdersTotalPages(page.totalPages);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Failed to load customer orders:', err);
          setOrdersError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOrdersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, ordersReload]);

  const loadMoreOrders = async (): Promise<void> => {
    const nextPage = ordersPage + 1;
    setOrdersLoading(true);
    try {
      const page = await customerApi.orders(nextPage, ORDERS_PAGE_SIZE);
      setOrders((previous) => [...previous, ...page.orders.filter((entry) => !previous.some((known) => known.id === entry.id))]);
      setOrdersPage(nextPage);
      setOrdersTotalPages(page.totalPages);
    } catch (err) {
      console.warn('Failed to load more orders:', err);
      showToast(t('error.loadBody'), 'error');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!EMAIL_PATTERN.test(email.trim())) {
      setAuthError(t('account.error.email'));
      return;
    }
    if (!password) {
      setAuthError(t('account.error.passwordRequired'));
      return;
    }
    if (authMode === 'register') {
      if (fullName.trim().length < 2) {
        setAuthError(t('account.error.name'));
        return;
      }
      if (password.length < 8) {
        setAuthError(t('account.error.passwordShort'));
        return;
      }
    }

    setAuthLoading(true);
    if (authMode === 'login') {
      const res = await login(email.trim(), password);
      if (!res.success) {
        setAuthError(res.error || t('account.error.loginFailed'));
      }
    } else {
      const res = await register({ email: email.trim(), fullName: fullName.trim(), mobileNumber: mobileNumber.trim() || undefined, password });
      if (!res.success) {
        setAuthError(res.error || t('account.error.registerFailed'));
      }
    }
    setAuthLoading(false);
  };

  const handleCancelOrder = async (order: Order): Promise<void> => {
    if (!window.confirm(t('account.cancelConfirm'))) {
      return;
    }

    setCancellingOrderId(order.id);
    try {
      const updated = await customerApi.cancelOrder(order.id);
      setOrders((previous) => previous.map((entry) => (entry.id === updated.id ? updated : entry)));
      showToast(t('account.cancelled'), 'info');
    } catch (error) {
      showToast(error instanceof ApiError && language !== 'ar' ? error.detail : t('account.cancelFailed'), 'error');
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleDeleteAddress = async (addrId: string) => {
    if (!user) return;
    try {
      const addresses = await customerApi.deleteAddress(addrId);
      updateUserAddresses(addresses);
      showToast(t('account.addressRemoved'), 'info');
    } catch {
      showToast(t('account.addressRemoveFailed'), 'error');
    }
  };

  const dateLocale = language === 'ar' ? 'ar-EG' : 'en-US';

  // If not logged in, render Login / Register view
  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 sm:p-8 shadow-sm space-y-6">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 rounded-full bg-[#FAF3F1] text-[#8B263E] flex items-center justify-center mx-auto">
              <UserIcon className="w-6 h-6" />
            </div>
            <h1 className="font-serif text-2xl font-bold text-[#2D1E2F]">
              {authMode === 'login' ? t('account.signIn') : t('account.register')}
            </h1>
            <p className="text-xs text-[#8B6E7E]">
              {t('account.subtitle')}
            </p>
          </div>

          {/* Tab Switcher */}
          <div role="tablist" className="flex bg-[#FAF7F5] p-1 rounded-xl border border-[#E8D6D1]">
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'login'}
              data-testid="auth-tab-login"
              onClick={() => {
                setAuthMode('login');
                setAuthError('');
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                authMode === 'login' ? 'bg-white text-[#2D1E2F] shadow-xs' : 'text-[#8B6E7E]'
              }`}
            >
              {t('account.signIn')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'register'}
              data-testid="auth-tab-register"
              onClick={() => {
                setAuthMode('register');
                setAuthError('');
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                authMode === 'register' ? 'bg-white text-[#2D1E2F] shadow-xs' : 'text-[#8B6E7E]'
              }`}
            >
              {t('account.register')}
            </button>
          </div>

          {authError && (
            <div role="alert" data-testid="auth-error" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              {authError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleAuthSubmit} noValidate data-testid="auth-form" className="space-y-4 text-xs">
            {authMode === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-fullName" className="block font-bold text-[#503E48] mb-1">
                    {t('checkout.fullName')} *
                  </label>
                  <input
                    id="auth-fullName"
                    type="text"
                    autoComplete="name"
                    aria-required="true"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t('checkout.ph.fullName')}
                    className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-[#8B263E]"
                  />
                </div>

                <div>
                  <label htmlFor="auth-mobile" className="block font-bold text-[#503E48] mb-1">
                    {t('checkout.mobileNumber')}
                  </label>
                  <input
                    id="auth-mobile"
                    type="tel"
                    dir="ltr"
                    autoComplete="tel"
                    value={mobileNumber}
                    onChange={(e) => setMobileNumber(e.target.value)}
                    placeholder="01012345678"
                    className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-[#8B263E] rtl:text-right"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block font-bold text-[#503E48] mb-1">
                {t('account.email')} *
              </label>
              <input
                id="auth-email"
                type="email"
                dir="ltr"
                autoComplete="email"
                aria-required="true"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-[#8B263E] rtl:text-right"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block font-bold text-[#503E48] mb-1">
                {t('account.password')} *
              </label>
              <input
                id="auth-password"
                type="password"
                dir="ltr"
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                aria-required="true"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#FAF7F5] border border-[#E8D6D1] rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-[#8B263E] rtl:text-right"
              />
            </div>

            <button
              type="submit"
              data-testid="auth-submit"
              disabled={authLoading}
              className="w-full py-3 bg-[#3B2332] hover:bg-[#523347] disabled:opacity-50 text-white rounded-xl font-bold transition shadow-xs"
            >
              {authLoading ? '...' : authMode === 'login' ? t('account.signIn') : t('account.register')}
            </button>
          </form>

        </div>
      </div>
    );
  }

  // Signed In Customer Dashboard View
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Profile Header */}
      <div className="bg-white rounded-3xl border border-[#E8D6D1] p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#3B2332] to-[#603951] text-[#FAF7F5] flex items-center justify-center font-serif text-2xl font-bold shadow-xs">
            {user.fullName.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 data-testid="account-name" className="font-serif text-2xl font-bold text-[#2D1E2F]">
                {user.fullName}
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#F3D8D3] text-[#3B2332]">
                {user.role === 'admin' ? t('role.admin') : t('role.customer')}
              </span>
            </div>
            <p className="text-xs text-[#8B6E7E] flex items-center gap-2 mt-0.5">
              <span data-testid="account-email" dir="ltr">{user.email}</span>
              {user.mobileNumber && <span dir="ltr">• {user.mobileNumber}</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {isAdmin && (
            <button
              onClick={onNavigateToAdmin}
              className="flex-1 sm:flex-none px-4 py-2 bg-[#8B263E] text-white rounded-xl text-xs font-bold hover:bg-[#721f32] transition flex items-center justify-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t('admin.title')}</span>
            </button>
          )}

          <button
            onClick={logout}
            data-testid="account-logout"
            className="flex-1 sm:flex-none px-4 py-2 border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('account.logout')}</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex border-b border-[#E8D6D1] space-x-6 rtl:space-x-reverse text-sm font-bold">
        <button
          role="tab"
          aria-selected={activeTab === 'orders'}
          data-testid="tab-orders"
          onClick={() => setActiveTab('orders')}
          className={`pb-3 transition relative flex items-center gap-2 ${
            activeTab === 'orders' ? 'text-[#8B263E]' : 'text-[#8B6E7E] hover:text-[#2D1E2F]'
          }`}
        >
          <Package className="w-4 h-4" />
          <span>{t('account.orders')}</span>
          <span className="text-xs bg-[#F3D8D3] text-[#3B2332] px-2 py-0.5 rounded-full">
            {orders.length}
          </span>
          {activeTab === 'orders' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8B263E] rounded-full" />
          )}
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'addresses'}
          data-testid="tab-addresses"
          onClick={() => setActiveTab('addresses')}
          className={`pb-3 transition relative flex items-center gap-2 ${
            activeTab === 'addresses' ? 'text-[#8B263E]' : 'text-[#8B6E7E] hover:text-[#2D1E2F]'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>{t('account.savedAddresses')}</span>
          <span className="text-xs bg-[#F3D8D3] text-[#3B2332] px-2 py-0.5 rounded-full">
            {user.addresses?.length || 0}
          </span>
          {activeTab === 'addresses' && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#8B263E] rounded-full" />
          )}
        </button>
      </div>

      {/* 1. ORDERS TAB */}
      {activeTab === 'orders' && (
        <div role="tabpanel" className="space-y-4">
          {ordersError ? (
            <ErrorState onRetry={() => setOrdersReload((current) => current + 1)} />
          ) : ordersLoading && orders.length === 0 ? (
            <div role="status" className="p-12 text-center text-xs text-[#8B6E7E]">{t('account.loadingOrders')}</div>
          ) : orders.length > 0 ? (
            <>
            {orders.map((order) => {
              const isExpanded = expandedOrderId === order.id;

              return (
                <div
                  key={order.id}
                  data-testid={`order-${order.id}`}
                  className="bg-white rounded-2xl border border-[#E8D6D1] overflow-hidden shadow-xs"
                >
                  {/* Order Card Header */}
                  <button
                    type="button"
                    onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    aria-expanded={isExpanded}
                    className="w-full text-left rtl:text-right p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-[#FAF7F5] transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#FAF3F1] text-[#8B263E] flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[#2D1E2F]">
                            {order.orderNumber}
                          </span>
                          <span
                            data-testid={`order-status-${order.id}`}
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              order.status === 'Delivered'
                                ? 'bg-emerald-100 text-emerald-800'
                                : order.status === 'Cancelled'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {t(`order.status.${order.status}`)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8B6E7E] mt-0.5">
                          {t('account.placedOn').replace('{date}', new Date(order.createdAt).toLocaleDateString(dateLocale))} •{' '}
                          {t('account.itemsCount').replace('{count}', String(order.items.length))}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-4">
                      <span className="font-serif text-base font-bold text-[#8B263E]">
                        {formatPrice(order.total, language)}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-stone-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-stone-400 rtl:rotate-180" />
                      )}
                    </div>
                  </button>

                  {/* Expanded Order Details */}
                  {isExpanded && (
                    <div className="p-4 sm:p-5 border-t border-[#F0E3DF] bg-[#FAF7F5]/50 space-y-4">
                      {/* Items */}
                      <div className="divide-y divide-[#E8D6D1]">
                        {order.items.map((it) => (
                          <div key={it.id} className="py-2.5 first:pt-0 flex items-center gap-3">
                            <img
                              src={mediaUrl(it.image)}
                              alt={l(it.productName)}
                              className="w-12 h-12 object-cover rounded-lg border border-[#E8D6D1] shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-[#2D1E2F] truncate">
                                {l(it.productName)}
                              </p>
                              <div className="flex items-center gap-2 text-[11px] text-[#8B6E7E]">
                                {it.shadeName && <span>{l(it.shadeName)}</span>}
                                {it.size && <span>• {it.size}</span>}
                                <span>• {t('checkout.qty')}: {it.quantity}</span>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-[#2D1E2F]">
                              {formatPrice(it.unitPrice * it.quantity, language)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Delivery Address Review */}
                      <div className="pt-2 border-t border-[#E8D6D1] flex flex-col sm:flex-row justify-between text-xs text-[#503E48] gap-3">
                        <div>
                          <p className="font-bold text-[#2D1E2F]">{t('account.deliveryDestination')}:</p>
                          <p>{order.shippingAddress.fullName} (<span dir="ltr">{order.shippingAddress.mobileNumber}</span>)</p>
                          <p>{order.shippingAddress.streetAddress}, {order.shippingAddress.city}, {order.shippingAddress.governorate}</p>
                        </div>
                        <div className="text-right rtl:text-left space-y-1">
                          <p>{t('account.payment')}: <strong className="text-[#2D1E2F]">{t('checkout.codTitle')}</strong></p>
                          <p>
                            {t('account.paymentStatus')}:{' '}
                            <strong data-testid={`order-payment-${order.id}`} className="text-[#2D1E2F]">
                              {t(`order.payment.${order.paymentStatus === 'Collected' ? 'Collected' : 'Unpaid'}`)}
                            </strong>
                          </p>
                          <p>{t('cart.deliveryFee')}: {order.deliveryFee === 0 ? t('shipping.free') : formatPrice(order.deliveryFee, language)}</p>
                          <p className="font-bold text-sm text-[#8B263E]">{t('cart.total')}: {formatPrice(order.total, language)}</p>
                        </div>
                      </div>

                      {(order.status === 'Pending' || order.status === 'Confirmed') &&
                        order.paymentStatus !== 'Collected' && (
                          <div className="pt-3 border-t border-[#E8D6D1] flex justify-end">
                            <button
                              type="button"
                              data-testid={`cancel-order-${order.id}`}
                              onClick={() => void handleCancelOrder(order)}
                              disabled={cancellingOrderId === order.id}
                              className="px-4 py-2 rounded-xl border border-rose-300 bg-rose-50 text-rose-700 text-[11px] font-bold hover:bg-rose-100 disabled:opacity-50 transition"
                            >
                              {cancellingOrderId === order.id ? '...' : t('account.cancelOrder')}
                            </button>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
            {ordersPage < ordersTotalPages && (
              <div className="flex justify-center">
                <button
                  type="button"
                  data-testid="orders-load-more"
                  onClick={() => void loadMoreOrders()}
                  disabled={ordersLoading}
                  className="px-6 py-2.5 border border-[#E8D6D1] bg-white rounded-full text-xs font-bold text-[#3B2332] hover:bg-[#F3E7E4] disabled:opacity-50 transition"
                >
                  {t('account.loadMore')}
                </button>
              </div>
            )}
            </>
          ) : (
            <div data-testid="orders-empty" className="bg-white rounded-3xl border border-[#E8D6D1] p-10 text-center space-y-3">
              <Package className="w-10 h-10 text-[#8B6E7E] mx-auto" />
              <h4 className="font-bold text-sm text-[#2D1E2F]">{t('account.noOrders')}</h4>
              <button
                onClick={onNavigateToShop}
                className="px-5 py-2 bg-[#3B2332] text-white rounded-full text-xs font-bold hover:bg-[#523347] transition"
              >
                {t('cart.continueShopping')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 2. ADDRESSES TAB */}
      {activeTab === 'addresses' && (
        <div role="tabpanel" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm text-[#2D1E2F]">{t('account.savedAddresses')}</h3>
            <button
              data-testid="add-address-btn"
              onClick={() => setIsAddressModalOpen(true)}
              className="px-4 py-2 bg-[#3B2332] hover:bg-[#523347] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('account.addAddress')}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {user.addresses && user.addresses.length > 0 ? (
              user.addresses.map((addr) => (
                <div
                  key={addr.id}
                  data-testid={`address-${addr.id}`}
                  className="bg-white rounded-2xl border border-[#E8D6D1] p-4 flex flex-col justify-between space-y-3 relative group"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-[#2D1E2F]">{addr.label || t('account.defaultLabel')}</span>
                      {addr.isDefault && (
                        <span data-testid={`address-default-${addr.id}`} className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                          {t('account.defaultBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-[#503E48] mt-2">{addr.fullName}</p>
                    <p className="text-xs font-mono text-[#8B6E7E]" dir="ltr">{addr.mobileNumber}</p>
                    <p className="text-xs text-[#503E48] mt-1">{addr.streetAddress}</p>
                    {addr.buildingApt && <p className="text-xs text-[#8B6E7E]">{addr.buildingApt}</p>}
                    <p className="text-xs text-[#8B6E7E]">{addr.city}, {addr.governorate}</p>
                  </div>

                  <div className="pt-2 border-t border-[#F0E3DF] flex justify-end">
                    <button
                      data-testid={`delete-address-${addr.id}`}
                      onClick={() => handleDeleteAddress(addr.id)}
                      className="text-xs text-rose-600 hover:text-rose-800 p-1 flex items-center gap-1 font-semibold"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t('account.delete')}</span>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div data-testid="addresses-empty" className="col-span-full bg-white rounded-2xl border border-[#E8D6D1] p-8 text-center text-xs text-[#8B6E7E]">
                {t('account.noAddresses')}
              </div>
            )}
          </div>
        </div>
      )}

      {isAddressModalOpen && (
        <AddressModal
          onClose={() => setIsAddressModalOpen(false)}
          onSaved={(addresses) => {
            updateUserAddresses(addresses);
            setIsAddressModalOpen(false);
          }}
        />
      )}

    </div>
  );
};
