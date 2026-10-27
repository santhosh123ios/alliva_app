import { Button } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useConsole } from '../context';
import { formatDate, formatDateTime } from '../format';
import { useLang, useT, type MessageKey } from '../i18n';
import { CommissionRate, DateRange, DetailRow, FilterSelect, ListView, Page, Section, TextField, Toolbar, useAction, useData, useFilters, useList, useStaffOptions, type Column, type Paged } from '../kit';
import type { ActivityRow, MemberDetail, NotificationRow } from '../types';

/** Maps a server notification link (`/leads?lead=ID`, `/commission`) to a console screen + params. */
export function linkToScreen(link: string | null, role?: string): { screen: string; params: Record<string, string> } | null {
  if (!link) return null;
  const [path = '', search = ''] = link.split('?');
  let screen = path.replace(/^\//, '') === 'commission' ? 'commissions' : path.replace(/^\//, '');
  if (!screen) return null;
  if (screen === 'transactions' || (role === 'STAFF' && screen === 'commissions')) screen = 'wallet';
  return { screen, params: Object.fromEntries(new URLSearchParams(search)) };
}

export function NotificationBell() {
  const { api, navigate, role } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = useQuery({ queryKey: ['mk', 'unread'], queryFn: () => api.mk.get<{ unread: number }>('/notifications/unread-count'), refetchInterval: 30_000 });
  const recent = useQuery({ queryKey: ['mk', 'notifications', 'recent'], queryFn: () => api.mk.get<Paged<NotificationRow>>('/notifications', { pageSize: 8 }), enabled: open });
  const unread = count.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const go = async (row: NotificationRow) => {
    if (!row.read) await act(() => api.mk.post(`/notifications/${row.id}/read`));
    const target = linkToScreen(row.link, role);
    setOpen(false);
    if (target) navigate(target.screen, target.params);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="relative grid size-10 place-items-center rounded-full border bg-white" aria-label={t('notificationsTitle')} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Bell className="size-4" />
        {unread > 0 ? <span className="absolute -end-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[#d9342b] px-1 text-[10px] font-bold leading-5 text-white">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute end-0 z-40 mt-2 w-80 rounded-2xl border bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-sm font-semibold">{t('notificationsTitle')}</p>
            {unread > 0 ? <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold underline" onClick={() => act(() => api.mk.post('/notifications/read-all'))}><CheckCheck className="size-3" />{t('markAllRead')}</button> : null}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {recent.data?.items.length ? recent.data.items.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => go(row)} className={`block w-full rounded-xl px-3 py-2 text-start hover:bg-muted ${row.read ? '' : 'bg-[#fff9e0]'}`}>
                  <p className="text-sm font-semibold">{row.title}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{row.body}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{formatDateTime(row.at, lang)}</p>
                </button>
              </li>
            )) : <li className="px-3 py-6 text-center text-sm text-muted-foreground">{recent.isLoading ? t('loading') : t('noNotifications')}</li>}
          </ul>
          <button type="button" className="mt-1 w-full rounded-xl px-3 py-2 text-center text-sm font-semibold hover:bg-muted" onClick={() => { setOpen(false); navigate('notifications'); }}>{t('viewAll')}</button>
        </div>
      ) : null}
    </div>
  );
}

export function NotificationsScreen() {
  const { api, navigate, role } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const filters = useFilters({ unread: '' });
  const query = useList<NotificationRow>('notifications', '/notifications', filters.params);
  const columns: Column<NotificationRow>[] = [
    { key: 'title', header: t('colNotification'), cell: (row) => <div className={row.read ? '' : 'font-semibold'}><p>{row.title}</p><p className="text-xs font-normal text-muted-foreground">{row.body}</p></div> },
    { key: 'at', header: t('colDate'), cell: (row) => formatDateTime(row.at, lang) },
    { key: 'state', header: t('colStatus'), cell: (row) => (row.read ? <span className="text-muted-foreground">{t('read')}</span> : <span className="font-semibold text-[#d9342b]">{t('unread')}</span>) },
  ];
  return (
    <Page title={t('notificationsTitle')} subtitle={t('notificationsSubtitle')} actions={<Button variant="outline" size="sm" onClick={() => act(() => api.mk.post('/notifications/read-all'), 'saved')}><CheckCheck className="size-4" />{t('markAllRead')}</Button>}>
      <Toolbar>
        <FilterSelect label={t('colStatus')} value={filters.values.unread} onChange={(unread) => filters.set({ unread })} options={[{ value: 'true', label: t('unread') }]} />
      </Toolbar>
      <ListView
        query={query}
        columns={columns}
        rowKey={(row) => row.id}
        onPage={filters.setPage}
        emptyTitle={t('noNotifications')}
        emptyBody={t('noNotificationsBody')}
        onRowClick={async (row) => {
          if (!row.read) await act(() => api.mk.post(`/notifications/${row.id}/read`));
          const target = linkToScreen(row.link, role);
          if (target) navigate(target.screen, target.params);
        }}
      />
    </Page>
  );
}

