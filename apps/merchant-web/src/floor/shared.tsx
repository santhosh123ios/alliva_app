import { announce, audioReady, chime, unlock } from '@/components/order-alerts';
import { tableNo } from '@/lib/table-number';
import { api } from '@/components/providers';
import { formatMoney } from '@alliva/design-tokens';
import type { FloorBoard, FloorOrder, FloorTable, LocalizedText, OrderStatus, ServiceRequestView } from '@alliva/types';
import { cn, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

export { tableNo };

export type Locale = 'en' | 'ar';
export type TableStatus = FloorTable['status'];

const SOUND_KEY = 'alliva.floor.sound';
const BRANCH_KEY = 'alliva.floor.branch';
const DRAFT_KEY = 'alliva.floor.draft';
/** How often an unanswered diner call is announced again. Long enough for a few tables to be read out. */
const REPEAT_EVERY_MS = 10_000;

export function useFloorLocale(): Locale {
  return useLocale() === 'ar' ? 'ar' : 'en';
}

export function money(value: string | number | null | undefined, locale: Locale) {
  return formatMoney(value ?? 0, locale);
}

export function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: settings just do not stick.
  }
}

/** Re-renders every 30 seconds so waiting times stay current. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

/** "4 min", "1h 12m": how long a call or an order has been waiting. */
export function useAge() {
  const t = useTranslations('floor');
  return (iso: string, now: number) => {
    const minutes = minutesSince(iso, now);
    if (minutes < 1) return t('underMinute');
    if (minutes < 60) return t('minutes', { count: minutes });
    return t('hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  };
}

/* ---------- Settings shared by every tab ---------- */

type Settings = { branchId: string; setBranchId: (id: string) => void; sound: boolean; setSound: (on: boolean) => void };
const SettingsContext = createContext<Settings>({ branchId: '', setBranchId: () => undefined, sound: true, setSound: () => undefined });

export function useFloorSettings() {
  return useContext(SettingsContext);
}

/* ---------- The order being built ---------- */

/** The floor app only takes table orders. */
export type DraftTarget = { kind: 'DINE_IN'; tableId: string; tableNumber: string };
export type DraftLine = {
  key: string;
  productId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  notes: string;
  name: LocalizedText;
  detail: LocalizedText[];
  unitPrice: string;
};
type Draft = { target: DraftTarget | null; lines: DraftLine[]; notes: string };
type DraftApi = Draft & {
  setTarget: (target: DraftTarget | null) => void;
  add: (line: Omit<DraftLine, 'key'>) => void;
  setQuantity: (key: string, quantity: number) => void;
  setNotes: (notes: string) => void;
  clear: () => void;
  count: number;
  subtotal: number;
};
const DraftContext = createContext<DraftApi | null>(null);

export function useDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error('useDraft outside FloorProvider');
  return value;
}

function readDraft(): Draft {
  try {
    const saved = sessionStorage.getItem(DRAFT_KEY);
    if (saved) {
      const draft = JSON.parse(saved) as Draft;
      // Drafts saved before the floor went tables-only may still point at takeaway.
      return draft.target?.kind === 'DINE_IN' ? draft : { ...draft, target: null };
    }
  } catch {
    // Fall through to an empty draft.
  }
  return { target: null, lines: [], notes: '' };
}

export function FloorProvider({ children }: { children: React.ReactNode }) {
  const [branchId, setBranch] = useState(() => read(BRANCH_KEY) ?? '');
  const [sound, setSoundState] = useState(() => read(SOUND_KEY) !== 'off');
  const [draft, setDraft] = useState<Draft>(readDraft);
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // The draft only lives for this tab anyway.
    }
  }, [draft]);

  const settings = useMemo<Settings>(() => ({
    branchId,
    setBranchId: (id) => { setBranch(id); write(BRANCH_KEY, id); },
    sound,
    setSound: (on) => {
      setSoundState(on);
      write(SOUND_KEY, on ? 'on' : 'off');
      if (on) void unlock().then((ok) => { if (ok) chime(0.6); });
    },
  }), [branchId, sound]);

  const draftApi = useMemo<DraftApi>(() => ({
    ...draft,
    setTarget: (target) => setDraft((current) => ({ ...current, target })),
    add: (line) => setDraft((current) => {
      // The same dish with the same choices and note stacks on one line.
      const same = current.lines.find((row) => row.productId === line.productId && row.variantId === line.variantId && row.notes === line.notes && row.addonIds.join() === line.addonIds.join());
      if (same) return { ...current, lines: current.lines.map((row) => (row === same ? { ...row, quantity: Math.min(50, row.quantity + line.quantity) } : row)) };
      return { ...current, lines: [...current.lines, { ...line, key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }] };
    }),
    setQuantity: (key, quantity) => setDraft((current) => ({
      ...current,
      lines: quantity <= 0 ? current.lines.filter((row) => row.key !== key) : current.lines.map((row) => (row.key === key ? { ...row, quantity: Math.min(50, quantity) } : row)),
    })),
    setNotes: (notes) => setDraft((current) => ({ ...current, notes })),
    clear: () => setDraft({ target: null, lines: [], notes: '' }),
    count: draft.lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotal: draft.lines.reduce((sum, line) => sum + Number(line.unitPrice) * line.quantity, 0),
  }), [draft]);

  return (
    <SettingsContext.Provider value={settings}>
      <DraftContext.Provider value={draftApi}>{children}</DraftContext.Provider>
    </SettingsContext.Provider>
  );
}

