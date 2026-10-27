import { Button } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Footprints, Plus, Repeat, Store } from 'lucide-react';
import { useState, type FormEvent, type MouseEvent } from 'react';
import { useConsole } from '../context';
import { formatDateTime, fromLocalInput, toLocalInput } from '../format';
import { useLang, useT, pick, type MessageKey } from '../i18n';
import {
  AreaField, CheckField, DateRange, DetailRow, Drawer, FilterSelect, FormActions, ListView, Modal, Page, QueryBoundary, SearchBox, Section, SelectField, StatusPill, TextField, Toolbar, leadStatusChoices, useAction, useData, useFilters, useList, usePlans, useStaffOptions, type Column, type Paged,
} from '../kit';
import type { LeadDetail, LeadRow, VisitRow } from '../types';

export function LeadsScreen({ params }: { params: Record<string, string> }) {
  const { role, me } = useConsole();
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '', status: params.status ?? '', staffId: '', from: '', to: '', attention: params.attention ?? '', area: '' });
  const query = useList<LeadRow>('leads', '/leads', filters.params);
  const staff = useStaffOptions(role !== 'STAFF');
  const [openId, setOpenId] = useState<string | null>(params.lead ?? null);
  const [creating, setCreating] = useState(false);

  const columns: Column<LeadRow>[] = [
    { key: 'business', header: t('colBusiness'), cell: (row) => <div><p className="font-semibold">{row.businessName}</p><p className="text-xs text-muted-foreground">{row.contactName}</p></div> },
    { key: 'phone', header: t('fPhone'), cell: (row) => <span dir="ltr">{row.phone}</span> },
    { key: 'area', header: t('fArea'), cell: (row) => [row.area, row.city].filter(Boolean).join(', ') || '—' },
    { key: 'status', header: t('colStatus'), cell: (row) => (role === 'STAFF' && row.staffId === me?.id ? <LeadStatusSelect row={row} /> : <StatusPill value={row.status} />) },
    { key: 'follow', header: t('colNextFollowUp'), cell: (row) => formatDateTime(row.nextFollowUpAt, lang) },
    { key: 'appt', header: t('colNextAppointment'), cell: (row) => formatDateTime(row.nextAppointmentAt, lang) },
    { key: 'staff', header: t('colStaffMember'), cell: (row: LeadRow) => row.staffName },
    { key: 'updated', header: t('colUpdated'), cell: (row) => formatDateTime(row.updatedAt, lang) },
  ];

  return (
    <Page
      title={t(role === 'STAFF' ? 'navMyLeads' : role === 'HEAD' ? 'navTeamLeads' : 'leadsTitle')}
      subtitle={t(role === 'STAFF' ? 'leadsSubtitleStaff' : role === 'HEAD' ? 'leadsSubtitle' : 'leadsSubtitleAdmin')}
      actions={role === 'STAFF' ? <Button variant="yellow" onClick={() => setCreating(true)}><Plus className="size-4" />{t('addLead')}</Button> : undefined}
    >
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        <FilterSelect label={t('colStatus')} value={filters.values.status} onChange={(status) => filters.set({ status })} options={leadStatusChoices(t, role).filter((option) => role === 'ADMIN' || option.value !== 'REGISTERED')} />
        {role !== 'STAFF' ? <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
        <CheckField label={t('needsAttention')} checked={filters.values.attention === 'true'} onChange={(checked) => filters.set({ attention: checked ? 'true' : '' })} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} onRowClick={(row) => setOpenId(row.id)} emptyTitle={t('noLeads')} emptyBody={t(role === 'STAFF' ? 'noLeadsStaff' : 'noLeadsBody')} />
      {creating ? <LeadForm lead={null} onClose={() => setCreating(false)} /> : null}
      {openId ? <LeadDrawer id={openId} onClose={() => setOpenId(null)} /> : null}
    </Page>
  );
}

// ---------------------------------------------------------------------------------------------- form

