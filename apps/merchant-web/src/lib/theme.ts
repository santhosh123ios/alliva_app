import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const storageKey = 'alliva-merchant-theme';
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage can be blocked; fall back to light.
  }
  return 'light';
}

function systemDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Puts the chosen palette on <html>. index.html runs the same check before first paint. */
export function applyTheme(choice: ThemeChoice = readChoice()) {
  const dark = choice === 'dark' || (choice === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const choice = useSyncExternalStore(subscribe, readChoice, () => 'light' as ThemeChoice);
  useEffect(() => {
    if (choice !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme('system');
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [choice]);
  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Still switch for this visit.
    }
    applyTheme(next);
    listeners.forEach((listener) => listener());
  }, []);
  const resolved: 'light' | 'dark' = choice === 'dark' || (choice === 'system' && systemDark()) ? 'dark' : 'light';
  return { choice, resolved, setChoice };
}
