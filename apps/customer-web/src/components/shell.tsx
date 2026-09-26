'use client';

import { api } from '@/components/providers';
import { Link, usePathname } from '@/i18n/navigation';
import { Logo } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect } from 'react';

const links = [
  ['/', 'home'],
  ['/orders', 'orders'],
  ['/cart', 'cart'],
  ['/profile', 'profile'],
] as const;

export function CustomerShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });

  useEffect(() => {
    void api.guest().catch(() => undefined);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
  }, []);

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-20 border-b bg-primary">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="inline-flex items-center py-1">
            <Logo className="h-10 w-auto" />
          </Link>
          <div className="flex items-center gap-3 text-sm font-semibold">
            <Link href={pathname} locale={locale === 'ar' ? 'en' : 'ar'}>
              {t('common.language')}
            </Link>
            {me.data ? (
              <span>
                {me.data.firstName}
              </span>
            ) : (
              <Link href="/login">{t('auth.signIn')}</Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-card">
        <ul className="mx-auto grid max-w-[1440px] grid-cols-4">
          {links.map(([href, key]) => (
            <li key={href}>
              <Link className="flex h-14 items-center justify-center text-sm font-semibold" href={href}>
                {t(`nav.${key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