const empty = {
  businessName: '', contactName: '', phone: '', whatsapp: '', email: '', category: '', city: '', area: '', address: '', mapsUrl: '', firstVisitAt: '', interestedPlanId: '', expectedRegistrationAt: '', notes: '', status: 'NEW', nextFollowUpAt: '', nextAppointmentAt: '',
};

function useCategories() {
  const { api } = useConsole();
  return useQuery({ queryKey: ['mk', 'categories'], queryFn: () => api.businessCategories(), staleTime: 60_000 });
}

function categoryOptions(categories: { slug: string; name: { en?: string; ar?: string } }[] | undefined, lang: 'en' | 'ar', current: string) {
  const options = (categories ?? []).map((category) => ({ value: category.name.en || category.slug, label: pick(category.name, lang) }));
  if (current && !options.some((option) => option.value === current)) options.unshift({ value: current, label: current });
  return options;
}

function categoryLabel(categories: { slug: string; name: { en?: string; ar?: string } }[] | undefined, stored: string | null, lang: 'en' | 'ar') {
  if (!stored) return null;
  const match = categories?.find((category) => (category.name.en || category.slug) === stored || category.name.ar === stored || category.slug === stored);
  return match ? pick(match.name, lang) : stored;
}

export function LeadForm({ lead, onClose }: { lead: LeadRow | null; onClose: () => void }) {
  const { api, role } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const plans = usePlans();
  const categories = useCategories();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState(
    lead
      ? { ...empty, businessName: lead.businessName, contactName: lead.contactName, phone: lead.phone, whatsapp: lead.whatsapp ?? '', email: lead.email ?? '', category: lead.category ?? '', city: lead.city ?? '', area: lead.area ?? '', address: lead.address ?? '', mapsUrl: lead.mapsUrl ?? '', firstVisitAt: lead.firstVisitAt ? toLocalInput(lead.firstVisitAt) : '', interestedPlanId: lead.interestedPlanId ?? '', expectedRegistrationAt: lead.expectedRegistrationAt?.slice(0, 10) ?? '', notes: lead.notes ?? '' }
      : empty,
  );
  const set = (key: keyof typeof empty) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const body = {
      businessName: form.businessName.trim(),
      contactName: form.contactName.trim(),
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || null,
      email: form.email.trim() || null,
      category: form.category.trim() || null,
      city: form.city.trim() || null,
      area: form.area.trim() || null,
      address: form.address.trim() || null,
      mapsUrl: form.mapsUrl.trim() || null,
      firstVisitAt: fromLocalInput(form.firstVisitAt),
      interestedPlanId: form.interestedPlanId || null,
      expectedRegistrationAt: form.expectedRegistrationAt || null,
      notes: form.notes.trim() || null,
    };
    const result = await act(
      () => (lead ? api.mk.patch(`/leads/${lead.id}`, body) : api.mk.post('/leads', { ...body, status: form.status, nextFollowUpAt: fromLocalInput(form.nextFollowUpAt), nextAppointmentAt: fromLocalInput(form.nextAppointmentAt) })),
      lead ? 'saved' : 'created',
    );
    setPending(false);
    if (result.ok) onClose();
  }

  return (
    <Modal open onClose={onClose} title={t(lead ? 'editLead' : 'addLead')} description={t('leadFormHint')} wide>
      <form onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('colBusiness')} value={form.businessName} onChange={set('businessName')} required />
          <TextField label={t('fContactName')} value={form.contactName} onChange={set('contactName')} required />
          <TextField label={t('fPhone')} type="tel" value={form.phone} onChange={set('phone')} required dir="ltr" inputMode="tel" />
          <TextField label={t('fWhatsapp')} type="tel" value={form.whatsapp} onChange={set('whatsapp')} dir="ltr" inputMode="tel" />
          <TextField label={t('fEmail')} type="email" value={form.email} onChange={set('email')} dir="ltr" />
          <SelectField label={t('fCategory')} value={form.category} onChange={set('category')} placeholder={t('chooseCategory')} options={categoryOptions(categories.data, lang, form.category)} />
          <TextField label={t('fCity')} value={form.city} onChange={set('city')} />
          <TextField label={t('fArea')} value={form.area} onChange={set('area')} />
          <TextField label={t('fAddress')} value={form.address} onChange={set('address')} className="sm:col-span-2" />
          <TextField label={t('fMapsUrl')} type="url" value={form.mapsUrl} onChange={set('mapsUrl')} dir="ltr" placeholder="https://maps.google.com/…" />
          <TextField label={t('fFirstVisit')} type="datetime-local" value={form.firstVisitAt} onChange={set('firstVisitAt')} />
          <SelectField label={t('fInterestedPlan')} value={form.interestedPlanId} onChange={set('interestedPlanId')} placeholder={t('none')} options={(plans.data ?? []).map((plan) => ({ value: plan.id, label: pick(plan.name, lang) }))} />
          <TextField label={t('fExpectedRegistration')} type="date" value={form.expectedRegistrationAt} onChange={set('expectedRegistrationAt')} />
          {!lead ? (
            <>
              <SelectField label={t('colStatus')} value={form.status} onChange={set('status')} options={leadStatusChoices(t, role)} />
              <TextField label={t('colNextFollowUp')} type="datetime-local" value={form.nextFollowUpAt} onChange={set('nextFollowUpAt')} />
              <TextField label={t('colNextAppointment')} type="datetime-local" value={form.nextAppointmentAt} onChange={set('nextAppointmentAt')} />
            </>
          ) : null}
        </div>
        <div className="mt-4"><AreaField label={t('fNotes')} value={form.notes} onChange={set('notes')} maxLength={2000} /></div>
        <FormActions onCancel={onClose} submitLabel={t(lead ? 'save' : 'create')} pending={pending} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- drawer

