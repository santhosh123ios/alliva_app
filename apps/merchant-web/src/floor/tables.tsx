import { api } from '@/components/providers';
import { useRouter } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import type { FloorBoard, FloorOrder, FloorTable } from '@alliva/types';
import { cn, EmptyState, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, Grid3X3, List, Plus, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { CallRow } from './home';
import { placeTables } from './plan';
import { callsFor, tableNo, floorKey, itemLine, money, StagePill, tableTone, useAge, useDraft, useFloorBoard, useFloorLocale, useFloorSettings, useNow, useOrderStep, type TableStatus } from './shared';

const VIEW_KEY = 'alliva.floor.tablesView';
const ZONE_TONES = ['bg-[#FFF9DE]/70', 'bg-[#EEF6FF]/70', 'bg-[#EFF9F2]/70', 'bg-[#F7F0FF]/70'];

export default function FloorTables() {
  const t = useTranslations('floor.tables');
  const locale = useFloorLocale();
  const board = useFloorBoard();
  const [params, setParams] = useSearchParams();
  const [zone, setZone] = useState('all');
  const [view, setView] = useState<'plan' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'plan';
    } catch {
      return 'plan';
    }
  });
  const selectedId = params.get('table');
  const plan = useMemo(() => placeTables(board.data?.tables ?? [], board.data?.layout ?? null), [board.data]);
  // Phones show one zone at a time, zoomed in, so tables stay big enough to tap.
  const zoned = useRef(false);
  useEffect(() => {
    if (zoned.current || !plan.floors.length) return;
    zoned.current = true;
    if (plan.floors.length > 1 && window.innerWidth < 720) setZone(plan.floors[0]!);
  }, [plan.floors]);

  function choose(next: 'plan' | 'list') {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not remembered in private mode.
    }
  }
  const open = (id: string | null) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (id) next.set('table', id);
    else next.delete('table');
    return next;
  }, { replace: true });

  if (board.isLoading) return <div className="space-y-3"><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-80 rounded-3xl" /></div>;
  if (board.error && !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error).message} />;
  const data = board.data!;
  if (!data.tables.length) return <EmptyState title={t('none')} body={t('noneBody')} />;
  const zones = plan.floors.map((id) => data.tables.find((table) => table.floor.id === id)!.floor);
  const shown = plan.tables.filter((table) => zone === 'all' || table.floor.id === zone);
  const selected = data.tables.find((table) => table.id === selectedId) ?? null;
  const frame = zone === 'all' || !plan.rects[zone] ? { x: 0, y: 0, width: 100, height: 100 } : plan.rects[zone]!;
  const toFrame = (rect: { x: number; y: number; width: number; height: number }) => ({
    x: ((rect.x - frame.x) / frame.width) * 100,
    y: ((rect.y - frame.y) / frame.height) * 100,
    width: (rect.width / frame.width) * 100,
    height: (rect.height / frame.height) * 100,
  });
  const counts = (['AVAILABLE', 'OCCUPIED', 'RESERVED', 'INACTIVE'] as const).map((status) => [status, data.tables.filter((table) => table.status === status).length] as const);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="ms-auto flex h-10 overflow-hidden rounded-xl border border-[#E6E6E2] bg-white">
          <button type="button" aria-pressed={view === 'plan'} onClick={() => choose('plan')} className={cn('inline-flex items-center gap-1.5 px-3 text-sm font-semibold', view === 'plan' ? 'bg-[#111111] text-white' : 'text-[#5C5C58]')}><Grid3X3 className="size-4" />{t('plan')}</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => choose('list')} className={cn('inline-flex items-center gap-1.5 px-3 text-sm font-semibold', view === 'list' ? 'bg-[#111111] text-white' : 'text-[#5C5C58]')}><List className="size-4" />{t('list')}</button>
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={zone === 'all'} onClick={() => setZone('all')}>{t('allZones')}</Chip>
        {zones.map((floor) => <Chip key={floor.id} active={zone === floor.id} onClick={() => setZone(floor.id)}>{pickLocalized(floor.name, locale)}</Chip>)}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5C5C58]">
        {counts.map(([status, count]) => (
          <span key={status} className="inline-flex items-center gap-1.5"><span className={cn('size-2.5 rounded-full', tableTone[status].dot)} />{t(`status.${status}`)} <strong className="tabular-nums text-[#161616]">{count}</strong></span>
        ))}
      </div>

      {view === 'plan' ? (
        <section className="overflow-x-auto rounded-3xl border border-[#E6E6E2] bg-white">
          <div
            style={{ aspectRatio: `${(2.1 * frame.width) / frame.height}` }}
            className={cn('relative bg-[#FBFAF6] [background-image:linear-gradient(#EFEDE6_1px,transparent_1px),linear-gradient(90deg,#EFEDE6_1px,transparent_1px)] [background-size:40px_40px]', zone === 'all' && 'min-w-[720px]')}
            dir="ltr"
          >
            {plan.floors.filter((id) => zone === 'all' || id === zone).map((id) => {
              const rect = toFrame(plan.rects[id]!);
              const floor = zones.find((row) => row.id === id)!;
              return (
                <div key={id} style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.width}%`, height: `${rect.height}%` }} className={cn('absolute border-2 border-dashed border-[#D6D3C8]', ZONE_TONES[plan.floors.indexOf(id) % ZONE_TONES.length])}>
                  <span className="absolute start-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-[#4A4A46]" dir="auto">{pickLocalized(floor.name, locale)}</span>
                </div>
              );
            })}
            {shown.map((table) => (
              <PlanTable key={table.id} table={table} board={data} position={toFrame({ ...plan.positions[table.id]!, width: 0, height: 0 })} onOpen={() => open(table.id)} />
            ))}
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((table) => <ListTable key={table.id} table={table} board={data} onOpen={() => open(table.id)} />)}
        </section>
      )}

      {selected ? <TableSheet table={selected} board={data} onClose={() => open(null)} /> : null}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn('h-9 shrink-0 rounded-full px-4 text-sm font-semibold', active ? 'bg-[#111111] text-white' : 'bg-white text-[#5C5C58]')}>
      {children}
    </button>
  );
}

/** What a table needs at a glance: open calls first, then the furthest-along order. */
function tableState(table: FloorTable, board: FloorBoard) {
  const calls = callsFor(board.requests, table.id);
  const orders = board.orders.filter((order) => order.tableId === table.id);
  const lead = orders.find((order) => order.status === 'READY_FOR_PICKUP') ?? orders.find((order) => order.status === 'PREPARING') ?? orders[0] ?? null;
  return { calls, waiting: calls.some((call) => call.status === 'OPEN'), lead };
}

function PlanTable({ table, board, position, onOpen }: { table: FloorTable; board: FloorBoard; position: { x: number; y: number }; onOpen: () => void }) {
  const t = useTranslations('floor.tables');
  const tone = tableTone[table.status];
  const { calls, waiting, lead } = tableState(table, board);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
      className={cn(
        'absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center border-2 shadow-[0_5px_16px_rgba(23,23,18,.08)]',
        table.capacity >= 6 ? 'h-[64px] w-[124px]' : 'h-[64px] w-[96px]',
        table.capacity <= 2 ? 'rounded-full' : 'rounded-2xl',
        tone.fill,
        waiting ? 'border-[#B42318] ring-4 ring-[#B42318]/20' : tone.ring,
      )}
      aria-label={t('tableAria', { table: tableNo(table.number), status: t(`status.${table.status}`) })}
    >
      <span className={cn('absolute -end-1.5 -top-1.5 size-3.5 rounded-full border-[3px] border-white', tone.dot)} />
      {calls.length ? (
        <span className={cn('absolute -start-2 -top-2 grid size-6 place-items-center rounded-full text-white', waiting ? 'animate-pulse bg-[#B42318]' : 'bg-[#168A52]')}><BellRing className="size-3.5" /></span>
      ) : null}
      <span className="text-center leading-tight">
        <strong className="block text-base">{tableNo(table.number)}</strong>
        <span className="block text-[10px] text-[#74746D]">{t('seats', { count: table.capacity })}</span>
      </span>
      {lead ? <StagePill status={lead.status} className="absolute -bottom-3 px-2 py-0.5 text-[10px]" /> : null}
    </button>
  );
}

function ListTable({ table, board, onOpen }: { table: FloorTable; board: FloorBoard; onOpen: () => void }) {
  const t = useTranslations('floor.tables');
  const locale = useFloorLocale();
  const tone = tableTone[table.status];
  const { calls, waiting, lead } = tableState(table, board);
  return (
    <button type="button" onClick={onOpen} className={cn('relative rounded-2xl border-2 p-3 text-start', tone.fill, waiting ? 'border-[#B42318]' : tone.ring)}>
      <div className="flex items-center gap-2">
        <strong className="text-xl">{tableNo(table.number)}</strong>
        {calls.length ? <BellRing className={cn('size-4', waiting ? 'animate-pulse text-[#B42318]' : 'text-[#168A52]')} /> : null}
        <span className={cn('ms-auto text-xs font-semibold', tone.text)}>{t(`status.${table.status}`)}</span>
      </div>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-[#696965]"><Users className="size-3.5" />{t('seats', { count: table.capacity })} · {pickLocalized(table.floor.name, locale)}</p>
      <div className="mt-2 min-h-6">{lead ? <StagePill status={lead.status} /> : null}</div>
    </button>
  );
}

const STATUSES: TableStatus[] = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'INACTIVE'];

/** Everything about one table: who called, what is cooking, and what to do next. */
function TableSheet({ table, board, onClose }: { table: FloorTable; board: FloorBoard; onClose: () => void }) {
  const t = useTranslations('floor.tables');
  const locale = useFloorLocale();
  const router = useRouter();
  const client = useQueryClient();
  const { branchId } = useFloorSettings();
  const draft = useDraft();
  const now = useNow();
  const age = useAge();
  const { calls } = tableState(table, board);
  const orders = board.orders.filter((order) => order.tableId === table.id);
  const status = useMutation({
    mutationFn: (next: TableStatus) => api.setTableStatus(table.id, next),
    onMutate: async (next) => {
      const key = floorKey(branchId);
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<FloorBoard>(key);
      client.setQueryData<FloorBoard>(key, (current) => current && { ...current, tables: current.tables.map((row) => (row.id === table.id ? { ...row, status: next } : row)) });
      return { before };
    },
    onError: (error: Error, _next, context) => {
      if (context?.before) client.setQueryData(floorKey(branchId), context.before);
      toast.error(error.message);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ['merchant', 'floor', 'board'] }),
  });

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  function takeOrder() {
    if (draft.target?.kind === 'DINE_IN' && draft.target.tableId !== table.id && draft.count) toast(t('draftMoved', { table: tableNo(table.number) }));
    draft.setTarget({ kind: 'DINE_IN', tableId: table.id, tableNumber: table.number });
    router.push('/floor/menu');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('tableNumber', { table: tableNo(table.number) })} onClick={(event) => event.stopPropagation()} className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#F7F7F5] pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl">
        <header className="sticky top-0 z-10 flex items-start gap-3 bg-white px-5 pb-3 pt-4">
          <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl border-2 text-lg font-bold', tableTone[table.status].fill, tableTone[table.status].ring)}>{tableNo(table.number)}</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{t('tableNumber', { table: tableNo(table.number) })}</h2>
            <p className="text-xs text-[#696965]">{t('seats', { count: table.capacity })} · {pickLocalized(table.floor.name, locale)}{table.openedAt ? ` · ${t('seatedFor', { age: age(table.openedAt, now) })}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('close')} className="grid size-9 place-items-center rounded-full bg-[#F2F2EF]"><X className="size-4" /></button>
        </header>

        <div className="space-y-3 px-4 pt-3">
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white p-1">
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={table.status === value}
                disabled={status.isPending}
                onClick={() => table.status !== value && status.mutate(value)}
                className={cn('flex h-11 flex-col items-center justify-center rounded-xl text-[11px] font-semibold', table.status === value ? 'bg-[#111111] text-white' : 'text-[#5C5C58]')}
              >
                <span className={cn('mb-0.5 size-2 rounded-full', tableTone[value].dot)} />
                {t(`status.${value}`)}
              </button>
            ))}
          </div>

          {calls.length ? (
            <section className="overflow-hidden rounded-2xl bg-white">
              <h3 className="px-5 pt-3 text-sm font-semibold">{t('calls')}</h3>
              <ul className="divide-y divide-[#F0F0EC]">{calls.map((call) => <CallRow key={call.id} call={call} now={now} />)}</ul>
            </section>
          ) : null}

          <section className="rounded-2xl bg-white">
            <h3 className="px-5 pt-3 text-sm font-semibold">{t('orders')}</h3>
            {orders.length ? <ul className="divide-y divide-[#F0F0EC]">{orders.map((order) => <SheetOrder key={order.id} order={order} />)}</ul> : <p className="px-5 pb-4 pt-1 text-sm text-[#8A8A86]">{t('noOrders')}</p>}
          </section>

          <div className="grid gap-2">
            <button type="button" onClick={takeOrder} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#FFC400] text-sm font-semibold text-[#111111]">
              <Plus className="size-4" />{orders.length ? t('addOrder') : t('takeOrder')}
            </button>
            {table.status === 'OCCUPIED' && !orders.length ? (
              <button type="button" disabled={status.isPending} onClick={() => status.mutate('AVAILABLE')} className="h-12 rounded-2xl border border-[#E6E6E2] bg-white text-sm font-semibold">{t('clearTable')}</button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetOrder({ order }: { order: FloorOrder }) {
  const t = useTranslations('floor');
  const locale = useFloorLocale();
  const step = useOrderStep();
  return (
    <li className="px-5 py-3">
      <div className="flex items-center gap-2">
        <strong className="text-sm"><bdi>{order.number}</bdi></strong>
        <StagePill status={order.status} />
        <span className="ms-auto text-sm font-semibold tabular-nums">{money(order.total, locale)}</span>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-sm text-[#3A3A36]">
        {order.items.map((item, index) => (
          <li key={index}><span className="font-semibold tabular-nums">{item.quantity}×</span> {itemLine(item, locale)}{item.notes ? <span className="text-xs text-[#8A5A00]"> · <bdi>{item.notes}</bdi></span> : null}</li>
        ))}
      </ul>
      {order.status === 'READY_FOR_PICKUP' ? (
        <button type="button" disabled={step.isPending} onClick={() => step.mutate({ order, status: 'DELIVERED' })} className="mt-2 h-10 w-full rounded-xl bg-[#168A52] text-sm font-semibold text-white disabled:opacity-50">{t('actions.served')}</button>
      ) : null}
    </li>
  );
}
