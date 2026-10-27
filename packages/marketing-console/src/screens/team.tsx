import { Button } from '@alliva/ui';
import { KeyRound, Plus, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useConsole } from '../context';
import { formatDate, formatMoney, formatNumber, toDateInput } from '../format';
import { useLang, useT } from '../i18n';
import {
  AreaField, CommissionRate, CopyButton, DataTable, DetailRow, Drawer, FilterSelect, FormActions, ListView, Modal, Page, QueryBoundary, SearchBox, Section, SelectField, StatusPill, TextField, Toolbar, useAction, useData, useFilters, useList, type Column, type Paged,
} from '../kit';
import type { MemberDetail, MemberRow } from '../types';

const STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;

export function MembersScreen({ kind }: { kind: 'HEAD' | 'STAFF' }) {
  const { role } = useConsole();
  const t = useT();
  const lang = useLang();
  const admin = role === 'ADMIN';
  const filters = useFilters({ q: '', status: '', headId: '' });
  const query = useList<MemberRow>(kind === 'HEAD' ? 'heads' : 'staff', kind === 'HEAD' ? '/heads' : '/staff', filters.params);
  const heads = useData<Paged<MemberRow>>('heads-all', '/heads', { pageSize: 100 }, admin);
  const [editing, setEditing] = useState<MemberRow | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  const columns: Column<MemberRow>[] = [
    { key: 'name', header: t('colName'), cell: (row) => <div><p className="font-semibold">{row.fullName}</p><p className="text-xs text-muted-foreground">{row.employeeId ?? '—'} · {row.email}</p></div> },
    ...(kind === 'STAFF' ? [{ key: 'head', header: t('colHead'), cell: (row: MemberRow) => row.headName || '—' }] : [{ key: 'region', header: t('colRegion'), cell: (row: MemberRow) => row.region ?? '—' }]),
    ...(kind === 'STAFF' ? [{ key: 'code', header: t('colReferralCode'), cell: (row: MemberRow) => <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{row.referralCode ?? '—'}</code> }] : [{ key: 'staff', header: t('colStaff'), cell: (row: MemberRow) => formatNumber(row.stats?.staffCount, lang) }]),
    { key: 'leads', header: t('colLeads'), cell: (row) => formatNumber(row.stats?.leads, lang) },
    { key: 'stores', header: t('colStores'), cell: (row) => formatNumber(row.stats?.referredStores, lang) },
    ...(admin || kind === 'STAFF' ? [{ key: 'earned', header: t('colEarned'), cell: (row: MemberRow) => (row.stats?.earned == null ? '—' : formatMoney(row.stats.earned, lang)) }] : []),
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.status} /> },
  ];

  return (
    <Page
      title={t(kind === 'HEAD' ? 'headsTitle' : 'staffTitle')}
      subtitle={t(kind === 'HEAD' ? 'headsSubtitle' : role === 'HEAD' ? 'staffSubtitleHead' : 'staffSubtitle')}
      actions={admin ? <Button variant="yellow" onClick={() => setEditing('new')}><Plus className="size-4" />{t(kind === 'HEAD' ? 'addHead' : 'addStaff')}</Button> : undefined}
    >
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        <FilterSelect label={t('colStatus')} value={filters.values.status} onChange={(status) => filters.set({ status })} options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
        {admin && kind === 'STAFF' ? <FilterSelect label={t('colHead')} value={filters.values.headId} onChange={(headId) => filters.set({ headId })} options={(heads.data?.items ?? []).map((head) => ({ value: head.id, label: head.fullName }))} /> : null}
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} onRowClick={(row) => setOpenId(row.id)} emptyTitle={t(kind === 'HEAD' ? 'noHeads' : 'noStaff')} emptyBody={t('noMembersBody')} />
      {editing ? <MemberForm kind={kind} member={editing === 'new' ? null : editing} heads={heads.data?.items ?? []} onClose={() => setEditing(null)} onInvite={setInvite} /> : null}
      {openId ? <MemberDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(row) => { setOpenId(null); setEditing(row); }} onInvite={setInvite} heads={heads.data?.items ?? []} /> : null}
      <InviteDialog token={invite} onClose={() => setInvite(null)} />
    </Page>
  );
}

