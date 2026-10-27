import { useEffect, useState } from 'react';

let count = 0;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** Mark a non-query async action as busy (e.g. raw fetch). Returns a release fn. */
export function trackBusy(): () => void {
  count += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    notify();
  };
}

export function useManualBusy() {
  const [busy, setBusy] = useState(count > 0);
  useEffect(() => {
    const listener = () => setBusy(count > 0);
    listeners.add(listener);
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return busy;
}
