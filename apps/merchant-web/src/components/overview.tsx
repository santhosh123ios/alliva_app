import { api } from '@/components/providers';
import { orderHandled } from '@/components/order-alerts';
import { Link, useRouter } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { AuthUser, FulfillmentType, MerchantDashboard, MerchantSalesPoint, OrderStatus } from '@alliva/types';
import { Skeleton, toast } from '@alliva/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Armchair,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bike,
  Check,
  ChevronRight,
  ClipboardList,
  Clock,
  FilePlus2,
  GripVertical,
  Info,
  PackagePlus,
  TriangleAlert,
  Settings2,
  ShoppingBag,
  Tag,
  Users,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Lane = 'new' | 'preparing' | 'ready';
type Channel = 'all' | FulfillmentType;
type Range = 'today' | 'week' | 'month';
type LiveOrder = MerchantDashboard['liveOrders'][number];

const laneOf = (status: OrderStatus): Lane | null => {
  if (status === 'PENDING') return 'new';
  if (status === 'ACCEPTED' || status === 'PREPARING') return 'preparing';
  if (status === 'READY_FOR_PICKUP' || status === 'ASSIGNED_TO_DRIVER') return 'ready';
  return null;
};

// Mirrors the server's assertTransition for the moves the board can make by drag;
// the server stays the authority and refused moves are rolled back.
const FULL_ACCESS = ['SUPER_ADMIN', 'ADMIN', 'MERCHANT_OWNER', 'MERCHANT_MANAGER', 'OPERATIONS_MANAGER', 'OPERATIONS_STAFF'];
const ROLE_STATUSES: Record<string, OrderStatus[]> = {
  KITCHEN_STAFF: ['PREPARING', 'READY_FOR_PICKUP'],
  ORDER_TAKING_STAFF: ['ACCEPTED', 'CANCELLED', 'PREPARING'],
  DELIVERY_STAFF: ['OUT_FOR_DELIVERY', 'DELIVERED'],
};

type DropCheck = { status: OrderStatus } | { refused: 'notAllowed' | 'startFirst' | 'noPermission' } | null;

function dropCheck(order: LiveOrder, lane: Lane | null, roles: string[]): DropCheck {
  if (!lane || lane === laneOf(order.status)) return null;
  const status: OrderStatus | null =
    order.status === 'PENDING' && lane === 'preparing' ? 'ACCEPTED'
    : order.status === 'PREPARING' && lane === 'ready' ? 'READY_FOR_PICKUP'
    : null;
  if (!status) return { refused: order.status === 'ACCEPTED' && lane === 'ready' ? 'startFirst' : 'notAllowed' };
  const permitted = roles.some((role) => FULL_ACCESS.includes(role) || ROLE_STATUSES[role]?.includes(status));
  return permitted ? { status } : { refused: 'noPermission' };
}

function floatingState(drag: Drag, roles: string[]) {
  const check = dropCheck(drag.order, drag.over, roles);
  if (!check) return 'idle' as const;
  return 'status' in check ? 'allowed' as const : 'refused' as const;
}

