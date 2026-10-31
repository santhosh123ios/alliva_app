import { api } from '@/components/providers';
import { BusinessSetupDialog, type SetupProfile } from '@/components/business-setup';
import { OrderAlerts } from '@/components/order-alerts';
import { canOpen, hasPermission, isKitchenOnly, isOrderTaker, isBillingStaff, isRider } from '@/lib/roles';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import { ThemeToggle } from '@/components/theme-toggle';
import { useTheme } from '@/lib/theme';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Sheet, SheetContent, ShellSkeleton, Spinner } from '@alliva/ui';
import type { AuthUser } from '@alliva/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, ChefHat, ChevronDown, Crown, ExternalLink, LogOut, MapPin, Menu, Moon, LayoutGrid, Package, Receipt, Route, Search, Settings, ShoppingCart, Smartphone, Store, Ticket, Users, UtensilsCrossed, Wallet } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

type SaveStatus = { pending: boolean; notice: string };
const emptySaveStatus: SaveStatus = { pending: false, notice: '' };
const SaveStatusContext = createContext<((status: SaveStatus) => void) | null>(null);

export function useSaveStatus() {
  return useContext(SaveStatusContext);
}

type WorkspaceBranch = { id: string; name: { en?: string; ar?: string }; city?: string | null; active?: boolean };
type WorkspaceProfile = {
  slug?: string;
  name?: { en?: string; ar?: string };
  branches?: WorkspaceBranch[];
  subscription?: {
    status: string;
    currentPeriodEnd: string;
    plan?: { name?: { en?: string; ar?: string } };
  } | null;
};

function renewalRequired(subscription: WorkspaceProfile['subscription']) {
  if (!subscription?.currentPeriodEnd) return false;
  if (subscription.status !== 'ACTIVE') return true;
  const end = new Date(subscription.currentPeriodEnd);
  return !Number.isNaN(end.getTime()) && end.getTime() <= Date.now();
}
const WorkspaceBranchContext = createContext<{ branchId: string; setBranchId: (id: string) => void }>({
  branchId: '',
  setBranchId: () => undefined,
});

export function useWorkspaceBranch() {
  return useContext(WorkspaceBranchContext);
}

