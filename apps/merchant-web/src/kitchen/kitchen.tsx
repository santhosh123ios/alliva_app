import { chime, unlock, useOrderUpdates } from '@/components/order-alerts';
import { api } from '@/components/providers';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { localizeHref } from '@/i18n/routing';
import { canOpen, landingFor } from '@/lib/roles';
import { pickLocalized } from '@alliva/design-tokens';
import type { KitchenBoard, KitchenTicket, OrderStatus } from '@alliva/types';
import { cn, PageLoader, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bike, ChefHat, Clock, Expand, LogOut, Printer, Shrink, ShoppingBag, StickyNote, UtensilsCrossed, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { useLocale, useTranslations } from 'use-intl';

type Column = 'toStart' | 'cooking' | 'ready';
type Locale = 'en' | 'ar';

const COLUMNS: { key: Column; status: OrderStatus }[] = [
  { key: 'toStart', status: 'ACCEPTED' },
  { key: 'cooking', status: 'PREPARING' },
  { key: 'ready', status: 'READY_FOR_PICKUP' },
];
const SOUND_KEY = 'alliva.kitchen.sound';
const BRANCH_KEY = 'alliva.kitchen.branch';

export default function KitchenPage() {
  const locale = useLocale();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  if (me.isError) return <Navigate replace to={localizeHref('/login', locale)} />;
  if (!me.data) return <PageLoader />;
  if (!canOpen(me.data, 'kitchen')) return <Navigate replace to={localizeHref(landingFor(me.data), locale)} />;
  return <KitchenDisplay workspace={canOpen(me.data, 'dashboard') && landingFor(me.data) !== '/kitchen'} />;
}

/** Full-screen kitchen display: tickets move from "to start" to "cooking" to "ready". */
function KitchenDisplay({ workspace }: { workspace: boolean }) {
  const t = useTranslations('kitchen');
  const nav = useTranslations('nav');
  const locale = (useLocale() === 'ar' ? 'ar' : 'en') as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const client = useQueryClient();
  useOrderUpdates();
  const now = useNow();
  const [branchId, setBranchId] = useState(() => read(BRANCH_KEY) ?? '');
  const [column, setColumn] = useState<Column>('toStart');
  const [sound, setSound] = useState(() => read(SOUND_KEY) !== 'off');
  const [fullscreen, setFullscreen] = useState(false);
  const profile = useQuery({ queryKey: ['merchant', 'business'], queryFn: () => api.profile(), retry: false });
  const branches = ((profile.data as { branches?: { id: string; name: { en?: string; ar?: string }; active?: boolean }[] } | undefined)?.branches ?? []).filter((branch) => branch.active !== false);
  const storeName = (profile.data as { name?: { en?: string; ar?: string } } | undefined)?.name;
  const key = ['merchant', 'kitchen', branchId] as const;
  const board = useQuery({ queryKey: key, queryFn: () => api.kitchen(branchId || undefined), refetchInterval: 15_000 });
  const tickets = board.data?.tickets ?? [];
  useNewTicketChime(board.data ? tickets : null, sound, t);

  const move = useMutation({
    mutationFn: (input: { ticket: KitchenTicket; status: OrderStatus }) => api.transition(input.ticket.id, { status: input.status }),
    onMutate: async ({ ticket, status }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<KitchenBoard>(key);
      const at = new Date().toISOString();
      client.setQueryData<KitchenBoard>(key, (current) => current && {
        ...current,
        tickets: current.tickets.map((row) => (row.id === ticket.id ? { ...row, status, ...(status === 'PREPARING' ? { startedAt: at } : { readyAt: at }) } : row)),
      });
      return { before };
    },
    onError: (error: Error, _input, context) => {
      if (context?.before) client.setQueryData(key, context.before);
      toast.error(error.message);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'kitchen'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
    },
  });

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const grouped = useMemo(() => {
    const byColumn: Record<Column, KitchenTicket[]> = { toStart: [], cooking: [], ready: [] };
    for (const ticket of tickets) {
      const match = COLUMNS.find((entry) => entry.status === ticket.status);
      if (match) byColumn[match.key].push(ticket);
    }
    // Oldest first, except scheduled orders, which wait until they are close.
    byColumn.toStart.sort((a, b) => dueAt(a).localeCompare(dueAt(b)));
    byColumn.cooking.sort((a, b) => (a.estimatedReadyAt ?? a.createdAt).localeCompare(b.estimatedReadyAt ?? b.createdAt));
    byColumn.ready.sort((a, b) => (a.readyAt ?? '').localeCompare(b.readyAt ?? ''));
    return byColumn;
  }, [tickets]);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    write(SOUND_KEY, next ? 'on' : 'off');
    if (next) void unlock().then((ok) => { if (ok) chime(0.6); });
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#161614] text-white lg:h-dvh">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:gap-3 sm:px-4">
        {workspace ? (
          <Link href="/dashboard" className="grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/15" aria-label={t('backToWorkspace')}>
            <ArrowLeft className="size-5 rtl:-scale-x-100" />
          </Link>
        ) : null}
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#FFC400] text-[#111111]"><ChefHat className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold leading-tight">{t('title')}</h1>
          <p className="truncate text-xs text-white/60">{storeName ? pickLocalized(storeName, locale) : ' '}</p>
        </div>
        <p className="hidden font-mono text-2xl font-semibold tabular-nums sm:block" dir="ltr">{clock(now, locale)}</p>
        {branches.length > 1 ? (
          <select
            value={branchId}
            onChange={(event) => { setBranchId(event.target.value); write(BRANCH_KEY, event.target.value); }}
            aria-label={t('branch')}
            className="h-10 max-w-44 rounded-xl border border-white/15 bg-white/10 px-3 text-sm font-semibold text-white outline-none"
          >
            <option value="" className="text-black">{t('allBranches')}</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id} className="text-black">{pickLocalized(branch.name, locale)}</option>)}
          </select>
        ) : null}
        <HeaderButton onClick={toggleSound} label={sound ? t('soundOn') : t('soundOff')} active={sound}>
          {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        </HeaderButton>
        <HeaderButton onClick={toggleFullscreen} label={fullscreen ? t('exitFullscreen') : t('fullscreen')}>
          {fullscreen ? <Shrink className="size-5" /> : <Expand className="size-5" />}
        </HeaderButton>
        <Link href={pathname} locale={locale === 'en' ? 'ar' : 'en'} className="grid h-10 min-w-10 place-items-center rounded-xl bg-white/10 px-2 text-xs font-semibold hover:bg-white/15">
          {locale === 'en' ? 'AR' : 'EN'}
        </Link>
        <HeaderButton onClick={() => api.logout().then(() => { client.clear(); router.replace('/login'); })} label={nav('logout')}>
          <LogOut className="size-5 rtl:-scale-x-100" />
        </HeaderButton>
      </header>

      <div className="flex gap-1 border-b border-white/10 p-2 lg:hidden" role="tablist" aria-label={t('title')}>
        {COLUMNS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={column === entry.key}
            onClick={() => setColumn(entry.key)}
            className={cn('flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold', column === entry.key ? 'bg-[#FFC400] text-[#111111]' : 'bg-white/5 text-white/80')}
          >
            {t(`columns.${entry.key}`)}
            <span className={cn('min-w-6 rounded-full px-1.5 text-xs', column === entry.key ? 'bg-black/10' : 'bg-white/10')}>{grouped[entry.key].length}</span>
          </button>
        ))}
      </div>

      {board.isLoading ? (
        <div className="grid flex-1 place-items-center"><ChefHat className="size-10 animate-pulse text-white/30" /></div>
      ) : board.error && !board.data ? (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div>
            <p className="font-semibold">{t('loadError')}</p>
            <p className="mt-1 text-sm text-white/60">{(board.error as Error).message}</p>
            <button type="button" onClick={() => board.refetch()} className="mt-4 h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#111111]">{t('retry')}</button>
          </div>
        </div>
      ) : (
        <main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-3">
          {COLUMNS.map((entry) => (
            <section key={entry.key} className={cn('min-h-0 flex-col rounded-2xl bg-white/[0.04] lg:flex', column === entry.key ? 'flex' : 'hidden')} aria-label={t(`columns.${entry.key}`)}>
              <h2 className="hidden items-center justify-between px-4 pb-2 pt-3 text-sm font-semibold uppercase tracking-wide text-white/70 lg:flex">
                {t(`columns.${entry.key}`)}
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white">{grouped[entry.key].length}</span>
              </h2>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 lg:pt-1">
                {grouped[entry.key].length === 0 ? <p className="py-16 text-center text-sm text-white/40">{t(`empty.${entry.key}`)}</p> : null}
                {grouped[entry.key].map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    now={now}
                    locale={locale}
                    storeName={storeName ? pickLocalized(storeName, locale) : ''}
                    busy={move.isPending && move.variables?.ticket.id === ticket.id}
                    onMove={(status) => move.mutate({ ticket, status })}
                  />
                ))}
              </div>
            </section>
          ))}
        </main>
      )}
    </div>
  );
}

