'use client';

import { api } from '@/components/providers';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { ShellSkeleton } from '@alliva/ui';
import type { AuthUser } from '@alliva/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, ChevronRight, FileText, LayoutGrid, Megaphone, MessageSquare, RefreshCcw, Search, Settings, ShoppingCart, Store, Ticket, Users, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

const groups = [
  {
    label: 'overview',
    items: [
      { href: '/dashboard', label: 'dashboard', icon: LayoutGrid, permission: 'order.view' },
      { href: '/operations', label: 'orders', icon: ShoppingCart, permission: 'dispatch.manage' },
      { href: '/merchants', label: 'merchants', icon: Store, permission: 'merchant.view' },
    ],
  },
  {
    label: 'management',
    items: [
      { href: '/subscriptions', label: 'subscriptions', icon: RefreshCcw, permission: 'subscription.manage' },
      { href: '/staff', label: 'rolesStaff', icon: Users, permission: 'staff.manage' },
      { href: '/complaints', label: 'complaintsFeedback', icon: MessageSquare, permission: 'complaint.view' },
      { href: '/finance', label: 'accounts', icon: Wallet, permission: 'payment.view' },
      { href: '/promos', label: 'promoCodes', icon: Ticket, permission: 'promo.manage' },
      { href: '/marketing', label: 'marketingTeam', icon: Megaphone, permission: 'marketing.manage' },
    ],
  },
  {
    label: 'insights',
    items: [
      { href: '/analytics', label: 'analytics', icon: BarChart3, permission: 'report.export' },
      { href: '/audit', label: 'reports', icon: FileText, permission: 'audit.view' },
    ],
  },
] as const;

const settingsItem = { href: '/settings', label: 'settings', icon: Settings, permission: 'settings.manage' } as const;

export function PortalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const isPublic = ['/login', '/forgot', '/reset'].some((path) => pathname.startsWith(path));
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false, enabled: !isPublic });
  const canSeeAlerts = Boolean(me.data && (me.data.roles.includes('SUPER_ADMIN') || me.data.permissions.includes('order.view')));
  const alerts = useQuery({ queryKey: ['admin', 'dashboard'], queryFn: () => api.adminDashboard(), enabled: canSeeAlerts });
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
        items: group.items.filter((item) => allowed(me.data, item.permission)),
      }))
      .filter((group) => group.items.length > 0);
  }, [me.data]);
  if (isPublic) return <>{children}</>;
  if (me.isError) return null;
  if (!me.data) return <ShellSkeleton />;
  const current = [...groups.flatMap((group) => [...group.items]), settingsItem].find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const currentLabel = current ? labelFor(t, current.label) : t('nav.dashboard');
  const matches = query.trim()
    ? [...nav.flatMap((group) => group.items), ...(allowed(me.data, settingsItem.permission) ? [settingsItem] : [])].filter((item) => labelFor(t, item.label).toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  const attention = (alerts.data?.pendingApprovals ?? 0) + (alerts.data?.refundSummary.pending ?? 0) + (alerts.data?.complaintsRequiringAction ?? 0);
  const initials = `${me.data.firstName[0] ?? ''}${me.data.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="min-h-screen bg-[#F7F7F5] md:grid md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col bg-[#111111] text-white md:sticky md:top-0 md:h-screen">
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
        <p className="px-5 pb-4 text-[11px] font-semibold tracking-[0.16em] text-white/45">{t('workspace.adminWorkspace').toUpperCase()}</p>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {nav.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.16em] text-white/40">{t(`workspace.${group.label}`).toUpperCase()}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} active={pathname === item.href} icon={item.icon} label={labelFor(t, item.label)} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 p-3">
          {allowed(me.data, settingsItem.permission) ? (
            <NavLink href={settingsItem.href} active={pathname === settingsItem.href} icon={settingsItem.icon} label={t('nav.settings')} />
          ) : null}
          <div className="relative mt-2">
            <div className="flex items-center gap-3 rounded-2xl px-2 py-2">
              <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold leading-none tracking-tight">
                {initials}
                <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-[#111111] bg-[#168A52]" />
              </span>
              <span className="min-w-0">
                <span className="block whitespace-nowrap text-[13px] font-semibold leading-tight">{me.data.roles.includes('SUPER_ADMIN') ? t('workspace.superAdmin') : `${me.data.firstName} ${me.data.lastName}`}</span>
              </span>
              <button type="button" className="ms-auto grid size-8 place-items-center rounded-full hover:bg-white/10" aria-label={t('nav.logout')} onClick={() => setAccountOpen((open) => !open)}>
                <ChevronRight className="size-4" />
              </button>
            </div>
            {accountOpen ? (
              <button
                type="button"
                className="absolute inset-x-2 bottom-14 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-[#111111]"
                onClick={() => api.logout().then(() => { client.clear(); router.replace('/login'); })}
              >
                {t('nav.logout')}
              </button>
            ) : null}
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-white px-4 md:px-6">
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            {t('workspace.workspace')} <span className="px-1">/</span> <span className="font-semibold text-foreground">{currentLabel}</span>
          </p>
          <div className="ms-auto flex items-center gap-2">
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
                      {labelFor(t, item.label)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="relative grid size-10 place-items-center rounded-full border bg-white">
              <Bell className="size-4" />
              {attention > 0 ? <span className="absolute end-2 top-2 size-2 rounded-full bg-primary" /> : null}
            </span>
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
        <main className="mx-auto w-full max-w-[1440px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, active, icon: Icon, label }: { href: string; active: boolean; icon: typeof LayoutGrid; label: string }) {
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${active ? 'bg-primary text-[#111111]' : 'text-white/80 hover:bg-white/10'}`}>
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

const roleNames: Record<string, { en: string; ar: string }> = {
  SUPER_ADMIN: { en: 'Super Admin', ar: 'مدير أعلى' },
  ADMIN: { en: 'Admin', ar: 'مدير' },
  OPERATIONS_MANAGER: { en: 'Operations Manager', ar: 'مدير العمليات' },
  OPERATIONS_STAFF: { en: 'Operations Staff', ar: 'موظف عمليات' },
  MARKETING_HEAD: { en: 'Marketing Head', ar: 'رئيس التسويق' },
  MARKETING_STAFF: { en: 'Marketing Staff', ar: 'موظف تسويق' },
  FINANCE_MANAGER: { en: 'Finance Manager', ar: 'مدير المالية' },
  FINANCE_STAFF: { en: 'Finance Staff', ar: 'موظف مالية' },
  CUSTOMER_SUPPORT: { en: 'Customer Support', ar: 'دعم العملاء' },
};

function roleLabel(user: AuthUser, locale: string) {
  return user.roles.map((role) => roleNames[role]?.[locale === 'ar' ? 'ar' : 'en'] ?? role.replaceAll('_', ' ')).join(', ');
}

function allowed(user: AuthUser, permission: string) {
  return user.roles.includes('SUPER_ADMIN') || user.permissions.includes(permission);
}

function labelFor(t: ReturnType<typeof useTranslations>, key: string) {
  if (key === 'dashboard') return t('nav.dashboard');
  if (key === 'merchants') return t('nav.merchants');
  if (key === 'subscriptions') return t('nav.subscriptions');
  if (key === 'analytics') return t('nav.analytics');
  if (key === 'settings') return t('nav.settings');
  return t(`workspace.${key}`);
}
