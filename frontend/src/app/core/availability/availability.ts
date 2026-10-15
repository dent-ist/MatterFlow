import { calendarDayInZone, CalendarDay } from '../time/time';

/** What the API reports for a person right now (`availability` on `/users`, `/users/lookup`; `current` on the profile). */
export type AvailabilityStateCode = 'AVAILABLE' | 'OUT_OF_OFFICE' | 'OFF_HOURS';

export interface AvailabilityLike {
  state: string;
  /** While out of office: when it ends (an instant, UTC); absent when open-ended. */
  outUntil?: string | Date | null;
  note?: string | null;
}

export type AvailabilityTone = 'success' | 'warning' | 'neutral';

export interface AvailabilityDisplay {
  state: AvailabilityStateCode;
  tone: AvailabilityTone;
  /** PrimeIcons class; the text always says the same thing (colour and icon are never the only cue). */
  icon: string;
  /** Chip text: `Available`, `Off hours`, `Out of office until Oct 20`. */
  label: string;
}

/** The note of an out-of-office status is plain text of at most this many characters. */
export const NOTE_MAX = 200;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Oct 16`, with the year when it is not the year of `today` (`Jan 2, 2027`). */
export function shortDay(day: CalendarDay, today?: CalendarDay | null): string {
  const text = `${MONTHS[day.month - 1]} ${day.day}`;
  return !today || today.year === day.year ? text : `${text}, ${day.year}`;
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * The last day a person is out of office, as a calendar day in the viewer's zone. The API reports the instant the absence ends (the
 * start of the day after the last out-of-office day), so the day is the one a moment before it.
 */
export function lastOutDay(outUntil: string | Date, zone: string): CalendarDay | null {
  const end = outUntil instanceof Date ? outUntil : new Date(outUntil);
  if (Number.isNaN(end.getTime())) return null;
  return calendarDayInZone(new Date(end.getTime() - 60_000), zone);
}

/** `Out of office until Oct 20` (or just `Out of office` when it has no end), or null when the person is not out of office. */
export function outOfOfficeText(
  a: AvailabilityLike | null | undefined,
  zone: string,
  now: Date = new Date(),
): string | null {
  if (a?.state !== 'OUT_OF_OFFICE') return null;
  const last = a.outUntil ? lastOutDay(a.outUntil, zone) : null;
  return last
    ? `Out of office until ${shortDay(last, calendarDayInZone(now, zone))}`
    : 'Out of office';
}

/** Icon, tone and text for the availability chip. Unknown or missing state reads as Available. */
export function availabilityDisplay(
  a: AvailabilityLike | null | undefined,
  zone: string,
  now: Date = new Date(),
): AvailabilityDisplay {
  if (a?.state === 'OUT_OF_OFFICE') {
    return {
      state: 'OUT_OF_OFFICE',
      tone: 'warning',
      icon: 'pi-calendar-minus',
      label: outOfOfficeText(a, zone, now) ?? 'Out of office',
    };
  }
  if (a?.state === 'OFF_HOURS') {
    return { state: 'OFF_HOURS', tone: 'neutral', icon: 'pi-moon', label: 'Off hours' };
  }
  return { state: 'AVAILABLE', tone: 'success', icon: 'pi-check-circle', label: 'Available' };
}
