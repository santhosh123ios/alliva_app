import { api } from '@/components/providers';
import { formatMoney } from '@alliva/design-tokens';
import type { StoreCashDeposits } from '@alliva/types';
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton, toast } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, Hourglass, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type Deposit = StoreCashDeposits['deposits'][number];

/** Cash riders hand over at the counter. Owner, manager and billing confirm what they counted. */
export function CashDepositsCard() {
  const t = useTranslations('merchantCash');
  const locale = useLocale() === 'ar' ? 'ar' : 'en';
  const client = useQueryClient();
  const data = useQuery({ queryKey: ['merchant', 'cash-deposits'], queryFn: () => api.cashDeposits(), refetchInterval: 60_000 });
  const [rejecting, setRejecting] = useState<Deposit | null>(null);
  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'CONFIRMED' | 'REJECTED'; note?: string }) => api.decideCashDeposit(input.id, { decision: input.decision, ...(input.note ? { note: input.note } : {}) }),
    onSuccess: (next, input) => {
      client.setQueryData(['merchant', 'cash-deposits'], next);
      setRejecting(null);
      toast.success(input.decision === 'CONFIRMED' ? t('confirmed') : t('rejected'));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (data.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!data.data) return null;
  const pending = data.data.deposits.filter((row) => row.status === 'SUBMITTED');
  const reviewed = data.data.deposits.filter((row) => row.status !== 'SUBMITTED').slice(0, 5);
  const money = (value: string) => formatMoney(value, locale);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-warning"><Banknote className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      {data.data.inHand.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.data.inHand.map((row) => (
            <span key={row.riderId} className="rounded-full bg-muted px-3 py-1.5 text-xs">
              {t('withRider', { name: row.name, amount: money(row.amount) })}
            </span>
          ))}
        </div>
      ) : null}

      <h3 className="mt-5 text-sm font-semibold">{t('pending', { count: pending.length })}</h3>
      {pending.length ? (
        <ul className="mt-2 space-y-2">
          {pending.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3">
              <Hourglass className="size-4 shrink-0 text-info" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{row.rider.name} · <span className="tabular-nums">{money(row.amount)}</span></p>
                <p className="truncate text-xs text-muted-foreground">{row.orders.map((order) => `#${order.number}`).join(', ')}{row.note ? ` — ${row.note}` : ''}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={decide.isPending} onClick={() => setRejecting(row)} className="h-9 rounded-lg border border-destructive/30 px-3 text-sm font-semibold text-destructive disabled:opacity-50">{t('reject')}</button>
                <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: row.id, decision: 'CONFIRMED' })} className="flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-sm font-semibold text-white disabled:opacity-50">
                  {decide.isPending && decide.variables?.id === row.id && decide.variables.decision === 'CONFIRMED' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {t('confirm')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-subtle">{t('nonePending')}</p>}

      {reviewed.length ? (
        <>
          <h3 className="mt-5 text-sm font-semibold">{t('recent')}</h3>
          <ul className="mt-2 divide-y divide-border text-sm">
            {reviewed.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2">
                {row.status === 'CONFIRMED' ? <Check className="size-4 text-success" /> : <X className="size-4 text-destructive" />}
                <span className="flex-1">{row.rider.name}</span>
                <span className={cn('tabular-nums', row.status === 'REJECTED' && 'line-through text-subtle')}>{money(row.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <RejectDialog deposit={rejecting} busy={decide.isPending} onClose={() => setRejecting(null)} onReject={(note) => rejecting && decide.mutate({ id: rejecting.id, decision: 'REJECTED', note })} />
    </section>
  );
}

function RejectDialog({ deposit, busy, onClose, onReject }: { deposit: Deposit | null; busy: boolean; onClose: () => void; onReject: (note: string) => void }) {
  const t = useTranslations('merchantCash');
  const [note, setNote] = useState('');
  return (
    <Dialog open={Boolean(deposit)} onOpenChange={(open) => { if (!open) { setNote(''); onClose(); } }}>
      <DialogContent>
        <DialogTitle>{t('rejectTitle')}</DialogTitle>
        <DialogDescription>{t('rejectBody')}</DialogDescription>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={300} className="mt-4 w-full rounded-xl border border-border-strong px-3 py-2 text-sm outline-none focus:border-foreground" placeholder={t('rejectPlaceholder')} />
        <button type="button" disabled={!note.trim() || busy} onClick={() => onReject(note.trim())} className="mt-3 h-11 w-full rounded-xl bg-destructive text-sm font-semibold text-white disabled:opacity-40">{t('reject')}</button>
      </DialogContent>
    </Dialog>
  );
}