const groups = [
  {
    label: 'overview',
    items: [
      { href: '/dashboard', label: 'dashboard', icon: LayoutGrid },
      { href: '/orders', label: 'orders', icon: ShoppingCart },
      { href: '/kitchen', label: 'kitchen', icon: ChefHat },
      { href: '/floor', label: 'floor', icon: Smartphone },
      { href: '/billing', label: 'till', icon: Receipt },
      { href: '/tables', label: 'tables', icon: UtensilsCrossed },
      { href: '/dispatch', label: 'dispatch', icon: Route },
      { href: '/products', label: 'products', icon: Package },
      { href: '/promos', label: 'promos', icon: Ticket },
      { href: '/reports', label: 'reports', icon: BarChart3 },
    ],
  },
  {
    label: 'management',
    items: [
      { href: '/business', label: 'business', icon: Store },
      { href: '/staff', label: 'staff', icon: Users },
      { href: '/payments', label: 'payments', icon: Wallet },
      { href: '/referral', label: 'referralWallet', icon: Wallet },
      { href: '/subscription', label: 'subscription', icon: Crown },
      { href: '/settings', label: 'settings', icon: Settings },
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
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickedBranch, setPickedBranch] = useState<string | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const isPublic = pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/forgot') || pathname.startsWith('/reset') || pathname.startsWith('/register');
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false, enabled: !isPublic });
  const business = useQuery({
    queryKey: ['merchant', 'business'],
    queryFn: () => api.profile(),
    retry: false,
    enabled: Boolean(!isPublic && me.data?.merchantId),
  });
  // New-order alerts ring for the people who accept orders, not for kitchen, billing or report staff.
  const canSeeAlerts = Boolean(me.data && canOpen(me.data, 'orders') && hasPermission(me.data, 'order.update'));
  const alerts = useQuery({ queryKey: ['merchant', 'dashboard'], queryFn: () => api.merchantDashboard(), enabled: canSeeAlerts, refetchInterval: 30_000 });
  useEffect(() => {
    if (!isPublic && me.isError) router.replace('/login');
  }, [isPublic, me.isError, router]);
  const rider = Boolean(me.data && isRider(me.data));
  const kitchenOnly = Boolean(me.data && isKitchenOnly(me.data));
  const orderTaker = Boolean(me.data && isOrderTaker(me.data));
  const billingStaff = Boolean(me.data && isBillingStaff(me.data));
  useEffect(() => {
    if (!isPublic && rider) router.replace('/rider');
    else if (!isPublic && kitchenOnly) router.replace('/kitchen');
    else if (!isPublic && orderTaker) router.replace('/floor');
    else if (!isPublic && billingStaff) router.replace('/billing');
  }, [isPublic, rider, kitchenOnly, orderTaker, billingStaff, router]);
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
    setMenuOpen(false);
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
  const renewalDue = renewalRequired((business.data as WorkspaceProfile | undefined)?.subscription);
  const onSubscription = pathname === '/subscription' || pathname.startsWith('/subscription/');
  const nav = useMemo(() => {
    if (!me.data) return [];
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canOpen(me.data, item.href.slice(1))),
      }))
      .filter((group) => group.items.length > 0);
  }, [me.data, renewalDue]);
  if (isPublic) return <>{children}</>;
  if (me.isError || rider || kitchenOnly) return null;
  if (!me.data || (me.data.merchantId && business.isLoading)) return <ShellSkeleton />;
  const needsBusinessSetup = Boolean(me.data.merchantId && business.data && !(business.data as { businessSetupCompleted?: boolean }).businessSetupCompleted);
  const current = groups.flatMap((group) => [...group.items]).find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const currentLabel = current ? t(`nav.${current.label}`) : t('nav.dashboard');
  const matches = query.trim()
    ? nav.flatMap((group) => group.items).filter((item) => t(`nav.${item.label}`).toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  const attention = alerts.data?.pendingOrders ?? 0;
  const initials = `${me.data.firstName[0] ?? ''}${me.data.lastName[0] ?? ''}`.toUpperCase();
  const profile = business.data as WorkspaceProfile | undefined;
  const branches = (profile?.branches ?? []).filter((branch) => branch.active !== false && branch.id);
  const branchId = pickedBranch && branches.some((branch) => branch.id === pickedBranch) ? pickedBranch : (branches[0]?.id ?? '');
  const branchValue = { branchId, setBranchId: setPickedBranch };

  function openStorefront() {
    if (!profile?.slug || typeof window === 'undefined') return;
    window.open(`http://${window.location.hostname}:3000/${locale}/merchants/${profile.slug}`, '_blank', 'noopener,noreferrer');
  }

  const logout = () => api.logout().then(() => { client.clear(); router.replace('/login'); });
  const businessName = profile?.name ? pickLocalized(profile.name, locale === 'ar' ? 'ar' : 'en') : '';
  const sidebar = (
    <SidebarContent
      home={renewalDue ? '/subscription' : '/dashboard'}
      businessName={businessName}
      planName={profile?.subscription?.plan?.name ? pickLocalized(profile.subscription.plan.name, locale === 'ar' ? 'ar' : 'en') : ''}
      groups={nav.map((group) => ({
        label: t(`workspace.${group.label}`),
        items: group.items.map((item) => ({
          href: item.href,
          icon: item.icon,
          label: t(`nav.${item.label}`),
          active: pathname === item.href || pathname.startsWith(`${item.href}/`),
          disabled: renewalDue && item.href !== '/subscription',
          count: item.href === '/orders' && !renewalDue ? attention : 0,
        })),
      }))}
      user={{ initials, name: `${me.data.firstName} ${me.data.lastName}`, role: roleLabel(me.data, locale) }}
      logoutLabel={t('nav.logout')}
      workspaceLabel={t('workspace.merchantWorkspace')}
      onLogout={logout}
    />
  );

  return (
    <WorkspaceBranchContext.Provider value={branchValue}>
    <SaveStatusContext.Provider value={setSaveStatus}>
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-e lg:border-sidebar-border">{sidebar}</aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent className="w-[min(86vw,18rem)] border-0 bg-sidebar p-0" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{t('workspace.merchantWorkspace')}</DialogTitle>
          <div className="flex h-full flex-col">{sidebar}</div>
        </SheetContent>
      </Sheet>
      <div className="min-w-0 xl:flex xl:h-dvh xl:flex-col xl:overflow-hidden">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:gap-3 md:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t('workspace.openMenu')}
            className="grid size-10 shrink-0 place-items-center rounded-xl border bg-card text-foreground shadow-xs lg:hidden"
          >
            <Menu className="size-[18px]" />
          </button>
          {branches.length ? (
            <label className="relative min-w-0">
              <span className="sr-only">{t('workspace.merchant')}</span>
              <MapPin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <select
                value={branchId}
                onChange={(event) => setPickedBranch(event.target.value)}
                className="h-10 w-full max-w-[150px] appearance-none truncate rounded-xl border bg-card ps-9 pe-8 text-sm font-semibold text-foreground shadow-xs outline-none transition-shadow focus:ring-4 focus:ring-primary/25 sm:max-w-[260px]"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {pickLocalized(branch.name, locale === 'ar' ? 'ar' : 'en')}{branch.city ? ` — ${branch.city}` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            </label>
          ) : (
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">{businessName || currentLabel}</p>
          )}
          <div className="ms-auto flex items-center gap-1.5 sm:gap-2">
            {saveStatus.pending ? (
              <Spinner className="shrink-0 text-subtle" label={t('merchantBusiness.saving')} />
            ) : saveStatus.notice ? (
              <p className="hidden max-w-48 truncate rounded-full bg-success-soft px-3 py-1 text-xs font-semibold text-success sm:block">{saveStatus.notice}</p>
            ) : null}
            <div className="relative hidden md:block">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <input
                id="workspace-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('workspace.searchOrders')}
                className="h-10 w-56 rounded-xl border bg-card ps-9 pe-12 text-sm shadow-xs outline-none transition-[width,box-shadow] placeholder:text-subtle focus:w-72 focus:ring-4 focus:ring-primary/25 xl:w-64"
              />
              <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-subtle">⌘K</kbd>
              {!renewalDue && matches.length ? (
                <div className="absolute end-0 z-30 mt-2 w-64 rounded-2xl border bg-popover p-1.5 shadow-lg">
                  {matches.map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setQuery('')} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold hover:bg-muted">
                      <item.icon className="size-4 text-subtle" />
                      {t(`nav.${item.label}`)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" onClick={openStorefront} disabled={renewalDue || !profile?.slug} aria-label={t('workspace.viewStorefront')} className="hidden h-10 items-center gap-2 rounded-xl border bg-card px-3 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50 sm:inline-flex">
              <ExternalLink className="size-4" />
              <span className="hidden 2xl:inline">{t('workspace.viewStorefront')}</span>
            </button>
            {canSeeAlerts && !renewalDue ? <OrderAlerts orders={alerts.data?.liveOrders} /> : null}
            {renewalDue ? (
              <span className="grid size-10 place-items-center rounded-xl border bg-card text-faint" aria-hidden>
                <Bell className="size-[18px]" />
              </span>
            ) : canSeeAlerts ? (
              <Link href="/orders" className="relative grid size-10 place-items-center rounded-xl border bg-card text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground" aria-label={t('nav.orders')}>
                <Bell className="size-[18px]" />
                {attention > 0 ? (
                  <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background">{attention > 99 ? '99+' : attention}</span>
                ) : null}
              </Link>
            ) : null}
            <ThemeToggle className="hidden sm:grid" />
            <Link href={pathname} locale={locale === 'en' ? 'ar' : 'en'} aria-label={t('workspace.switchLanguage')} className="grid h-10 min-w-10 place-items-center rounded-xl border bg-card px-2 text-xs font-bold text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground">
              {locale === 'en' ? 'ع' : 'EN'}
            </Link>
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-xl p-0.5 text-start transition-colors hover:bg-muted md:pe-2"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label={`${me.data.firstName} ${me.data.lastName}`}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground">{initials}</span>
                <span className="hidden max-w-32 truncate text-sm font-semibold text-foreground xl:block">{me.data.firstName}</span>
                <ChevronDown className="hidden size-4 text-subtle xl:block" />
              </button>
              {profileOpen ? (
                <div role="menu" className="absolute end-0 z-30 mt-2 w-72 rounded-2xl border bg-popover p-2 shadow-lg">
                  <div className="flex items-center gap-3 rounded-xl p-2">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">{initials}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{me.data.firstName} {me.data.lastName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{me.data.email}</span>
                    </span>
                  </div>
                  <dl className="mx-2 mt-1 border-t py-3 text-sm">
                    <dt className="text-xs font-medium text-subtle">{t('workspace.role')}</dt>
                    <dd className="mt-0.5 font-semibold">{roleLabel(me.data, locale)}</dd>
                  </dl>
                  <ThemeMenuRow />
                  <button
                    type="button"
                    role="menuitem"
                    className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive-soft"
                    onClick={logout}
                  >
                    <LogOut className="size-4" />
                    {t('nav.logout')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-4 py-5 md:px-6 md:py-6 xl:min-h-0 xl:overflow-auto xl:px-8">
          {renewalDue && !onSubscription ? (
            <div className="grid min-h-[40vh] place-items-center px-6 text-center">
              <p className="max-w-md text-sm text-muted-foreground">{t('merchantSubscription.renewOnly')}</p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
      {renewalDue && !onSubscription ? (
        <RenewalDialog
          date={profile?.subscription?.currentPeriodEnd}
          plan={profile?.subscription?.plan?.name}
          locale={locale === 'ar' ? 'ar' : 'en'}
          onRenew={me.data.roles.includes('MERCHANT_OWNER') ? () => router.push('/subscription') : undefined}
          onLogout={logout}
        />
      ) : null}
      {needsBusinessSetup && !renewalDue ? <BusinessSetupDialog profile={business.data as SetupProfile | undefined} /> : null}
    </div>
    </SaveStatusContext.Provider>
    </WorkspaceBranchContext.Provider>
  );
}

type SidebarItem = { href: string; icon: typeof LayoutGrid; label: string; active: boolean; disabled: boolean; count: number };

function SidebarContent({
  home,
  businessName,
  planName,
  groups: navGroups,
  user,
  logoutLabel,
  workspaceLabel,
  onLogout,
}: {
  home: string;
  businessName: string;
  planName: string;
  groups: { label: string; items: SidebarItem[] }[];
  user: { initials: string; name: string; role: string };
  logoutLabel: string;
  workspaceLabel: string;
  onLogout: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pb-4 pt-5">
        <Link href={home} className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
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
        {businessName ? (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-sidebar-border bg-white/[0.03] p-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Store className="size-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">{businessName}</span>
              <span className="block truncate text-[11px] font-medium text-sidebar-muted">{planName || workspaceLabel}</span>
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">{workspaceLabel}</p>
        )}
      </div>
      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 pb-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-2xl p-2">
          <span className="relative grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary text-xs font-bold text-primary-foreground">
            {user.initials}
            <span className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full border-2 border-sidebar bg-[#3cc68a]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-white">{user.name}</span>
            <span className="block truncate text-[11px] text-sidebar-muted">{user.role}</span>
          </span>
          <button type="button" className="grid size-9 shrink-0 place-items-center rounded-xl text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-white" aria-label={logoutLabel} title={logoutLabel} onClick={onLogout}>
            <LogOut className="size-4 rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NavLink({ href, active, icon: Icon, label, disabled = false, count }: SidebarItem) {
  if (disabled) {
    return (
      <span aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-white/25">
        <Icon className="size-[18px]" />
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-sidebar-active text-white' : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-white'}`}
    >
      {active ? <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-primary" /> : null}
      <Icon className={`size-[18px] shrink-0 ${active ? 'text-primary' : 'text-sidebar-muted group-hover:text-white'}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{count > 99 ? '99+' : count}</span> : null}
    </Link>
  );
}

function ThemeMenuRow() {
  const t = useTranslations('workspace');
  const { resolved, setChoice } = useTheme();
  const dark = resolved === 'dark';
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={dark}
      onClick={() => setChoice(dark ? 'light' : 'dark')}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
    >
      <Moon className="size-4 text-subtle" />
      <span className="flex-1 text-start">{t('darkMode')}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${dark ? 'bg-primary' : 'bg-surface-2'}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-[inset-inline-start] ${dark ? 'start-[18px]' : 'start-0.5'}`} />
      </span>
    </button>
  );
}

function RenewalDialog({
  date,
  plan,
  locale,
  onRenew,
  onLogout,
}: {
  date?: string;
  plan?: { en?: string; ar?: string };
  locale: 'en' | 'ar';
  /** Only the owner can renew; other staff are told to ask them. */
  onRenew?: () => void;
  onLogout: () => void;
}) {
  const t = useTranslations('merchantSubscription');
  const nav = useTranslations('nav');
  const formatted = date
    ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bahrain' }).format(new Date(date))
    : '';
  const planName = plan ? pickLocalized(plan, locale) : '';
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        hideClose
        className="w-[min(100%-2rem,28rem)]"
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft">
          <Crown className="size-6" />
        </span>
        <DialogTitle className="mt-4 text-2xl">{t('renewTitle')}</DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-muted-foreground">{onRenew ? t('renewBody', { date: formatted }) : t('renewAskOwner', { date: formatted })}</DialogDescription>
        {planName ? <p className="mt-3 text-sm font-semibold text-foreground">{planName}</p> : null}
        {onRenew ? (
          <button type="button" className="mt-5 h-11 w-full rounded-xl bg-secondary text-sm font-semibold text-secondary-foreground" onClick={onRenew}>
            {t('renewNow')}
          </button>
        ) : null}
        <button type="button" className="mt-2 h-11 w-full rounded-xl border border-border text-sm font-semibold text-foreground" onClick={onLogout}>
          {nav('logout')}
        </button>
      </DialogContent>
    </Dialog>
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

