const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type HoursWindow = {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  closed: boolean;
};

export function isOpenAt(hours: HoursWindow[], now: Date, timeZone = 'Asia/Bahrain'): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  const day = WEEKDAYS.indexOf(weekday.slice(0, 3));
  const current = `${hour}:${minute}`;
  const window = hours.find((item) => item.dayOfWeek === day);
  if (!window || window.closed) return false;
  if (window.opensAt <= window.closesAt) {
    return current >= window.opensAt && current < window.closesAt;
  }
  return current >= window.opensAt || current < window.closesAt;
}
