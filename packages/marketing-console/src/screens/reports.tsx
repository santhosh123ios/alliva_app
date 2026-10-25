import { Button, EmptyState } from '@alliva/ui';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConsole } from '../context';
import { formatDateTime, formatMoney, formatNumber } from '../format';
import { useLang, useT } from '../i18n';
import { DataTable, DateRange, FilterSelect, Page, QueryBoundary, Section, Toolbar, errorMessage, useAction, useData, useFilters, useStaffOptions, type Column, type Paged } from '../kit';
import type { MemberRow, ReportTableData } from '../types';

const REPORT_LABELS: Record<string, { en: string; ar: string }> = {
  'head-performance': { en: 'Marketing Head Performance', ar: 'أداء رؤساء التسويق' },
  'staff-performance': { en: 'Marketing Staff Performance', ar: 'أداء موظفي التسويق' },
  'merchant-referrals': { en: 'Merchant Referrals', ar: 'إحالات التجار' },
  'lead-conversion': { en: 'Lead Conversion', ar: 'تحويل العملاء المحتملين' },
  'store-visits': { en: 'Store Visits', ar: 'زيارات المتاجر' },
  appointments: { en: 'Appointments and Follow-ups', ar: 'المواعيد والمتابعات' },
  commissions: { en: 'Commissions', ar: 'العمولات' },
  'wallet-transactions': { en: 'Wallet Transactions', ar: 'معاملات المحفظة' },
  withdrawals: { en: 'Withdrawals', ar: 'السحوبات' },
  'promo-usage': { en: 'Promo Code Usage', ar: 'استخدام أكواد الخصم' },
  revenue: { en: 'Marketing Revenue', ar: 'إيرادات التسويق' },
};

export function ReportsScreen() {
  const { api, role } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const reports = useData<{ id: string; title: string }[]>('reports', '/reports');
  const [selected, setSelected] = useState('');
  const filters = useFilters({ from: '', to: '', staffId: '', headId: '' });
  const staff = useStaffOptions();
  const heads = useData<Paged<MemberRow>>('heads-all', '/heads', { pageSize: 100 }, role === 'ADMIN');
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

  useEffect(() => {
    if (!selected && reports.data?.length) setSelected(reports.data[0]!.id);
  }, [reports.data, selected]);

  const table = useData<ReportTableData>('report', `/reports/${selected}`, { from: filters.values.from, to: filters.values.to, staffId: filters.values.staffId, headId: filters.values.headId }, Boolean(selected));
  const label = (id: string, title: string) => REPORT_LABELS[id]?.[lang] ?? title;

  async function download(format: 'csv' | 'xlsx') {
    setExporting(format);
    await act(() => api.mk.download(`/reports/${selected}/export`, { from: filters.values.from, to: filters.values.to, staffId: filters.values.staffId, headId: filters.values.headId, format }, `${selected}.${format}`));
    setExporting(null);
  }

  return (
    <Page
      title={t('reportsTitle')}
      subtitle={t('reportsSubtitle')}
      actions={
        selected ? (
          <>
            <Button variant="outline" size="sm" loading={exporting === 'csv'} onClick={() => download('csv')}><Download className="size-4" />CSV</Button>
            <Button variant="outline" size="sm" loading={exporting === 'xlsx'} onClick={() => download('xlsx')}><FileSpreadsheet className="size-4" />Excel</Button>
          </>
        ) : undefined
      }
    >
      <QueryBoundary query={reports}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t('noReports')} body={t('noReportsBody')} />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[16rem_1fr]">
              <nav aria-label={t('reportsTitle')} className="space-y-1">
                {list.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelected(report.id)}
                    className={`block w-full rounded-xl px-3 py-2 text-start text-sm font-semibold transition ${selected === report.id ? 'bg-primary text-[#111111]' : 'hover:bg-muted'}`}
                  >
                    {label(report.id, report.title)}
                  </button>
                ))}
              </nav>
              <div className="min-w-0 space-y-4">
                <Toolbar>
                  <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
                  {role === 'ADMIN' ? <FilterSelect label={t('colHead')} value={filters.values.headId} onChange={(headId) => filters.set({ headId })} options={(heads.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
                  <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} />
                </Toolbar>
                <Section title={selected ? label(selected, table.data?.title ?? '') : undefined} subtitle={table.data ? t('generatedAt', { date: formatDateTime(table.data.generatedAt, lang) }) : undefined}>
                  <ReportBody query={table} />
                </Section>
              </div>
            </div>
          )
        }
      </QueryBoundary>
    </Page>
  );
}

function ReportBody({ query }: { query: ReturnType<typeof useData<ReportTableData>> }) {
  const t = useT();
  const lang = useLang();
  if (query.error) return <p className="text-sm text-[#d9342b]">{errorMessage(query.error)}</p>;
  const data = query.data;
  const cell = (type: string | undefined, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return '—';
    if (type === 'money') return formatMoney(value, lang);
    if (type === 'number') return formatNumber(value, lang);
    if (type === 'percent') return `${formatNumber(value, lang, 1)}%`;
    if (type === 'date') return formatDateTime(String(value), lang);
    return String(value);
  };
  const columns: Column<Record<string, string | number | null>>[] = (data?.columns ?? []).map((column) => ({
    key: column.key,
    header: column.label,
    className: column.type && column.type !== 'text' ? 'text-end tabular-nums' : undefined,
    cell: (row) => cell(column.type, row[column.key]),
  }));
  return (
    <div className="space-y-3">
      <DataTable columns={columns} rows={data?.rows} loading={query.isLoading} rowKey={(row) => JSON.stringify(row)} emptyTitle={t('noReportRows')} emptyBody={t('noReportRowsBody')} />
      {data?.totals ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl bg-muted px-4 py-3 text-sm font-semibold">
          {data.columns.filter((column) => data.totals?.[column.key] != null && column.key !== data.columns[0]?.key).map((column) => (
            <span key={column.key}>{column.label}: {cell(column.type, data.totals?.[column.key])}</span>
          ))}
        </div>
      ) : null}
      {data?.truncated ? <p className="text-xs text-muted-foreground">{t('reportTruncated')}</p> : null}
    </div>
  );
}
