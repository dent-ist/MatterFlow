import { Pipe, PipeTransform, inject } from '@angular/core';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { CalendarDay, calendarDayInZone, parseDateOnly, partsInZone } from '../../core/time/time';

/**
 * THE numeric date format of the new My Matters (UI update, issue #974): `MM/DD hh:mm AM/PM`, no month names. Change it here and every date of the page follows.
 *  - a date with no time of day: `MM/DD`
 *  - a date in a year other than the current one: `MM/DD/YYYY` (with the time when there is one)
 *  - 12-hour clock, a leading zero on the hour, a space before AM or PM (`04:00 PM`, `12:00 AM` at midnight, `12:00 PM` at noon)
 * The person's time zone decides the day, the clock and "the current year". Accessible text does not use it: `readableDate` and `readableDateTime` spell the month out.
 */
export const NUMERIC_DATE = {
  /** Shown where the format is explained (the theme guide). */
  pattern: 'MM/DD hh:mm AM/PM',
  /** `MM/DD` for the current year, `MM/DD/YYYY` otherwise. */
  year: 'other',
} as const;

const two = (n: number): string => String(n).padStart(2, '0');

/** `MM/DD`, or `MM/DD/YYYY` when the year is not `currentYear`. */
export function numericDay(d: CalendarDay, currentYear: number): string {
  return `${two(d.month)}/${two(d.day)}${d.year === currentYear ? '' : `/${d.year}`}`;
}

/** `hh:mm AM/PM` from a 24-hour clock. */
export function numericTime(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${two(h)}:${two(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** A calendar date (`yyyy-MM-dd`, no zone) as `MM/DD` or `MM/DD/YYYY`; the text itself when it is not a date. `now` and `zone` decide the current year. */
export function numericDate(value: string | null | undefined, now: Date, zone: string): string {
  const d = value ? parseDateOnly(value.slice(0, 10)) : null;
  return d ? numericDay(d, calendarDayInZone(now, zone).year) : (value ?? '');
}

/** A calendar date and an optional `HH:mm` (a floating time, no zone) as `MM/DD hh:mm AM/PM`; the time is left out when there is none. */
export function numericDateAndTime(
  date: string,
  time: string | null | undefined,
  now: Date,
  zone: string,
): string {
  const day = numericDate(date, now, zone);
  const m = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return m ? `${day} ${numericTime(Number(m[1]), Number(m[2]))}` : day;
}

/** An instant in the person's zone as `MM/DD hh:mm AM/PM` (`withTime` false: the day only). */
export function numericInstant(
  instant: Date | string | number,
  now: Date,
  zone: string,
  withTime = true,
): string {
  const p = partsInZone(instant, zone);
  const day = numericDay(
    { year: p.year, month: p.month, day: p.day },
    calendarDayInZone(now, zone).year,
  );
  return withTime ? `${day} ${numericTime(p.hour, p.minute)}` : day;
}

const LONG = (zone: string, withTime: boolean) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });

/** For screen readers and tooltips: "October 26, 2026" or "October 26, 2026, 4:00 PM" (a calendar date is spelled in UTC so no zone moves it). */
export function readableDate(date: string, time?: string | null): string {
  const d = parseDateOnly(date.slice(0, 10));
  if (!d) return date;
  const base = LONG('UTC', false).format(new Date(Date.UTC(d.year, d.month - 1, d.day)));
  const m = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  return m ? `${base}, ${numericTime(Number(m[1]), Number(m[2])).replace(/^0/, '')}` : base;
}

/** An instant, spelled out in the person's zone. */
export function readableInstant(instant: Date | string | number, zone: string): string {
  return LONG(zone, true).format(new Date(instant)).replace(' at ', ', ');
}

/** `{{ value | mfNum }}` in a template: a date-only text gives `MM/DD`, an instant gives `MM/DD hh:mm AM/PM` (`'date'`: the day only; `'time'`: `hh:mm AM/PM` from an `HH:mm` text). Empty for no value. */
@Pipe({ name: 'mfNum' })
export class NumericDatePipe implements PipeTransform {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  transform(
    value: string | Date | number | null | undefined,
    kind: 'auto' | 'date' | 'time' = 'auto',
  ): string {
    if (value === null || value === undefined || value === '') return '';
    if (kind === 'time') {
      const m = /^(\d{2}):(\d{2})/.exec(String(value));
      return m ? numericTime(Number(m[1]), Number(m[2])) : String(value);
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return numericDate(value, this.clock.now(), this.zone);
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return numericInstant(d, this.clock.now(), this.zone, kind !== 'date');
  }
}
