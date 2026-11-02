import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import type { FloorOrder, FloorTable, ServiceRequestView } from '@alliva/types';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, Check, ChefHat, CircleCheck, HandHelping, Inbox, Receipt, Sparkles, StickyNote, UserRound, UtensilsCrossed, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { awaitingConfirm, itemLine, money, tableNo, StagePill, useAge, useAnswerCall, useFloorBoard, useFloorLocale, useNow, useOrderStep, useTableStatus } from './shared';

const callIcon = { WAITER: UserRound, BILL: Receipt, HELP: HandHelping } as const;

export default function FloorHome() {
  const t = useTranslations('floor.home');
  const board = useFloorBoard();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const now = useNow();

  if (board.isLoading) return <div className="space-y-3"><Skeleton className="h-24 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-40 rounded-3xl" /></div>;
  if (board.error && !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error).message} />;
  const data = board.data!;
  const calls = data.requests;
  const fresh = awaitingConfirm(data.orders);
  // Riders collect delivery orders, so the floor only serves dine-in and takeaway.
  const ready = data.orders.filter((order) => order.status === 'READY_FOR_PICKUP' && order.fulfillmentType !== 'DELIVERY');
  const mine = data.orders.filter((order) => order.takenByMe && order.status !== 'READY_FOR_PICKUP');
  const free = data.tables.filter((table) => table.status === 'AVAILABLE').length;
  const seated = data.tables.filter((table) => table.status === 'OCCUPIED').length;
  const cleaning = data.tables.filter((table) => table.status === 'INACTIVE');
  const hour = new Date(now).getHours();

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{t(hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening', { name: me.data?.firstName ?? '' })}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{calls.length || ready.length ? t('summaryBusy', { calls: calls.length, ready: ready.length }) : fresh.length ? null : t('summaryQuiet')}</p>
        {fresh.length ? <p className="mt-0.5 text-sm font-semibold text-destructive">{t('summaryNew', { count: fresh.length })}</p> : null}
      </section>

      {fresh.length ? (
        <Card title={t('newTitle')} icon={Inbox} count={fresh.length}>
          <ul className="divide-y divide-border">{fresh.map((order) => <NewOrderRow key={order.id} order={order} now={now} />)}</ul>
        </Card>
      ) : null}

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={t('stats.calls')} value={calls.length} tone={calls.some((row) => row.status === 'OPEN') ? 'alert' : 'plain'} />
        <Stat label={t('stats.ready')} value={ready.length} tone={ready.length ? 'good' : 'plain'} />
        <Stat label={t('stats.tables')} value={`${free}/${data.tables.length}`} detail={t('stats.seated', { count: seated })} />
        <Stat label={t('stats.served')} value={data.servedToday} />
      </section>

      {cleaning.length ? (
        <Card title={t('cleanTitle')} icon={Sparkles} count={cleaning.length}>
          <ul className="divide-y divide-border">{cleaning.map((table) => <CleanRow key={table.id} table={table} />)}</ul>
        </Card>
      ) : null}

      <Card title={t('callsTitle')} icon={BellRing} count={calls.length}>
        {calls.length ? <ul className="divide-y divide-border">{calls.map((call) => <CallRow key={call.id} call={call} now={now} />)}</ul> : <Empty text={t('noCalls')} />}
      </Card>

      <Card title={t('readyTitle')} icon={CircleCheck} count={ready.length}>
        {ready.length ? <ul className="divide-y divide-border">{ready.map((order) => <ReadyRow key={order.id} order={order} now={now} />)}</ul> : <Empty text={t('noReady')} />}
      </Card>

      <Card title={t('mineTitle')} icon={ChefHat} count={mine.length} action={<Link href="/floor/orders" className="inline-flex items-center gap-1 text-xs font-semibold text-info">{t('allOrders')}<ArrowRight className="size-3.5 rtl:-scale-x-100" /></Link>}>
        {mine.length ? <ul className="divide-y divide-border">{mine.map((order) => <MineRow key={order.id} order={order} now={now} />)}</ul> : (
          <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
            <p className="text-sm text-subtle">{t('noMine')}</p>
            <Link href="/floor/tables" className="inline-flex h-10 items-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold text-secondary-foreground"><UtensilsCrossed className="size-4" />{t('takeOrder')}</Link>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, detail, tone = 'plain' }: { label: string; value: string | number; detail?: string; tone?: 'plain' | 'alert' | 'good' }) {
  return (
    <div className={cn('rounded-2xl p-3.5', tone === 'alert' ? 'bg-destructive text-white' : tone === 'good' ? 'bg-success-soft' : 'bg-card')}>
      <p className={cn('text-xs font-medium', tone === 'alert' ? 'text-white/80' : 'text-muted-foreground')}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

export function Card({ title, icon: Icon, count, action, children }: { title: string; icon: typeof BellRing; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl bg-card">
      <header className="flex items-center gap-2 px-5 pb-2 pt-4">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="font-semibold">{title}</h2>
        {count ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span> : null}
        <span className="ms-auto">{action}</span>
      </header>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 pb-5 pt-1 text-sm text-subtle">{text}</p>;
}

export function CallRow({ call, now }: { call: ServiceRequestView; now: number }) {
  const t = useTranslations('floor.calls');
  const age = useAge();
  const answer = useAnswerCall();
  const Icon = callIcon[call.kind];
  const open = call.status === 'OPEN';
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span className={cn('relative grid size-11 shrink-0 place-items-center rounded-2xl text-base font-bold', open ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success')}>
        {tableNo(call.table.number)}
        <span className={cn('absolute -bottom-1 -end-1 grid size-5 place-items-center rounded-full text-white', open ? 'animate-pulse bg-destructive' : 'bg-success')}><Icon className="size-3" /></span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{t(`short.${call.kind}`)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {open ? t('waiting', { age: age(call.createdAt, now) }) : call.acknowledgedBy ? t('comingNamed', { name: call.acknowledgedBy }) : t('coming')}
        </p>
      </div>
      {open ? (
        <button type="button" disabled={answer.isPending} onClick={() => answer.mutate({ id: call.id, status: 'ACKNOWLEDGED' })} className="h-10 shrink-0 rounded-xl bg-secondary px-3 text-sm font-semibold text-secondary-foreground disabled:opacity-50">
          {t('onMyWay')}
        </button>
      ) : null}
      <button type="button" disabled={answer.isPending} onClick={() => answer.mutate({ id: call.id, status: 'RESOLVED' })} aria-label={t('doneAria', { table: tableNo(call.table.number) })} className="grid size-10 shrink-0 place-items-center rounded-xl border border-border text-success disabled:opacity-50">
        <Check className="size-5" />
      </button>
    </li>
  );
}

/** A table order a diner sent from the QR menu: nothing reaches the kitchen until the order taker confirms it. */
function NewOrderRow({ order, now }: { order: FloorOrder; now: number }) {
  const t = useTranslations('floor');
  const locale = useFloorLocale();
  const age = useAge();
  const step = useOrderStep();
  const [rejecting, setRejecting] = useState(false);
  const confirm = () => step.mutate({ order, status: 'ACCEPTED' }, { onSuccess: () => toast.success(t('home.confirmedToast', { table: tableNo(order.tableNumber ?? '') })) });
  const reject = () => step.mutate({ order, status: 'CANCELLED', cancellationReason: t('home.rejectReason') }, { onSuccess: () => toast(t('home.rejectedToast')) });
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-destructive-soft text-sm font-bold text-destructive">{tableNo(order.tableNumber ?? '')}</span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            <span className="truncate">{t('tableNumber', { table: tableNo(order.tableNumber ?? '') })}</span>
            <span className="ms-auto shrink-0 text-sm tabular-nums">{money(order.total, locale)}</span>
          </p>
          <p className="text-xs text-muted-foreground"><bdi>{order.number}</bdi> · {t('placedAgo', { age: age(order.createdAt, now) })}</p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {order.items.map((item, index) => (
              <li key={index}>
                <span className="font-semibold tabular-nums">{item.quantity}×</span> {itemLine(item, locale)}
                {item.notes ? <span className="block text-xs text-warning"><bdi>{item.notes}</bdi></span> : null}
              </li>
            ))}
          </ul>
          {order.notes ? <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-primary-soft px-3 py-2 text-xs"><StickyNote className="mt-0.5 size-3.5 shrink-0" /><bdi>{order.notes}</bdi></p> : null}
        </div>
      </div>
      {rejecting ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={step.isPending} onClick={() => setRejecting(false)} className="h-11 rounded-xl border border-border text-sm font-semibold disabled:opacity-50">{t('orders.keep')}</button>
          <button type="button" disabled={step.isPending} onClick={reject} className="h-11 rounded-xl bg-destructive text-sm font-semibold text-white disabled:opacity-50">{t('orders.confirmReject')}</button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={step.isPending} onClick={() => setRejecting(true)} aria-label={t('orders.reject')} className="grid size-11 shrink-0 place-items-center rounded-xl border border-border text-destructive disabled:opacity-50">
            <X className="size-5" />
          </button>
          <button type="button" disabled={step.isPending} onClick={confirm} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold text-secondary-foreground disabled:opacity-50">
            <ChefHat className="size-4" />{t('home.confirm')}
          </button>
        </div>
      )}
    </li>
  );
}

/** A table whose guests paid: it stays out of use until the order taker has cleaned and set it, then marks it ready. */
function CleanRow({ table }: { table: FloorTable }) {
  const t = useTranslations('floor');
  const setStatus = useTableStatus();
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-sm font-bold text-warning">{tableNo(table.number)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{t('tableNumber', { table: tableNo(table.number) })}</p>
        <p className="truncate text-xs text-muted-foreground">{t('home.cleanBody')}</p>
      </div>
      <button
        type="button"
        disabled={setStatus.isPending}
        onClick={() => setStatus.mutate({ table, status: 'AVAILABLE' }, { onSuccess: () => toast.success(t('home.readyToast', { table: tableNo(table.number) })) })}
        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-success px-3.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        <Check className="size-4" />{t('home.markReady')}
      </button>
    </li>
  );
}

function ReadyRow({ order, now }: { order: FloorOrder; now: number }) {
  const t = useTranslations('floor');
  const locale = useFloorLocale();
  const age = useAge();
  const step = useOrderStep();
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-success-soft text-sm font-bold text-success">{order.tableNumber ? tableNo(order.tableNumber) : <UtensilsCrossed className="size-5" />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{order.tableNumber ? t('tableNumber', { table: tableNo(order.tableNumber) }) : <>{t(`fulfillment.${order.fulfillmentType}`)} · <bdi>{order.number}</bdi></>}</p>
        <p className="truncate text-xs text-muted-foreground">{order.items.map((item) => `${item.quantity}× ${itemLine(item, locale)}`).join(', ')}</p>
        <p className="text-xs text-success">{t('readyFor', { age: age(order.readyAt ?? order.createdAt, now) })}</p>
      </div>
      <button type="button" disabled={step.isPending} onClick={() => step.mutate({ order, status: 'DELIVERED' })} className="h-10 shrink-0 rounded-xl bg-success px-3.5 text-sm font-semibold text-white disabled:opacity-50">
        {order.fulfillmentType === 'DINE_IN' ? t('actions.served') : t('actions.handedOver')}
      </button>
    </li>
  );
}

function MineRow({ order, now }: { order: FloorOrder; now: number }) {
  const t = useTranslations('floor');
  const age = useAge();
  return (
    <li>
      <Link href={`/floor/orders?open=${order.id}`} className="flex items-center gap-3 px-5 py-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface-2 text-sm font-bold">{order.tableNumber ? tableNo(order.tableNumber) : <UtensilsCrossed className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold"><bdi>{order.number}</bdi></p>
          <p className="truncate text-xs text-muted-foreground">{t('placedAgo', { age: age(order.createdAt, now) })}</p>
        </div>
        <StagePill status={order.status} />
      </Link>
    </li>
  );
}
