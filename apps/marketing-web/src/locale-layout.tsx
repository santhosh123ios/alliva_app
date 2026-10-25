import { Providers } from '@/components/providers';
import { hasLocale, preferredLocale, rememberLocale, type Locale } from '@/i18n/routing';
import { Suspense, use, useLayoutEffect } from 'react';
import { Navigate, Outlet, ScrollRestoration, useLocation, useParams } from 'react-router';
import { IntlProvider, type AbstractIntlMessages } from 'use-intl';

const catalogs: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import('@alliva/ui/messages/en.json'),
  ar: () => import('@alliva/ui/messages/ar.json'),
};
const loaded = new Map<Locale, Promise<AbstractIntlMessages>>();

function loadMessages(locale: Locale) {
  let messages = loaded.get(locale);
  if (!messages) {
    messages = catalogs[locale]().then((module) => module.default as AbstractIntlMessages);
    loaded.set(locale, messages);
  }
  return messages;
}

export function LocaleLayout() {
  const { locale } = useParams();
  if (!hasLocale(locale)) return <LocaleRedirect />;
  return (
    <Suspense fallback={null}>
      <LocaleContent locale={locale} />
    </Suspense>
  );
}

export function LocaleRedirect() {
  const location = useLocation();
  const path = location.pathname === '/' ? '' : location.pathname;
  return <Navigate replace to={`/${preferredLocale()}${path}${location.search}${location.hash}`} />;
}

function LocaleContent({ locale }: { locale: Locale }) {
  const messages = use(loadMessages(locale));
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    rememberLocale(locale);
  }, [locale]);
  return (
    <IntlProvider locale={locale} messages={messages}>
      <Providers>
        <Outlet />
      </Providers>
      <ScrollRestoration />
    </IntlProvider>
  );
}
