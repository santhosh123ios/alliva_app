import { orderHandled } from '@/components/order-alerts';
import type { MerchantOrder } from '@/components/orders';
import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { canSetStatus } from '@/lib/roles';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { AuthUser, OrderStatus } from '@alliva/types';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bike, ClipboardList, Plus, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Lane = 'new' | 'kitchen' | 'ready';
type Locale = 'en' | 'ar';

const LANES: { key: Lane; statuses: OrderStatus[] }[] = [
  { key: 'new', statuses: ['PENDING'] },
  { key: 'kitchen', statuses: ['ACCEPTED', 'PREPARING'] },
  { key: 'ready', statuses: ['READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] },
];
const PREP_CHOICES = [10, 20, 30];

/** Order taker landing: accept new orders, watch the kitchen, hand ready orders over. */
export function FrontBoard({ user }: { user: AuthUser }) {
  const t = useTranslations('frontBoard');
  const locale = (useLocale() === 'ar' ? 'ar' : 'en') as Locale;
  const client = useQueryClient();
  const now = useMinute();
  const [lane, setLane] = useState<Lane>('new');
  const orders = useQuery({ queryKey: ['merchant', 'orders'], queryFn: () => api.orders() as unknown as Promise<MerchantOrder[]>, refetchInterval: 20_000 });
  const tables = useQuery({ queryKey: ['merchant', 'tables'], queryFn: () => api.tables() as Promise<{ status: string }[]>, enabled: true });
  const profile = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile(), retry: false });
  const slug = (profile.data as { slug?: string } | undefined)?.slug;
  const save = useMutation({
    mutationFn: (input: { order: MerchantOrder; status: OrderStatus; preparationMinutes?: number }) =>
      api.transition(input.order.id, { status: input.status, ...(input.preparationMinutes ? { preparationMinutes: input.preparationMinutes } : {}), ...(input.status === 'CANCELLED' ? { cancellationReason: t('rejectedReason') } : {}) }),
    onSuccess: (_result, input) => {
      orderHandled(input.order.id);
      toast.success(t(`done.${input.status === 'ACCEPTED' ? 'accepted' : input.status === 'CANCELLED' ? 'rejected' : 'handedOver'}`, { number: input.order.number }));
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'dashboard'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'tables'] });
    },
  });

  const live = (orders.data ?? []).filter((order) => LANES.some((entry) => entry.statuses.includes(order.status)));
  const byLane = (key: Lane) => live.filter((order) => LANES.find((entry) => entry.key === key)!.statuses.includes(order.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tableRows = tables.data ?? [];

  function newOrder() {
    if (!slug) return;
    window.open(`http://${window.location.hostname}:3000/${locale}/merchants/${slug}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#161616]">{t('title')}</h1>
          <p className="mt-1 text-sm text-[#696965]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tables" className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616]">
            <UtensilsCrossed className="size-4" />
            {tables.data ? t('tablesFree', { free: tableRows.filter((row) => row.status === 'AVAILABLE').length, total: tableRows.length }) : t('tables')}
          </Link>
          <Link href="/orders" className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616]">
            <ClipboardList className="size-4" />{t('allOrders')}
          </Link>
          <button type="button" onClick={newOrder} disabled={!slug} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#F5C400] px-4 text-sm font-semibold text-[#111111] disabled:opacity-50">
            <Plus className="size-4" />{t('newOrder')}
          </button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl bg-[#F4F4F1] p-1 lg:hidden" role="tablist" aria-label={t('title')}>
        {LANES.map((entry) => (
          <button key={entry.key} type="button" role="tab" aria-selected={lane === entry.key} onClick={() => setLane(entry.key)} className={cn('flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold', lane === entry.key ? 'bg-[#F5C400] text-[#111111]' : 'text-[#5C5C58]')}>
            {t(`lanes.${entry.key}`)}<span className="rounded-full bg-black/5 px-1.5 text-xs">{byLane(entry.key).length}</span>
          </button>
        ))}
      </div>

      {orders.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-3">{LANES.map((entry) => <Skeleton key={entry.key} className="h-80 rounded-2xl" />)}</div>
      ) : orders.error ? (
        <ErrorState title={t('loadError')} body={(orders.error as Error).message} />
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-3">
          {LANES.map((entry) => {
            const rows = byLane(entry.key);
            return (
              <section key={entry.key} className={cn('rounded-2xl border border-[#EEEEEC] bg-white lg:block', lane === entry.key ? 'block' : 'hidden')} aria-label={t(`lanes.${entry.key}`)}>
                <h2 className="hidden items-center justify-between border-b border-[#F1F1EE] px-4 py-3 font-semibold text-[#161616] lg:flex">
                  {t(`lanes.${entry.key}`)}
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs', entry.key === 'new' && rows.length ? 'bg-[#F5C400] text-[#111111]' : 'bg-[#F1F1EE] text-[#5C5C58]')}>{rows.length}</span>
                </h2>
                <div className="space-y-2 p-3">
                  {rows.length === 0 ? <p className="py-10 text-center text-sm text-[#8A8A86]">{t(`empty.${entry.key}`)}</p> : null}
                  {rows.map((order) => (
                    <OrderCard key={order.id} order={order} user={user} locale={locale} now={now} busy={save.isPending && save.variables?.order.id === order.id} onSave={(status, preparationMinutes) => save.mutate({ order, status, preparationMinutes })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, user, locale, now, busy, onSave }: { order: MerchantOrder; user: AuthUser; locale: Locale; now: number; busy: boolean; onSave: (status: OrderStatus, preparationMinutes?: number) => void }) {
  const t = useTranslations('frontBoard');
  const statusText = useTranslations('merchantOrders');
  const [confirmReject, setConfirmReject] = useState(false);
  const Icon = order.fulfillmentType === 'DELIVERY' ? Bike : order.fulfillmentType === 'DINE_IN' ? UtensilsCrossed : ShoppingBag;
  const count = order.items.reduce((total, item) => total + item.quantity, 0);
  const age = Math.max(0, Math.round((now - new Date(order.createdAt).getTime()) / 60_000));
  const can = (status: OrderStatus) => canSetStatus(user, status, order.fulfillmentType);

  return (
    <article className={cn('rounded-xl border p-3', order.status === 'PENDING' ? 'border-[#F5C400] bg-[#FFFBEA]' : 'border-[#EEEEEC]')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#161616]"><bdi dir="ltr">#{order.number}</bdi></p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-[#696965]">
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{order.fulfillmentType === 'DINE_IN' && order.tableNumber ? t('table', { number: order.tableNumber }) : t(`type.${order.fulfillmentType}`)} · {order.customerName || '—'} · {t('itemsCount', { count })} · {formatMoney(order.pricing.total, locale)}</span>
          </p>
        </div>
        <span className={cn('shrink-0 text-xs font-semibold tabular-nums', age >= 10 && order.status === 'PENDING' ? 'text-[#D9342B]' : 'text-[#8A8A86]')}>{age < 60 ? t('minutesAgo', { count: age }) : t('hoursAgo', { hours: Math.floor(age / 60), minutes: age % 60 })}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-[#3A3A36]">{order.items.map((item) => `${item.quantity}× ${pickLocalized(item.name, locale)}`).join(', ')}</p>

      {order.status === 'PENDING' && can('ACCEPTED') ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-[#5C5C58]">{t('acceptWith')}</p>
          <div className="grid grid-cols-3 gap-2">
            {PREP_CHOICES.map((minutes) => (
              <button key={minutes} type="button" disabled={busy} onClick={() => onSave('ACCEPTED', minutes)} className="h-11 rounded-xl bg-[#161616] text-sm font-semibold text-white disabled:opacity-60">
                {t('minutes', { count: minutes })}
              </button>
            ))}
          </div>
          {can('CANCELLED') ? (
            confirmReject ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmReject(false)} className="h-10 rounded-xl border border-[#E6E6E2] text-sm font-semibold">{t('keep')}</button>
                <button type="button" disabled={busy} onClick={() => onSave('CANCELLED')} className="h-10 rounded-xl bg-[#D9342B] text-sm font-semibold text-white disabled:opacity-60">{t('confirmReject')}</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmReject(true)} className="h-10 w-full rounded-xl border border-[#F3C1BC] text-sm font-semibold text-[#D9342B]">{t('reject')}</button>
            )
          ) : null}
        </div>
      ) : order.status === 'READY_FOR_PICKUP' && order.fulfillmentType !== 'DELIVERY' && can('DELIVERED') ? (
        <button type="button" disabled={busy} onClick={() => onSave('DELIVERED')} className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#16924A] text-sm font-semibold text-white disabled:opacity-60">
          {t(order.fulfillmentType === 'DINE_IN' ? 'served' : 'handOver')}<ArrowRight className="size-4 rtl:-scale-x-100" />
        </button>
      ) : (
        <p className="mt-2 inline-flex rounded-full bg-[#F1F1EE] px-2.5 py-1 text-xs font-semibold text-[#5C5C58]">{statusText(statusKey(order.status))}</p>
      )}
    </article>
  );
}

function statusKey(status: OrderStatus) {
  if (status === 'ACCEPTED') return 'accepted' as const;
  if (status === 'PREPARING') return 'preparing' as const;
  if (status === 'READY_FOR_PICKUP') return 'ready' as const;
  if (status === 'ASSIGNED_TO_DRIVER') return 'assigned' as const;
  if (status === 'OUT_FOR_DELIVERY') return 'outForDelivery' as const;
  return 'new' as const;
}

function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
