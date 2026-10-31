import { api } from '@/components/providers';
import { Link, usePathname } from '@/i18n/navigation';
import { pickLocalized } from '@alliva/design-tokens';
import type { SubscriptionPlanView } from '@alliva/types';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  Bike,
  Check,
  ChefHat,
  ClipboardList,
  Languages,
  Mail,
  MapPin,
  Package,
  QrCode,
  Receipt,
  Route,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';

type T = ReturnType<typeof useTranslations<'landing'>>;

const steps: { key: string; screen: string; icon: LucideIcon }[] = [
  { key: 'orders', screen: 'dashboard', icon: ClipboardList },
  { key: 'menu', screen: 'products', icon: Package },
  { key: 'tables', screen: 'tables', icon: UtensilsCrossed },
  { key: 'dispatch', screen: 'dispatch', icon: Route },
  { key: 'reports', screen: 'reports', icon: BarChart3 },
];

const roles: { key: string; screen: string; icon: LucideIcon }[] = [
  { key: 'floor', screen: 'floor', icon: Smartphone },
  { key: 'billing', screen: 'billing', icon: Receipt },
  { key: 'rider', screen: 'rider', icon: Bike },
];

const ticker: { key: string; icon: LucideIcon }[] = [
  { key: 'delivery', icon: Truck },
  { key: 'pickup', icon: ShoppingBag },
  { key: 'dineIn', icon: UtensilsCrossed },
  { key: 'riders', icon: Bike },
  { key: 'kitchen', icon: ChefHat },
  { key: 'qr', icon: QrCode },
  { key: 'payments', icon: Wallet },
  { key: 'bilingual', icon: Languages },
];

