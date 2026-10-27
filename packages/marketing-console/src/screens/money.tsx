import { Button } from '@alliva/ui';
import { Banknote, Check, SlidersHorizontal } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useConsole, type Me } from '../context';
import { formatDate, formatDateTime, formatMoney } from '../format';
import { pick, useLang, useT, type MessageKey } from '../i18n';
import {
  AreaField, CheckField, CommissionRate, ConfirmDialog, DateRange, FilterSelect, FormActions, Kpi, ListView, Modal, Page, QueryBoundary, SearchBox, Section, SelectField, StatusPill, Tabs, TextField, Toolbar, useAction, useData, useFilters, useList, useStaffOptions, type Column,
} from '../kit';
import type { CommissionRow, Wallet, WalletOverviewRow, WalletTx, WithdrawalRow } from '../types';

// ---------------------------------------------------------------------------------------------- commissions

export function CommissionsScreen() {
  const { api, role } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const filters = useFilters({ status: '', tier: '', staffId: '', from: '', to: '' });
  const query = useList<CommissionRow>('commissions', '/commissions', filters.params);
  const profile = useData<Me>('me', '/me', undefined, role !== 'ADMIN');
  const staff = useStaffOptions(role !== 'STAFF');
  const [confirmAll, setConfirmAll] = useState(false);

  const columns: Column<CommissionRow>[] = [
    { key: 'date', header: t('colDate'), cell: (row) => formatDate(row.createdAt, lang) },
    { key: 'store', header: t('colStore'), cell: (row) => <div><p className="font-semibold">{row.merchantName}</p><p className="text-xs text-muted-foreground">{row.planName}</p></div> },
    { key: 'who', header: t('colBeneficiary'), cell: (row) => <div><p>{row.beneficiaryName}</p><p className="text-xs text-muted-foreground">{t(row.tier === 'HEAD' ? 'tierHead' : 'tierStaff')}</p></div> },
    { key: 'eligible', header: t('colEligible'), cell: (row) => formatMoney(row.eligibleAmount, lang) },
    { key: 'rate', header: t('colRate'), cell: (row) => `${Number(row.ratePercent)}%` },
    { key: 'amount', header: t('colAmount'), cell: (row) => formatMoney(row.amount, lang) },
    { key: 'reversed', header: t('colReversed'), cell: (row) => (Number(row.reversedAmount) > 0 ? <span className="text-[#d9342b]">−{formatMoney(row.reversedAmount, lang)}</span> : '—') },
    { key: 'net', header: t('colNet'), cell: (row) => <strong>{formatMoney(row.netAmount, lang)}</strong> },
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.status} /> },
    ...(role === 'ADMIN'
      ? [{ key: 'actions', header: '', cell: (row: CommissionRow) => (row.status === 'PENDING' ? <Button size="sm" variant="outline" onClick={() => act(() => api.mk.post('/commissions/approve', { ids: [row.id] }), 'saved')}><Check className="size-4" />{t('approve')}</Button> : null) }]
      : []),
  ];

  return (
    <Page
      title={t('commissionsTitle')}
      subtitle={t(role === 'STAFF' ? 'commissionsSubtitleStaff' : role === 'HEAD' ? 'commissionsSubtitleHead' : 'commissionsSubtitle')}
      actions={role === 'ADMIN' ? <Button variant="yellow" onClick={() => setConfirmAll(true)}>{t('approveAllPending')}</Button> : undefined}
    >
      <Toolbar>
        <FilterSelect label={t('colStatus')} value={filters.values.status} onChange={(status) => filters.set({ status })} options={['PENDING', 'APPROVED', 'PAID', 'REVERSED'].map((value) => ({ value, label: t(`status.${value}` as MessageKey) }))} />
        {role !== 'STAFF' ? <FilterSelect label={t('colTier')} value={filters.values.tier} onChange={(tier) => filters.set({ tier })} options={[{ value: 'STAFF', label: t('tierStaff') }, { value: 'HEAD', label: t('tierHead') }]} /> : null}
        {role !== 'STAFF' ? <FilterSelect label={t('colStaffMember')} value={filters.values.staffId} onChange={(staffId) => filters.set({ staffId })} options={(staff.data?.items ?? []).map((row) => ({ value: row.id, label: row.fullName }))} /> : null}
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
      </Toolbar>
      {role !== 'ADMIN' && profile.data ? <p className="text-sm">{t('currentCommissionRate')} <strong><CommissionRate percent={profile.data.effectiveCommissionPercent} isDefault={profile.data.commissionIsDefault} /></strong></p> : null}
      <p className="text-xs text-muted-foreground">{t('commissionRule')}</p>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noCommissions')} emptyBody={t('noCommissionsBody')} />
      <ConfirmDialog open={confirmAll} onClose={() => setConfirmAll(false)} title={t('approveAllPending')} body={t('approveAllBody')} confirmLabel={t('approve')} onConfirm={async () => (await act(() => api.mk.post('/commissions/approve', {}), 'saved')).ok} />
    </Page>
  );
}

