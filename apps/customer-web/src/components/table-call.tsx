import { api } from '@/components/providers';
import { usePlace } from '@/lib/place';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Bell, BellRing, Check, CircleCheck, CircleHelp, HandHelping, Loader2, QrCode, Receipt, ReceiptText, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLocale, useTranslations } from 'use-intl';

type TableServiceView = Awaited<ReturnType<typeof api.tableService>>;
type ServiceRequestKind = TableServiceView['requests'][number]['kind'];
type DinerBill = NonNullable<TableServiceView['bill']>;

const KINDS: { kind: ServiceRequestKind; icon: typeof BellRing }[] = [
  { kind: 'WAITER', icon: UserRound },
  { kind: 'BILL', icon: Receipt },
  { kind: 'HELP', icon: HandHelping },
];

/** Some stores typed "Table 2" as the number; the label already says "Table". */
export function tableNo(number: string) {
  return number.replace(/^\s*(?:table|tbl|طاولة)(?:\s*[-#:.]\s*|\s+|(?=\d))/i, '') || number;
}

export function scannedTable() {
  if (typeof document === 'undefined') return null;
  return document.cookie.split('; ').find((part) => part.startsWith('alliva_table='))?.slice('alliva_table='.length) || null;
}

/** Where "back to the store" leads: the table page while the diner is ordering at a scanned table. */
export function storeHref(slug: string) {
  return scannedTable() && usePlace.getState().fulfillment === 'DINE_IN' ? `/table/${slug}` : `/merchants/${slug}`;
}

/**
 * Table links carry the table's QR code (`?qr=`), so a diner who reopens the link after the scan cookie
 * expired, or on another browser, is put back at their table. Returns the query to keep on table links.
 */
export function useTableLink() {
  const [params] = useSearchParams();
  const qr = params.get('qr');
  const client = useQueryClient();
  const [, setRestored] = useState(0);
  useEffect(() => {
    if (!qr || scannedTable()) return;
    void api
      .enterQr(qr)
      .then(() => {
        client.removeQueries({ queryKey: ['table-service'] });
        void client.invalidateQueries({ queryKey: ['cart'] });
        // The cookie is set now; render again so the table query starts.
        setRestored((count) => count + 1);
      })
      .catch(() => undefined);
  }, [client, qr]);
  return qr ? `?qr=${encodeURIComponent(qr)}` : '';
}

/** The scanned table's staff calls and running bill, with the dialogs that show them. Shared by the floating button and the table page. */
export function useTableService() {
  const t = useTranslations('customer.tableCall');
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const locale: 'en' | 'ar' = useLocale() === 'ar' ? 'ar' : 'en';
  const tableId = scannedTable();
  const service = useQuery({
    queryKey: ['table-service', tableId],
    queryFn: () => api.tableService(),
    enabled: Boolean(tableId),
    retry: false,
    // Poll quickly only while a call is waiting, so diners see "on the way" without a socket; a running bill every 30s.
    refetchInterval: (query) => {
      const data = query.state.data as TableServiceView | undefined;
      // A table being set up checks often too, so ordering opens soon after staff mark it ready.
      return data?.requests.length || data?.cleaning ? 10_000 : data?.bill && !data.bill.settled ? 30_000 : 60_000;
    },
  });
  const call = useMutation({
    mutationFn: (kind: ServiceRequestKind) => api.callStaff(kind),
    onSuccess: (next, kind) => {
      client.setQueryData(['table-service', tableId], next);
      toast.success(t(`sent.${kind}`));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const end = useMutation({
    mutationFn: (id: string) => api.endStaffCall(id),
    onSuccess: (next) => {
      client.setQueryData(['table-service', tableId], next);
      toast.success(t('ended'));
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const data = service.data;
  const bill = data?.bill ?? null;
  const billAsked = Boolean(data?.requests.some((request) => request.kind === 'BILL'));

  const dialogs = data ? (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{t('title', { table: tableNo(data.table.number) })}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
          <div className="mt-2 grid gap-2">
            {KINDS.map(({ kind, icon: Icon }) => {
              const request = data.requests.find((row) => row.kind === kind);
              const busy = call.isPending && call.variables === kind;
              return (
                <div key={kind} className="flex items-stretch gap-2">
                <button
                  type="button"
                  disabled={Boolean(request) || call.isPending}
                  onClick={() => call.mutate(kind)}
                  className={cn(
                    'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border px-4 text-start disabled:cursor-default',
                    request?.status === 'ACKNOWLEDGED' ? 'border-[#BFE5CF] bg-[#E3F5EA]' : request ? 'border-[#F0E2A8] bg-[#FFF8DC]' : 'border-[#E6E6E2] bg-white hover:bg-[#FAFAF8]',
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#FFC400] text-[#111111]">
                    {busy ? <Loader2 className="size-5 animate-spin" /> : request?.status === 'ACKNOWLEDGED' ? <Check className="size-5" /> : <Icon className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-[#161616]">{t(`kinds.${kind}`)}</span>
                    {request ? (
                      <span className="block text-xs text-[#5C5C58]">
                        {request.status === 'ACKNOWLEDGED'
                          ? request.acknowledgedBy ? t('comingNamed', { name: request.acknowledgedBy }) : t('coming')
                          : t('waiting')}
                      </span>
                    ) : null}
                  </span>
                </button>
                {request ? (
                  <button
                    type="button"
                    disabled={end.isPending}
                    onClick={() => end.mutate(request.id)}
                    className="shrink-0 rounded-2xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold text-[#B42318] disabled:opacity-50"
                  >
                    {end.isPending && end.variables === request.id ? <Loader2 className="mx-auto size-4 animate-spin" /> : t('endCall')}
                  </button>
                ) : null}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
      {bill ? (
        <Dialog open={billOpen} onOpenChange={setBillOpen}>
          <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
            <DialogTitle>{t('bill.title', { table: tableNo(data.table.number) })}</DialogTitle>
            <DialogDescription>{bill.settled ? t('bill.paidSubtitle', { number: `\u2066${bill.settled.number}\u2069` }) : t('bill.subtitle')}</DialogDescription>
            <BillSummary bill={bill} locale={locale} />
            {bill.settled ? (
              <p className="mt-3 flex items-center gap-2 rounded-2xl bg-[#E3F5EA] px-4 py-3 text-sm font-semibold text-[#11663D]">
                <CircleCheck className="size-5 shrink-0" />{t('bill.paidBy', { method: t(`bill.methods.${bill.settled.method}`) })}
              </p>
            ) : Number(bill.due) > 0 ? (
              <button
                type="button"
                disabled={billAsked || call.isPending}
                onClick={() => call.mutate('BILL')}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white disabled:bg-[#E3F5EA] disabled:text-[#11663D]"
              >
                {call.isPending && call.variables === 'BILL' ? <Loader2 className="size-4 animate-spin" /> : billAsked ? <Check className="size-4" /> : <Receipt className="size-4" />}
                {billAsked ? t('bill.asked') : t('bill.ask', { amount: formatMoney(bill.due, locale) })}
              </button>
            ) : (
              <p className="mt-3 rounded-2xl bg-[#E3F5EA] px-4 py-3 text-sm font-semibold text-[#11663D]">{t('bill.allPaid')}</p>
            )}
            {!bill.settled ? <p className="mt-2 text-center text-xs text-[#696965]">{t('bill.payHint')}</p> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  ) : null;

  return {
    tableId,
    /** Why the table could not be loaded, e.g. the diner never scanned or the scan expired. */
    missing: !tableId || Boolean(service.error),
    data,
    bill,
    billAsked,
    locale,
    call,
    dialogs,
    openCalls: () => setOpen(true),
    openBill: () => {
      setBillOpen(true);
      void service.refetch();
    },
  };
}

/** For diners who scanned a table QR: call a waiter, ask for the bill or for help, and see when staff are on the way. */
export function TableCall() {
  const t = useTranslations('customer.tableCall');
  const { data, bill, locale, dialogs, openCalls, openBill } = useTableService();
  if (!data) return null;
  const pending = data.requests.length > 0;
  const onTheWay = data.requests.some((request) => request.status === 'ACKNOWLEDGED');

  return (
    <>
      <div className="pointer-events-none mx-auto mb-2 flex max-w-[520px] justify-end gap-2">
        {bill ? (
          <button
            type="button"
            onClick={openBill}
            className={cn(
              'pointer-events-auto flex h-11 min-w-0 items-center gap-2 rounded-full ps-3 pe-4 text-sm font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.18)]',
              bill.settled ? 'bg-[#168A52] text-white' : 'bg-white text-[#111111]',
            )}
          >
            {bill.settled ? <CircleCheck className="size-4 shrink-0" /> : <Receipt className="size-4 shrink-0" />}
            <span className="truncate">{bill.settled ? t('bill.paidShort') : t('bill.button', { amount: formatMoney(bill.due, locale) })}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={openCalls}
          className={cn(
            'pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-full ps-3 pe-4 text-sm font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.18)]',
            onTheWay ? 'bg-[#168A52] text-white' : pending ? 'bg-[#111111] text-white' : 'bg-white text-[#111111]',
          )}
        >
          <BellRing className={cn('size-4', pending && !onTheWay && 'animate-pulse')} />
          <span>{onTheWay ? t('onTheWayShort') : pending ? t('waitingShort') : bill ? t('buttonShort') : t('button', { table: tableNo(data.table.number) })}</span>
        </button>
      </div>
      {dialogs}
    </>
  );
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-[#F0F0EC] text-[#4A4A46]',
  ACCEPTED: 'bg-[#FFF4D6] text-[#8A5A00]',
  PREPARING: 'bg-[#FFF4D6] text-[#8A5A00]',
  READY_FOR_PICKUP: 'bg-[#EEF4FF] text-[#2F6FED]',
  DELIVERED: 'bg-[#E3F5EA] text-[#168A52]',
};

/** Every round the table ordered, then what it comes to and what is left to pay. */
function BillSummary({ bill, locale }: { bill: DinerBill; locale: 'en' | 'ar' }) {
  const t = useTranslations('customer.tableCall.bill');
  const money = (value: string | number) => formatMoney(value, locale);
  const row = (label: string, value: string, className?: string) => (
    <div className={cn('flex items-center justify-between py-0.5 text-sm', className)}><span>{label}</span><span className="tabular-nums">{value}</span></div>
  );
  return (
    <div className="mt-3 space-y-3">
      <ul className="divide-y divide-[#F0F0EC] rounded-2xl border border-[#ECECE8]">
        {bill.orders.map((order) => (
          <li key={order.number} className="px-4 py-3">
            <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#696965]">
              <bdi>{order.number}</bdi>
              <span className={cn('rounded-full px-2 py-0.5', STATUS_TONE[order.status] ?? 'bg-[#F0F0EC] text-[#4A4A46]')}>{t(`status.${order.status in STATUS_TONE ? order.status : 'PENDING'}`)}</span>
              {order.paid && !bill.settled ? <span className="rounded-full bg-[#E3F5EA] px-2 py-0.5 text-[#168A52]">{t('paidInApp')}</span> : null}
            </p>
            <ul className="space-y-1 text-sm">
              {order.items.map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span className="w-7 shrink-0 font-semibold tabular-nums">{item.quantity}×</span>
                  <span className="min-w-0 flex-1">{pickLocalized(item.name, locale)}</span>
                  <span className="shrink-0 tabular-nums text-[#4A4A46]">{money(item.total)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-[#F7F7F5] px-4 py-3">
        {row(t('subtotal'), money(bill.subtotal), 'text-[#4A4A46]')}
        {Number(bill.discount) > 0 ? row(t('discount'), `-${money(bill.discount)}`, 'text-[#168A52]') : null}
        {Number(bill.serviceFee) > 0 ? row(t('serviceFee'), money(bill.serviceFee), 'text-[#4A4A46]') : null}
        {Number(bill.tax) > 0 ? row(t('tax'), money(bill.tax), 'text-[#4A4A46]') : null}
        {row(t('total'), money(bill.total), 'mt-1 border-t border-[#E6E6E2] pt-2 font-semibold')}
        {Number(bill.paid) > 0 ? row(bill.settled ? t('paid') : t('paidInApp'), `-${money(bill.paid)}`, 'text-[#168A52]') : null}
        {row(t('due'), money(bill.due), 'text-lg font-bold')}
      </div>
    </div>
  );
}

/** Shown once the table paid: this visit is closed, and scanning the table again starts the next one. */
export function VisitEnded({ title, body }: { title: string; body: string }) {
  return (
    <section className="flex gap-3 rounded-[20px] bg-[#e3f5ea] p-4 text-[#11663d]">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white"><QrCode className="size-6" /></span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-extrabold">{title}</h2>
        <p className="mt-0.5 text-[13px] leading-relaxed">{body}</p>
      </div>
    </section>
  );
}

/** The page cannot tell which table the diner is at, so ordering and staff calls wait for a scan. */
export function ScanNotice({ body }: { body: string }) {
  return (
    <p className="flex items-center gap-3 rounded-2xl bg-[#fff3c9] px-3.5 py-3 text-[13px] leading-snug font-medium text-[#5c4300]">
      <QrCode className="size-5 shrink-0" />
      {body}
    </p>
  );
}

/** How far the bell sits above whatever bar is pinned to the bottom of the page. */
const LIFT = {
  none: 'bottom-[max(1.25rem,env(safe-area-inset-bottom))]',
  /** The table menu's cart pill. */
  cartBar: 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4rem)]',
  /** The Your order page's pay-later note and Place order button. */
  orderBar: 'bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+6.5rem)]',
} as const;

/**
 * A floating bell that opens the table's three staff actions: call staff, the bill and help.
 * A pending call opens its status, where it can be ended; the bell rings while staff are called.
 */
export function TableCallButton({ table, lift = 'none' }: { table: ReturnType<typeof useTableService>; lift?: keyof typeof LIFT }) {
  const t = useTranslations('customer.tablePage');
  const [open, setOpen] = useState(false);
  const data = table.data!;
  const request = (kind: 'WAITER' | 'BILL' | 'HELP') => data.requests.find((row) => row.kind === kind);
  const pending = data.requests.length > 0;
  const press = (kind: 'WAITER' | 'BILL' | 'HELP') => {
    setOpen(false);
    if (kind === 'BILL' && table.bill) return table.openBill();
    if (request(kind)) return table.openCalls();
    table.call.mutate(kind);
  };
  const actions = [
    { kind: 'WAITER', icon: Bell, label: t('callStaff') },
    { kind: 'BILL', icon: ReceiptText, label: table.bill ? t('viewBill') : t('requestBill') },
    { kind: 'HELP', icon: CircleHelp, label: t('help') },
  ] as const;

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <>
      {open ? <button type="button" aria-label={t('closeCalls')} tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default bg-black/20" /> : null}
      <div className={cn('fixed end-4 z-50 flex flex-col items-end gap-3 transition-[bottom] lg:end-[max(1rem,calc((100vw-880px)/2))]', LIFT[lift])}>
        {open ? (
          <div id="table-calls" role="menu" className="w-[260px] origin-bottom-right overflow-hidden rounded-[20px] bg-white p-2 shadow-[0_18px_40px_rgba(17,17,17,0.22)] rtl:origin-bottom-left">
            <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fff3c9]">
                <DiningTableIcon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[14px] leading-tight font-bold text-[#111]">
                  {t('diningAt', { table: tableNo(data.table.number) })}
                  <BadgeCheck aria-label={t('verified')} className="size-4 shrink-0 fill-primary text-white" strokeWidth={2.2} />
                </span>
                <span className="block text-[11.5px] leading-snug text-[#6f6f6a]">{t('diningNote')}</span>
              </span>
            </div>
            {actions.map(({ kind, icon: ActionIcon, label }) => {
              const row = request(kind);
              const busy = table.call.isPending && table.call.variables === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  disabled={table.call.isPending}
                  onClick={() => press(kind)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-start hover:bg-[#fafaf6] disabled:opacity-60',
                    row?.status === 'ACKNOWLEDGED' ? 'bg-[#e3f5ea]' : row ? 'bg-[#fff8dc]' : '',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-[#111]">
                    {busy ? <Loader2 className="size-[18px] animate-spin" /> : row?.status === 'ACKNOWLEDGED' ? <Check className="size-[18px]" strokeWidth={2.4} /> : <ActionIcon className="size-[18px]" strokeWidth={2} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-[#111]">{label}</span>
                    {row ? <span className="block text-[11.5px] text-[#5c5c58]">{row.status === 'ACKNOWLEDGED' ? t('onTheWay') : t('staffCalled')}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          aria-controls="table-calls"
          aria-label={open ? t('closeCalls') : t('openCalls')}
          onClick={() => setOpen((value) => !value)}
          className="relative grid size-14 place-items-center rounded-full bg-[#141416] text-primary ring-4 ring-white shadow-[0_10px_28px_rgba(0,0,0,0.25)] active:scale-95"
        >
          {open ? <X className="size-6" strokeWidth={2.4} /> : pending ? <BellRing className="size-6 animate-pulse" strokeWidth={2.2} /> : <Bell className="size-6" strokeWidth={2.2} />}
          {pending && !open ? <span className="absolute top-0 end-0 size-3.5 rounded-full border-2 border-[#141416] bg-[#22a85a]" /> : null}
        </button>
      </div>
    </>
  );
}

/** A dining table with two chairs, as in the design; lucide has no such icon. */
function DiningTableIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M7 9h10" />
      <path d="M12 9v10" />
      <path d="M9 19h6" />
      <path d="M3 5v14" />
      <path d="M3 13h3v6" />
      <path d="M21 5v14" />
      <path d="M21 13h-3v6" />
    </svg>
  );
}
