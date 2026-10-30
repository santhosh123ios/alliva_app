import { dayKey, dayRange, hourOf, parseDay, startOfDay } from './store-day';

describe('store day', () => {
  it('starts the day at midnight in Bahrain', () => {
    // 22:30 UTC is already 01:30 the next morning in Bahrain.
    expect(startOfDay(new Date('2026-10-29T22:30:00Z')).toISOString()).toBe('2026-10-29T21:00:00.000Z');
    expect(dayKey(new Date('2026-10-29T22:30:00Z'))).toBe('2026-10-30');
    expect(hourOf(new Date('2026-10-29T22:30:00Z'))).toBe(1);
  });

  it('reads only real dates', () => {
    expect(parseDay('2026-10-30')?.toISOString()).toBe('2026-10-29T21:00:00.000Z');
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('30/10/2026')).toBeNull();
    expect(parseDay(undefined)).toBeNull();
  });

  it('defaults to the last seven days and includes both ends', () => {
    const range = dayRange({}, new Date('2026-10-30T09:00:00Z'));
    expect(range.days).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(range.end.toISOString()).toBe('2026-10-30T21:00:00.000Z');
  });

  it('puts swapped ends in order and caps long ranges', () => {
    expect(dayRange({ from: '2026-10-30', to: '2026-10-28' }).days).toEqual(['2026-10-28', '2026-10-29', '2026-10-30']);
    const long = dayRange({ from: '2020-01-01', to: '2026-10-30' });
    expect(long.days).toHaveLength(366);
    expect(long.days.at(-1)).toBe('2026-10-30');
  });
});
