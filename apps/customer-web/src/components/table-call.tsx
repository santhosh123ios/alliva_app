import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, CircleCheck, HandHelping, Loader2, Receipt, UserRound } from 'lucide-react';
import { useState } from 'react';
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
function tableNo(number: string) {
  return number.replace(/^\s*(?:table|tbl|طاولة)(?:\s*[-#:.]\s*|\s+|(?=\d))/i, '') || number;
}

function scannedTable() {
  if (typeof document === 'undefined') return null;
  return document.cookie.split('; ').find((part) => part.startsWith('alliva_table='))?.slice('alliva_table='.length) || null;
}

/** For diners who scanned a table QR: call a waiter, ask for the bill or for help, and see when staff are on the way. */
export function TableCall() {
  const t = useTranslations('customer.tableCall');
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const tableId = scannedTable();
  const service = useQuery({
    queryKey: ['table-service', tableId],
    queryFn: () => api.tableService(),
    enabled: Boolean(tableId),
    retry: false,
    // Poll quickly only while a call is waiting, so diners see "on the way" without a socket; a running bill every 30s.
    refetchInterval: (query) => {
      const data = query.state.data as TableServiceView | undefined;
      return data?.requests.length ? 10_000 : data?.bill && !data.bill.settled ? 30_000 : 60_000;
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
  const data = service.data;
  if (!data) return null;
  const pending = data.requests.length > 0;
  const onTheWay = data.requests.some((request) => request.status === 'ACKNOWLEDGED');
  const bill = data.bill;
  const billAsked = data.requests.some((request) => request.kind === 'BILL');

  return (
    <>
      <div className="pointer-events-none mx-auto mb-2 flex max-w-[520px] justify-end gap-2">
        {bill ? (
          <button
            type="button"
            onClick={() => { setBillOpen(true); void service.refetch(); }}
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
          onClick={() => setOpen(true)}
          className={cn(
            'pointer-events-auto flex h-11 shrink-0 items-center gap-2 rounded-full ps-3 pe-4 text-sm font-semibold shadow-[0_10px_28px_rgba(0,0,0,0.18)]',
            onTheWay ? 'bg-[#168A52] text-white' : pending ? 'bg-[#111111] text-white' : 'bg-white text-[#111111]',
          )}
        >
          <BellRing className={cn('size-4', pending && !onTheWay && 'animate-pulse')} />
          <span>{onTheWay ? t('onTheWayShort') : pending ? t('waitingShort') : bill ? t('buttonShort') : t('button', { table: tableNo(data.table.number) })}</span>
        </button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{t('title', { table: tableNo(data.table.number) })}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
          <div className="mt-2 grid gap-2">
            {KINDS.map(({ kind, icon: Icon }) => {
              const request = data.requests.find((row) => row.kind === kind);
              const busy = call.isPending && call.variables === kind;
              return (
                <button
                  key={kind}
                  type="button"
                  disabled={Boolean(request) || call.isPending}
                  onClick={() => call.mutate(kind)}
                  className={cn(
                    'flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-start disabled:cursor-default',
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
