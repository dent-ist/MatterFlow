import { Clock } from '../../core/time/clock';
import { calendarDayInZone } from '../../core/time/time';

// The month arithmetic of the Calendar (issue #944), apart from the Calendar's own lazy chunk so the page can read `?month=` without loading it.

/** `yyyy-mm` of a `yyyy-mm-dd`, and the month before or after a `yyyy-mm`. */
export const monthOf = (date: string): string => date.slice(0, 7);
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}
const MONTH_TITLE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "October 2026". */
export function monthTitle(month: string): string {
  return MONTH_TITLE.format(new Date(`${month}-01T00:00:00Z`));
}
/** A `month` from the address, or null when it is not a `yyyy-mm`. */
export function parseMonth(value: string | null): string | null {
  return value !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

/** `yyyy-mm-dd` of today in the viewer's zone. */
export function todayText(clock: Clock, zone: string): string {
  const d = calendarDayInZone(clock.now(), zone);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}
