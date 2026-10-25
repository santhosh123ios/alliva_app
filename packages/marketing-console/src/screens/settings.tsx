import { Button } from '@alliva/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { useConsole } from '../context';
import { useT } from '../i18n';
import { AreaField, CheckField, Page, QueryBoundary, Section, SelectField, TextField, useAction, useData } from '../kit';
import { LEAD_STATUSES, type SettingsData } from '../types';

type Form = {
  staffPercent: string;
  headPercent: string;
  commissionBase: string;
  approval: string;
  holdDays: string;
  referralPrefix: string;
  autoGenerateReferral: boolean;
  referralValidation: boolean;
  followUpAlerts: boolean;
  reminderOffsets: string;
  overdueAlertHours: string;
  notifyHead: boolean;
  cadence: string;
  minWithdrawal: string;
  payoutMethods: string;
  withdrawalApproval: string;
  withdrawalActiveOnly: boolean;
  termsEn: string;
  termsAr: string;
  allowStaffTransfer: boolean;
  headsCanReassignLeads: boolean;
  headsSeeReports: boolean;
  labels: Record<string, { en: string; ar: string }>;
};

const toForm = (data: SettingsData): Form => ({
  staffPercent: data.staffPercent,
  headPercent: data.headPercent,
  commissionBase: data.commissionBase,
  approval: data.approval,
  holdDays: String(data.holdDays),
  referralPrefix: data.referralPrefix,
  autoGenerateReferral: data.autoGenerateReferral,
  referralValidation: data.referralValidation,
  followUpAlerts: data.followUpAlerts,
  reminderOffsets: data.reminderOffsets.join(', '),
  overdueAlertHours: String(data.overdueAlertHours),
  notifyHead: data.notifyHead,
  cadence: data.cadence,
  minWithdrawal: data.minWithdrawal,
  payoutMethods: data.payoutMethods.join(', '),
  withdrawalApproval: data.withdrawalApproval,
  withdrawalActiveOnly: data.withdrawalActiveOnly,
  termsEn: data.terms.en,
  termsAr: data.terms.ar,
  allowStaffTransfer: data.allowStaffTransfer,
  headsCanReassignLeads: data.headsCanReassignLeads,
  headsSeeReports: data.headsSeeReports,
  labels: data.leadStatusLabels,
});

const list = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

/** Only the fields the admin actually changed are sent, so an untouched setting is never rewritten (or audited). */
function diff(before: SettingsData, form: Form) {
  const patch: Record<string, unknown> = {};
  const set = (key: string, next: unknown, current: unknown) => {
    if (JSON.stringify(next) !== JSON.stringify(current)) patch[key] = next;
  };
  const fixed = (value: string) => (Number.isFinite(Number(value)) && value.trim() !== '' ? Number(value).toFixed(3) : value);
  set('staffPercent', fixed(form.staffPercent), before.staffPercent);
  set('headPercent', fixed(form.headPercent), before.headPercent);
  set('commissionBase', form.commissionBase, before.commissionBase);
  set('approval', form.approval, before.approval);
  set('holdDays', Number(form.holdDays), before.holdDays);
  set('referralPrefix', form.referralPrefix.trim().toUpperCase(), before.referralPrefix);
  set('autoGenerateReferral', form.autoGenerateReferral, before.autoGenerateReferral);
  set('referralValidation', form.referralValidation, before.referralValidation);
  set('followUpAlerts', form.followUpAlerts, before.followUpAlerts);
  set('reminderOffsets', list(form.reminderOffsets).map(Number), before.reminderOffsets);
  set('overdueAlertHours', Number(form.overdueAlertHours), before.overdueAlertHours);
  set('notifyHead', form.notifyHead, before.notifyHead);
  set('cadence', form.cadence, before.cadence);
  set('minWithdrawal', fixed(form.minWithdrawal), before.minWithdrawal);
  set('payoutMethods', list(form.payoutMethods).map((method) => method.toUpperCase().replace(/\s+/g, '_')), before.payoutMethods);
  set('withdrawalApproval', form.withdrawalApproval, before.withdrawalApproval);
  set('withdrawalActiveOnly', form.withdrawalActiveOnly, before.withdrawalActiveOnly);
  set('terms', { en: form.termsEn, ar: form.termsAr }, before.terms);
  set('allowStaffTransfer', form.allowStaffTransfer, before.allowStaffTransfer);
  set('headsCanReassignLeads', form.headsCanReassignLeads, before.headsCanReassignLeads);
  set('headsSeeReports', form.headsSeeReports, before.headsSeeReports);
  set('leadStatusLabels', form.labels, before.leadStatusLabels);
  return patch;
}