/** Every wallet movement for the signed-in head or staff member: credits, reversals, approvals and withdrawals. */
export function CommissionTransactionsScreen() {
  const t = useT();
  return (
    <Page title={t('transactionsTitle')} subtitle={t('transactionsSubtitle')}>
      <TransactionsTable />
    </Page>
  );
}

// ---------------------------------------------------------------------------------------------- wallet (head / staff)

export function WalletScreen() {
  const { role } = useConsole();
  const t = useT();
  const lang = useLang();
  const wallet = useData<Wallet>('wallet', '/wallet');
  const [tab, setTab] = useState<'transactions' | 'withdrawals'>('transactions');
  const [requesting, setRequesting] = useState(false);
  return (
    <Page
      title={t('walletTitle')}
      subtitle={t(role === 'HEAD' ? 'walletSubtitleHead' : 'walletSubtitle')}
      actions={wallet.data ? <Button variant="yellow" disabled={!wallet.data.withdrawal.canRequest} onClick={() => setRequesting(true)}><Banknote className="size-4" />{t('requestWithdrawal')}</Button> : undefined}
    >
      <QueryBoundary query={wallet}>
        {(data) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label={t('walletAvailable')} value={formatMoney(data.available, lang)} tone="good" />
              <Kpi label={t('walletPending')} value={formatMoney(data.pending, lang)} hint={t('walletPendingHint')} />
              <Kpi label={t('walletReserved')} value={formatMoney(data.reserved, lang)} hint={t('walletReservedHint')} />
              <Kpi label={t('walletRecovery')} value={formatMoney(data.recoveryDue, lang)} tone={Number(data.recoveryDue) > 0 ? 'bad' : undefined} hint={t('walletRecoveryHint')} />
              <Kpi label={t('walletEarned')} value={formatMoney(data.totalEarned, lang)} />
              <Kpi label={t('walletWithdrawn')} value={formatMoney(data.totalWithdrawn, lang)} />
            </div>
            <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
              {t('withdrawalPolicy', { min: formatMoney(data.withdrawal.minimum, lang), cadence: t(data.withdrawal.cadence === 'WEEKLY' ? 'cadenceWeekly' : 'cadenceMonthly') })}
              {!data.withdrawal.canRequest && data.withdrawal.nextAt ? ` ${t('nextWithdrawalAt', { date: formatDateTime(data.withdrawal.nextAt, lang) })}` : ''}
            </p>
            <Tabs value={tab} onChange={setTab} tabs={[{ id: 'transactions', label: t('tabTransactions') }, { id: 'withdrawals', label: t('tabWithdrawals'), count: data.withdrawal.openRequests || undefined }]} />
            {tab === 'transactions' ? <TransactionsTable /> : <WithdrawalsTable admin={false} />}
            {requesting ? <RequestWithdrawal wallet={data} onClose={() => setRequesting(false)} /> : null}
          </div>
        )}
      </QueryBoundary>
    </Page>
  );
}

