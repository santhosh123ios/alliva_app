import { CashDepositsCard } from '@/components/cash-deposits';
import { api } from '@/components/providers';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Apple,
  Banknote,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  Info,
  MoreHorizontal,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Smartphone,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { useLocale } from 'use-intl';
import { useMemo, useState } from 'react';

export type MerchantPayment = {
  id: string;
  orderId?: string | null;
  provider?: string;
  method?: string;
  status?: string;
  amount?: string | number;
  gatewayFee?: string | number;
  currency?: string;
  externalId?: string | null;
  createdAt?: string;
};

type Tab = 'overview' | 'transactions' | 'cash' | 'settlements' | 'refunds' | 'invoices';

const methodMeta: Record<string, { label: string; icon: LucideIcon; color: string; pale: string }> = {
  CARD: { label: 'Online card', icon: CreditCard, color: '#4787E8', pale: '#EAF2FF' },
  TAP_PAY: { label: 'Tap Pay', icon: Smartphone, color: '#EF6D7B', pale: '#FFF0F2' },
  BENEFIT: { label: 'Benefit', icon: WalletCards, color: '#E84F67', pale: '#FFF0F2' },
  BENEFIT_PAY: { label: 'BenefitPay', icon: Smartphone, color: '#E84F67', pale: '#FFF0F2' },
  CASH: { label: 'Cash on delivery', icon: Banknote, color: '#E4A321', pale: '#FFF6DE' },
  BANK_TRANSFER: { label: 'Bank transfer', icon: CircleDollarSign, color: '#7B61D1', pale: '#F1EDFF' },
  PAYPAL: { label: 'PayPal', icon: WalletCards, color: '#269A5F', pale: '#E9F8F0' },
  APPLE_PAY: { label: 'Apple Pay', icon: Apple, color: '#161616', pale: '#F1F1EF' },
};

const statusStyles: Record<string, string> = {
  CAPTURED: 'bg-[#E9F8F0] text-[#168A52]',
  AUTHORIZED: 'bg-[#EAF2FF] text-[#3475CC]',
  PENDING: 'bg-[#FFF5D8] text-[#A66B00]',
  FAILED: 'bg-[#FDEBED] text-[#C53B48]',
  REFUNDED: 'bg-[#F1EDFF] text-[#7352C3]',
  PARTIALLY_REFUNDED: 'bg-[#FFF0E5] text-[#C36624]',
};

const tabs: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'cash', label: 'COD collections' },
  { key: 'settlements', label: 'Settlements' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'invoices', label: 'Invoices' },
];