type Drag = {
  order: LiveOrder;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  x: number;
  y: number;
  active: boolean;
  over: Lane | null;
};

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Flies a clone of `el` from `start` (viewport coords) into its current slot; a clone avoids clipping by the lane's scroll box. */
function fly(el: HTMLElement, start: { left: number; top: number }) {
  const rect = el.getBoundingClientRect();
  const dx = start.left - rect.left;
  const dy = start.top - rect.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('data-lane');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    margin: '0', zIndex: '60', pointerEvents: 'none', listStyle: 'none', opacity: '1', visibility: 'visible',
  });
  document.body.appendChild(ghost);
  el.style.visibility = 'hidden';
  const animation = ghost.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(1.03)`, boxShadow: '0 14px 30px rgba(17,17,17,0.18)' },
      { transform: 'translate(0, 0) scale(1)', boxShadow: '0 1px 2px rgba(17,17,17,0.04)' },
    ],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
  const done = () => {
    ghost.remove();
    el.style.visibility = '';
  };
  animation.onfinish = done;
  animation.oncancel = done;
}

export function Overview({ dash }: { dash: MerchantDashboard }) {
  const t = useTranslations('workspace.desk');
  const workspace = useTranslations('workspace');
  const ordersT = useTranslations('merchantOrders');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const client = useQueryClient();
  const now = useNow();
  const [channel, setChannel] = useState<Channel>('all');
  const [range, setRange] = useState<Range>('today');
  const [accepting, setAccepting] = useState(dash.acceptingOrders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [overrides, setOverrides] = useState<Record<string, OrderStatus>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLLIElement>());
  const lastSlots = useRef(new Map<string, { x: number; y: number; lane: string }>());
  const flyFrom = useRef(new Map<string, { left: number; top: number }>());
  const roles = client.getQueryData<AuthUser>(['me'])?.roles ?? [];
  const name = pickLocalized(dash.merchantName, locale) || t('planFallback');
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const hello = hour < 12 ? t('goodMorning') : hour < 17 ? t('goodAfternoon') : t('goodEvening');
  const live = dash.liveOrders
    .map((order) => (overrides[order.id] ? { ...order, status: overrides[order.id]! } : order))
    .filter((order) => channel === 'all' || order.fulfillmentType === channel);
  const layoutKey = live.map((order) => `${order.id}:${order.status}`).join('|');
  const counts = {
    all: dash.liveOrders.length,
    DELIVERY: dash.liveOrders.filter((order) => order.fulfillmentType === 'DELIVERY').length,
    TAKEAWAY: dash.liveOrders.filter((order) => order.fulfillmentType === 'TAKEAWAY').length,
    DINE_IN: dash.liveOrders.filter((order) => order.fulfillmentType === 'DINE_IN').length,
  };
  const stock = dash.lowStock.slice(0, 3);
  const planName = pickLocalized(dash.plan.name, locale) || t('planFallback');

  useEffect(() => {
    setAccepting(dash.acceptingOrders);
  }, [dash.acceptingOrders]);

  async function toggleAccepting() {
    const next = !accepting;
    setAccepting(next);
    setNotice('');
    try {
      await api.updateProfile({ availability: next ? 'OPEN' : 'CLOSED' });
      await client.invalidateQueries({ queryKey: ['merchant', 'dashboard'] });
      await client.invalidateQueries({ queryKey: ['merchant', 'business'] });
    } catch {
      setAccepting(!next);
      setNotice(t('toggleFailed'));
    }
  }

  // Card moves between lanes (optimistic updates, rollbacks, refetches) animate from the old slot.
  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const origin = board.getBoundingClientRect();
    const animate = !reducedMotion();
    const next = new Map<string, { x: number; y: number; lane: string }>();
    cards.current.forEach((el, id) => {
      const rect = el.getBoundingClientRect();
      const lane = el.dataset.lane ?? '';
      next.set(id, { x: rect.left - origin.left, y: rect.top - origin.top, lane });
      const from = flyFrom.current.get(id);
      const previous = lastSlots.current.get(id);
      if (!animate) return;
      if (from) fly(el, from);
      else if (previous && previous.lane !== lane) fly(el, { left: previous.x + origin.left, top: previous.y + origin.top });
    });
    flyFrom.current.clear();
    lastSlots.current = next;
  }, [layoutKey, drag === null]);

  useEffect(() => {
    if (!drag) return;
    const finish = (cancelled: boolean) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current?.active) return;
      flyFrom.current.set(current.order.id, { left: current.x - current.offsetX, top: current.y - current.offsetY });
      if (cancelled) return;
      const check = dropCheck(current.order, current.over, roles);
      if (!check) return;
      if ('refused' in check) {
        toast.error(t(check.refused === 'startFirst' ? 'dropStartFirst' : check.refused === 'noPermission' ? 'dropNoPermission' : 'dropNotAllowed'));
        return;
      }
      void move(current.order.id, check.status === 'ACCEPTED'
        ? { status: 'ACCEPTED', preparationMinutes: dash.preparationTargetMinutes }
        : { status: check.status });
    };
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const active = current.active || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 6;
      const target = active ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-lane-drop]') : null;
      const updated = { ...current, active, x: event.clientX, y: event.clientY, over: (target?.dataset.laneDrop as Lane | undefined) ?? null };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finish(false);
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finish(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
    // Listeners only need re-binding when a drag starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag === null]);

  function startDrag(event: React.PointerEvent<HTMLLIElement>, order: LiveOrder) {
    if (busyId || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a')) return;
    const handle = Boolean(target.closest('[data-drag-handle]'));
    // Touch and pen drag from the grip so the lanes still scroll; a mouse can grab the whole card.
    if (event.pointerType !== 'mouse' && !handle) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; window listeners still track the pointer.
    }
    const next: Drag = {
      order,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      x: event.clientX,
      y: event.clientY,
      active: handle,
      over: laneOf(order.status),
    };
    dragRef.current = next;
    setDrag(next);
  }

  async function move(id: string, body: { status: OrderStatus; preparationMinutes?: number; driverId?: string }) {
    setBusyId(id);
    setNotice('');
    if (laneOf(body.status)) setOverrides((current) => ({ ...current, [id]: body.status }));
    try {
      await api.transition(id, body);
      orderHandled(id);
      await client.invalidateQueries({ queryKey: ['merchant', 'dashboard'] });
      await client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
    } catch (error) {
      toast.error(t('moveRefused'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setOverrides((current) => {
        const { [id]: _done, ...rest } = current;
        return rest;
      });
      setBusyId(null);
    }
  }

  function openStore() {
    if (!dash.slug || typeof window === 'undefined') {
      router.push('/orders');
      return;
    }
    window.open(`http://${window.location.hostname}:3000/${locale}/merchants/${dash.slug}`, '_blank', 'noopener,noreferrer');
  }

  function handOver(order: LiveOrder) {
    if (order.fulfillmentType === 'DELIVERY') {
      const driver = dash.drivers.length === 1 ? dash.drivers[0] : null;
      if (driver) {
        void move(order.id, { status: 'ASSIGNED_TO_DRIVER', driverId: driver.id });
        return;
      }
      router.push('/orders');
      return;
    }
    void move(order.id, { status: 'DELIVERED' });
  }

  const lanes: { key: Lane; title: string; icon: LucideIcon; tint: string; iconTint: string }[] = [
    { key: 'new', title: ordersT('new'), icon: ClipboardList, tint: 'bg-[#FFF8E4]', iconTint: 'text-[#C49200]' },
    { key: 'preparing', title: ordersT('preparing'), icon: Settings2, tint: 'bg-[#EEF3FF]', iconTint: 'text-[#3B6FE8]' },
    { key: 'ready', title: ordersT('ready'), icon: Check, tint: 'bg-[#EAF8EF]', iconTint: 'text-[#16924A]' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-[#161616]">{t('title')}</h1>
          <p className="mt-1 text-sm text-[#6E6E69]">{hello} — {t('happening', { name })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={accepting}
            title={t('acceptingHint')}
            onClick={() => void toggleAccepting()}
            className="inline-flex items-center gap-2 rounded-full py-1 text-sm font-semibold text-[#161616]"
          >
            <span className={`relative h-6 w-11 rounded-full transition ${accepting ? 'bg-[#22A85A]' : 'bg-[#D5D5D0]'}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start] ${accepting ? 'start-5' : 'start-0.5'}`} />
            </span>
            {t('acceptingOrders')}
            <Info className="size-4 text-[#9A9A94]" />
          </button>
          <Link href="/products?new=1" className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-[#111111] hover:bg-[#ffcf33]">
            <span className="text-lg leading-none">+</span> {t('addProduct')}
          </Link>
        </div>
      </div>
      {notice ? <p className="text-sm font-medium text-[#B42318]">{notice}</p> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric href="/orders" icon={ShoppingBag} label={t('todaysOrders')} value={String(dash.ordersToday)} detail={<Change value={dash.ordersChange} suffix={t('vsYesterday')} />} />
        <Metric href="/orders" icon={BarChart3} label={t('netSales')} value={formatMoney(dash.netSales, locale)} detail={<Change value={dash.salesChange} suffix={t('vsYesterday')} />} />
        <Metric
          href="/orders"
          icon={ClipboardList}
          label={t('activeOrders')}
          value={String(dash.activeOrders)}
          detail={dash.attentionOrders > 0 ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#D9342B]"><span className="size-1.5 rounded-full bg-[#D9342B]" />{t('needAttention', { count: dash.attentionOrders })}</span> : null}
        />
        <Metric
          href="/business"
          icon={Clock}
          label={t('averagePreparation')}
          value={dash.averagePreparationMinutes === null ? '—' : t('minutesShort', { count: dash.averagePreparationMinutes })}
          detail={<span className="text-xs text-[#8A8A86]">{t('targetMinutes', { count: dash.preparationTargetMinutes })}</span>}
        />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.82fr)]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#161616]">{t('liveBoard')}</h2>
                <p className="mt-0.5 text-sm text-[#8A8A86]">{t('liveHint')}</p>
              </div>
              <div className="inline-flex w-fit gap-1 self-start rounded-full bg-[#F4F4F1] p-1 text-xs font-semibold">
                <FilterChip active={channel === 'all'} onClick={() => setChannel('all')}>{t('allCount', { count: counts.all })}</FilterChip>
                <FilterChip active={channel === 'DELIVERY'} onClick={() => setChannel('DELIVERY')}>{t('deliveryCount', { count: counts.DELIVERY })}</FilterChip>
                <FilterChip active={channel === 'TAKEAWAY'} onClick={() => setChannel('TAKEAWAY')}>{t('takeawayCount', { count: counts.TAKEAWAY })}</FilterChip>
                <FilterChip active={channel === 'DINE_IN'} onClick={() => setChannel('DINE_IN')}>{t('dineInCount', { count: counts.DINE_IN })}</FilterChip>
              </div>
            </div>
            <div ref={boardRef} className="mt-4 grid gap-3 lg:grid-cols-3">
              {lanes.map((lane) => {
                const rows = live.filter((order) => laneOf(order.status) === lane.key);
                const dragging = drag?.active ? drag : null;
                const source = dragging ? laneOf(dragging.order.status) === lane.key : false;
                const check = dragging && !source ? dropCheck(dragging.order, lane.key, roles) : null;
                const allowed = Boolean(check && 'status' in check);
                const hovered = dragging?.over === lane.key && !source;
                const dropState = !dragging || source
                  ? ''
                  : allowed
                    ? `outline-2 outline-offset-2 outline-[#22A85A] ${hovered ? 'outline-solid brightness-[0.97]' : 'outline-dashed'}`
                    : `${hovered ? 'outline-2 outline-offset-2 outline-dashed outline-[#D9342B]' : ''} opacity-50`;
                return (
                  <div key={lane.key} data-lane-drop={lane.key} className={`rounded-2xl p-3 transition-[opacity,filter] ${lane.tint} ${dropState}`}>
                    <div className="flex items-center gap-2 px-1">
                      <span className={`grid size-7 place-items-center rounded-full bg-white ${lane.iconTint}`}><lane.icon className="size-3.5" /></span>
                      <h3 className="text-sm font-semibold text-[#161616]">{lane.title}</h3>
                      <span className="text-sm font-semibold text-[#8A8A86]">{rows.length}</span>
                      {dragging && !source ? (
                        <span className={`ms-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold ${allowed ? 'text-[#16924A]' : 'text-[#D9342B]'}`}>
                          {allowed ? t('dropHere') : t('cannotDrop')}
                        </span>
                      ) : null}
                    </div>
                    <ul className="mt-3 max-h-[440px] space-y-2 overflow-y-auto">
                      {rows.length ? rows.map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          lane={lane.key}
                          locale={locale}
                          now={now}
                          busy={busyId === order.id}
                          lifted={drag?.active === true && drag.order.id === order.id}
                          dragLabel={t('dragToMove')}
                          cardRef={(el) => {
                            if (el) cards.current.set(order.id, el);
                            else cards.current.delete(order.id);
                          }}
                          onPointerDown={(event) => startDrag(event, order)}
                          labels={{ accept: t('accept'), start: t('start'), markReady: t('markReady'), handedOver: t('handedOver'), walkIn: t('walkIn'), table: (number) => t('tableLabel', { number }), justNow: t('justNow'), minutes: (count) => t('minutesShort', { count }) }}
                          onAccept={() => void move(order.id, { status: 'ACCEPTED', preparationMinutes: dash.preparationTargetMinutes })}
                          onStart={() => void move(order.id, { status: 'PREPARING' })}
                          onReady={() => void move(order.id, { status: 'READY_FOR_PICKUP' })}
                          onHandOver={() => handOver(order)}
                        />
                      )) : <li className="rounded-xl bg-white/70 px-3 py-6 text-center text-xs font-medium text-[#8A8A86]">{t('laneEmpty')}</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
            {drag?.active ? (
              <ul
                inert
                aria-hidden
                className="pointer-events-none fixed z-[70] rotate-[1.5deg]"
                style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
              >
                <OrderCard
                  order={drag.order}
                  lane={laneOf(drag.order.status) ?? 'new'}
                  locale={locale}
                  now={now}
                  busy={false}
                  floating={floatingState(drag, roles)}
                  dragLabel=""
                  labels={{ accept: t('accept'), start: t('start'), markReady: t('markReady'), handedOver: t('handedOver'), walkIn: t('walkIn'), table: (number) => t('tableLabel', { number }), justNow: t('justNow'), minutes: (count) => t('minutesShort', { count }) }}
                  onAccept={() => undefined}
                  onStart={() => undefined}
                  onReady={() => undefined}
                  onHandOver={() => undefined}
                />
              </ul>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid size-8 place-items-center rounded-full bg-[#FFF6D4] text-[#161616]"><BarChart3 className="size-4" /></span>
                <div>
                  <h2 className="text-base font-semibold text-[#161616]">{t('salesOverview')}</h2>
                  <p className="text-sm text-[#8A8A86]">{t('salesHint')}</p>
                </div>
              </div>
              <div className="inline-flex gap-1 rounded-full bg-[#F4F4F1] p-1 text-xs font-semibold">
                <FilterChip active={range === 'today'} onClick={() => setRange('today')}>{t('today')}</FilterChip>
                <FilterChip active={range === 'week'} onClick={() => setRange('week')}>{t('days7')}</FilterChip>
                <FilterChip active={range === 'month'} onClick={() => setRange('month')}>{t('days30')}</FilterChip>
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(180px,0.7fr)]">
              <SalesChart points={dash.sales[range]} range={range} locale={locale} />
              <ul className="space-y-3">
                {dash.channels[range].map((row) => (
                  <li key={row.fulfillment} className="flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-[#F7F7F5] text-[#161616]">{channelIcon(row.fulfillment)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[#8A8A86]">{t(channelKey(row.fulfillment))}</p>
                      <p className="text-sm font-semibold text-[#161616]">{formatMoney(row.amount, locale)}</p>
                    </div>
                    <Change value={row.change} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#161616]">
              <span className="grid size-8 place-items-center rounded-full bg-[#FFF6D4]"><Zap className="size-4" /></span>
              {workspace('quickActions')}
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <QuickAction icon={FilePlus2} label={t('createOrder')} onClick={openStore} />
              <QuickAction icon={PackagePlus} label={t('addProduct')} href="/products?new=1" />
              <QuickAction icon={Tag} label={t('createOffer')} href="/products?offer=1" />
              <QuickAction icon={Armchair} label={t('manageTables')} href="/tables?new=1" />
              <QuickAction icon={Users} label={t('addStaff')} href="/staff?invite=1" />
              <QuickAction icon={Bike} label={t('updateDelivery')} href="/business" />
            </div>
          </section>

          <section className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-[#161616]">
                <span className="grid size-8 place-items-center rounded-full bg-[#FFF6D4]"><BarChart3 className="size-4" /></span>
                {t('topProducts')}
              </h2>
              <Link href="/products" className="text-sm font-semibold text-[#3B6FE8]">{t('viewAll')}</Link>
            </div>
            {dash.topProducts.length ? (
              <ol className="mt-3 space-y-3">
                {dash.topProducts.map((product, index) => (
                  <li key={product.id} className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center rounded-full bg-[#FFF6D4] text-xs font-semibold text-[#161616]">{index + 1}</span>
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" className="size-11 rounded-xl object-cover" />
                    ) : (
                      <span className="grid size-11 place-items-center rounded-xl bg-[#F7F7F5] text-[#8A8A86]"><UtensilsCrossed className="size-4" /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#161616]">{pickLocalized(product.name, locale)}</span>
                      <span className="block text-xs text-[#8A8A86]">{t('productOrders', { count: product.orders })}</span>
                    </span>
                    <span className="text-sm font-semibold text-[#161616]">{formatMoney(product.revenue, locale)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-4 text-sm text-[#8A8A86]">{t('noProducts')}</p>}
          </section>
        </div>
      </div>

      <section className="grid items-start gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-[#FDECEA] text-[#D9342B]"><TriangleAlert className="size-4" /></span>
              <div>
                <h2 className="text-base font-semibold text-[#161616]">{t('inventoryAlerts')}</h2>
                <p className="text-sm text-[#8A8A86]">{dash.lowStock.length ? t('lowStockCount', { count: dash.lowStock.length }) : t('noAlerts')}</p>
              </div>
            </div>
            <Link href="/products" className="shrink-0 text-sm font-semibold text-[#3B6FE8]">{t('viewAll')}</Link>
          </div>
          <ul className="mt-4 space-y-3">
            {stock.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-xl bg-[#F7F7F5] text-[#8A8A86]"><ShoppingBag className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#161616]">{pickLocalized(item.name, locale)}</span>
                  <span className="block text-xs text-[#8A8A86]">{t('left', { count: item.quantity })}</span>
                </span>
                <span className="rounded-full bg-[#FDECEA] px-2 py-1 text-[11px] font-semibold text-[#D9342B]">{t('lowStock')}</span>
              </li>
            ))}
          </ul>
          {stock.length ? <div className="mt-4 flex justify-end"><Link href="/products" className="inline-flex h-9 items-center rounded-xl border border-[#E6E6E2] px-3 text-sm font-semibold text-[#161616]">{t('manageStock')}</Link></div> : null}
        </article>

        <article className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
          <div className="flex items-start gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-[#EEF3FF] text-[#3B6FE8]"><Bike className="size-4" /></span>
            <div>
              <h2 className="text-base font-semibold text-[#161616]">{t('deliveryPerformance')}</h2>
              <p className="text-sm text-[#8A8A86]">{t('deliveryHint')}</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <Stat label={t('onTime')} value={dash.delivery.onTimeRate ?? '—'} change={dash.delivery.onTimeChange} />
            <Stat label={t('avgDistance')} value={dash.delivery.averageDistanceKm ? `${dash.delivery.averageDistanceKm} km` : '—'} change={dash.delivery.distanceChange} invert />
            <Stat label={t('driversOnline')} value={String(dash.delivery.driversOnline)} hint={dash.delivery.driversOnline > 0 ? t('ofAssigned', { count: dash.delivery.driversAssigned, total: dash.delivery.driversOnline }) : t('assignedOnly', { count: dash.delivery.driversAssigned })} />
          </div>
          {!dash.delivery.onTimeRate && !dash.delivery.averageDistanceKm ? <p className="mt-3 text-xs text-[#8A8A86]">{t('noDelivery')}</p> : null}
        </article>

        <article className="rounded-2xl border border-[#EEEEEC] bg-white p-4 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-[#FFF6D4]"><Zap className="size-4" /></span>
              <div>
                <h2 className="text-base font-semibold text-[#161616]">{dash.plan.name ? t('corePlan', { name: planName }) : t('noPlan')}</h2>
                <p className="text-sm text-[#8A8A86]">{t('planHint')}</p>
              </div>
            </div>
            <Link href="/subscription" className="shrink-0 text-sm font-semibold text-[#3B6FE8]">{t('manageSubscription')}</Link>
          </div>
          <div className="mt-4 space-y-3">
            <Usage label={t('products')} used={dash.plan.products.used} limit={dash.plan.products.limit} icon={ShoppingBag} />
            <Usage label={t('orders')} used={dash.plan.orders.used} limit={dash.plan.orders.limit} icon={ClipboardList} />
            <Usage label={t('staff')} used={dash.plan.staff.used} limit={dash.plan.staff.limit} icon={Users} />
          </div>
        </article>
      </section>
    </div>
  );
}

function Metric({ href, icon: Icon, label, value, detail }: { href: string; icon: LucideIcon; label: string; value: string; detail: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-2xl border border-[#EEEEEC] bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(17,17,17,0.03)]">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#FFF6D4] text-[#161616]"><Icon className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[#8A8A86]">{label}</span>
        <span className="mt-0.5 block truncate text-2xl font-semibold tracking-tight text-[#161616]">{value}</span>
        {detail ? <span className="mt-0.5 block">{detail}</span> : null}
      </span>
      <ChevronRight className="size-4 shrink-0 text-[#C8C8C2] rtl:rotate-180" />
    </Link>
  );
}

function Change({ value, suffix, invert = false }: { value: string | null; suffix?: string; invert?: boolean }) {
  if (!value) return suffix ? <span className="text-xs text-[#8A8A86]">{suffix}</span> : null;
  const negative = value.trim().startsWith('-');
  const flat = value === '0%';
  const good = flat || (invert ? negative : !negative);
  const Icon = negative ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${good ? 'text-[#16924A]' : 'text-[#D9342B]'}`}>
      {flat ? null : <Icon className="size-3.5" />}
      {value}
      {suffix ? <span className="font-medium text-[#8A8A86]"> {suffix}</span> : null}
    </span>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 ${active ? 'bg-white text-[#161616] shadow-sm' : 'text-[#6E6E69]'}`}>
      {children}
    </button>
  );
}

function OrderCard({
  order, lane, locale, now, busy, lifted = false, floating, dragLabel, cardRef, onPointerDown, labels, onAccept, onStart, onReady, onHandOver,
}: {
  order: LiveOrder;
  lane: Lane;
  locale: 'en' | 'ar';
  now: number;
  busy: boolean;
  lifted?: boolean;
  floating?: 'idle' | 'allowed' | 'refused';
  dragLabel: string;
  cardRef?: (el: HTMLLIElement | null) => void;
  onPointerDown?: (event: React.PointerEvent<HTMLLIElement>) => void;
  labels: { accept: string; start: string; markReady: string; handedOver: string; walkIn: string; table: (number: string) => string; justNow: string; minutes: (count: number) => string };
  onAccept: () => void;
  onStart: () => void;
  onReady: () => void;
  onHandOver: () => void;
}) {
  const who = order.fulfillmentType === 'DINE_IN' && order.tableNumber
    ? labels.table(order.tableNumber)
    : order.customerName || labels.walkIn;
  const elapsed = Math.max(0, Math.round((now - new Date(order.createdAt).getTime()) / 60000));
  const Icon = order.fulfillmentType === 'DINE_IN' ? UtensilsCrossed : order.fulfillmentType === 'TAKEAWAY' ? ShoppingBag : Bike;
  return (
    <li
      ref={cardRef}
      data-lane={lane}
      onPointerDown={onPointerDown}
      className={`flex select-none items-center gap-1.5 rounded-xl bg-white py-2.5 pe-3 ps-1 ${
        floating
          ? `shadow-[0_14px_30px_rgba(17,17,17,0.18)] ring-2 ${floating === 'allowed' ? 'ring-[#22A85A]' : floating === 'refused' ? 'ring-[#D9342B]' : 'ring-transparent'}`
          : 'shadow-[0_1px_2px_rgba(17,17,17,0.04)]'
      } ${busy ? 'opacity-60' : ''} ${lifted ? 'opacity-30' : ''} ${onPointerDown && !busy ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <span
        data-drag-handle
        aria-hidden
        title={dragLabel}
        className="grid h-9 w-4 shrink-0 cursor-grab touch-none place-items-center rounded-md text-[#B8B8B2] hover:bg-[#F4F4F1] hover:text-[#6E6E69]"
      >
        <GripVertical className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[#161616]" dir="ltr">#{order.number.replace(/^#/, '')}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#5C5C58]">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{who}</span>
          <span className="text-[#A3A39E]">· {elapsed < 1 ? labels.justNow : labels.minutes(elapsed)}</span>
        </p>
        <p className="mt-0.5 text-xs font-semibold text-[#161616]">{formatMoney(order.amount, locale)}</p>
      </div>
      <OrderAction order={order} labels={labels} disabled={busy} onAccept={onAccept} onStart={onStart} onReady={onReady} onHandOver={onHandOver} />
    </li>
  );
}

function OrderAction({ order, labels, disabled, onAccept, onStart, onReady, onHandOver }: {
  order: LiveOrder;
  labels: { accept: string; start: string; markReady: string; handedOver: string };
  disabled: boolean;
  onAccept: () => void;
  onStart: () => void;
  onReady: () => void;
  onHandOver: () => void;
}) {
  if (order.status === 'PENDING') {
    return <button type="button" disabled={disabled} onClick={onAccept} className="h-8 shrink-0 rounded-lg bg-primary px-3 text-xs font-semibold text-[#111111] disabled:opacity-60">{labels.accept}</button>;
  }
  if (order.status === 'ACCEPTED') {
    return <button type="button" disabled={disabled} onClick={onStart} className="h-8 shrink-0 rounded-lg border border-[#E6E6E2] bg-white px-3 text-xs font-semibold text-[#161616] disabled:opacity-60">{labels.start}</button>;
  }
  if (order.status === 'PREPARING') {
    return <button type="button" disabled={disabled} onClick={onReady} className="h-8 shrink-0 rounded-lg border border-[#E6E6E2] bg-white px-3 text-xs font-semibold text-[#161616] disabled:opacity-60">{labels.markReady}</button>;
  }
  if (order.status === 'ASSIGNED_TO_DRIVER') {
    return <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#16924A]"><Check className="size-3.5" />{labels.handedOver}</span>;
  }
  return <button type="button" disabled={disabled} onClick={onHandOver} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[#16924A] disabled:opacity-60"><Check className="size-3.5" />{labels.handedOver}</button>;
}

function QuickAction({ icon: Icon, label, href, onClick }: { icon: LucideIcon; label: string; href?: string; onClick?: () => void }) {
  const className = 'flex flex-col items-center justify-center gap-2 rounded-xl border border-[#EEEEEC] bg-[#FAFAF8] px-2 py-3 text-center text-xs font-semibold text-[#161616] hover:bg-[#F4F4F1]';
  const body = (<><span className="grid size-9 place-items-center rounded-xl bg-white text-[#161616] shadow-sm"><Icon className="size-4" /></span><span className="leading-tight">{label}</span></>);
  if (href) return <Link href={href} className={className}>{body}</Link>;
  return <button type="button" onClick={onClick} className={className}>{body}</button>;
}

function SalesChart({ points, range, locale }: { points: MerchantSalesPoint[]; range: Range; locale: 'en' | 'ar' }) {
  const values = points.map((point) => Number(point.amount));
  const max = Math.max(...values, 0);
  const ceiling = niceCeiling(max);
  const width = 640;
  const height = 150;
  const coords = values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - 12 - (value / ceiling) * (height - 28);
    return [x, y] as const;
  });
  const line = curve(coords);
  const area = coords.length ? `${line} L ${coords[coords.length - 1]?.[0] ?? 0} ${height} L ${coords[0]?.[0] ?? 0} ${height} Z` : '';
  const ticks = chartTicks(points, range, locale);
  return (
    <div dir="ltr">
      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-2">
        <div className="flex h-[150px] flex-col justify-between pb-5 text-[11px] text-[#A3A39E]">
          <span>{Math.round(ceiling)}</span>
          <span>{Math.round(ceiling / 2)}</span>
          <span>0</span>
        </div>
        <div>
          <svg viewBox={`0 0 ${width} ${height}`} className="h-[150px] w-full" role="img">
            <line x1="0" y1={height - 12} x2={width} y2={height - 12} stroke="#EEEEEC" />
            <defs>
              <linearGradient id="merchant-sales" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F5C400" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#F5C400" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {area ? <path d={area} fill="url(#merchant-sales)" /> : null}
            {line ? <path d={line} fill="none" stroke="#F5C400" strokeWidth="2.5" /> : null}
          </svg>
          <div className="mt-1 flex justify-between text-[11px] text-[#A3A39E]">
            {ticks.map((tick) => <span key={tick}>{tick}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, change, hint, invert = false }: { label: string; value: string; change?: string | null; hint?: string; invert?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-[#8A8A86]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-[#161616]">{value}</p>
      {change ? <Change value={change} invert={invert} /> : null}
      {hint ? <p className="mt-0.5 text-[11px] text-[#8A8A86]">{hint}</p> : null}
    </div>
  );
}

function Usage({ label, used, limit, icon: Icon }: { label: string; used: number; limit: number | null; icon: LucideIcon }) {
  const ratio = limit && limit > 0 ? Math.min(used / limit, 1) : used > 0 ? 1 : 0;
  const over = limit !== null && used > limit;
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-[#8A8A86]" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-[#161616]">{label}</span>
          <span className="text-[#8A8A86]">{limit === null ? used : `${used} / ${limit}`}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#F1F1EE]">
          <div className={`h-full rounded-full ${over ? 'bg-[#D9342B]' : 'bg-[#F5C400]'}`} style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function channelIcon(type: FulfillmentType) {
  if (type === 'TAKEAWAY') return <ShoppingBag className="size-4" />;
  if (type === 'DINE_IN') return <UtensilsCrossed className="size-4" />;
  return <Bike className="size-4" />;
}

function channelKey(type: FulfillmentType) {
  if (type === 'TAKEAWAY') return 'takeaway' as const;
  if (type === 'DINE_IN') return 'dineIn' as const;
  return 'delivery' as const;
}

function useNow(interval = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [interval]);
  return now;
}

function niceCeiling(max: number) {
  if (max <= 0) return 10;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = max / power <= 1 ? 1 : max / power <= 2 ? 2 : max / power <= 5 ? 5 : 10;
  return step * power;
}

function curve(points: readonly (readonly [number, number])[]) {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  let path = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    if (!previous || !current || !next || !after) continue;
    const c1x = current[0] + (next[0] - previous[0]) / 6;
    const c1y = current[1] + (next[1] - previous[1]) / 6;
    const c2x = next[0] - (after[0] - current[0]) / 6;
    const c2y = next[1] - (after[1] - current[1]) / 6;
    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${next[0].toFixed(1)} ${next[1].toFixed(1)}`;
  }
  return path;
}

function chartTicks(points: MerchantSalesPoint[], range: Range, locale: 'en' | 'ar') {
  if (!points.length) return [];
  if (range === 'today') {
    return points.filter((_, index) => index % 4 === 0).map((point) => hourLabel(point.at, locale));
  }
  const step = Math.max(1, Math.ceil(points.length / (range === 'week' ? 7 : 6)));
  return points.filter((_, index) => index % step === 0 || index === points.length - 1).map((point) => dayLabel(point.at, range, locale));
}

function hourLabel(hour: string, locale: 'en' | 'ar') {
  const date = new Date(Date.UTC(2020, 0, 1, Number(hour), 0, 0));
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-US', { hour: 'numeric', timeZone: 'UTC' }).format(date);
}

function dayLabel(day: string, range: Range, locale: 'en' | 'ar') {
  const date = new Date(`${day}T12:00:00+03:00`);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', range === 'week' ? { weekday: 'short' } : { day: 'numeric', month: 'short' }).format(date);
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-80" /></div>
        <div className="flex gap-2"><Skeleton className="h-10 w-40 rounded-full" /><Skeleton className="h-11 w-32 rounded-xl" /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[92px] rounded-2xl" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.82fr)]">
        <div className="space-y-4">
          <Skeleton className="h-[420px] rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    </div>
  );
}
