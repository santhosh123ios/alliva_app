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

export function NotFound() {
  return (
    <div style={{ fontFamily: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', height: '100vh', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div>
        <h1 style={{ display: 'inline-block', margin: '0 20px 0 0', padding: '0 23px 0 0', fontSize: 24, fontWeight: 500, verticalAlign: 'top', lineHeight: '49px', borderInlineEnd: '1px solid rgba(0, 0, 0, .3)' }}>404</h1>
        <div style={{ display: 'inline-block' }}>
          <h2 style={{ fontSize: 14, fontWeight: 400, lineHeight: '49px', margin: 0 }}>This page could not be found.</h2>
        </div>
      </div>
    </div>
  );
}
