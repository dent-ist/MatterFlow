/**
 * Display formats of the shared date control and of read-only form values (D-60, UI update 2 #1221). They produce what the app's `mfNum` pipe produces:
 * `MM/DD` for a date in the current year and `MM/DD/YYYY` in another, `MM/DD hh:mm AM/PM` for an instant in the viewer's zone (no zone name, no month
 * name). The editable control always keeps the year (`MM/DD/YYYY`) so the text it shows is read back unchanged. The library keeps its own copy of
 * these few lines so it does not depend on the application.
 */

const NBSP = new RegExp('[\\u202f\\u00a0]', 'g');

const two = (n: number): string => String(n).padStart(2, '0');

/** `hh:mm AM/PM` from a 24-hour clock (`12:00 AM` at midnight). */
function clock(hours: number, minutes: number): string {
  return `${two(hours % 12 === 0 ? 12 : hours % 12)}:${two(minutes)} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** `10/12/2026` for the calendar day of a local `Date` (the editable control keeps the year so it reads back unchanged). */
export function formatDisplayDate(date: Date): string {
  return `${two(date.getMonth() + 1)}/${two(date.getDate())}/${date.getFullYear()}`;
}

/** `10:23 PM` for the wall-clock time of a local `Date`. */
export function formatDisplayTime(date: Date): string {
  return clock(date.getHours(), date.getMinutes());
}

/** `10/12/2026 10:23 PM` (local wall clock): what the date-time control shows after the user leaves the field. */
export function formatDisplayDateTime(date: Date): string {
  return `${formatDisplayDate(date)} ${formatDisplayTime(date)}`;
}

/** `10/12` (`10/12/2025` outside the current year) for a stored `yyyy-MM-dd` value (no zone conversion); an unreadable value is returned unchanged. */
export function formatStoredDate(value: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const date = new Date(+m[1], +m[2] - 1, +m[3]);
  if (date.getMonth() !== +m[2] - 1) return value;
  return `${m[2]}/${m[3]}${+m[1] === now.getFullYear() ? '' : `/${m[1]}`}`;
}

/** `10/12 10:23 PM`: a stored instant shown in the viewer's zone (or `zone`, for tests); the year shows only outside the current year. */
export function formatStoredInstant(instant: Date, zone?: string, now: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = zone ? { timeZone: zone } : {};
  const parts = (at: Date) => {
    const out: Record<string, number> = {};
    for (const p of new Intl.DateTimeFormat('en-US', {
      ...options,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(at)) {
      if (p.type !== 'literal') out[p.type] = Number(p.value.replace(NBSP, ' '));
    }
    return out;
  };
  const p = parts(instant);
  const year = parts(now)['year'];
  const day = `${two(p['month'])}/${two(p['day'])}${p['year'] === year ? '' : `/${p['year']}`}`;
  return `${day} ${clock(p['hour'] % 24, p['minute'])}`;
}
