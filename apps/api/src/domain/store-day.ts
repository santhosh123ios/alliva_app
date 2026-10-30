/** Store days run on Bahrain time (UTC+3, no daylight saving). */
const OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** Midnight in Bahrain on the day `now` falls in. */
export function startOfDay(now = new Date()) {
  const bahrain = new Date(now.getTime() + OFFSET_MS);
  bahrain.setUTCHours(0, 0, 0, 0);
  return new Date(bahrain.getTime() - OFFSET_MS);
}

/** `YYYY-MM-DD` for the Bahrain day `at` falls in. */
export function dayKey(at: Date) {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour of day (0–23) in Bahrain. */
export function hourOf(at: Date) {
  return new Date(at.getTime() + OFFSET_MS).getUTCHours();
}

/** Start of a `YYYY-MM-DD` Bahrain day, or null when the text is not a real date. */
export function parseDay(text: string | undefined | null) {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const start = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== text) return null;
  return new Date(start.getTime() - OFFSET_MS);
}

/**
 * Inclusive day range `[from, to]` as `[start, end)` instants. Defaults to the last `fallbackDays` days ending today.
 * Swapped ends are put in order and the span is capped at `maxDays`.
 */
export function dayRange(input: { from?: string | null; to?: string | null }, now = new Date(), fallbackDays = 7, maxDays = 366) {
  const today = startOfDay(now);
  let end = parseDay(input.to) ?? today;
  let start = parseDay(input.from) ?? new Date(end.getTime() - (fallbackDays - 1) * DAY_MS);
  if (start > end) [start, end] = [end, start];
  if ((end.getTime() - start.getTime()) / DAY_MS >= maxDays) start = new Date(end.getTime() - (maxDays - 1) * DAY_MS);
  const days: string[] = [];
  for (let at = start.getTime(); at <= end.getTime(); at += DAY_MS) days.push(dayKey(new Date(at)));
  return { start, end: new Date(end.getTime() + DAY_MS), days };
}
