'use client';

import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';

const KEYFRAMES = `
@keyframes alliva-nav-progress {
  0% { transform: translate3d(-120%, 0, 0); }
  50% { transform: translate3d(80%, 0, 0); }
  100% { transform: translate3d(320%, 0, 0); }
}
`;

let stylesReady = false;
function ensureKeyframes() {
  if (stylesReady || typeof document === 'undefined') return;
  stylesReady = true;
  const style = document.createElement('style');
  style.setAttribute('data-alliva-nav-progress', '');
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

/**
 * Thin top progress bar for route changes, data fetches, and mutations.
 * Appearance is delayed so fast actions do not flash.
 */
export function NavigationProgress({ active, className }: { active: boolean; className?: string }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  useEffect(() => {
    if (active) {
      setExiting(false);
      const show = window.setTimeout(() => setVisible(true), 120);
      return () => window.clearTimeout(show);
    }
    if (!visible) return;
    setExiting(true);
    const hide = window.setTimeout(() => {
      setVisible(false);
      setExiting(false);
    }, 280);
    return () => window.clearTimeout(hide);
  }, [active, visible]);

  if (!visible && !exiting) return null;

  return (
    <div
      className={cn('pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden', className)}
      role="progressbar"
      aria-busy={active || undefined}
      aria-valuetext="Loading"
    >
      <div
        className={cn(
          'h-full bg-primary shadow-[0_0_8px_rgba(245,196,0,0.55)]',
          exiting ? 'w-full transition-[width] duration-300 ease-out' : 'w-[40%]',
        )}
        style={exiting ? undefined : { animation: 'alliva-nav-progress 1.1s ease-in-out infinite' }}
      />
    </div>
  );
}
