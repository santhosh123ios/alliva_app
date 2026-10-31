import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import type { FloorOrder, ServiceRequestView } from '@alliva/types';
import { cn, ErrorState, Skeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, Check, ChefHat, CircleCheck, HandHelping, Receipt, UserRound, UtensilsCrossed } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { itemLine, StagePill, useAge, useAnswerCall, useFloorBoard, useFloorLocale, useNow, useOrderStep } from './shared';

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
  // Riders collect delivery orders, so the floor only serves dine-in and takeaway.
  const ready = data.orders.filter((order) => order.status === 'READY_FOR_PICKUP' && order.fulfillmentType !== 'DELIVERY');
  const mine = data.orders.filter((order) => order.takenByMe && order.status !== 'READY_FOR_PICKUP');
  const free = data.tables.filter((table) => table.status === 'AVAILABLE').length;
  const seated = data.tables.filter((table) => table.status === 'OCCUPIED').length;
  const hour = new Date(now).getHours();

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{t(hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening', { name: me.data?.firstName ?? '' })}</h1>
        <p className="mt-0.5 text-sm text-[#696965]">{calls.length || ready.length ? t('summaryBusy', { calls: calls.length, ready: ready.length }) : t('summaryQuiet')}</p>
      </section>

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={t('stats.calls')} value={calls.length} tone={calls.some((row) => row.status === 'OPEN') ? 'alert' : 'plain'} />
        <Stat label={t('stats.ready')} value={ready.length} tone={ready.length ? 'good' : 'plain'} />
        <Stat label={t('stats.tables')} value={`${free}/${data.tables.length}`} detail={t('stats.seated', { count: seated })} />
        <Stat label={t('stats.served')} value={data.servedToday} />
      </section>

      <Card title={t('callsTitle')} icon={BellRing} count={calls.length}>
        {calls.length ? <ul className="divide-y divide-[#F0F0EC]">{calls.map((call) => <CallRow key={call.id} call={call} now={now} />)}</ul> : <Empty text={t('noCalls')} />}
      </Card>

      <Card title={t('readyTitle')} icon={CircleCheck} count={ready.length}>
        {ready.length ? <ul className="divide-y divide-[#F0F0EC]">{ready.map((order) => <ReadyRow key={order.id} order={order} now={now} />)}</ul> : <Empty text={t('noReady')} />}
      </Card>

      <Card title={t('mineTitle')} icon={ChefHat} count={mine.length} action={<Link href="/floor/orders" className="inline-flex items-center gap-1 text-xs font-semibold text-[#2F6FED]">{t('allOrders')}<ArrowRight className="size-3.5 rtl:-scale-x-100" /></Link>}>
        {mine.length ? <ul className="divide-y divide-[#F0F0EC]">{mine.map((order) => <MineRow key={order.id} order={order} now={now} />)}</ul> : (
          <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
            <p className="text-sm text-[#8A8A86]">{t('noMine')}</p>
            <Link href="/floor/tables" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#111111] px-4 text-sm font-semibold text-white"><UtensilsCrossed className="size-4" />{t('takeOrder')}</Link>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, detail, tone = 'plain' }: { label: string; value: string | number; detail?: string; tone?: 'plain' | 'alert' | 'good' }) {
  return (
    <div className={cn('rounded-2xl p-3.5', tone === 'alert' ? 'bg-[#B42318] text-white' : tone === 'good' ? 'bg-[#E3F5EA]' : 'bg-white')}>
      <p className={cn('text-xs font-medium', tone === 'alert' ? 'text-white/80' : 'text-[#696965]')}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-[#696965]">{detail}</p> : null}
    </div>
  );
}

export function Card({ title, icon: Icon, count, action, children }: { title: string; icon: typeof BellRing; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl bg-white">
      <header className="flex items-center gap-2 px-5 pb-2 pt-4">
        <Icon className="size-4 text-[#696965]" />
        <h2 className="font-semibold">{title}</h2>
        {count ? <span className="rounded-full bg-[#F0F0EC] px-2 py-0.5 text-xs font-semibold tabular-nums">{count}</span> : null}
        <span className="ms-auto">{action}</span>
      </header>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 pb-5 pt-1 text-sm text-[#8A8A86]">{text}</p>;
}

export function CallRow({ call, now }: { call: ServiceRequestView; now: number }) {
  const t = useTranslations('floor.calls');
  const age = useAge();
  const answer = useAnswerCall();
  const Icon = callIcon[call.kind];
  const open = call.status === 'OPEN';
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <span className={cn('relative grid size-11 shrink-0 place-items-center rounded-2xl text-base font-bold', open ? 'bg-[#FDECEA] text-[#B42318]' : 'bg-[#E3F5EA] text-[#168A52]')}>
        {call.table.number}
        <span className={cn('absolute -bottom-1 -end-1 grid size-5 place-items-center rounded-full text-white', open ? 'animate-pulse bg-[#B42318]' : 'bg-[#168A52]')}><Icon className="size-3" /></span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{t(`short.${call.kind}`)}</p>
        <p className="truncate text-xs text-[#696965]">
          {open ? t('waiting', { age: age(call.createdAt, now) }) : call.acknowledgedBy ? t('comingNamed', { name: call.acknowledgedBy }) : t('coming')}
        </p>
      </div>
      {open ? (
        <button type="button" disabled={answer.isPending} onClick={() => answer.mutate({ id: call.id, status: 'ACKNOWLEDGED' })} className="h-10 shrink-0 rounded-xl bg-[#111111] px-3 text-sm font-semibold text-white disabled:opacity-50">
          {t('onMyWay')}
        </button>
      ) : null}
      <button type="button" disabled={answer.isPending} onClick={() => answer.mutate({ id: call.id, status: 'RESOLVED' })} aria-label={t('doneAria', { table: call.table.number })} className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#E6E6E2] text-[#168A52] disabled:opacity-50">
        <Check className="size-5" />
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
      <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#E3F5EA] text-sm font-bold text-[#168A52]">{order.tableNumber ?? <UtensilsCrossed className="size-5" />}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{order.tableNumber ? t('tableNumber', { table: order.tableNumber }) : <>{t(`fulfillment.${order.fulfillmentType}`)} · <bdi>{order.number}</bdi></>}</p>
        <p className="truncate text-xs text-[#696965]">{order.items.map((item) => `${item.quantity}× ${itemLine(item, locale)}`).join(', ')}</p>
        <p className="text-xs text-[#168A52]">{t('readyFor', { age: age(order.readyAt ?? order.createdAt, now) })}</p>
      </div>
      <button type="button" disabled={step.isPending} onClick={() => step.mutate({ order, status: 'DELIVERED' })} className="h-10 shrink-0 rounded-xl bg-[#168A52] px-3.5 text-sm font-semibold text-white disabled:opacity-50">
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
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#F2F2EF] text-sm font-bold">{order.tableNumber ?? <UtensilsCrossed className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold"><bdi>{order.number}</bdi></p>
          <p className="truncate text-xs text-[#696965]">{t('placedAgo', { age: age(order.createdAt, now) })}</p>
        </div>
        <StagePill status={order.status} />
      </Link>
    </li>
  );
}
