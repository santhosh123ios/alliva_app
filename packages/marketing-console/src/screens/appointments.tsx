import { Button } from '@alliva/ui';
import { CalendarPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useConsole } from '../context';
import { formatDateTime, fromLocalInput } from '../format';
import { useLang, useT } from '../i18n';
import { AreaField, ConfirmDialog, FilterSelect, FormActions, ListView, Modal, Page, SearchBox, SelectField, StatusPill, Tabs, TextField, Toolbar, leadStatusChoices, useAction, useData, useFilters, useList, useStaffOptions, type Column, type Paged } from '../kit';
import { type AppointmentRow, type LeadRow } from '../types';
import { ScheduleDialog } from './leads';

type Bucket = '' | 'today' | 'upcoming' | 'overdue' | 'missed';

export function AppointmentsScreen({ params }: { params: Record<string, string> }) {
  const { role } = useConsole();
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '', bucket: params.bucket ?? 'today', kind: '', staffId: '', status: '' });
  const query = useList<AppointmentRow>('appointments', '/appointments', filters.params);
  const staff = useStaffOptions(role !== 'STAFF');
  const [action, setAction] = useState<{ type: 'complete' | 'reschedule' | 'cancel'; row: AppointmentRow } | null>(null);
  const [picking, setPicking] = useState(false);
  const { api } = useConsole();
  const act = useAction();

  const columns: Column<AppointmentRow>[] = [
    { key: 'when', header: t('fScheduledAt'), cell: (row) => <span className={row.overdue ? 'font-semibold text-[#d9342b]' : ''}>{formatDateTime(row.scheduledAt, lang)}</span> },
    { key: 'kind', header: t('fKind'), cell: (row) => <StatusPill value={row.kind} /> },
    { key: 'title', header: t('fTitle'), cell: (row) => <div><p className="font-semibold">{row.title}</p><p className="text-xs text-muted-foreground">{row.subject}</p></div> },
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.status} overdue={row.overdue} /> },
    { key: 'outcome', header: t('fOutcome'), cell: (row) => row.outcome ?? '—' },
    ...(role !== 'STAFF' ? [{ key: 'staff', header: t('colStaffMember'), cell: (row: AppointmentRow) => row.staffName ?? '—' }] : []),
    ...(role === 'STAFF'
      ? [{
          key: 'actions',
          header: '',
          cell: (row: AppointmentRow) =>
            row.status === 'SCHEDULED' ? (
              <div className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                <Button size="sm" variant="outline" onClick={() => setAction({ type: 'complete', row })}>{t('complete')}</Button>
                <Button size="sm" variant="outline" onClick={() => setAction({ type: 'reschedule', row })}>{t('reschedule')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAction({ type: 'cancel', row })}>{t('cancelAppointment')}</Button>
              </div>
            ) : null,
        }]
      : []),
  ];

  return (
    <Page
      title={t('appointmentsPageTitle')}
      subtitle={t('appointmentsPageSubtitle')}
      actions={role === 'STAFF' ? <Button variant="yellow" onClick={() => setPicking(true)}><CalendarPlus className="size-4" />{t('schedule')}</Button> : undefined}
    >
      <Tabs<Bucket>
        value={filters.values.bucket as Bucket}
        onChange={(bucket) => filters.set({ bucket })}
        tabs={[
          { id: 'today', label: t('tabToday') },
          { id: 'upcoming', label: t('tabUpcoming') },
          { id: 'overdue', label: t('tabOverdue') },
          { id: 'missed', label: t('tabMissed') },
          { id: '', label: t('tabAll') },
        ]}
      />
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        <FilterSelect label={t('fKind')} value={filters.values.kind} onChange={(kind) => filters.set({ kind })} options={[{ value: 'APPOINTMENT', label: t('status.APPOINTMENT') }, { value: 'FOLLOW_UP', label: t('status.FOLLOW_UP') }]} />
        {filters.values.bucket === '' ? <FilterSelect label={t('colStatus')} value={filters.values.status} onChange={(status) => filters.set({ status })} options={['SCHEDULED', 'COMPLETED', 'CANCELLED', 'MISSED'].map((value) => ({ value, label: t(`status.${value}` as 'status.SCHEDULED') }))} /> : null}
        {role !== 'STAFF' ? <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noAppointments')} emptyBody={t('noAppointmentsBody')} />
      {action?.type === 'complete' ? <CompleteDialog row={action.row} onClose={() => setAction(null)} /> : null}
      {action?.type === 'reschedule' ? <RescheduleDialog row={action.row} onClose={() => setAction(null)} /> : null}
      <ConfirmDialog
        open={action?.type === 'cancel'}
        onClose={() => setAction(null)}
        title={t('cancelAppointment')}
        body={action?.row.title}
        confirmLabel={t('cancelAppointment')}
        destructive
        reasonLabel={t('reasonOptional')}
        onConfirm={async (reason) => (await act(() => api.mk.post(`/appointments/${action?.row.id}/cancel`, { reason: reason || undefined }), 'saved')).ok}
      />
      {picking ? <PickLead onClose={() => setPicking(false)} /> : null}
    </Page>
  );
}

function PickLead({ onClose }: { onClose: () => void }) {
  const t = useT();
  const leads = useData<Paged<LeadRow>>('lead-options', '/leads', { pageSize: 100 });
  const [leadId, setLeadId] = useState('');
  if (leadId) return <ScheduleDialog leadId={leadId} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title={t('schedule')} description={t('pickLeadHint')}>
      <SelectField label={t('colBusiness')} value={leadId} onChange={setLeadId} placeholder={t('chooseLead')} options={(leads.data?.items ?? []).map((lead) => ({ value: lead.id, label: lead.businessName }))} />
      <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
    </Modal>
  );
}

function CompleteDialog({ row, onClose }: { row: AppointmentRow; onClose: () => void }) {
  const { api, role } = useConsole();
  const t = useT();
  const act = useAction();
  const [form, setForm] = useState({ outcome: '', nextFollowUpAt: '', status: '' });
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal open onClose={onClose} title={t('complete')} description={row.title}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const result = await act(() => api.mk.post(`/appointments/${row.id}/complete`, { outcome: form.outcome.trim(), nextFollowUpAt: fromLocalInput(form.nextFollowUpAt), status: form.status || undefined }), 'saved');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          <AreaField label={t('fOutcome')} value={form.outcome} onChange={set('outcome')} required maxLength={500} />
          <TextField label={t('fNextFollowUp')} type="datetime-local" value={form.nextFollowUpAt} onChange={set('nextFollowUpAt')} hint={t('fNextFollowUpHint')} />
          <SelectField label={t('fUpdateStatus')} value={form.status} onChange={set('status')} placeholder={t('keepStatus')} options={leadStatusChoices(t, role)} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('complete')} pending={pending} disabled={form.outcome.trim().length < 2} />
      </form>
    </Modal>
  );
}

function RescheduleDialog({ row, onClose }: { row: AppointmentRow; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal open onClose={onClose} title={t('reschedule')} description={row.title}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const result = await act(() => api.mk.post(`/appointments/${row.id}/reschedule`, { scheduledAt: fromLocalInput(when), reason: reason.trim() || undefined }), 'saved');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          <TextField label={t('fScheduledAt')} type="datetime-local" value={when} onChange={setWhen} required />
          <AreaField label={t('reasonOptional')} value={reason} onChange={setReason} maxLength={300} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('reschedule')} pending={pending} disabled={!when} />
      </form>
    </Modal>
  );
}
