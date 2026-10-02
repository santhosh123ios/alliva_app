'use client';

import { api } from '@/components/providers';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { areas, usePlace } from '@/lib/place';
import { cn } from '@alliva/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ClipboardList, Heart, Home, MapPin, Search, ShoppingCart, User, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

export function CustomerShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations();
  const locale = useLocale() as 'en' | 'ar';
  const pathname = usePathname();
  const router = useRouter();
  const areaId = usePlace((state) => state.area);
  const setArea = usePlace((state) => state.setArea);
  const query = usePlace((state) => state.query);
  const setQuery = usePlace((state) => state.setQuery);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const cart = useQuery({ queryKey: ['cart'], queryFn: () => api.cart(), retry: false });
  const count = cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const cartPage = pathname === '/cart';
  const accountPage = pathname === '/profile';
  const ordersPage = pathname === '/orders' || pathname.startsWith('/orders/');
  const favouritesPage = pathname === '/favourites';
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    void api.guest().catch(() => undefined);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
  }, []);

  const onSearch = (value: string) => {
    setQuery(value);
    if (pathname !== '/') router.push('/');
  };

  const endSearch = () => setSearchOpen(false);

  const clearSearch = () => {
    setQuery('');
    setSearchOpen(false);
  };

  return (
    <div
      onClickCapture={playActionClick}
      className={cn('min-h-screen bg-white pb-32', cartPage && 'max-lg:pb-48', (cartPage || accountPage || ordersPage) && 'lg:bg-[#f6f6f4]', favouritesPage && 'bg-[#f7f7f5]')}
    >
      <header className={cn('sticky top-0 z-30 bg-white px-3 pt-3 pb-3 md:px-5 md:pt-4', cartPage && 'max-lg:hidden')}>
        <div className="relative mx-auto flex max-w-[1180px] items-center">
          <Link href="/" aria-label="Alliva" className="relative z-10 me-2 shrink-0 md:me-3">
            <img src="/logo-on-light.png" alt="" className="h-8 w-auto md:h-10" />
          </Link>
          <div className="flex h-14 min-w-0 flex-1 items-center gap-2 rounded-full bg-[#141416] ps-3.5 pe-3.5 text-white shadow-[0_10px_28px_rgba(17,17,17,0.14)] md:h-16 md:gap-3.5 md:ps-5 md:pe-5">
            <div className={cn('min-w-0', searchOpen && 'max-md:hidden')}>
              <LocationControl locale={locale} areaId={areaId} onSelect={setArea} label={t('customer.deliverTo')} />
            </div>
            {searchOpen ? (
              <SearchField
                dark
                value={query}
                onChange={onSearch}
                onCollapse={endSearch}
                onClear={clearSearch}
                placeholder={t('customer.searchPlaceholder')}
                label={t('common.search')}
                clearLabel={t('common.cancel')}
              />
            ) : null}
            <div className={cn('flex shrink-0 items-center gap-2.5 md:gap-3.5', searchOpen ? 'max-md:hidden' : 'ms-auto')}>
              {searchOpen ? null : (
                <button
                  type="button"
                  aria-label={t('common.search')}
                  aria-expanded={false}
                  onClick={() => setSearchOpen(true)}
                  className={cn('grid size-9 place-items-center rounded-full', query ? 'text-primary' : 'text-white')}
                >
                  <Search className="size-5" strokeWidth={2.1} />
                </button>
              )}
              <span aria-hidden className="h-5 w-px bg-white/30" />
              <Link href={pathname} locale={locale === 'ar' ? 'en' : 'ar'} className="text-sm font-semibold whitespace-nowrap text-white">
                {t('common.language')}
              </Link>
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 py-4 md:py-6">{children}</main>
      <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="pointer-events-auto px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))]">
          <Dock
            tabs={[
              { href: '/', key: 'home', icon: Home },
              { href: '/orders', key: 'orders', icon: ClipboardList },
              { href: '/favourites', key: 'favourites', icon: Heart },
              { href: me.data ? '/profile' : '/login', key: 'profile', icon: User },
              { href: '/cart', key: 'cart', icon: ShoppingCart },
            ]}
            pathname={pathname}
            count={count}
            label={(key) => t(`nav.${key}`)}
          />
        </div>
      </footer>
    </div>
  );
}

type DockTab = {
  href: string;
  key: 'home' | 'orders' | 'favourites' | 'profile' | 'cart';
  icon: LucideIcon;
};

