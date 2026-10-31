import { useOrderUpdates } from '@/components/order-alerts';
import { api } from '@/components/providers';
import { Link, usePathname } from '@/i18n/navigation';
import { localizeHref } from '@/i18n/routing';
import { canOpen, landingFor } from '@/lib/roles';
import { Dock } from '@/rider/dock';
import { pickLocalized } from '@alliva/design-tokens';
import { cn, PageLoader } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { BellRing, ClipboardList, House, LayoutGrid, ShoppingBag, UserRound, UtensilsCrossed } from 'lucide-react';
import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useLocale, useTranslations } from 'use-intl';
import { FloorProvider, tableNo, money, useDraft, useFloorAlerts, useFloorBoard, useFloorLocale } from './shared';

const tabs = [
  { href: '/floor', key: 'home', icon: House },
  { href: '/floor/tables', key: 'tables', icon: LayoutGrid },
  { href: '/floor/menu', key: 'menu', icon: UtensilsCrossed },
  { href: '/floor/orders', key: 'orders', icon: ClipboardList },
  { href: '/floor/profile', key: 'profile', icon: UserRound },
] as const;

export default function FloorLayout() {
  const locale = useLocale();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  if (me.isError) return <Navigate replace to={localizeHref('/login', locale)} />;
  if (!me.data) return <PageLoader />;
  if (!canOpen(me.data, 'floor')) return <Navigate replace to={localizeHref(landingFor(me.data), locale)} />;
  return (
    <FloorProvider>
      <FloorChrome />
    </FloorProvider>
  );
}

function FloorChrome() {
  const t = useTranslations('floor');
  const locale = useFloorLocale();
  const pathname = usePathname();
  useOrderUpdates();
  const board = useFloorBoard();
  useFloorAlerts(board.data);
  const profile = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile(), retry: false, staleTime: 300_000 });
  const storeName = (profile.data as { name?: { en?: string; ar?: string } } | undefined)?.name;
  const current = [...tabs].reverse().find((tab) => (tab.href === '/floor' ? pathname === '/floor' : pathname.startsWith(tab.href)))?.key ?? 'home';
  const calls = board.data?.requests.filter((row) => row.status === 'OPEN').length ?? 0;
  const draft = useDraft();
  const showDraft = draft.count > 0 && current !== 'menu';

  return (
    <div className="min-h-dvh bg-[#F7F7F5] text-[#161616]">
      <header className="sticky top-0 z-30 border-b border-[#ECECE8] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#FFC400] text-[#111111]"><UtensilsCrossed className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{storeName ? pickLocalized(storeName, locale) : t('appName')}</p>
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
            href="/floor"
            aria-label={t('calls.badge', { count: calls })}
            className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', calls ? 'bg-[#B42318] text-white' : 'bg-[#F0F0EC] text-[#696965]')}
          >
            <BellRing className={cn('size-4', calls && 'animate-pulse')} />
            <span className="tabular-nums">{calls}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-[calc(max(0.7rem,env(safe-area-inset-bottom))+6.5rem)] pt-4 lg:pb-10">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))] lg:pb-4">
          {showDraft ? (
            <Link
              href="/floor/menu?review=1"
              className="pointer-events-auto mx-auto mb-2 flex h-12 max-w-[520px] items-center gap-3 rounded-2xl bg-[#FFC400] px-4 text-sm font-semibold text-[#111111] shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
            >
              <ShoppingBag className="size-4" />
              <span className="min-w-0 flex-1 truncate">
                {draft.target?.kind === 'DINE_IN' ? t('draft.forTable', { table: tableNo(draft.target.tableNumber) }) : draft.target ? t('draft.takeaway') : t('draft.noTarget')}
                {' · '}{t('draft.items', { count: draft.count })}
              </span>
              <span className="tabular-nums">{money(draft.subtotal, locale)}</span>
            </Link>
          ) : null}
          <div className="pointer-events-auto lg:hidden">
            <Dock tabs={tabs.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))} active={current} label={t('tabs.label')} />
          </div>
        </div>
      </footer>
    </div>
  );
}
