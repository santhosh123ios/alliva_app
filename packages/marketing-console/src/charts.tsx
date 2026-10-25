import { useId } from 'react';
import { formatNumber } from './format';
import { useLang } from './i18n';

export type Point = { label: string; value: number };

const monthFormat = (month: string, lang: string) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', { month: 'short', timeZone: 'UTC' }).format(date);
};

/** Compact SVG bar chart; the values are real series from the API, never decorative. */
export function BarChart({ data, unit, title }: { data: Point[]; unit?: string; title: string }) {
  const lang = useLang();
  const id = useId();
  const max = Math.max(1, ...data.map((point) => point.value));
  const width = 100;
  const height = 48;
  const gap = 3;
  const bar = (width - gap * (data.length - 1)) / Math.max(1, data.length);
  return (
    <figure aria-labelledby={id} className="space-y-2">
      <figcaption id={id} className="sr-only">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height + 8}`} className="h-40 w-full" role="img" aria-label={title} preserveAspectRatio="none">
        <line x1="0" y1={height} x2={width} y2={height} stroke="#e5e5e0" strokeWidth="0.4" />
        {data.map((point, index) => {
          const h = (point.value / max) * (height - 4);
          return (
            <g key={point.label}>
              <rect x={index * (bar + gap)} y={height - h} width={bar} height={Math.max(h, point.value > 0 ? 0.8 : 0)} rx="1" fill="#FFD60A">
                <title>{`${monthFormat(point.label, lang)}: ${formatNumber(point.value, lang, unit ? 3 : 0)}${unit ? ` ${unit}` : ''}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        {data.map((point) => <span key={point.label}>{monthFormat(point.label, lang)}</span>)}
      </div>
    </figure>
  );
}

/** Horizontal funnel: bar widths are relative to the largest stage. */
export function Funnel({ stages }: { stages: { key: string; label: string; count: number }[] }) {
  const lang = useLang();
  const max = Math.max(1, ...stages.map((stage) => stage.count));
  return (
    <ul className="space-y-2">
      {stages.map((stage) => (
        <li key={stage.key} className="grid grid-cols-[9.5rem_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{stage.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(stage.count / max) * 100}%` }} />
          </span>
          <span className="text-end tabular-nums font-semibold">{formatNumber(stage.count, lang)}</span>
        </li>
      ))}
    </ul>
  );
}