function Dock({
  tabs,
  pathname,
  count,
  label,
}: {
  tabs: DockTab[];
  pathname: string;
  count: number;
  label: (key: DockTab['key']) => string;
}) {
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const gradientId = `dock-fill-${useId().replace(/:/g, '')}`;
  const [width, setWidth] = useState(0);
  const [centers, setCenters] = useState<number[]>([]);
  const [dragX, setDragX] = useState<number | null>(null);
  const centersRef = useRef(centers);
  centersRef.current = centers;
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tabActive(pathname, tab.href)));
  const target = centers[activeIndex] ?? null;
  const slide = useSlide(target, width > 0 ? width / 2 : 0);
  const center = dragX ?? slide.value;
  const dragIndex = dragX == null ? null : nearestIndex(dragX, centers);
  const shownIndex = dragIndex ?? activeIndex;
  const height = 74;
  const plate = width > 0 ? meniscusPlate(width, height, center) : null;
  const ActiveIcon = tabs[shownIndex]?.icon ?? Home;
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const finishDrag = (x: number, commit: boolean) => {
    const index = nearestIndex(x, centersRef.current);
    const tab = tabsRef.current[index];
    if (commit && tab && !tabActive(pathnameRef.current, tab.href)) {
      playTabSound();
      slideRef.current.park(x);
      router.push(tab.href);
    } else {
      slideRef.current.releaseAt(x);
    }
    setDragX(null);
  };
  const finishRef = useRef(finishDrag);
  finishRef.current = finishDrag;

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const links = [...nav.querySelectorAll<HTMLElement>('[data-dock-tab]')];
      setWidth(nav.clientWidth);
      setCenters(links.map((link) => link.offsetLeft + link.offsetWidth / 2));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname, tabs.length]);

  return (
    <nav ref={navRef} className="relative mx-auto h-[4.65rem] max-w-[28rem]" aria-label="Main">
      {plate ? (
        <svg
          aria-hidden
          className="absolute inset-0 overflow-visible"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#2c2c31" />
              <stop offset="1" stopColor="#141416" />
            </linearGradient>
          </defs>
          <path d={plate.d} fill={`url(#${gradientId})`} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        </svg>
      ) : (
        <div className="absolute inset-0 rounded-[1.7rem] bg-[#1a1a1d]" />
      )}
      {plate ? (
        <div
          aria-hidden
          className="pointer-events-none absolute size-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFC400]/45 blur-2xl"
          style={{ left: plate.bowlX, top: plate.bowlY }}
        />
      ) : null}
      {plate ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={label(tabs[shownIndex]?.key ?? 'home')}
          className="absolute z-10 grid size-14 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none place-items-center active:cursor-grabbing"
          style={{ left: plate.bowlX, top: plate.bowlY }}
          onPointerDown={(event) => {
            const nav = navRef.current;
            if (!nav || centersRef.current.length === 0) return;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Pointer capture needs a live pointer. Window listeners still follow the drag.
            }
            const xOf = (ev: PointerEvent) => clampCenter(ev.clientX - nav.getBoundingClientRect().left, centersRef.current);
            setDragX(xOf(event.nativeEvent));
            let settled = false;
            let moved = false;
            let dragSound: ReturnType<typeof beginDragSound> | null = null;
            const move = (ev: PointerEvent) => {
              const x = xOf(ev);
              if (!moved) dragSound = beginDragSound(centersRef.current);
              moved = true;
              setDragX(x);
              dragSound?.place(x);
            };
            const end = (ev: PointerEvent) => {
              if (settled) return;
              settled = true;
              dragSound?.stop();
              if (moved) {
                skipDockClick = true;
                window.setTimeout(() => {
                  skipDockClick = false;
                }, 50);
              }
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', end);
              window.removeEventListener('pointercancel', end);
              finishRef.current(xOf(ev), ev.type === 'pointerup');
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', end);
            window.addEventListener('pointercancel', end);
          }}
        >
          <span
            data-cart-target={tabs[shownIndex]?.key === 'cart' ? '' : undefined}
            className="relative grid size-11 place-items-center rounded-full bg-primary text-[#111] shadow-[0_8px_18px_rgba(255,196,0,0.45)]"
          >
            <ActiveIcon className="size-5" strokeWidth={2.25} />
            {tabs[shownIndex]?.key === 'cart' && count > 0 ? (
              <span className="absolute -top-1 -end-1 grid min-w-4 place-items-center rounded-full bg-[#111] px-1 text-[10px] font-bold text-primary">
                {count}
              </span>
            ) : null}
          </span>
        </button>
      ) : null}
      <div className="relative grid h-full grid-cols-5 px-5">
        {tabs.map((tab, index) => {
          const active = index === shownIndex;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-dock-tab=""
              aria-current={tabActive(pathname, tab.href) ? 'page' : undefined}
              aria-label={label(tab.key)}
              onClick={() => {
                if (skipDockClick) {
                  skipDockClick = false;
                  return;
                }
                if (!tabActive(pathname, tab.href)) playTabSound();
              }}
              className={cn(
                'flex h-full items-center justify-center',
                active && 'relative items-end pb-2 before:absolute before:-top-6 before:left-1/2 before:size-14 before:-translate-x-1/2',
              )}
            >
              {active ? (
                <span className="max-w-full truncate px-0.5 text-center text-[11px] font-semibold text-primary">{label(tab.key)}</span>
              ) : (
                <span data-cart-target={tab.key === 'cart' ? '' : undefined} className="relative text-white/75">
                  <Icon className="size-[1.35rem]" strokeWidth={2} />
                  {tab.key === 'cart' && count > 0 ? (
                    <span className="absolute -top-2 -end-2 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-[#111]">
                      {count}
                    </span>
                  ) : null}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function tabActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function useSlide(target: number | null, fallback: number) {
  const [value, setValue] = useState(fallback);
  const valueRef = useRef(fallback);
  const frame = useRef(0);
  const primed = useRef(false);
  const targetRef = useRef(target);
  targetRef.current = target;

  const animateTo = (dest: number) => {
    cancelAnimationFrame(frame.current);
    const tick = () => {
      const next = valueRef.current + (dest - valueRef.current) * 0.22;
      const shown = Math.abs(dest - next) < 0.4 ? dest : next;
      valueRef.current = shown;
      setValue(shown);
      if (shown !== dest) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const animateRef = useRef(animateTo);
  animateRef.current = animateTo;

  useEffect(() => {
    if (target == null) return;
    if (!primed.current) {
      primed.current = true;
      valueRef.current = target;
      setValue(target);
      return;
    }
    animateRef.current(target);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);

  const park = (x: number) => {
    cancelAnimationFrame(frame.current);
    valueRef.current = x;
    setValue(x);
  };
  const releaseAt = (x: number) => {
    park(x);
    if (targetRef.current != null) animateRef.current(targetRef.current);
  };
  return { value: target == null ? fallback : value, park, releaseAt };
}

let tabAudio: AudioContext | null = null;
let skipDockClick = false;

function audioContext() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    tabAudio ??= new Ctx();
  } catch {
    return null;
  }
  return tabAudio;
}

function beginDragSound(centers: number[]) {
  const ctx = audioContext();
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  let filter: BiquadFilterNode | null = null;
  let safety = 0;
  const min = centers.length ? Math.min(...centers) : 0;
  const max = centers.length ? Math.max(...centers) : 1;
  const ready = ctx
    ? ctx.resume().then(() => {
        if (stopped || !ctx) return;
        gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.03);
        gain.connect(ctx.destination);
        filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 900;
        filter.Q.value = 0.7;
        const length = Math.floor(ctx.sampleRate * 0.2);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
        source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(filter);
        filter.connect(gain);
        source.start();
        safety = window.setTimeout(stop, 4000);
      })
    : Promise.resolve();

  function place(x: number) {
    if (stopped || !filter || !ctx) return;
    const progress = Math.min(1, Math.max(0, (x - min) / Math.max(1, max - min)));
    filter.frequency.setTargetAtTime(620 + progress * 800, ctx.currentTime, 0.02);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(safety);
    void ready.then(() => {
      if (!source || !gain || !ctx) return;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      source.loop = false;
      try {
        source.stop(t + 0.05);
      } catch {
        // The buffer can already be stopped by the safety timer.
      }
    });
  }

  return { place, stop };
}

function playActionClick(event: React.MouseEvent) {
  if (skipDockClick) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const control = target.closest('button, a, [role="button"], [role="switch"], [role="tab"]');
  if (!control || control.closest('nav[aria-label="Main"]')) return;
  if (control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') return;
  playTabSound();
}

function playTabSound() {
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume().then(() => {
    const t = ctx.currentTime;
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(210, t);
    body.frequency.exponentialRampToValueAtTime(90, t + 0.035);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.22, t + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    body.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    body.start(t);
    body.stop(t + 0.05);

    const length = Math.floor(ctx.sampleRate * 0.012);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 8;
    const click = ctx.createBufferSource();
    click.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    filter.Q.value = 0.6;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.28, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.016);
    click.connect(filter);
    filter.connect(clickGain);
    clickGain.connect(ctx.destination);
    click.start(t);
    click.stop(t + 0.016);
  }).catch(() => undefined);
}

function nearestIndex(x: number, centers: number[]) {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  centers.forEach((point, index) => {
    const dist = Math.abs(point - x);
    if (dist < bestDist) {
      best = index;
      bestDist = dist;
    }
  });
  return best;
}

function clampCenter(x: number, centers: number[]) {
  if (centers.length === 0) return x;
  return Math.min(Math.max(...centers), Math.max(Math.min(...centers), x));
}

function meniscusPlate(width: number, height: number, center: number) {
  const corner = 22;
  const shoulder = 8;
  let bowl = 26;
  let bowlY = 2;
  let reach = Math.sqrt((shoulder + bowl) ** 2 - (shoulder - bowlY) ** 2);
  const room = Math.min(center - corner - 1, width - center - corner - 1);
  if (reach > room) {
    reach = Math.max(16, room);
    bowl = Math.sqrt(reach ** 2 + (shoulder - bowlY) ** 2) - shoulder;
  }
  const leftX = center - reach;
  const span = shoulder + bowl;
  const dx = reach / span;
  const dy = (bowlY - shoulder) / span;
  const contactLeftX = leftX + dx * shoulder;
  const contactLeftY = shoulder + dy * shoulder;
  const contactRightX = center + (center - contactLeftX);
  const contactRightY = contactLeftY;
  const rightX = center + reach;
  const d = [
    `M ${corner} 0`,
    `H ${leftX.toFixed(2)}`,
    `A ${shoulder} ${shoulder} 0 0 1 ${contactLeftX.toFixed(2)} ${contactLeftY.toFixed(2)}`,
    `A ${bowl.toFixed(2)} ${bowl.toFixed(2)} 0 0 0 ${contactRightX.toFixed(2)} ${contactRightY.toFixed(2)}`,
    `A ${shoulder} ${shoulder} 0 0 1 ${rightX.toFixed(2)} 0`,
    `H ${width - corner}`,
    `A ${corner} ${corner} 0 0 1 ${width} ${corner}`,
    `V ${height - corner}`,
    `A ${corner} ${corner} 0 0 1 ${width - corner} ${height}`,
    `H ${corner}`,
    `A ${corner} ${corner} 0 0 1 0 ${height - corner}`,
    `V ${corner}`,
    `A ${corner} ${corner} 0 0 1 ${corner} 0`,
    'Z',
  ].join(' ');
  return { d, bowlX: center, bowlY };
}

function SearchField({
  value,
  onChange,
  onCollapse,
  onClear,
  placeholder,
  label,
  clearLabel,
  dark = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onCollapse: () => void;
  onClear: () => void;
  placeholder: string;
  label: string;
  clearLabel: string;
  dark?: boolean;
}) {
  const rootRef = useRef<HTMLLabelElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCollapseRef = useRef(onCollapse);
  onCollapseRef.current = onCollapse;
  useEffect(() => {
    inputRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onCollapseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCollapseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <label ref={rootRef} className="relative min-w-0 flex-1">
      <span className="sr-only">{label}</span>
      <Search className={cn('pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2', dark ? 'text-white/70' : 'text-[#8d8d88]')} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onCollapseRef.current()}
        placeholder={placeholder}
        className={cn(
          'h-10 w-full rounded-full ps-10 pe-11 text-sm outline-none',
          dark
            ? 'border border-white/15 bg-white/10 text-white placeholder:text-white/45 focus:border-white/40'
            : 'h-11 border border-[#e6e6e0] bg-white placeholder:text-[#8d8d88] focus:border-[#111]',
        )}
      />
      <button
        type="button"
        aria-label={clearLabel}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClear}
        className={cn('absolute end-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full', dark ? 'text-white/70' : 'text-[#6f6f6a]')}
      >
        <X className="size-4" />
      </button>
    </label>
  );
}

function LocationControl({
  locale,
  areaId,
  onSelect,
  label,
}: {
  locale: 'en' | 'ar';
  areaId: string;
  onSelect: (area: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const area = areas.find((item) => item.id === areaId) ?? areas[0]!;
  const name = locale === 'ar' ? area.ar : area.en;
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="relative min-w-0" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="relative flex min-w-0 max-w-[9.5rem] items-center gap-1.5 rounded-full bg-[#2a2a2e] px-3 pt-1.5 pb-2 text-sm font-semibold text-white ring-1 ring-inset ring-white/10 md:max-w-none md:gap-2 md:px-3.5"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MapPin className="size-3.5 shrink-0" strokeWidth={2.25} />
        <span className="min-w-0 truncate">{name}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-90" />
        <span aria-hidden className="absolute bottom-1 left-1/2 h-[3px] w-8 -translate-x-1/2 rounded-full bg-primary" />
      </button>
      {open ? (
        <ul className="absolute start-0 z-40 mt-3 w-56 overflow-hidden rounded-2xl border border-[#eee] bg-white py-1 text-[#111] shadow-lg">
          {areas.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={cn('flex w-full px-4 py-2.5 text-start text-sm font-medium hover:bg-[#f7f7f5]', item.id === area.id && 'bg-[#fff6d0]')}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                {locale === 'ar' ? item.ar : item.en}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
