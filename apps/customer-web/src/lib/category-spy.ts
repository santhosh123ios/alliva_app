import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A menu shown as one list of category sections under a sticky chip bar. Scrolling selects the chip of the
 * section at the top of the screen (and slides it into view); tapping a chip scrolls to its section.
 */
export function useCategorySpy(ids: string[]) {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const sections = useRef(new Map<string, HTMLElement>());
  const chips = useRef(new Map<string, HTMLElement>());
  const strip = useRef<HTMLDivElement | null>(null);
  // While a tapped chip scrolls the page, the sections it passes must not take the selection back.
  const jumping = useRef<{ id: string; timer: number } | null>(null);
  const key = ids.join('|');

  /** Where the sections disappear under the pinned chip bar, in viewport pixels. */
  const line = useCallback(() => {
    const bar = strip.current;
    if (!bar) return 0;
    return (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight;
  }, []);

  useEffect(() => {
    const list = key ? key.split('|') : [];
    const update = () => {
      if (jumping.current) return;
      const edge = line() + 8;
      let current = list[0] ?? null;
      for (const id of list) {
        const top = sections.current.get(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= edge) current = id;
      }
      // At the very bottom the last short sections can never reach the top; select the last one.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = list[list.length - 1] ?? current;
      setActive(current);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [key, line]);

  useEffect(() => {
    // Keep the selected chip visible in the sideways-scrolling bar, without moving the page.
    const bar = strip.current;
    const chip = active ? chips.current.get(active) : undefined;
    if (!bar || !chip) return;
    const left = chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2;
    bar.scrollTo({ left, behavior: 'smooth' });
  }, [active]);

  const select = useCallback(
    (id: string) => {
      const section = sections.current.get(id);
      if (!section) return;
      setActive(id);
      if (jumping.current) window.clearTimeout(jumping.current.timer);
      const release = () => {
        jumping.current = null;
        window.removeEventListener('scrollend', release);
      };
      // Released when the smooth scroll ends (or after a while where scrollend is not supported).
      jumping.current = { id, timer: window.setTimeout(release, 900) };
      window.addEventListener('scrollend', release, { once: true });
      window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - line(), behavior: 'smooth' });
    },
    [line],
  );

  const sectionRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) sections.current.set(id, element);
      else sections.current.delete(id);
    },
    [],
  );
  const chipRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) chips.current.set(id, element);
      else chips.current.delete(id);
    },
    [],
  );

  return { active, select, strip, sectionRef, chipRef };
}
