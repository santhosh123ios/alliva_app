import type { ApiClient, SubscriptionPaymentsView } from '@alliva/api-client';
import { Button } from '@alliva/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDate, formatMoney } from '../format';
import { useLang, useT } from '../i18n';
import { AreaField, CheckField, ConfirmDialog, Loading, Modal, StatusPill, TextField, errorMessage, useAction } from '../kit';

type Payment = SubscriptionPaymentsView['payments'][number];

/**
 * Admin view of a merchant's subscription payments: confirm the current period was paid (this is the verification
 * that makes commission eligible) and refund a payment fully or partially (commission is reversed proportionally).
 */
export function SubscriptionPaymentsDialog({ api, merchantId, merchantName, onClose, onChanged }: {
  api: ApiClient;
  merchantId: string | null;
  merchantName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const client = useQueryClient();
  const act = useAction();
  const [verifying, setVerifying] = useState(false);
  const [refunding, setRefunding] = useState<Payment | null>(null);
  const query = useQuery({
    queryKey: ['mk', 'subscription-payments', merchantId],
    queryFn: () => api.subscriptionPayments(merchantId as string),
    enabled: Boolean(merchantId),
  });

  async function changed() {
    await client.invalidateQueries({ queryKey: ['mk', 'subscription-payments', merchantId] });
    onChanged?.();
  }

  return (
    <>
      <Modal open={Boolean(merchantId)} onClose={onClose} title={t('payTitle')} description={merchantName} wide>
        {query.isLoading ? <Loading /> : null}
        {query.error ? <p className="text-sm text-destructive" role="alert">{errorMessage(query.error)}</p> : null}
        {query.data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/40 p-4">
              <div>
                <p className="font-semibold">{query.data.currentPeriodVerified ? t('payCurrentVerified') : t('payCurrentUnverified')}</p>
                <p className="text-sm text-muted-foreground">{t('payVerifyHint')}</p>
              </div>
              {query.data.currentPeriodVerified ? null : <Button variant="yellow" onClick={() => setVerifying(true)}>{t('payVerify')}</Button>}
            </div>
            {query.data.payments.length ? (
              <ul className="space-y-3">
                {query.data.payments.map((payment) => {
                  const refundable = Boolean(payment.verifiedAt) && (payment.status === 'CAPTURED' || payment.status === 'PARTIALLY_REFUNDED');
                  return (
                    <li key={payment.id} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{lang === 'ar' ? payment.plan.ar || payment.plan.en : payment.plan.en || payment.plan.ar}{payment.isRenewal ? ` · ${t('payRenewal')}` : ''}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(payment.verifiedAt ?? payment.createdAt, lang)}</p>
                        </div>
                        <StatusPill value={payment.status} />
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                        <Metric label={t('payGross')} value={formatMoney(payment.gross, lang)} />
                        <Metric label={t('payDiscount')} value={formatMoney(payment.discount, lang)} />
                        <Metric label={t('payPaid')} value={formatMoney(payment.amount, lang)} />
                        <Metric label={t('payRefunded')} value={formatMoney(payment.refunded, lang)} />
                        <Metric label={t('payCommissionNet')} value={formatMoney(payment.commission, lang)} />
                      </dl>
                      {payment.refunds.length ? (
                        <ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                          {payment.refunds.map((refund) => <li key={refund.id}>{formatDate(refund.createdAt, lang)} · {formatMoney(refund.amount, lang)} · {refund.reason}</li>)}
                        </ul>
                      ) : null}
                      {refundable ? <div className="mt-3 flex justify-end"><Button variant="outline" size="sm" onClick={() => setRefunding(payment)}>{t('payRefund')}</Button></div> : null}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{t('payNone')}</p>}
          </div>
        ) : null}
      </Modal>
      <ConfirmDialog
        open={verifying}
        onClose={() => setVerifying(false)}
        title={t('payVerifyTitle')}
        body={t('payVerifyBody')}
        confirmLabel={t('payVerify')}
        onConfirm={async () => {
          const result = await act(() => api.verifySubscriptionPayment(merchantId as string), 'payVerified');
          if (result.ok) await changed();
          return result.ok;
        }}
      />
      <RefundDialog
        payment={refunding}
        onClose={() => setRefunding(null)}
        onSubmit={async (body) => {
          const result = await act(() => api.refundSubscriptionPayment((refunding as Payment).id, body), 'payRefunded');
          if (result.ok) await changed();
          return result.ok;
        }}
      />
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function RefundDialog({ payment, onClose, onSubmit }: {
  payment: Payment | null;
  onClose: () => void;
  onSubmit: (body: { amount?: string; reason: string; cancelSubscription?: boolean }) => Promise<boolean>;
}) {
  const t = useT();
  const lang = useLang();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [cancel, setCancel] = useState(false);
  const [pending, setPending] = useState(false);
  const remaining = payment ? Math.max(0, Number(payment.amount) - Number(payment.refunded)) : 0;
  const parsed = amount.trim() ? Number(amount) : remaining;
  const invalid = !Number.isFinite(parsed) || parsed <= 0 || parsed > remaining + 0.0005 || reason.trim().length < 3;
  return (
    <Modal open={Boolean(payment)} onClose={onClose} title={t('payRefundTitle')} description={t('payRefundBody')}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          const ok = await onSubmit({ ...(amount.trim() ? { amount: parsed.toFixed(3) } : {}), reason: reason.trim(), cancelSubscription: cancel || undefined });
          setPending(false);
          if (ok) { setAmount(''); setReason(''); setCancel(false); onClose(); }
        }}
        className="space-y-3"
      >
        <TextField label={t('payRefundAmount')} value={amount} onChange={setAmount} inputMode="decimal" placeholder={formatMoney(remaining, lang)} hint={t('payRefundAmountHint', { max: formatMoney(remaining, lang) })} />
        <AreaField label={t('payRefundReason')} value={reason} onChange={setReason} required maxLength={300} />
        <CheckField label={t('payCancelSub')} checked={cancel} onChange={setCancel} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="destructive" loading={pending} disabled={invalid}>{t('payRefund')}</Button>
        </div>
      </form>
    </Modal>
  );
}