export function SettingsScreen() {
  const t = useT();
  const query = useData<SettingsData>('settings', '/settings');
  return (
    <Page title={t('settingsTitle')} subtitle={t('settingsSubtitle')}>
      <QueryBoundary query={query}>{(data) => <SettingsForm key={JSON.stringify(data)} data={data} />}</QueryBoundary>
    </Page>
  );
}

function SettingsForm({ data }: { data: SettingsData }) {
  const { api } = useConsole();
  const t = useT();
  const act = useAction();
  const [form, setForm] = useState<Form>(toForm(data));
  const [pending, setPending] = useState(false);
  useEffect(() => setForm(toForm(data)), [data]);
  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const patch = diff(data, form);
  const changed = Object.keys(patch).length;
  const financial = ['staffPercent', 'headPercent', 'commissionBase', 'approval', 'holdDays', 'cadence', 'minWithdrawal', 'payoutMethods', 'withdrawalApproval', 'withdrawalActiveOnly'].some((key) => key in patch);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    await act(() => api.mk.patch('/settings', patch as never), 'saved');
    setPending(false);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section title={t('setCommission')} subtitle={t('setCommissionHint')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label={t('setStaffPercent')} value={form.staffPercent} onChange={set('staffPercent')} inputMode="decimal" dir="ltr" />
          <TextField label={t('setHeadPercent')} value={form.headPercent} onChange={set('headPercent')} inputMode="decimal" dir="ltr" />
          <SelectField label={t('setBase')} value={form.commissionBase} onChange={set('commissionBase')} options={[{ value: 'NET_PAID', label: t('baseNetPaid') }, { value: 'NET_EXCLUDING_TAX', label: t('baseNetExTax', { tax: data.taxPercent }) }]} />
          <SelectField label={t('setApproval')} value={form.approval} onChange={set('approval')} options={[{ value: 'AUTO', label: t('approvalAuto') }, { value: 'MANUAL', label: t('approvalManual') }, { value: 'HOLD_DAYS', label: t('approvalHold') }]} />
          {form.approval === 'HOLD_DAYS' ? <TextField label={t('setHoldDays')} value={form.holdDays} onChange={set('holdDays')} inputMode="numeric" dir="ltr" /> : null}
        </div>
        <div className="mt-4 space-y-2">
          <CheckField label={t('setFirstPaymentOnly')} hint={t('setFirstPaymentOnlyHint')} checked disabled onChange={() => undefined} />
          <p className="text-xs text-muted-foreground">{t('setRefundPolicy')}</p>
        </div>
        <p className="mt-3 rounded-xl bg-[#fff4cc] p-3 text-xs">{t('setRateSnapshotNote')}</p>
      </Section>

      <Section title={t('setReferral')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('setPrefix')} value={form.referralPrefix} onChange={(value) => set('referralPrefix')(value.toUpperCase())} dir="ltr" maxLength={8} hint={t('setPrefixHint')} />
          <div className="space-y-3 pt-6">
            <CheckField label={t('setAutoGenerate')} checked={form.autoGenerateReferral} onChange={set('autoGenerateReferral')} />
            <CheckField label={t('setValidate')} hint={t('setValidateHint')} checked={form.referralValidation} onChange={set('referralValidation')} />
          </div>
        </div>
      </Section>

      <Section title={t('setAppointments')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('setOffsets')} value={form.reminderOffsets} onChange={set('reminderOffsets')} hint={t('setOffsetsHint')} dir="ltr" />
          <TextField label={t('setOverdueHours')} value={form.overdueAlertHours} onChange={set('overdueAlertHours')} inputMode="numeric" dir="ltr" />
          <div className="space-y-3">
            <CheckField label={t('setFollowUpAlerts')} checked={form.followUpAlerts} onChange={set('followUpAlerts')} />
            <CheckField label={t('setNotifyHead')} checked={form.notifyHead} onChange={set('notifyHead')} />
          </div>
        </div>
      </Section>

      <Section title={t('setWallet')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={t('setCadence')} value={form.cadence} onChange={set('cadence')} options={[{ value: 'WEEKLY', label: t('cadenceWeekly') }, { value: 'MONTHLY', label: t('cadenceMonthly') }]} />
          <TextField label={t('setMinWithdrawal')} value={form.minWithdrawal} onChange={set('minWithdrawal')} inputMode="decimal" dir="ltr" />
          <TextField label={t('setPayoutMethods')} value={form.payoutMethods} onChange={set('payoutMethods')} hint={t('setPayoutMethodsHint')} dir="ltr" />
          <SelectField label={t('setWithdrawalApproval')} value={form.withdrawalApproval} onChange={set('withdrawalApproval')} options={[{ value: 'REQUIRED', label: t('wdRequired') }, { value: 'AUTO_REVIEW', label: t('wdAutoReview') }]} />
          <div className="sm:col-span-2"><CheckField label={t('setActiveOnly')} checked={form.withdrawalActiveOnly} onChange={set('withdrawalActiveOnly')} /></div>
          <AreaField label={t('setTermsEn')} value={form.termsEn} onChange={set('termsEn')} maxLength={600} />
          <div dir="rtl"><AreaField label={t('setTermsAr')} value={form.termsAr} onChange={set('termsAr')} maxLength={600} /></div>
        </div>
      </Section>

      <Section title={t('setOperations')}>
        <div className="space-y-3">
          <CheckField label={t('setRequireHead')} checked disabled onChange={() => undefined} />
          <CheckField label={t('setAllowTransfer')} checked={form.allowStaffTransfer} onChange={set('allowStaffTransfer')} />
          <CheckField label={t('setHeadsReassign')} checked={form.headsCanReassignLeads} onChange={set('headsCanReassignLeads')} />
          <CheckField label={t('setHeadsReports')} checked={form.headsSeeReports} onChange={set('headsSeeReports')} />
        </div>
      </Section>

      <Section title={t('setLabels')} subtitle={t('setLabelsHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {LEAD_STATUSES.map((status) => (
            <div key={status} className="grid grid-cols-2 gap-2">
              <TextField label={`${status} · EN`} value={form.labels[status]?.en ?? ''} onChange={(value) => set('labels')({ ...form.labels, [status]: { en: value, ar: form.labels[status]?.ar ?? '' } })} maxLength={80} />
              <div dir="rtl"><TextField label={`${status} · AR`} value={form.labels[status]?.ar ?? ''} onChange={(value) => set('labels')({ ...form.labels, [status]: { en: form.labels[status]?.en ?? '', ar: value } })} maxLength={80} /></div>
            </div>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-lg">
        <p className="text-sm text-muted-foreground">{changed ? (financial ? t('unsavedFinancial', { count: changed }) : t('unsaved', { count: changed })) : t('noChanges')}</p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={!changed} onClick={() => setForm(toForm(data))}>{t('discard')}</Button>
          <Button type="submit" variant="yellow" loading={pending} disabled={!changed}>{t('save')}</Button>
        </div>
      </div>
    </form>
  );
}
