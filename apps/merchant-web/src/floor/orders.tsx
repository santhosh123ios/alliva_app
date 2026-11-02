import { api } from '@/components/providers';
import { canSetStatus } from '@/lib/roles';
import type { FloorOrder } from '@alliva/types';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Bike, ChevronDown, ShoppingBag, StickyNote, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { itemLine, tableNo, money, stageOf, StagePill, useAge, useFloorBoard, useFloorLocale, useNow, useOrderStep, type Stage } from './shared';

const SECTIONS: { key: Stage | 'kitchen'; stages: Stage[] }[] = [
  { key: 'new', stages: ['new'] },
  { key: 'kitchen', stages: ['toStart', 'cooking'] },
  { key: 'ready', stages: ['ready'] },
];
const fulfillmentIcon = { DINE_IN: UtensilsCrossed, TAKEAWAY: ShoppingBag, DELIVERY: Bike } as const;

export default function FloorOrders() {
  const t = useTranslations('floor.orders');
  const board = useFloorBoard();
  const now = useNow();
  const [params] = useSearchParams();
  const [mine, setMine] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(() => params.get('open'));

  useEffect(() => {
    const id = params.get('open');
    if (!id) return;
    setExpanded(id);
    window.setTimeout(() => document.getElementById(`order-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
  }, [params]);

  if (board.isLoading) return <div className="space-y-3"><Skeleton className="h-11 rounded-2xl" /><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-28 rounded-3xl" /></div>;
  if (board.error && !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error).message} />;
  const orders = board.data!.orders.filter((order) => !mine || order.takenByMe);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="ms-auto grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
          {([false, true] as const).map((value) => (
            <button key={String(value)} type="button" aria-pressed={mine === value} onClick={() => setMine(value)} className={cn('h-9 rounded-lg px-3 text-sm font-semibold', mine === value ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground')}>
              {value ? t('mine') : t('all')}
            </button>
          ))}
        </div>
      </div>

      {SECTIONS.map((section) => {
        const rows = orders
          .filter((order) => section.stages.includes(stageOf(order.status)))
          .sort((a, b) => (section.key === 'ready' ? (a.readyAt ?? a.createdAt).localeCompare(b.readyAt ?? b.createdAt) : a.createdAt.localeCompare(b.createdAt)));
        // Table orders waiting to be confirmed only take space while there are some.
        if (section.key === 'new' && !rows.length) return null;
        return (
          <section key={section.key}>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-muted-foreground">
              {t(`sections.${section.key}`)}
              <span className="rounded-full bg-card px-2 py-0.5 text-xs tabular-nums text-foreground">{rows.length}</span>
            </h2>
            {rows.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {rows.map((order) => (
                  <OrderCard key={order.id} order={order} now={now} open={expanded === order.id} onToggle={() => setExpanded((current) => (current === order.id ? null : order.id))} />
                ))}
              </div>
            ) : <p className="rounded-2xl bg-card px-4 py-4 text-sm text-subtle">{t(`empty.${section.key}`)}</p>}
          </section>
        );
      })}
    </div>
  );
}

function OrderCard({ order, now, open, onToggle }: { order: FloorOrder; now: number; open: boolean; onToggle: () => void }) {
  const t = useTranslations('floor');
  const locale = useFloorLocale();
  const age = useAge();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const step = useOrderStep();
  const [rejecting, setRejecting] = useState(false);
  const Icon = fulfillmentIcon[order.fulfillmentType];
  const may = (status: Parameters<typeof canSetStatus>[1]) => Boolean(me.data && canSetStatus(me.data, status, order.fulfillmentType));
  const late = order.estimatedReadyAt && order.status !== 'READY_FOR_PICKUP' && new Date(order.estimatedReadyAt).getTime() < now;
  const items = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article id={`order-${order.id}`} className={cn('overflow-hidden rounded-2xl bg-card', open && 'ring-2 ring-foreground')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-sm font-bold">{order.tableNumber ? tableNo(order.tableNumber) : <Icon className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{order.tableNumber ? t('tableNumber', { table: tableNo(order.tableNumber) }) : t(`fulfillment.${order.fulfillmentType}`)}</p>
          <p className={cn('truncate text-xs', late ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
            {t('orders.meta', { number: `\u2066${order.number}\u2069`, items, age: age(order.createdAt, now) })}{late ? ` · ${t('orders.late')}` : ''}
          </p>
        </div>
        <StagePill status={order.status} />
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <ul className="space-y-1 text-sm">
            {order.items.map((item, index) => (
              <li key={index}>
                <span className="font-semibold tabular-nums">{item.quantity}×</span> {itemLine(item, locale)}
                {item.notes ? <span className="block text-xs text-warning"><bdi>{item.notes}</bdi></span> : null}
              </li>
            ))}
          </ul>
          {order.notes ? <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-primary-soft px-3 py-2 text-xs"><StickyNote className="mt-0.5 size-3.5 shrink-0" /><bdi>{order.notes}</bdi></p> : null}
          <p className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{order.customerName}</span>
            <span className="font-semibold tabular-nums">{money(order.total, locale)}</span>
          </p>

          {order.status === 'PENDING' && may('ACCEPTED') ? (
            rejecting ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={step.isPending} onClick={() => setRejecting(false)} className="h-11 rounded-xl border border-border text-sm font-semibold disabled:opacity-50">{t('orders.keep')}</button>
                <button type="button" disabled={step.isPending} onClick={() => step.mutate({ order, status: 'CANCELLED', cancellationReason: t('home.rejectReason') }, { onSuccess: () => toast(t('home.rejectedToast')) })} className="h-11 rounded-xl bg-destructive text-sm font-semibold text-white disabled:opacity-50">{t('orders.confirmReject')}</button>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={step.isPending} onClick={() => setRejecting(true)} className="h-11 shrink-0 rounded-xl border border-border px-4 text-sm font-semibold text-destructive disabled:opacity-50">{t('orders.reject')}</button>
                <button type="button" disabled={step.isPending} onClick={() => step.mutate({ order, status: 'ACCEPTED' }, { onSuccess: () => toast.success(t('home.confirmedToast', { table: tableNo(order.tableNumber ?? '') })) })} className="h-11 flex-1 rounded-xl bg-secondary text-sm font-semibold text-secondary-foreground disabled:opacity-50">{t('home.confirm')}</button>
              </div>
            )
          ) : null}
          {order.status === 'READY_FOR_PICKUP' && order.fulfillmentType !== 'DELIVERY' && may('DELIVERED') ? (
            <button type="button" disabled={step.isPending} onClick={() => step.mutate({ order, status: 'DELIVERED' })} className="mt-3 h-11 w-full rounded-xl bg-success text-sm font-semibold text-white disabled:opacity-50">
              {order.fulfillmentType === 'DINE_IN' ? t('actions.served') : t('actions.handedOver')}
            </button>
          ) : null}
          {order.status === 'READY_FOR_PICKUP' && order.fulfillmentType === 'DELIVERY' ? <p className="mt-3 text-xs text-muted-foreground">{t('orders.waitingRider')}</p> : null}
        </div>
      ) : null}
    </article>
  );
}
