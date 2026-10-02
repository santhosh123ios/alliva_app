'use client';

import { api } from '@/components/providers';
import { Link, useRouter } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, ErrorState, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bike,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  CreditCard,
  Headphones,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  SlidersHorizontal,
  Store,
  Utensils,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

type Order = Awaited<ReturnType<typeof api.orders>>[number];
type Tab = 'active' | 'past' | 'scheduled';
type Translator = ReturnType<typeof useTranslations>;

const ACTIVE = new Set(['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY']);
const PAST = new Set(['DELIVERED', 'CANCELLED', 'REFUNDED']);

export function orderStatusLabel(status: string, t: Translator) {
  switch (status) {
    case 'OUT_FOR_DELIVERY':
      return t('customer.orders.outForDelivery');
    case 'ASSIGNED_TO_DRIVER':
      return t('customer.orders.driverAssigned');
    case 'PREPARING':
      return t('customer.orders.preparing');
    case 'READY_FOR_PICKUP':
      return t('customer.orders.ready');
    case 'ACCEPTED':
      return t('customer.orders.confirmed');
    case 'DELIVERED':
      return t('customer.orders.delivered');
    case 'CANCELLED':
      return t('customer.orders.cancelled');
    case 'REFUNDED':
      return t('customer.orders.refunded');
    default:
      return t('customer.orders.placed');
  }
}

export function isScheduledOrder(order: { status: string; scheduledFor: string | null }) {
  if (!order.scheduledFor || PAST.has(order.status)) return false;
  return new Date(order.scheduledFor).getTime() > Date.now();
}

export function supportHref(number?: string) {
  const subject = number ? `Order ${number}` : 'Order help';
  return `mailto:support@alliva.bh?subject=${encodeURIComponent(subject)}`;
}