function TicketCard({ ticket, now, locale, storeName, busy, onMove }: { ticket: KitchenTicket; now: number; locale: Locale; storeName: string; busy: boolean; onMove: (status: OrderStatus) => void }) {
  const t = useTranslations('kitchen');
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const urgency = ticketUrgency(ticket, now);
  const since = (ticket.status === 'READY_FOR_PICKUP' ? ticket.readyAt : ticket.status === 'PREPARING' ? ticket.startedAt : null) ?? ticket.acceptedAt ?? ticket.createdAt;
  const scheduled = ticket.scheduledFor && new Date(ticket.scheduledFor).getTime() - now > 30 * 60_000;
  const Icon = ticket.fulfillmentType === 'DELIVERY' ? Bike : ticket.fulfillmentType === 'DINE_IN' ? UtensilsCrossed : ShoppingBag;
  const count = ticket.items.reduce((total, item) => total + item.quantity, 0);

  return (
    <article className={cn('overflow-hidden rounded-2xl bg-white text-[#161616] shadow-lg', scheduled && 'opacity-70')}>
      <div className={cn('flex items-center gap-3 px-4 py-2.5', urgencyTone[urgency])}>
        <bdi dir="ltr" className="min-w-0 truncate text-xl font-bold tabular-nums">#{ticket.number}</bdi>
        <span className="ms-auto inline-flex shrink-0 items-center gap-1 font-mono text-lg font-semibold tabular-nums" dir="ltr" title={t(`since.${ticket.status === 'READY_FOR_PICKUP' ? 'ready' : ticket.status === 'PREPARING' ? 'cooking' : 'waiting'}`)}>
          <Clock className="size-4" />{since ? elapsed(now - new Date(since).getTime()) : '—'}
        </span>
      </div>
      <div className="px-4 pb-3 pt-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#696965]">
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#161616]">
            <Icon className="size-4 shrink-0" />
            {ticket.fulfillmentType === 'DINE_IN' && ticket.tableNumber ? t('table', { number: ticket.tableNumber }) : t(`type.${ticket.fulfillmentType}`)}
          </span>
          <span>{ticket.customerName}</span>
          <span>{t('itemsCount', { count })}</span>
          {ticket.scheduledFor ? <span className="font-semibold text-[#2F6FED]">{t('scheduledFor', { time: clock(new Date(ticket.scheduledFor).getTime(), locale) })}</span> : null}
          {urgency === 'late' && ticket.status !== 'READY_FOR_PICKUP' ? <span className="font-semibold text-[#D9342B]">{t('late')}</span> : null}
          {ticket.status !== 'READY_FOR_PICKUP' && ticket.estimatedReadyAt ? <span>{t('dueAt', { time: clock(new Date(ticket.estimatedReadyAt).getTime(), locale) })}</span> : null}
        </p>
        {ticket.notes ? (
          <p className="mt-2 flex gap-2 rounded-xl bg-[#FFF4D6] px-3 py-2 text-sm font-medium text-[#7A4E00]"><StickyNote className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{ticket.notes}</span></p>
        ) : null}
        <ul className="mt-2 divide-y divide-[#F0F0EC]">
          {ticket.items.map((item) => {
            const struck = done.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={struck}
                  onClick={() => setDone((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}
                  className={cn('flex w-full gap-3 py-2 text-start', struck && 'text-[#A3A39E] line-through')}
                >
                  <span className="grid h-7 min-w-7 place-items-center rounded-lg bg-[#F1F1EE] px-1.5 text-sm font-bold tabular-nums">{item.quantity}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold leading-snug">{pickLocalized(item.name, locale)}</span>
                    {item.addons.length ? <span className="block text-sm text-[#5C5C58]">+ {item.addons.map((addon) => pickLocalized(addon, locale)).join(', ')}</span> : null}
                    {item.notes ? <span className="mt-0.5 block text-sm font-semibold text-[#B45309]"><bdi>“{item.notes}”</bdi></span> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void printTicket(ticket, storeName, locale, t)} className="grid size-12 shrink-0 place-items-center rounded-xl border border-[#E2E2DC] hover:bg-[#F7F7F5]" aria-label={t('print')} title={t('print')}>
            <Printer className="size-5" />
          </button>
          {ticket.status === 'ACCEPTED' ? (
            <ActionButton busy={busy} onClick={() => onMove('PREPARING')} className="bg-[#2F6FED] text-white">{t('start')}</ActionButton>
          ) : ticket.status === 'PREPARING' ? (
            <ActionButton busy={busy} onClick={() => onMove('READY_FOR_PICKUP')} className="bg-[#16924A] text-white">{t('markReady')}</ActionButton>
          ) : (
            <p className="flex h-12 flex-1 items-center justify-center rounded-xl bg-[#F1F1EE] px-3 text-center text-sm font-semibold text-[#5C5C58]">
              {t(ticket.fulfillmentType === 'DELIVERY' ? 'waitingRider' : ticket.fulfillmentType === 'DINE_IN' ? 'waitingServe' : 'waitingCollection')}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function ActionButton({ busy, onClick, className, children }: { busy: boolean; onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <button type="button" disabled={busy} onClick={onClick} className={cn('h-12 flex-1 rounded-xl text-base font-semibold disabled:opacity-60', className)}>
      {children}
    </button>
  );
}

function HeaderButton({ onClick, label, active, children }: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={active} className="grid size-10 place-items-center rounded-xl bg-white/10 hover:bg-white/15">
      {children}
    </button>
  );
}

type Urgency = 'calm' | 'soon' | 'late' | 'ready';
const urgencyTone: Record<Urgency, string> = {
  calm: 'bg-[#E7F0FF] text-[#1D4ED8]',
  soon: 'bg-[#FFF4D6] text-[#9A6200]',
  late: 'bg-[#D9342B] text-white',
  ready: 'bg-[#E7F8EE] text-[#16924A]',
};

/** Red once the promised ready time has passed, amber in the last five minutes. */
function ticketUrgency(ticket: KitchenTicket, now: number): Urgency {
  if (ticket.status === 'READY_FOR_PICKUP') return now - new Date(ticket.readyAt ?? ticket.createdAt).getTime() > 10 * 60_000 ? 'late' : 'ready';
  const due = ticket.estimatedReadyAt ? new Date(ticket.estimatedReadyAt).getTime() : new Date(ticket.acceptedAt ?? ticket.createdAt).getTime() + (ticket.preparationMinutes ?? 20) * 60_000;
  if (now > due) return 'late';
  if (due - now <= 5 * 60_000) return 'soon';
  return 'calm';
}

function dueAt(ticket: KitchenTicket) {
  return ticket.scheduledFor ?? ticket.acceptedAt ?? ticket.createdAt;
}

/** Rings once for each ticket that reaches "to start" while the screen is open. */
function useNewTicketChime(tickets: KitchenTicket[] | null, sound: boolean, t: ReturnType<typeof useTranslations<'kitchen'>>) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Wait for the first load, so tickets already on the board when the screen opens do not ring.
    if (!tickets) return;
    const waiting = tickets.filter((ticket) => ticket.status === 'ACCEPTED');
    if (!seen.current) {
      seen.current = new Set(tickets.map((ticket) => ticket.id));
      return;
    }
    const fresh = waiting.filter((ticket) => !seen.current!.has(ticket.id));
    tickets.forEach((ticket) => seen.current!.add(ticket.id));
    if (!fresh.length) return;
    toast(t('newTicket', { count: fresh.length }));
    if (sound) chime(0.8);
  }, [tickets, sound, t]);
  useEffect(() => {
    const onGesture = () => void unlock();
    window.addEventListener('pointerdown', onGesture, { once: true });
    return () => window.removeEventListener('pointerdown', onGesture);
  }, []);
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function elapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function clock(at: number, locale: Locale) {
  return new Date(at).toLocaleTimeString(locale === 'ar' ? 'ar-BH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bahrain' });
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the choice still holds for this visit.
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Prints an 80 mm kitchen ticket. Delivery tickets carry the pickup QR and code the rider scans. */
async function printTicket(ticket: KitchenTicket, storeName: string, locale: Locale, t: ReturnType<typeof useTranslations<'kitchen'>>) {
  const win = window.open('', '_blank', 'width=380,height=640');
  if (!win) {
    toast.error(t('printBlocked'));
    return;
  }
  win.document.write(`<!doctype html><title>#${escapeHtml(ticket.number)}</title><p style="font-family:system-ui">${escapeHtml(t('printing'))}</p>`);
  let pickup = '';
  if (ticket.fulfillmentType === 'DELIVERY') {
    try {
      const handoff = await api.orderHandoff(ticket.id);
      const { toDataURL } = await import('qrcode');
      const image = await toDataURL(handoff.qr, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
      pickup = `<div class="qr"><img src="${image}" alt=""/><div class="code">${escapeHtml(handoff.code)}</div><p>${escapeHtml(t('printPickupHint'))}</p></div>`;
    } catch {
      pickup = '';
    }
  }
  const place = ticket.fulfillmentType === 'DINE_IN' && ticket.tableNumber ? t('table', { number: ticket.tableNumber }) : t(`type.${ticket.fulfillmentType}`);
  const items = ticket.items.map((item) => `<li><b>${item.quantity} ×</b> ${escapeHtml(pickLocalized(item.name, locale))}${item.addons.length ? `<div class="sub">+ ${escapeHtml(item.addons.map((addon) => pickLocalized(addon, locale)).join(', '))}</div>` : ''}${item.notes ? `<div class="note">“${escapeHtml(item.notes)}”</div>` : ''}</li>`).join('');
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  win.document.open();
  win.document.write(`<!doctype html><html dir="${dir}" lang="${locale}"><head><meta charset="utf-8"><title>#${escapeHtml(ticket.number)}</title><style>
    @page{size:80mm auto;margin:4mm}body{font-family:system-ui,sans-serif;margin:0;width:72mm;color:#000}
    h1{font-size:26px;margin:0}.meta{font-size:13px;margin:2px 0}.store{font-size:12px;color:#444}
    ul{list-style:none;padding:0;margin:10px 0;border-top:1px dashed #000;border-bottom:1px dashed #000}
    li{font-size:16px;padding:6px 0}.sub{font-size:13px}.note{font-size:13px;font-weight:700}
    .order-note{font-size:14px;font-weight:700;border:1px solid #000;padding:6px;margin:8px 0}
    .qr{text-align:center;margin-top:8px}.qr img{width:44mm;height:44mm}.code{font:700 24px/1 ui-monospace,monospace;letter-spacing:5px;direction:ltr}.qr p{font-size:12px;margin:4px 0}
  </style></head><body>
    <div class="store">${escapeHtml(storeName)}</div>
    <h1 dir="ltr">#${escapeHtml(ticket.number)}</h1>
    <div class="meta"><b>${escapeHtml(place)}</b> · ${escapeHtml(ticket.customerName)}</div>
    <div class="meta">${escapeHtml(new Date(ticket.createdAt).toLocaleString(locale === 'ar' ? 'ar-BH' : 'en-GB', { timeZone: 'Asia/Bahrain', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }))}${ticket.scheduledFor ? ` · ${escapeHtml(t('scheduledFor', { time: clock(new Date(ticket.scheduledFor).getTime(), locale) }))}` : ''}</div>
    ${ticket.notes ? `<div class="order-note">${escapeHtml(ticket.notes)}</div>` : ''}
    <ul>${items}</ul>
    ${pickup}
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
  </body></html>`);
  win.document.close();
}
