import { ColumnChart } from '@/components/bars';
import { CashDepositsCard } from '@/components/cash-deposits';
import { api } from '@/components/providers';
import { dayLabel, hourLabel, Kpi, Panel, today } from '@/components/reports';
import { useWorkspaceBranch } from '@/components/shell';
import { Link } from '@/i18n/navigation';
import { hasPermission } from '@/lib/roles';
import { formatMoney } from '@alliva/design-tokens';
import { ErrorState, Skeleton } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Banknote, Bike, Hourglass, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

/** Billing staff landing: the day's takings by payment method, refunds and where the cash is. */
export function BillingHome() {
  const t = useTranslations('billing');
  const reports = useTranslations('storeReports');
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const { branchId } = useWorkspaceBranch();
  const [date, setDate] = useState(today);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const params = { date, branchId: branchId || undefined };
  const takings = useQuery({ queryKey: ['merchant', 'dashboard', 'takings', params], queryFn: () => api.takings(params), refetchInterval: 60_000, placeholderData: (previous) => previous });
  const data = takings.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#161616]">{date === today() ? t('titleToday') : t('titleDay', { day: dayLabel(date, locale) })}</h1>
          <p className="mt-1 text-sm text-[#696965]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="takings-date">{t('date')}</label>
          <input id="takings-date" type="date" value={date} max={today()} onChange={(event) => event.target.value && setDate(event.target.value)} className="h-11 rounded-xl border border-[#E6E6E2] bg-white px-3 text-sm font-semibold" />
          <Link href="/payments" className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616]">
            {t('allPayments')}<ArrowRight className="size-4 rtl:-scale-x-100" />
          </Link>
        </div>
      </div>

      {takings.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}</div>
      ) : takings.error && !data ? (
        <ErrorState title={t('loadError')} body={(takings.error as Error).message} />
      ) : data ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t('gross')} value={formatMoney(data.gross, locale)} detail={t('ordersSummary', { count: data.orders.total - data.orders.cancelled })} />
            <Kpi label={t('completedSales')} value={formatMoney(data.completedSales, locale)} detail={t('completedDetail', { count: data.orders.completed, open: data.orders.open })} />
            <Kpi label={t('averageOrder')} value={formatMoney(data.averageOrder, locale)} detail={t('cancelled', { count: data.orders.cancelled })} />
            <Kpi label={t('discounts')} value={formatMoney(data.discounts, locale)} detail={t('deliveryFees', { amount: formatMoney(data.deliveryFees, locale) })} />
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel title={t('byMethod')} subtitle={t('byMethodHint')}>
              {data.byMethod.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="text-xs text-[#8A8A86]">
                        <th className="pb-2 text-start font-semibold">{t('method')}</th>
                        <th className="pb-2 text-end font-semibold">{t('orders')}</th>
                        <th className="pb-2 text-end font-semibold">{t('amount')}</th>
                        <th className="pb-2 text-end font-semibold">{t('paid')}</th>
                        <th className="pb-2 text-end font-semibold">{t('due')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byMethod.map((row) => (
                        <tr key={row.method} className="border-t border-[#F1F1EE]">
                          <td className="py-2.5 font-medium text-[#161616]">{reports(`methods.${row.method}`)}</td>
                          <td className="py-2.5 text-end tabular-nums">{row.orders}</td>
                          <td className="py-2.5 text-end tabular-nums font-semibold">{formatMoney(row.amount, locale)}</td>
                          <td className="py-2.5 text-end tabular-nums text-[#16924A]">{formatMoney(row.paid, locale)}</td>
                          <td className="py-2.5 text-end tabular-nums text-[#9A6200]">{Number(row.due) > 0 ? formatMoney(row.due, locale) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-6 text-center text-sm text-[#8A8A86]">{t('noSales')}</p>}
            </Panel>
            <Panel title={t('cashTitle')}>
              <ul className="space-y-3 text-sm">
                <CashRow icon={Bike} label={t('withRiders')} value={formatMoney(data.cash.withRiders, locale)} />
                <CashRow icon={Hourglass} label={t('awaiting', { count: data.cash.depositsToReview })} value={formatMoney(data.cash.awaitingConfirmation, locale)} strong={data.cash.depositsToReview > 0} />
                <CashRow icon={Banknote} label={t('confirmedToday')} value={formatMoney(data.cash.confirmed, locale)} />
                <CashRow icon={RotateCcw} label={t('refunds', { count: data.refunds.count })} value={`${formatMoney(data.refunds.processed, locale)}${Number(data.refunds.requested) > 0 ? ` · ${t('refundsPending', { amount: formatMoney(data.refunds.requested, locale) })}` : ''}`} />
              </ul>
            </Panel>
          </div>

          <Panel title={t('byHour')}>
            <ColumnChart
              empty={t('noSales')}
              labelEvery={3}
              height={120}
              points={tradingHours(data.byHour).map((row) => ({ key: String(row.hour), label: hourLabel(row.hour, locale), value: Number(row.amount), tip: `${hourLabel(row.hour, locale)} · ${formatMoney(row.amount, locale)} · ${reports('ordersCount', { count: row.orders })}` }))}
            />
          </Panel>
        </>
      ) : null}

      {me.data && hasPermission(me.data, 'cash.confirm') ? <CashDepositsCard /> : null}
    </div>
  );
}

function CashRow({ icon: Icon, label, value, strong }: { icon: typeof Bike; label: string; value: string; strong?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#FFF6D4] text-[#161616]"><Icon className="size-4" /></span>
      <span className={strong ? 'font-semibold text-[#161616]' : 'text-[#5C5C58]'}>{label}</span>
      <span className="ms-auto text-end font-semibold tabular-nums text-[#161616]">{value}</span>
    </li>
  );
}

/** Every hour from the first sale to the last, so quiet hours show as gaps instead of disappearing. */
function tradingHours(rows: { hour: number; orders: number; amount: string }[]) {
  if (!rows.length) return [];
  const first = Math.min(...rows.map((row) => row.hour));
  const last = Math.max(...rows.map((row) => row.hour));
  return Array.from({ length: last - first + 1 }, (_, index) => rows.find((row) => row.hour === first + index) ?? { hour: first + index, orders: 0, amount: '0.000' });
}
