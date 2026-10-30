import { api } from '@/components/providers';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { MerchantPromo } from '@alliva/api-client';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, ErrorState, Input, Label, Skeleton } from '@alliva/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Ticket } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

type DiscountType = 'PERCENTAGE' | 'FIXED';

type Draft = {
  code: string;
  description: string;
  descriptionAr: string;
  discountType: DiscountType;
  discountValue: string;
  minimumOrder: string;
  usageLimit: string;
  perCustomerLimit: string;
  startsAt: string;
  endsAt: string;
  firstOrderOnly: boolean;
};

export function PromosPage() {
  const t = useTranslations('merchantPromos');
  const locale = useLocale() as 'en' | 'ar';
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const promos = useQuery({ queryKey: ['merchant', 'promos'], queryFn: () => api.merchantPromos() });

  if (promos.isLoading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (promos.error) return <ErrorState title={t('title')} body={(promos.error as Error).message} />;

  const rows = promos.data ?? [];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-[#161616]">{t('title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-[#8A8A86]">{t('subtitle')}</p>
        </div>
        <Button type="button" variant="yellow" className="h-11" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          {t('create')}
        </Button>
      </div>
      {rows.length ? (
        <div className="overflow-hidden rounded-2xl border border-[#EEEEEC] bg-white">
          <table className="w-full text-sm">
            <thead className="text-xs font-semibold tracking-wide text-[#8A8A86] uppercase">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t('code')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('discount')}</th>
                <th className="hidden px-4 py-3 text-start font-semibold md:table-cell">{t('usageLimit')}</th>
                <th className="px-4 py-3 text-start font-semibold">{t('active')}</th>
                <th className="px-4 py-3 text-end font-semibold" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PromoRow key={row.id} row={row} locale={locale} onChanged={() => client.invalidateQueries({ queryKey: ['merchant', 'promos'] })} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#EEEEEC] bg-white px-5 py-12 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#FFF6D4] text-[#161616]">
            <Ticket className="size-5" />
          </span>
          <p className="mt-4 font-semibold text-[#161616]">{t('emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#8A8A86]">{t('emptyBody')}</p>
        </div>
      )}
      {open ? <CreatePromoDialog onClose={() => setOpen(false)} onCreated={async () => { setOpen(false); await client.invalidateQueries({ queryKey: ['merchant', 'promos'] }); }} /> : null}
    </div>
  );
}

function PromoRow({ row, locale, onChanged }: { row: MerchantPromo; locale: 'en' | 'ar'; onChanged: () => Promise<void> }) {
  const t = useTranslations('merchantPromos');
  const toggle = useMutation({
    mutationFn: () => api.setMerchantPromoActive(row.id, !row.active),
    onSuccess: async () => { await onChanged(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const description = pickLocalized(row.description, locale);
  return (
    <tr className="border-t border-[#EEEEEC]">
      <td className="px-4 py-3">
        <p className="font-semibold tracking-wide text-[#161616]" dir="ltr">{row.code}</p>
        <p className="mt-0.5 text-xs text-[#8A8A86]">{description}</p>
        <p className="mt-1 text-xs text-[#8A8A86] md:hidden">{row.usageLimit === null ? t('usedOpen', { used: row.usedCount }) : t('used', { used: row.usedCount, limit: row.usageLimit })}</p>
      </td>
      <td className="px-4 py-3 font-semibold text-[#161616]" dir="ltr">{discountLabel(row, locale)}</td>
      <td className="hidden px-4 py-3 text-[#161616] md:table-cell">{row.usageLimit === null ? t('usedOpen', { used: row.usedCount }) : t('used', { used: row.usedCount, limit: row.usageLimit })}</td>
      <td className="px-4 py-3">
        <span className={row.active ? 'font-semibold text-[#168A52]' : 'font-semibold text-[#8A8A86]'}>{row.active ? t('active') : t('paused')}</span>
      </td>
      <td className="px-4 py-3 text-end">
        <Button type="button" variant="outline" size="sm" loading={toggle.isPending} onClick={() => toggle.mutate()}>
          {row.active ? t('pause') : t('activate')}
        </Button>
      </td>
    </tr>
  );
}

function CreatePromoDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const t = useTranslations('merchantPromos');
  const common = useTranslations('common');
  const [form, setForm] = useState<Draft>(blankDraft);
  const create = useMutation({
    mutationFn: () => api.createMerchantPromo(toPayload(form)),
    onSuccess: async () => {
      toast.success(t('created'));
      await onCreated();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validateDraft(form);
    if (problem) {
      toast.error(t(problem));
      return;
    }
    create.mutate();
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[min(100%-2rem,40rem)] overflow-y-auto">
        <DialogTitle>{t('create')}</DialogTitle>
        <DialogDescription>{t('ownCart')}</DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={submit}>
          <Field label={t('code')} htmlFor="promo-code">
            <Input id="promo-code" className="mt-1 uppercase" dir="ltr" value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} required />
          </Field>
          <Field label={t('description')} htmlFor="promo-description">
            <Input id="promo-description" className="mt-1" value={form.description} onChange={(event) => set('description', event.target.value)} required />
          </Field>
          <Field label={t('descriptionAr')} htmlFor="promo-description-ar">
            <Input id="promo-description-ar" className="mt-1" dir="rtl" value={form.descriptionAr} onChange={(event) => set('descriptionAr', event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('discount')} htmlFor="promo-type">
              <select id="promo-type" className="mt-1 h-12 w-full rounded-xl border border-input bg-card px-3 text-base" value={form.discountType} onChange={(event) => set('discountType', event.target.value as DiscountType)}>
                <option value="PERCENTAGE">{t('percentage')}</option>
                <option value="FIXED">{t('fixed')}</option>
              </select>
            </Field>
            <Field label={form.discountType === 'PERCENTAGE' ? '%' : 'BHD'} htmlFor="promo-value">
              <Input id="promo-value" className="mt-1" inputMode="decimal" dir="ltr" value={form.discountValue} onChange={(event) => set('discountValue', event.target.value)} required />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('minimum')} htmlFor="promo-minimum" hint={t('minimumHint')}>
              <Input id="promo-minimum" className="mt-1" inputMode="decimal" dir="ltr" value={form.minimumOrder} onChange={(event) => set('minimumOrder', event.target.value)} />
            </Field>
            <Field label={t('usageLimit')} htmlFor="promo-uses" hint={t('usageLimitHint')}>
              <Input id="promo-uses" className="mt-1" inputMode="numeric" dir="ltr" value={form.usageLimit} onChange={(event) => set('usageLimit', event.target.value)} />
            </Field>
          </div>
          <Field label={t('perCustomer')} htmlFor="promo-per-customer">
            <Input id="promo-per-customer" className="mt-1" inputMode="numeric" dir="ltr" value={form.perCustomerLimit} onChange={(event) => set('perCustomerLimit', event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('starts')} htmlFor="promo-start">
              <Input id="promo-start" className="mt-1" type="datetime-local" dir="ltr" value={form.startsAt} onChange={(event) => set('startsAt', event.target.value)} required />
            </Field>
            <Field label={t('ends')} htmlFor="promo-end">
              <Input id="promo-end" className="mt-1" type="datetime-local" dir="ltr" value={form.endsAt} onChange={(event) => set('endsAt', event.target.value)} required />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-[#161616]">
            <input type="checkbox" checked={form.firstOrderOnly} onChange={(event) => set('firstOrderOnly', event.target.checked)} />
            {t('firstOrder')}
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{common('cancel')}</Button>
            <Button type="submit" variant="yellow" loading={create.isPending}>{t('save')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-xs text-[#8A8A86]">{hint}</p> : null}
    </div>
  );
}

function blankDraft(): Draft {
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    code: '',
    description: '',
    descriptionAr: '',
    discountType: 'PERCENTAGE',
    discountValue: '',
    minimumOrder: '',
    usageLimit: '',
    perCustomerLimit: '',
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    firstOrderOnly: false,
  };
}

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function moneyValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed) || Number(trimmed) <= 0) return undefined;
  return trimmed;
}

function wholeNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) return undefined;
  return Number(trimmed);
}

function validateDraft(form: Draft) {
  if (form.code.trim().length < 2) return 'codeRequired' as const;
  if (!form.description.trim()) return 'descriptionRequired' as const;
  const discount = moneyValue(form.discountValue);
  if (!discount) return 'discountRequired' as const;
  if (form.discountType === 'PERCENTAGE' && Number(discount) > 100) return 'percentageCap' as const;
  if (form.minimumOrder.trim() && moneyValue(form.minimumOrder) === undefined) return 'badAmount' as const;
  if (wholeNumber(form.usageLimit) === undefined || wholeNumber(form.perCustomerLimit) === undefined) return 'badLimit' as const;
  if (!form.startsAt || !form.endsAt || new Date(form.endsAt).getTime() <= new Date(form.startsAt).getTime()) return 'badDates' as const;
  return '';
}

function toPayload(form: Draft) {
  return {
    code: form.code.trim().toUpperCase(),
    description: form.description.trim(),
    descriptionAr: form.descriptionAr.trim() || undefined,
    discountType: form.discountType,
    discountValue: moneyValue(form.discountValue)!,
    minimumOrder: moneyValue(form.minimumOrder),
    usageLimit: wholeNumber(form.usageLimit),
    perCustomerLimit: wholeNumber(form.perCustomerLimit),
    startsAt: new Date(form.startsAt).toISOString(),
    endsAt: new Date(form.endsAt).toISOString(),
    firstOrderOnly: form.firstOrderOnly,
  };
}

function discountLabel(row: MerchantPromo, locale: 'en' | 'ar') {
  if (row.discountType === 'PERCENTAGE') {
    const value = Number(row.discountValue);
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
  }
  return formatMoney(row.discountValue, locale);
}