function MemberForm({ kind, member, heads, onClose, onInvite }: { kind: 'HEAD' | 'STAFF'; member: MemberRow | null; heads: MemberRow[]; onClose: () => void; onInvite: (token: string) => void }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    fullName: member?.fullName ?? '',
    employeeId: member?.employeeId ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    password: '',
    region: member?.region ?? '',
    commissionPercent: member?.commissionPercent ?? '',
    joinedAt: toDateInput(member?.joinedAt),
    notes: member?.notes ?? '',
    headUserId: member?.headUserId ?? heads.find((head) => head.status === 'ACTIVE')?.id ?? '',
    referralCode: '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const editing = Boolean(member);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const base = {
      fullName: form.fullName.trim(),
      employeeId: form.employeeId.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      region: form.region.trim() || null,
      commissionPercent: form.commissionPercent.trim() || null,
      joinedAt: form.joinedAt || null,
      notes: form.notes.trim() || null,
    };
    const result = await act(
      () =>
        member
          ? api.mk.patch(`/members/${member.id}`, base)
          : api.mk.post<{ inviteToken: string | null }>(kind === 'HEAD' ? '/heads' : '/staff', {
              ...base,
              password: form.password || null,
              ...(kind === 'STAFF' ? { headUserId: form.headUserId, referralCode: form.referralCode.trim() || null } : {}),
            }),
      editing ? 'saved' : 'created',
    );
    setPending(false);
    if (!result.ok) return;
    const token = (result.data as { inviteToken?: string | null } | undefined)?.inviteToken;
    if (token) onInvite(token);
    onClose();
  }

  const title = editing ? t(kind === 'HEAD' ? 'editHead' : 'editStaff') : t(kind === 'HEAD' ? 'addHead' : 'addStaff');
  return (
    <Modal open onClose={onClose} title={title} description={t(kind === 'STAFF' && !editing ? 'staffFormHint' : 'memberFormHint')} wide>
      <form onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('fFullName')} value={form.fullName} onChange={set('fullName')} required />
          <TextField label={t('fEmployeeId')} value={form.employeeId} onChange={set('employeeId')} required />
          <TextField label={t('fEmail')} type="email" value={form.email} onChange={set('email')} required dir="ltr" />
          <TextField label={t('fPhone')} type="tel" value={form.phone} onChange={set('phone')} dir="ltr" inputMode="tel" />
          {!editing ? <TextField label={t('fPassword')} type="password" value={form.password} onChange={set('password')} hint={t('fPasswordHint')} /> : null}
          <TextField label={t('fRegion')} value={form.region} onChange={set('region')} />
          <TextField label={kind === 'HEAD' ? t('fHeadPercent') : t('fStaffPercent')} value={form.commissionPercent} onChange={set('commissionPercent')} inputMode="decimal" placeholder={t('fPercentDefault')} hint={t('fPercentHint')} />
          <TextField label={t('fJoinedAt')} type="date" value={form.joinedAt} onChange={set('joinedAt')} />
          {kind === 'STAFF' && !editing ? (
            <>
              <SelectField label={t('colHead')} value={form.headUserId} onChange={set('headUserId')} required options={heads.filter((head) => head.status === 'ACTIVE').map((head) => ({ value: head.id, label: head.fullName }))} placeholder={t('chooseHead')} />
              <TextField label={t('fReferralCode')} value={form.referralCode} onChange={(value) => set('referralCode')(value.toUpperCase())} hint={t('fReferralHint')} dir="ltr" maxLength={32} />
            </>
          ) : null}
        </div>
        <div className="mt-4"><AreaField label={t('fNotes')} value={form.notes} onChange={set('notes')} maxLength={1000} /></div>
        <FormActions onCancel={onClose} submitLabel={editing ? t('save') : t('create')} pending={pending} />
      </form>
    </Modal>
  );
}

