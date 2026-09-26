'use client';

import { api } from '@/components/providers';
import { formatMoney } from '@alliva/design-tokens';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@alliva/ui';
import {
  BarChart3,
  Bell,
  Bike,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Globe,
  Headphones,
  Info,
  LayoutGrid,
  Megaphone,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  Smartphone,
  Star,
  Store,
  Tag,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import {
  annualFromMonthly,
  emptyForm,
  formFromPlan,
  moneyInput,
  slugify,
  toEntitlements,
  validatePlan,
  validatePlanStep,
  type PlanForm,
  type Visibility,
} from './plan-form';

type Plan = Parameters<typeof formFromPlan>[0] & { id: string };

const STEPS = ['basics', 'storefront', 'ordering', 'operations', 'review'] as const;

export function PlanDialog({ open, plan, order, onOpenChange, onSaved }: {
  open: boolean;
  plan: Plan | null;
  order: number;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('plans');
  const locale = useLocale() as 'en' | 'ar';
  const [form, setForm] = useState<PlanForm>(emptyForm());
  const [step, setStep] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setStep(0);
    setReviewed(false);
    setCodeTouched(Boolean(plan));
    setForm(plan ? formFromPlan(plan) : { ...emptyForm(), displayOrder: String(order) });
  }, [open, plan, order]);

  function update(partial: Partial<PlanForm>) {
    setForm((current) => {
      const next = { ...current, ...partial };
      if (!plan && !codeTouched && partial.nameEn !== undefined) {
        const slug = slugify(partial.nameEn);
        if (slug) next.code = slug;
      }
      return next;
    });
  }

  function goTo(target: number) {
    if (target === step) return;
    if (target < step) {
      setError('');
      setStep(target);
      return;
    }
    for (let index = step; index < target; index += 1) {
      const code = validatePlanStep(form, index);
      if (code) {
        setError(messageFor(code, t));
        setStep(index);
        return;
      }
    }
    setError('');
    setStep(target);
  }

  async function save(mode: 'draft' | 'publish') {
    if (mode === 'publish' && !reviewed) {
      setError(t('reviewRequired'));
      setStep(4);
      return;
    }
    const source = { ...form, status: mode === 'publish' ? 'ACTIVE' as const : 'DRAFT' as const };
    const problem = validatePlan(source);
    if (problem) {
      setError(messageFor(problem.code, t));
      setStep(problem.step);
      return;
    }
    setPending(true);
    setError('');
    const body = {
      code: source.code.trim().toLowerCase(),
      name: { en: source.nameEn.trim(), ar: source.nameAr.trim() || source.nameEn.trim() },
      description: { en: source.descriptionEn.trim() || source.nameEn.trim(), ar: source.descriptionAr.trim() || source.descriptionEn.trim() || source.nameEn.trim() },
      priceMonthly: moneyInput(source.priceMonthly),
      priceAnnual: moneyInput(source.priceAnnual || annualFromMonthly(source.priceMonthly)),
      status: source.status,
      displayOrder: Number(source.displayOrder || 0),
      recommended: source.recommended,
      entitlements: toEntitlements(source, plan?.entitlements),
    };
    try {
      if (plan) await api.updatePlan(plan.id, body);
      else await api.createPlan(body);
      await onSaved();
      onOpenChange(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }

  const steps = [
    { title: t('basics'), hint: t('stepBasicsHint') },
    { title: t('stepStorefront'), hint: t('stepStorefrontHint') },
    { title: t('stepOrdering'), hint: t('stepOrderingHint') },
    { title: t('stepOperations'), hint: t('stepOperationsHint') },
    { title: t('stepReview'), hint: t('stepReviewHint') },
  ];
  const footerHint = step === 0 ? t('draftHint') : step === 3 ? t('reviewBefore') : step === 4 ? t('saveDraftHint') : t('changesDraft');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,880px)] w-[min(100%-1rem,76rem)] flex-col overflow-hidden p-0">
        <div className="flex items-start gap-3 border-b px-5 py-4 pe-14">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-[#111111]">
            <Plus className="size-5" />
          </span>
          <div>
            <DialogTitle className="font-display text-[1.65rem] leading-none tracking-tight">{plan ? t('editPlan') : t('wizardTitle')}</DialogTitle>
            <DialogDescription className="mt-1">{t('wizardSubtitle')}</DialogDescription>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
          <nav className="border-b bg-[#FAFAF8] px-3 py-4 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-e" aria-label={t('wizardTitle')}>
            <p className="px-2 text-xs font-medium text-muted-foreground">{t('stepOf', { step: step + 1 })}</p>
            <ol className="mt-2 flex gap-1 overflow-x-auto lg:block lg:space-y-1">
              {steps.map((item, index) => {
                const active = index === step;
                return (
                  <li key={STEPS[index]}>
                    <button
                      type="button"
                      onClick={() => goTo(index)}
                      aria-current={active ? 'step' : undefined}
                      className={`flex w-full min-w-44 items-center gap-3 rounded-xl px-2 py-2 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-w-0 ${active ? 'bg-[#FFF6D4]' : 'hover:bg-white'}`}
                    >
                      <span className={`w-6 text-sm font-semibold ${active ? 'text-[#111111]' : 'text-[#B0B0A8]'}`}>{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <span className="block text-sm font-semibold">{item.title}</span>
                        <span className="block text-xs text-muted-foreground">{item.hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="min-h-0 px-5 py-5 lg:overflow-y-auto">
            {step === 0 ? <BasicsStep form={form} onChange={update} onCode={() => setCodeTouched(true)} showArchived={form.status === 'ARCHIVED' || plan?.status === 'ARCHIVED'} /> : null}
            {step === 1 ? <StorefrontStep form={form} onChange={update} /> : null}
            {step === 2 ? <OrderingStep form={form} onChange={update} /> : null}
            {step === 3 ? <OperationsStep form={form} onChange={update} /> : null}
            {step === 4 ? <ReviewStep form={form} locale={locale} reviewed={reviewed} onReviewed={setReviewed} onEdit={goTo} /> : null}
            {error ? <p className="mt-4 text-sm text-[#D9342B]" role="alert">{error}</p> : null}
          </div>

          <aside className="border-t bg-[#FAFAF8] px-4 py-5 lg:min-h-0 lg:overflow-y-auto lg:border-s lg:border-t-0">
            {step === 0 ? <BasicsAside form={form} locale={locale} /> : null}
            {step === 1 ? <PhonePreview form={form} /> : null}
            {step >= 2 ? <SummaryAside form={form} locale={locale} step={step} /> : null}
          </aside>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3">
          <p className="text-sm text-muted-foreground">{footerHint}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 rounded-xl border-[#E4E4E0] bg-white px-4" onClick={() => (step === 0 ? onOpenChange(false) : goTo(step - 1))}>
              {step === 0 ? t('cancel') : t('back')}
            </Button>
            <Button type="button" variant="outline" className="h-11 rounded-xl border-[#E4E4E0] bg-white px-4" disabled={pending} onClick={() => void save('draft')}>
              {t('saveDraft')}
            </Button>
            {step < 4 ? (
              <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" onClick={() => goTo(step + 1)}>
                {t('continue')} <ChevronRight className="size-4 rtl:rotate-180" />
              </Button>
            ) : (
              <Button type="button" variant="yellow" className="h-11 rounded-xl px-4" disabled={pending || !reviewed} onClick={() => void save('publish')}>
                {t('publishPlan')} <ChevronRight className="size-4 rtl:rotate-180" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BasicsStep({ form, onChange, onCode, showArchived }: {
  form: PlanForm;
  onChange: (partial: Partial<PlanForm>) => void;
  onCode: () => void;
  showArchived: boolean;
}) {
  const t = useTranslations('plans');
  return (
    <div>
      <h3 className="text-lg font-semibold">{t('planDetails')}</h3>
      <p className="mt-3 flex gap-2 rounded-xl bg-[#F7F7F5] px-3 py-2.5 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        {t('manyPlans')}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <TextField label={t('planName')} required value={form.nameEn} onChange={(nameEn) => onChange({ nameEn })} />
        <TextField label={t('code')} required hint={t('planCodeHint')} value={form.code} onChange={(code) => { onCode(); onChange({ code }); }} />
        <MoneyField label={t('priceMonthly')} required value={form.priceMonthly} onChange={(priceMonthly) => onChange({ priceMonthly, priceAnnual: annualFromMonthly(priceMonthly) })} />
        <label className="grid gap-1.5 text-sm font-semibold">
          {t('billingCycle')} <span className="text-[#D9342B]">*</span>
          <select className="h-12 rounded-xl border bg-white px-3 text-sm font-medium focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" value={form.billingCycle} onChange={(event) => onChange({ billingCycle: event.target.value as PlanForm['billingCycle'] })}>
            <option value="MONTHLY">{t('monthly')}</option>
            <option value="ANNUAL">{t('yearly')}</option>
          </select>
        </label>
      </div>
      <label className="mt-4 grid gap-1.5 text-sm font-semibold">
        {t('description')}
        <textarea
          maxLength={160}
          rows={3}
          value={form.descriptionEn}
          onChange={(event) => onChange({ descriptionEn: event.target.value })}
          className="resize-none rounded-xl border px-3 py-2 text-sm font-medium focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <span className="text-end text-xs font-medium text-muted-foreground">{form.descriptionEn.length}/160</span>
      </label>
      <div className="mt-1 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5 text-sm font-semibold">
          <span className="inline-flex items-center gap-1">{t('displayOrder')} <Info className="size-3.5 text-muted-foreground" /></span>
          <div className="flex h-12 items-center rounded-xl border bg-white pe-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40">
            <input inputMode="numeric" aria-label={t('displayOrder')} className="h-full w-full bg-transparent px-3 text-sm font-medium outline-none" value={form.displayOrder} onChange={(event) => onChange({ displayOrder: event.target.value })} />
            <span className="grid">
              <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={t('moveUp')} onClick={() => onChange({ displayOrder: String(Math.max(0, Number(form.displayOrder || 0) + 1)) })}><ChevronUp className="size-3.5" /></button>
              <button type="button" className="rounded p-0.5 hover:bg-muted" aria-label={t('moveDown')} onClick={() => onChange({ displayOrder: String(Math.max(0, Number(form.displayOrder || 0) - 1)) })}><ChevronDown className="size-3.5" /></button>
            </span>
          </div>
        </div>
        <fieldset>
          <legend className="text-sm font-semibold">{t('status')}</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {(['DRAFT', 'ACTIVE', ...(showArchived ? ['ARCHIVED'] as const : [])] as const).map((status) => (
              <label key={status} className="inline-flex items-center gap-2 text-sm font-semibold">
                <input type="radio" name="plan-status" className="size-4 accent-[#FFC400]" checked={form.status === status} onChange={() => onChange({ status })} />
                {status === 'DRAFT' ? t('draft') : status === 'ACTIVE' ? t('published') : t('archived')}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

function StorefrontStep({ form, onChange }: { form: PlanForm; onChange: (partial: Partial<PlanForm>) => void }) {
  const t = useTranslations('plans');
  const options: { id: Visibility; title: string; hint: string }[] = [
    { id: 'ALL_STORES', title: t('allStoresTitle'), hint: t('allStoresHint') },
    { id: 'EXCLUDE_SAME_BUSINESS_TYPE', title: t('excludeTitle'), hint: t('excludeHint') },
    { id: 'CURRENT_STORE_ONLY', title: t('currentTitle'), hint: t('currentHint') },
  ];
  return (
    <div>
      <h3 className="text-lg font-semibold">{t('storefrontSection')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('visibilityLead')}</p>
      <div className="mt-4 space-y-3" role="radiogroup" aria-label={t('visibility')}>
        {options.map((option) => {
          const selected = form.visibility === option.id;
          return (
            <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 focus-within:ring-2 focus-within:ring-primary ${selected ? 'border-primary bg-[#FFF8DE]' : 'border-[#ECECEA] bg-white'}`}>
              <input type="radio" name="visibility" className="mt-1 size-4 accent-[#FFC400]" checked={selected} onChange={() => onChange({ visibility: option.id })} />
              <span>
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="block text-sm text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl border bg-[#FAFAF8] p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Smartphone className="size-4" /> {t('directVisits')}</p>
        <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground"><Globe className="mt-0.5 size-4 shrink-0" /> {t('directVisitsBody')}</p>
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" /> {t('qrFirst')}</p>
    </div>
  );
}

function OrderingStep({ form, onChange }: { form: PlanForm; onChange: (partial: Partial<PlanForm>) => void }) {
  const t = useTranslations('plans');
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('stepOrdering')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('orderingLead')}</p>
      </div>
      <Panel title={t('capacity')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <LimitField label={t('productLimit')} value={form.productLimit} onChange={(productLimit) => onChange({ productLimit })} />
          <LimitField label={t('orderLimit')} value={form.monthlyOrderLimit} onChange={(monthlyOrderLimit) => onChange({ monthlyOrderLimit })} />
        </div>
      </Panel>
      <Panel title={t('orderTypes')}>
        <FeatureRow icon={Bike} title={t('deliveryOrdering')} hint={t('deliveryHint')} checked={form.deliveryOrdering} onChange={(deliveryOrdering) => onChange({ deliveryOrdering })} />
        <FeatureRow icon={ShoppingBag} title={t('takeawayOrdering')} hint={t('takeawayHint')} checked={form.takeawayOrdering} onChange={(takeawayOrdering) => onChange({ takeawayOrdering })} />
        <FeatureRow icon={UtensilsCrossed} title={t('dineIn')} hint={t('dineInHint')} checked={form.tableOrdering} onChange={(tableOrdering) => onChange({ tableOrdering })} />
        {form.tableOrdering ? (
          <div className="ps-12">
            <LimitField label={t('maxTables')} value={form.tableCountLimit} onChange={(tableCountLimit) => onChange({ tableCountLimit })} />
          </div>
        ) : null}
      </Panel>
      <Panel title={t('paymentsPromos')}>
        <FeatureRow icon={CreditCard} title={t('onlinePayments')} hint={t('paymentHint')} checked={form.paymentIntegration} onChange={(paymentIntegration) => onChange({ paymentIntegration })} />
        <FeatureRow icon={Star} title={t('highlightedOffers')} hint={t('offerHint')} checked={form.offerHighlighting} onChange={(offerHighlighting) => onChange({ offerHighlighting })} />
      </Panel>
    </div>
  );
}

function OperationsStep({ form, onChange }: { form: PlanForm; onChange: (partial: Partial<PlanForm>) => void }) {
  const t = useTranslations('plans');
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{t('stepOperations')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('operationsLead')}</p>
      </div>
      <Panel title={t('teamLocations')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <LimitField label={t('staff')} value={form.staffLimit} onChange={(staffLimit) => onChange({ staffLimit })} />
          <LimitField label={t('branches')} value={form.branchLimit} onChange={(branchLimit) => onChange({ branchLimit })} />
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" /> {t('staffNote')}</p>
      </Panel>
      <Panel title={t('merchantTools')}>
        <FeatureRow icon={Tag} title={t('promoCodes')} hint={t('promoHint')} checked={form.merchantPromoCodes} onChange={(merchantPromoCodes) => onChange({ merchantPromoCodes })} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-3 py-3">
          <div className="flex items-start gap-3">
            <IconBubble icon={BarChart3} />
            <span>
              <span className="block text-sm font-semibold">{t('reporting')}</span>
              <span className="block text-xs text-muted-foreground">{t('analyticsHint')}</span>
            </span>
          </div>
          <Segmented
            value={form.reporting}
            onChange={(reporting) => onChange({ reporting })}
            options={[['BASIC', t('basic')], ['STANDARD', t('standard')], ['ADVANCED', t('advanced')]]}
          />
        </div>
      </Panel>
      <Panel title={t('customerCommunication')}>
        <FeatureRow icon={Bell} title={t('orderNotify')} hint={t('orderNotifyHint')} checked={form.transactionalNotifications} onChange={(transactionalNotifications) => onChange({ transactionalNotifications })} />
        <FeatureRow icon={Megaphone} title={t('promoNotify')} hint={t('promoNotifyHint')} checked={form.promotionalNotifications} onChange={(promotionalNotifications) => onChange({ promotionalNotifications })} />
      </Panel>
      <Panel title={t('support')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <IconBubble icon={Headphones} />
            <span>
              <span className="block text-sm font-semibold">{t('support')}</span>
              <span className="block text-xs text-muted-foreground">{t('supportHint')}</span>
            </span>
          </div>
          <Segmented
            value={form.supportLevel}
            onChange={(supportLevel) => onChange({ supportLevel })}
            options={[['STANDARD', t('standard')], ['PRIORITY', t('priority')]]}
          />
        </div>
      </Panel>
    </div>
  );
}

function ReviewStep({ form, locale, reviewed, onReviewed, onEdit }: {
  form: PlanForm;
  locale: 'en' | 'ar';
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  onEdit: (step: number) => void;
}) {
  const t = useTranslations('plans');
  const price = priceLabel(form, locale);
  const visibility = form.visibility === 'CURRENT_STORE_ONLY' ? t('currentTitle') : form.visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('excludeTitle') : t('allStoresTitle');
  const suggestion = form.visibility === 'CURRENT_STORE_ONLY' ? t('noOtherStores') : form.visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('otherTypesOnly') : t('sameTypeIncluded');
  return (
    <div>
      <h3 className="text-lg font-semibold">{t('reviewTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('reviewLead')}</p>
      <div className="mt-4 space-y-3">
        <ReviewCard icon={LayoutGrid} title={t('basics')} onEdit={() => onEdit(0)} editLabel={t('edit')}>
          <ReviewLine label={t('planName')} value={form.nameEn || '—'} />
          <ReviewLine label={t('priceMonthly')} value={form.billingCycle === 'ANNUAL' ? t('perYearPrice', { price }) : t('perMonthPrice', { price })} />
          <ReviewLine label={t('code')} value={form.code || '—'} />
          <ReviewLine label={t('status')} value={<StatusText status={form.status} />} />
        </ReviewCard>
        <ReviewCard icon={Store} title={t('storefrontSection')} onEdit={() => onEdit(1)} editLabel={t('edit')}>
          <ReviewLine label={t('storeAccess')} value={visibility} />
          <ReviewLine label={t('visibility')} value={suggestion} />
          <ReviewLine label={t('marketplaceAccess')} value={t('fullMarketplace')} />
        </ReviewCard>
        <ReviewCard icon={ShoppingBag} title={t('stepOrdering')} onEdit={() => onEdit(2)} editLabel={t('edit')}>
          <ReviewLine label={t('products')} value={t('productsCount', { count: countLabel(form.productLimit, t, locale) })} />
          <ReviewLine label={t('orders')} value={t('ordersPerMonth', { count: countLabel(form.monthlyOrderLimit, t, locale) })} />
          <ReviewLine label={t('orderTypes')} value={orderTypeLabel(form, t)} />
          <ReviewLine label={t('tableOrdering')} value={form.tableOrdering ? countLabel(form.tableCountLimit, t, locale) : t('off')} />
          <ReviewLine label={t('onlinePayments')} value={form.paymentIntegration ? t('paymentsOn') : t('paymentsOff')} />
          <ReviewLine label={t('highlightedOffers')} value={form.offerHighlighting ? t('offerOn') : t('offerOff')} />
        </ReviewCard>
        <ReviewCard icon={Users} title={t('stepOperations')} onEdit={() => onEdit(3)} editLabel={t('edit')}>
          <ReviewLine label={t('staff')} value={t('staffCount', { count: countLabel(form.staffLimit, t, locale) })} />
          <ReviewLine label={t('branches')} value={branchLabel(form.branchLimit, t, locale)} />
          <ReviewLine label={t('promoCodes')} value={form.merchantPromoCodes ? t('promoOn') : t('promoOff')} />
          <ReviewLine label={t('reporting')} value={form.reporting === 'ADVANCED' ? t('analyticsAdvanced') : form.reporting === 'STANDARD' ? t('analyticsStandard') : t('analyticsBasic')} />
          <ReviewLine label={t('customerNotifications')} value={notificationLabel(form, t)} />
          <ReviewLine label={t('support')} value={form.supportLevel === 'PRIORITY' ? t('supportPriority') : t('supportStandard')} />
        </ReviewCard>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="size-4 accent-[#FFC400]" checked={reviewed} onChange={(event) => onReviewed(event.target.checked)} />
        {t('reviewed')}
      </label>
    </div>
  );
}

function BasicsAside({ form, locale }: { form: PlanForm; locale: 'en' | 'ar' }) {
  const t = useTranslations('plans');
  const name = form.nameEn.trim() || t('planName');
  const next = [
    { icon: Store, title: t('nextStorefront'), hint: t('nextStorefrontHint') },
    { icon: Package, title: t('nextProducts'), hint: t('nextProductsHint') },
    { icon: CreditCard, title: t('nextOrdering'), hint: t('nextOrderingHint') },
    { icon: Users, title: t('nextStaff'), hint: t('nextStaffHint') },
    { icon: Bell, title: t('nextNotify'), hint: t('nextNotifyHint') },
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-[#FFF6D4] p-4">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-[#8A6A00]">{t('preview')}</p>
        <div className="mt-2 flex items-start justify-between gap-2">
          <h3 className="font-display text-2xl leading-tight">{name}</h3>
          <StatusText status={form.status} />
        </div>
        <p className="mt-2 text-sm font-semibold">{priceLabel(form, locale)} <span className="font-medium text-[#696965]">{form.billingCycle === 'ANNUAL' ? t('perYear') : t('perMonth')}</span></p>
        <p className="mt-3 text-xs leading-5 text-[#696965]">{t('previewNote')}</p>
      </section>
      <section>
        <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground">{t('nextSteps')}</p>
        <ul className="mt-2 space-y-3">
          {next.map((item) => (
            <li key={item.title} className="flex gap-3">
              <IconBubble icon={item.icon} />
              <span>
                <span className="block text-sm font-semibold">{item.title}</span>
                <span className="block text-xs text-muted-foreground">{item.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PhonePreview({ form }: { form: PlanForm }) {
  const t = useTranslations('plans');
  const suggestions = form.visibility !== 'CURRENT_STORE_ONLY';
  return (
    <div>
      <p className="text-sm font-semibold">{t('customerPreview')}</p>
      <div className="mx-auto mt-3 w-[220px] rounded-[2rem] border-[6px] border-[#111111] bg-white shadow-lg">
        <div className="flex items-center justify-between px-4 pt-2 text-[10px] font-semibold">
          <span>9:41</span>
          <span className="h-4 w-16 rounded-full bg-[#111111]" />
          <span>●●●</span>
        </div>
        <div className="relative mx-3 mt-2 h-24 overflow-hidden rounded-xl bg-gradient-to-br from-[#F4A261] via-[#E76F51] to-[#6B3F2A]">
          <span className="absolute start-2 top-2 grid size-6 place-items-center rounded-full bg-white/90 text-xs">‹</span>
          <span className="absolute end-2 top-2 grid size-6 place-items-center rounded-full bg-white/90 text-xs">⤴</span>
        </div>
        <div className="px-3 pb-3 pt-2">
          <p className="text-sm font-semibold">{t('sampleStore')}</p>
          <p className="text-[10px] text-muted-foreground">{t('sampleMeta')}</p>
          <p className="text-[10px] font-semibold text-[#C49200]">★ 4.8 (320)</p>
          <div className="mt-2 flex gap-3 border-b text-[10px] font-semibold">
            <span className="border-b-2 border-[#111111] pb-1">{t('menu')}</span>
            <span className="text-muted-foreground">{t('about')}</span>
            <span className="text-muted-foreground">{t('reviews')}</span>
          </div>
          {suggestions ? (
            <div className="mt-2">
              <p className="text-[10px] font-semibold">{t('youMayAlsoLike')}</p>
              <Suggestion name={t('sampleBakery')} meta={t('sampleBakeryMeta')} tone="from-[#F6C28B] to-[#C9844A]" />
              <Suggestion name={t('sampleGrocery')} meta={t('sampleGroceryMeta')} tone="from-[#8FBF7A] to-[#3E7A45]" />
            </div>
          ) : <p className="mt-3 rounded-lg bg-[#F7F7F5] px-2 py-2 text-[10px] text-muted-foreground">{t('noSuggestions')}</p>}
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">{t('previewCaption')}</p>
    </div>
  );
}

function Suggestion({ name, meta, tone }: { name: string; meta: string; tone: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className={`size-9 rounded-lg bg-gradient-to-br ${tone}`} />
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold">{name}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{meta}</span>
      </span>
      <ChevronRight className="ms-auto size-3 text-muted-foreground rtl:rotate-180" />
    </div>
  );
}

function SummaryAside({ form, locale, step }: { form: PlanForm; locale: 'en' | 'ar'; step: number }) {
  const t = useTranslations('plans');
  const rows = step === 2
    ? [
        [t('products'), countLabel(form.productLimit, t, locale)],
        [t('orders'), t('perMonthCount', { count: countLabel(form.monthlyOrderLimit, t, locale) })],
        [t('orderTypes'), orderTypeLabel(form, t)],
        [t('tableOrdering'), form.tableOrdering ? countLabel(form.tableCountLimit, t, locale) : t('off')],
        [t('onlinePayments'), form.paymentIntegration ? t('on') : t('off')],
      ]
    : step === 3
      ? [
          [t('staff'), countLabel(form.staffLimit, t, locale)],
          [t('branches'), countLabel(form.branchLimit, t, locale)],
          [t('promoCodes'), form.merchantPromoCodes ? t('on') : t('off')],
          [t('reporting'), form.reporting === 'ADVANCED' ? t('advanced') : form.reporting === 'STANDARD' ? t('standard') : t('basic')],
          [t('customerNotifications'), form.transactionalNotifications || form.promotionalNotifications ? t('on') : t('off')],
          [t('support'), form.supportLevel === 'PRIORITY' ? t('priority') : t('standard')],
        ]
      : [
          [t('products'), countLabel(form.productLimit, t, locale)],
          [t('orders'), t('perMonthCount', { count: countLabel(form.monthlyOrderLimit, t, locale) })],
          [t('storeAccess'), form.visibility === 'CURRENT_STORE_ONLY' ? t('currentTitle') : form.visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('excludeTitle') : t('allStoresTitle')],
          [t('tableOrdering'), form.tableOrdering ? countLabel(form.tableCountLimit, t, locale) : t('off')],
          [t('onlinePayments'), form.paymentIntegration ? t('on') : t('off')],
          [t('promoCodes'), form.merchantPromoCodes ? t('on') : t('off')],
          [t('reporting'), form.reporting === 'ADVANCED' ? t('advanced') : form.reporting === 'STANDARD' ? t('standard') : t('basic')],
          [t('customerNotifications'), form.transactionalNotifications || form.promotionalNotifications ? t('on') : t('off')],
          [t('support'), form.supportLevel === 'PRIORITY' ? t('priority') : t('standard')],
        ];
  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-[#FFF6D4] p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-2xl leading-tight">{form.nameEn.trim() || t('planName')}</h3>
          <StatusText status={form.status} />
        </div>
        <p className="mt-1 text-sm font-semibold">{priceLabel(form, locale)} <span className="font-medium text-[#696965]">{form.billingCycle === 'ANNUAL' ? t('perYear') : t('perMonth')}</span></p>
      </section>
      <ul className="space-y-2 px-1 text-sm">
        {rows.map(([label, value]) => (
          <li key={label} className="flex items-start justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-end font-semibold">{value}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {step === 4 ? t('publishNote') : step === 3 ? t('draftUntilPublished') : t('deliveryFeesNote')}
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border p-4">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function TextField({ label, value, onChange, hint, required }: { label: string; value: string; onChange: (value: string) => void; hint?: string; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      <span>{label} {required ? <span className="text-[#D9342B]">*</span> : null}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="h-12 rounded-xl border bg-white px-3 text-sm font-medium focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
      {hint ? <span className="text-xs font-medium text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function MoneyField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold">
      <span>{label} {required ? <span className="text-[#D9342B]">*</span> : null}</span>
      <span className="flex h-12 items-center rounded-xl border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40">
        <span className="ps-3 text-xs font-semibold text-muted-foreground">BHD</span>
        <input inputMode="decimal" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-full w-full bg-transparent px-2 text-sm font-medium outline-none" />
      </span>
    </label>
  );
}

function LimitField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const t = useTranslations('plans');
  const unlimited = value.trim() === '';
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <div className="flex items-center gap-3">
        <input
          inputMode="numeric"
          disabled={unlimited}
          aria-label={label}
          value={unlimited ? '' : value}
          placeholder={unlimited ? '—' : ''}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full rounded-xl border bg-white px-3 text-sm font-medium focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:bg-[#F7F7F5]"
        />
        <Switch checked={unlimited} label={t('unlimited')} onChange={(on) => onChange(on ? '' : '1')} />
      </div>
    </div>
  );
}

function FeatureRow({ icon: Icon, title, hint, checked, onChange }: {
  icon: typeof Store;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border px-3 py-3">
      <div className="flex items-start gap-3">
        <IconBubble icon={Icon} />
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
      </div>
      <Switch checked={checked} label={title} hideLabel onChange={onChange} />
    </div>
  );
}

function Switch({ checked, onChange, label, hideLabel }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hideLabel?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-primary' : 'bg-[#E4E4E0]'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow ${checked ? 'start-[22px]' : 'start-0.5'}`} />
      </span>
      {hideLabel ? null : <span className="text-sm font-medium text-muted-foreground">{label}</span>}
    </button>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex rounded-xl bg-[#F3F3F1] p-1" role="radiogroup">
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)} className={`h-8 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${value === id ? 'bg-primary text-[#111111]' : 'text-muted-foreground'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function IconBubble({ icon: Icon }: { icon: typeof Store }) {
  return <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#F7F6F2] text-[#111111]"><Icon className="size-4" /></span>;
}

function StatusText({ status }: { status: PlanForm['status'] }) {
  const t = useTranslations('plans');
  const label = status === 'ACTIVE' ? t('published') : status === 'ARCHIVED' ? t('archived') : t('draft');
  const tone = status === 'ACTIVE' ? 'bg-[#E7F6EE] text-[#168A52]' : status === 'ARCHIVED' ? 'bg-muted text-muted-foreground' : 'bg-primary text-[#111111]';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

function ReviewCard({ icon: Icon, title, onEdit, editLabel, children }: {
  icon: typeof Store;
  title: string;
  onEdit: () => void;
  editLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border p-4">
      <div className="flex items-center justify-between">
        <h4 className="inline-flex items-center gap-2 text-sm font-semibold"><Icon className="size-4" /> {title}</h4>
        <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-[#111111] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={onEdit}>
          <Pencil className="size-3.5" /> {editLabel}
        </button>
      </div>
      <dl className="mt-3 space-y-1.5">{children}</dl>
    </section>
  );
}

function ReviewLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-semibold">{value}</dd>
    </div>
  );
}

function priceLabel(form: PlanForm, locale: 'en' | 'ar') {
  const raw = form.billingCycle === 'ANNUAL' ? annualFromMonthly(form.priceMonthly || '0') : form.priceMonthly || '0';
  return formatMoney(raw, locale);
}

function countLabel(value: string, t: ReturnType<typeof useTranslations<'plans'>>, locale: 'en' | 'ar') {
  if (!value.trim()) return t('unlimited');
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat(locale === 'ar' ? 'ar-BH' : 'en-BH').format(amount) : value;
}

function branchLabel(value: string, t: ReturnType<typeof useTranslations<'plans'>>, locale: 'en' | 'ar') {
  if (!value.trim()) return t('unlimited');
  if (Number(value) === 1) return t('branchOne');
  return t('branchesCount', { count: countLabel(value, t, locale) });
}

function orderTypeLabel(form: PlanForm, t: ReturnType<typeof useTranslations<'plans'>>) {
  const names = [
    form.deliveryOrdering ? t('deliveryShort') : '',
    form.takeawayOrdering ? t('takeawayShort') : '',
    form.tableOrdering ? t('dineShort') : '',
  ].filter(Boolean);
  return names.length ? names.join(' · ') : t('off');
}

function notificationLabel(form: PlanForm, t: ReturnType<typeof useTranslations<'plans'>>) {
  if (form.transactionalNotifications && form.promotionalNotifications) return t('notificationsBoth');
  if (form.transactionalNotifications) return t('notificationsOrders');
  if (form.promotionalNotifications) return t('notificationsPromos');
  return t('notificationsOff');
}

function messageFor(code: string, t: ReturnType<typeof useTranslations<'plans'>>) {
  if (code === 'code') return t('invalidCode');
  if (code === 'price') return t('invalidPrice');
  if (code === 'limit' || code === 'tables') return t('invalidLimit');
  if (code === 'order') return t('invalidOrder');
  if (code === 'description') return t('descriptionTooLong');
  return t('nameRequired');
}
