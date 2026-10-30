import { api } from '@/components/providers';
import { RouteMap, type MapRoute } from '@/components/route-map';
import { useWorkspaceBranch } from '@/components/shell';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { DispatchOrder, DispatchReason, DispatchRider } from '@alliva/types';
import { cn, EmptyState, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Banknote, Bike, Clock, Flame, Loader2, MapPin, Minus, Plus, RefreshCw, Route, Sparkles, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

const COLORS = ['#2F6FED', '#E8590C', '#168A52', '#6B3FD6', '#C2255C', '#0B7285', '#8A5A00', '#5C940D'];

/** Rider id → order ids in stop order. Orders in no route are "unplanned". */
type Draft = Record<string, string[]>;
type Point = { latitude: number; longitude: number };

export function DispatchPage() {
  const t = useTranslations('dispatch');
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const client = useQueryClient();
  const { branchId } = useWorkspaceBranch();
  const board = useQuery({ queryKey: ['merchant', 'dispatch', branchId], queryFn: () => api.dispatchBoard(branchId || undefined), refetchInterval: 30_000 });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [maxPerRider, setMaxPerRider] = useState(3);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  // Riders on shift are in the plan by default; the store can add or drop anyone.
  useEffect(() => {
    if (board.data && picked === null) setPicked(new Set(board.data.riders.filter((rider) => rider.onShift).map((rider) => rider.id)));
  }, [board.data, picked]);

  const generate = useMutation({
    mutationFn: () => api.dispatchPlan({ branchId: board.data?.branch.id, riderIds: [...(picked ?? [])], maxPerRider }),
    onSuccess: (result) => {
      client.setQueryData(['merchant', 'dispatch', branchId], result.board);
      const next: Draft = {};
      for (const rider of result.board.riders) if (picked?.has(rider.id)) next[rider.id] = [];
      for (const route of result.routes) next[route.riderId] = route.stops.map((stop) => stop.orderId);
      setDraft(next);
      if (!result.routes.length) toast.message(t('nothingToPlan'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const assign = useMutation({
    mutationFn: (routes: { riderId: string; orderIds: string[] }[]) => api.dispatchAssign({ routes }),
    onSuccess: (result) => {
      toast.success(t('assigned', { count: result.assigned }));
      setDraft(null);
      void client.invalidateQueries({ queryKey: ['merchant', 'dispatch'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (board.isLoading) return <DispatchSkeleton />;
  if (board.error || !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error | null)?.message ?? ''} />;
  const data = board.data;
  const store = { latitude: data.branch.latitude, longitude: data.branch.longitude };
  const orders = new Map(data.ready.map((order) => [order.id, order]));
  // Drop orders that left the queue (assigned elsewhere, cancelled) since the plan was made.
  const live: Draft | null = draft ? Object.fromEntries(Object.entries(draft).map(([rider, ids]) => [rider, ids.filter((id) => orders.has(id))])) : null;
  const planned = new Set(live ? Object.values(live).flat() : []);
  const unplanned = data.ready.filter((order) => !planned.has(order.id));
  const color = (riderId: string) => COLORS[Math.max(0, data.riders.findIndex((rider) => rider.id === riderId)) % COLORS.length]!;
  const toAssign = live ? Object.entries(live).filter(([, ids]) => ids.length).map(([riderId, orderIds]) => ({ riderId, orderIds })) : [];

  const move = (orderId: string, to: string | null) => setDraft((current) => {
    if (!current) return current;
    const next: Draft = Object.fromEntries(Object.entries(current).map(([rider, ids]) => [rider, ids.filter((id) => id !== orderId)]));
    if (to) next[to] = [...(next[to] ?? []), orderId];
    return next;
  });
  const shift = (riderId: string, index: number, by: -1 | 1) => setDraft((current) => {
    if (!current) return current;
    const ids = [...(current[riderId] ?? [])];
    const target = index + by;
    if (target < 0 || target >= ids.length) return current;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    return { ...current, [riderId]: ids };
  });
  const optimise = (rider: DispatchRider) => setDraft((current) => {
    if (!current) return current;
    return { ...current, [rider.id]: nearestFirst(startPoint(rider, store), (current[rider.id] ?? []).map((id) => orders.get(id)).filter((order): order is DispatchOrder => Boolean(order))) };
  });

  const mapRoutes: MapRoute[] = [];
  for (const rider of data.riders) {
    const draftIds = live?.[rider.id] ?? [];
    if (!rider.active.length && !draftIds.length) continue;
    const existing = rider.active.filter(hasPoint).map((stop, index) => ({ lat: stop.latitude!, lng: stop.longitude!, label: String(index + 1), title: `${rider.name} · #${stop.number}`, muted: true }));
    const added = draftIds.map((id) => orders.get(id)!).filter(hasPoint).map((order, index) => ({ lat: order.latitude!, lng: order.longitude!, label: String(rider.active.length + index + 1), title: `${rider.name} · #${order.number}` }));
    mapRoutes.push({ id: rider.id, color: color(rider.id), stops: [...existing, ...added] });
  }
  if (unplanned.length) {
    mapRoutes.push({
      id: 'queue',
      color: '#111111',
      line: false,
      stops: unplanned.filter(hasPoint).map((order) => ({ lat: order.latitude!, lng: order.longitude!, label: String(data.ready.indexOf(order) + 1), title: `#${order.number} · ${order.address.area ?? ''}` })),
    });
  }

  const onShift = data.riders.filter((rider) => rider.onShift).length;

  return (
    <div className="space-y-4 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{t('title')}</h1>
          <p className="mt-1 text-sm text-[#777773]">{t('subtitle', { branch: pickLocalized(data.branch.name, locale) })}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Pill icon={Clock} label={t('stats.ready', { count: data.ready.length })} tone={data.ready.length ? 'warn' : 'muted'} />
          <Pill icon={Bike} label={t('stats.riders', { onShift, total: data.riders.length })} tone={onShift ? 'good' : 'muted'} />
          <button type="button" onClick={() => void board.refetch()} className="flex h-9 items-center gap-1.5 rounded-xl border border-[#E8E8E5] bg-white px-3 font-medium" aria-label={t('refresh')}>
            <RefreshCw className={cn('size-4', board.isFetching && 'animate-spin')} />{t('refresh')}
          </button>
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
        <div className="order-2 space-y-4 xl:order-1">
          {live ? (
            <section className="space-y-3">
              {data.riders.filter((rider) => live[rider.id] !== undefined).map((rider) => (
                <RouteCard
                  key={rider.id}
                  rider={rider}
                  color={color(rider.id)}
                  ids={live[rider.id] ?? []}
                  orders={orders}
                  store={store}
                  riders={data.riders.filter((other) => live[other.id] !== undefined)}
                  focused={focus === rider.id}
                  onFocus={(on) => setFocus(on ? rider.id : null)}
                  onMove={move}
                  onShift={(index, by) => shift(rider.id, index, by)}
                  onOptimise={() => optimise(rider)}
                />
              ))}
              <section className="rounded-2xl border border-[#ECECEA] bg-white p-4">
                <h2 className="text-sm font-semibold">{t('unplanned', { count: unplanned.length })}</h2>
                {unplanned.length ? (
                  <ul className="mt-2 space-y-2">
                    {unplanned.map((order) => (
                      <li key={order.id} className="rounded-xl border border-[#F0F0EC] p-3">
                        <OrderLine order={order} rank={data.ready.indexOf(order) + 1} />
                        <label className="mt-2 flex items-center gap-2 text-xs text-[#696965]">
                          {t('addTo')}
                          <select className="h-8 flex-1 rounded-lg border border-[#E2E2DC] bg-white px-2 text-sm text-[#161616]" value="" onChange={(event) => event.target.value && move(order.id, event.target.value)}>
                            <option value="">{t('pickRider')}</option>
                            {data.riders.filter((rider) => live[rider.id] !== undefined).map((rider) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1 text-sm text-[#8A8A86]">{t('allPlanned')}</p>}
              </section>
              <div className="sticky bottom-3 z-10 flex gap-2 rounded-2xl border border-[#E8E8E5] bg-white p-3 shadow-[0_8px_24px_rgba(17,17,17,0.08)]">
                <button type="button" onClick={() => setDraft(null)} className="flex h-11 items-center gap-1.5 rounded-xl border border-[#E2E2DC] px-4 text-sm font-semibold">
                  <Undo2 className="size-4 rtl:-scale-x-100" />{t('discard')}
                </button>
                <button
                  type="button"
                  disabled={!toAssign.length || assign.isPending}
                  onClick={() => assign.mutate(toAssign)}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-semibold text-white disabled:opacity-40"
                >
                  {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : <Route className="size-4" />}
                  {t('assignAll', { count: toAssign.reduce((total, route) => total + route.orderIds.length, 0), riders: toAssign.length })}
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-[#ECECEA] bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{t('riders')}</h2>
                  <Stepper label={t('maxPerRider')} value={maxPerRider} onChange={setMaxPerRider} />
                </div>
                {data.riders.length ? (
                  <ul className="mt-3 space-y-2">
                    {data.riders.map((rider) => (
                      <li key={rider.id}>
                        <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5', picked?.has(rider.id) ? 'border-[#111111]' : 'border-[#ECECE8]')}>
                          <input
                            type="checkbox"
                            className="size-4 accent-[#111111]"
                            checked={Boolean(picked?.has(rider.id))}
                            onChange={(event) => setPicked((current) => {
                              const next = new Set(current ?? []);
                              if (event.target.checked) next.add(rider.id);
                              else next.delete(rider.id);
                              return next;
                            })}
                          />
                          <span className="size-3 shrink-0 rounded-full" style={{ background: color(rider.id) }} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{rider.name}</span>
                            <span className="block text-xs text-[#696965]">
                              {rider.onShift ? t('onShift') : t('offShift')}
                              {' · '}
                              {rider.active.length ? t('carrying', { count: rider.active.length }) : t('free')}
                            </span>
                          </span>
                          {rider.active.length >= maxPerRider ? <span className="rounded-full bg-[#FDECEA] px-2 py-0.5 text-[11px] font-semibold text-[#B42318]">{t('full')}</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title={t('noRiders')} body={t('noRidersBody')} />}
                <button
                  type="button"
                  disabled={!picked?.size || !data.ready.length || generate.isPending}
                  onClick={() => generate.mutate()}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-[#161616] disabled:opacity-40"
                >
                  {generate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {t('generate')}
                </button>
                <p className="mt-2 text-xs text-[#8A8A86]">{t('generateHint')}</p>
              </section>

              <section className="rounded-2xl border border-[#ECECEA] bg-white p-4">
                <h2 className="font-semibold">{t('queue', { count: data.ready.length })}</h2>
                <p className="text-xs text-[#8A8A86]">{t('queueHint')}</p>
                {data.ready.length ? (
                  <ol className="mt-3 space-y-2">
                    {data.ready.map((order, index) => <li key={order.id} className="rounded-xl border border-[#F0F0EC] p-3"><OrderLine order={order} rank={index + 1} /></li>)}
                  </ol>
                ) : <EmptyState title={t('queueEmpty')} body={t('queueEmptyBody')} />}
              </section>

              {data.upcoming.length ? (
                <section className="rounded-2xl border border-[#ECECEA] bg-white p-4">
                  <h2 className="font-semibold">{t('upcoming', { count: data.upcoming.length })}</h2>
                  <ul className="mt-2 divide-y divide-[#F0F0EC] text-sm">
                    {data.upcoming.map((order) => (
                      <li key={order.id} className="flex items-center gap-3 py-2">
                        <span className="font-medium"><bdi dir="ltr">#{order.number}</bdi></span>
                        <span className="min-w-0 flex-1 truncate text-[#696965]">{order.address.area ?? order.address.line1 ?? '—'}</span>
                        <span className="text-xs text-[#8A8A86]">{order.estimatedReadyAt ? t('readyAt', { time: clock(order.estimatedReadyAt, locale) }) : t(`status.${order.status}`)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>

        <section className="order-1 overflow-hidden rounded-2xl border border-[#ECECEA] bg-white xl:sticky xl:top-20 xl:order-2">
          <RouteMap store={{ lat: store.latitude, lng: store.longitude }} routes={mapRoutes} focus={focus} className="z-0 h-72 w-full sm:h-96 xl:h-[calc(100vh-11rem)]" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#F0F0EC] px-4 py-2.5 text-xs text-[#696965]">
            <span className="flex items-center gap-1.5"><span className="grid size-4 place-items-center rounded-full bg-[#111111] text-[9px] text-[#FFC400]">★</span>{t('legend.store')}</span>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[#8A8A86]" />{t('legend.current')}</span>
            {unplanned.length ? <span className="flex items-center gap-1.5"><span className="size-3 rounded-full bg-[#111111]" />{t('legend.queue')}</span> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function RouteCard({ rider, color, ids, orders, store, riders, focused, onFocus, onMove, onShift, onOptimise }: {
  rider: DispatchRider;
  color: string;
  ids: string[];
  orders: Map<string, DispatchOrder>;
  store: Point;
  riders: DispatchRider[];
  focused: boolean;
  onFocus: (on: boolean) => void;
  onMove: (orderId: string, to: string | null) => void;
  onShift: (index: number, by: -1 | 1) => void;
  onOptimise: () => void;
}) {
  const t = useTranslations('dispatch');
  const stops = ids.map((id) => orders.get(id)).filter((order): order is DispatchOrder => Boolean(order));
  const legs = routeLegs(startPoint(rider, store), stops);
  const totalKm = legs.reduce<number>((total, km) => total + (km ?? 0), 0);
  const minutes = Math.round((totalKm / 22) * 60 + stops.length * 4);
  return (
    <section
      className={cn('rounded-2xl border bg-white p-4 transition-shadow', focused ? 'shadow-[0_8px_24px_rgba(17,17,17,0.1)]' : 'border-[#ECECEA]')}
      style={focused ? { borderColor: color } : undefined}
      onMouseEnter={() => onFocus(true)}
      onMouseLeave={() => onFocus(false)}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}><Bike className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{rider.name}</p>
          <p className="text-xs text-[#696965]">
            {stops.length ? t('routeSummary', { stops: stops.length, km: totalKm.toFixed(1), minutes }) : t('noNewStops')}
            {rider.active.length ? ` · ${t('alreadyCarrying', { count: rider.active.length })}` : ''}
          </p>
        </div>
        {stops.length > 1 ? (
          <button type="button" onClick={onOptimise} className="flex h-8 items-center gap-1 rounded-lg border border-[#E2E2DC] px-2 text-xs font-semibold" title={t('optimiseHint')}>
            <Route className="size-3.5" />{t('optimise')}
          </button>
        ) : null}
      </div>
      {stops.length ? (
        <ol className="mt-3 space-y-2">
          {stops.map((order, index) => (
            <li key={order.id} className="flex items-start gap-2 rounded-xl bg-[#FAFAF8] p-2.5">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: color }}>{rider.active.length + index + 1}</span>
              <div className="min-w-0 flex-1">
                <OrderLine order={order} compact legKm={legs[index] ?? null} />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <IconButton label={t('moveUp')} disabled={index === 0} onClick={() => onShift(index, -1)}><ArrowUp className="size-3.5" /></IconButton>
                  <IconButton label={t('moveDown')} disabled={index === stops.length - 1} onClick={() => onShift(index, 1)}><ArrowDown className="size-3.5" /></IconButton>
                  <select
                    aria-label={t('moveTo')}
                    className="h-7 min-w-0 flex-1 rounded-lg border border-[#E2E2DC] bg-white px-1.5 text-xs"
                    value=""
                    onChange={(event) => event.target.value && onMove(order.id, event.target.value)}
                  >
                    <option value="">{t('moveTo')}</option>
                    {riders.filter((other) => other.id !== rider.id).map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}
                  </select>
                  <IconButton label={t('unplan')} onClick={() => onMove(order.id, null)}><X className="size-3.5" /></IconButton>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="mt-2 text-sm text-[#8A8A86]">{t('dropHint')}</p>}
    </section>
  );
}

function OrderLine({ order, rank, compact, legKm }: { order: DispatchOrder; rank?: number; compact?: boolean; legKm?: number | null }) {
  const t = useTranslations('dispatch');
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  return (
    <div>
      <div className="flex items-center gap-2">
        {rank ? <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[#111111] text-[11px] font-bold text-[#FFC400]">{rank}</span> : null}
        <span className="text-sm font-semibold"><bdi dir="ltr">#{order.number}</bdi></span>
        <span className="min-w-0 flex-1 truncate text-xs text-[#696965]">{order.customerName}</span>
        {order.cash ? <span className="flex items-center gap-1 text-xs font-semibold text-[#8A5A00]"><Banknote className="size-3.5" />{formatMoney(order.total, locale)}</span> : null}
      </div>
      <p className="mt-1 flex items-center gap-1 truncate text-xs text-[#5C5C58]">
        <MapPin className="size-3 shrink-0" />
        <span className="truncate">{[order.address.line1, order.address.area].filter(Boolean).join(', ') || '—'}</span>
        {legKm !== undefined && legKm !== null ? <span className="ms-auto shrink-0 text-[#8A8A86]">{t('legKm', { km: legKm.toFixed(1) })}</span> : order.distanceKm !== null ? <span className="ms-auto shrink-0 text-[#8A8A86]">{t('fromStore', { km: order.distanceKm.toFixed(1) })}</span> : null}
      </p>
      {!compact || order.reasons.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {order.reasons.map((reason) => <ReasonChip key={reason.code} reason={reason} />)}
          {!compact ? <span className="rounded-full bg-[#F2F2EF] px-2 py-0.5 text-[11px] text-[#5C5C58]">{t('score', { score: order.score })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ReasonChip({ reason }: { reason: DispatchReason }) {
  const t = useTranslations('dispatch.reasons');
  const tone = reason.code === 'HOT' || reason.code === 'LATE' || reason.code === 'DUE_SOON'
    ? 'bg-[#FDECEA] text-[#B42318]'
    : reason.code === 'WAITING' ? 'bg-[#FFF4D6] text-[#8A5A00]'
      : reason.code === 'NO_PIN' ? 'bg-[#F2F2EF] text-[#B42318]' : 'bg-[#E7F0FF] text-[#2F6FED]';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', tone)}>
      {reason.code === 'HOT' ? <Flame className="size-3" /> : null}
      {t(reason.code, 'minutes' in reason ? { minutes: reason.minutes } : 'km' in reason ? { km: reason.km.toFixed(1) } : {})}
    </span>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-[#696965]">
      <span>{label}</span>
      <div className="flex items-center rounded-lg border border-[#E2E2DC]">
        <button type="button" aria-label="−" disabled={value <= 1} onClick={() => onChange(value - 1)} className="grid size-7 place-items-center disabled:opacity-30"><Minus className="size-3" /></button>
        <span className="w-5 text-center text-sm font-semibold text-[#161616]">{value}</span>
        <button type="button" aria-label="+" disabled={value >= 10} onClick={() => onChange(value + 1)} className="grid size-7 place-items-center disabled:opacity-30"><Plus className="size-3" /></button>
      </div>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="grid size-7 place-items-center rounded-lg border border-[#E2E2DC] bg-white disabled:opacity-30">
      {children}
    </button>
  );
}

function Pill({ icon: Icon, label, tone }: { icon: typeof Clock; label: string; tone: 'good' | 'warn' | 'muted' }) {
  return (
    <span className={cn('flex h-9 items-center gap-1.5 rounded-xl px-3 font-medium', tone === 'good' ? 'bg-[#E3F5EA] text-[#168A52]' : tone === 'warn' ? 'bg-[#FFF4D6] text-[#8A5A00]' : 'bg-[#F2F2EF] text-[#696965]')}>
      <Icon className="size-4" />{label}
    </span>
  );
}

function DispatchSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <Skeleton className="h-10 w-64" />
      <div className="grid gap-4 xl:grid-cols-[440px_1fr]">
        <div className="space-y-3"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>
        <Skeleton className="h-[520px] rounded-2xl" />
      </div>
    </div>
  );
}

function hasPoint<T extends { latitude: number | null; longitude: number | null }>(row: T) {
  return row.latitude !== null && row.longitude !== null;
}

/** A rider's new stops start where their current route ends, or at the store. */
function startPoint(rider: DispatchRider, store: Point): Point {
  const last = [...rider.active].reverse().find(hasPoint);
  return last ? { latitude: last.latitude!, longitude: last.longitude! } : store;
}

function routeLegs(start: Point, stops: DispatchOrder[]) {
  let here: Point | null = start;
  return stops.map((order) => {
    if (!hasPoint(order) || !here) return null;
    const next = { latitude: order.latitude!, longitude: order.longitude! };
    const km = haversineKm(here, next);
    here = next;
    return km;
  });
}

function nearestFirst(start: Point, stops: DispatchOrder[]) {
  const left = stops.filter(hasPoint);
  const result: string[] = [];
  let here = start;
  while (left.length) {
    let best = 0;
    for (let index = 1; index < left.length; index += 1) {
      if (haversineKm(here, toPoint(left[index]!)) < haversineKm(here, toPoint(left[best]!))) best = index;
    }
    const [stop] = left.splice(best, 1);
    result.push(stop!.id);
    here = toPoint(stop!);
  }
  return [...result, ...stops.filter((order) => !hasPoint(order)).map((order) => order.id)];
}

function toPoint(order: DispatchOrder): Point {
  return { latitude: order.latitude!, longitude: order.longitude! };
}

function haversineKm(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function clock(iso: string, locale: 'en' | 'ar') {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-BH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Bahrain' }).format(new Date(iso));
}

