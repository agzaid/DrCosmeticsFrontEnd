export interface Governorate {
  id: string;
  name: { en: string; ar: string };
  shippingDays: string;
}

export const EGYPT_GOVERNORATES: Governorate[] = [
  { id: 'cairo', name: { en: 'Cairo', ar: 'القاهرة' }, shippingDays: '1-2 days' },
  { id: 'giza', name: { en: 'Giza', ar: 'الجيزة' }, shippingDays: '1-2 days' },
  { id: 'alexandria', name: { en: 'Alexandria', ar: 'الإسكندرية' }, shippingDays: '2-3 days' },
  { id: 'qalyubia', name: { en: 'Qalyubia', ar: 'القليوبية' }, shippingDays: '2-3 days' },
  { id: 'dakahlia', name: { en: 'Dakahlia (Mansoura)', ar: 'الدقهلية (المنصورة)' }, shippingDays: '2-3 days' },
  { id: 'gharbia', name: { en: 'Gharbia (Tanta)', ar: 'الغربية (طنطا)' }, shippingDays: '2-3 days' },
  { id: 'sharqia', name: { en: 'Sharqia (Zagazig)', ar: 'الشرقية (الزقازيق)' }, shippingDays: '2-3 days' },
  { id: 'monufia', name: { en: 'Monufia', ar: 'المنوفية' }, shippingDays: '2-3 days' },
  { id: 'beheira', name: { en: 'Beheira', ar: 'البحيرة' }, shippingDays: '2-4 days' },
  { id: 'kafr-el-sheikh', name: { en: 'Kafr El Sheikh', ar: 'كفر الشيخ' }, shippingDays: '2-4 days' },
  { id: 'damietta', name: { en: 'Damietta', ar: 'دمياط' }, shippingDays: '2-4 days' },
  { id: 'port-said', name: { en: 'Port Said', ar: 'بورسعيد' }, shippingDays: '2-3 days' },
  { id: 'ismailia', name: { en: 'Ismailia', ar: 'الإسماعيلية' }, shippingDays: '2-3 days' },
  { id: 'suez', name: { en: 'Suez', ar: 'السويس' }, shippingDays: '2-3 days' },
  { id: 'fayoum', name: { en: 'Fayoum', ar: 'الفيوم' }, shippingDays: '2-4 days' },
  { id: 'beni-suef', name: { en: 'Beni Suef', ar: 'بني سويف' }, shippingDays: '2-4 days' },
  { id: 'minya', name: { en: 'Minya', ar: 'المنيا' }, shippingDays: '3-4 days' },
  { id: 'assiut', name: { en: 'Assiut', ar: 'أسيوط' }, shippingDays: '3-5 days' },
  { id: 'sohag', name: { en: 'Sohag', ar: 'سوهاج' }, shippingDays: '3-5 days' },
  { id: 'qena', name: { en: 'Qena', ar: 'قنا' }, shippingDays: '3-5 days' },
  { id: 'luxor', name: { en: 'Luxor', ar: 'الأقصر' }, shippingDays: '3-5 days' },
  { id: 'aswan', name: { en: 'Aswan', ar: 'أسوان' }, shippingDays: '3-5 days' },
  { id: 'red-sea', name: { en: 'Red Sea (Hurghada / Gouna)', ar: 'البحر الأحمر (الغردقة / الجونة)' }, shippingDays: '3-5 days' },
  { id: 'south-sinai', name: { en: 'South Sinai (Sharm El Sheikh)', ar: 'جنوب سيناء (شرم الشيخ)' }, shippingDays: '3-5 days' },
];

/** Shipping-time labels are stored in English ("1-2 days"); the Arabic UI shows the same range in Arabic. */
export function formatShippingDays(days: string, language: 'en' | 'ar'): string {
  return language === 'ar' ? days.replace('days', 'أيام') : days;
}