export function PaymentsPage({ payments }: { payments: MerchantPayment[] }) {
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('overview');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const canConfirmCash = Boolean(me.data?.permissions.includes('cash.confirm'));

  const normalized = useMemo(
    () => payments.map((payment) => ({ ...payment, amountNumber: moneyNumber(payment.amount), feeNumber: moneyNumber(payment.gatewayFee) })),
    [payments],
  );
  const currency = normalized.find((payment) => payment.currency)?.currency ?? 'BHD';
  const collected = sum(normalized.filter((payment) => ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(payment.status ?? '')));
  const cash = sum(normalized.filter((payment) => payment.method === 'CASH' && payment.status === 'CAPTURED'));
  const online = sum(normalized.filter((payment) => payment.method !== 'CASH' && payment.status === 'CAPTURED'));
  const pending = sum(normalized.filter((payment) => ['PENDING', 'AUTHORIZED'].includes(payment.status ?? '')));
  const refunded = sum(normalized.filter((payment) => ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status ?? '')));
  const fees = normalized.reduce((total, payment) => total + payment.feeNumber, 0);

  const visible = normalized.filter((payment) => {
    if (tab === 'cash' && payment.method !== 'CASH') return false;
    if (tab === 'refunds' && !payment.status?.includes('REFUND')) return false;
    if (status !== 'ALL' && payment.status !== status) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [payment.id, payment.orderId, payment.externalId, payment.method, payment.provider, payment.status]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  });

  const methods = Object.entries(
    normalized
      .filter((payment) => payment.status === 'CAPTURED')
      .reduce<Record<string, number>>((totals, payment) => {
        const key = payment.method ?? 'CARD';
        totals[key] = (totals[key] ?? 0) + payment.amountNumber;
        return totals;
      }, {}),
  ).sort((a, b) => b[1] - a[1]);

  function exportReport() {
    const rows = [['Date', 'Reference', 'Method', 'Provider', 'Amount', 'Currency', 'Status']];
    normalized.forEach((payment) => rows.push([
      payment.createdAt ?? '',
      payment.externalId ?? payment.orderId ?? payment.id,
      payment.method ?? '',
      payment.provider ?? '',
      String(payment.amount ?? 0),
      payment.currency ?? currency,
      payment.status ?? '',
    ]));
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="space-y-3 pb-4 text-[#161616]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">Payments</h1>
          <p className="mt-1 text-sm text-[#777773]">Track transactions, COD collections and settlements.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={CalendarDays}>This month <ChevronDown className="size-3.5" /></ActionButton>
          <ActionButton icon={Download} onClick={exportReport}>Export report</ActionButton>
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-[#161616] hover:bg-[#F1BB00]">
            <Plus className="size-4" /> Record cash handover
          </button>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Metric icon={WalletCards} label="Total collected" value={collected} currency={currency} note={`${normalized.length} payments`} color="#229D62" pale="#E9F8F0" />
        <Metric icon={CreditCard} label="Online payments" value={online} currency={currency} note={`${percentage(online, collected)}% of total`} color="#3C7ED5" pale="#EAF2FF" />
        <Metric icon={Banknote} label="COD collected" value={cash} currency={currency} note={`${percentage(cash, collected)}% of total`} color="#C98910" pale="#FFF5D8" />
        <Metric icon={CircleDollarSign} label="Processing fees" value={fees} currency={currency} note="Gateway charges" color="#C27A32" pale="#FFF2E8" />
        <Metric icon={Clock3} label="Pending" value={pending} currency={currency} note="Awaiting capture" color="#784ED5" pale="#F1EDFF" />
        <Metric icon={RotateCcw} label="Refunds" value={refunded} currency={currency} note={`${percentage(refunded, collected)}% of total`} color="#D14552" pale="#FDEBED" />
      </section>

      {canConfirmCash ? <CashDepositsCard /> : null}

      <section className="overflow-hidden rounded-2xl border border-[#E8E8E5] bg-white">
        <div className="overflow-x-auto border-b border-[#EEEEEB] px-3">
          <div className="flex min-w-max gap-1">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`relative px-3 py-3 text-xs font-semibold ${tab === item.key ? 'text-[#161616]' : 'text-[#777773]'}`}
              >
                {item.label}
                {tab === item.key ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-h-[330px] xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{tab === 'cash' ? 'Cash on delivery collections' : tab === 'refunds' ? 'Refund activity' : 'Payment transactions'}</h2>
                <p className="mt-0.5 text-xs text-[#777773]">Monitor payment status, methods and references.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-3.5 -translate-y-1/2 text-[#999995]" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search transactions" className="h-9 w-48 rounded-xl border border-[#E6E6E2] ps-8 pe-3 text-xs outline-none focus:ring-2 focus:ring-primary" />
                </label>
                <label className="relative">
                  <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 appearance-none rounded-xl border border-[#E6E6E2] bg-white ps-3 pe-8 text-xs font-medium outline-none">
                    <option value="ALL">All statuses</option>
                    <option value="CAPTURED">Captured</option>
                    <option value="PENDING">Pending</option>
                    <option value="AUTHORIZED">Authorized</option>
                    <option value="REFUNDED">Refunded</option>
                    <option value="FAILED">Failed</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#777773]" />
                </label>
              </div>
            </div>
            <PaymentTable rows={visible.slice(0, 8)} currency={currency} locale={locale} />
          </div>

          <aside className="space-y-3 border-t border-[#EEEEEB] bg-[#FCFCFB] p-3 xl:border-s xl:border-t-0">
            <div className="rounded-xl border border-[#E8E8E5] bg-white p-3.5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">Payment mix <Info className="size-3.5 text-[#999995]" /></h3>
                <button type="button" className="text-[11px] font-semibold text-[#3377C5]">View details</button>
              </div>
              <p className="mt-0.5 text-xs text-[#777773]">Captured payments by method</p>
              <div className="mt-4 flex items-center gap-5">
                <PaymentDonut methods={methods} total={collected} currency={currency} />
                <div className="min-w-0 flex-1 space-y-2">
                  {methods.slice(0, 4).map(([method, value]) => {
                    const meta = getMethodMeta(method);
                    return (
                      <div key={method} className="flex items-center gap-2 text-[10px]">
                        <span className="size-2 rounded-full" style={{ background: meta.color }} />
                        <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                        <span className="font-semibold">{percentage(value, collected)}%</span>
                      </div>
                    );
                  })}
                  {!methods.length ? <p className="text-xs text-[#8A8A86]">No captured payments yet.</p> : null}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-[#E8E8E5] bg-white p-3.5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Collection alerts</h3>
                <span className="text-[11px] font-semibold text-[#3377C5]">View all</span>
              </div>
              <AlertRow icon={pending > 0 ? Clock3 : Check} color={pending > 0 ? '#C98910' : '#168A52'} pale={pending > 0 ? '#FFF5D8' : '#E9F8F0'} title={pending > 0 ? 'Payments awaiting capture' : 'All payments are up to date'} detail={pending > 0 ? `${formatMoney(pending, currency, locale)} pending` : 'No pending collections'} />
              <AlertRow icon={fees > 0 ? AlertTriangle : Check} color={fees > collected * 0.05 ? '#CF3C49' : '#168A52'} pale={fees > collected * 0.05 ? '#FDEBED' : '#E9F8F0'} title="Gateway fee check" detail={`${formatMoney(fees, currency, locale)} in processing fees`} />
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1.05fr_1fr]">
        <div className="rounded-2xl border border-[#E8E8E5] bg-white p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">Payment method summary <Info className="size-3.5 text-[#999995]" /></h2>
            <span className="text-[11px] font-semibold text-[#3377C5]">View transactions <ChevronRight className="inline size-3" /></span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(methods.length ? methods : [['CARD', 0], ['BENEFIT_PAY', 0], ['CASH', 0]]).slice(0, 6).map(([method, value]) => (
              <MethodCard key={method} method={String(method)} value={Number(value)} total={collected} currency={currency} locale={locale} />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-[#E8E8E5] bg-white p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent payments</h2>
            <span className="text-[11px] font-semibold text-[#3377C5]">View all <ChevronRight className="inline size-3" /></span>
          </div>
          <PaymentTable rows={normalized.slice(0, 4)} currency={currency} locale={locale} compact />
        </div>
      </section>
    </div>
  );
}

function ActionButton({ icon: Icon, children, onClick }: { icon: LucideIcon; children: React.ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#E5E5E1] bg-white px-3 text-sm font-semibold hover:bg-[#FAFAF8]"><Icon className="size-4" />{children}</button>;
}

function Metric({ icon: Icon, label, value, currency, note, color, pale }: { icon: LucideIcon; label: string; value: number; currency: string; note: string; color: string; pale: string }) {
  return (
    <article className="rounded-2xl border border-[#E8E8E5] bg-white p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ color, background: pale }}><Icon className="size-4" /></span>
        <div className="min-w-0">
          <p className="truncate text-[10px] font-medium text-[#777773]">{label}</p>
          <p className="mt-0.5 truncate text-[13px] font-bold tracking-[-0.01em]">{formatMoney(value, currency)}</p>
          <p className="mt-1 truncate text-[9px] text-[#8A8A86]">{note}</p>
        </div>
      </div>
    </article>
  );
}

function PaymentTable({ rows, currency, locale, compact = false }: { rows: Array<MerchantPayment & { amountNumber: number; feeNumber: number }>; currency: string; locale: string; compact?: boolean }) {
  if (!rows.length) return (
    <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-[#DEDEDA] bg-[#FCFCFB] p-5 text-center">
      <div><ReceiptText className="mx-auto size-6 text-[#AAA9A4]" /><p className="mt-2 text-sm font-semibold">No payments found</p><p className="mt-1 text-xs text-[#777773]">Transactions will appear here when available.</p></div>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-start">
        <thead><tr className="border-b border-[#EEEEEB] text-[9px] font-semibold uppercase tracking-wide text-[#858580]">
          <th className="px-2 py-2 text-start">Reference</th>
          {!compact ? <th className="px-2 py-2 text-start">Method</th> : null}
          <th className="px-2 py-2 text-start">Date</th>
          <th className="px-2 py-2 text-end">Amount</th>
          <th className="px-2 py-2 text-center">Status</th>
          {!compact ? <th className="w-8 px-2 py-2" /> : null}
        </tr></thead>
        <tbody>
          {rows.map((payment) => {
            const meta = getMethodMeta(payment.method);
            const MethodIcon = meta.icon;
            return (
              <tr key={payment.id} className="border-b border-[#F0F0ED] last:border-0">
                <td className="px-2 py-2.5"><p className="max-w-40 truncate text-[11px] font-semibold">{shortReference(payment)}</p><p className="mt-0.5 text-[9px] text-[#858580]">{payment.provider ?? 'Alliva payment'}</p></td>
                {!compact ? <td className="px-2 py-2.5"><span className="inline-flex items-center gap-2 text-[10px] font-medium"><span className="grid size-6 place-items-center rounded-lg" style={{ color: meta.color, background: meta.pale }}><MethodIcon className="size-3.5" /></span>{meta.label}</span></td> : null}
                <td className="whitespace-nowrap px-2 py-2.5 text-[10px] text-[#5F5F5B]">{formatDate(payment.createdAt, locale)}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-end text-[10px] font-semibold">{formatMoney(payment.amountNumber, payment.currency ?? currency, locale)}</td>
                <td className="px-2 py-2.5 text-center"><StatusBadge status={payment.status} /></td>
                {!compact ? <td className="px-2 py-2.5"><button type="button" aria-label="Payment actions" className="grid size-6 place-items-center rounded-lg hover:bg-[#F3F3F0]"><MoreHorizontal className="size-3.5" /></button></td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status = 'PENDING' }: { status?: string }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[8px] font-bold capitalize ${statusStyles[status] ?? 'bg-[#F1F1EF] text-[#666662]'}`}>{status.toLowerCase().replaceAll('_', ' ')}</span>;
}

function PaymentDonut({ methods, total, currency }: { methods: [string, number][]; total: number; currency: string }) {
  let angle = 0;
  const stops = methods.slice(0, 5).map(([method, value]) => {
    const start = angle;
    angle += percentage(value, total);
    return `${getMethodMeta(method).color} ${start}% ${angle}%`;
  });
  return (
    <div className="relative grid size-24 shrink-0 place-items-center rounded-full" style={{ background: methods.length ? `conic-gradient(${stops.join(',')})` : '#ECECE8' }}>
      <div className="grid size-16 place-items-center rounded-full bg-white text-center">
        <div><p className="text-[8px] text-[#858580]">{currency}</p><p className="text-xs font-bold">{compactNumber(total)}</p></div>
      </div>
    </div>
  );
}

function AlertRow({ icon: Icon, color, pale, title, detail }: { icon: LucideIcon; color: string; pale: string; title: string; detail: string }) {
  return (
    <div className="mt-3 flex items-center gap-2.5 border-t border-[#F0F0ED] pt-3 first:border-0">
      <span className="grid size-7 shrink-0 place-items-center rounded-full" style={{ color, background: pale }}><Icon className="size-3.5" /></span>
      <div className="min-w-0 flex-1"><p className="truncate text-[10px] font-semibold">{title}</p><p className="mt-0.5 truncate text-[9px] text-[#858580]">{detail}</p></div>
      <ChevronRight className="size-3.5 text-[#AAA9A4]" />
    </div>
  );
}

function MethodCard({ method, value, total, currency, locale }: { method: string; value: number; total: number; currency: string; locale: string }) {
  const meta = getMethodMeta(method);
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#EEEEEB] p-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl" style={{ color: meta.color, background: meta.pale }}><Icon className="size-4" /></span>
      <div className="min-w-0"><p className="truncate text-[9px] text-[#777773]">{meta.label}</p><p className="truncate text-[11px] font-bold">{formatMoney(value, currency, locale)}</p><p className="text-[8px] text-[#8A8A86]">{percentage(value, total)}% of total</p></div>
    </div>
  );
}

function getMethodMeta(method?: string) {
  return methodMeta[method ?? 'CARD'] ?? { label: (method ?? 'Other').toLowerCase().replaceAll('_', ' '), icon: CreditCard, color: '#777773', pale: '#F1F1EF' };
}

function moneyNumber(value: string | number | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sum(rows: { amountNumber: number }[]) {
  return rows.reduce((total, row) => total + row.amountNumber, 0);
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatMoney(value: number, currency: string, locale = 'en') {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-BH' : 'en-BH', { style: 'currency', currency, minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | undefined, locale: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function shortReference(payment: MerchantPayment) {
  const reference = payment.externalId ?? payment.orderId ?? payment.id;
  return reference.length > 18 ? `${reference.slice(0, 8)}…${reference.slice(-5)}` : reference;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
