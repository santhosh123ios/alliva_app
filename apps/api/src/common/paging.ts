export type PageQuery = { page: number; pageSize: number; skip: number; q: string };

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

type Raw = Record<string, unknown>;

function one(value: unknown): string | undefined {
  if (Array.isArray(value)) return one(value[0]);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readQuery(query: Raw): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(query)) out[key] = one(query[key]);
  return out;
}

export function pageQuery(query: Raw, maxPageSize = 100): PageQuery {
  const q = readQuery(query);
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const pageSize = Math.min(maxPageSize, Math.max(1, Math.floor(Number(q.pageSize) || 20)));
  return { page, pageSize, skip: (page - 1) * pageSize, q: (q.q ?? '').slice(0, 100) };
}

export function paged<T>(items: T[], total: number, query: PageQuery): Page<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+03:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function dateRange(query: Record<string, string | undefined>, from = 'from', to = 'to') {
  const gte = parseDate(query[from]);
  const lte = parseDate(query[to], true);
  return gte || lte ? { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } : undefined;
}
