import { ColumnChart, ShareBars } from '@/components/bars';
import { api } from '@/components/providers';
import { useWorkspaceBranch } from '@/components/shell';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { StoreReport } from '@alliva/types';
import { cn, ErrorState, Skeleton, toast } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Preset = 'today' | 'week' | 'month' | 'thisMonth' | 'custom';
type Locale = 'en' | 'ar';

/** Read-only sales reports with CSV and PDF export. Owners, managers and report viewers. */
export function ReportsPage() {
  const t = useTranslations('storeReports');
  const locale = (useLocale() === 'ar' ? 'ar' : 'en') as Locale;
  const { branchId } = useWorkspaceBranch();
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState(() => ({ from: shiftDay(today(), -6), to: today() }));
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const range = presetRange(preset, custom);
  const params = { ...range, branchId: branchId || undefined };
  const report = useQuery({ queryKey: ['merchant', 'reports', params], queryFn: () => api.storeReport(params), placeholderData: (previous) => previous });

  async function download(kind: 'csv' | 'pdf') {
    setExporting(kind);
    try {
      const blob = await api.storeReportFile(kind, params);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sales-report-${range.from}-to-${range.to}.${kind}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#161616]">{t('title')}</h1>
          <p className="mt-1 text-sm text-[#696965]">{report.data ? t('range', { from: dayLabel(report.data.from, locale), to: dayLabel(report.data.to, locale) }) : t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton busy={exporting === 'csv'} onClick={() => download('csv')} icon={FileSpreadsheet} label={t('exportCsv')} />
          <ExportButton busy={exporting === 'pdf'} onClick={() => download('pdf')} icon={FileDown} label={t('exportPdf')} />
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-[#EEEEEC] bg-white p-2 sm:flex-row sm:items-center">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-[#F4F4F1] p-1" role="tablist" aria-label={t('period')}>
          {(['today', 'week', 'month', 'thisMonth', 'custom'] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={preset === key} onClick={() => setPreset(key)} className={cn('h-9 shrink-0 rounded-lg px-3 text-sm font-semibold', preset === key ? 'bg-[#F5C400] text-[#111111]' : 'text-[#5C5C58] hover:bg-white/80')}>
              {t(`presets.${key}`)}
            </button>
          ))}
        </div>
        {preset === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2 px-1 text-sm">
            <label className="flex items-center gap-2">{t('from')}<input type="date" value={custom.from} max={custom.to} onChange={(event) => event.target.value && setCustom((current) => ({ ...current, from: event.target.value }))} className="h-10 rounded-xl border border-[#E6E6E2] px-2" /></label>
            <label className="flex items-center gap-2">{t('to')}<input type="date" value={custom.to} min={custom.from} max={today()} onChange={(event) => event.target.value && setCustom((current) => ({ ...current, to: event.target.value }))} className="h-10 rounded-xl border border-[#E6E6E2] px-2" /></label>
          </div>
        ) : null}
        {report.isFetching ? <Loader2 className="mx-2 size-4 animate-spin text-[#8A8A86] sm:ms-auto" /> : null}
      </div>

      {report.isLoading ? <ReportsSkeleton /> : report.error && !report.data ? <ErrorState title={t('loadError')} body={(report.error as Error).message} /> : report.data ? <ReportBody report={report.data} locale={locale} /> : null}
    </div>
  );
}

function ReportBody({ report, locale }: { report: StoreReport; locale: Locale }) {
  const t = useTranslations('storeReports');
  const s = report.summary;
  const minutes = (value: number | null) => (value === null ? '—' : value < 60 ? t('minutes', { count: value }) : t('hoursMinutes', { hours: Math.floor(value / 60), minutes: value % 60 }));
  const step = Math.ceil(report.daily.length / 10);
  const busiest = report.byHour.reduce((best, row) => (row.orders > best.orders ? row : best), report.byHour[0]!);
  return (
    <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('kpi.sales')} value={formatMoney(s.sales, locale)} detail={t('kpi.salesDetail', { count: s.orders })} />
        <Kpi label={t('kpi.averageOrder')} value={formatMoney(s.averageOrder, locale)} detail={t('kpi.discounts', { amount: formatMoney(s.discounts, locale) })} />
        <Kpi label={t('kpi.completed')} value={String(s.completed)} detail={t('kpi.cancelled', { count: s.cancelled, rate: s.cancellationRate })} />
        <Kpi label={t('kpi.customers')} value={String(s.customers)} detail={t('kpi.returning', { count: s.repeatCustomers })} />
        <Kpi label={t('kpi.prep')} value={minutes(s.prepMinutes)} detail={t('kpi.prepDetail')} />
        <Kpi label={t('kpi.delivery')} value={minutes(s.deliveryMinutes)} detail={t('kpi.deliveryDetail')} />
        <Kpi label={t('kpi.fulfilment')} value={minutes(s.fulfilmentMinutes)} detail={t('kpi.fulfilmentDetail')} />
        <Kpi label={t('kpi.refunds')} value={formatMoney(s.refunds, locale)} detail={t('kpi.deliveryFees', { amount: formatMoney(s.deliveryFees, locale) })} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title={t('dailySales')}>
          <ColumnChart
            empty={t('noSales')}
            labelEvery={step}
            points={report.daily.map((row) => ({ key: row.date, label: dayLabel(row.date, locale, true), value: Number(row.sales), tip: `${dayLabel(row.date, locale)} · ${formatMoney(row.sales, locale)} · ${t('ordersCount', { count: row.orders })}` }))}
          />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold text-[#5C5C58]">{t('showTable')}</summary>
            <table className="mt-2 w-full text-start">
              <thead><tr className="text-xs text-[#8A8A86]"><th className="py-1 text-start font-semibold">{t('date')}</th><th className="py-1 text-end font-semibold">{t('orders')}</th><th className="py-1 text-end font-semibold">{t('sales')}</th></tr></thead>
              <tbody>{report.daily.map((row) => <tr key={row.date} className="border-t border-[#F1F1EE]"><td className="py-1.5">{dayLabel(row.date, locale)}</td><td className="py-1.5 text-end tabular-nums">{row.orders}</td><td className="py-1.5 text-end tabular-nums">{formatMoney(row.sales, locale)}</td></tr>)}</tbody>
            </table>
          </details>
        </Panel>
        <Panel title={t('busyHours')} subtitle={busiest && busiest.orders ? t('busiest', { hour: hourLabel(busiest.hour, locale) }) : undefined}>
          <ColumnChart
            empty={t('noSales')}
            labelEvery={6}
            height={130}
            points={report.byHour.map((row) => ({ key: String(row.hour), label: hourLabel(row.hour, locale), value: row.orders, tip: `${hourLabel(row.hour, locale)} · ${t('ordersCount', { count: row.orders })}` }))}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('byChannel')}>
          {report.byChannel.length ? <ShareBars rows={report.byChannel.map((row) => ({ key: row.type, label: t(`channels.${row.type}`), value: row.orders, detail: `${t('ordersCount', { count: row.orders })} · ${formatMoney(row.sales, locale)}` }))} /> : <Empty />}
        </Panel>
        <Panel title={t('byPayment')}>
          {report.byPayment.length ? <ShareBars rows={report.byPayment.map((row) => ({ key: row.method, label: t(`methods.${row.method}`), value: row.orders, detail: `${t('ordersCount', { count: row.orders })} · ${formatMoney(row.sales, locale)}` }))} /> : <Empty />}
        </Panel>
        <Panel title={t('topProducts')}>
          {report.topProducts.length ? (
            <ol className="space-y-2 text-sm">
              {report.topProducts.map((row, index) => (
                <li key={`${row.name.en ?? ''}-${index}`} className="flex items-baseline gap-3">
                  <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-[#8A8A86]">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-[#161616]">{pickLocalized(row.name, locale)}</span>
                  <span className="shrink-0 tabular-nums text-[#5C5C58]">×{row.quantity}</span>
                  <span className="w-24 shrink-0 text-end tabular-nums font-semibold">{formatMoney(row.sales, locale)}</span>
                </li>
              ))}
            </ol>
          ) : <Empty />}
        </Panel>
      </div>
    </>
  );
}

function Empty() {
  const t = useTranslations('storeReports');
  return <p className="py-6 text-center text-sm text-[#8A8A86]">{t('noSales')}</p>;
}

export function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-[#EEEEEC] bg-white p-4">
      <p className="text-xs font-semibold text-[#8A8A86]">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums text-[#161616]">{value}</p>
      {detail ? <p className="mt-1 truncate text-xs text-[#696965]">{detail}</p> : null}
    </div>
  );
}

export function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#EEEEEC] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[#161616]">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-[#696965]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ExportButton({ busy, onClick, icon: Icon, label }: { busy: boolean; onClick: () => void; icon: typeof FileDown; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-xl border border-[#E6E6E2] bg-white px-4 text-sm font-semibold text-[#161616] disabled:opacity-60">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}{label}
    </button>
  );
}

function ReportsSkeleton() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}</div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

/** Today's date in Bahrain as `YYYY-MM-DD`. */
export function today() {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function presetRange(preset: Preset, custom: { from: string; to: string }) {
  const end = today();
  if (preset === 'today') return { from: end, to: end };
  if (preset === 'week') return { from: shiftDay(end, -6), to: end };
  if (preset === 'month') return { from: shiftDay(end, -29), to: end };
  if (preset === 'thisMonth') return { from: `${end.slice(0, 8)}01`, to: end };
  return custom;
}

export function dayLabel(day: string, locale: Locale, short = false) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-BH' : 'en-GB', short ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function hourLabel(hour: number, locale: Locale) {
  return new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString(locale === 'ar' ? 'ar-BH' : 'en-US', { hour: 'numeric', timeZone: 'UTC' });
}