type Dialog = 'edit' | 'status' | 'note' | 'visit' | 'schedule' | 'reassign' | null;

function LeadDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { api, role, me, navigate } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const query = useData<LeadDetail>('lead', `/leads/${id}`);
  const categories = useCategories();
  const [dialog, setDialog] = useState<Dialog>(null);
  const canReassign = role === 'ADMIN' || (role === 'HEAD' && Boolean(me?.capabilities.headsCanReassignLeads));
  const closed = (status: string) => ['REGISTERED', 'NOT_INTERESTED', 'CLOSED_LOST'].includes(status);

  return (
    <Drawer open onClose={onClose} title={query.data?.businessName ?? t('loading')} subtitle={query.data ? <span className="flex items-center gap-2"><StatusPill value={query.data.status} />{query.data.staffName}</span> : undefined}>
      <QueryBoundary query={query}>
        {(lead) => (
          <>
            {role === 'STAFF' && lead.staffId === me?.id ? (
              <div className="flex flex-wrap gap-2">
                {lead.status !== 'REGISTERED' ? <Button size="sm" variant="outline" onClick={() => setDialog('status')}>{t('changeStatus')}</Button> : null}
                <Button size="sm" variant="outline" onClick={() => setDialog('edit')}>{t('edit')}</Button>
                {!lead.merchantId && !closed(lead.status) ? <Button size="sm" variant="yellow" onClick={() => navigate('stores', { leadId: lead.id })}><Store className="size-4" />{t('convertToStore')}</Button> : null}
              </div>
            ) : canReassign && (role === 'ADMIN' || lead.headId === me?.id) ? (
              <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDialog('reassign')}><Repeat className="size-4" />{t('reassign')}</Button></div>
            ) : null}
            <dl className="divide-y">
              <DetailRow label={t('fContactName')}>{lead.contactName}</DetailRow>
              <DetailRow label={t('fPhone')}><span dir="ltr">{lead.phone}</span></DetailRow>
              <DetailRow label={t('fWhatsapp')}><span dir="ltr">{lead.whatsapp}</span></DetailRow>
              <DetailRow label={t('fEmail')}><span dir="ltr">{lead.email}</span></DetailRow>
              <DetailRow label={t('fCategory')}>{categoryLabel(categories.data, lead.category, lang)}</DetailRow>
              <DetailRow label={t('fArea')}>{[lead.area, lead.city].filter(Boolean).join(', ')}</DetailRow>
              <DetailRow label={t('fAddress')}>{lead.address}</DetailRow>
              <DetailRow label={t('fMapsUrl')}>{lead.mapsUrl ? <a className="inline-flex items-center gap-1 underline" href={lead.mapsUrl} target="_blank" rel="noreferrer noopener">{t('openMap')}<ExternalLink className="size-3" /></a> : null}</DetailRow>
              <DetailRow label={t('fFirstVisit')}>{formatDateTime(lead.firstVisitAt, lang)}</DetailRow>
              <DetailRow label={t('fInterestedPlan')}>{lead.interestedPlanName}</DetailRow>
              <DetailRow label={t('fExpectedRegistration')}>{lead.expectedRegistrationAt ? formatDateTime(lead.expectedRegistrationAt, lang) : null}</DetailRow>
              <DetailRow label={t('colNextFollowUp')}>{formatDateTime(lead.nextFollowUpAt, lang)}</DetailRow>
              <DetailRow label={t('colNextAppointment')}>{formatDateTime(lead.nextAppointmentAt, lang)}</DetailRow>
              <DetailRow label={t('colStaffMember')}>{lead.staffName}</DetailRow>
              <DetailRow label={t('colHead')}>{lead.headName}</DetailRow>
              {lead.notes ? <DetailRow label={t('fNotes')}>{lead.notes}</DetailRow> : null}
            </dl>
            <Section title={t('visitsTitle')}>
              {lead.visits.length ? (
                <ul className="space-y-2 text-sm">
                  {lead.visits.map((visit) => (
                    <li key={visit.id} className="rounded-xl bg-muted px-3 py-2">
                      <p className="font-medium">{formatDateTime(visit.visitedAt, lang)}{visit.outcome ? ` · ${visit.outcome}` : ''}</p>
                      {visit.notes ? <p className="text-muted-foreground">{visit.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">{t('noVisits')}</p>}
            </Section>
            <Section title={t('appointmentsTitle')}>
              {lead.appointments.length ? (
                <ul className="space-y-2 text-sm">
                  {lead.appointments.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
                      <span className="min-w-0 truncate font-medium">{row.title}</span>
                      <span className="flex shrink-0 items-center gap-2"><StatusPill value={row.kind} /><StatusPill value={row.status} overdue={row.overdue} />{formatDateTime(row.scheduledAt, lang)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">{t('noAppointments')}</p>}
            </Section>
            <Section title={t('historyTitle')}>
              <ol className="space-y-3 border-s ps-4">
                {lead.history.map((entry) => (
                  <li key={entry.id} className="relative text-sm">
                    <span className="absolute -start-[21px] top-1.5 size-2.5 rounded-full bg-primary" />
                    <p className="font-medium">{entry.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.toStatus ? `${t(`status.${entry.fromStatus ?? 'NEW'}` as MessageKey)} → ${t(`status.${entry.toStatus}` as MessageKey)} · ` : ''}
                      {entry.authorName} · {formatDateTime(entry.at, lang)}
                    </p>
                  </li>
                ))}
              </ol>
            </Section>
            {dialog === 'edit' ? <LeadForm lead={lead} onClose={() => setDialog(null)} /> : null}
            {dialog === 'status' ? <StatusChange lead={lead} onClose={() => setDialog(null)} /> : null}
            {dialog === 'note' ? <NoteDialog title={t('addNote')} onClose={() => setDialog(null)} onSave={(body) => act(() => api.mk.post(`/leads/${lead.id}/notes`, { body }), 'saved')} /> : null}
            {dialog === 'visit' ? <VisitDialog leadId={lead.id} onClose={() => setDialog(null)} /> : null}
            {dialog === 'schedule' ? <ScheduleDialog leadId={lead.id} onClose={() => setDialog(null)} /> : null}
            {dialog === 'reassign' ? <ReassignDialog lead={lead} onClose={() => setDialog(null)} /> : null}
          </>
        )}
      </QueryBoundary>
    </Drawer>
  );
}

function LeadStatusSelect({ row }: { row: LeadRow }) {
  const { api, role } = useConsole();
  const t = useT();
  const act = useAction();
  const [pending, setPending] = useState(false);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <select
      aria-label={t('colStatus')}
      className="h-9 max-w-52 rounded-xl border border-input bg-card px-2 text-sm outline-none ring-ring focus:ring-2 disabled:opacity-60"
      value={row.status}
      disabled={pending || row.status === 'REGISTERED'}
      onClick={stop}
      onMouseDown={stop}
      onKeyDown={(event) => event.stopPropagation()}
      onChange={async (event) => {
        event.stopPropagation();
        const status = event.target.value;
        if (status === row.status) return;
        setPending(true);
        await act(() => api.mk.post(`/leads/${row.id}/status`, { status }), 'saved');
        setPending(false);
      }}
    >
      {leadStatusChoices(t, role, row.status).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function StatusChange({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const { api, role } = useConsole();
  const t = useT();
  const act = useAction();
  const [status, setStatus] = useState(lead.status);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal open onClose={onClose} title={t('changeStatus')}>
      <form onSubmit={async (event) => { event.preventDefault(); setPending(true); const result = await act(() => api.mk.post(`/leads/${lead.id}/status`, { status, note: note.trim() || undefined }), 'saved'); setPending(false); if (result.ok) onClose(); }}>
        <div className="space-y-4">
          <SelectField label={t('colStatus')} value={status} onChange={setStatus} options={leadStatusChoices(t, role, lead.status)} />
          <AreaField label={t('reasonOptional')} value={note} onChange={setNote} maxLength={500} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('save')} pending={pending} disabled={status === lead.status} />
      </form>
    </Modal>
  );
}

export function NoteDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (body: string) => Promise<{ ok: boolean }> }) {
  const t = useT();
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <Modal open onClose={onClose} title={title}>
      <form onSubmit={async (event) => { event.preventDefault(); setPending(true); const result = await onSave(body.trim()); setPending(false); if (result.ok) onClose(); }}>
        <AreaField label={t('fNote')} value={body} onChange={setBody} required maxLength={2000} />
        <FormActions onCancel={onClose} submitLabel={t('save')} pending={pending} disabled={body.trim().length < 2} />
      </form>
    </Modal>
  );
}

export function VisitDialog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { api, role } = useConsole();
  const t = useT();
  const act = useAction();
  const [form, setForm] = useState({ visitedAt: toLocalInput(null), outcome: '', notes: '', status: '' });
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal open onClose={onClose} title={t('recordVisit')} description={t('recordVisitHint')}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const result = await act(() => api.mk.post(`/leads/${leadId}/visits`, { visitedAt: fromLocalInput(form.visitedAt), outcome: form.outcome.trim() || null, notes: form.notes.trim() || null, status: form.status || undefined }), 'saved');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          <TextField label={t('fVisitedAt')} type="datetime-local" value={form.visitedAt} onChange={set('visitedAt')} required />
          <TextField label={t('fOutcome')} value={form.outcome} onChange={set('outcome')} maxLength={200} />
          <AreaField label={t('fNotes')} value={form.notes} onChange={set('notes')} maxLength={2000} />
          <SelectField label={t('fUpdateStatus')} value={form.status} onChange={set('status')} placeholder={t('keepStatus')} options={leadStatusChoices(t, role)} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('save')} pending={pending} />
      </form>
    </Modal>
  );
}

export function ScheduleDialog({ leadId, onClose, defaultKind }: { leadId: string; onClose: () => void; defaultKind?: 'APPOINTMENT' | 'FOLLOW_UP' }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const [form, setForm] = useState({ kind: defaultKind ?? 'APPOINTMENT', title: '', scheduledAt: '', notes: '' });
  const [pending, setPending] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal open onClose={onClose} title={t('schedule')} description={t('scheduleHint')}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const result = await act(() => api.mk.post('/appointments', { leadId, kind: form.kind, title: form.title.trim() || null, scheduledAt: fromLocalInput(form.scheduledAt), notes: form.notes.trim() || null }), 'created');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          <SelectField label={t('fKind')} value={form.kind} onChange={set('kind')} options={[{ value: 'APPOINTMENT', label: t('status.APPOINTMENT') }, { value: 'FOLLOW_UP', label: t('status.FOLLOW_UP') }]} />
          <TextField label={t('fTitle')} value={form.title} onChange={set('title')} maxLength={160} />
          <TextField label={t('fScheduledAt')} type="datetime-local" value={form.scheduledAt} onChange={set('scheduledAt')} required />
          <AreaField label={t('fNotes')} value={form.notes} onChange={set('notes')} maxLength={1000} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('schedule')} pending={pending} disabled={!form.scheduledAt} />
      </form>
    </Modal>
  );
}

function ReassignDialog({ lead, onClose }: { lead: LeadRow; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const staff = useStaffOptions();
  const [target, setTarget] = useState('');
  return (
    <Modal open onClose={onClose} title={t('reassign')} description={t('reassignHint')}>
      <form onSubmit={async (event) => { event.preventDefault(); const result = await act(() => api.mk.post(`/leads/${lead.id}/reassign`, { staffUserId: target }), 'saved'); if (result.ok) onClose(); }}>
        <SelectField label={t('colStaffMember')} value={target} onChange={setTarget} required placeholder={t('chooseStaff')} options={(staff.data?.items ?? []).filter((row) => row.id !== lead.staffId && row.status === 'ACTIVE').map((row) => ({ value: row.id, label: row.fullName }))} />
        <FormActions onCancel={onClose} submitLabel={t('reassign')} disabled={!target} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- visits

export function VisitsScreen() {
  const { role } = useConsole();
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '', staffId: '', from: '', to: '' });
  const query = useList<VisitRow>('visits', '/visits', filters.params);
  const staff = useStaffOptions(role !== 'STAFF');
  const [recording, setRecording] = useState(false);
  const columns: Column<VisitRow>[] = [
    { key: 'when', header: t('fVisitedAt'), cell: (row) => formatDateTime(row.visitedAt, lang) },
    { key: 'biz', header: t('colBusiness'), cell: (row) => <div><p className="font-semibold">{row.businessName}</p><p className="text-xs text-muted-foreground">{row.area ?? ''}</p></div> },
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.leadStatus} /> },
    { key: 'outcome', header: t('fOutcome'), cell: (row) => row.outcome ?? '—' },
    { key: 'notes', header: t('fNotes'), cell: (row) => <span className="line-clamp-2 max-w-xs">{row.notes ?? '—'}</span> },
    ...(role !== 'STAFF' ? [{ key: 'staff', header: t('colStaffMember'), cell: (row: VisitRow) => row.staffName }] : []),
  ];
  return (
    <Page title={t('visitsPageTitle')} subtitle={t('visitsPageSubtitle')} actions={role === 'STAFF' ? <Button variant="yellow" onClick={() => setRecording(true)}><Footprints className="size-4" />{t('recordVisit')}</Button> : undefined}>
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        {role !== 'STAFF' ? <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noVisits')} emptyBody={t('noVisitsBody')} />
      {recording ? <PickLeadVisit onClose={() => setRecording(false)} /> : null}
    </Page>
  );
}

function PickLeadVisit({ onClose }: { onClose: () => void }) {
  const t = useT();
  const leads = useData<Paged<LeadRow>>('lead-options', '/leads', { pageSize: 100 });
  const [leadId, setLeadId] = useState('');
  if (leadId) return <VisitDialog leadId={leadId} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title={t('recordVisit')} description={t('pickLeadHint')}>
      <SelectField label={t('colBusiness')} value={leadId} onChange={setLeadId} placeholder={t('chooseLead')} options={(leads.data?.items ?? []).map((lead) => ({ value: lead.id, label: lead.businessName }))} />
      <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={onClose}>{t('cancel')}</Button></div>
    </Modal>
  );
}

