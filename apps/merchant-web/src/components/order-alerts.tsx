import { api } from '@/components/providers';
import type { MerchantDashboard } from '@alliva/types';
import { useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Play, Volume1, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'use-intl';

const MUTE_KEY = 'alliva.merchant.orderSound';
const VOLUME_KEY = 'alliva.merchant.orderVolume';
const HANDLED_EVENT = 'alliva:order-handled';
const REPEAT_MS = 5000;

let audio: AudioContext | null = null;
let master: GainNode | null = null;
let playing: OscillatorNode[] = [];

function context() {
  if (typeof window === 'undefined') return null;
  if (!audio) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
    // Tones go through a volume stage and a limiter, so loud overlapping beeps never clip.
    const limiter = audio.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    master = audio.createGain();
    master.connect(limiter).connect(audio.destination);
  }
  return audio;
}

/** Resumes the shared audio context; must run inside a user gesture to satisfy autoplay rules. */
export async function unlock() {
  const ctx = context();
  if (!ctx) return false;
  if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
  // Asking once starts the browser loading its voice list, so the first announcement can pick one.
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  return ctx.state === 'running';
}

/** Cuts off any alert that is still sounding. */
function silence() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  playing.forEach((osc) => {
    try {
      osc.stop();
    } catch {
      // Already finished.
    }
  });
  playing = [];
}

/**
 * Plays a loud kitchen-style alert (two bursts of three beeps) at `volume` (0–1).
 * Returns false when the browser has not allowed audio yet.
 */
export function chime(volume: number) {
  const ctx = context();
  if (!ctx || !master || ctx.state !== 'running') return false;
  silence();
  master.gain.value = volume;
  const start = ctx.currentTime + 0.02;
  const beeps = [0, 0.16, 0.32, 0.7, 0.86, 1.02];
  beeps.forEach((offset, index) => {
    const frequency = index % 3 === 2 ? 1568 : 1175;
    const at = start + offset;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + 0.01);
    gain.gain.setValueAtTime(1, at + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    gain.connect(master!);
    // A square wave plus a sine an octave down cuts through kitchen noise far better than a plain tone.
    ([['square', frequency, 0.45], ['sine', frequency / 2, 0.55]] as const).forEach(([type, hz, level]) => {
      const osc = ctx.createOscillator();
      const mix = ctx.createGain();
      osc.type = type;
      osc.frequency.value = hz;
      mix.gain.value = level;
      osc.connect(mix).connect(gain);
      osc.start(at);
      osc.stop(at + 0.14);
      osc.onended = () => {
        playing = playing.filter((item) => item !== osc);
      };
      playing.push(osc);
    });
  });
  return true;
}

/** Picks a voice for `lang`, preferring the higher-quality ones browsers ship next to the robotic defaults. */
function voiceFor(lang: string) {
  const prefix = lang.slice(0, 2).toLowerCase();
  // macOS lists novelty voices (Bubbles, Zarvox, ...) beside the real ones; never announce an order in those.
  const novelty = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
  const matching = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(prefix) && !novelty.test(voice.name));
  const human = /natural|neural|premium|enhanced|google|siri/i;
  return matching.find((voice) => human.test(voice.name)) ?? matching.find((voice) => voice.default) ?? matching[0] ?? null;
}

/**
 * Speaks `text` in a human voice at `volume` (0–1), falling back to the beep alert when the
 * browser has no speech engine or no voice for the portal's language.
 * Returns false when the browser has not allowed audio yet.
 */
export function announce(text: string, locale: string, volume: number) {
  const ctx = context();
  // The audio context doubles as the autoplay check: speech needs the same user gesture first.
  if (!ctx || ctx.state !== 'running') return false;
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return chime(volume);
  const lang = locale === 'ar' ? 'ar-SA' : 'en-US';
  const voices = window.speechSynthesis.getVoices();
  const voice = voiceFor(lang);
  // Voices load lazily; an empty list just means "not listed yet", so let the browser pick by language.
  if (voices.length && !voice) return chime(volume);
  silence();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  if (voice) utterance.voice = voice;
  utterance.volume = volume;
  utterance.rate = 0.95;
  utterance.onerror = (event) => {
    if (event.error !== 'interrupted' && event.error !== 'canceled') chime(volume);
  };
  window.speechSynthesis.speak(utterance);
  return true;
}