const ACTIVITY_KINDS = ['NOTE', 'STATUS', 'VISIT', 'APPOINTMENT', 'FOLLOW_UP', 'FOLLOW_UP_DONE', 'LEAD_CREATED', 'STORE_CREATED', 'MERCHANT_REGISTERED', 'SUBSCRIPTION_ACTIVATED', 'COMMISSION_EARNED', 'STAFF_TRANSFERRED', 'WITHDRAWAL_REQUESTED'];

export function ActivityScreen() {
  const { role } = useConsole();
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '', kind: '', staffId: '', from: '', to: '' });
  const query = useList<ActivityRow>('activity', '/activity', filters.params);
  const staff = useStaffOptions(role !== 'STAFF');
  const columns: Column<ActivityRow>[] = [
    { key: 'at', header: t('colDate'), cell: (row) => formatDateTime(row.at, lang) },
    { key: 'kind', header: t('colType'), cell: (row) => t(`activity.${row.kind}` as MessageKey) },
    { key: 'subject', header: t('colSubject'), cell: (row) => row.subject || '—' },
    { key: 'body', header: t('colDetails'), cell: (row) => <span className="line-clamp-2 max-w-md">{row.body}</span> },
    ...(role !== 'STAFF' ? [{ key: 'staff', header: t('colStaffMember'), cell: (row: ActivityRow) => row.staffName || '—' }] : []),
    { key: 'by', header: t('colBy'), cell: (row) => row.authorName },
  ];
  return (
    <Page title={t('activityTitle')} subtitle={t('activitySubtitle')}>
      <Toolbar>
        <FilterSelect label={t('colType')} value={filters.values.kind} onChange={(kind) => filters.set({ kind })} options={ACTIVITY_KINDS.map((value) => ({ value, label: t(`activity.${value}` as MessageKey) }))} />
        {role !== 'STAFF' ? <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noActivity')} emptyBody={t('noActivityBody')} />
    </Page>
  );
}

export function ProfileScreen() {
  const { api, me } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [pending, setPending] = useState(false);
  const detail = useData<MemberDetail>('me-stats', `/staff/${me?.id ?? ''}`, undefined, Boolean(me));
  if (!me) return null;
  return (
    <Page title={t('profileTitle')} subtitle={t('profileSubtitle')}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={me.fullName} subtitle={t(me.kind === 'HEAD' ? 'roleHead' : 'roleStaff')}>
          <dl className="divide-y">
            <DetailRow label={t('fEmployeeId')}>{me.employeeId}</DetailRow>
            <DetailRow label={t('fEmail')}><span dir="ltr">{me.email}</span></DetailRow>
            <DetailRow label={t('fRegion')}>{me.region}</DetailRow>
            {me.kind === 'STAFF' ? <DetailRow label={t('colHead')}>{me.headName}</DetailRow> : null}
            {me.referralCode ? <DetailRow label={t('colReferralCode')}><code>{me.referralCode}</code></DetailRow> : null}
            <DetailRow label={t('colCommissionRate')}><CommissionRate percent={detail.data?.effectiveCommissionPercent ?? me.effectiveCommissionPercent} isDefault={detail.data?.commissionIsDefault ?? me.commissionIsDefault} /></DetailRow>
            <DetailRow label={t('colLeads')}>{detail.data?.stats?.leads}</DetailRow>
            <DetailRow label={t('colStores')}>{detail.data?.stats?.referredStores}</DetailRow>
            <DetailRow label={t('fJoinedAt')}>{formatDate(me.joinedAt, lang)}</DetailRow>
          </dl>
        </Section>
        <Section title={t('editContact')} subtitle={t('editContactHint')}>
          <form onSubmit={async (event: FormEvent) => { event.preventDefault(); setPending(true); await act(() => api.mk.patch('/me', { phone: phone.trim() || null }), 'saved'); setPending(false); }} className="space-y-4">
            <TextField label={t('fPhone')} type="tel" value={phone} onChange={setPhone} dir="ltr" inputMode="tel" />
            <Button type="submit" variant="yellow" loading={pending}>{t('save')}</Button>
          </form>
        </Section>
      </div>
    </Page>
  );
}
