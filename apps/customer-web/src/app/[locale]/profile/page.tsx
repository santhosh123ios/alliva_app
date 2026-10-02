'use client';

import { api } from '@/components/providers';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { areas, usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import {
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  Skeleton,
} from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Box,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Crown,
  FileText,
  Gift,
  Globe,
  Heart,
  LayoutGrid,
  LogOut,
  MapPin,
  Pencil,
  RotateCcw,
  Store,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type Section = 'overview' | 'addresses' | 'payments' | 'notifications' | 'help';
type AccountUser = Awaited<ReturnType<typeof api.me>>;

type CustomerProfile = {
  rewardBalance?: string | number;
  addresses?: {
    id: string;
    label: string;
    line1: string;
    line2?: string | null;
    city: string;
    isDefault?: boolean;
    deletedAt?: string | null;
  }[];
  favourites?: { merchantId: string }[];
  paymentMethods?: { id: string; brand: string; last4: string }[];
};

type LatestOrder = {
  id: string;
  status: string;
  merchantName: { en?: string; ar?: string };
  merchantSlug: string;
  items: { quantity: number }[];
  pricing: { total: string };
  createdAt: string;
};

export default function ProfilePage() {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const signedIn = me.data?.kind === 'CUSTOMER';
  const customer = useQuery({
    queryKey: ['customer'],
    queryFn: () => api.customer(),
    enabled: signedIn,
    retry: false,
  });
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: signedIn,
    retry: false,
  });
  const home = useQuery({
    queryKey: ['home', area.id],
    queryFn: () => api.home(`?lat=${encodeURIComponent(area.lat)}&lng=${encodeURIComponent(area.lng)}`),
    enabled: signedIn && Boolean(orders.data?.length),
  });
  const [section, setSection] = useState<Section>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [alerts, toggleAlerts] = useOrderAlerts();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [section]);

  const logout = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me'] });
      router.push('/');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (me.isLoading) return <AccountSkeleton />;
  if (!me.data || me.data.kind !== 'CUSTOMER') {
    return (
      <Card className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-2xl">{t('nav.profile')}</h1>
        <p className="text-sm text-[#6f6f6a]">{t('customer.account.signIn')}</p>
        <Button asChild variant="yellow">
          <Link href="/login">{t('auth.signIn')}</Link>
        </Button>
      </Card>
    );
  }

  const profile = (customer.data ?? {}) as CustomerProfile;
  const addresses = (profile.addresses ?? []).filter((address) => !address.deletedAt);
  const latest = [...(orders.data ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0] as LatestOrder | undefined;
  const logo = latest
    ? (home.data?.merchants.find((merchant) => merchant.slug === latest.merchantSlug)?.logoUrl ?? null)
    : null;
  const user = me.data;

  const invite = async () => {
    const url = window.location.origin;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Alliva', text: t('customer.account.shareLong'), url });
        return;
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('customer.linkCopied'));
    } catch {
      toast.error(t('customer.account.copyFailed'));
    }
  };

  return (
    <div className="lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <aside className="hidden lg:sticky lg:top-24 lg:block">
        <Sidebar
          user={user}
          section={section}
          onSection={setSection}
          onEdit={() => setEditOpen(true)}
          onLogout={() => logout.mutate()}
        />
      </aside>
      <div className="min-w-0">
        {section === 'overview' ? (
          <>
            <div className="lg:hidden">
              <MobileOverview
                user={user}
                orderCount={orders.data?.length ?? 0}
                favouriteCount={profile.favourites?.length ?? 0}
                rewards={formatPoints(profile.rewardBalance, locale)}
                countsLoading={customer.isLoading || orders.isLoading}
                alerts={alerts}
                onToggleAlerts={toggleAlerts}
                onSection={setSection}
                onEdit={() => setEditOpen(true)}
                onInvite={() => void invite()}
                onLogout={() => logout.mutate()}
              />
            </div>
            <div className="hidden lg:block">
              <DesktopOverview
                user={user}
                locale={locale}
                orderCount={orders.data?.length ?? 0}
                favouriteCount={profile.favourites?.length ?? 0}
                rewards={formatPoints(profile.rewardBalance, locale)}
                countsLoading={customer.isLoading || orders.isLoading}
                latest={latest ?? null}
                logo={logo}
                ordersLoading={orders.isLoading}
                ordersError={orders.error ? (orders.error as Error).message : null}
                alerts={alerts}
                onToggleAlerts={toggleAlerts}
                onSection={setSection}
                onEdit={() => setEditOpen(true)}
                onInvite={() => void invite()}
              />
            </div>
          </>
        ) : (
          <SectionPanel
            section={section}
            addresses={addresses}
            payments={profile.paymentMethods ?? []}
            alerts={alerts}
            onToggleAlerts={toggleAlerts}
            onBack={() => setSection('overview')}
          />
        )}
      </div>
      <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} user={user} />
    </div>
  );
}

