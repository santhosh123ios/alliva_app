'use client';

import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { FulfillmentType, OrderStatus, PaymentMethod } from '@alliva/types';
import { Button, EmptyState } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Bike, Calendar, ChevronDown, ClipboardList, Download, MapPin, Plus, Search, ShoppingBag, Truck, User, UtensilsCrossed, X, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

export type MerchantOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  customerName: string;
  tableNumber: string | null;
  address: string | null;
  paymentMethod: PaymentMethod | null;
  items: { name: { en?: string; ar?: string }; quantity: number; lineTotal: string }[];
  pricing: { subtotal: string; deliveryFee: string; total: string };
  createdAt: string;
  events: { status: OrderStatus; createdAt: string }[];
};

type Tab = 'all' | 'new' | 'preparing' | 'ready' | 'delivery' | 'completed';
type Range = 'today' | 'yesterday' | 'week' | 'all';
type Kind = 'all' | FulfillmentType;

const statusTone: Record<OrderStatus, string> = {
  PENDING: 'bg-[#FFF4D6] text-[#C47D00]',
  ACCEPTED: 'bg-[#FFF4D6] text-[#C47D00]',
  PREPARING: 'bg-[#E7F0FF] text-[#2F6FED]',
  READY_FOR_PICKUP: 'bg-[#E7F8EE] text-[#16924A]',
  ASSIGNED_TO_DRIVER: 'bg-[#E7F0FF] text-[#2F6FED]',
  OUT_FOR_DELIVERY: 'bg-[#F3E8FF] text-[#7C3AED]',
  DELIVERED: 'bg-[#E7F8EE] text-[#16924A]',
  CANCELLED: 'bg-[#FDECEA] text-[#D9342B]',
  REFUNDED: 'bg-[#F1F1EE] text-[#696965]',
};

const rank: Record<OrderStatus, number> = {
  PENDING: 0,
  ACCEPTED: 1,
  PREPARING: 2,
  READY_FOR_PICKUP: 3,
  ASSIGNED_TO_DRIVER: 4,
  OUT_FOR_DELIVERY: 5,
  DELIVERED: 6,
  CANCELLED: -1,
  REFUNDED: -1,
};

