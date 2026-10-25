import { Button } from '@alliva/ui';
import { AlertTriangle, CalendarClock, CalendarX, Clock, UserRoundSearch } from 'lucide-react';
import { BarChart, Funnel } from '../charts';
import { useConsole } from '../context';
import { formatDateTime, formatMoney, formatNumber } from '../format';
import { useLang, useT, type MessageKey } from '../i18n';
import { DateRange, Kpi, Page, QueryBoundary, Section, StatusPill, Toolbar, useData, useFilters } from '../kit';
import type { AppointmentRow, Wallet } from '../types';

type Dashboard = {
  kpis: Record<string, string | number>;
  funnel: { status: string; count: number }[];
  charts: { registrations: { month: string; value: number }[]; revenue: { month: string; value: number }[]; commission: { month: string; value: number }[] };
  topStaff: { staffId: string; name: string; stores: number }[];
  alerts: { today: number; upcoming: number; overdue: number; missed: number; leadsNeedingAttention: number; next: AppointmentRow[] };
};

type KpiDef = { key: string; label: MessageKey; kind: 'num' | 'money' | 'percent'; tone?: 'warn' | 'bad' | 'good' };

export function DashboardScreen() {
  const { api, role, navigate } = useConsole();
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ from: '', to: '' });
  const path = role === 'ADMIN' ? '/admin/dashboard' : '/dashboard';
  const query = useData<Dashboard>('dashboard', path, { from: filters.values.from, to: filters.values.to });
  const wallet = useData<Wallet>('wallet', '/wallet', undefined, role !== 'ADMIN');
  void api;

  const defs: KpiDef[] = [
    ...(role === 'ADMIN'
      ? ([
          { key: 'heads', label: 'kpiHeads', kind: 'num' },
          { key: 'activeStaff', label: 'kpiActiveStaff', kind: 'num' },
        ] as KpiDef[])
      : []),
    ...(role === 'HEAD' ? ([{ key: 'teamSize', label: 'kpiTeamSize', kind: 'num' }] as KpiDef[]) : []),
    { key: 'leads', label: 'kpiLeads', kind: 'num' },
    { key: 'visits', label: 'kpiVisits', kind: 'num' },
    { key: 'leadsRegistered', label: 'kpiLeadsRegistered', kind: 'num' },
    { key: 'conversionRate', label: 'kpiConversion', kind: 'percent' },
    { key: 'referredStores', label: 'kpiStores', kind: 'num' },
    { key: 'payingStores', label: 'kpiPayingStores', kind: 'num', tone: 'good' },
    ...(role === 'ADMIN' ? ([{ key: 'revenue', label: 'kpiRevenue', kind: 'money' }] as KpiDef[]) : []),
    { key: 'staffCommission', label: role === 'STAFF' ? 'kpiMyCommission' : role === 'HEAD' ? 'kpiTeamStaffCommission' : 'kpiStaffCommission', kind: 'money' },
    ...(role === 'STAFF' ? [] : ([{ key: 'headCommission', label: role === 'HEAD' ? 'kpiMyCommission' : 'kpiHeadCommission', kind: 'money' }] as KpiDef[])),
    { key: 'pendingCommission', label: 'kpiPendingCommission', kind: 'money', tone: 'warn' },
    { key: 'approvedCommission', label: 'kpiApprovedCommission', kind: 'money' },
    { key: 'appointmentsScheduled', label: 'kpiAppointments', kind: 'num' },
    { key: 'appointmentsMissed', label: 'kpiMissed', kind: 'num', tone: 'bad' },
    ...(role === 'ADMIN'
      ? ([
          { key: 'pendingWithdrawals', label: 'kpiPendingWithdrawals', kind: 'num', tone: 'warn' },
          { key: 'pendingWithdrawalAmount', label: 'kpiPendingWithdrawalAmount', kind: 'money', tone: 'warn' },
        ] as KpiDef[])
      : []),
  ];

  const show = (def: KpiDef, kpis: Dashboard['kpis']) => {
    const value = kpis[def.key];
    if (value === undefined) return '—';
    return def.kind === 'money' ? formatMoney(value, lang) : def.kind === 'percent' ? `${formatNumber(value, lang, 1)}%` : formatNumber(value, lang);
  };

  return (
    <Page
      title={t('dashboardTitle')}
      subtitle={t(role === 'ADMIN' ? 'dashboardSubtitleAdmin' : role === 'HEAD' ? 'dashboardSubtitleHead' : 'dashboardSubtitleStaff')}
      actions={
        <Toolbar>
          <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
          {filters.values.from || filters.values.to ? <Button variant="ghost" size="sm" onClick={() => filters.set({ from: '', to: '' })}>{t('clear')}</Button> : null}
        </Toolbar>
      }
    >
      <QueryBoundary query={query}>
        {(data) => (
          <div className="space-y-5">
            <AlertBar alerts={data.alerts} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {role !== 'ADMIN' && wallet.data ? <Kpi label={t('walletAvailable')} value={formatMoney(wallet.data.available, lang)} hint={`${t('walletPending')}: ${formatMoney(wallet.data.pending, lang)}`} tone="good" /> : null}
              {defs.map((def) => (
                <Kpi key={def.key} label={t(def.label)} value={show(def, data.kpis)} tone={def.tone && Number(data.kpis[def.key]) > 0 ? def.tone : undefined} />
              ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Section title={t('funnelTitle')} subtitle={t('funnelSubtitle')}>
                <Funnel stages={data.funnel.map((stage) => ({ key: stage.status, label: t(`status.${stage.status}` as MessageKey), count: stage.count }))} />
              </Section>
              <Section title={t('registrationsTitle')} subtitle={t('last6Months')}>
                <BarChart data={data.charts.registrations.map((point) => ({ label: point.month, value: point.value }))} title={t('registrationsTitle')} />
              </Section>
              {role === 'ADMIN' ? (
                <Section title={t('revenueTitle')} subtitle={t('last6Months')}>
                  <BarChart data={data.charts.revenue.map((point) => ({ label: point.month, value: point.value }))} unit="BHD" title={t('revenueTitle')} />
                </Section>
              ) : null}
              <Section title={t('commissionTitle')} subtitle={t('last6Months')}>
                <BarChart data={data.charts.commission.map((point) => ({ label: point.month, value: point.value }))} unit="BHD" title={t('commissionTitle')} />
              </Section>
              {role !== 'STAFF' ? (
                <Section title={t('topStaffTitle')} subtitle={t('topStaffSubtitle')}>
                  {data.topStaff.length ? (
                    <ol className="space-y-2">
                      {data.topStaff.map((row, index) => (
                        <li key={row.staffId} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                          <span className="font-medium">{index + 1}. {row.name}</span>
                          <span className="tabular-nums">{t('storesCount', { count: row.stores })}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('noReferralsYet')}</p>
                  )}
                </Section>
              ) : null}
              <Section title={t('nextAppointments')} actions={<Button variant="ghost" size="sm" onClick={() => navigate('appointments')}>{t('viewAll')}</Button>}>
                {data.alerts.next.length ? (
                  <ul className="space-y-2">
                    {data.alerts.next.map((row) => (
                      <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{row.title || row.subject}<span className="ms-2 font-normal text-muted-foreground">{row.subject}</span></span>
                        <span className="flex shrink-0 items-center gap-2"><StatusPill value={row.kind} />{formatDateTime(row.scheduledAt, lang)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noUpcoming')}</p>
                )}
              </Section>
            </div>
          </div>
        )}
      </QueryBoundary>
    </Page>
  );
}

function AlertBar({ alerts }: { alerts: Dashboard['alerts'] }) {
  const t = useT();
  const lang = useLang();
  const { navigate } = useConsole();
  const items: { icon: typeof Clock; label: MessageKey; count: number; bad?: boolean; go: () => void }[] = [
    { icon: CalendarClock, label: 'alertToday', count: alerts.today, go: () => navigate('appointments', { bucket: 'today' }) },
    { icon: Clock, label: 'alertUpcoming', count: alerts.upcoming, go: () => navigate('appointments', { bucket: 'upcoming' }) },
    { icon: AlertTriangle, label: 'alertOverdue', count: alerts.overdue, bad: true, go: () => navigate('appointments', { bucket: 'overdue' }) },
    { icon: CalendarX, label: 'alertMissed', count: alerts.missed, bad: true, go: () => navigate('appointments', { bucket: 'missed' }) },
    { icon: UserRoundSearch, label: 'alertAttention', count: alerts.leadsNeedingAttention, bad: true, go: () => navigate('leads', { attention: 'true' }) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={item.go}
          className={`flex items-center gap-3 rounded-2xl border p-3 text-start transition hover:shadow-sm ${item.bad && item.count > 0 ? 'border-[#f3c1bd] bg-[#fdecea]' : 'bg-card'}`}
        >
          <item.icon className={`size-5 shrink-0 ${item.bad && item.count > 0 ? 'text-[#d9342b]' : 'text-muted-foreground'}`} />
          <span>
            <span className="block text-xl font-semibold tabular-nums">{formatNumber(item.count, lang)}</span>
            <span className="block text-xs text-muted-foreground">{t(item.label)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
