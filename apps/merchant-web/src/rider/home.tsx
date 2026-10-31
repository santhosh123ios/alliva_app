import { api } from '@/components/providers';
import { RouteMap } from '@/components/route-map';
import { Link } from '@/i18n/navigation';
import type { RiderOrder, RiderOrders } from '@alliva/types';
import { pickLocalized } from '@alliva/design-tokens';
import { cn, EmptyState, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Clock, Loader2, MapPin, Navigation, PackageCheck, QrCode, Route, Truck, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'use-intl';
import { PickupVerifier } from './scanner';
import { addressLines, minutesSince, money, riderKeys, riderStage, StagePill, timeLabel, useRiderLocale, useRiderOrders, useRiderPoint, useRiderProfile } from './shared';

export default function RiderHome() {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const profile = useRiderProfile();
  const orders = useRiderOrders();
  const { denied, point } = useRiderPoint();
  const [scanning, setScanning] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [collecting, setCollecting] = useState<string | null>(null);
  const client = useQueryClient();
  const active = orders.data?.active ?? [];
  const delivered = orders.data?.delivered ?? [];
  const cashDue = active.reduce((total, order) => total + (order.cashDue ? Number(order.cashDue) : 0), 0);
  const ready = active.filter((order) => riderStage(order) === 'pickedUp');
  const refresh = () => void client.invalidateQueries({ queryKey: ['rider'] });
  // Status moves one order at a time, so the ride starts each collected order in route order.
  const startRide = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.rider.setStatus(id, { status: 'OUT_FOR_DELIVERY' });
      return ids.length;
    },
    onSuccess: (count) => toast.success(t('home.rideStarted', { count })),
    onError: (error: Error) => toast.error(error.message),
    onSettled: refresh,
  });

  return (
    <div className="space-y-4">
      {profile.data && !profile.data.onShift ? <ShiftBanner /> : null}
      {denied && profile.data?.onShift ? <p className="rounded-2xl bg-[#FFF4D6] px-4 py-3 text-sm text-[#8A5A00]">{t('home.locationDenied')}</p> : null}

      <section className="grid grid-cols-3 gap-2">
        <Stat label={t('home.toDeliver')} value={orders.data ? String(active.length) : '–'} />
        <Stat label={t('home.deliveredToday')} value={orders.data ? String(delivered.length) : '–'} />
        <Stat label={t('home.cashToCollect')} value={orders.data ? money(cashDue, locale) : '–'} small />
      </section>

      <button
        type="button"
        onClick={() => setScanning(true)}
        className="flex w-full items-center gap-4 rounded-3xl bg-[#111111] p-4 text-start text-white shadow-[0_10px_30px_rgba(17,17,17,0.18)] active:scale-[0.99]"
      >
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-[#FFC400] text-[#111111]"><QrCode className="size-7" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">{t('home.scanTitle')}</span>
          <span className="block text-sm text-white/70">{t('home.scanBody')}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-white/60 rtl:rotate-180" />
      </button>

      <section>
        <div className="mb-2 flex items-end justify-between">
          <h1 className="text-lg font-semibold">{t('home.routeTitle')}</h1>
          {active.length > 1 ? <span className="text-xs text-[#696965]">{t('home.routeHint')}</span> : null}
        </div>
        {orders.data?.route && active.length ? (
          <RouteSummary
            route={orders.data.route}
            orders={active}
            me={point}
            ready={ready.length}
            starting={startRide.isPending && (startRide.variables?.length ?? 0) > 1}
            onStart={() => startRide.mutate(ready.map((order) => order.id))}
          />
        ) : null}
        {orders.isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-36 rounded-3xl" />)}</div>
        ) : orders.error ? (
          <ErrorState title={t('home.loadFailed')} body={(orders.error as Error).message} />
        ) : active.length ? (
          <ol className="space-y-3">
            {active.map((order, index) => (
              <li key={order.id}>
                <OrderCard order={order} next={index === 0} start={orders.data?.route?.start ?? 'store'} onCollect={() => setCollecting(order.id)} onStart={() => startRide.mutate([order.id])} starting={startRide.isPending && startRide.variables?.includes(order.id)} />
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-3xl border border-dashed border-[#DADAD4] bg-white">
            <EmptyState title={t('home.emptyTitle')} body={profile.data?.onShift ? t('home.emptyOnShift') : t('home.emptyOffShift')} />
          </div>
        )}
      </section>

      {delivered.length ? (
        <section>
          <button type="button" onClick={() => setShowDone((value) => !value)} className="flex w-full items-center justify-between py-2 text-sm font-semibold text-[#5C5C58]">
            {t('home.doneToday', { count: delivered.length })}
            <ChevronRight className={cn('size-4 transition-transform', showDone ? 'rotate-90' : 'rtl:rotate-180')} />
          </button>
          {showDone ? (
            <ul className="space-y-2">
              {delivered.map((order) => (
                <li key={order.id}>
                  <Link href={`/rider/orders/${order.id}`} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
                    <PackageCheck className="size-5 shrink-0 text-[#168A52]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold"><bdi dir="ltr">#{order.number}</bdi></span>
                      <span className="block truncate text-xs text-[#696965]">{order.customer.name}</span>
                    </span>
                    <span className="text-xs text-[#696965]">{timeLabel(order.events.at(-1)?.createdAt, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <PickupVerifier
        open={scanning}
        onOpenChange={setScanning}
      />
      <PickupVerifier
        open={collecting !== null}
        onOpenChange={(open) => { if (!open) setCollecting(null); }}
        orderId={collecting ?? undefined}
        onVerified={() => {
          setCollecting(null);
          toast.success(t('order.verified'));
        }}
      />
    </div>
  );
}

function ShiftBanner() {
  const t = useTranslations('rider');
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: () => api.rider.setShift({ onShift: true }),
    onSuccess: (profile) => client.setQueryData(riderKeys.me, profile),
  });
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-[#F0D27A] bg-[#FFF8E1] p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('home.offShiftTitle')}</p>
        <p className="text-xs text-[#6B5A2A]">{t('home.offShiftBody')}</p>
      </div>
      <button type="button" disabled={start.isPending} onClick={() => start.mutate()} className="h-10 shrink-0 rounded-xl bg-[#111111] px-4 text-sm font-semibold text-white disabled:opacity-50">
        {t('shift.start')}
      </button>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-3">
      <p className={cn('font-semibold tabular-nums', small ? 'text-sm leading-6' : 'text-xl')}>{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-[#696965]">{label}</p>
    </div>
  );
}

function OrderCard({ order, next, start, onCollect, onStart, starting }: { order: RiderOrder; next: boolean; start: 'store' | 'rider'; onCollect: () => void; onStart: () => void; starting?: boolean }) {
  const t = useTranslations('rider');
  const locale = useRiderLocale();
  const stage = riderStage(order);
  const place = addressLines(order.address, (part, value) => t(`address.${part}`, { value }));
  const waited = minutesSince(order.assignedAt ?? order.createdAt);
  const km = order.fromHereKm ?? order.distanceKm;
  return (
    <article className={cn('rounded-3xl border bg-white p-4 shadow-[0_4px_16px_rgba(17,17,17,0.04)]', next ? 'border-[#111111] ring-1 ring-[#111111]' : 'border-[#ECECE8]')}>
      {next ? <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#111111] px-2.5 py-1 text-[11px] font-semibold text-[#FFC400]"><Navigation className="size-3" />{t('home.nextStop')}</p> : null}
      <Link href={`/rider/orders/${order.id}`} className="block active:opacity-80">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#111111] text-sm font-bold text-[#FFC400]" aria-label={t('home.stop', { number: order.stop ?? 0 })}>{order.stop}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-base font-semibold">{order.customer.name}</p>
              <StagePill stage={stage} label={t(`stage.${stage}`)} />
            </div>
            <p className="flex items-center gap-1 text-xs text-[#696965]"><bdi dir="ltr">#{order.number}</bdi><ChevronRight className="size-3.5 rtl:rotate-180" /></p>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-[#8A8A86]" />
          <p className="min-w-0">
            <span className="block truncate font-medium">{place.title}</span>
            {place.detail ? <span className="block truncate text-xs text-[#696965]">{place.detail}</span> : null}
          </p>
        </div>
      </Link>
      <div className="mt-3 rounded-2xl bg-[#F7F7F5] px-3 py-1">
        <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#8A8A86]">{t('home.items', { count: order.items.reduce((total, item) => total + item.quantity, 0) })}</p>
        <ul className="divide-y divide-[#ECECE8]">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-start gap-2.5 py-2 text-sm">
              <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md bg-white px-1 text-xs font-bold tabular-nums">{item.quantity}×</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-6">{pickLocalized(item.name, locale)}</span>
                {item.addons.length ? <span className="block text-xs text-[#696965]">{item.addons.map((addon) => pickLocalized(addon.name, locale)).join(', ')}</span> : null}
                {item.notes ? <span className="block text-xs italic text-[#8A5A00]">{item.notes}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#5C5C58]">
        {order.legKm !== null ? (
          <span className="flex items-center gap-1 font-semibold text-[#111111]">
            <Route className="size-3.5" />
            {order.stop === 1 ? t(start === 'rider' ? 'home.legFromYou' : 'home.legFromStore', { km: order.legKm.toFixed(1) }) : t('home.legFromPrevious', { km: order.legKm.toFixed(1) })}
          </span>
        ) : km !== null ? <span className="flex items-center gap-1"><Navigation className="size-3.5" />{t('home.km', { km: km.toFixed(1) })}</span> : <span className="font-semibold text-[#B42318]">{t('home.noPin')}</span>}
        {order.etaMinutes !== null ? <span>{t('home.eta', { minutes: order.etaMinutes })}</span> : null}
        <span className={cn('flex items-center gap-1', waited > 30 && 'font-semibold text-[#B42318]')}><Clock className="size-3.5" />{t('home.minutesAgo', { minutes: waited })}</span>
        <span className="flex items-center gap-1">
          <Wallet className="size-3.5" />
          {order.cashDue ? <strong className="font-semibold text-[#111111]">{t('home.collect', { amount: money(order.cashDue, locale) })}</strong> : t('home.paid')}
        </span>
      </div>
      <div className="mt-3 border-t border-[#F0F0EC] pt-3">
        {stage === 'assigned' ? (
          <button type="button" onClick={onCollect} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white">
            <PackageCheck className="size-4" />{t('home.markCollected')}
          </button>
        ) : stage === 'pickedUp' ? (
          <button type="button" disabled={starting} onClick={onStart} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#FFC400] text-sm font-semibold text-[#111111] disabled:opacity-60">
            {starting ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}{t('home.startRide')}
          </button>
        ) : (
          <Link href={`/rider/orders/${order.id}`} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#168A52] text-sm font-semibold text-white">
            <Check className="size-4" />{t('home.deliverNow')}
          </Link>
        )}
      </div>
    </article>
  );
}

/** The whole run at a glance: the stops on a map in driving order, how far and how long, and one tap to navigate it. */
function RouteSummary({ route, orders, me, ready, starting, onStart }: { route: NonNullable<RiderOrders['route']>; orders: RiderOrder[]; me: { latitude: number; longitude: number } | null; ready: number; starting: boolean; onStart: () => void }) {
  const t = useTranslations('rider');
  const first = orders[0]!;
  const store = useMemo(() => ({ lat: first.store.latitude, lng: first.store.longitude }), [first.store.latitude, first.store.longitude]);
  const here = useMemo(() => (me ? { lat: me.latitude, lng: me.longitude } : null), [me?.latitude, me?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinned = orders.filter((order) => order.address.latitude !== null && order.address.longitude !== null);
  const key = pinned.map((order) => `${order.id}:${order.stop}`).join(',');
  const routes = useMemo(
    () => [{ id: 'route', color: '#6B3FD6', stops: pinned.map((order) => ({ lat: order.address.latitude!, lng: order.address.longitude!, label: String(order.stop), title: order.customer.name })) }],
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const fromMe = route.start === 'rider';
  const navigate = routeLink(pinned, fromMe ? null : first.store);
  return (
    <div className="mb-3 overflow-hidden rounded-3xl bg-white">
      <RouteMap store={store} routes={routes} me={here} startAtMe={fromMe} className="z-0 h-48 w-full" />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[#EDE7FF] text-[#6B3FD6]"><Route className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('home.routeStats', { stops: orders.length, km: route.totalKm.toFixed(1), minutes: route.etaMinutes })}</p>
            <p className="text-xs text-[#696965]">{fromMe ? t('home.routeFromYou') : t('home.routeFromStore')}</p>
          </div>
        </div>
        <div className={cn('grid gap-2', ready && navigate ? 'grid-cols-2' : 'grid-cols-1')}>
          {navigate ? (
            <a href={navigate} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white">
              <Navigation className="size-4" />{t('home.navigateRoute')}
            </a>
          ) : null}
          {ready ? (
            <button type="button" disabled={starting} onClick={onStart} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#FFC400] text-sm font-semibold text-[#111111] disabled:opacity-60">
              {starting ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
              {t('home.startRideAll', { count: ready })}
            </button>
          ) : null}
        </div>
        {route.toCollect ? <p className="text-center text-xs text-[#696965]">{t('home.stillToCollect', { count: route.toCollect })}</p> : null}
      </div>
    </div>
  );
}

/** Google Maps directions through every stop in route order. Without an origin it starts from the phone's location. */
function routeLink(orders: RiderOrder[], origin: { latitude: number; longitude: number } | null) {
  if (!orders.length) return null;
  const at = (order: RiderOrder) => `${order.address.latitude},${order.address.longitude}`;
  // Google takes up to 9 waypoints in a link; later stops follow once the rider gets there.
  const stops = orders.slice(0, 10);
  const params = new URLSearchParams({ api: '1', destination: at(stops.at(-1)!), travelmode: 'driving' });
  if (origin) params.set('origin', `${origin.latitude},${origin.longitude}`);
  if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(at).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
