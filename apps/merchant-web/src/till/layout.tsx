import { useOrderUpdates } from '@/components/order-alerts';
import { api } from '@/components/providers';
import { Link, usePathname } from '@/i18n/navigation';
import { localizeHref } from '@/i18n/routing';
import { canOpen, landingFor } from '@/lib/roles';
import { Dock } from '@/rider/dock';
import { cn, PageLoader } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { House, Receipt, UserRound, Wallet } from 'lucide-react';
import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useLocale, useTranslations } from 'use-intl';
import { TillProvider, useStoreHeader, useTillAlerts, useTillBoard } from './shared';

const tabs = [
  { href: '/billing', key: 'home', icon: House },
  { href: '/billing/bills', key: 'bills', icon: Receipt },
  { href: '/billing/cash', key: 'cash', icon: Wallet },
  { href: '/billing/profile', key: 'profile', icon: UserRound },
] as const;

export default function TillLayout() {
  const locale = useLocale();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  if (me.isError) return <Navigate replace to={localizeHref('/login', locale)} />;
  if (!me.data) return <PageLoader />;
  if (!canOpen(me.data, 'billing')) return <Navigate replace to={localizeHref(landingFor(me.data), locale)} />;
  return (
    <TillProvider>
      <TillChrome />
    </TillProvider>
  );
}

function TillChrome() {
  const t = useTranslations('till');
  const pathname = usePathname();
  useOrderUpdates();
  const board = useTillBoard();
  useTillAlerts(board.data);
  const store = useStoreHeader();
  const current = [...tabs].reverse().find((tab) => (tab.href === '/billing' ? pathname === '/billing' : pathname.startsWith(tab.href)))?.key ?? 'home';
  const asking = board.data?.requests.length ?? 0;

  return (
    <div className="min-h-dvh bg-[#F7F7F5] text-[#161616]">
      <header className="sticky top-0 z-30 border-b border-[#ECECE8] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#FFC400] text-[#111111]"><Receipt className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{store.name || t('appName')}</p>
            <p className="truncate text-xs text-[#696965]">{t('appName')}</p>
          </div>
          <nav className="hidden items-center gap-1 lg:flex" aria-label={t('tabs.label')}>
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn('flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium', current === tab.key ? 'bg-[#111111] text-white' : 'text-[#5C5C58] hover:bg-[#F2F2EF]')}
                aria-current={current === tab.key ? 'page' : undefined}
              >
                <tab.icon className="size-4" />
                {t(`tabs.${tab.key}`)}
              </Link>
            ))}
          </nav>
          <Link
            href="/billing/bills"
            aria-label={t('asking', { count: asking })}
            className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', asking ? 'bg-[#B42318] text-white' : 'bg-[#F0F0EC] text-[#696965]')}
          >
            <Receipt className={cn('size-4', asking && 'animate-pulse')} />
            <span className="tabular-nums">{asking}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-[calc(max(0.7rem,env(safe-area-inset-bottom))+6.5rem)] pt-4 lg:pb-10">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <div className="pointer-events-auto px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))]">
          <Dock tabs={tabs.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))} active={current} label={t('tabs.label')} />
        </div>
      </footer>
    </div>
  );
}
