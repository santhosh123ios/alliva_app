import { api } from '@/components/providers';
import { Link, usePathname } from '@/i18n/navigation';
import { localizeHref } from '@/i18n/routing';
import { isRider, landingFor } from '@/lib/roles';
import { pickLocalized } from '@alliva/design-tokens';
import { cn, PageLoader, toast } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Bike, House, UserRound, Wallet } from 'lucide-react';
import { Suspense, useEffect, useRef } from 'react';
import { Navigate, Outlet } from 'react-router';
import { useLocale, useTranslations } from 'use-intl';
import { Dock } from './dock';
import { RiderLocationProvider, useRiderLocale, useRiderOrders, useRiderProfile } from './shared';

const tabs = [
  { href: '/rider', key: 'home', icon: House },
  { href: '/rider/collection', key: 'collection', icon: Wallet },
  { href: '/rider/profile', key: 'profile', icon: UserRound },
] as const;

export default function RiderLayout() {
  const locale = useLocale();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  if (me.isError) return <Navigate replace to={localizeHref('/login', locale)} />;
  if (!me.data) return <PageLoader />;
  if (!isRider(me.data)) return <Navigate replace to={localizeHref(landingFor(me.data), locale)} />;
  return <RiderFrame />;
}

function RiderFrame() {
  const profile = useRiderProfile();
  return (
    <RiderLocationProvider onShift={Boolean(profile.data?.onShift)}>
      <RiderChrome />
    </RiderLocationProvider>
  );
}

function RiderChrome() {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const pathname = usePathname();
  const profile = useRiderProfile();
  useAssignmentAlerts();
  const current = tabs.find((tab) => (tab.href === '/rider' ? pathname === '/rider' || pathname.startsWith('/rider/orders') : pathname.startsWith(tab.href)))?.key ?? 'home';
  const onShift = Boolean(profile.data?.onShift);

  return (
    <div className="min-h-dvh bg-[#F7F7F5] text-[#161616]">
      <header className="sticky top-0 z-30 border-b border-[#ECECE8] bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#FFC400] text-[#111111]"><Bike className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{profile.data?.store ? pickLocalized(profile.data.store.name, locale) : t('appName')}</p>
            <p className="truncate text-xs text-[#696965]">{t('appName')}</p>
          </div>
          <nav className="hidden items-center gap-1 md:flex" aria-label={t('tabs.label')}>
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
            href="/rider/profile"
            className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold', onShift ? 'bg-[#E3F5EA] text-[#168A52]' : 'bg-[#F0F0EC] text-[#696965]')}
          >
            <span className={cn('size-2 rounded-full', onShift ? 'bg-[#168A52]' : 'bg-[#A3A39E]')} />
            {onShift ? t('shift.on') : t('shift.off')}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-[calc(max(0.7rem,env(safe-area-inset-bottom))+6.5rem)] pt-4 md:pb-10">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-40 md:hidden">
        <div className="pointer-events-auto px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))]">
          <Dock tabs={tabs.map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }))} active={current} label={t('tabs.label')} />
        </div>
      </footer>
    </div>
  );
}

/** Buzz and toast when the store dispatches a new order to this rider. */
function useAssignmentAlerts() {
  const t = useTranslations('rider');
  const orders = useRiderOrders();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const active = orders.data?.active;
    if (!active) return;
    const ids = new Set(active.map((order) => order.id));
    if (seen.current) {
      const fresh = active.filter((order) => !seen.current!.has(order.id));
      if (fresh.length) {
        toast.success(fresh.length === 1 ? t('alerts.newOrder', { number: fresh[0]!.number }) : t('alerts.newOrders', { count: fresh.length }));
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([180, 80, 180]);
      }
    }
    seen.current = ids;
  }, [orders.data, t]);
}
