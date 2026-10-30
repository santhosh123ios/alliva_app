import { cn } from '@alliva/ui';
import { useState } from 'react';

/** The one hue store charts use for magnitude: one series, so no legend; the card title names it. */
const BAR = '#2F6FED';

export type BarPoint = { key: string; label: string; value: number; tip: string };

/**
 * Vertical single-series bars with a hover tooltip. Bars sit on the baseline with rounded tops
 * and a 2px gap; axis labels show every `labelEvery`-th point so they never collide.
 */
export function ColumnChart({ points, labelEvery = 1, height = 160, empty }: { points: BarPoint[]; labelEvery?: number; height?: number; empty: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...points.map((point) => point.value));
  if (!points.length || max === 0) return <p className="grid place-items-center text-sm text-[#8A8A86]" style={{ height }}>{empty}</p>;
  const shown = active === null ? null : points[active];
  return (
    <div className="relative" onMouseLeave={() => setActive(null)}>
      <div className="flex items-end gap-[2px] border-b border-[#E6E6E2]" style={{ height }} role="img" aria-label={points.map((point) => point.tip).join(', ')}>
        {points.map((point, index) => (
          <button
            key={point.key}
            type="button"
            tabIndex={-1}
            aria-hidden
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            className="group flex h-full min-w-0 flex-1 items-end"
          >
            <span
              className={cn('block w-full rounded-t-[4px] transition-opacity', active !== null && active !== index && 'opacity-40')}
              style={{ height: `${point.value > 0 ? Math.max(2, (point.value / max) * 100) : 0}%`, background: BAR }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[10px] text-[#8A8A86]">
        {points.map((point, index) => (
          <span key={point.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{index % labelEvery === 0 ? point.label : ''}</span>
        ))}
      </div>
      {shown ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-[#161616] px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg rtl:translate-x-1/2"
          style={{ insetInlineStart: `${((active! + 0.5) / points.length) * 100}%` }}
        >
          {shown.tip}
        </div>
      ) : null}
    </div>
  );
}

/** Ranked horizontal bars for a share of a total, with the value written beside each bar. */
export function ShareBars({ rows }: { rows: { key: string; label: string; value: number; detail: string }[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(0, ...rows.map((row) => row.value));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key} title={row.detail}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-[#161616]">{row.label}</span>
            <span className="shrink-0 tabular-nums text-[#5C5C58]">{row.detail} · {total ? Math.round((row.value / total) * 100) : 0}%</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[#F1F1EE]">
            <div className="h-2 rounded-full" style={{ width: `${max ? (row.value / max) * 100 : 0}%`, background: BAR }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
