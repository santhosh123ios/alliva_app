import { api } from '@/components/providers';
import { hasPermission } from '@/lib/roles';
import type { BillingBoard, OpenBill, PaidBill } from '@alliva/types';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Check, CircleCheck, CreditCard, Loader2, Printer, QrCode, Receipt, Search, ShoppingBag, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslations } from 'use-intl';
import { itemLine } from '@/floor/shared';
import { printBill } from './print';
import { cashSuggestions, itemCount, MethodPill, money, tableNo, tillKey, useAge, useBillTitle, useNow, useStoreHeader, useTillBoard, useTillLocale, useTillSettings } from './shared';

type Tab = 'open' | 'paid';

export default function TillBills() {
  const t = useTranslations('till.bills');
  const board = useTillBoard();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') === 'paid' ? 'paid' : 'open'));
  const [search, setSearch] = useState('');
  const openKey = params.get('open');
  const paidId = params.get('receipt');
  const title = useBillTitle();

  const setOpen = (key: string | null, receipt?: string) => {
    const next = new URLSearchParams(params);
    next.delete('open');
    next.delete('receipt');
    if (key) next.set('open', key);
    if (receipt) next.set('receipt', receipt);
    setParams(next, { replace: true });
  };

  if (board.isLoading) return <div className="space-y-3"><Skeleton className="h-11 rounded-2xl" /><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-28 rounded-3xl" /></div>;
  if (board.error && !board.data) return <ErrorState title={t('loadFailed')} body={(board.error as Error).message} />;
  const data = board.data!;
  const query = search.trim().toLowerCase();
  const matches = (bill: OpenBill | PaidBill) =>
    !query || title(bill).toLowerCase().includes(query) || bill.orders.some((order) => order.number.toLowerCase().includes(query)) || ('number' in bill && bill.number.toLowerCase().includes(query));
  const open = data.open.filter(matches);
  const paid = data.paid.filter(matches);
  const selected = openKey ? data.open.find((bill) => bill.key === openKey) ?? null : null;
  const receipt = paidId ? data.paid.find((bill) => bill.id === paidId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <div className="ms-auto grid grid-cols-2 gap-1 rounded-xl bg-white p-1">
          {(['open', 'paid'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={cn('h-9 whitespace-nowrap rounded-lg px-3 text-sm font-semibold', tab === value ? 'bg-[#111111] text-white' : 'text-[#5C5C58]')}>
              {t(`tabs.${value}`, { count: value === 'open' ? data.open.length : data.paid.length })}
            </button>
          ))}
        </div>
      </div>

      <label className="flex h-11 items-center gap-2 rounded-2xl bg-white px-4">
        <Search className="size-4 text-[#8A8A86]" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('search')} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
        {search ? <button type="button" onClick={() => setSearch('')} aria-label={t('clearSearch')}><X className="size-4 text-[#8A8A86]" /></button> : null}
      </label>

      {tab === 'open' ? (
        open.length ? (
          <div className="grid gap-2 md:grid-cols-2">{open.map((bill) => <OpenBillCard key={bill.key} bill={bill} onOpen={() => setOpen(bill.key)} />)}</div>
        ) : <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-[#8A8A86]">{query ? t('noMatch') : t('noneOpen')}</p>
      ) : paid.length ? (
        <ul className="divide-y divide-[#F0F0EC] overflow-hidden rounded-2xl bg-white">{paid.map((bill) => <PaidRow key={bill.id} bill={bill} onOpen={() => setOpen(null, bill.id)} />)}</ul>
      ) : <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-[#8A8A86]">{query ? t('noMatch') : t('nonePaid')}</p>}

      {selected ? <BillSheet bill={selected} onClose={() => setOpen(null)} onPaid={(done) => { setTab('paid'); setOpen(null, done.id); }} /> : null}
      {receipt ? <ReceiptSheet bill={receipt} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export function OpenBillCard({ bill, onOpen, inset }: { bill: OpenBill; onOpen: () => void; inset?: boolean }) {
  const t = useTranslations('till');
  const locale = useTillLocale();
  const now = useNow();
  const age = useAge();
  const title = useBillTitle();
  const settled = Number(bill.due) === 0;
  return (
    <button type="button" onClick={onOpen} className={cn('flex w-full min-w-0 items-center gap-3 rounded-2xl bg-white px-4 py-3 text-start', inset && 'border border-[#ECECE8]', bill.requested && 'border-transparent ring-2 ring-[#B42318]')}>
      <span className={cn('relative grid size-12 shrink-0 place-items-center rounded-2xl text-base font-bold', bill.requested ? 'bg-[#FDECEA] text-[#B42318]' : 'bg-[#F2F2EF]')}>
        {bill.table ? tableNo(bill.table.number) : <ShoppingBag className="size-5" />}
        {bill.requested ? <span className="absolute -bottom-1 -end-1 grid size-5 animate-pulse place-items-center rounded-full bg-[#B42318] text-white"><Receipt className="size-3" /></span> : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{title(bill)}</p>
        <p className="truncate text-xs text-[#696965]">{t('bills.meta', { orders: bill.orders.length, items: itemCount(bill.orders), age: age(bill.openedAt, now) })}</p>
        <p className={cn('mt-0.5 truncate text-xs font-semibold', bill.requested ? 'text-[#B42318]' : bill.served ? 'text-[#168A52]' : 'text-[#8A5A00]')}>
          {bill.requested ? t('bills.requested') : bill.served ? t('bills.served') : t('bills.eating')}
        </p>
      </div>
      <div className="shrink-0 text-end">
        <p className="text-lg font-semibold tabular-nums">{money(settled ? bill.total : bill.due, locale)}</p>
        {settled ? <p className="text-xs font-semibold text-[#168A52]">{t('bills.paidOnline')}</p> : Number(bill.prepaid) > 0 ? <p className="text-xs text-[#696965]">{t('bills.partPaid')}</p> : null}
      </div>
    </button>
  );
}

function PaidRow({ bill, onOpen }: { bill: PaidBill; onOpen: () => void }) {
  const t = useTranslations('till');
  const locale = useTillLocale();
  const title = useBillTitle();
  const time = new Date(bill.settledAt).toLocaleTimeString(locale === 'ar' ? 'ar-BH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bahrain' });
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#E3F5EA] text-sm font-bold text-[#168A52]">{bill.table ? tableNo(bill.table.number) : <ShoppingBag className="size-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title(bill)}</p>
          <p className="truncate text-xs text-[#696965]"><bdi>{bill.number}</bdi> · {time}{bill.settledBy ? ` · ${t('bills.by', { name: bill.settledBy })}` : ''}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-semibold tabular-nums">{money(bill.total, locale)}</span>
          <MethodPill method={bill.method} className="px-2 py-0.5" />
        </div>
      </button>
    </li>
  );
}

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#F7F7F5] pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-3xl">
        {children}
      </div>
    </div>
  );
}

function SheetHeader({ badge, title, subtitle, onClose, tone = 'plain' }: { badge: React.ReactNode; title: string; subtitle: string; onClose: () => void; tone?: 'plain' | 'good' }) {
  const t = useTranslations('till');
  return (
    <header className="sticky top-0 z-10 flex items-start gap-3 bg-white px-5 pb-3 pt-4">
      <span className={cn('grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-bold', tone === 'good' ? 'bg-[#E3F5EA] text-[#168A52]' : 'bg-[#F2F2EF]')}>{badge}</span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{title}</h2>
        <p className="truncate text-xs text-[#696965]">{subtitle}</p>
      </div>
      <button type="button" onClick={onClose} aria-label={t('close')} className="grid size-9 shrink-0 place-items-center rounded-full bg-[#F2F2EF]"><X className="size-4" /></button>
    </header>
  );
}

/** Each order on the bill with its dishes, so the guest can check what they had. */
function OrderLines({ bill }: { bill: OpenBill | PaidBill }) {
  const t = useTranslations('till');
  const locale = useTillLocale();
  return (
    <section className="divide-y divide-[#F0F0EC] rounded-2xl bg-white">
      {bill.orders.map((order) => (
        <div key={order.id} className="px-4 py-3">
          <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-[#696965]">
            <bdi>{order.number}</bdi>
            {order.paid ? <span className="rounded-full bg-[#E3F5EA] px-2 py-0.5 text-[#168A52]">{t('bills.paidOnline')}</span> : null}
            {order.status !== 'DELIVERED' && !('settledAt' in bill) ? <span className="rounded-full bg-[#FFF4D6] px-2 py-0.5 text-[#8A5A00]">{t('bills.notServed')}</span> : null}
          </p>
          <ul className="space-y-1 text-sm">
            {order.items.map((item, index) => (
              <li key={index} className="flex gap-2">
                <span className="w-7 shrink-0 font-semibold tabular-nums">{item.quantity}×</span>
                <span className="min-w-0 flex-1">{itemLine(item, locale)}</span>
                <span className="shrink-0 tabular-nums text-[#4A4A46]">{money(item.total, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Totals({ bill }: { bill: OpenBill | PaidBill }) {
  const t = useTranslations('till');
  const locale = useTillLocale();
  const row = (label: string, value: string, className?: string) => (
    <div className={cn('flex items-center justify-between py-1 text-sm', className)}><span>{label}</span><span className="tabular-nums">{value}</span></div>
  );
  return (
    <section className="rounded-2xl bg-white px-4 py-3">
      {row(t('subtotal'), money(bill.subtotal, locale), 'text-[#4A4A46]')}
      {Number(bill.discount) > 0 ? row(t('discount'), `-${money(bill.discount, locale)}`, 'text-[#168A52]') : null}
      {Number(bill.serviceFee) > 0 ? row(t('serviceFee'), money(bill.serviceFee, locale), 'text-[#4A4A46]') : null}
      {Number(bill.tax) > 0 ? row(t('tax'), money(bill.tax, locale), 'text-[#4A4A46]') : null}
      {row(t('total'), money(bill.total, locale), 'mt-1 border-t border-[#F0F0EC] pt-2 text-base font-semibold')}
      {Number(bill.prepaid) > 0 ? row(t('bills.paidOnline'), `-${money(bill.prepaid, locale)}`, 'text-[#168A52]') : null}
      {'due' in bill ? row(t('due'), money(bill.due, locale), 'text-lg font-bold') : null}
    </section>
  );
}

const METHODS = [
  { key: 'CASH', icon: Banknote },
  { key: 'CARD', icon: CreditCard },
  { key: 'BENEFIT_PAY', icon: QrCode },
] as const;
type PayMethod = (typeof METHODS)[number]['key'];

export function BillSheet({ bill, onClose, onPaid }: { bill: OpenBill; onClose: () => void; onPaid: (bill: PaidBill) => void }) {
  const t = useTranslations('till');
  const locale = useTillLocale();
  const client = useQueryClient();
  const { branchId } = useTillSettings();
  const store = useStoreHeader();
  const title = useBillTitle();
  const now = useNow();
  const age = useAge();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const canSettle = Boolean(me.data && hasPermission(me.data, 'bill.settle'));
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<PayMethod>('CASH');
  const [tendered, setTendered] = useState('');
  const due = Number(bill.due);
  const received = Number(tendered || 0);
  const change = received - due;
  const quick = useMemo(() => cashSuggestions(due), [due]);
  const nothingDue = due === 0;

  const settle = useMutation({
    mutationFn: () => api.settleBill({
      orderIds: bill.orders.map((order) => order.id),
      method,
      ...(method === 'CASH' && !nothingDue ? { tendered: received.toFixed(3) } : {}),
      ...(branchId ? { branchId } : {}),
    }),
    onSuccess: (paid) => {
      client.setQueryData<BillingBoard>(tillKey(branchId), (board) => board && { ...board, open: board.open.filter((row) => row.key !== bill.key), paid: [paid, ...board.paid] });
      void client.invalidateQueries({ queryKey: ['merchant', 'billing'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'floor'] });
      toast.success(nothingDue ? t('pay.closedToast') : t('pay.paidToast', { amount: money(paid.collected, locale) }));
      onPaid(paid);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: ['merchant', 'billing'] });
    },
  });

  const ready = nothingDue || method !== 'CASH' || received >= due;
  const subtitle = [t('bills.meta', { orders: bill.orders.length, items: itemCount(bill.orders), age: age(bill.openedAt, now) })].join('');

  return (
    <Sheet label={title(bill)} onClose={onClose}>
      <SheetHeader badge={bill.table ? tableNo(bill.table.number) : <ShoppingBag className="size-5" />} title={title(bill)} subtitle={subtitle} onClose={onClose} />
      <div className="space-y-3 px-4 pt-3">
        {bill.requested ? <p className="flex items-center gap-2 rounded-2xl bg-[#FDECEA] px-4 py-2.5 text-sm font-semibold text-[#B42318]"><Receipt className="size-4" />{t('bills.requested')}</p> : null}
        {!bill.served ? <p className="flex items-start gap-2 rounded-2xl bg-[#FFF8DC] px-4 py-2.5 text-xs text-[#6B4A00]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t('bills.notAllServed')}</p> : null}

        {!paying ? (
          <>
            <OrderLines bill={bill} />
            <Totals bill={bill} />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => printBill(bill, store, locale, t)} className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#E2E2DC] bg-white text-sm font-semibold">
                <Printer className="size-4" />{t('pay.printBill')}
              </button>
              {canSettle ? (
                nothingDue ? (
                  <button type="button" disabled={settle.isPending} onClick={() => settle.mutate()} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#168A52] text-sm font-semibold text-white disabled:opacity-50">
                    {settle.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t('pay.close')}
                  </button>
                ) : (
                  <button type="button" onClick={() => setPaying(true)} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white">
                    <Banknote className="size-4" />{t('pay.take')}
                  </button>
                )
              ) : <p className="grid place-items-center rounded-2xl bg-white px-3 text-center text-xs text-[#696965]">{t('pay.noPermission')}</p>}
            </div>
          </>
        ) : (
          <>
            <section className="rounded-2xl bg-white px-4 py-4 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#696965]">{t('due')}</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums">{money(bill.due, locale)}</p>
            </section>
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1" role="radiogroup" aria-label={t('pay.method')}>
              {METHODS.map((option) => (
                <button key={option.key} type="button" role="radio" aria-checked={method === option.key} onClick={() => setMethod(option.key)} className={cn('flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs font-semibold', method === option.key ? 'bg-[#111111] text-white' : 'text-[#5C5C58]')}>
                  <option.icon className="size-5" />{t(`methods.${option.key}`)}
                </button>
              ))}
            </div>

            {method === 'CASH' ? (
              <section className="space-y-3 rounded-2xl bg-white p-4">
                <label className="block text-sm font-semibold" htmlFor="till-tendered">{t('pay.received')}</label>
                <input
                  id="till-tendered"
                  inputMode="decimal"
                  dir="ltr"
                  value={tendered}
                  onChange={(event) => setTendered(event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                  placeholder={due.toFixed(3)}
                  className="h-14 w-full rounded-xl border border-[#E2E2DC] px-4 text-center text-2xl font-semibold tabular-nums outline-none focus:border-[#111111]"
                />
                <div className="grid grid-cols-4 gap-2">
                  {quick.map((value) => (
                    <button key={value} type="button" onClick={() => setTendered(value.toFixed(3))} className={cn('h-11 rounded-xl border text-sm font-semibold tabular-nums', received === value ? 'border-[#111111] bg-[#111111] text-white' : 'border-[#E2E2DC]')}>
                      {value === due ? t('pay.exact') : value.toLocaleString(locale === 'ar' ? 'ar-BH' : 'en-GB', { maximumFractionDigits: 3 })}
                    </button>
                  ))}
                </div>
                <div className={cn('flex items-center justify-between rounded-xl px-4 py-3', tendered && change < 0 ? 'bg-[#FDECEA] text-[#B42318]' : 'bg-[#E3F5EA] text-[#11663D]')}>
                  <span className="text-sm font-semibold">{tendered && change < 0 ? t('pay.short') : t('pay.change')}</span>
                  <span className="text-xl font-bold tabular-nums">{money(tendered ? Math.abs(change) : 0, locale)}</span>
                </div>
              </section>
            ) : (
              <p className="rounded-2xl bg-white px-4 py-3 text-sm text-[#4A4A46]">{t(method === 'CARD' ? 'pay.cardHint' : 'pay.benefitHint', { amount: money(bill.due, locale) })}</p>
            )}

            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => setPaying(false)} className="h-12 rounded-2xl border border-[#E2E2DC] bg-white px-4 text-sm font-semibold">{t('pay.back')}</button>
              <button type="button" disabled={!ready || settle.isPending} onClick={() => settle.mutate()} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#168A52] text-sm font-semibold text-white disabled:opacity-40">
                {settle.isPending ? <Loader2 className="size-4 animate-spin" /> : <CircleCheck className="size-4" />}
                {t('pay.confirm', { amount: money(bill.due, locale) })}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

export function ReceiptSheet({ bill, onClose }: { bill: PaidBill; onClose: () => void }) {
  const t = useTranslations('till');
  const locale = useTillLocale();
  const store = useStoreHeader();
  const title = useBillTitle();
  const time = new Date(bill.settledAt).toLocaleString(locale === 'ar' ? 'ar-BH' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Asia/Bahrain' });
  return (
    <Sheet label={bill.number} onClose={onClose}>
      <SheetHeader tone="good" badge={<Check className="size-6" />} title={title(bill)} subtitle={`${bill.number} · ${time}${bill.settledBy ? ` · ${t('bills.by', { name: bill.settledBy })}` : ''}`} onClose={onClose} />
      <div className="space-y-3 px-4 pt-3">
        <section className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
          <MethodPill method={bill.method} />
          <span className="text-2xl font-semibold tabular-nums">{money(bill.method === 'ONLINE' ? bill.prepaid : bill.collected, locale)}</span>
        </section>
        {bill.tendered ? (
          <section className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white px-4 py-3"><p className="text-xs text-[#696965]">{t('print.tendered')}</p><p className="font-semibold tabular-nums">{money(bill.tendered, locale)}</p></div>
            <div className="rounded-2xl bg-[#E3F5EA] px-4 py-3"><p className="text-xs text-[#11663D]">{t('print.change')}</p><p className="font-semibold tabular-nums text-[#11663D]">{money(bill.change ?? 0, locale)}</p></div>
          </section>
        ) : null}
        <OrderLines bill={bill} />
        <Totals bill={bill} />
        <button type="button" onClick={() => printBill(bill, store, locale, t)} className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#111111] text-sm font-semibold text-white">
          <Printer className="size-4" />{t('pay.printReceipt')}
        </button>
      </div>
    </Sheet>
  );
}