export function InviteDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const { inviteUrl } = useConsole();
  const t = useT();
  if (!token) return null;
  const link = `${inviteUrl}${inviteUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  return (
    <Modal open onClose={onClose} title={t('inviteTitle')} description={t('inviteBody')}>
      <div className="space-y-3">
        <code className="block break-all rounded-xl bg-muted p-3 text-xs" dir="ltr">{link}</code>
        <div className="flex justify-end gap-2"><CopyButton text={link} label={t('copyLink')} /><Button variant="yellow" onClick={onClose}>{t('done')}</Button></div>
      </div>
    </Modal>
  );
}

function MemberDrawer({ id, onClose, onEdit, onInvite, heads }: { id: string; onClose: () => void; onEdit: (row: MemberRow) => void; onInvite: (token: string) => void; heads: MemberRow[] }) {
  const { api, role } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const query = useData<MemberDetail>('member', `/staff/${id}`, undefined, true);
  const [dialog, setDialog] = useState<'status' | 'transfer' | 'code' | null>(null);
  const [nextStatus, setNextStatus] = useState<'ACTIVE' | 'INACTIVE' | 'SUSPENDED'>('INACTIVE');
  const [headId, setHeadId] = useState('');
  const [code, setCode] = useState('');
  const admin = role === 'ADMIN';

  return (
    <Drawer open onClose={onClose} title={query.data?.fullName ?? t('loading')} subtitle={query.data ? <span className="flex items-center gap-2"><StatusPill value={query.data.status} />{t(query.data.kind === 'HEAD' ? 'roleHead' : 'roleStaff')}</span> : undefined}>
      <QueryBoundary query={query}>
        {(member) => (
          <>
            <dl className="divide-y">
              <DetailRow label={t('fEmployeeId')}>{member.employeeId}</DetailRow>
              <DetailRow label={t('fEmail')}><span dir="ltr">{member.email}</span></DetailRow>
              <DetailRow label={t('fPhone')}><span dir="ltr">{member.phone}</span></DetailRow>
              <DetailRow label={t('fRegion')}>{member.region}</DetailRow>
              <DetailRow label={t('fJoinedAt')}>{formatDate(member.joinedAt, lang)}</DetailRow>
              {member.kind === 'STAFF' ? <DetailRow label={t('colHead')}>{member.headName}</DetailRow> : null}
              <DetailRow label={t('colCommissionRate')}><CommissionRate percent={member.effectiveCommissionPercent ?? member.commissionPercent} isDefault={member.commissionIsDefault} /></DetailRow>
              {member.notes ? <DetailRow label={t('fNotes')}>{member.notes}</DetailRow> : null}
            </dl>
            {member.stats ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MiniStat label={t('colLeads')} value={formatNumber(member.stats.leads, lang)} />
                <MiniStat label={t('colStores')} value={formatNumber(member.stats.referredStores, lang)} />
                <MiniStat label={t('colEarned')} value={member.stats.earned == null ? '—' : formatMoney(member.stats.earned, lang)} />
                <MiniStat label={t('walletAvailable')} value={member.stats.walletBalance == null ? '—' : formatMoney(member.stats.walletBalance, lang)} />
              </div>
            ) : null}
            {member.kind === 'STAFF' ? (
              <Section title={t('referralCodes')} subtitle={t('referralCodesSubtitle')}>
                <ul className="space-y-2">
                  {member.referralCodes.map((entry) => (
                    <li key={entry.code} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                      <code className="font-semibold">{entry.code}</code>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">{formatDate(entry.createdAt, lang)}<StatusPill value={entry.active ? 'ACTIVE' : entry.retiredAt ? 'EXPIRED' : 'INACTIVE'} /></span>
                    </li>
                  ))}
                  {!member.referralCodes.length ? <li className="text-sm text-muted-foreground">{t('noReferralCode')}</li> : null}
                </ul>
              </Section>
            ) : (
              <Section title={t('teamTitle')}>
                <DataTable
                  columns={[
                    { key: 'n', header: t('colName'), cell: (row: MemberRow) => row.fullName },
                    { key: 'l', header: t('colLeads'), cell: (row: MemberRow) => formatNumber(row.stats?.leads, lang) },
                    { key: 's', header: t('colStores'), cell: (row: MemberRow) => formatNumber(row.stats?.referredStores, lang) },
                    { key: 'st', header: t('colStatus'), cell: (row: MemberRow) => <StatusPill value={row.status} /> },
                  ]}
                  rows={member.team}
                  rowKey={(row) => row.id}
                  emptyTitle={t('noStaff')}
                  emptyBody={t('noMembersBody')}
                />
              </Section>
            )}
            {admin ? (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" size="sm" onClick={() => onEdit(member)}>{t('edit')}</Button>
                <Button variant="outline" size="sm" onClick={() => { setNextStatus(member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'); setDialog('status'); }}>{t('changeStatus')}</Button>
                <Button variant="outline" size="sm" onClick={async () => { const result = await act(() => api.mk.post<{ inviteToken: string }>(`/members/${member.id}/invite`)); if (result.ok) onInvite(result.data.inviteToken); }}><KeyRound className="size-4" />{t('newInvite')}</Button>
                {member.kind === 'STAFF' ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setHeadId(''); setDialog('transfer'); }}><RefreshCw className="size-4" />{t('transfer')}</Button>
                    <Button variant="outline" size="sm" onClick={() => { setCode(''); setDialog('code'); }}>{t('changeCode')}</Button>
                    {member.referralCode ? (
                      <Button variant="outline" size="sm" onClick={async () => { const active = member.referralCodes.find((entry) => entry.code === member.referralCode)?.active ?? true; await act(() => api.mk.post(`/staff/${member.id}/referral-active`, { active: !active }), 'saved'); }}>
                        {t('toggleCode')}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            <StatusDialog open={dialog === 'status'} onClose={() => setDialog(null)} member={member} status={nextStatus} setStatus={setNextStatus} />
            <Modal open={dialog === 'transfer'} onClose={() => setDialog(null)} title={t('transferTitle')} description={t('transferBody')}>
              <form onSubmit={async (event) => { event.preventDefault(); const result = await act(() => api.mk.post(`/staff/${member.id}/transfer`, { headUserId: headId }), 'saved'); if (result.ok) setDialog(null); }}>
                <SelectField label={t('colHead')} value={headId} onChange={setHeadId} required placeholder={t('chooseHead')} options={heads.filter((head) => head.status === 'ACTIVE' && head.id !== member.headUserId).map((head) => ({ value: head.id, label: head.fullName }))} />
                <FormActions onCancel={() => setDialog(null)} submitLabel={t('transfer')} disabled={!headId} />
              </form>
            </Modal>
            <Modal open={dialog === 'code'} onClose={() => setDialog(null)} title={t('changeCode')} description={t('changeCodeBody')}>
              <form onSubmit={async (event) => { event.preventDefault(); const result = await act(() => api.mk.post(`/staff/${member.id}/referral-code`, { code }), 'saved'); if (result.ok) setDialog(null); }}>
                <TextField label={t('fReferralCode')} value={code} onChange={(value) => setCode(value.toUpperCase())} required dir="ltr" maxLength={32} />
                <FormActions onCancel={() => setDialog(null)} submitLabel={t('save')} disabled={code.length < 3} />
              </form>
            </Modal>
          </>
        )}
      </QueryBoundary>
    </Drawer>
  );
}

function StatusDialog({ open, onClose, member, status, setStatus }: { open: boolean; onClose: () => void; member: MemberRow; status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; setStatus: (status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') => void }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  return (
    <Modal open={open} onClose={onClose} title={t('changeStatus')} description={t('changeStatusBody')}>
      <div className="mb-3"><SelectField label={t('colStatus')} value={status} onChange={(value) => setStatus(value as typeof status)} options={STATUSES.filter((s) => s !== member.status).map((s) => ({ value: s, label: t(`status.${s}`) }))} /></div>
      <ConfirmDialogInline
        onCancel={onClose}
        onConfirm={async (reason) => {
          const result = await act(() => api.mk.post(`/members/${member.id}/status`, { status, reason: reason || undefined }), 'saved');
          if (result.ok) onClose();
        }}
      />
    </Modal>
  );
}

function ConfirmDialogInline({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <form onSubmit={async (event) => { event.preventDefault(); setPending(true); await onConfirm(reason.trim()); setPending(false); }}>
      <AreaField label={t('reasonOptional')} value={reason} onChange={setReason} maxLength={300} />
      <FormActions onCancel={onCancel} submitLabel={t('confirm')} pending={pending} />
    </form>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

