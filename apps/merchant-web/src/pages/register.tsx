import { api } from '@/components/providers';
import { Link, useRouter } from '@/i18n/navigation';
import { formatMoney, pickLocalized } from '@alliva/design-tokens';
import type { SubscriptionPlanView } from '@alliva/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@alliva/ui';
import { ArrowRight, BarChart3, Building2, Check, CheckCircle2, CreditCard, Crown, Eye, EyeOff, Hash, Landmark, Link2, Lock, Mail, MapPin, Phone, RefreshCw, ShieldCheck, Smartphone, Store, Tag, Ticket, TrendingUp, Truck, Zap } from 'lucide-react';
import { useLocale, useTranslations } from 'use-intl';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

export default function RegisterPage() {
  const t = useTranslations('register');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();
  const [params] = useSearchParams();
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api.publicPlans() });
  const categories = useQuery({ queryKey: ['business-categories'], queryFn: () => api.businessCategories() });
  const methods = useQuery({ queryKey: ['public-payment-methods'], queryFn: () => api.publicPaymentMethods() });
  const offered = methods.data ?? [];
  const chosenMethods = offered.map((method) => method.code);
  const [step, setStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<'card' | 'benefit' | 'bank'>('card');
  const [saveCard, setSaveCard] = useState(true);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [card, setCard] = useState({ name: '', number: '', expiry: '', cvv: '' });
  const [interval, setInterval] = useState<'MONTHLY' | 'ANNUAL'>(params.get('interval') === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY');
  const [planId, setPlanId] = useState(params.get('plan') ?? '');
  const [form, setForm] = useState({
    email: '',
    password: '',
    businessName: '',
    categoryId: '',
    otherType: '',
    phone: '',
    crNumber: '',
    promoCode: params.get('promo') ?? '',
    referralCode: params.get('ref') ?? '',
  });
  const normalizedEmail = form.email.trim().toLowerCase();
  const emailFormatValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const emailToCheck = useDebounced(normalizedEmail, 450);
  const referralCode = useDebounced(form.referralCode.trim(), 400);
  const promoCode = useDebounced(form.promoCode.trim(), 400);
  const emailAvailability = useQuery({
    queryKey: ['merchant-email-availability', emailToCheck],
    queryFn: () => api.merchantEmailAvailability(emailToCheck),
    enabled: emailFormatValid && emailToCheck === normalizedEmail,
    retry: false,
    staleTime: 30_000,
  });
  const referralCheck = useQuery({
    queryKey: ['referral-check', referralCode],
    queryFn: () => api.validateReferral(referralCode),
    enabled: Boolean(referralCode),
    retry: false,
    staleTime: 60_000,
  });
  const quote = useQuery({
    queryKey: ['subscription-quote', planId, interval, promoCode],
    queryFn: () => api.quoteSubscription({ planId, billingInterval: interval, promoCode: promoCode || undefined }),
    enabled: Boolean(planId),
    retry: false,
  });
  const referralWaiting = Boolean(form.referralCode.trim()) && (form.referralCode.trim() !== referralCode || referralCheck.isFetching);
  const referralBad = Boolean(referralCode) && form.referralCode.trim() === referralCode && !referralCheck.isFetching && (referralCheck.isError || (referralCheck.data && !referralCheck.data.valid));
  const promoWaiting = Boolean(form.promoCode.trim()) && (form.promoCode.trim() !== promoCode || quote.isFetching);
  const promoBad = Boolean(promoCode) && form.promoCode.trim() === promoCode && !quote.isFetching && quote.data?.promo?.valid === false;
  const emailWaiting = emailFormatValid && (emailToCheck !== normalizedEmail || emailAvailability.isFetching);
  const emailTaken = emailFormatValid && emailToCheck === normalizedEmail && emailAvailability.data?.available === false;
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'form' | 'working' | 'welcome'>('form');
  const list = [...(plans.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder || Number(a.priceMonthly) - Number(b.priceMonthly));
  const selectedPlan = list.find((plan) => plan.id === planId);
  const startedAt = useRef(0);
  const holdTimer = useRef<number | undefined>(undefined);
  const submitting = useRef(false);
  const routerRef = useRef(router);
  routerRef.current = router;
  const register = useMutation({
    mutationFn: async () => {
      if (!planId) throw new Error(t('selectPlan'));
      const other = form.categoryId === 'other';
      if (!other && !form.categoryId) throw new Error(t('businessType'));
      if (other && form.otherType.trim().length < 2) throw new Error(t('otherType'));
      const category = (categories.data ?? []).find((item) => item.id === form.categoryId);
      const owner = form.email.split('@')[0] || form.businessName;
      const website = `www.${form.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'store'}.bh`;
      await api.registerMerchant({
        businessName: form.businessName,
        website,
        businessType: other ? form.otherType.trim() : (category ? pickLocalized(category.name, locale) || category.slug : form.otherType.trim()),
        categoryId: other ? undefined : form.categoryId,
        city: 'Manama',
        phone: form.phone,
        email: form.email,
        firstName: owner,
        lastName: form.businessName,
        password: form.password,
        planId,
        billingInterval: interval,
        promoCode: form.promoCode.trim() || undefined,
        referralCode: form.referralCode.trim() || undefined,
        delivery: true,
        takeaway: true,
        paymentMethods: chosenMethods,
      });
      await api.login({ email: form.email, password: form.password });
    },
    onSuccess: () => {
      const wait = Math.max(0, 1700 - (Date.now() - startedAt.current));
      holdTimer.current = window.setTimeout(() => setPhase('welcome'), wait);
    },
    onError: (reason: Error) => {
      window.clearTimeout(holdTimer.current);
      submitting.current = false;
      setPhase('form');
      setError(reason.message);
    },
  });
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [step]);
  useEffect(() => {
    if (phase !== 'welcome') return;
    const timer = window.setTimeout(() => routerRef.current.push('/dashboard'), 2100);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const continueAccount = () => {
    const next: Record<string, string> = {};
    if (!emailFormatValid) next.email = t('emailInvalid');
    else if (emailWaiting) next.email = t('emailChecking');
    else if (emailTaken) next.email = t('emailExists');
    else if (emailAvailability.isError || !emailAvailability.data) next.email = t('emailCheckFailed');
    if (form.password.length < 8) next.password = t('passwordShort');
    if (form.businessName.trim().length < 2) next.businessName = t('required');
    if (form.phone.trim().length < 8) next.phone = t('required');
    if (!form.categoryId) next.categoryId = t('required');
    if (form.categoryId === 'other' && form.otherType.trim().length < 2) next.otherType = t('required');
    if (!acceptedTerms) next.terms = t('termsRequired');
    setFieldErrors(next);
    if (Object.keys(next).length) return;
    setError('');
    setStep(1);
  };

  const continuePlan = () => {
    if (!planId) {
      setFieldErrors({ planId: t('selectPlan') });
      return;
    }
    setFieldErrors({});
    setError('');
    setStep(2);
  };

  const submitRegistration = () => {
    const next: Record<string, string> = {};
    if (paymentChoice === 'card') {
      if (card.name.trim().length < 2) next.cardName = t('required');
      if (card.number.replace(/\D/g, '').length < 12) next.cardNumber = t('cardInvalid');
      if (card.expiry.replace(/\D/g, '').length < 4) next.expiry = t('required');
      if (card.cvv.replace(/\D/g, '').length < 3) next.cvv = t('required');
    }
    if (!paymentConfirmed) next.paymentConfirmation = t('paymentConfirmationRequired');
    if (Object.keys(next).length) {
      setFieldErrors(next);
      return;
    }
    if (methods.isLoading) {
      setError(t('paymentLoading'));
      return;
    }
    if (!offered.length) {
      setError(t('paymentEmpty'));
      return;
    }
    if (referralBad || promoBad) {
      setError(t('fixCodes'));
      return;
    }
    if (submitting.current) return;
    setFieldErrors({});
    setError('');
    submitting.current = true;
    startedAt.current = Date.now();
    setPhase('working');
    register.mutate();
  };

  return (
    <div className="grid h-dvh overflow-hidden bg-white lg:grid-cols-[47%_53%]">
      <aside className="relative hidden flex-col overflow-hidden bg-primary px-10 py-10 text-[#111111] lg:flex xl:px-14 xl:py-14">
        <img src="/route-map.png" alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30" />
        <div className="relative z-10 max-w-[34rem]">
          <h1 className="font-display text-[3.35rem] leading-[1.02] tracking-[-0.04em] xl:text-[4.2rem]">{t('headline')}</h1>
          <p className="mt-3 max-w-md text-lg leading-relaxed">{t('subhead')}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <FeaturePill icon={Zap}>{t('easySetup')}</FeaturePill>
            <FeaturePill icon={Truck}>{t('ownDelivery')}</FeaturePill>
            <FeaturePill icon={BarChart3}>{t('growOrders')}</FeaturePill>
          </div>
        </div>
        <img src="/merchant-hero.png" alt="" className="relative z-10 mx-auto mt-auto h-auto max-h-[45%] w-auto max-w-[90%] object-contain" />
      </aside>
      <main className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
        {phase !== 'form' ? (
          <RegistrationFinale
            phase={phase}
            title={phase === 'welcome' ? t('welcomeTitle') : t('finishingTitle')}
            lead={phase === 'welcome' ? t('welcomeLead', { name: form.businessName.trim() }) : undefined}
            nextLabel={t('welcomeNext')}
            steps={[t('finishingPayment'), t('finishingStore', { name: form.businessName.trim() }), t('finishingPortal')]}
          />
        ) : (
        <>
        <header className="shrink-0 border-b border-[#ecece8] bg-white px-5 py-3.5 sm:px-10 lg:px-12 xl:px-16">
          <div className="mx-auto flex w-full max-w-[640px] items-center gap-3 sm:gap-5">
            <img src="/logo-on-light.png" alt="Alliva" className="h-8 w-auto shrink-0 sm:h-9" />
            <RegistrationSteps step={step} labels={[t('stepAccount'), t('stepChoosePlan'), t('stepPayment')]} />
          </div>
        </header>
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-10 lg:px-12 xl:px-16">
        <div className="mx-auto w-full max-w-[640px]">
          <div>
            <h2 className="font-display text-[2rem] leading-tight tracking-[-0.03em]">{step === 0 ? t('title') : step === 1 ? t('choosePlan') : t('paymentTitle')}</h2>
            <p className="mt-1.5 text-sm text-[#6b6b66]">{step === 0 ? t('lead') : step === 1 ? t('choosePlanHint') : t('paymentLead')}</p>
          </div>
          <div className={`mt-6 ${step === 0 ? 'mx-auto w-full max-w-[560px]' : ''}`}>
          {step === 0 ? (
            <div className="mx-auto w-full max-w-[560px]">
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <IconField icon={Mail} label={t('email')} value={form.email} error={fieldErrors.email || (normalizedEmail && !emailFormatValid ? t('emailInvalid') : undefined) || (emailTaken ? t('emailExists') : undefined)} onChange={(email) => { setForm({ ...form, email }); setFieldErrors((current) => ({ ...current, email: '' })); }} type="email" placeholder={t('emailPlaceholder')} autoComplete="email" />
                  {emailWaiting ? <p className="mt-1 text-[10px] text-[#6b6b66]">{t('emailChecking')}</p> : null}
                  {!emailWaiting && emailFormatValid && emailAvailability.data?.available ? <p className="mt-1 text-[10px] font-medium text-[#147D54]">{t('emailAvailable')}</p> : null}
                  {!emailWaiting && emailAvailability.isError ? <p className="mt-1 text-[10px] font-medium text-[#D9342B]">{t('emailCheckFailed')}</p> : null}
                </div>
                <IconField icon={Lock} label={t('password')} value={form.password} error={fieldErrors.password} onChange={(password) => { setForm({ ...form, password }); setFieldErrors((current) => ({ ...current, password: '' })); }} type={showPassword ? 'text' : 'password'} placeholder={t('passwordPlaceholder')} autoComplete="new-password" trailing={<button type="button" onClick={() => setShowPassword((value) => !value)} className="flex size-8 items-center justify-center text-[#777773]" aria-label={showPassword ? t('hidePassword') : t('showPassword')}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>} />
                <IconField icon={Store} label={t('businessName')} value={form.businessName} error={fieldErrors.businessName} onChange={(businessName) => { setForm({ ...form, businessName }); setFieldErrors((current) => ({ ...current, businessName: '' })); }} placeholder={t('businessNamePlaceholder')} autoComplete="organization" />
                <IconField icon={Phone} label={t('mobile')} value={form.phone} error={fieldErrors.phone} onChange={(phone) => { setForm({ ...form, phone }); setFieldErrors((current) => ({ ...current, phone: '' })); }} placeholder={t('mobilePlaceholder')} type="tel" autoComplete="tel" />
                <IconField icon={Hash} label={t('crNumber')} value={form.crNumber} onChange={(crNumber) => setForm({ ...form, crNumber })} placeholder={t('crPlaceholder')} />
                <label className="block text-xs font-semibold">
                  {t('businessType')}
                  <span className={`mt-1.5 flex h-10 items-center gap-2 rounded-md border bg-white px-3 transition-colors focus-within:border-[#111111] ${fieldErrors.categoryId ? 'border-[#D9342B]' : 'border-[#d8d8d4]'}`}>
                    <Building2 className="size-4 shrink-0 text-[#777773]" />
                    <select value={form.categoryId} onChange={(event) => { setForm({ ...form, categoryId: event.target.value }); setFieldErrors((current) => ({ ...current, categoryId: '', otherType: '' })); }} className="h-full w-full bg-transparent text-sm outline-none">
                      <option value="">{t('businessType')}</option>
                      {(categories.data ?? []).map((category) => (
                        <option key={category.id} value={category.id}>{pickLocalized(category.name, locale) || category.slug}</option>
                      ))}
                      <option value="other">{t('other')}</option>
                    </select>
                  </span>
                  {fieldErrors.categoryId ? <span className="mt-1 block text-xs font-medium text-[#D9342B]">{fieldErrors.categoryId}</span> : null}
                </label>
                {form.categoryId === 'other' ? <IconField icon={Building2} label={t('otherType')} value={form.otherType} error={fieldErrors.otherType} onChange={(otherType) => { setForm({ ...form, otherType }); setFieldErrors((current) => ({ ...current, otherType: '' })); }} /> : null}
                <div className="sm:col-span-2">
                  <IconField icon={Link2} label={t('referral')} value={form.referralCode} onChange={(referralCode) => setForm({ ...form, referralCode: referralCode.toUpperCase() })} placeholder={t('referralPlaceholder')} />
                  {referralWaiting ? <p className="mt-1 ps-1 text-xs text-[#6b6b66]">{t('referralChecking')}</p> : null}
                  {!referralWaiting && referralCheck.data?.valid && referralCode ? <p className="mt-1 ps-1 text-xs font-medium text-[#147D54]">{t('referralValid', { name: referralCheck.data.staffName })}</p> : null}
                  {!referralWaiting && referralBad ? <p className="mt-1 ps-1 text-xs font-medium text-[#D9342B]">{t('referralInvalid')}</p> : null}
                </div>
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-[#3f3f3c]">
                <input type="checkbox" checked={acceptedTerms} onChange={(event) => { setAcceptedTerms(event.target.checked); setFieldErrors((current) => ({ ...current, terms: '' })); }} className="mt-0.5 size-4 shrink-0 accent-[#FFC400]" />
                <span>{t('agree')} <a href="/legal/terms" className="font-medium text-[#111111] underline">{t('terms')}</a> {t('and')} <a href="/legal/privacy" className="font-medium text-[#111111] underline">{t('privacy')}</a>.</span>
              </label>
              {fieldErrors.terms ? <p className="mt-1 text-xs font-medium text-[#D9342B]">{fieldErrors.terms}</p> : null}
            </div>
          ) : step === 1 ? (
            <div>
              <div className="ms-auto flex w-full max-w-52 rounded-full bg-[#F1F1EE] p-1">
                <button type="button" className={`h-8 flex-1 rounded-full text-xs font-semibold transition-colors ${interval === 'MONTHLY' ? 'bg-primary text-[#111111] shadow-sm' : 'text-[#6b6b66]'}`} onClick={() => setInterval('MONTHLY')}>{t('monthly')}</button>
                <button type="button" className={`h-8 flex-1 rounded-full text-xs font-semibold transition-colors ${interval === 'ANNUAL' ? 'bg-primary text-[#111111] shadow-sm' : 'text-[#6b6b66]'}`} onClick={() => setInterval('ANNUAL')}>{t('yearly')}</button>
              </div>
              {fieldErrors.planId ? <p className="mt-3 text-sm font-medium text-[#D9342B]">{fieldErrors.planId}</p> : null}
              <div className="mt-2 grid snap-x grid-flow-col auto-cols-[85%] items-stretch gap-2.5 overflow-x-auto px-0.5 pb-2 pt-4 sm:auto-cols-[calc((100%-1.25rem)/3)]">
                {list.map((plan) => (
                  <PlanChoice key={plan.id} plan={plan} locale={locale} selected={planId === plan.id} yearly={interval === 'ANNUAL'} onSelect={() => { setPlanId(plan.id); setFieldErrors((current) => ({ ...current, planId: '' })); }} monthlyLabel={t('perMonth')} yearlyLabel={t('perYear')} selectedLabel={t('selectedPlan')} selectLabel={t('selectNamedPlan', { name: pickLocalized(plan.name, locale) })} popularLabel={t('mostPopular')} />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-3 divide-x divide-[#deded9] border-y border-[#e5e5e0] py-3 text-center text-[10px] font-medium text-[#4f4f4b] rtl:divide-x-reverse">
                <span className="flex items-center justify-center gap-1.5"><RefreshCw className="size-3.5" /> {t('cancelAnytime')}</span>
                <span className="flex items-center justify-center gap-1.5"><ShieldCheck className="size-3.5" /> {t('securePayment')}</span>
                <span className="flex items-center justify-center gap-1.5"><TrendingUp className="size-3.5" /> {t('upgradeAnytime')}</span>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1.25fr_.9fr]">
              <section className="rounded-xl border border-[#deded9] bg-white p-3">
                <h3 className="font-display text-base">{t('choosePaymentMethod')}</h3>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <PaymentMethodChoice icon={CreditCard} label={t('cardMethod')} selected={paymentChoice === 'card'} onClick={() => setPaymentChoice('card')} />
                  <PaymentMethodChoice icon={Smartphone} label={t('benefitMethod')} selected={paymentChoice === 'benefit'} onClick={() => setPaymentChoice('benefit')} />
                  <PaymentMethodChoice icon={Landmark} label={t('bankMethod')} selected={paymentChoice === 'bank'} onClick={() => setPaymentChoice('bank')} />
                </div>
                {paymentChoice === 'card' ? (
                  <div className="mt-3 grid gap-2.5 border-t border-[#e8e8e4] pt-3 sm:grid-cols-2">
                    <div className="sm:col-span-2"><PaymentInput label={t('cardName')} value={card.name} onChange={(name) => setCard({ ...card, name })} placeholder={t('cardNamePlaceholder')} error={fieldErrors.cardName} /></div>
                    <div className="sm:col-span-2"><PaymentInput icon={CreditCard} label={t('cardNumber')} value={card.number} onChange={(number) => setCard({ ...card, number })} placeholder="•••• •••• •••• ••••" inputMode="numeric" error={fieldErrors.cardNumber} /></div>
                    <PaymentInput label={t('expiry')} value={card.expiry} onChange={(expiry) => setCard({ ...card, expiry })} placeholder="MM / YY" error={fieldErrors.expiry} />
                    <PaymentInput label={t('cvv')} value={card.cvv} onChange={(cvv) => setCard({ ...card, cvv })} placeholder="•••" inputMode="numeric" error={fieldErrors.cvv} />
                  </div>
                ) : <p className="mt-3 rounded-lg bg-[#f5f5f2] p-3 text-xs leading-relaxed text-[#5f5f5b]">{paymentChoice === 'benefit' ? t('benefitHint') : t('bankHint')}</p>}
                <label className="mt-3 flex items-center gap-2 text-[10px] text-[#3f3f3c]">
                  <input type="checkbox" checked={saveCard} disabled={paymentChoice !== 'card'} onChange={(event) => setSaveCard(event.target.checked)} className="size-4 accent-[#FFC400]" />
                  {t('saveCard')}
                </label>
                <p className="mt-2 flex items-center gap-2 text-[9px] text-[#777773]"><Lock className="size-3.5" /> {t('encryptedPayment')}</p>
              </section>
              <aside className="rounded-xl border border-[#deded9] bg-white p-3">
                <h3 className="font-display text-base">{t('subscriptionSummary')}</h3>
                <div className="mt-2 rounded-lg bg-[#fff8dc] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{selectedPlan ? pickLocalized(selectedPlan.name, locale) : ''}</strong>
                    <span className="rounded-full bg-primary px-2 py-1 text-[8px] font-bold">{interval === 'ANNUAL' ? t('yearly') : t('monthly')}</span>
                  </div>
                  <p className="mt-1 text-lg font-extrabold">{formatMoney(quote.data?.payable ?? (interval === 'ANNUAL' ? selectedPlan?.priceAnnual ?? '0' : selectedPlan?.priceMonthly ?? '0'), locale)}</p>
                </div>
                <div className="mt-3 space-y-2 border-b border-[#e8e8e4] pb-3 text-[10px]">
                  <p className="flex items-center gap-2"><Store className="size-3.5" /> {form.businessName}</p>
                  <p className="flex items-center gap-2"><MapPin className="size-3.5" /> {t('mainBranch')}</p>
                  {promoCode && quote.data?.promo?.valid ? <p className="flex items-center gap-2"><Tag className="size-3.5" /> {promoCode}<span className="ms-auto font-semibold text-[#159447]">{t('applied')}</span></p> : null}
                </div>
                <div className="mt-3">
                  <IconField icon={Ticket} label={t('promo')} value={form.promoCode} onChange={(code) => setForm({ ...form, promoCode: code.toUpperCase() })} placeholder={t('promoPlaceholder')} />
                  {promoWaiting ? <p className="mt-1 text-[9px] text-[#6b6b66]">{t('promoChecking')}</p> : null}
                  {!promoWaiting && promoBad ? <p className="mt-1 text-[9px] font-medium text-[#D9342B]">{quote.data?.promo && !quote.data.promo.valid ? quote.data.promo.reason : t('promoInvalid')}</p> : null}
                </div>
                {quote.data ? (
                  <dl className="mt-3 space-y-2 text-[10px]" aria-label={t('summaryTitle')}>
                    <div className="flex justify-between"><dt>{t('summaryGross')}</dt><dd className="font-semibold">{formatMoney(quote.data.gross, locale)}</dd></div>
                    <div className="flex justify-between"><dt>{t('summaryDiscount')}</dt><dd className="font-semibold text-[#159447]">-{formatMoney(quote.data.discount, locale)}</dd></div>
                    {Number(quote.data.serviceFee) > 0 ? <div className="flex justify-between"><dt>{pickLocalized(quote.data.serviceFeeLabel, locale)}</dt><dd className="font-semibold">{formatMoney(quote.data.serviceFee, locale)}</dd></div> : null}
                    {Number(quote.data.tax) > 0 ? <div className="flex justify-between"><dt>{pickLocalized(quote.data.taxLabel, locale)}</dt><dd className="font-semibold">{formatMoney(quote.data.tax, locale)}</dd></div> : null}
                    <div className="flex justify-between border-t border-[#e8e8e4] pt-3 text-sm font-extrabold"><dt>{t('totalDue')}</dt><dd>{formatMoney(quote.data.payable, locale)}</dd></div>
                  </dl>
                ) : null}
                <p className="mt-3 text-[9px] leading-relaxed text-[#777773]">{interval === 'ANNUAL' ? t('annualRenewalNote') : t('monthlyRenewalNote')}</p>
              </aside>
              <label className="flex items-start gap-2 rounded-lg border border-[#e5e5e0] p-2 text-[10px] sm:col-span-2">
                <input type="checkbox" checked={paymentConfirmed} onChange={(event) => { setPaymentConfirmed(event.target.checked); setFieldErrors((current) => ({ ...current, paymentConfirmation: '' })); }} className="mt-0.5 size-4 accent-[#FFC400]" />
                <span>{t('confirmBusiness')} <a href="/legal/terms" className="font-medium underline">{t('subscriptionTerms')}</a>.</span>
              </label>
              {fieldErrors.paymentConfirmation ? <p className="text-xs font-medium text-[#D9342B] sm:col-span-2">{fieldErrors.paymentConfirmation}</p> : null}
            </div>
          )}
        </div>
        </div>
        </div>
        <footer className="shrink-0 border-t border-[#ecece8] bg-white px-5 py-3.5 shadow-[0_-8px_24px_rgba(20,20,20,0.04)] sm:px-10 lg:px-12 xl:px-16">
          <div className="mx-auto w-full max-w-[640px]">
            {error ? <p className="mb-3 text-sm text-[#D9342B]">{error}</p> : null}
            <div className="flex gap-3">
              <button type="button" className="h-11 min-w-28 rounded-xl border border-[#d8d8d4] px-5 text-sm font-semibold transition-colors hover:bg-[#f7f7f4]" onClick={() => (step === 0 ? router.back() : setStep((current) => current - 1))}>{t('back')}</button>
              {step === 0 ? (
                <button type="button" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#f2ba00]" onClick={continueAccount}>{t('continue')} <ArrowRight className="size-4 rtl:rotate-180" /></button>
              ) : step === 1 ? (
                <button type="button" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-[#111111] transition-colors hover:bg-[#f2ba00]" onClick={continuePlan}>{t('continuePayment')} <ArrowRight className="size-4 rtl:rotate-180" /></button>
              ) : (
                <Button type="button" className="h-auto min-h-11 min-w-0 flex-1 whitespace-normal rounded-xl px-3 py-2 text-xs leading-tight sm:h-11 sm:px-4 sm:text-sm [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-wrap [&>span]:justify-center [&>span]:whitespace-normal" loading={register.isPending || referralWaiting || promoWaiting} onClick={submitRegistration}><Lock className="size-4 shrink-0" /> <span className="min-w-0 whitespace-normal text-center">{t('payComplete', { amount: formatMoney(quote.data?.payable ?? '0', locale) })}</span></Button>
              )}
            </div>
            {step === 1 ? <p className="mt-2 text-center text-[10px] text-[#8a8a86]">{t('taxNote')}</p> : null}
            {step === 2 ? <p className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-[#eaf7ec] py-2 text-[10px] text-[#245d32]"><CheckCircle2 className="size-4 text-[#159447]" /> {t('portalReady')}</p> : null}
            <p className="mt-2.5 text-center text-xs text-[#6b6b66]">
              {t('haveAccount')} <Link href="/login" className="font-semibold text-[#111111] underline">{t('signIn')}</Link>
            </p>
          </div>
        </footer>
        </>
        )}
      </main>
    </div>
  );
}

function RegistrationFinale({ phase, title, lead, nextLabel, steps }: { phase: 'working' | 'welcome'; title: string; lead?: string; nextLabel: string; steps: string[] }) {
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (phase !== 'working') return;
    const timers = [620, 1240].map((delay, index) => window.setTimeout(() => setBeat(index + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);
  const progress = phase === 'welcome' ? 1 : (beat + 1) / steps.length;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-hidden bg-white px-6" role="status" aria-live="polite" aria-busy={phase === 'working'}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,196,0,0.22),transparent_58%)]" />
      <div key={phase} className="alliva-rise relative flex w-full max-w-sm flex-col items-center text-center">
        <img src="/logo-on-light.png" alt="" className="mb-8 h-8 w-auto" />
        {phase === 'working' ? <WorkingMark progress={progress} /> : <SuccessMark />}
        <h2 className="mt-8 font-display text-[2rem] leading-tight tracking-[-0.03em]">{title}</h2>
        {phase === 'welcome' ? (
          <>
            <p className="alliva-rise-delay mt-2 text-base text-[#3f3f3c]">{lead}</p>
            <p className="mt-8 text-sm font-medium text-[#6b6b66]">{nextLabel}</p>
            <div className="mt-3 h-1 w-40 overflow-hidden rounded-full bg-[#ecece8]" aria-hidden="true">
              <div className="alliva-fill h-full w-full rounded-full bg-primary" />
            </div>
          </>
        ) : (
          <ol className="mt-8 w-full space-y-3">
            {steps.map((label, index) => {
              const done = index < beat;
              const current = index === beat;
              return (
                <li key={label} className={`flex items-center gap-3 text-start text-sm ${current ? 'font-semibold text-[#111111]' : done ? 'text-[#111111]' : 'text-[#a1a19c]'}`}>
                  <span className={`grid size-6 shrink-0 place-items-center rounded-full ${done || current ? 'bg-primary text-[#111111]' : 'bg-[#f1f1ee]'}`}>
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : <span className={`size-1.5 rounded-full ${current ? 'bg-[#111111]' : 'bg-[#c8c8c2]'}`} />}
                  </span>
                  <span>{label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function WorkingMark({ progress }: { progress: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid size-28 place-items-center" aria-hidden="true">
      <span className="alliva-halo absolute inset-1 rounded-full bg-primary/30" />
      <svg viewBox="0 0 80 80" className="relative size-28 -rotate-90">
        <circle cx="40" cy="40" r={radius} stroke="#ecece8" strokeWidth="5" fill="white" />
        <circle cx="40" cy="40" r={radius} stroke="#FFC400" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none" />
      </svg>
      <Store className="absolute size-7 text-[#111111]" />
    </div>
  );
}

function SuccessMark() {
  return (
    <div className="alliva-pop relative grid size-28 place-items-center" aria-hidden="true">
      <span className="alliva-halo absolute inset-1 rounded-full bg-primary/35" />
      <span className="relative grid size-20 place-items-center rounded-full bg-primary shadow-[0_16px_40px_rgba(255,196,0,0.45)]">
        <svg viewBox="0 0 24 24" className="size-10" fill="none">
          <path d="M5 12.5 10 17.5 19 7.5" stroke="#111111" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="alliva-draw" />
        </svg>
      </span>
    </div>
  );
}

function FeaturePill({ icon: Icon, children }: { icon: typeof Zap; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-lg bg-white/90 px-3 text-xs font-semibold shadow-sm">
      <span className="flex size-6 items-center justify-center rounded-full bg-primary">
        <Icon className="size-3.5" />
      </span>
      {children}
    </span>
  );
}

function RegistrationSteps({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="grid min-w-0 flex-1 grid-cols-3" aria-label="Registration progress">
      {labels.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={label} aria-current={current ? 'step' : undefined} className="relative min-w-0 text-center">
            <span className="relative flex justify-center">
              {index > 0 ? <span className={`absolute top-1/2 start-0 h-0.5 w-[calc(50%-1.15rem)] -translate-y-1/2 rounded-full ${index <= step ? 'bg-primary' : 'bg-[#e4e4e0]'}`} aria-hidden="true" /> : null}
              {index < labels.length - 1 ? <span className={`absolute top-1/2 end-0 h-0.5 w-[calc(50%-1.15rem)] -translate-y-1/2 rounded-full ${done ? 'bg-primary' : 'bg-[#e4e4e0]'}`} aria-hidden="true" /> : null}
              <span className={`relative z-10 flex size-7 items-center justify-center rounded-full text-xs font-bold ${current ? 'bg-primary text-[#111111] ring-4 ring-[#fff4c2]' : done ? 'bg-primary text-[#111111]' : 'bg-[#ecece8] text-[#6f6f6b]'}`}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
            </span>
            <span className={`mt-1.5 block px-0.5 text-[10px] leading-tight sm:text-[11px] ${current ? 'font-semibold text-[#111111]' : done ? 'font-medium text-[#2f2f2c]' : 'text-[#8a8a86]'}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PlanChoice({ plan, locale, selected, yearly, onSelect, monthlyLabel, yearlyLabel, selectedLabel, selectLabel, popularLabel }: { plan: SubscriptionPlanView; locale: 'en' | 'ar'; selected: boolean; yearly: boolean; onSelect: () => void; monthlyLabel: string; yearlyLabel: string; selectedLabel: string; selectLabel: string; popularLabel: string }) {
  const plansT = useTranslations('plans');
  const details = planDetails(plan, plansT).slice(0, 6);
  const visibility = String(plan.entitlements.find((row) => row.key === 'visibility')?.value ?? '');
  const exclusive = visibility === 'CURRENT_STORE_ONLY' || visibility === 'EXCLUSIVE_STOREFRONT';
  return (
    <article className={`relative flex min-h-[290px] snap-start flex-col rounded-xl border p-3 text-start transition-colors ${selected ? 'border-primary bg-[#fffdf3] shadow-[0_0_0_1px_#FFC400]' : 'border-[#deded9] bg-white'}`}>
      {plan.recommended ? <span className="absolute -top-2.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-[9px] font-bold">{popularLabel}</span> : null}
      <h3 className="font-display text-lg leading-tight">{pickLocalized(plan.name, locale)}</h3>
      <p className="mt-1 whitespace-nowrap text-[1.35rem] font-extrabold leading-none tracking-tight">{formatMoney(yearly ? plan.priceAnnual : plan.priceMonthly, locale)} <span className="text-[9px] font-normal text-[#777773]">{yearly ? yearlyLabel : monthlyLabel}</span></p>
      <p className="mt-2 min-h-8 text-[9px] leading-relaxed text-[#666662]">{pickLocalized(plan.description, locale)}</p>
      <ul className="mt-2 space-y-1.5">
        {details.map((line) => (
          <li key={line} className="flex gap-1.5 text-[9px] leading-snug text-[#3f3f3c]"><Check className="mt-px size-3 shrink-0 text-[#159447]" /> <span>{line}</span></li>
        ))}
      </ul>
      <div className="mt-auto pt-3">
        <div className="mb-2 flex min-h-11 items-center gap-2 rounded-lg bg-[#f5f5f2] p-2 text-[8px] leading-snug text-[#4f4f4b]">
          {exclusive ? <Crown className="size-4 shrink-0" /> : <Store className="size-4 shrink-0" />}
          <span>{exclusive ? plansT('currentStore') : plansT('allStores')}</span>
        </div>
        <button type="button" onClick={onSelect} aria-pressed={selected} className={`flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border text-[10px] font-bold transition-colors ${selected ? 'border-primary bg-primary' : 'border-[#cfcfca] bg-white hover:border-primary'}`}>
          {selected ? <Check className="size-3.5 rounded-full bg-[#111111] p-0.5 text-white" /> : null}
          {selected ? selectedLabel : selectLabel}
        </button>
      </div>
    </article>
  );
}

function planDetails(plan: SubscriptionPlanView, t: ReturnType<typeof useTranslations<'plans'>>) {
  const value = (key: string) => plan.entitlements.find((row) => row.key === key)?.value;
  const lines: string[] = [];
  const visibility = String(value('visibility') ?? '');
  if (visibility) lines.push(visibility === 'CURRENT_STORE_ONLY' || visibility === 'EXCLUSIVE_STOREFRONT' ? t('currentStore') : visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('excludeType') : t('allStores'));
  if (plan.entitlements.some((row) => row.key === 'productLimit')) lines.push(`${t('products')}: ${value('productLimit') == null || value('productLimit') === '' ? t('unlimited') : String(value('productLimit'))}`);
  if (plan.entitlements.some((row) => row.key === 'monthlyOrderLimit')) lines.push(`${t('orders')}: ${value('monthlyOrderLimit') == null || value('monthlyOrderLimit') === '' ? t('unlimited') : String(value('monthlyOrderLimit'))}`);
  if (plan.entitlements.some((row) => row.key === 'staffLimit')) lines.push(`${t('staff')}: ${value('staffLimit') == null || value('staffLimit') === '' ? t('unlimited') : String(value('staffLimit'))}`);
  if (plan.entitlements.some((row) => row.key === 'branchLimit')) lines.push(`${t('branches')}: ${value('branchLimit') == null || value('branchLimit') === '' ? t('unlimited') : String(value('branchLimit'))}`);
  const ordering = [value('deliveryOrdering') ? t('deliveryShort') : null, value('takeawayOrdering') ? t('takeawayShort') : null, value('tableOrdering') ? t('dineShort') : null].filter(Boolean);
  if (ordering.length) lines.push(ordering.join(', '));
  if (value('paymentIntegration')) lines.push(t('onlinePayments'));
  if (value('offerHighlighting')) lines.push(t('highlightedOffers'));
  const support = String(value('supportLevel') ?? '');
  if (support) lines.push(`${t('support')}: ${support === 'PRIORITY' ? t('priority') : t('standard')}`);
  return lines;
}

function PaymentMethodChoice({ icon: Icon, label, selected, onClick }: { icon: typeof CreditCard; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`relative flex min-h-14 flex-col items-start justify-center rounded-lg border p-2 text-start text-[9px] font-semibold ${selected ? 'border-primary bg-[#fffdf3] shadow-[0_0_0_1px_#FFC400]' : 'border-[#deded9]'}`}>
      <Icon className="mb-1 size-4" />
      {label}
      <span className={`absolute end-2 top-2 size-3 rounded-full border ${selected ? 'border-[#111111] bg-[#111111]' : 'border-[#bdbdb7]'}`}>{selected ? <Check className="size-full p-0.5 text-white" /> : null}</span>
    </button>
  );
}

function PaymentInput({ label, value, onChange, placeholder, icon: Icon, inputMode, error }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; icon?: typeof CreditCard; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; error?: string }) {
  return (
    <label className="block text-[9px] font-semibold">
      {label}
      <span className={`mt-1 flex h-9 items-center gap-2 rounded-md border px-2.5 focus-within:border-[#111111] ${error ? 'border-[#D9342B]' : 'border-[#d8d8d4]'}`}>
        {Icon ? <Icon className="size-4 text-[#777773]" /> : null}
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#a1a19c]" />
      </span>
      {error ? <span className="mt-1 block text-[9px] text-[#D9342B]">{error}</span> : null}
    </label>
  );
}

function IconField({ icon: Icon, label, value, onChange, placeholder, type = 'text', error, trailing, autoComplete }: { icon: typeof Mail; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; error?: string; trailing?: React.ReactNode; autoComplete?: string }) {
  return (
    <label className="block text-xs font-semibold">
      {label}
      <span className={`mt-1.5 flex h-10 items-center gap-2 rounded-md border bg-white px-3 transition-colors focus-within:border-[#111111] ${error ? 'border-[#D9342B]' : 'border-[#d8d8d4]'}`}>
        <Icon className="size-4 shrink-0 text-[#777773]" />
        <input type={type} autoComplete={autoComplete} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#a1a19c]" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        {trailing}
      </span>
      {error ? <span className="mt-1 block text-xs font-medium text-[#D9342B]">{error}</span> : null}
    </label>
  );
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
