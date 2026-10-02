'use client';

import { cn } from '@alliva/ui';

export function CartButtonSpinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-[#111]/25 border-t-[#111]', className)} />;
}

export function flyFromButton(button: HTMLButtonElement, src: string) {
  const root = button.closest('article, li');
  flyToCart(root?.querySelector('img') ?? null, button, src);
}

export function flyToCart(photo: HTMLImageElement | null, button: HTMLButtonElement, src: string) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    playCartSuccess();
    return;
  }
  const target = document.querySelector<HTMLElement>('[data-cart-target]');
  if (!target) {
    playCartSuccess();
    return;
  }
  const photoBox = photo?.getBoundingClientRect();
  const buttonBox = button.getBoundingClientRect();
  const photoVisible = Boolean(photoBox && photoBox.bottom > 88 && photoBox.top < window.innerHeight - 40 && photoBox.width > 0);
  const from = photoVisible && photoBox ? photoBox : buttonBox;
  const to = target.getBoundingClientRect();
  const size = photoVisible ? Math.min(104, Math.max(72, from.width * 0.34)) : 52;
  const top = photoVisible ? Math.max(from.top, 72) : from.top;
  const bottom = photoVisible ? Math.min(from.bottom, window.innerHeight - 24) : from.bottom;
  const startX = from.left + from.width / 2 - size / 2;
  const startY = (top + bottom) / 2 - size / 2;
  const endX = to.left + to.width / 2 - 12;
  const endY = to.top + to.height / 2 - 12;
  const dx = endX - startX;
  const dy = endY - startY;
  const lift = -Math.min(150, Math.max(70, Math.abs(dy) * 0.28));
  const flyer = document.createElement('img');
  flyer.src = src;
  flyer.alt = '';
  flyer.setAttribute('data-fly-cart', '');
  flyer.setAttribute('aria-hidden', 'true');
  Object.assign(flyer.style, {
    position: 'fixed',
    zIndex: '70',
    left: '0',
    top: '0',
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '22px',
    objectFit: 'cover',
    pointerEvents: 'none',
    boxShadow: '0 14px 32px rgba(17,17,17,0.22)',
  });
  document.body.appendChild(flyer);
  const animation = flyer.animate(
    [
      { transform: `translate(${startX}px, ${startY}px) scale(1)`, opacity: 1 },
      { transform: `translate(${startX + dx * 0.28}px, ${startY + lift}px) scale(0.86)`, opacity: 1, offset: 0.28 },
      { transform: `translate(${startX + dx * 0.72}px, ${startY + dy * 0.62 + lift * 0.35}px) scale(0.48)`, opacity: 1, offset: 0.68 },
      { transform: `translate(${endX}px, ${endY}px) scale(0.18)`, opacity: 1 },
    ],
    { duration: 860, easing: 'cubic-bezier(0.45, 0.05, 0.2, 1)', fill: 'forwards' },
  );
  const finish = () => {
    flyer.remove();
    target.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.35)' },
        { transform: 'scale(0.92)' },
        { transform: 'scale(1)' },
      ],
      { duration: 340, easing: 'ease-out' },
    );
    playCartSuccess();
  };
  animation.finished.then(finish).catch(() => flyer.remove());
}

let cartAudio: AudioContext | null = null;

function playCartSuccess() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try {
    cartAudio ??= new Ctx();
  } catch {
    return;
  }
  const ctx = cartAudio;
  void ctx.resume().then(() => {
    const t = ctx.currentTime;
    [523.25, 783.99].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + index * 0.06;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(index === 0 ? 0.09 : 0.13, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.21);
    });
  }).catch(() => undefined);
}
