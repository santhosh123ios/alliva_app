'use client';

import { api } from '@/components/providers';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { ShellSkeleton, Spinner } from '@alliva/ui';
import type { AuthUser } from '@alliva/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronRight, Crown, LayoutGrid, Package, Search, ShoppingCart, Store, Users, UtensilsCrossed, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

type SaveStatus = { pending: boolean; notice: string };
const emptySaveStatus: SaveStatus = { pending: false, notice: '' };
const SaveStatusContext = createContext<((status: SaveStatus) => void) | null>(null);

export function useSaveStatus() {
  return useContext(SaveStatusContext);
}

const groups = [
  {
    label: 'overview',
    items: [
      { href: '/dashboard', label: 'dashboard', icon: LayoutGrid, permission: 'order.view' },
      { href: '/orders', label: 'orders', icon: ShoppingCart, permission: 'order.view' },
      { href: '/products', label: 'products', icon: Package, permission: 'catalog.manage' },
    ],
  },
  {
    label: 'management',
    items: [
      { href: '/business', label: 'business', icon: Store, permission: 'merchant.profile.manage' },
      { href: '/staff', label: 'staff', icon: Users, permission: 'staff.manage' },
      { href: '/tables', label: 'tables', icon: UtensilsCrossed, permission: 'table.manage' },
      { href: '/payments', label: 'payments', icon: Wallet, permission: 'payment.view' },
      { href: '/subscription', label: 'subscription', icon: Crown, permission: 'payment.view' },
    ],
  },
] as const;