function readMuted() {
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'off';
  } catch {
    return false;
  }
}

function readVolume() {
  try {
    const stored = Number(window.localStorage.getItem(VOLUME_KEY));
    return window.localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(stored) ? Math.min(1, Math.max(0.05, stored)) : 1;
  } catch {
    return 1;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the setting still works for this visit.
  }
}

/** Tell the alert that staff acted on an order, so its sound stops right away instead of on the next refetch. */
export function orderHandled(id: string) {
  window.dispatchEvent(new CustomEvent(HANDLED_EVENT, { detail: id }));
}

/** Keeps order queries fresh over the socket. Any screen that shows live orders mounts this once. */
export function useOrderUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    let retry: number | undefined;
    // Socket tokens are short-lived, so every (re)connect asks for a fresh one.
    const socket = io(import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:4000', {
      auth: (send) => {
        api.socketToken().then(({ token }) => send({ token }), () => send({}));
      },
    });
    const refresh = () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'orders'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'dashboard'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'kitchen'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'floor'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'billing'] });
    };
    socket.on('order.updated', refresh);
    socket.on('service.updated', () => {
      void client.invalidateQueries({ queryKey: ['merchant', 'floor'] });
      void client.invalidateQueries({ queryKey: ['merchant', 'billing'] });
    });
    // Catch up on anything missed while the connection was down.
    let connected = false;
    socket.on('connect', () => {
      if (connected) refresh();
      connected = true;
    });
    socket.on('disconnect', (reason) => {
      // The server drops sockets whose token it rejects; socket.io does not retry those on its own.
      if (reason === 'io server disconnect') retry = window.setTimeout(() => socket.connect(), 5000);
    });
    return () => {
      window.clearTimeout(retry);
      socket.close();
    };
  }, [client]);
}

/**
 * Portal-wide new-order alerts: keeps order queries fresh over the socket, rings while
 * newly arrived PENDING orders are still unaccepted, and renders the sound controls.
 */
