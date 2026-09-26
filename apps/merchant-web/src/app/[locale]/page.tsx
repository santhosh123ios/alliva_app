'use client';

import { api } from '@/components/providers';
import { Link } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import type { SubscriptionPlanView } from '@alliva/types';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Heart, Home, LayoutGrid, Mail, MapPin, Play, QrCode, Search, ShoppingBag, Smartphone, Store, Truck, UtensilsCrossed } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

export default function LandingPage() {
  const t = useTranslations('landing');
  const locale = useLocale() as 'en' | 'ar';
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api.publicPlans() });
  const list = [...(plans.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder || Number(a.priceMonthly) - Number(b.priceMonthly));

  return (
    <div className="h-dvh snap-y snap-mandatory overflow-y-auto scroll-smooth bg-white text-[#111111]">
      <header className="fixed inset-x-0 top-0 z-20 h-[72px] bg-white">
        <div className="mx-auto flex h-full max-w-6xl items-center gap-8 px-5 lg:px-8">
          <img src="/logo-on-light.png" alt="Alliva" className="h-8 w-auto" />
          <nav className="hidden items-center gap-7 text-sm text-[#3f3f3f] md:flex">
            <a href="#how" className="hover:text-[#111111]">{t('how')}</a>
            <a href="#plans" className="hover:text-[#111111]">{t('plansNav')}</a>
            <a href="#how" className="hover:text-[#111111]">{t('featuresNav')}</a>
          </nav>
          <Link href="/register" className="ms-auto inline-flex h-10 items-center rounded-lg bg-[#111111] px-4 text-sm font-semibold text-white">{t('getStarted')}</Link>
        </div>
      </header>

      <section id="how" className="flex h-dvh snap-start snap-always flex-col pt-[72px]">
        <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 items-center gap-8 overflow-hidden px-5 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
          <div>
            <h1 className="font-display text-5xl leading-[0.95] tracking-tight sm:text-6xl lg:text-[4.25rem]">
              <span className="block">{t('headline')}</span>
              <span className="mt-2 inline-block whitespace-nowrap bg-primary px-2 text-[2.35rem] leading-[1.2] sm:text-5xl lg:text-[3.15rem]">{t('headlineAccent')}</span>
            </h1>
            <p className="mt-6 max-w-md text-base text-[#3f3f3f] sm:text-lg">{t('subhead')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#plans" className="inline-flex h-12 items-center gap-2 rounded-lg bg-[#111111] px-5 text-sm font-semibold text-white">
                {t('explore')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </a>
              <a href="#how" className="inline-flex h-12 items-center gap-2 rounded-lg border border-[#d7d7d2] bg-white px-5 text-sm font-semibold">
                {t('how')} <Play className="h-3.5 w-3.5 fill-current" />
              </a>
            </div>
          </div>
          <PhoneStage t={t} />
        </div>
        <div className="shrink-0 bg-[#111111] text-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 md:grid-cols-3 lg:px-8">
            <Feature icon={Truck} title={t('ownTeam')} body={t('ownTeamBody')} />
            <Feature icon={Smartphone} title={t('customerApp')} body={t('customerAppBody')} />
            <Feature icon={Store} title={t('modes')} body={t('modesBody')} />
          </div>
        </div>
      </section>

      <section id="plans" className="flex h-dvh snap-start snap-always flex-col justify-center bg-[#fbfbfa] px-5 pt-[72px] lg:px-8">
        <h2 className="font-display text-center text-4xl tracking-tight sm:text-5xl">{t('plans')}</h2>
        <p className="mt-3 text-center text-[#6b6b66]">{t('plansHint')}</p>
        <div className="mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2">
          {list.map((plan) => (
            <PlanCard key={plan.id} plan={plan} locale={locale} t={t} />
          ))}
        </div>
        <p className="mx-auto mt-6 flex max-w-xl items-start justify-center gap-3 text-center text-sm text-[#6b6b66]">
          <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-[#111111]" />
          <span className="whitespace-pre-line text-start">{t('footnote')}</span>
        </p>
      </section>

      <footer id="footer" className="relative flex h-dvh snap-start snap-always flex-col overflow-hidden bg-[#161616] px-5 pt-[72px] text-white lg:px-8">
        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-12">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-[28px] bg-primary px-8 py-7 text-[#111111]">
            <div>
              <p className="font-display text-3xl tracking-tight sm:text-4xl">{t('readyTitle')}</p>
              <p className="mt-1 text-sm sm:text-base">{t('readyBody')}</p>
            </div>
            <a href="#plans" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#111111] px-5 text-sm font-semibold text-white">
              {t('explore')} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
            </a>
          </div>
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <img src="/logo-on-light.png" alt="Alliva" className="h-10 w-auto brightness-0 invert" />
              <p className="mt-5 max-w-[220px] text-lg font-semibold leading-snug">{t('footerTag')}</p>
              <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
                <MapPin className="h-4 w-4" /> {t('phonePlace')}
              </p>
            </div>
            <FooterColumn title={t('exploreLabel')} links={[[t('how'), '#how'], [t('plansNav'), '#plans'], [t('featuresNav'), '#how']]} />
            <FooterColumn title={t('forMerchants')} links={[[t('registerStore'), '/register'], [t('merchantSignIn'), '/login'], [t('support'), 'mailto:support@alliva.bh']]} />
            <div>
              <p className="text-sm font-semibold">{t('connect')}</p>
              <a href="mailto:support@alliva.bh" className="mt-4 flex items-center gap-3 text-sm text-white/80">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10"><Mail className="h-4 w-4" /></span>
                {t('contactSupport')}
              </a>
              <div className="mt-4 flex gap-3">
                <Social label="LinkedIn"><path d="M6 9h3v9H6zM7.5 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 9h2.8v1.3h.1c.4-.7 1.4-1.5 2.8-1.5 3 0 3.6 2 3.6 4.5V18h-3v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V18H12z" /></Social>
                <Social label="Instagram"><path fillRule="evenodd" d="M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zm4 3.2a4.8 4.8 0 1 0 .01 9.6A4.8 4.8 0 0 0 12 7.2zM16.7 6.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z" /></Social>
                <Social label="X"><path d="M6 6l5.2 6.8L6.3 18H8l3.6-4 3.2 4H18l-5.4-7.1L17.5 6H15.8l-3.2 3.6L9.7 6z" /></Social>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between border-t border-white/10 py-5 text-xs text-white/50">
          <p>{t('footerRights', { year: new Date().getFullYear() })}</p>
          <p className="flex items-center gap-4">
            <span className="text-white/20">|</span>
            <a href="#footer" className="hover:text-white">{t('privacy')}</a>
            <a href="#footer" className="hover:text-white">{t('terms')}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-4 space-y-3 text-sm text-white/75">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith('/') ? <Link href={href} className="hover:text-white">{label}</Link> : <a href={href} className="hover:text-white">{label}</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Social({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span aria-label={label} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">{children}</svg>
    </span>
  );
}

function Feature({ icon: Icon, title, body }: { icon: typeof Truck; title: string; body: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1c1c1c] text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-white/70">{body}</p>
      </div>
    </div>
  );
}

function PlanCard({ plan, locale, t }: { plan: SubscriptionPlanView; locale: 'en' | 'ar'; t: ReturnType<typeof useTranslations> }) {
  const plansT = useTranslations('plans');
  const name = pickLocalized(plan.name, locale);
  const amount = Number(plan.priceMonthly);
  const price = Number.isFinite(amount) && Math.abs(amount - Math.round(amount)) < 0.001 ? String(Math.round(amount)) : amount.toFixed(3);
  const features = planFeatures(plan, plansT);
  return (
    <article className={`flex w-[300px] shrink-0 snap-start flex-col rounded-[28px] border p-6 ${plan.recommended ? 'border-[#e6b000] bg-[#fff8df] shadow-[0_0_0_1px_#e6b000]' : 'border-[#e6e6e1] bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-3xl">{name}</h3>
        {plan.recommended ? <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold">{t('popular')}</span> : null}
      </div>
      <p className="mt-5 flex items-end gap-1.5">
        <span className="mb-2 text-sm font-semibold">{t('currency')}</span>
        <span className="font-display text-6xl leading-none tracking-tight">{price}</span>
        <span className="mb-2 text-sm text-[#6b6b66]">{t('perMonth')}</span>
      </p>
      <p className="mt-4 min-h-12 text-sm leading-6 text-[#4a4a46]">{pickLocalized(plan.description, locale)}</p>
      <ul className="mt-5 space-y-3 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[#111111]">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link href={`/register?plan=${plan.id}&interval=MONTHLY`} className={`mt-auto inline-flex h-12 items-center justify-center rounded-xl text-sm font-semibold ${plan.recommended ? 'bg-[#111111] text-white' : 'border border-[#d7d7d2] bg-white'}`}>
        {t('get', { name })}
      </Link>
    </article>
  );
}

function planFeatures(plan: SubscriptionPlanView, t: ReturnType<typeof useTranslations<'plans'>>) {
  const value = (key: string) => plan.entitlements.find((row) => row.key === key)?.value;
  const lines: string[] = [];
  const visibility = String(value('visibility') ?? '');
  if (visibility) lines.push(visibility === 'CURRENT_STORE_ONLY' || visibility === 'EXCLUSIVE_STOREFRONT' ? t('currentStore') : visibility === 'EXCLUDE_SAME_BUSINESS_TYPE' ? t('excludeType') : t('allStores'));
  if (plan.entitlements.some((row) => row.key === 'productLimit')) lines.push(`${t('products')}: ${limitText(value('productLimit'), t)}`);
  if (plan.entitlements.some((row) => row.key === 'monthlyOrderLimit')) lines.push(`${t('orders')}: ${limitText(value('monthlyOrderLimit'), t)}`);
  const ordering = [value('deliveryOrdering') ? t('deliveryShort') : null, value('takeawayOrdering') ? t('takeawayShort') : null, value('tableOrdering') ? t('dineShort') : null].filter(Boolean);
  if (ordering.length) lines.push(ordering.join(', '));
  if (value('paymentIntegration')) lines.push(t('onlinePayments'));
  if (value('offerHighlighting')) lines.push(t('highlightedOffers'));
  const support = String(value('supportLevel') ?? '');
  if (support) lines.push(`${t('support')}: ${support === 'PRIORITY' ? t('priority') : t('standard')}`);
  return lines;
}

function limitText(value: unknown, t: ReturnType<typeof useTranslations<'plans'>>) {
  if (value === null || value === undefined || value === '') return t('unlimited');
  return String(value);
}

function PhoneStage({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="relative mx-auto h-[min(540px,100%)] max-h-[460px] w-full max-w-[460px]">
      <div className="absolute inset-x-8 top-8 bottom-0 rounded-[40px] bg-[#f6e7b8]" />
      <div className="absolute start-1/2 top-4 w-[250px] -translate-x-1/2 rtl:translate-x-1/2">
        <div className="rounded-[32px] border-[8px] border-[#1a1a1a] bg-white shadow-2xl">
          <div className="flex items-center justify-between px-4 pt-2 text-[10px] font-semibold">
            <span>9:41</span>
            <span className="h-4 w-16 rounded-full bg-[#1a1a1a]" />
            <span className="w-6" />
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <img src="/logo-on-light.png" alt="" className="h-4 w-auto" />
            <ShoppingBag className="h-4 w-4" />
          </div>
          <div className="mx-3 flex h-7 items-center gap-1 rounded-full bg-[#f3f3f0] px-2 text-[9px] text-[#8a8a86]">
            <Search className="h-3 w-3" /> {t('phoneSearch')}
          </div>
          <p className="mt-2 flex items-center gap-1 px-3 text-[10px] font-semibold">
            <MapPin className="h-3 w-3 text-primary" /> {t('phonePlace')}
          </p>
          <div className="mx-3 mt-2 rounded-xl bg-primary p-2">
            <p className="text-[11px] font-bold leading-tight">{t('phoneBanner')}</p>
            <p className="mt-1 text-[8px]">{t('phoneBannerSub')}</p>
          </div>
          <div className="mt-2 flex justify-between px-3 text-[8px] text-[#6b6b66]">
            <span className="flex flex-col items-center gap-0.5"><UtensilsCrossed className="h-3 w-3" /> </span>
            <span className="flex flex-col items-center gap-0.5"><Store className="h-3 w-3" /> </span>
            <span className="flex flex-col items-center gap-0.5"><ShoppingBag className="h-3 w-3" /> </span>
            <span className="flex flex-col items-center gap-0.5"><LayoutGrid className="h-3 w-3" /> </span>
          </div>
          <div className="mt-2 flex items-center justify-between px-3 text-[10px] font-semibold">
            <span>{t('phonePopular')}</span>
            <span className="text-[8px] font-medium text-[#8a8a86]">{t('phoneSeeAll')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 px-3 pb-2 pt-1">
            <MiniCard title="Saffron House" meta="Bahraini · Manama" tone="bg-[#f4c542]" />
            <MiniCard title="Pearl Grill" meta="Grill · Muharraq" tone="bg-[#e8a04a]" />
          </div>
          <div className="grid grid-cols-4 border-t px-1 py-1.5 text-[7px] text-[#8a8a86]">
            <span className="flex flex-col items-center text-[#111111]"><Home className="h-3 w-3" />{t('phoneHome')}</span>
            <span className="flex flex-col items-center"><ShoppingBag className="h-3 w-3" />{t('phoneOrders')}</span>
            <span className="flex flex-col items-center"><Heart className="h-3 w-3" />{t('phoneFavorites')}</span>
            <span className="flex flex-col items-center"><span className="h-3 w-3 rounded-full border" />{t('phoneAccount')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ title, meta, tone }: { title: string; meta: string; tone: string }) {
  return (
    <div>
      <div className={`h-14 rounded-lg ${tone}`} />
      <p className="mt-1 truncate text-[9px] font-semibold">{title}</p>
      <p className="truncate text-[8px] text-[#8a8a86]">{meta}</p>
    </div>
  );
}