function RequestWithdrawal({ wallet, onClose }: { wallet: Wallet; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState(wallet.withdrawal.methods[0] ?? '');
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const valid = /^\d+(\.\d{1,3})?$/.test(amount) && Number(amount) >= Number(wallet.withdrawal.minimum) && Number(amount) <= Number(wallet.available);
  return (
    <Modal open onClose={onClose} title={t('requestWithdrawal')} description={t('availableToWithdraw', { amount: formatMoney(wallet.available, lang) })}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const result = await act(() => api.mk.post('/wallet/withdrawals', { amount: Number(amount).toFixed(3), method, acceptTerms: true }), 'withdrawalRequested');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          <TextField label={t('colAmount')} value={amount} onChange={setAmount} inputMode="decimal" required hint={t('minimumHint', { min: formatMoney(wallet.withdrawal.minimum, lang) })} dir="ltr" />
          <SelectField label={t('fPayoutMethod')} value={method} onChange={setMethod} options={wallet.withdrawal.methods.map((value) => ({ value, label: methodLabel(value, t) }))} />
          <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">{pick(wallet.withdrawal.terms, lang)}</p>
          <CheckField label={t('acceptTerms')} checked={accepted} onChange={setAccepted} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('submitRequest')} pending={pending} disabled={!valid || !accepted || !method} />
      </form>
    </Modal>
  );
}

export function methodLabel(value: string, t: ReturnType<typeof useT>) {
  const key = `method.${value}` as MessageKey;
  const label = t(key);
  return label.startsWith('method.') ? value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : label;
}

function TransactionsTable({ userId }: { userId?: string }) {
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '', type: '', bucket: '', from: '', to: '' });
  const query = useList<WalletTx>('wallet-tx', '/wallet/transactions', { ...filters.params, userId });
  const { role } = useConsole();
  const columns: Column<WalletTx>[] = [
    { key: 'date', header: t('colDate'), cell: (row) => formatDateTime(row.createdAt, lang) },
    ...(role === 'ADMIN' ? [{ key: 'user', header: t('colName'), cell: (row: WalletTx) => row.userName }] : []),
    { key: 'type', header: t('colType'), cell: (row) => t(`tx.${row.type}` as MessageKey) },
    { key: 'bucket', header: t('colBucket'), cell: (row) => t(`bucket.${row.bucket}` as MessageKey) },
    { key: 'amount', header: t('colAmount'), cell: (row) => <span className={Number(row.amount) < 0 ? 'text-[#d9342b]' : 'text-[#168a52]'} dir="ltr">{Number(row.amount) > 0 ? '+' : ''}{formatMoney(row.amount, lang)}</span> },
    { key: 'reason', header: t('colReason'), cell: (row) => row.reason ?? <code className="text-xs text-muted-foreground">{row.reference}</code> },
  ];
  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} />
        <FilterSelect label={t('colType')} value={filters.values.type} onChange={(type) => filters.set({ type })} options={['COMMISSION_CREDIT', 'COMMISSION_REVERSAL', 'APPROVAL', 'RECOVERY', 'WITHDRAWAL_RESERVE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_PAID', 'ADMIN_ADJUSTMENT', 'OPENING_BALANCE'].map((value) => ({ value, label: t(`tx.${value}` as MessageKey) }))} />
        <FilterSelect label={t('colBucket')} value={filters.values.bucket} onChange={(bucket) => filters.set({ bucket })} options={['PENDING', 'AVAILABLE', 'RESERVED', 'RECOVERY'].map((value) => ({ value, label: t(`bucket.${value}` as MessageKey) }))} />
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noTransactions')} emptyBody={t('noTransactionsBody')} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- withdrawals