export default function LandingPage() {
  const t = useTranslations('landing');
  const locale = useLocale() as 'en' | 'ar';
  const pathname = usePathname();
  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api.publicPlans() });
  const list = [...(plans.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder || Number(a.priceMonthly) - Number(b.priceMonthly));
  const scrolled = useScrolled(24);
  const root = useReveal();
  const screen = (name: string) => `/screens/${locale}/${name}.jpg`;

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('scroll-smooth');
    return () => html.classList.remove('scroll-smooth');
  }, []);

  return (
    <div ref={root} className="overflow-x-clip bg-background text-foreground">
      <header className={`fixed inset-x-0 top-0 z-30 transition-[background-color,box-shadow,border-color] duration-300 ${scrolled ? 'border-b bg-background/80 shadow-xs backdrop-blur-lg' : 'border-b border-transparent'}`}>
        <div className="mx-auto flex h-[68px] max-w-7xl items-center gap-6 px-5 lg:px-8">
          <a href="#top" className="shrink-0">
            <img src="/logo-on-light.png" alt="Alliva" className="h-8 w-auto dark:brightness-0 dark:invert" />
          </a>
          <nav className="hidden items-center gap-1 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="rounded-lg px-3 py-2 transition-colors hover:text-foreground">{t('featuresNav')}</a>
            <a href="#roles" className="rounded-lg px-3 py-2 transition-colors hover:text-foreground">{t('rolesNav')}</a>
            <a href="#plans" className="rounded-lg px-3 py-2 transition-colors hover:text-foreground">{t('plansNav')}</a>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <Link href={pathname} locale={locale === 'en' ? 'ar' : 'en'} className="grid h-10 min-w-10 place-items-center rounded-xl px-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {locale === 'en' ? 'ع' : 'EN'}
            </Link>
            <Link href="/login" className="hidden h-10 items-center rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-muted sm:inline-flex">{t('signIn')}</Link>
            <Link href="/register" className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-secondary px-4 text-sm font-semibold text-secondary-foreground shadow-xs transition-colors hover:bg-[var(--secondary-hover)]">
              {t('getStarted')}
            </Link>
          </div>
        </div>
      </header>

      <Hero t={t} screen={screen} />

      <div className="relative border-y bg-card py-5" aria-label={t('tickerLabel')}>
        <div className="landing-marquee flex w-max gap-10 pe-10">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 || undefined} className="flex shrink-0 items-center gap-10">
              {ticker.map((item) => (
                <li key={item.key} className="flex items-center gap-2.5 whitespace-nowrap text-sm font-semibold text-muted-foreground">
                  <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary-soft-foreground"><item.icon className="size-4" /></span>
                  {t(`ticker.${item.key}`)}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
        <div className="grid gap-4 md:grid-cols-3">
          <Pillar icon={Truck} title={t('ownTeam')} body={t('ownTeamBody')} delay={0} />
          <Pillar icon={Smartphone} title={t('customerApp')} body={t('customerAppBody')} delay={90} />
          <Pillar icon={Store} title={t('modes')} body={t('modesBody')} delay={180} />
        </div>
      </section>

      <Features t={t} screen={screen} />

      <section id="roles" className="scroll-mt-16 bg-sidebar py-20 text-white lg:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <SectionHeading eyebrow={t('rolesEyebrow')} title={t('rolesTitle')} body={t('rolesBody')} dark />
          <div className="mt-14 grid items-end gap-10 lg:grid-cols-[1.35fr_1fr]">
            <figure data-reveal className="reveal-up">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-2 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
                <img src={screen('kitchen')} alt={t('roles.kitchen.title')} width={2160} height={1350} loading="lazy" className="w-full rounded-xl" />
              </div>
              <figcaption className="mt-5 flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><ChefHat className="size-5" /></span>
                <span>
                  <span className="block font-semibold">{t('roles.kitchen.title')}</span>
                  <span className="block text-sm text-white/60">{t('roles.kitchen.body')}</span>
                </span>
              </figcaption>
            </figure>
            <div className="grid grid-cols-3 gap-3 sm:gap-5">
              {roles.map((role, index) => (
                <figure key={role.key} data-reveal className="reveal-up" style={{ '--reveal-delay': `${index * 120}ms` } as React.CSSProperties}>
                  <Phone src={screen(role.screen)} alt={t(`roles.${role.key}.title`)} className={index === 1 ? 'lg:-translate-y-8' : ''} />
                  <figcaption className="mt-4">
                    <span className="flex items-center gap-1.5 text-sm font-semibold"><role.icon className="size-4 shrink-0 text-primary" />{t(`roles.${role.key}.title`)}</span>
                    <span className="mt-1 hidden text-xs leading-relaxed text-white/60 sm:block">{t(`roles.${role.key}.body`)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="plans" className="scroll-mt-16 bg-muted py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <SectionHeading eyebrow={t('plansEyebrow')} title={t('plans')} body={t('plansHint')} />
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {list.map((plan, index) => (
              <PlanCard key={plan.id} plan={plan} locale={locale} t={t} delay={index * 90} />
            ))}
          </div>
          <p className="mx-auto mt-10 flex max-w-xl items-start justify-center gap-3 text-sm text-muted-foreground">
            <QrCode className="mt-0.5 size-5 shrink-0 text-foreground" />
            <span className="whitespace-pre-line text-start">{t('footnote')}</span>
          </p>
        </div>
      </section>

      <footer id="footer" className="bg-sidebar px-5 pt-20 text-white lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div data-reveal className="reveal-up relative overflow-hidden rounded-[28px] bg-primary px-6 py-10 text-primary-foreground sm:px-12 sm:py-14">
            <div aria-hidden className="pointer-events-none absolute -end-16 -top-24 size-72 rounded-full bg-white/25 blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-6">
              <div className="max-w-xl">
                <p className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">{t('readyTitle')}</p>
                <p className="mt-2 text-base opacity-80">{t('readyBody')}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/register" className="inline-flex h-12 items-center gap-2 rounded-xl bg-secondary px-5 text-sm font-semibold text-secondary-foreground transition-transform hover:-translate-y-0.5">
                  {t('getStarted')} <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
                <a href="#plans" className="inline-flex h-12 items-center rounded-xl border border-black/15 px-5 text-sm font-semibold transition-colors hover:bg-black/5">{t('explore')}</a>
              </div>
            </div>
          </div>
          <div className="grid gap-10 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <img src="/logo-on-light.png" alt="Alliva" className="h-9 w-auto brightness-0 invert" />
              <p className="mt-5 max-w-[240px] text-base font-medium leading-snug text-white/80">{t('footerTag')}</p>
              <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
                <MapPin className="size-4" /> {t('place')}
              </p>
            </div>
            <FooterColumn title={t('exploreLabel')} links={[[t('featuresNav'), '#features'], [t('rolesNav'), '#roles'], [t('plansNav'), '#plans']]} />
            <FooterColumn title={t('forMerchants')} links={[[t('registerStore'), '/register'], [t('merchantSignIn'), '/login'], [t('support'), 'mailto:support@alliva.bh']]} />
            <div>
              <p className="text-sm font-semibold">{t('connect')}</p>
              <a href="mailto:support@alliva.bh" className="mt-4 flex items-center gap-3 text-sm text-white/70 transition-colors hover:text-white">
                <span className="grid size-9 place-items-center rounded-full bg-white/10"><Mail className="size-4" /></span>
                {t('contactSupport')}
              </a>
              <div className="mt-4 flex gap-3">
                <Social label="LinkedIn"><path d="M6 9h3v9H6zM7.5 4.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM12 9h2.8v1.3h.1c.4-.7 1.4-1.5 2.8-1.5 3 0 3.6 2 3.6 4.5V18h-3v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V18H12z" /></Social>
                <Social label="Instagram"><path fillRule="evenodd" d="M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zm4 3.2a4.8 4.8 0 1 0 .01 9.6A4.8 4.8 0 0 0 12 7.2zM16.7 6.6a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z" /></Social>
                <Social label="X"><path d="M6 6l5.2 6.8L6.3 18H8l3.6-4 3.2 4H18l-5.4-7.1L17.5 6H15.8l-3.2 3.6L9.7 6z" /></Social>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-6 text-xs text-white/50">
            <p>{t('footerRights', { year: new Date().getFullYear() })}</p>
            <p className="flex items-center gap-4">
              <a href="#footer" className="hover:text-white">{t('privacy')}</a>
              <a href="#footer" className="hover:text-white">{t('terms')}</a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Hero({ t, screen }: { t: T; screen: (name: string) => string }) {
  const frame = useRef<HTMLDivElement>(null);
  // The product shot starts tilted back and settles flat as the visitor scrolls into it.
  useEffect(() => {
    const el = frame.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.55)));
      el.style.setProperty('--tilt', String(1 - progress));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section id="top" className="relative pt-[68px]">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="absolute start-1/2 top-[-18rem] h-[42rem] w-[72rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,196,0,0.32),transparent)] rtl:translate-x-1/2" />
        <div className="absolute inset-0 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] opacity-60" />
      </div>
      <div className="relative mx-auto max-w-7xl px-5 pt-14 text-center sm:pt-20 lg:px-8">
        <p className="landing-in mx-auto inline-flex items-center gap-2 rounded-full border bg-card/80 px-3.5 py-1.5 text-xs font-semibold text-muted-foreground shadow-xs backdrop-blur">
          <Sparkles className="size-3.5 text-primary" /> {t('eyebrow')}
        </p>
        <h1 className="landing-in mx-auto mt-6 max-w-4xl font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl" style={{ '--in-delay': '80ms' } as React.CSSProperties}>
          {t('headline')}{' '}
          <span className="relative inline-block whitespace-nowrap">
            <span aria-hidden className="landing-highlight absolute inset-x-[-0.12em] bottom-[0.06em] top-[0.18em] -z-0 rounded-lg bg-primary" />
            <span className="relative text-primary-foreground">{t('headlineAccent')}</span>
          </span>
        </h1>
        <p className="landing-in mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg" style={{ '--in-delay': '160ms' } as React.CSSProperties}>{t('subhead')}</p>
        <div className="landing-in mt-9 flex flex-wrap justify-center gap-3" style={{ '--in-delay': '240ms' } as React.CSSProperties}>
          <Link href="/register" className="group inline-flex h-12 items-center gap-2 rounded-xl bg-secondary px-6 text-sm font-semibold text-secondary-foreground shadow-md transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-[var(--secondary-hover)]">
            {t('getStarted')} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </Link>
          <a href="#plans" className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-card px-6 text-sm font-semibold shadow-xs transition-colors hover:bg-muted">
            {t('explore')}
          </a>
        </div>
      </div>

      <div className="relative mx-auto mt-14 max-w-6xl px-3 pb-6 sm:mt-16 sm:px-5 lg:px-8">
        <div className="[perspective:1800px]">
          <div
            ref={frame}
            className="landing-in relative origin-top transition-transform duration-200 ease-out [transform:rotateX(calc(var(--tilt,0)*16deg))_scale(calc(1-var(--tilt,0)*0.05))] motion-reduce:[transform:none]"
            style={{ '--in-delay': '320ms' } as React.CSSProperties}
          >
            <BrowserFrame src={screen('dashboard')} alt={t('steps.orders.title')} eager />
            <div className="absolute -bottom-6 end-[-0.5rem] hidden w-[17%] min-w-[130px] sm:block lg:end-[-2.5rem]">
              <Phone src={screen('floor-menu')} alt={t('roles.floor.title')} eager />
            </div>
          </div>
        </div>
        <p className="mt-12 text-center text-xs font-medium text-subtle">{t('realScreens')}</p>
      </div>
    </section>
  );
}

function Features({ t, screen }: { t: T; screen: (name: string) => string }) {
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    items.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="features" className="scroll-mt-16 border-t bg-card py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <SectionHeading eyebrow={t('featuresEyebrow')} title={t('featuresTitle')} body={t('featuresBody')} />
        <div className="mt-14 grid gap-12 lg:mt-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <ol className="space-y-14 lg:space-y-0">
            {steps.map((step, index) => (
              <li
                key={step.key}
                ref={(el) => {
                  items.current[index] = el;
                }}
                data-step={index}
                className="lg:flex lg:min-h-[70vh] lg:items-center"
              >
                <div data-reveal className={`reveal-up transition-opacity duration-500 ${active === index ? 'lg:opacity-100' : 'lg:opacity-35'}`}>
                  <span className="flex items-center gap-3">
                    <span className={`grid size-11 place-items-center rounded-xl transition-colors duration-500 ${active === index ? 'bg-primary text-primary-foreground' : 'bg-primary-soft text-primary-soft-foreground'}`}>
                      <step.icon className="size-5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-subtle">{String(index + 1).padStart(2, '0')}</span>
                  </span>
                  <h3 className="mt-5 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t(`steps.${step.key}.title`)}</h3>
                  <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground">{t(`steps.${step.key}.body`)}</p>
                  <ul className="mt-5 space-y-2.5">
                    {(t.raw(`steps.${step.key}.points`) as string[]).map((point) => (
                      <li key={point} className="flex items-start gap-2.5 text-sm font-medium">
                        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check className="size-3" strokeWidth={3} /></span>
                        {point}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 lg:hidden">
                    <BrowserFrame src={screen(step.screen)} alt={t(`steps.${step.key}.title`)} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="hidden lg:block">
            <div className="sticky top-[calc(50vh-17rem)]">
              <div className="relative">
                <div aria-hidden className="absolute -inset-6 rounded-[2rem] bg-[radial-gradient(closest-side,rgba(255,196,0,0.22),transparent)]" />
                <div className="relative aspect-[16/10]">
                  {steps.map((step, index) => (
                    <div
                      key={step.key}
                      aria-hidden={active !== index}
                      className={`absolute inset-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${active === index ? 'translate-y-0 scale-100 opacity-100' : index < active ? '-translate-y-6 scale-[0.97] opacity-0' : 'translate-y-6 scale-[0.97] opacity-0'}`}
                    >
                      <BrowserFrame src={screen(step.screen)} alt={t(`steps.${step.key}.title`)} />
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex justify-center gap-2" aria-hidden>
                  {steps.map((step, index) => (
                    <span key={step.key} className={`h-1.5 rounded-full transition-all duration-500 ${active === index ? 'w-8 bg-primary' : 'w-1.5 bg-border-strong'}`} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BrowserFrame({ src, alt, eager = false }: { src: string; alt: string; eager?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_30px_70px_-25px_rgba(16,24,40,0.35)] ring-1 ring-black/[0.03]">
      <div className="flex items-center gap-1.5 border-b bg-muted px-4 py-2.5" dir="ltr">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="mx-auto hidden h-5 w-56 rounded-md bg-card text-center text-[10px] leading-5 text-subtle sm:block">merchant.alliva.bh</span>
      </div>
      <img src={src} alt={alt} width={2160} height={1350} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block w-full" />
    </div>
  );
}

function Phone({ src, alt, className = '', eager = false }: { src: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <div className={`rounded-[2rem] bg-[#0b0d11] p-[6%] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.55)] ring-1 ring-white/10 transition-transform duration-500 ${className}`}>
      <img src={src} alt={alt} width={780} height={1688} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block w-full rounded-[1.5rem]" />
    </div>
  );
}

function SectionHeading({ eyebrow, title, body, dark = false }: { eyebrow: string; title: string; body: string; dark?: boolean }) {
  return (
    <div data-reveal className="reveal-up mx-auto max-w-2xl text-center">
      <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${dark ? 'text-primary' : 'text-primary-soft-foreground'}`}>{eyebrow}</p>
      <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-5xl">{title}</h2>
      <p className={`mt-4 text-base sm:text-lg ${dark ? 'text-white/65' : 'text-muted-foreground'}`}>{body}</p>
    </div>
  );
}

function Pillar({ icon: Icon, title, body, delay }: { icon: LucideIcon; title: string; body: string; delay: number }) {
  return (
    <div data-reveal className="reveal-up group rounded-2xl border bg-card p-6 shadow-xs transition-[box-shadow,transform] hover:-translate-y-1 hover:shadow-md" style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}>
      <span className="grid size-12 place-items-center rounded-xl bg-secondary text-primary transition-transform group-hover:scale-105">
        <Icon className="size-5" />
      </span>
      <p className="mt-5 text-lg font-semibold">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-4 space-y-3 text-sm text-white/65">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith('/') ? <Link href={href} className="transition-colors hover:text-white">{label}</Link> : <a href={href} className="transition-colors hover:text-white">{label}</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Social({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span aria-label={label} className="grid size-9 place-items-center rounded-full bg-white/10">
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">{children}</svg>
    </span>
  );
}

function PlanCard({ plan, locale, t, delay }: { plan: SubscriptionPlanView; locale: 'en' | 'ar'; t: T; delay: number }) {
  const plansT = useTranslations('plans');
  const name = pickLocalized(plan.name, locale);
  const amount = Number(plan.priceMonthly);
  const price = Number.isFinite(amount) && Math.abs(amount - Math.round(amount)) < 0.001 ? String(Math.round(amount)) : amount.toFixed(3);
  const features = planFeatures(plan, plansT);
  return (
    <article
      data-reveal
      className={`reveal-up relative flex flex-col rounded-3xl border p-7 transition-[box-shadow,transform] hover:-translate-y-1 ${plan.recommended ? 'border-transparent bg-secondary text-secondary-foreground shadow-lg' : 'bg-card shadow-xs hover:shadow-md'}`}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-2xl font-semibold">{name}</h3>
        {plan.recommended ? <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">{t('popular')}</span> : null}
      </div>
      <p className="mt-6 flex items-end gap-1.5">
        <span className="mb-1.5 text-sm font-semibold">{t('currency')}</span>
        <span className="font-display text-5xl font-semibold leading-none tracking-tight">{price}</span>
        <span className="mb-1.5 text-sm opacity-60">{t('perMonth')}</span>
      </p>
      <p className="mt-4 min-h-12 text-sm leading-6 opacity-75">{pickLocalized(plan.description, locale)}</p>
      <ul className="mt-6 space-y-3 border-t border-current/10 pt-6 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Link
        href={`/register?plan=${plan.id}&interval=MONTHLY`}
        className={`mt-8 inline-flex h-12 items-center justify-center rounded-xl text-sm font-semibold transition-colors ${plan.recommended ? 'bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]' : 'border border-border-strong hover:bg-muted'}`}
      >
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

function useScrolled(offset: number) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [offset]);
  return scrolled;
}

/** Marks [data-reveal] children visible once they scroll into view, so CSS can animate them in. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll<HTMLElement>('[data-reveal]:not([data-visible])');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-visible', '');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  });
  return ref;
}
