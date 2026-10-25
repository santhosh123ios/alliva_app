export const TIME_ZONE = 'Asia/Bahrain';

const numberLocale = (locale: string) => (locale === 'ar' ? 'ar-u-nu-latn' : 'en-US');

export function formatMoney(value: string | number | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `BHD ${amount.toLocaleString(numberLocale(locale), { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

export function formatNumber(value: string | number | null | undefined, locale: string, digits = 0): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString(numberLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(numberLocale(locale), { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(numberLocale(locale), { timeZone: TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

/** ISO instant -> value for <input type="datetime-local"> in Bahrain time. */
export function toLocalInput(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/** Value of <input type="datetime-local"> (Bahrain wall clock) -> ISO instant. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Bahrain calendar day for <input type="date">. */
export function toDateInput(value: string | null | undefined): string {
  return value ? toLocalInput(value).slice(0, 10) : '';
}

export function relativeFrom(value: string, now = Date.now()): number {
  return new Date(value).getTime() - now;
}
