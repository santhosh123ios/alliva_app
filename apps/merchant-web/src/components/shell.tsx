import { api } from '@/components/providers';
import { BusinessSetupDialog, type SetupProfile } from '@/components/business-setup';
import { OrderAlerts } from '@/components/order-alerts';
import { canOpen, hasPermission, isKitchenOnly, isRider } from '@/lib/roles';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import { Dialog, DialogContent, DialogDescription, DialogTitle, ShellSkeleton, Spinner } from '@alliva/ui';
import type { AuthUser } from '@alliva/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, ChefHat, ChevronDown, ChevronRight, Crown, LayoutGrid, Package, Route, Search, Settings, ShoppingCart, Store, Ticket, Users, UtensilsCrossed, Wallet } from 'lucide-react';
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
  useEffect(() => {
    if (!isPublic && rider) router.replace('/rider');
    else if (!isPublic && kitchenOnly) router.replace('/kitchen');
  }, [isPublic, rider, kitchenOnly, router]);
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
  if (!me.data || (me.data.merchantId && business.isLoading)) return <ShellSkeleton variant="light" />;
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

  return (
    <WorkspaceBranchContext.Provider value={branchValue}>
    <SaveStatusContext.Provider value={setSaveStatus}>
    <div className="min-h-screen bg-[#F7F7F5] md:grid md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col border-e border-[#EEEEEC] bg-white text-[#161616] md:sticky md:top-0 md:h-screen">
        <Link href={renewalDue ? '/subscription' : '/dashboard'} className="flex items-center gap-3 px-5 pb-2 pt-5">
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
                  <NavLink key={item.href} href={item.href} active={pathname === item.href} icon={item.icon} label={t(`nav.${item.label}`)} disabled={renewalDue && item.href !== '/subscription'} />
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
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 bg-[#F7F7F5] px-4 md:px-6">
          {branches.length ? (
            <label className="relative hidden min-w-0 sm:block">
              <span className="sr-only">{t('workspace.merchant')}</span>
              <select
                value={branchId}
                onChange={(event) => setPickedBranch(event.target.value)}
                className="h-10 max-w-[240px] appearance-none truncate rounded-xl border border-[#E6E6E2] bg-white ps-3 pe-8 text-sm font-semibold text-[#161616] outline-none"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {pickLocalized(branch.name, locale === 'ar' ? 'ar' : 'en')}{branch.city ? ` — ${branch.city}` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2 text-[#8A8A86]" />
            </label>
          ) : (
            <p className="min-w-0 truncate text-sm font-semibold text-[#161616]">{profile?.name ? pickLocalized(profile.name, locale === 'ar' ? 'ar' : 'en') : currentLabel}</p>
          )}
          <div className="ms-auto flex items-center gap-2 md:gap-3">
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
                placeholder={t('workspace.searchOrders')}
                className="h-10 w-64 rounded-full border bg-white ps-9 pe-14 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
              <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded-md border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">⌘K</kbd>
              {!renewalDue && matches.length ? (
                <div className="absolute end-0 z-30 mt-2 w-64 rounded-2xl border bg-white p-2 shadow-lg">
                  {matches.map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setQuery('')} className="block rounded-xl px-3 py-2 text-sm font-semibold hover:bg-muted">
                      {t(`nav.${item.label}`)}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" onClick={openStorefront} disabled={renewalDue || !profile?.slug} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold text-[#161616] disabled:opacity-50">
              <Store className="size-4" />
              <span className="hidden lg:inline">{t('workspace.viewStorefront')}</span>
            </button>
            {canSeeAlerts && !renewalDue ? <OrderAlerts orders={alerts.data?.liveOrders} /> : null}
            {renewalDue ? (
              <span className="grid size-10 place-items-center rounded-full border border-[#E6E6E2] bg-white text-[#C4C4C0]" aria-hidden>
                <Bell className="size-4" />
              </span>
            ) : canSeeAlerts ? (
              <Link href="/orders" className="relative grid size-10 place-items-center rounded-full border border-[#E6E6E2] bg-white" aria-label={t('nav.orders')}>
                <Bell className="size-4" />
                {attention > 0 ? <span className="absolute end-2 top-2 size-2 rounded-full bg-primary" /> : null}
              </Link>
            ) : null}
            <Link href={pathname} locale={locale === 'en' ? 'ar' : 'en'} className="grid h-10 min-w-10 place-items-center rounded-xl border bg-white px-2 text-xs font-semibold">
              {locale === 'en' ? 'EN' : 'AR'}
            </Link>
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full pe-1 ps-1 text-start"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-label={`${me.data.firstName} ${me.data.lastName}`}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="grid size-9 place-items-center rounded-full bg-[#F1F1EE] text-xs font-semibold">{initials}</span>
                <span className="hidden max-w-32 truncate text-sm font-semibold text-[#161616] md:block">{me.data.firstName} {me.data.lastName}</span>
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
        <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col p-4 md:p-6 xl:min-h-0 xl:overflow-auto">
          {renewalDue && !onSubscription ? (
            <div className="grid min-h-[40vh] place-items-center px-6 text-center">
              <p className="max-w-md text-sm text-[#696965]">{t('merchantSubscription.renewOnly')}</p>
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
          onLogout={() => api.logout().then(() => { client.clear(); router.replace('/login'); })}
        />
      ) : null}
      {needsBusinessSetup && !renewalDue ? <BusinessSetupDialog profile={business.data as SetupProfile | undefined} /> : null}
    </div>
    </SaveStatusContext.Provider>
    </WorkspaceBranchContext.Provider>
  );
}

function NavLink({ href, active, icon: Icon, label, disabled = false }: { href: string; active: boolean; icon: typeof LayoutGrid; label: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <span aria-disabled="true" className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#C4C4C0]">
        <Icon className="size-4" />
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${active ? 'bg-primary text-[#111111]' : 'text-[#3A3A36] hover:bg-[#F7F7F5]'}`}>
      <Icon className="size-4" />
      {label}
    </Link>
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
        <span className="grid size-12 place-items-center rounded-2xl bg-[#FFF6CC]">
          <Crown className="size-6" />
        </span>
        <DialogTitle className="mt-4 text-2xl">{t('renewTitle')}</DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-[#696965]">{onRenew ? t('renewBody', { date: formatted }) : t('renewAskOwner', { date: formatted })}</DialogDescription>
        {planName ? <p className="mt-3 text-sm font-semibold text-[#161616]">{planName}</p> : null}
        {onRenew ? (
          <button type="button" className="mt-5 h-11 w-full rounded-xl bg-[#111111] text-sm font-semibold text-white" onClick={onRenew}>
            {t('renewNow')}
          </button>
        ) : null}
        <button type="button" className="mt-2 h-11 w-full rounded-xl border border-[#E6E6E2] text-sm font-semibold text-[#161616]" onClick={onLogout}>
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