export function OrdersPage({ orders }: { orders: MerchantOrder[] }) {
  const t = useTranslations('merchantOrders');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range>(() => (orders.some((order) => inRange(order.createdAt, 'today')) || orders.length === 0 ? 'today' : 'all'));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slug, setSlug] = useState('');

  useEffect(() => {
    let active = true;
    void api.profile().then((profile) => {
      if (active) setSlug((profile as { slug?: string }).slug ?? '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    new: orders.filter((order) => order.status === 'PENDING').length,
    preparing: orders.filter((order) => order.status === 'ACCEPTED' || order.status === 'PREPARING').length,
    ready: orders.filter((order) => order.status === 'READY_FOR_PICKUP' || order.status === 'ASSIGNED_TO_DRIVER').length,
    delivery: orders.filter((order) => order.status === 'OUT_FOR_DELIVERY').length,
  }), [orders]);

  const visible = useMemo(() => orders.filter((order) => {
    if (!matchesTab(order, tab)) return false;
    if (kind !== 'all' && order.fulfillmentType !== kind) return false;
    if (!inRange(order.createdAt, range)) return false;
    const who = order.fulfillmentType === 'DINE_IN' && order.tableNumber ? order.tableNumber : order.customerName;
    const haystack = `${order.number} ${order.customerName} ${who}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [orders, tab, kind, range, query]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 1280px)').matches) return;
    if (selectedId && visible.some((order) => order.id === selectedId)) return;
    setSelectedId(visible[0]?.id ?? null);
  }, [selectedId, visible]);

  const selected = orders.find((order) => order.id === selectedId) ?? null;

  function exportCsv() {
    const header = [t('number'), t('time'), t('customer'), t('type'), t('items'), t('amount'), t('status')];
    const lines = visible.map((order) => [
      order.number,
      clock(order.createdAt, locale),
      party(order),
      t(typeKey(order.fulfillmentType)),
      String(order.items.reduce((sum, item) => sum + item.quantity, 0)),
      order.pricing.total,
      t(statusKey(order.status)),
    ]);
    const csv = [header, ...lines].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function createOrder() {
    if (!slug || typeof window === 'undefined') return;
    window.open(`http://${window.location.hostname}:3000/${locale}/merchants/${slug}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex flex-col gap-4 md:h-[calc(100dvh-4rem-3rem)] md:overflow-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <section className="inline-grid w-fit grid-cols-2 overflow-hidden rounded-xl border border-[#EEEEEC] bg-white shadow-[0_4px_16px_rgba(17,17,17,0.04)] sm:grid-cols-4">
          <Stat label={t('new')} value={counts.new} icon={ClipboardList} />
          <Stat label={t('preparing')} value={counts.preparing} icon={UtensilsCrossed} />
          <Stat label={t('ready')} value={counts.ready} icon={ShoppingBag} />
          <Stat label={t('outForDelivery')} value={counts.delivery} icon={Truck} />
        </section>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616]" onClick={exportCsv}>
            <Download className="size-4" /> {t('export')}
          </button>
          <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={createOrder}>
            <Plus className="size-4" /> {t('create')}
          </Button>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col gap-4 overflow-hidden ${selected ? 'xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[minmax(0,1fr)]' : ''}`}>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#EEEEEC] bg-white shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
          <div className="border-b border-[#EEEEEC] px-3 py-3">
            <div role="tablist" aria-label={t('all')} className="flex gap-1 overflow-x-auto rounded-xl bg-[#F4F4F1] p-1">
              {(['all', 'new', 'preparing', 'ready', 'delivery', 'completed'] as const).map((key) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(key)}
                    className={`h-9 min-w-fit flex-1 shrink-0 rounded-lg px-3 text-sm font-semibold ${active ? 'bg-[#F5C400] text-[#111111]' : 'text-[#5C5C58] hover:bg-white/80 hover:text-[#161616]'}`}
                  >
                    {t(key)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2 border-b border-[#F4F4F1] px-4 py-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#8A8A86]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} className="h-11 w-full rounded-xl border border-[#E6E6E2] bg-white ps-9 pe-3 text-sm outline-none focus:ring-2 focus:ring-[#FFC400]" />
            </label>
            <FilterSelect label={t('allTypes')} value={kind} onChange={(value) => setKind(value as Kind)}>
              <option value="all">{t('allTypes')}</option>
              <option value="DELIVERY">{t('deliveryType')}</option>
              <option value="TAKEAWAY">{t('pickupType')}</option>
              <option value="DINE_IN">{t('dineIn')}</option>
            </FilterSelect>
            <FilterSelect label={t('today')} value={range} onChange={(value) => setRange(value as Range)} icon={<Calendar className="pointer-events-none absolute start-3 size-4 text-[#8A8A86]" />}>
              <option value="today">{t('today')}</option>
              <option value="yesterday">{t('yesterday')}</option>
              <option value="week">{t('last7')}</option>
              <option value="all">{t('allTime')}</option>
            </FilterSelect>
          </div>
          {orders.length === 0 ? <div className="p-6"><EmptyState title={t('none')} body={t('noneBody')} /></div> : null}
          {orders.length > 0 && visible.length === 0 ? <p className="px-5 py-8 text-sm font-medium text-[#8A8A86]">{t('noMatch')}</p> : null}
          {visible.length > 0 ? (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[5.5rem_4.5rem_minmax(0,1.3fr)_6.5rem_5rem_6.5rem_7.5rem_5.5rem] items-center gap-2 px-3 py-2 text-xs font-medium text-[#8A8A86]">
                  <span>{t('number')}</span>
                  <span>{t('time')}</span>
                  <span>{t('customer')}</span>
                  <span>{t('type')}</span>
                  <span>{t('items')}</span>
                  <span>{t('amount')}</span>
                  <span>{t('status')}</span>
                  <span className="text-end">{t('action')}</span>
                </div>
                <div className="space-y-1">
                  {visible.map((order) => {
                    const active = order.id === selected?.id;
                    const Icon = typeIcon(order.fulfillmentType);
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => setSelectedId(order.id)}
                        className={`grid w-full grid-cols-[5.5rem_4.5rem_minmax(0,1.3fr)_6.5rem_5rem_6.5rem_7.5rem_5.5rem] items-center gap-2 rounded-xl px-3 py-3 text-start text-sm ${active ? 'bg-[#FFF8D8]' : 'hover:bg-[#F7F7F5]'}`}
                      >
                        <span className="font-semibold text-[#161616]">#{order.number}</span>
                        <span className="text-[#5C5C58]">{clock(order.createdAt, locale)}</span>
                        <span className="truncate font-medium text-[#161616]">{party(order)}</span>
                        <span className="inline-flex items-center gap-1.5 text-[#5C5C58]"><Icon className="size-3.5 text-[#8A8A86]" /> {t(typeKey(order.fulfillmentType))}</span>
                        <span className="text-[#5C5C58]">{t('itemsCount', { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })}</span>
                        <span className="font-semibold text-[#161616]">{formatMoney(order.pricing.total, locale)}</span>
                        <span><StatusPill status={order.status} label={t(statusKey(order.status))} /></span>
                        <span className="inline-flex h-8 items-center justify-end gap-1 justify-self-end rounded-lg border border-[#E6E6E2] bg-white px-2.5 text-xs font-semibold text-[#161616]">{t('view')} <span aria-hidden>›</span></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </section>
        {selected ? (
          <OrderPanel
            order={selected}
            locale={locale}
            onClose={() => setSelectedId(null)}
            onChanged={() => void client.invalidateQueries({ queryKey: ['merchant', 'orders'] })}
          />
        ) : null}
      </div>
    </div>
  );
}

function OrderPanel({ order, locale, onClose, onChanged }: { order: MerchantOrder; locale: 'en' | 'ar'; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations('merchantOrders');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: (body: { status: OrderStatus; preparationMinutes?: number; cancellationReason?: string }) => api.transition(order.id, body),
    onSuccess: () => { setError(''); onChanged(); },
    onError: (reason: Error) => setError(reason.message),
  });
  const next = nextStep(order);
  const canReject = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'].includes(order.status);
  const place = placeRow(order, t);
  const level = rank[order.status];
  const steps = order.fulfillmentType === 'DELIVERY'
    ? [
      { key: 'received' as const, done: true, at: order.createdAt },
      { key: 'preparing' as const, done: level >= 2, at: eventTime(order, 'PREPARING') ?? eventTime(order, 'ACCEPTED') },
      { key: 'ready' as const, done: level >= 3, at: eventTime(order, 'READY_FOR_PICKUP') },
      { key: 'outForDelivery' as const, done: level >= 5, at: eventTime(order, 'OUT_FOR_DELIVERY') },
    ]
    : [
      { key: 'received' as const, done: true, at: order.createdAt },
      { key: 'preparing' as const, done: level >= 2, at: eventTime(order, 'PREPARING') ?? eventTime(order, 'ACCEPTED') },
      { key: 'ready' as const, done: level >= 3, at: eventTime(order, 'READY_FOR_PICKUP') },
      { key: 'completedStep' as const, done: level >= 6, at: eventTime(order, 'DELIVERED') },
    ];
  const latest = steps.reduce((index, step, current) => (step.done ? current : index), -1);

  return (
    <div className="min-h-0 xl:h-full xl:overflow-hidden">
      <button type="button" className="fixed inset-0 z-30 bg-black/30 xl:hidden" aria-label={t('close')} onClick={onClose} />
      <aside className="fixed inset-y-0 end-0 z-40 flex w-[min(100%,24rem)] flex-col overflow-hidden border-s border-[#EEEEEC] bg-white shadow-xl xl:static xl:z-0 xl:h-full xl:w-auto xl:rounded-2xl xl:border xl:shadow-[0_8px_24px_rgba(17,17,17,0.04)]">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <h2 className="text-xl font-semibold tracking-tight text-[#161616]">{t('order', { number: order.number })}</h2>
          <div className="flex items-center gap-2">
            <StatusPill status={order.status} label={t(statusKey(order.status))} />
            <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-[#F7F7F5] xl:hidden" aria-label={t('close')} onClick={onClose}>
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <ul className="mt-4 space-y-3 text-sm">
            <Meta icon={typeIcon(order.fulfillmentType)} label={t('orderType')} value={t(typeKey(order.fulfillmentType))} />
            <Meta icon={User} label={t('customerLabel')} value={order.customerName || '—'} />
            <Meta icon={place.icon} label={place.label} value={place.value} />
          </ul>
          <div className="mt-5 border-t border-[#EEEEEC] pt-4">
            <h3 className="font-semibold text-[#161616]">{t('itemsTitle')}</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {order.items.map((item, index) => (
                <li key={`${item.name.en ?? ''}-${index}`} className="flex items-start justify-between gap-3">
                  <span className="text-[#5C5C58]">{t('itemLine', { count: item.quantity, name: pickLocalized(item.name, locale) })}</span>
                  <span className="shrink-0 font-medium text-[#161616]">{formatMoney(item.lineTotal, locale)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-[#EEEEEC] pt-3 text-sm">
              <div className="flex justify-between text-[#5C5C58]"><dt>{t('subtotal')}</dt><dd>{formatMoney(order.pricing.subtotal, locale)}</dd></div>
              {order.fulfillmentType === 'DELIVERY' ? <div className="flex justify-between text-[#5C5C58]"><dt>{t('deliveryFee')}</dt><dd>{formatMoney(order.pricing.deliveryFee, locale)}</dd></div> : null}
              <div className="flex justify-between rounded-xl bg-[#FFF8D8] px-3 py-2 font-semibold text-[#161616]"><dt>{t('total')}</dt><dd>{formatMoney(order.pricing.total, locale)}</dd></div>
            </dl>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-[#EEEEEC] pt-4 text-sm">
            <Banknote className="size-4 text-[#8A8A86]" />
            <span className="text-[#8A8A86]">{t('payment')}</span>
            <span className="ms-auto font-medium text-[#161616]">{t(paymentKey(order.paymentMethod))}</span>
          </div>
          <div className="mt-4 border-t border-[#EEEEEC] pt-4">
            <h3 className="font-semibold text-[#161616]">{t('timeline')}</h3>
            <ol className="mt-4">
              {steps.map((step, index) => {
                const reached = step.done;
                const current = index === latest;
                return (
                  <li key={step.key} className="flex gap-3">
                    <span className="flex flex-col items-center">
                      <span className={`size-3 rounded-full ${current ? 'bg-[#F5C400] ring-4 ring-[#FFF4D6]' : reached ? 'bg-[#161616]' : 'border border-[#D0D0CC] bg-white'}`} />
                      {index < steps.length - 1 ? <span className="my-1 w-px flex-1 bg-[#E6E6E2]" /> : null}
                    </span>
                    <span className={`flex min-h-8 flex-1 items-start justify-between gap-3 pb-4 text-sm ${reached ? 'text-[#161616]' : 'text-[#8A8A86]'}`}>
                      <span className="font-medium">{t(step.key)}</span>
                      {step.at ? <span className="text-[#8A8A86]">{clock(step.at, locale)}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        {next || canReject ? (
          <div className="border-t border-[#EEEEEC] px-5 py-4">
            {error ? <p className="mb-3 text-sm font-medium text-[#B42318]">{error}</p> : null}
            <div className={`grid gap-2 ${next && canReject ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {canReject ? (
                <button type="button" className="h-11 rounded-xl border border-[#F3C1BC] bg-white text-sm font-semibold text-[#D9342B] disabled:opacity-60" disabled={save.isPending} onClick={() => save.mutate({ status: 'CANCELLED', cancellationReason: t('rejected') })}>
                  {t('reject')}
                </button>
              ) : null}
              {next ? (
                <button type="button" className="h-11 rounded-xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-60" disabled={save.isPending} onClick={() => save.mutate(next.body)}>
                  {t(next.label)}
                </button>
              ) : null}
            </div>
            {next?.label === 'accept' ? <p className="mt-2 text-center text-xs text-[#8A8A86]">{t('acceptHint')}</p> : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <div className="flex items-center gap-2 border-[#EEEEEC] px-2.5 py-1.5 odd:border-e even:border-b sm:border-b-0 sm:border-e sm:last:border-e-0">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#FFF6D4] text-[#161616]">
        <Icon className="size-3.5" />
      </span>
      <div className="leading-tight">
        <p className="text-[10px] text-[#8A8A86]">{label}</p>
        <p className="text-sm font-semibold text-[#161616]">{value}</p>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, icon, children }: { label: string; value: string; onChange: (value: string) => void; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="relative inline-flex h-11 w-full items-center lg:w-44">
      <span className="sr-only">{label}</span>
      {icon}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`h-11 w-full appearance-none rounded-xl border border-[#E6E6E2] bg-white pe-8 text-sm font-medium text-[#161616] outline-none ${icon ? 'ps-9' : 'ps-3'}`}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 size-4 text-[#8A8A86]" />
    </label>
  );
}

function StatusPill({ status, label }: { status: OrderStatus; label: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[status]}`}>{label}</span>;
}

function Meta({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <li className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-[#8A8A86]" />
      <span className="text-[#8A8A86]">{label}</span>
      <span className="ms-auto text-end font-medium text-[#161616]">{value}</span>
    </li>
  );
}

function matchesTab(order: MerchantOrder, tab: Tab) {
  if (tab === 'all') return true;
  if (tab === 'new') return order.status === 'PENDING';
  if (tab === 'preparing') return order.status === 'ACCEPTED' || order.status === 'PREPARING';
  if (tab === 'ready') return order.status === 'READY_FOR_PICKUP' || order.status === 'ASSIGNED_TO_DRIVER';
  if (tab === 'delivery') return order.status === 'OUT_FOR_DELIVERY' || order.status === 'ASSIGNED_TO_DRIVER';
  return order.status === 'DELIVERED' || order.status === 'CANCELLED' || order.status === 'REFUNDED';
}

function inRange(iso: string, range: Range) {
  if (range === 'all') return true;
  const date = new Date(iso);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === 'today') return date >= start;
  if (range === 'yesterday') {
    const yesterday = new Date(start);
    yesterday.setDate(yesterday.getDate() - 1);
    return date >= yesterday && date < start;
  }
  const week = new Date(start);
  week.setDate(week.getDate() - 6);
  return date >= week;
}

function party(order: MerchantOrder) {
  if (order.fulfillmentType === 'DINE_IN' && order.tableNumber) return order.tableNumber;
  return order.customerName;
}

function clock(iso: string, locale: 'en' | 'ar') {
  return new Date(iso).toLocaleTimeString(locale === 'ar' ? 'ar-BH' : 'en-US', { hour: 'numeric', minute: '2-digit' });
}

function typeKey(type: FulfillmentType) {
  if (type === 'TAKEAWAY') return 'pickupType' as const;
  if (type === 'DINE_IN') return 'dineIn' as const;
  return 'deliveryType' as const;
}

function typeIcon(type: FulfillmentType): LucideIcon {
  if (type === 'TAKEAWAY') return ShoppingBag;
  if (type === 'DINE_IN') return UtensilsCrossed;
  return Bike;
}

function statusKey(status: OrderStatus) {
  if (status === 'PENDING') return 'new' as const;
  if (status === 'ACCEPTED') return 'accepted' as const;
  if (status === 'PREPARING') return 'preparing' as const;
  if (status === 'READY_FOR_PICKUP') return 'ready' as const;
  if (status === 'ASSIGNED_TO_DRIVER') return 'assigned' as const;
  if (status === 'OUT_FOR_DELIVERY') return 'outForDelivery' as const;
  if (status === 'DELIVERED') return 'delivered' as const;
  if (status === 'CANCELLED') return 'cancelled' as const;
  return 'refunded' as const;
}

function paymentKey(method: PaymentMethod | null) {
  if (method === 'CASH') return 'cash' as const;
  if (method === 'CARD') return 'card' as const;
  if (method === 'BENEFIT') return 'benefit' as const;
  if (method === 'BENEFIT_PAY') return 'benefitPay' as const;
  return 'unpaid' as const;
}

function eventTime(order: MerchantOrder, status: OrderStatus) {
  return order.events.find((event) => event.status === status)?.createdAt ?? null;
}

function placeRow(order: MerchantOrder, t: ReturnType<typeof useTranslations<'merchantOrders'>>) {
  if (order.fulfillmentType === 'DINE_IN') return { icon: UtensilsCrossed, label: t('table'), value: order.tableNumber || '—' };
  if (order.fulfillmentType === 'TAKEAWAY') return { icon: ShoppingBag, label: t('pickup'), value: t('pickupAt') };
  return { icon: MapPin, label: t('deliveryAddress'), value: order.address || '—' };
}

function nextStep(order: MerchantOrder): { label: 'accept' | 'startPreparing' | 'markReady' | 'markDelivered' | 'markComplete'; body: { status: OrderStatus; preparationMinutes?: number } } | null {
  if (order.status === 'PENDING') return { label: 'accept', body: { status: 'ACCEPTED', preparationMinutes: 20 } };
  if (order.status === 'ACCEPTED') return { label: 'startPreparing', body: { status: 'PREPARING' } };
  if (order.status === 'PREPARING') return { label: 'markReady', body: { status: 'READY_FOR_PICKUP' } };
  if (order.status === 'READY_FOR_PICKUP' && order.fulfillmentType !== 'DELIVERY') return { label: 'markComplete', body: { status: 'DELIVERED' } };
  if (order.status === 'OUT_FOR_DELIVERY') return { label: 'markDelivered', body: { status: 'DELIVERED' } };
  return null;
}