function MobileOverview({
  user,
  orderCount,
  favouriteCount,
  rewards,
  countsLoading,
  alerts,
  onToggleAlerts,
  onSection,
  onEdit,
  onInvite,
  onLogout,
}: {
  user: AccountUser;
  orderCount: number;
  favouriteCount: number;
  rewards: string;
  countsLoading: boolean;
  alerts: boolean;
  onToggleAlerts: () => void;
  onSection: (section: Section) => void;
  onEdit: () => void;
  onInvite: () => void;
  onLogout: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const stats = [
    { icon: FileText, value: formatCount(orderCount, locale), label: t('customer.account.orders'), loading: countsLoading },
    { icon: Heart, value: formatCount(favouriteCount, locale), label: t('customer.account.favorites'), loading: countsLoading },
    { icon: Crown, value: rewards, label: t('customer.account.rewards'), loading: countsLoading },
  ];
  return (
    <div className="mx-auto max-w-md space-y-7">
      <section className="relative">
        <div className="relative overflow-hidden rounded-[1.7rem] bg-primary px-4 pt-5 pb-16">
          <RouteArt />
          <div className="relative z-10 flex items-start gap-3">
            <Avatar initials={initials(user.firstName, user.lastName)} />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate text-lg leading-tight font-bold">{fullName(user)}</p>
              {user.phone ? <p className="mt-1 truncate text-[13px]">{formatPhone(user.phone)}</p> : null}
              <p className="truncate text-[13px]">{user.email || t('customer.account.addEmail')}</p>
              <EditButton className="mt-3" label={t('customer.account.editProfile')} onClick={onEdit} />
            </div>
          </div>
        </div>
        <div className="relative z-10 -mt-11 px-3">
          <div className="grid grid-cols-3 rounded-2xl bg-white py-3 shadow-[0_10px_28px_rgba(17,17,17,0.08)] ring-1 ring-black/[0.04]">
            {stats.map((stat, index) => (
              <div
                key={stat.label}
                className={cn('flex flex-col items-center gap-1 px-1 text-center', index > 0 && 'border-s border-[#f0f0ec]')}
              >
                <IconBadge icon={stat.icon} tone="soft" />
                {stat.loading ? (
                  <Skeleton className="mt-1 h-5 w-8" />
                ) : (
                  <span className="text-lg leading-none font-bold">{stat.value}</span>
                )}
                <span className="text-[11px] text-[#8a8a86]">{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base">{t('customer.account.yourAccount')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <AccountTile href="/orders" icon={Box} title={t('customer.account.myOrders')} hint={t('customer.account.trackReorder')} />
          <AccountTile icon={MapPin} title={t('customer.account.savedAddresses')} hint={t('customer.account.addressesHint')} onClick={() => onSection('addresses')} />
          <AccountTile href="/favourites" icon={Heart} title={t('customer.account.favorites')} hint={t('customer.account.favoritesHint')} />
          <AccountTile icon={CreditCard} title={t('customer.account.paymentMethods')} hint={t('customer.account.paymentsHint')} onClick={() => onSection('payments')} />
        </div>
        <button
          type="button"
          onClick={onInvite}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-[#fff6d0] p-3.5 text-start"
        >
          <IconBadge icon={Gift} tone="solid" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t('customer.account.shareEarn')}</span>
            <span className="block text-xs text-[#6f6f6a]">{t('customer.account.shareHint')}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-[#b0b0aa] rtl:rotate-180" />
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-base">{t('customer.account.preferencesSupport')}</h2>
        <PreferencesList
          alerts={alerts}
          onToggleAlerts={onToggleAlerts}
          onNotifications={() => onSection('notifications')}
          onHelp={() => onSection('help')}
          onLogout={onLogout}
          showSwitch={false}
        />
      </section>
    </div>
  );
}

function DesktopOverview({
  user,
  locale,
  orderCount,
  favouriteCount,
  rewards,
  countsLoading,
  latest,
  logo,
  ordersLoading,
  ordersError,
  alerts,
  onToggleAlerts,
  onSection,
  onEdit,
  onInvite,
}: {
  user: AccountUser;
  locale: 'en' | 'ar';
  orderCount: number;
  favouriteCount: number;
  rewards: string;
  countsLoading: boolean;
  latest: LatestOrder | null;
  logo: string | null;
  ordersLoading: boolean;
  ordersError: string | null;
  alerts: boolean;
  onToggleAlerts: () => void;
  onSection: (section: Section) => void;
  onEdit: () => void;
  onInvite: () => void;
}) {
  const t = useTranslations();
  const stats = [
    { icon: FileText, value: formatCount(orderCount, locale), label: t('customer.account.totalOrders'), loading: countsLoading },
    { icon: Heart, value: formatCount(favouriteCount, locale), label: t('customer.account.favorites'), loading: countsLoading },
    { icon: Crown, value: rewards, label: t('customer.account.rewardPoints'), loading: countsLoading },
  ];
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs text-[#8d8d88]">
          <Link href="/" className="hover:text-[#111]">{t('nav.home')}</Link>
          <span className="px-1.5">/</span>
          <span>{t('nav.profile')}</span>
        </p>
        <h1 className="mt-2 text-4xl tracking-[-0.03em]">{t('customer.account.title')}</h1>
        <p className="mt-1 text-sm text-[#6f6f6a]">{t('customer.account.subtitle')}</p>
      </header>

      <section className="relative overflow-hidden rounded-[1.75rem] bg-primary p-5 sm:p-6">
        <RouteArt />
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-2xl tracking-[-0.02em]">{t('customer.account.welcome', { name: user.firstName })}</h2>
              <p className="mt-1 text-sm">{t('customer.account.activity')}</p>
            </div>
            <EditButton label={t('customer.account.editProfile')} onClick={onEdit} />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-[0_8px_20px_rgba(17,17,17,0.06)]">
                <IconBadge icon={stat.icon} tone="soft" />
                <span className="min-w-0">
                  {stat.loading ? (
                    <Skeleton className="h-6 w-10" />
                  ) : (
                    <span className="block text-xl leading-none font-bold">{stat.value}</span>
                  )}
                  <span className="mt-1 block text-xs text-[#8a8a86]">{stat.label}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base">{t('customer.account.quickAccess')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <AccountTile href="/orders" icon={Box} title={t('customer.account.myOrders')} hint={t('customer.account.trackActive')} />
          <AccountTile icon={MapPin} title={t('customer.account.savedAddresses')} hint={t('customer.account.addressesLong')} onClick={() => onSection('addresses')} />
          <AccountTile href="/favourites" icon={Heart} title={t('customer.account.favorites')} hint={t('customer.account.favoritesLong')} />
          <AccountTile icon={CreditCard} title={t('customer.account.paymentMethods')} hint={t('customer.account.paymentsLong')} onClick={() => onSection('payments')} />
        </div>
      </section>

      <div className="flex items-center gap-3 rounded-2xl bg-[#fff6d0] px-4 py-3.5">
        <IconBadge icon={Gift} tone="solid" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('customer.account.shareEarn')}</p>
          <p className="text-sm text-[#6f6f6a]">{t('customer.account.shareLong')}</p>
        </div>
        <Button variant="black" className="h-10 shrink-0 rounded-full px-4" onClick={onInvite}>
          {t('customer.account.invite')}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentOrderCard order={latest} logo={logo} locale={locale} loading={ordersLoading} error={ordersError} />
        <section className="rounded-2xl border border-[#ecece8] bg-white p-4">
          <h2 className="text-base">{t('customer.account.preferences')}</h2>
          <div className="mt-1">
            <PreferencesList
              alerts={alerts}
              onToggleAlerts={onToggleAlerts}
              onNotifications={() => onSection('notifications')}
              onHelp={() => onSection('help')}
              showSwitch
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  section,
  onSection,
  onEdit,
  onLogout,
}: {
  user: AccountUser;
  section: Section;
  onSection: (section: Section) => void;
  onEdit: () => void;
  onLogout: () => void;
}) {
  const t = useTranslations();
  const items: { key: string; icon: LucideIcon; label: string; href?: string; section?: Section }[] = [
    { key: 'overview', icon: LayoutGrid, label: t('customer.account.overview'), section: 'overview' },
    { key: 'orders', icon: Box, label: t('customer.account.myOrders'), href: '/orders' },
    { key: 'addresses', icon: MapPin, label: t('customer.account.savedAddresses'), section: 'addresses' },
    { key: 'favorites', icon: Heart, label: t('customer.account.favorites'), href: '/favourites' },
    { key: 'payments', icon: CreditCard, label: t('customer.account.paymentMethods'), section: 'payments' },
    { key: 'notifications', icon: Bell, label: t('customer.account.notifications'), section: 'notifications' },
    { key: 'help', icon: CircleHelp, label: t('customer.account.helpSupport'), section: 'help' },
  ];
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[1.6rem] bg-primary p-4">
        <RouteArt />
        <div className="relative z-10">
          <Avatar initials={initials(user.firstName, user.lastName)} />
          <p className="mt-3 text-lg leading-tight font-bold">{fullName(user)}</p>
          {user.phone ? <p className="mt-1 text-sm">{formatPhone(user.phone)}</p> : null}
          <p className="truncate text-sm">{user.email || t('customer.account.addEmail')}</p>
          <EditButton className="mt-3" label={t('customer.account.editProfile')} onClick={onEdit} />
        </div>
      </div>
      <nav className="space-y-1" aria-label={t('nav.profile')}>
        {items.map((item) => {
          const active = item.section != null && item.section === section;
          const className = cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm font-medium',
            active ? 'bg-primary font-semibold' : 'hover:bg-white',
          );
          const inner = (
            <>
              <item.icon className="size-4 shrink-0" strokeWidth={2} />
              <span className="truncate">{item.label}</span>
            </>
          );
          if (item.href) {
            return (
              <Link key={item.key} href={item.href} className={className}>
                {inner}
              </Link>
            );
          }
          return (
            <button key={item.key} type="button" className={className} aria-current={active ? 'page' : undefined} onClick={() => item.section && onSection(item.section)}>
              {inner}
            </button>
          );
        })}
        <button type="button" onClick={onLogout} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm font-semibold text-destructive hover:bg-white">
          <LogOut className="size-4 shrink-0" />
          {t('nav.logout')}
        </button>
      </nav>
    </div>
  );
}

function SectionPanel({
  section,
  addresses,
  payments,
  alerts,
  onToggleAlerts,
  onBack,
}: {
  section: Exclude<Section, 'overview'>;
  addresses: NonNullable<CustomerProfile['addresses']>;
  payments: NonNullable<CustomerProfile['paymentMethods']>;
  alerts: boolean;
  onToggleAlerts: () => void;
  onBack: () => void;
}) {
  const t = useTranslations();
  const title = {
    addresses: t('customer.account.savedAddresses'),
    payments: t('customer.account.paymentMethods'),
    notifications: t('customer.account.notifications'),
    help: t('customer.account.helpSupport'),
  }[section];
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold lg:hidden">
        <ChevronLeft className="size-4 rtl:rotate-180" />
        {t('customer.back')}
      </button>
      <h1 className="text-2xl tracking-tight lg:text-3xl">{title}</h1>
      <div className="mt-5">
        {section === 'addresses' ? <AddressesPanel addresses={addresses} /> : null}
        {section === 'payments' ? <PaymentsPanel payments={payments} /> : null}
        {section === 'notifications' ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#ecece8] bg-white p-4">
            <div>
              <p className="font-semibold">{t('customer.account.notifications')}</p>
              <p className="text-sm text-[#6f6f6a]">{t('customer.account.notificationsHint')}</p>
            </div>
            <Switch on={alerts} onToggle={onToggleAlerts} label={t('customer.account.notifications')} />
          </div>
        ) : null}
        {section === 'help' ? <HelpPanel /> : null}
      </div>
    </div>
  );
}

function AddressesPanel({ addresses }: { addresses: NonNullable<CustomerProfile['addresses']> }) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const areaId = usePlace((state) => state.area);
  const [label, setLabel] = useState('');
  const [line1, setLine1] = useState('');
  const [cityId, setCityId] = useState(areaId);
  const save = useMutation({
    mutationFn: () => {
      const city = areas.find((item) => item.id === cityId) ?? areas[0]!;
      return api.addAddress({
        label: label.trim() || 'Home',
        line1: line1.trim(),
        city: city.en,
        latitude: city.lat,
        longitude: city.lng,
      });
    },
    onSuccess: async () => {
      setLine1('');
      toast.success(t('customer.account.addressSaved'));
      await client.invalidateQueries({ queryKey: ['customer'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="space-y-4">
      {addresses.length ? (
        <ul className="space-y-3">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-start gap-3 rounded-2xl border border-[#ecece8] bg-white p-4">
              <IconBadge icon={MapPin} tone="soft" />
              <div className="min-w-0">
                <p className="font-semibold">{address.label}</p>
                <p className="text-sm text-[#6f6f6a]">{address.line1}</p>
                <p className="text-sm text-[#6f6f6a]">{address.city}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-[#e4e4de] bg-white px-4 py-8 text-center text-sm text-[#6f6f6a]">
          {t('customer.account.noAddresses')}
        </p>
      )}
      <form
        className="space-y-3 rounded-2xl border border-[#ecece8] bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!line1.trim()) {
            toast.error(t('customer.account.checkForm'));
            return;
          }
          save.mutate();
        }}
      >
        <h2 className="text-base">{t('customer.account.newAddress')}</h2>
        <Label htmlFor="address-label">{t('customer.account.addressLabel')}</Label>
        <Input id="address-label" value={label} placeholder="Home" onChange={(event) => setLabel(event.target.value)} />
        <Label htmlFor="address-line">{t('customer.account.addressLine')}</Label>
        <Input id="address-line" value={line1} onChange={(event) => setLine1(event.target.value)} />
        <Label htmlFor="address-city">{t('customer.account.city')}</Label>
        <select
          id="address-city"
          value={cityId}
          onChange={(event) => setCityId(event.target.value)}
          className="flex h-12 w-full rounded-xl border border-input bg-white px-3 text-sm"
        >
          {areas.map((item) => (
            <option key={item.id} value={item.id}>
              {locale === 'ar' ? item.ar : item.en}
            </option>
          ))}
        </select>
        <Button type="submit" variant="yellow" loading={save.isPending}>
          {t('customer.account.saveAddress')}
        </Button>
      </form>
    </div>
  );
}

function PaymentsPanel({ payments }: { payments: NonNullable<CustomerProfile['paymentMethods']> }) {
  const t = useTranslations();
  if (!payments.length) {
    return (
      <p className="rounded-2xl border border-dashed border-[#e4e4de] bg-white px-4 py-8 text-center text-sm text-[#6f6f6a]">
        {t('customer.account.noPayments')}
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {payments.map((method) => (
        <li key={method.id} className="flex items-center gap-3 rounded-2xl border border-[#ecece8] bg-white p-4">
          <IconBadge icon={CreditCard} tone="soft" />
          <div>
            <p className="font-semibold">{method.brand}</p>
            <p className="text-sm text-[#6f6f6a]">•••• {method.last4}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HelpPanel() {
  const t = useTranslations();
  return (
    <div className="rounded-2xl border border-[#ecece8] bg-white p-5">
      <p className="text-sm leading-6 text-[#3f3f3c]">{t('customer.account.helpBody')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline" className="h-10 rounded-full px-4">
          <Link href="/legal/terms">{t('customer.terms')}</Link>
        </Button>
        <Button asChild variant="outline" className="h-10 rounded-full px-4">
          <Link href="/legal/privacy">{t('customer.privacy')}</Link>
        </Button>
      </div>
    </div>
  );
}

function RecentOrderCard({
  order,
  logo,
  locale,
  loading,
  error,
}: {
  order: LatestOrder | null;
  logo: string | null;
  locale: 'en' | 'ar';
  loading: boolean;
  error: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const reorder = useMutation({
    mutationFn: (id: string) => api.reorder(id),
    onSuccess: () => router.push('/cart'),
    onError: (reorderError: Error) => toast.error(reorderError.message),
  });
  return (
    <section className="rounded-2xl border border-[#ecece8] bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base">{t('customer.account.recentOrder')}</h2>
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-semibold">
          {t('customer.account.viewAll')}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </Link>
      </div>
      {loading ? <Skeleton className="h-24 w-full" /> : null}
      {!loading && error ? <p className="text-sm text-[#6f6f6a]">{error}</p> : null}
      {!loading && !error && !order ? <p className="text-sm text-[#6f6f6a]">{t('customer.account.noOrders')}</p> : null}
      {!loading && !error && order ? (
        <>
          <div className="flex gap-3">
            <MerchantThumb src={logo} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{pickLocalized(order.merchantName, locale)}</p>
                    <StatusBadge status={order.status} />
                  </div>
                  <p className="mt-1 text-xs text-[#8a8a86]">
                    {t('customer.account.orderMeta', {
                      count: order.items.reduce((sum, item) => sum + item.quantity, 0),
                      date: formatWhen(order.createdAt, locale),
                    })}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold">{formatMoney(order.pricing.total, locale)}</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Link href={`/orders/${order.id}`} className="inline-flex h-10 items-center rounded-xl border border-[#e4e4de] bg-white px-4 text-sm font-semibold">
              {t('customer.account.viewDetails')}
            </Link>
            <button
              type="button"
              disabled={reorder.isPending}
              onClick={() => reorder.mutate(order.id)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold disabled:opacity-60"
            >
              <RotateCcw className="size-4" />
              {t('customer.account.reorder')}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function PreferencesList({
  alerts,
  onToggleAlerts,
  onNotifications,
  onHelp,
  onLogout,
  showSwitch,
}: {
  alerts: boolean;
  onToggleAlerts: () => void;
  onNotifications: () => void;
  onHelp: () => void;
  onLogout?: () => void;
  showSwitch: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const pathname = usePathname();
  const languageName = locale === 'ar' ? 'العربية' : 'English';
  const row = 'flex w-full items-center gap-3 px-4 py-3.5 text-start text-sm font-semibold';
  return (
    <div className={cn('overflow-hidden bg-white', showSwitch ? '' : 'rounded-[1.25rem] border border-[#ecece8]')}>
      {showSwitch ? (
        <div className="flex items-center gap-3 border-t border-[#f1f1ec] px-1 py-3">
          <Bell className="size-[1.15rem] shrink-0" />
          <span className="min-w-0 flex-1 text-sm font-semibold">{t('customer.account.notifications')}</span>
          <Switch on={alerts} onToggle={onToggleAlerts} label={t('customer.account.notifications')} />
        </div>
      ) : (
        <button type="button" onClick={onNotifications} className={row}>
          <Bell className="size-[1.15rem] shrink-0" />
          <span className="min-w-0 flex-1">{t('customer.account.notifications')}</span>
          <ChevronRight className="size-4 text-[#b0b0aa] rtl:rotate-180" />
        </button>
      )}
      <Link href={pathname} locale={locale === 'ar' ? 'en' : 'ar'} className={cn(row, 'border-t border-[#f1f1ec]', showSwitch && 'px-1')}>
        <Globe className="size-[1.15rem] shrink-0" />
        <span className="min-w-0 flex-1">{t('customer.account.language')}</span>
        <span className="text-sm font-medium text-[#8a8a86]">{languageName}</span>
        <ChevronRight className="size-4 text-[#b0b0aa] rtl:rotate-180" />
      </Link>
      <button type="button" onClick={onHelp} className={cn(row, 'border-t border-[#f1f1ec]', showSwitch && 'px-1')}>
        <CircleHelp className="size-[1.15rem] shrink-0" />
        <span className="min-w-0 flex-1">{t('customer.account.helpSupport')}</span>
        <ChevronRight className="size-4 text-[#b0b0aa] rtl:rotate-180" />
      </button>
      <Link href="/legal/terms" className={cn(row, 'border-t border-[#f1f1ec]', showSwitch && 'px-1')}>
        <FileText className="size-[1.15rem] shrink-0" />
        <span className="min-w-0 flex-1">{t('customer.account.termsPrivacy')}</span>
        <ChevronRight className="size-4 text-[#b0b0aa] rtl:rotate-180" />
      </Link>
      {onLogout ? (
        <button type="button" onClick={onLogout} className={cn(row, 'border-t border-[#f1f1ec] text-destructive')}>
          <LogOut className="size-[1.15rem] shrink-0" />
          <span className="min-w-0 flex-1">{t('nav.logout')}</span>
          <ChevronRight className="size-4 rtl:rotate-180" />
        </button>
      ) : null}
    </div>
  );
}

function EditProfileDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AccountUser;
}) {
  const t = useTranslations();
  const router = useRouter();
  const client = useQueryClient();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [email, setEmail] = useState(user.email ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setEmail(user.email ?? '');
    setConfirmDelete(false);
  }, [open, user]);
  const save = useMutation({
    mutationFn: () =>
      api.request('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me'] });
      toast.success(t('customer.account.profileSaved'));
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: async () => {
      await api.request('/api/customers/me/delete', { method: 'POST' });
      await api.logout().catch(() => undefined);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['me'] });
      onOpenChange(false);
      router.push('/');
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {confirmDelete ? (
          <>
            <DialogTitle>{t('customer.account.deleteAccount')}</DialogTitle>
            <DialogDescription>{t('customer.account.deleteBody')}</DialogDescription>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
              <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
                {t('customer.account.deleteAccount')}
              </Button>
            </div>
          </>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              const validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
              if (!firstName.trim() || !lastName.trim() || !validEmail) {
                toast.error(t('customer.account.checkForm'));
                return;
              }
              save.mutate();
            }}
          >
            <DialogTitle>{t('customer.account.editProfile')}</DialogTitle>
            <DialogDescription>{user.phone ? formatPhone(user.phone) : t('customer.account.phone')}</DialogDescription>
            <Label htmlFor="profile-first">{t('customer.account.firstName')}</Label>
            <Input id="profile-first" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" />
            <Label htmlFor="profile-last">{t('customer.account.lastName')}</Label>
            <Input id="profile-last" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" />
            <Label htmlFor="profile-email">{t('customer.account.email')}</Label>
            <Input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            <div className="flex justify-end pt-1">
              <Button type="submit" variant="yellow" loading={save.isPending}>{t('common.save')}</Button>
            </div>
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-semibold text-destructive">
              {t('customer.account.deleteAccount')}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountTile({
  href,
  icon,
  title,
  hint,
  onClick,
}: {
  href?: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick?: () => void;
}) {
  const className = 'flex w-full items-center gap-3 rounded-2xl border border-[#ecece8] bg-white p-3 text-start shadow-[0_1px_2px_rgba(17,17,17,0.03)] transition hover:border-[#e2e2dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111] focus-visible:ring-offset-2';
  const inner = (
    <>
      <IconBadge icon={icon} tone="solid" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-tight font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[#8a8a86]">{hint}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-[#b0b0aa] rtl:rotate-180" />
    </>
  );
  if (href) return <Link href={href} className={className}>{inner}</Link>;
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  const label = statusLabel(status, t);
  const delivered = status === 'DELIVERED';
  const failed = status === 'CANCELLED' || status === 'REFUNDED';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        delivered && 'bg-[#e7f6ee] text-[#168a52]',
        failed && 'bg-[#fdecec] text-destructive',
        !delivered && !failed && 'bg-[#fff4cc] text-[#111]',
      )}
    >
      <span className={cn('size-1.5 rounded-full', delivered ? 'bg-[#168a52]' : failed ? 'bg-destructive' : 'bg-[#111]')} />
      {label}
    </span>
  );
}

function MerchantThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary">
        <Store className="size-6" />
      </span>
    );
  }
  return <img src={src} alt="" className="size-14 shrink-0 rounded-2xl object-cover" onError={() => setFailed(true)} />;
}

function Avatar({ initials: letters }: { initials: string }) {
  return (
    <span className="grid size-[4.5rem] shrink-0 place-items-center rounded-full bg-[#fff6d4] text-xl font-bold tracking-tight text-[#111] ring-4 ring-white/70">
      {letters}
    </span>
  );
}

function EditButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-[#111] shadow-[0_1px_2px_rgba(0,0,0,0.06)]',
        className,
      )}
    >
      <Pencil className="size-3.5" strokeWidth={2.25} />
      {label}
    </button>
  );
}

function IconBadge({ icon: Icon, tone }: { icon: LucideIcon; tone: 'solid' | 'soft' }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-[#111]',
        tone === 'solid' ? 'size-11 bg-primary' : 'size-10 bg-[#fff4cc]',
      )}
    >
      <Icon className={tone === 'solid' ? 'size-5' : 'size-4'} strokeWidth={2} />
    </span>
  );
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-primary' : 'bg-[#e6e6e1]')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition', on ? 'start-[22px]' : 'start-0.5')} />
    </button>
  );
}

function RouteArt() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 280 200"
      className="pointer-events-none absolute end-0 top-0 h-full w-[52%] text-[#111] rtl:-scale-x-100"
      fill="none"
    >
      <ellipse cx="214" cy="40" rx="78" ry="62" fill="#fff" fillOpacity="0.16" />
      <ellipse cx="248" cy="128" rx="46" ry="36" fill="#fff" fillOpacity="0.1" />
      <path
        d="M8 170C58 148 74 92 118 108c30 11 34-30 66-22 28 7 30 36 52 28"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1.6"
        strokeDasharray="2.5 5"
        strokeLinecap="round"
      />
      <path
        d="M188 46c-10.4 0-18.8 8.2-18.8 18.4 0 13.6 18.8 30.6 18.8 30.6s18.8-17 18.8-30.6c0-10.2-8.4-18.4-18.8-18.4z"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.8"
      />
      <circle cx="188" cy="64" r="5.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.8" />
    </svg>
  );
}

function AccountSkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-4 lg:max-w-none" aria-busy>
      <Skeleton className="h-44 rounded-[1.6rem]" />
      <Skeleton className="h-20 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function useOrderAlerts() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem('alliva-order-alerts') === '0') setOn(false);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () => {
    setOn((value) => {
      const next = !value;
      try {
        localStorage.setItem('alliva-order-alerts', next ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };
  return [on, toggle] as const;
}

function fullName(user: AccountUser) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function initials(first: string, last: string) {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || 'A';
}

function formatPhone(phone: string) {
  const compact = phone.replace(/\s+/g, '');
  const match = compact.match(/^(\+\d{3})(\d{4})(\d{4})$/);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : phone;
}

function formatCount(value: number, locale: 'en' | 'ar') {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-BH' : 'en').format(value);
}

function formatPoints(value: unknown, locale: 'en' | 'ar') {
  const amount = typeof value === 'number' ? value : Number(value ?? 0);
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-BH' : 'en', { maximumFractionDigits: 3 }).format(
    Number.isFinite(amount) ? amount : 0,
  );
}

function formatWhen(value: string, locale: 'en' | 'ar') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function statusLabel(status: string, t: (key: string) => string) {
  switch (status) {
    case 'PENDING':
      return t('customer.account.status.pending');
    case 'ACCEPTED':
      return t('customer.account.status.accepted');
    case 'PREPARING':
      return t('customer.account.status.preparing');
    case 'READY_FOR_PICKUP':
      return t('customer.account.status.ready');
    case 'ASSIGNED_TO_DRIVER':
      return t('customer.account.status.assigned');
    case 'OUT_FOR_DELIVERY':
      return t('customer.account.status.out');
    case 'DELIVERED':
      return t('customer.account.status.delivered');
    case 'CANCELLED':
      return t('customer.account.status.cancelled');
    case 'REFUNDED':
      return t('customer.account.status.refunded');
    default:
      return status;
  }
}