/* ---------- Live data ---------- */

export const floorKey = (branchId: string) => ['merchant', 'floor', 'board', branchId] as const;

/**
 * Order takers only run tables. Orders diners send from the table QR arrive waiting (PENDING): the order taker
 * confirms them before they reach the kitchen. Other customer orders waiting for the store stay with managers.
 */
function tableOrdersOnly(board: FloorBoard): FloorBoard {
  return { ...board, orders: board.orders.filter((order) => order.tableId) };
}

/** Table orders a diner sent that nobody has confirmed yet, oldest first. */
export function awaitingConfirm(orders: FloorOrder[]) {
  return orders.filter((order) => order.status === 'PENDING' && order.tableId);
}

export function useFloorBoard() {
  const { branchId } = useFloorSettings();
  return useQuery({
    queryKey: floorKey(branchId),
    queryFn: () => api.floor(branchId || undefined),
    select: tableOrdersOnly,
    // Check often while a call is ringing, so it stops soon after the diner ends it.
    refetchInterval: (query) => (query.state.data?.requests.some((row) => row.status === 'OPEN') ? 5_000 : 20_000),
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useFloorMenu() {
  return useQuery({ queryKey: ['merchant', 'floor', 'menu'], queryFn: () => api.floorMenu(), staleTime: 60_000 });
}

/** Answer a call, updating the board straight away so the button does not lag the tap. */
export function useAnswerCall() {
  const client = useQueryClient();
  const { branchId } = useFloorSettings();
  const t = useTranslations('floor.calls');
  return useMutation({
    mutationFn: (input: { id: string; status: 'ACKNOWLEDGED' | 'RESOLVED' }) => api.answerServiceRequest(input.id, input.status),
    onMutate: async ({ id, status }) => {
      const key = floorKey(branchId);
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<FloorBoard>(key);
      client.setQueryData<FloorBoard>(key, (board) => board && {
        ...board,
        requests: status === 'RESOLVED' ? board.requests.filter((row) => row.id !== id) : board.requests.map((row) => (row.id === id ? { ...row, status } : row)),
      });
      return { before };
    },
    onSuccess: (_row, input) => toast.success(input.status === 'RESOLVED' ? t('doneToast') : t('comingToast')),
    onError: (error: Error, _input, context) => {
      if (context?.before) client.setQueryData(floorKey(branchId), context.before);
      toast.error(error.message);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ['merchant', 'floor', 'board'] }),
  });
}

/** Set a table's status, updating the board straight away; used to mark a cleaned table ready for guests. */
export function useTableStatus() {
  const client = useQueryClient();
  const { branchId } = useFloorSettings();
  return useMutation({
    mutationFn: (input: { table: FloorTable; status: TableStatus }) => api.setTableStatus(input.table.id, input.status),
    onMutate: async ({ table, status }) => {
      const key = floorKey(branchId);
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<FloorBoard>(key);
      client.setQueryData<FloorBoard>(key, (board) => board && { ...board, tables: board.tables.map((row) => (row.id === table.id ? { ...row, status } : row)) });
      return { before };
    },
    onError: (error: Error, _input, context) => {
      if (context?.before) client.setQueryData(floorKey(branchId), context.before);
      toast.error(error.message);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: ['merchant', 'floor', 'board'] }),
  });
}

/** Move an order along: accept, mark served or handed over, or reject. */
export function useOrderStep() {
  const client = useQueryClient();
  const { branchId } = useFloorSettings();
  return useMutation({
    mutationFn: (input: { order: FloorOrder; status: OrderStatus; preparationMinutes?: number; cancellationReason?: string }) =>
      api.transition(input.order.id, { status: input.status, ...(input.preparationMinutes ? { preparationMinutes: input.preparationMinutes } : {}), ...(input.cancellationReason ? { cancellationReason: input.cancellationReason } : {}) }),
    onMutate: async ({ order, status }) => {
      const key = floorKey(branchId);
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<FloorBoard>(key);
      const done = status === 'DELIVERED' || status === 'CANCELLED';
      client.setQueryData<FloorBoard>(key, (board) => board && {
        ...board,
        orders: done ? board.orders.filter((row) => row.id !== order.id) : board.orders.map((row) => (row.id === order.id ? { ...row, status } : row)),
        servedToday: board.servedToday + (status === 'DELIVERED' ? 1 : 0),
      });
      return { before };
    },
    onError: (error: Error, _input, context) => {
      if (context?.before) client.setQueryData(floorKey(branchId), context.before);
      toast.error(error.message);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'floor', 'board'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
    },
  });
}

/**
 * Says out loud which table needs what ("Table 12 wants a waiter", "Table 12's food is ready") and buzzes,
 * with the same words in a toast. The first load only sets the baseline, so opening the app is quiet,
 * but a diner's call is announced again every few seconds until someone takes it or the diner ends it.
 */
export function useFloorAlerts(board: FloorBoard | undefined) {
  const t = useTranslations('floor.alerts');
  const locale = useFloorLocale();
  const { sound } = useFloorSettings();
  const seen = useRef<{ calls: Set<string>; ready: Set<string>; fresh: Set<string>; cleaning: Set<string> } | null>(null);
  const [unlocked, setUnlocked] = useState(audioReady);

  // Browsers keep a page silent until someone taps it, and phones can lock audio again after the app was in
  // the background. Every tap or key press unlocks it, so the first touch of a shift turns announcements on.
  useEffect(() => {
    const onGesture = () => void unlock().then(setUnlocked);
    const onVisible = () => setUnlocked(audioReady());
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const callLine = useCallback((call: ServiceRequestView) => t(`call.${call.kind}`, { table: tableNo(call.table.number) }), [t]);
  const newOrderLine = useCallback((order: FloorOrder) => t('newTableOrder', { table: tableNo(order.tableNumber ?? '') }), [t]);
  const say = useCallback(
    (lines: string[]) => {
      if (!sound || !lines.length) return;
      // Replace anything still being read, so repeats never queue up behind each other.
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      announce(lines.join('. '), locale, 1);
    },
    [sound, locale],
  );

  useEffect(() => {
    if (!board) return;
    const calls = new Set(board.requests.filter((row) => row.status === 'OPEN').map((row) => row.id));
    const ready = new Set(board.orders.filter((row) => row.status === 'READY_FOR_PICKUP').map((row) => row.id));
    const fresh = new Set(awaitingConfirm(board.orders).map((row) => row.id));
    const cleaning = new Set(board.tables.filter((row) => row.status === 'INACTIVE').map((row) => row.id));
    if (seen.current) {
      const freshCalls = board.requests.filter((row) => row.status === 'OPEN' && !seen.current!.calls.has(row.id));
      const freshOrders = awaitingConfirm(board.orders).filter((row) => !seen.current!.fresh.has(row.id));
      const freshReady = board.orders.filter((row) => row.status === 'READY_FOR_PICKUP' && !seen.current!.ready.has(row.id));
      const callLines = freshCalls.map(callLine);
      const orderLines = freshOrders.map(newOrderLine);
      const readyLines = freshReady.map((order) => (order.tableNumber ? t('readyTable', { table: tableNo(order.tableNumber) }) : t('ready', { number: order.number.replace(/^#/, '') })));
      for (const line of [...callLines, ...orderLines]) toast(line);
      const cleanLines = board.tables.filter((row) => row.status === 'INACTIVE' && !seen.current!.cleaning.has(row.id)).map((row) => t('needsCleaning', { table: tableNo(row.number) }));
      for (const line of readyLines) toast.success(line);
      for (const line of cleanLines) toast(line);
      if (callLines.length || orderLines.length || readyLines.length || cleanLines.length) {
        say([...callLines, ...orderLines, ...readyLines, ...cleanLines]);
        if ('vibrate' in navigator) navigator.vibrate?.(freshCalls.length || freshOrders.length ? [200, 90, 200, 90, 200] : [160, 80, 160]);
      }
    }
    seen.current = { calls, ready, fresh, cleaning };
  }, [board, t, callLine, newOrderLine, say]);

  // Repeat every waiting call and unconfirmed table order by name until someone answers or confirms it.
  const waiting = board?.requests.filter((row) => row.status === 'OPEN') ?? [];
  const unconfirmed = board ? awaitingConfirm(board.orders) : [];
  const waitingKey = [...waiting, ...unconfirmed].map((row) => row.id).sort().join();
  const waitingRef = useRef({ waiting, unconfirmed });
  waitingRef.current = { waiting, unconfirmed };
  useEffect(() => {
    if (!waitingKey) return;
    const timer = window.setInterval(() => {
      say([...waitingRef.current.waiting.map(callLine), ...waitingRef.current.unconfirmed.map(newOrderLine)]);
      if ('vibrate' in navigator) navigator.vibrate?.([200, 90, 200]);
    }, REPEAT_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [waitingKey, say, callLine, newOrderLine]);

  /** True while sound is switched on but the browser has not been allowed to play it yet. */
  return { needsTap: sound && !unlocked };
}

/** Calls and orders for one table, oldest first. */
export function useTableActivity(board: FloorBoard | undefined) {
  return useCallback(
    (tableId: string) => ({
      calls: (board?.requests ?? []).filter((row) => row.table.id === tableId),
      orders: (board?.orders ?? []).filter((row) => row.tableId === tableId),
    }),
    [board],
  );
}

/* ---------- Small shared pieces ---------- */

export type Stage = 'new' | 'toStart' | 'cooking' | 'ready';

export function stageOf(status: OrderStatus): Stage {
  if (status === 'PENDING') return 'new';
  if (status === 'PREPARING') return 'cooking';
  if (status === 'READY_FOR_PICKUP') return 'ready';
  return 'toStart';
}

const stageTone: Record<Stage, string> = {
  new: 'bg-destructive-soft text-destructive',
  toStart: 'bg-surface-2 text-foreground',
  cooking: 'bg-primary-soft text-warning',
  ready: 'bg-success-soft text-success',
};

export function StagePill({ status, className }: { status: OrderStatus; className?: string }) {
  const t = useTranslations('floor.stage');
  const stage = stageOf(status);
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', stageTone[stage], className)}>
      <span className={cn('size-1.5 rounded-full', stage === 'new' ? 'bg-destructive' : stage === 'cooking' ? 'animate-pulse bg-primary' : stage === 'ready' ? 'bg-success' : 'bg-subtle')} />
      {t(stage)}
    </span>
  );
}

export const tableTone: Record<TableStatus, { fill: string; ring: string; text: string; dot: string }> = {
  AVAILABLE: { fill: 'bg-card', ring: 'border-success', text: 'text-success', dot: 'bg-success' },
  OCCUPIED: { fill: 'bg-primary-soft', ring: 'border-primary', text: 'text-warning', dot: 'bg-primary' },
  RESERVED: { fill: 'bg-info-soft', ring: 'border-info/30', text: 'text-info', dot: 'bg-info' },
  INACTIVE: { fill: 'bg-surface-2', ring: 'border-border-strong', text: 'text-muted-foreground', dot: 'bg-subtle' },
};

export function itemLine(item: { name: LocalizedText; addons: LocalizedText[] }, locale: Locale) {
  const name = item.name[locale] || item.name.en;
  return item.addons.length ? `${name} · ${item.addons.map((addon) => addon[locale] || addon.en).join(', ')}` : name;
}

export function callsFor(requests: ServiceRequestView[], tableId: string) {
  return requests.filter((row) => row.table.id === tableId);
}