function WithdrawalsTable({ admin, defaultStatus = '' }: { admin: boolean; defaultStatus?: string }) {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const filters = useFilters({ status: defaultStatus, from: '', to: '' });
  const query = useList<WithdrawalRow>('withdrawals', '/withdrawals', filters.params);
  const [decision, setDecision] = useState<{ row: WithdrawalRow; to: 'UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED' } | null>(null);
  const [cancelling, setCancelling] = useState<WithdrawalRow | null>(null);

  const next: Record<string, ('UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED')[]> = {
    REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED'],
    APPROVED: ['PROCESSING', 'PAID', 'REJECTED'],
    PROCESSING: ['PAID', 'REJECTED'],
  };
  const columns: Column<WithdrawalRow>[] = [
    { key: 'date', header: t('colDate'), cell: (row) => formatDateTime(row.createdAt, lang) },
    ...(admin ? [{ key: 'user', header: t('colName'), cell: (row: WithdrawalRow) => <div><p className="font-semibold">{row.userName}</p><p className="text-xs text-muted-foreground">{row.email}</p></div> }] : []),
    { key: 'amount', header: t('colAmount'), cell: (row) => <strong>{formatMoney(row.amount, lang)}</strong> },
    { key: 'method', header: t('fPayoutMethod'), cell: (row) => (row.payoutMethod ? methodLabel(row.payoutMethod, t) : '—') },
    { key: 'status', header: t('colStatus'), cell: (row) => <StatusPill value={row.status} /> },
    { key: 'ref', header: t('fPayoutReference'), cell: (row) => row.payoutReference ?? (row.rejectionReason ? <span className="text-xs text-[#d9342b]">{row.rejectionReason}</span> : '—') },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        admin ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {(next[row.status] ?? []).map((to) => (
              <Button key={to} size="sm" variant={to === 'REJECTED' ? 'ghost' : 'outline'} onClick={() => setDecision({ row, to })}>{t(`decision.${to}` as MessageKey)}</Button>
            ))}
          </div>
        ) : ['REQUESTED', 'UNDER_REVIEW'].includes(row.status) ? (
          <Button size="sm" variant="ghost" onClick={() => setCancelling(row)}>{t('cancelRequest')}</Button>
        ) : null,
    },
  ];
  return (
    <div className="space-y-3">
      <Toolbar>
        <FilterSelect label={t('colStatus')} value={filters.values.status} onChange={(status) => filters.set({ status })} options={['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED'].map((value) => ({ value, label: t(`status.${value}` as MessageKey) }))} />
        <DateRange from={filters.values.from} to={filters.values.to} onChange={filters.set} />
      </Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.id} onPage={filters.setPage} emptyTitle={t('noWithdrawals')} emptyBody={t('noWithdrawalsBody')} />
      {decision ? <DecisionDialog row={decision.row} to={decision.to} onClose={() => setDecision(null)} /> : null}
      <ConfirmDialog open={Boolean(cancelling)} onClose={() => setCancelling(null)} title={t('cancelRequest')} body={t('cancelRequestBody')} confirmLabel={t('cancelRequest')} destructive onConfirm={async () => (await act(() => api.mk.post(`/withdrawals/${cancelling?.id}/cancel`), 'saved')).ok} />
    </div>
  );
}

function DecisionDialog({ row, to, onClose }: { row: WithdrawalRow; to: 'UNDER_REVIEW' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'REJECTED'; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const methods = useData<{ withdrawal: { methods: string[] } }>('wallet-admin-methods', '/wallet', { userId: row.userId });
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState(row.payoutMethod ?? '');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const paid = to === 'PAID';
  const rejected = to === 'REJECTED';
  const options = Array.from(new Set([...(row.payoutMethod ? [row.payoutMethod] : []), ...(methods.data?.withdrawal.methods ?? [])]));
  return (
    <Modal open onClose={onClose} title={t(`decision.${to}` as MessageKey)} description={`${row.userName ?? ''} · ${formatMoney(row.amount, lang)}`}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const result = await act(() => api.mk.post(`/withdrawals/${row.id}/decision`, { to, reason: rejected ? reason.trim() : undefined, payoutReference: paid ? reference.trim() : undefined, payoutMethod: paid && method ? method : undefined }), 'saved');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          {paid ? (
            <>
              <SelectField label={t('fPayoutMethod')} value={method} onChange={setMethod} placeholder={t('none')} options={options.map((value) => ({ value, label: methodLabel(value, t) }))} />
              <TextField label={t('fPayoutReference')} value={reference} onChange={setReference} required hint={t('payoutReferenceHint')} dir="ltr" maxLength={120} />
            </>
          ) : null}
          {rejected ? <AreaField label={t('reasonRequired')} value={reason} onChange={setReason} required maxLength={300} hint={t('rejectReleaseHint')} /> : null}
          {!paid && !rejected ? <p className="text-sm text-muted-foreground">{t('decisionConfirm')}</p> : null}
        </div>
        <FormActions onCancel={onClose} submitLabel={t(`decision.${to}` as MessageKey)} pending={pending} disabled={(paid && reference.trim().length < 2) || (rejected && reason.trim().length < 3)} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- admin: wallets and withdrawal queue

export function WalletsAdminScreen({ params }: { params: Record<string, string> }) {
  const t = useT();
  const [tab, setTab] = useState<'withdrawals' | 'wallets' | 'transactions'>(params.tab === 'wallets' ? 'wallets' : 'withdrawals');
  return (
    <Page title={t('walletsAdminTitle')} subtitle={t('walletsAdminSubtitle')}>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'withdrawals', label: t('tabWithdrawals') }, { id: 'wallets', label: t('tabWallets') }, { id: 'transactions', label: t('tabTransactions') }]} />
      {tab === 'withdrawals' ? <WithdrawalsTable admin defaultStatus="REQUESTED" /> : tab === 'wallets' ? <WalletsOverview /> : <TransactionsTable />}
    </Page>
  );
}