export function OrderAlerts({ orders }: { orders?: MerchantDashboard['liveOrders'] }) {
  const t = useTranslations('workspace.alerts');
  const locale = useLocale();
  const client = useQueryClient();
  const [muted, setMuted] = useState(readMuted);
  const [volume, setVolume] = useState(readVolume);
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [ringing, setRinging] = useState(false);
  const [arrivals, setArrivals] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const arrived = useRef(new Set<string>());
  const volumeRef = useRef(volume);
  const speech = useRef({ text: t('announcement'), locale });
  const panel = useRef<HTMLDivElement>(null);
  volumeRef.current = volume;
  speech.current = { text: t('announcement'), locale };

  useOrderUpdates();

  useEffect(() => {
    const onGesture = () => {
      void unlock().then((ok) => {
        if (ok) setBlocked(false);
      });
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, []);

  useEffect(() => {
    const onHandled = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!arrived.current.delete(id)) return;
      if (arrived.current.size === 0) {
        silence();
        setRinging(false);
      }
    };
    window.addEventListener(HANDLED_EVENT, onHandled);
    return () => window.removeEventListener(HANDLED_EVENT, onHandled);
  }, []);

  useEffect(() => {
    if (!orders) return;
    const pending = orders.filter((order) => order.status === 'PENDING');
    if (seen.current === null) {
      // First load is the baseline: orders already waiting do not ring.
      seen.current = new Set(pending.map((order) => order.id));
      return;
    }
    const known = seen.current;
    const fresh = pending.filter((order) => !known.has(order.id));
    fresh.forEach((order) => {
      known.add(order.id);
      arrived.current.add(order.id);
    });
    if (fresh.length) {
      setArrivals((count) => count + 1);
      fresh.forEach((order) => toast(t('newOrder', { number: order.number.replace(/^#/, '') })));
    }
    // Forget arrivals that are no longer waiting, then ring only while some still are.
    const waiting = new Set(pending.map((order) => order.id));
    arrived.current.forEach((id) => {
      if (!waiting.has(id)) arrived.current.delete(id);
    });
    setRinging(arrived.current.size > 0);
  }, [orders, t]);

  useEffect(() => {
    if (!ringing || muted) {
      silence();
      return;
    }
    const ring = () => setBlocked(!announce(speech.current.text, speech.current.locale, volumeRef.current));
    ring();
    const id = window.setInterval(ring, REPEAT_MS);
    return () => window.clearInterval(id);
  }, [ringing, muted, arrivals]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    store(MUTE_KEY, next ? 'off' : 'on');
    if (!next) void unlock().then((ok) => setBlocked(!ok && ringing));
  }

  function changeVolume(next: number) {
    setVolume(next);
    store(VOLUME_KEY, String(next));
    if (master) master.gain.value = next;
  }

  async function test() {
    const ok = await unlock();
    setBlocked(!ok);
    if (ok) announce(speech.current.text, speech.current.locale, volumeRef.current);
  }

  const percent = Math.round(volume * 100);

  return (
    <>
      {blocked && !muted ? (
        <button
          type="button"
          onClick={() => void test()}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-[#111111]"
        >
          <Volume2 className="size-4" />
          <span className="hidden sm:inline">{t('enableSound')}</span>
        </button>
      ) : null}
      <div ref={panel} className="relative">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t('settings')}
          title={t('settings')}
          onClick={() => setOpen((value) => !value)}
          className={`grid size-10 place-items-center rounded-full border border-[#E6E6E2] bg-white ${ringing && !muted ? 'text-[#C49200]' : 'text-[#161616]'}`}
        >
          {muted ? <BellOff className="size-4 text-[#8A8A86]" /> : <BellRing className={`size-4 ${ringing ? 'motion-safe:animate-bounce' : ''}`} />}
        </button>
        {open ? (
          <div role="dialog" aria-label={t('settings')} className="absolute end-0 top-12 z-50 w-64 rounded-2xl border border-[#E6E6E2] bg-white p-4 text-[#161616] shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{t('sound')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!muted}
                aria-label={muted ? t('unmute') : t('mute')}
                onClick={toggleMute}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${muted ? 'bg-[#D9D9D5]' : 'bg-primary'}`}
              >
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[inset-inline-start] ${muted ? 'start-0.5' : 'start-[1.375rem]'}`} />
              </button>
            </div>
            <label className="mt-4 block text-xs font-medium text-[#6B6B67]" htmlFor="order-alert-volume">
              {t('volume')}
              <span className="float-end tabular-nums text-[#161616]">{percent}%</span>
            </label>
            <div className="mt-2 flex items-center gap-2">
              <Volume1 className="size-4 shrink-0 text-[#8A8A86]" />
              <input
                id="order-alert-volume"
                type="range"
                min={5}
                max={100}
                step={5}
                value={percent}
                disabled={muted}
                onChange={(event) => changeVolume(Number(event.target.value) / 100)}
                onPointerUp={() => void test()}
                onKeyUp={(event) => {
                  if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') void test();
                }}
                className="w-full accent-[#C49200] disabled:opacity-40"
              />
              <Volume2 className="size-4 shrink-0 text-[#8A8A86]" />
            </div>
            <button
              type="button"
              onClick={() => void test()}
              disabled={muted}
              className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[#E6E6E2] text-xs font-semibold disabled:opacity-40"
            >
              <Play className="size-3.5" />
              {t('test')}
            </button>
            <p className="mt-3 text-[11px] leading-snug text-[#8A8A86]">{t('hint')}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
