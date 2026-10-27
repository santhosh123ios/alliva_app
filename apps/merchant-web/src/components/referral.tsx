import { api } from '@/components/providers';
import { formatMoney } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, ErrorState, Input, Label, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

type Profile = {
  referral: { code: string; staffName: string } | null;
};

type Tab = 'transactions' | 'withdrawals';

export function ReferralWalletPage() {
  const t = useTranslations('merchantReferral');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('transactions');
  const [open, setOpen] = useState(false);
  const profile = useQuery({ queryKey: ['merchant', 'profile'], queryFn: () => api.profile() });
  const wallet = useQuery({ queryKey: ['merchant', 'wallet'], queryFn: () => api.merchantWallet() });

  if (profile.isLoading || wallet.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  const error = profile.error ?? wallet.error;
  if (error || !wallet.data) return <ErrorState title={t('title')} body={(error as Error | null)?.message ?? ''} />;

  const referral = (profile.data as Profile | undefined)?.referral ?? null;
  const data = wallet.data;
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-[#161616]">{t('title')}</h1>
        <p className="mt-1 text-sm text-[#8A8A86]">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#EEEEEC] bg-white p-5">
          <h2 className="text-base font-semibold text-[#161616]">{t('yourReferral')}</h2>
          <p className="mt-1 text-sm text-[#8A8A86]">{t('yourReferralHint')}</p>
          {referral ? (
            <>
              <p className="mt-4 rounded-2xl bg-[#111111] px-5 py-6 text-center text-3xl font-semibold tracking-widest text-primary" dir="ltr">{referral.code}</p>
              <p className="mt-3 text-sm text-[#161616]">{t('referredBy', { name: referral.staffName })}</p>
            </>
          ) : (
            <p className="mt-4 rounded-xl bg-[#F7F7F5] px-4 py-6 text-sm text-[#8A8A86]">{t('noReferral')}</p>
          )}
        </section>
        <section className="rounded-2xl border border-[#EEEEEC] bg-white p-5">
          <h2 className="text-base font-semibold text-[#161616]">{t('wallet')}</h2>
          <p className="mt-1 text-sm text-[#8A8A86]">{t('walletHint')}</p>
          <p className="mt-6 text-xs font-semibold tracking-wide text-[#8A8A86] uppercase">{t('available')}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-[#168A52]">{formatMoney(data.available, locale)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <p><span className="block text-xs text-[#8A8A86]">{t('pending')}</span><span className="font-semibold">{formatMoney(data.pending, locale)}</span></p>
            <p><span className="block text-xs text-[#8A8A86]">{t('withdrawn')}</span><span className="font-semibold">{formatMoney(data.withdrawn, locale)}</span></p>
          </div>
          <Button type="button" variant="yellow" className="mt-5 h-11" disabled={!data.canWithdraw || Number(data.available) <= 0} onClick={() => setOpen(true)}>
            {t('requestWithdrawal')}
          </Button>
        </section>
      </div>
      <div className="flex gap-2">
        <TabButton active={tab === 'transactions'} onClick={() => setTab('transactions')}>{t('transactions')}</TabButton>
        <TabButton active={tab === 'withdrawals'} onClick={() => setTab('withdrawals')}>{t('withdrawals')}{data.withdrawals.some((row) => row.status === 'PENDING_APPROVAL' || row.status === 'DRAFT') ? ` (${data.withdrawals.filter((row) => row.status === 'PENDING_APPROVAL' || row.status === 'DRAFT').length})` : ''}</TabButton>
      </div>
      {tab === 'transactions' ? (
        <ActivityTable
          emptyTitle={t('noTransactions')}
          emptyBody={t('noTransactionsBody')}
          rows={data.transactions.map((row) => ({
            id: row.id,
            date: formatWhen(row.createdAt, locale),
            detail: t(row.type === 'EARNED' ? 'typeEarned' : 'typeWithdrawal'),
            amount: signedMoney(row.amount, locale),
            positive: Number(row.amount) >= 0,
          }))}
          detailHeader={t('type')}
        />
      ) : (
        <ActivityTable
          emptyTitle={t('noWithdrawals')}
          emptyBody={t('noWithdrawalsBody')}
          rows={data.withdrawals.map((row) => ({
            id: row.id,
            date: formatWhen(row.createdAt, locale),
            detail: t(`status_${row.status}`),
            amount: formatMoney(row.amount, locale),
            positive: false,
          }))}
          detailHeader={t('status')}
        />
      )}
      {open ? <WithdrawDialog available={data.available} locale={locale} onClose={() => setOpen(false)} onDone={async () => { setOpen(false); await client.invalidateQueries({ queryKey: ['merchant', 'wallet'] }); await client.invalidateQueries({ queryKey: ['merchant', 'dashboard'] }); }} /> : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={active ? 'rounded-full bg-[#111111] px-4 py-2 text-sm font-semibold text-white' : 'rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#161616] ring-1 ring-[#EEEEEC]'}>
      {children}
    </button>
  );
}

function ActivityTable({ rows, emptyTitle, emptyBody, detailHeader }: { rows: { id: string; date: string; detail: string; amount: string; positive: boolean }[]; emptyTitle: string; emptyBody: string; detailHeader: string }) {
  const t = useTranslations('merchantReferral');
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-[#EEEEEC] bg-white px-5 py-10 text-center">
        <p className="font-semibold text-[#161616]">{emptyTitle}</p>
        <p className="mt-1 text-sm text-[#8A8A86]">{emptyBody}</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-[#EEEEEC] bg-white">
      <table className="w-full text-sm">
        <thead className="text-xs font-semibold tracking-wide text-[#8A8A86] uppercase">
          <tr>
            <th className="px-4 py-3 text-start font-semibold">{t('date')}</th>
            <th className="px-4 py-3 text-start font-semibold">{detailHeader}</th>
            <th className="px-4 py-3 text-end font-semibold">{t('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[#EEEEEC]">
              <td className="px-4 py-3 text-[#161616]">{row.date}</td>
              <td className="px-4 py-3 text-[#161616]">{row.detail}</td>
              <td className={`px-4 py-3 text-end font-semibold ${row.positive ? 'text-[#168A52]' : 'text-[#161616]'}`} dir="ltr">{row.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WithdrawDialog({ available, locale, onClose, onDone }: { available: string; locale: 'en' | 'ar'; onClose: () => void; onDone: () => Promise<void> }) {
  const t = useTranslations('merchantReferral');
  const common = useTranslations('common');
  const [amount, setAmount] = useState('');
  const valid = /^\d+(\.\d{1,3})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(available);
  const request = useMutation({
    mutationFn: () => api.requestMerchantWithdrawal(Number(amount).toFixed(3)),
    onSuccess: async () => {
      toast.success(t('withdrawalRequested'));
      await onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogTitle>{t('requestWithdrawal')}</DialogTitle>
        <DialogDescription>{t('availableToWithdraw', { amount: formatMoney(available, locale) })}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); if (valid) request.mutate(); }}>
          <div>
            <Label htmlFor="withdrawal-amount">{t('amount')}</Label>
            <Input id="withdrawal-amount" className="mt-1" inputMode="decimal" dir="ltr" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{common('cancel')}</Button>
            <Button type="submit" variant="yellow" disabled={!valid || request.isPending} loading={request.isPending}>{t('submitRequest')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatWhen(value: string, locale: 'en' | 'ar') {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-BH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function signedMoney(amount: string, locale: 'en' | 'ar') {
  const formatted = formatMoney(amount, locale);
  return Number(amount) > 0 ? `+${formatted}` : formatted;
}