export function OrdersBoard() {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const client = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.orders(),
    enabled: me.data?.kind === 'CUSTOMER',
    retry: false,
  });
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const reorder = useMutation({
    mutationFn: (id: string) => api.reorder(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['cart'] });
      router.push('/cart');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!filterOpen) return;
    const close = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [filterOpen]);

  if (me.isLoading || (me.data?.kind === 'CUSTOMER' && orders.isLoading)) return <OrdersSkeleton />;
  if (me.data?.kind !== 'CUSTOMER') {
    return (
      <div className="mx-auto max-w-lg rounded-[28px] border border-[#ecece6] bg-white px-6 py-12 text-center">
        <h1 className="text-2xl">{t('customer.orders.signInTitle')}</h1>
        <p className="mt-2 text-sm text-[#6f6f6a]">{t('customer.orders.signInBody')}</p>
        <Link href="/login" className="mt-5 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-[#111]">
          {t('auth.signIn')}
        </Link>
      </div>
    );
  }
  if (orders.error || !orders.data) {
    return <ErrorState title={t('common.error')} body={(orders.error as Error | null)?.message ?? t('common.error')} />;
  }

  const all = orders.data;
  const active = all.filter((order) => ACTIVE.has(order.status) && !isScheduledOrder(order));
  const past = all.filter((order) => PAST.has(order.status));
  const scheduled = all.filter((order) => isScheduledOrder(order));
  const selected = active.find((order) => order.id === selectedId) ?? active[0] ?? null;
  const pool = tab === 'active' ? active : tab === 'past' ? past : scheduled;
  const filtered = pool.filter((order) => matches(order, query, locale) && (!status || order.status === status));
  const recent = past.slice(0, 3);
  const options = tab === 'past'
    ? ['DELIVERED', 'CANCELLED', 'REFUNDED']
    : ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'];

  const choose = (next: Tab) => {
    setTab(next);
    setStatus(null);
    setFilterOpen(false);
  };

  const search = (
    <SearchFilter
      query={query}
      onQuery={setQuery}
      open={filterOpen}
      onToggle={() => setFilterOpen((value) => !value)}
      active={Boolean(status)}
      filterRef={filterRef}
      options={options}
      status={status}
      onStatus={(value) => {
        setStatus(value);
        setFilterOpen(false);
      }}
      label={(value) => orderStatusLabel(value, t)}
    />
  );

  return (
    <div>
      <div className="mb-5 hidden items-end justify-between gap-4 lg:flex">
        <div>
          <h1 className="text-4xl">{t('customer.orders.title')}</h1>
          <p className="mt-1 text-sm text-[#6f6f6a]">{t('customer.orders.subtitle')}</p>
        </div>
        <a href={supportHref()} className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e6e6e0] bg-white px-4 text-sm font-semibold">
          <Headphones className="size-4" />
          {t('customer.orders.getHelp')}
        </a>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-x-5 lg:gap-y-4">
        <div role="tablist" aria-label={t('customer.orders.title')} className="flex flex-wrap items-center gap-2">
          <TabButton selected={tab === 'active'} onClick={() => choose('active')}>{t('customer.orders.active', { count: active.length })}</TabButton>
          <TabButton selected={tab === 'past'} onClick={() => choose('past')}>{t('customer.orders.past')}</TabButton>
          <TabButton selected={tab === 'scheduled'} onClick={() => choose('scheduled')} className={scheduled.length ? undefined : 'max-lg:hidden'}>
            {t('customer.orders.scheduled')}
          </TabButton>
        </div>
        <div className={cn('mt-3 lg:mt-0 lg:flex lg:justify-end', tab === 'active' && 'max-lg:hidden')}>{search}</div>

        {tab === 'active' ? (
          <>
            <div className={cn('mt-4 space-y-4 lg:mt-0', !selected && 'lg:col-span-2')}>
              {filtered.length ? (
                filtered.map((order) => (
                  <ActiveDeliveryCard
                    key={order.id}
                    order={order}
                    selected={selected?.id === order.id}
                    onSelect={() => setSelectedId(order.id)}
                  />
                ))
              ) : (
                <EmptyCopy
                  title={query || status ? t('customer.orders.noMatches') : t('customer.orders.noActive')}
                  body={query || status ? undefined : t('customer.orders.noActiveBody')}
                />
              )}
              {recent.length && !query && !status ? (
                <RecentOrders
                  orders={recent}
                  reorderingId={reorder.isPending ? reorder.variables : null}
                  onReorder={(id) => reorder.mutate(id)}
                  onSeeAll={() => choose('past')}
                />
              ) : null}
            </div>
            {selected ? (
              <TrackingPanel order={selected} className="mt-4 hidden lg:block lg:mt-0" />
            ) : null}
          </>
        ) : (
          <div className="mt-4 lg:col-span-2 lg:mt-0">
            {filtered.length ? (
              <div className="space-y-3 lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-[#ecece6] lg:bg-white">
                {filtered.map((order) => (
                  <HistoryRow
                    key={order.id}
                    order={order}
                    reordering={reorder.isPending && reorder.variables === order.id}
                    onReorder={() => reorder.mutate(order.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyCopy
                title={query || status ? t('customer.orders.noMatches') : tab === 'past' ? t('customer.orders.noPast') : t('customer.orders.noScheduled')}
                body={query || status ? undefined : tab === 'past' ? t('customer.orders.noPastBody') : t('customer.orders.noScheduledBody')}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActiveDeliveryCard({
  order,
  selected,
  onSelect,
  focus = false,
}: {
  order: Order;
  selected?: boolean;
  onSelect?: () => void;
  focus?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const arrival = arrivalLabel(order, t);
  const price = formatMoney(order.pricing.total, locale);
  const name = pickLocalized(order.merchantName, locale);
  const delivery = order.fulfillmentType === 'DELIVERY';

  return (
    <article
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'rounded-[28px] border border-[#ecece6] bg-white p-4 shadow-[0_10px_30px_rgba(17,17,17,0.04)] lg:p-5',
        onSelect && 'cursor-pointer',
        selected && onSelect && 'lg:ring-2 lg:ring-primary',
      )}
    >
      <div className="flex items-start gap-3">
        <Photo src={storeImage(order)} alt="" className="size-[3.75rem] rounded-full object-cover lg:size-16 lg:rounded-2xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base">{name}</h2>
              <p className="text-xs text-[#8a8a84]">#{order.number.replace(/^#/, '')}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff3c4] px-3 py-1.5 text-xs font-semibold">
                <StatusIcon status={order.status} />
                {orderStatusLabel(order.status, t)}
              </span>
              <p className="hidden text-base font-bold lg:block">{price}</p>
            </div>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-[#6f6f6a]">{itemLine(order, locale, t)}</p>
          {arrival ? null : <p className="mt-2 text-end text-base font-bold lg:hidden">{price}</p>}
        </div>
      </div>

      {arrival ? (
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="text-lg font-bold leading-tight">
            {t('customer.orders.arrivingIn')} <span className="text-[#e3940c]">{arrival}</span>
          </p>
          <p className="text-lg font-bold lg:hidden">{price}</p>
        </div>
      ) : null}

      <ProgressTrack order={order} />

      <div className={cn('mt-4', !focus && 'lg:hidden')}>
        {delivery ? <RouteMap order={order} track={!focus} /> : null}
        <RiderRow order={order} />
      </div>

      <div className={cn('mt-5 items-center gap-4 border-t border-[#f3f3ee] pt-4', focus ? 'flex flex-wrap' : 'hidden lg:flex')}>
        <Meta
          icon={MapPin}
          label={delivery ? t('customer.orders.deliveryAddress') : t('customer.orders.pickup')}
          value={order.fulfillmentType === 'DINE_IN' && order.tableNumber ? order.tableNumber : order.address || '—'}
        />
        <Meta icon={CreditCard} label={t('customer.orders.paymentMethod')} value={paymentLabel(order.paymentMethod, t)} />
        <Meta icon={Calendar} label={t('customer.orders.orderPlaced')} value={placedLabel(order.createdAt, locale, t)} />
        {focus ? null : (
          <Link
            href={`/orders/${order.id}`}
            className="ms-auto inline-flex h-10 items-center gap-1 rounded-full border border-[#e4e4de] px-4 text-sm font-semibold"
          >
            {t('customer.orders.viewOrderDetails')}
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Link>
        )}
      </div>
    </article>
  );
}

export function HistoryRow({
  order,
  onReorder,
  reordering,
  embedded = false,
}: {
  order: Order;
  onReorder?: () => void;
  reordering?: boolean;
  embedded?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const failed = order.status === 'CANCELLED' || order.status === 'REFUNDED';
  const done = order.status === 'DELIVERED';
  const when = isScheduledOrder(order) && order.scheduledFor ? order.scheduledFor : order.createdAt;
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article className="rounded-[24px] border border-[#ecece6] bg-white p-3 lg:rounded-none lg:border-0 lg:border-b lg:border-[#f3f3ee] lg:px-4 lg:py-4 lg:last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="relative size-16 shrink-0">
          <Photo src={storeImage(order)} alt="" className="size-full rounded-2xl object-cover" />
          <span className="absolute bottom-1 start-1 grid size-6 place-items-center rounded-full bg-primary text-[#111]">
            <Utensils className="size-3.5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base">{pickLocalized(order.merchantName, locale)}</h2>
          <p className={cn('mt-0.5 flex items-center gap-1 text-xs font-medium', done ? 'text-[#168a52]' : failed ? 'text-[#d9342b]' : 'text-[#9a6b00]')}>
            <span className={cn('grid size-4 place-items-center rounded-full text-white', done ? 'bg-[#168a52]' : failed ? 'bg-[#d9342b]' : 'bg-[#e3940c]')}>
              {done ? <Check className="size-2.5" strokeWidth={3} /> : failed ? <X className="size-2.5" strokeWidth={3} /> : <Clock className="size-2.5" />}
            </span>
            <span className="truncate">{orderStatusLabel(order.status, t)} · {formatWhen(when, locale)}</span>
          </p>
          <p className="text-xs text-[#6f6f6a]">{t('customer.cartItems', { count })}</p>
          <p className="mt-0.5 text-sm font-bold lg:hidden">{formatMoney(order.pricing.total, locale)}</p>
        </div>
        <p className="hidden text-sm font-bold lg:block">{formatMoney(order.pricing.total, locale)}</p>
        <div className="flex shrink-0 flex-col gap-2 lg:flex-row">
          {embedded ? null : (
            <Link href={`/orders/${order.id}`} className="inline-flex h-10 items-center justify-center rounded-full border border-[#e4e4de] px-4 text-sm font-semibold">
              {t('customer.orders.viewDetails')}
            </Link>
          )}
          {done && onReorder ? (
            <button type="button" disabled={reordering} onClick={onReorder} className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-[#111] disabled:opacity-60">
              {t('customer.orders.reorder')}
            </button>
          ) : null}
          {failed ? (
            <a href={supportHref(order.number)} className="inline-flex h-10 items-center justify-center rounded-full bg-[#f2f2ee] px-4 text-sm font-semibold">
              {t('customer.orders.getHelp')}
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function TrackingPanel({ order, className }: { order: Order; className?: string }) {
  const t = useTranslations();
  const arrival = arrivalLabel(order, t);
  return (
    <aside className={cn('rounded-[28px] border border-[#ecece6] bg-white p-4 shadow-[0_10px_30px_rgba(17,17,17,0.04)] lg:sticky lg:top-28', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg">{t('customer.orders.liveTracking')}</h2>
        <p className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', arrival ? 'text-[#168a52]' : 'text-[#6f6f6a]')}>
          <span className={cn('size-2 rounded-full', arrival ? 'bg-[#168a52]' : 'bg-[#c4c4be]')} />
          {arrival ? `${t('customer.orders.arrivingIn')} ${arrival}` : orderStatusLabel(order.status, t)}
        </p>
      </div>
      {order.fulfillmentType === 'DELIVERY' ? <RouteMap order={order} tall /> : null}
      <RiderRow order={order} />
      <Link href={`/orders/${order.id}`} className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-bold text-[#111]">
        {t('customer.orders.trackOrder')}
        <ArrowRight className="size-4 rtl:rotate-180" />
      </Link>
      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <p className="flex items-center gap-2 text-[#6f6f6a]">
          <Headphones className="size-4 shrink-0" />
          {t('customer.orders.needHelp')}
        </p>
        <a href={supportHref(order.number)} className="shrink-0 font-semibold text-[#2563eb]">
          {t('customer.orders.contactSupport')}
        </a>
      </div>
    </aside>
  );
}

function RecentOrders({
  orders,
  onSeeAll,
  onReorder,
  reorderingId,
}: {
  orders: Order[];
  onSeeAll: () => void;
  onReorder: (id: string) => void;
  reorderingId: string | undefined | null;
}) {
  const t = useTranslations();
  return (
    <section className="pt-2">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-2xl">{t('customer.orders.recent')}</h2>
        <button type="button" onClick={onSeeAll} className="inline-flex items-center gap-1 text-sm font-semibold">
          {t('customer.orders.seeAll')}
          <ChevronRight className="size-4 rtl:rotate-180" />
        </button>
      </div>
      <div className="space-y-3 lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-[#ecece6] lg:bg-white lg:shadow-sm">
        {orders.map((order, index) => (
          <div key={order.id} className={index > 1 ? 'max-lg:hidden' : undefined}>
            <HistoryRow order={order} reordering={reorderingId === order.id} onReorder={() => onReorder(order.id)} />
          </div>
        ))}
      </div>
    </section>
  );
}

function RouteMap({ order, track = false, tall = false }: { order: Order; track?: boolean; tall?: boolean }) {
  const t = useTranslations();
  const moving = order.status === 'OUT_FOR_DELIVERY' || order.status === 'ASSIGNED_TO_DRIVER';
  return (
    <div className={cn('relative overflow-hidden rounded-2xl bg-[#efe6d4]', tall ? 'h-56' : 'h-44')}>
      <svg viewBox="0 0 640 280" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
        <rect width="640" height="280" fill="#efe6d4" />
        <path d="M500-20c30 50 8 80 36 118 24 32 8 62 28 92 16 24 10 50 20 90H500c-8-40 16-62-4-104-22-46-48-62-36-110 10-40 28-58 40-86z" fill="#c5d9ee" />
        <g stroke="#e2d7c2" strokeWidth="14" strokeLinecap="round">
          <path d="M0 48H640M0 112H470M0 176H520M0 236H470" />
          <path d="M70 0V280M170 0V280M270 0V240M390 0V280M500 0V180" />
        </g>
        <path d="M96 74H188V108H300V124H410" fill="none" stroke="#161616" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="96" cy="74" r="5" fill="#161616" />
      </svg>
      <span className="absolute top-[26%] left-[15%] grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-[#111] shadow-md">
        <Store className="size-4" />
      </span>
      {moving ? (
        <span className="absolute top-[48%] left-[52%] grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#161616] bg-white">
          <Bike className="size-4" />
        </span>
      ) : null}
      <span className="absolute top-[44%] left-[64%] grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-[#111] shadow-md">
        <MapPin className="size-4" />
      </span>
      {order.distanceKm ? (
        <span className="absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-3 py-1 text-xs font-semibold shadow-sm">
          {t('customer.orders.kmAway', { km: order.distanceKm })}
        </span>
      ) : null}
      {track ? (
        <Link href={`/orders/${order.id}`} className="absolute bottom-3 end-3 inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-bold text-[#111] shadow-sm">
          {t('customer.orders.trackOrder')}
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Link>
      ) : null}
    </div>
  );
}

function RiderRow({ order }: { order: Order }) {
  const t = useTranslations();
  if (!order.driverName) return null;
  const initial = order.driverName.trim().charAt(0).toUpperCase();
  return (
    <div className="mt-4 flex items-center gap-3">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[#ffe08a] text-base font-bold text-[#111]">{initial}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[#8a8a84]">{t('customer.orders.yourRider')}</p>
        <p className="truncate font-bold leading-tight">{order.driverName}</p>
        {order.driverVehicle ? <p className="truncate text-xs text-[#6f6f6a]">{order.driverVehicle}</p> : null}
      </div>
      {order.driverPhone ? (
        <div className="flex shrink-0 gap-2">
          <a href={`tel:${order.driverPhone}`} aria-label={t('customer.orders.callRider')} className="grid size-11 place-items-center rounded-full border border-[#e6e6e0]">
            <Phone className="size-4" />
          </a>
          <a href={`sms:${order.driverPhone}`} aria-label={t('customer.orders.messageRider')} className="grid size-11 place-items-center rounded-full border border-[#e6e6e0]">
            <MessageCircle className="size-4" />
          </a>
        </div>
      ) : null}
    </div>
  );
}

function ProgressTrack({ order }: { order: Order }) {
  const t = useTranslations();
  const delivery = order.fulfillmentType === 'DELIVERY';
  const labels = delivery
    ? [t('customer.orders.confirmed'), t('customer.orders.preparing'), t('customer.orders.pickedUp'), t('customer.orders.onTheWay')]
    : [t('customer.orders.confirmed'), t('customer.orders.preparing'), t('customer.orders.ready'), t('customer.orders.pickedUp')];
  const current = progressIndex(order.status);
  const width = `${(Math.min(current, labels.length - 1) / (labels.length - 1)) * 100}%`;
  return (
    <div className="relative mt-5 grid grid-cols-4">
      <span className="absolute start-[12.5%] end-[12.5%] top-3 h-[3px] overflow-hidden rounded-full bg-[#f4e7b0]">
        <span className="block h-full bg-primary" style={{ width }} />
      </span>
      {labels.map((label, index) => {
        const done = index < current;
        const active = index === current && current < labels.length;
        return (
          <div key={label} className="relative z-10 flex flex-col items-center text-center">
            <span
              className={cn(
                'grid place-items-center rounded-full',
                done && 'size-6 bg-primary text-white',
                active && 'size-7 bg-primary shadow-[0_0_0_6px_rgba(255,196,0,0.35)]',
                !done && !active && 'size-6 border-2 border-[#f0d56a] bg-white',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            <span className={cn('mt-2 text-[11px] leading-tight', active ? 'font-semibold text-[#111]' : 'text-[#8d8d88]')}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function SearchFilter({
  query,
  onQuery,
  open,
  onToggle,
  active,
  filterRef,
  options,
  status,
  onStatus,
  label,
}: {
  query: string;
  onQuery: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  active: boolean;
  filterRef: RefObject<HTMLDivElement | null>;
  options: string[];
  status: string | null;
  onStatus: (value: string | null) => void;
  label: (value: string) => string;
}) {
  const t = useTranslations();
  return (
    <div className="flex items-center gap-2">
      <label className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#8d8d88]" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('customer.orders.search')}
          aria-label={t('customer.orders.search')}
          className="h-11 w-full rounded-full border border-[#e6e6e0] bg-white ps-10 pe-4 text-sm outline-none placeholder:text-[#8d8d88] focus:border-[#111]"
        />
      </label>
      <div className="relative" ref={filterRef}>
        <button
          type="button"
          aria-label={t('customer.orders.filter')}
          aria-expanded={open}
          onClick={onToggle}
          className={cn('grid size-11 place-items-center rounded-full border bg-white', active ? 'border-transparent bg-primary' : 'border-[#e6e6e0]')}
        >
          <SlidersHorizontal className="size-4" />
        </button>
        {open ? (
          <div className="absolute end-0 z-20 mt-2 w-48 overflow-hidden rounded-2xl border border-[#ecece6] bg-white py-1 shadow-lg">
            <button type="button" onClick={() => onStatus(null)} className={cn('block w-full px-3 py-2 text-start text-sm', !status && 'bg-[#fff8df] font-semibold')}>
              {t('customer.orders.all')}
            </button>
            {options.map((option) => (
              <button key={option} type="button" onClick={() => onStatus(option)} className={cn('block w-full px-3 py-2 text-start text-sm', status === option && 'bg-[#fff8df] font-semibold')}>
                {label(option)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TabButton({ selected, onClick, children, className }: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'h-11 rounded-full px-5 text-sm font-semibold',
        selected ? 'bg-primary text-[#111]' : 'text-[#5c5c57] lg:border lg:border-[#e6e6e0] lg:bg-white lg:text-[#111]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function Meta({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fff6d6] text-[#111]">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] text-[#8a8a84]">{label}</span>
        <span className="block truncate text-sm font-semibold">{value}</span>
      </span>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'OUT_FOR_DELIVERY' || status === 'ASSIGNED_TO_DRIVER') return <Bike className="size-3.5" />;
  if (status === 'PREPARING' || status === 'READY_FOR_PICKUP') return <Utensils className="size-3.5" />;
  return <Clock className="size-3.5" />;
}

function Photo({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  return (
    <img
      src={src || '/no-image-1x1.jpg'}
      alt={alt}
      className={className}
      onError={(event) => {
        if (!event.currentTarget.src.endsWith('/no-image-1x1.jpg')) event.currentTarget.src = '/no-image-1x1.jpg';
      }}
    />
  );
}

function EmptyCopy({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-[#e4e4de] bg-white px-6 py-14 text-center">
      <h2 className="text-lg">{title}</h2>
      {body ? <p className="mt-1 text-sm text-[#6f6f6a]">{body}</p> : null}
    </div>
  );
}

function OrdersSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="hidden h-16 w-80 rounded-2xl lg:block" />
      <Skeleton className="h-11 w-64 rounded-full" />
      <Skeleton className="h-80 rounded-[28px]" />
      <Skeleton className="h-28 rounded-[28px]" />
    </div>
  );
}

function progressIndex(status: string) {
  switch (status) {
    case 'PENDING':
      return 0;
    case 'ACCEPTED':
    case 'PREPARING':
      return 1;
    case 'READY_FOR_PICKUP':
    case 'ASSIGNED_TO_DRIVER':
      return 2;
    case 'OUT_FOR_DELIVERY':
      return 3;
    case 'DELIVERED':
      return 4;
    default:
      return 0;
  }
}

function arrivalWindow(order: Order) {
  if (PAST.has(order.status)) return null;
  if (order.estimatedArrival) {
    const mins = Math.round((new Date(order.estimatedArrival).getTime() - Date.now()) / 60000);
    const from = Math.max(5, mins - 3);
    const to = Math.max(from + 4, mins + 3);
    return { from, to };
  }
  if (order.preparationMinutes) {
    const mid = order.preparationMinutes;
    return { from: Math.max(8, mid - 3), to: mid + 6 };
  }
  return null;
}

function arrivalLabel(order: Order, t: Translator) {
  const window = arrivalWindow(order);
  if (!window) return null;
  return t('customer.minuteRange', window);
}

function itemLine(order: Order, locale: 'en' | 'ar', t: Translator) {
  const names = order.items
    .slice(0, 2)
    .map((item) => pickLocalized(item.name, locale))
    .filter(Boolean)
    .join(', ');
  const items = t('customer.cartItems', { count: order.items.reduce((sum, item) => sum + item.quantity, 0) });
  return names ? t('customer.orders.itemsLine', { names, items }) : items;
}

function paymentLabel(method: string | null, t: Translator) {
  switch (method) {
    case 'CARD':
      return t('customer.orders.card');
    case 'BENEFIT':
      return t('customer.orders.benefit');
    case 'BENEFIT_PAY':
      return t('customer.orders.benefitPay');
    case 'CASH':
      return t('customer.orders.cash');
    default:
      return '—';
  }
}

function placedLabel(value: string, locale: 'en' | 'ar', t: Translator) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const time = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (date.toDateString() === new Date().toDateString()) return t('customer.orders.todayAt', { time });
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatWhen(value: string, locale: 'en' | 'ar') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function storeImage(order: Order) {
  return order.items.find((item) => item.imageUrl)?.imageUrl || order.merchantCoverUrl || order.merchantLogoUrl;
}

function matches(order: Order, query: string, locale: 'en' | 'ar') {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${order.number} ${pickLocalized(order.merchantName, locale)}`.toLowerCase().includes(needle);
}