export function PortalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(emptySaveStatus);
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const isPublic = pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/forgot') || pathname.startsWith('/reset') || pathname.startsWith('/register');
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false, enabled: !isPublic });
  const canSeeAlerts = Boolean(me.data && (me.data.roles.includes('MERCHANT_OWNER') || me.data.permissions.includes('order.view')));
  const alerts = useQuery({ queryKey: ['merchant', 'dashboard'], queryFn: () => api.merchantDashboard(), enabled: canSeeAlerts });
  useEffect(() => {
    if (!isPublic && me.isError) router.replace('/login');
  }, [isPublic, me.isError, router]);
  useEffect(() => {
    if (!profileOpen) return;
    const close = (event: MouseEvent) => {
      if (profileRef.current?.contains(event.target as Node)) return;
      setProfileOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [profileOpen]);
  useEffect(() => {
    setProfileOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('workspace-search')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const nav = useMemo(() => {
    if (!me.data) return [];
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.href === '/dashboard' || allowed(me.data, item.permission)),
      }))
      .filter((group) => group.items.length > 0);
  }, [me.data]);
  if (isPublic) return <>{children}</>;
  if (me.isError) return null;
  if (!me.data) return <ShellSkeleton variant="light" />;
  const current = groups.flatMap((group) => [...group.items]).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const currentLabel = current ? t(`nav.${current.label}`) : t('nav.dashboard');
  const matches = query.trim()
    ? nav.flatMap((group) => group.items).filter((item) => t(`nav.${item.label}`).toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  const attention = alerts.data?.pendingOrders ?? 0;
  const initials = `${me.data.firstName[0] ?? ''}${me.data.lastName[0] ?? ''}`.toUpperCase();

  return (
    <SaveStatusContext.Provider value={setSaveStatus}>
    <div className="min-h-screen bg-[#F7F7F5] md:grid md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col border-e border-[#EEEEEC] bg-white text-[#161616] md:sticky md:top-0 md:h-screen">
        <Link href="/dashboard" className="flex items-center gap-3 px-5 pb-2 pt-5">
          <span
            aria-label="Alliva"
            className="block h-7 w-28 bg-primary"
            style={{
              WebkitMaskImage: 'url(/logo-on-light.png)',
              maskImage: 'url(/logo-on-light.png)',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskPosition: 'left center',
              maskPosition: 'left center',
            }}
          />
        </Link>
        <p className="px-5 pb-4 text-[11px] font-semibold tracking-[0.16em] text-[#8A8A86]">{t('workspace.merchantWorkspace').toUpperCase()}</p>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {nav.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.16em] text-[#8A8A86]">{t(`workspace.${group.label}`).toUpperCase()}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} active={pathname === item.href} icon={item.icon} label={t(`nav.${item.label}`)} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-[#EEEEEC] p-3">
          <div className="relative">
            <div className="flex items-center gap-3 rounded-2xl px-2 py-2">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-[#F1F1EE] text-[11px] font-semibold leading-none tracking-tight">
                {initials}
                <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-white bg-[#168A52]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-tight">{me.data.firstName} {me.data.lastName}</span>
              </span>
              <button type="button" className="ms-auto grid size-8 place-items-center rounded-full hover:bg-[#F7F7F5]" aria-label={t('nav.logout')} onClick={() => setAccountOpen((open) => !open)}>
                <ChevronRight className="size-4" />
              </button>
            </div>
            {accountOpen ? (
              <button
                type="button"
                className="absolute inset-x-2 bottom-14 rounded-xl border border-[#EEEEEC] bg-white px-3 py-2 text-sm font-semibold text-[#111111] shadow-lg"
                onClick={() => api.logout().then(() => { client.clear(); router.replace('/login'); })}
              >
                {t('nav.logout')}
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      <div className="min-w-0 xl:flex xl:h-dvh xl:flex-col xl:overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b bg-white px-4 md:px-6">
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            {t('workspace.workspace')} <span className="px-1">/</span> <span className="font-semibold text-foreground">{currentLabel}</span>
          </p>
          <div className="ms-auto flex items-center gap-3">
            {saveStatus.pending ? (
              <Spinner className="shrink-0 text-[#8A8A86]" label={t('merchantBusiness.saving')} />
            ) : saveStatus.notice ? (
              <p className="max-w-48 truncate text-sm font-medium text-[#161616]">{saveStatus.notice}</p>
            ) : null}
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="workspace-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('workspace.search')}
                className="h-10 w-64 rounded-full border bg-white ps-9 pe-14 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">⌘K</kbd>
              {matches.length ? (
                <div className="absolute end-0 z-30 mt-2 w-64 rounded-2xl border bg-white p-2 shadow-lg">
                  {matches.map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setQuery('')} className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-muted">
                      {t(`nav.${item.label}`)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <Link href="/orders" className="relative grid size-10 place-items-center rounded-full border bg-white" aria-label={t('nav.orders')}>
              <Bell className="size-4" />
              {attention > 0 ? <span className="absolute end-2 top-2 size-2 rounded-full bg-primary" /> : null}
            </Link>
            <Link href={pathname} locale={locale === 'en' ? 'ar' : 'en'} className="grid h-10 min-w-10 place-items-center rounded-xl border bg-white px-2 text-xs font-semibold">
              {locale === 'en' ? 'EN' : 'AR'}
            </Link>
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                className="grid size-10 place-items-center rounded-xl bg-[#F1F1EE] text-xs font-semibold"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label={`${me.data.firstName} ${me.data.lastName}`}
                onClick={() => setProfileOpen((open) => !open)}
              >
                {initials}
              </button>
              {profileOpen ? (
                <div role="menu" className="absolute end-0 z-30 mt-2 w-72 rounded-2xl border bg-white p-4 shadow-lg">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#F1F1EE] text-sm font-semibold">{initials}</span>
                    <span className="block truncate font-semibold">{me.data.firstName} {me.data.lastName}</span>
                  </div>
                  <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted-foreground">{t('workspace.role')}</dt>
                      <dd className="mt-0.5 font-semibold">{roleLabel(me.data, locale)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold tracking-wide text-muted-foreground">{t('workspace.email')}</dt>
                      <dd className="mt-0.5 break-all font-semibold">{me.data.email}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    role="menuitem"
                    className="mt-4 w-full rounded-xl bg-[#111111] px-3 py-2.5 text-sm font-semibold text-white"
                    onClick={() => api.logout().then(() => { client.clear(); router.replace('/login'); })}
                  >
                    {t('nav.logout')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col p-4 md:p-6 xl:min-h-0 xl:overflow-auto">{children}</main>
      </div>
    </div>
    </SaveStatusContext.Provider>
  );
}

function NavLink({ href, active, icon: Icon, label }: { href: string; active: boolean; icon: typeof LayoutGrid; label: string }) {
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${active ? 'bg-primary text-[#111111]' : 'text-[#3A3A36] hover:bg-[#F7F7F5]'}`}>
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

const roleNames: Record<string, { en: string; ar: string }> = {
  MERCHANT_OWNER: { en: 'Merchant Owner', ar: 'مالك المتجر' },
  MERCHANT_MANAGER: { en: 'Merchant Manager', ar: 'مدير المتجر' },
  ORDER_TAKING_STAFF: { en: 'Order-Taking Staff', ar: 'موظف الطلبات' },
  KITCHEN_STAFF: { en: 'Kitchen Staff', ar: 'موظف المطبخ' },
  BILLING_STAFF: { en: 'Billing Staff', ar: 'موظف الفوترة' },
  DELIVERY_STAFF: { en: 'Delivery Staff', ar: 'موظف التوصيل' },
  REPORT_VIEWER: { en: 'Report Viewer', ar: 'مشاهد التقارير' },
};

function roleLabel(user: AuthUser, locale: string) {
  return user.roles.map((role) => roleNames[role]?.[locale === 'ar' ? 'ar' : 'en'] ?? role.replaceAll('_', ' ')).join(', ');
}

function allowed(user: AuthUser, permission: string) {
  return user.roles.includes('MERCHANT_OWNER') || user.permissions.includes(permission);
}
