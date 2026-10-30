import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@alliva/ui';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * The floating dock the customer app uses, for the rider app: a dark plate whose bowl slides to
 * the active tab and can be dragged between tabs. Kept in step with the customer shell's Dock.
 */
export type DockTab = { href: string; key: string; label: string; icon: LucideIcon };

export function Dock({ tabs, active: activeKey, label }: { tabs: DockTab[]; active: string; label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const navRef = useRef<HTMLElement>(null);
  const gradientId = `dock-fill-${useId().replace(/:/g, '')}`;
  const [width, setWidth] = useState(0);
  const [centers, setCenters] = useState<number[]>([]);
  const [dragX, setDragX] = useState<number | null>(null);
  const centersRef = useRef(centers);
  centersRef.current = centers;
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeKey));
  const target = centers[activeIndex] ?? null;
  const slide = useSlide(target, width > 0 ? width / 2 : 0);
  const center = dragX ?? slide.value;
  const dragIndex = dragX == null ? null : nearestIndex(dragX, centers);
  const shownIndex = dragIndex ?? activeIndex;
  const height = 74;
  const plate = width > 0 ? meniscusPlate(width, height, center) : null;
  const ActiveIcon = tabs[shownIndex]?.icon ?? tabs[0]!.icon;
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const activeRef = useRef(activeKey);
  activeRef.current = activeKey;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const finishDrag = (x: number, commit: boolean) => {
    const index = nearestIndex(x, centersRef.current);
    const tab = tabsRef.current[index];
    if (commit && tab && tab.key !== activeRef.current) {
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
    <nav ref={navRef} className="relative mx-auto h-[4.65rem] max-w-[28rem]" aria-label={label}>
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
          aria-label={tabs[shownIndex]?.label ?? ''}
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
          <span className="relative grid size-11 place-items-center rounded-full bg-primary text-[#111] shadow-[0_8px_18px_rgba(255,196,0,0.45)]">
            <ActiveIcon className="size-5" strokeWidth={2.25} />
          </span>
        </button>
      ) : null}
      <div className="relative grid h-full px-5" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab, index) => {
          const active = index === shownIndex;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              data-dock-tab=""
              aria-current={tab.key === activeKey ? 'page' : undefined}
              aria-label={tab.label}
              onClick={() => {
                if (skipDockClick) {
                  skipDockClick = false;
                  return;
                }
                if (tab.key !== activeKey) playTabSound();
              }}
              className={cn(
                'flex h-full items-center justify-center',
                active && 'relative items-end pb-2 before:absolute before:-top-6 before:left-1/2 before:size-14 before:-translate-x-1/2',
              )}
            >
              {active ? (
                <span className="max-w-full truncate px-0.5 text-center text-[11px] font-semibold text-primary">{tab.label}</span>
              ) : (
                <span className="relative text-white/75">
                  <Icon className="size-[1.35rem]" strokeWidth={2} />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
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
