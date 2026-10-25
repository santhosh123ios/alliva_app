export const routing = {
  locales: ['en', 'ar'],
  defaultLocale: 'en',
} as const;

export type Locale = (typeof routing.locales)[number];

const localeCookie = 'NEXT_LOCALE';

export function hasLocale(value: unknown): value is Locale {
  return routing.locales.includes(value as Locale);
}

export function preferredLocale(): Locale {
  const saved = document.cookie.match(new RegExp(`(?:^|; )${localeCookie}=([^;]+)`))?.[1];
  if (hasLocale(saved)) return saved;
  const browser = navigator.languages.map((language) => language.slice(0, 2).toLowerCase()).find(hasLocale);
  return browser ?? routing.defaultLocale;
}

export function rememberLocale(locale: Locale) {
  document.cookie = `${localeCookie}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

export function localizeHref(href: string, locale: string) {
  if (!href.startsWith('/')) return href;
  return `/${locale}${href === '/' ? '' : href.replace(/^\/(?=[?#])/, '')}`;
}

export function stripLocale(pathname: string) {
  return pathname.replace(new RegExp(`^/(${routing.locales.join('|')})(?=/|$)`), '') || '/';
}