function WalletsOverview() {
  const t = useT();
  const lang = useLang();
  const filters = useFilters({ q: '' });
  const query = useList<WalletOverviewRow>('wallets', '/wallets', filters.params);
  const [adjusting, setAdjusting] = useState<WalletOverviewRow | null>(null);
  const columns: Column<WalletOverviewRow>[] = [
    { key: 'name', header: t('colName'), cell: (row) => <div><p className="font-semibold">{row.name}</p><p className="text-xs text-muted-foreground">{row.kind ? t(row.kind === 'HEAD' ? 'roleHead' : 'roleStaff') : ''}</p></div> },
    { key: 'available', header: t('walletAvailable'), cell: (row) => formatMoney(row.available, lang) },
    { key: 'pending', header: t('walletPending'), cell: (row) => formatMoney(row.pending, lang) },
    { key: 'reserved', header: t('walletReserved'), cell: (row) => formatMoney(row.reserved, lang) },
    { key: 'recovery', header: t('walletRecovery'), cell: (row) => (Number(row.recoveryDue) > 0 ? <span className="text-[#d9342b]">{formatMoney(row.recoveryDue, lang)}</span> : '—') },
    { key: 'earned', header: t('walletEarned'), cell: (row) => formatMoney(row.totalEarned, lang) },
    { key: 'withdrawn', header: t('walletWithdrawn'), cell: (row) => formatMoney(row.totalWithdrawn, lang) },
    { key: 'actions', header: '', cell: (row) => <Button size="sm" variant="outline" onClick={() => setAdjusting(row)}><SlidersHorizontal className="size-4" />{t('adjust')}</Button> },
  ];
  return (
    <div className="space-y-3">
      <Toolbar><SearchBox value={filters.values.q} onChange={(q) => filters.set({ q })} /></Toolbar>
      <ListView query={query} columns={columns} rowKey={(row) => row.userId} onPage={filters.setPage} emptyTitle={t('noWallets')} emptyBody={t('noWalletsBody')} />
      {adjusting ? <AdjustDialog row={adjusting} onClose={() => setAdjusting(null)} /> : null}
    </div>
  );
}

function AdjustDialog({ row, onClose }: { row: WalletOverviewRow; onClose: () => void }) {
  const { api } = useConsole();
  const t = useT();
  const lang = useLang();
  const act = useAction();
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const valid = /^\d+(\.\d{1,3})?$/.test(amount) && Number(amount) > 0 && reason.trim().length >= 5;
  return (
    <Modal open onClose={onClose} title={t('adjustTitle', { name: row.name })} description={t('adjustHint', { amount: formatMoney(row.available, lang) })}>
      <form onSubmit={async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        const signed = `${direction === 'debit' ? '-' : ''}${Number(amount).toFixed(3)}`;
        const result = await act(() => api.mk.post(`/wallets/${row.userId}/adjust`, { amount: signed, reason: reason.trim() }), 'saved');
        setPending(false);
        if (result.ok) onClose();
      }}>
        <div className="space-y-4">
          <SelectField label={t('adjustType')} value={direction} onChange={(value) => setDirection(value as 'credit' | 'debit')} options={[{ value: 'credit', label: t('adjustCredit') }, { value: 'debit', label: t('adjustDebit') }]} />
          <TextField label={t('colAmount')} value={amount} onChange={setAmount} inputMode="decimal" required dir="ltr" />
          <AreaField label={t('reasonRequired')} value={reason} onChange={setReason} required maxLength={300} />
        </div>
        <FormActions onCancel={onClose} submitLabel={t('adjust')} pending={pending} disabled={!valid} />
      </form>
    </Modal>
  );
}
