export const brand = {
  yellow: '#FFC400',
  black: '#111111',
  white: '#FFFFFF',
  canvas: '#F7F7F5',
  border: '#E2E2DC',
  inkSoft: '#696965',
  success: '#168A52',
  error: '#D9342B',
  info: '#2563EB',
} as const;

export const platform = {
  currency: 'BHD',
  timezone: 'Asia/Bahrain',
  locales: ['en', 'ar'] as const,
} as const;

export function formatMoney(amount: string | number, locale: 'en' | 'ar' = 'en'): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-BH' : 'en-BH', {
    style: 'currency',
    currency: platform.currency,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

export function pickLocalized(
  value: { en?: string; ar?: string } | null | undefined,
  locale: 'en' | 'ar',
): string {
  if (!value) return '';
  return (locale === 'ar' ? value.ar : value.en) || value.en || value.ar || '';
}
