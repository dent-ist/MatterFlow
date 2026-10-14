/**
 * Display formats of the shared date control and of read-only form values (UXR-08, addendum M). They produce exactly what the app's
 * `mfDate` produces: `Oct 12, 2026` for a date and `Oct 12, 2026, 10:23 PM EDT` for an instant in the viewer's zone. The library keeps
 * its own copy of these few lines so it does not depend on the application.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NBSP = new RegExp('[\\u202f\\u00a0]', 'g');

/** `Oct 12, 2026` for the calendar day of a local `Date`. */
export function formatDisplayDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** `10:23 PM` for the wall-clock time of a local `Date`. */
export function formatDisplayTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** `Oct 12, 2026, 10:23 PM` (local wall clock): what the date-time control shows after the user leaves the field. */
export function formatDisplayDateTime(date: Date): string {
  return `${formatDisplayDate(date)}, ${formatDisplayTime(date)}`;
}

/** `Oct 12, 2026` for a stored `yyyy-MM-dd` value (no zone conversion); an unreadable value is returned unchanged. */
export function formatStoredDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const date = new Date(+m[1], +m[2] - 1, +m[3]);
  return date.getMonth() === +m[2] - 1 ? formatDisplayDate(date) : value;
}

/** `Oct 12, 2026, 10:23 PM EDT`: a stored instant shown in the viewer's zone (or `zone`, for tests) with its abbreviation. */
export function formatStoredInstant(instant: Date, zone?: string): string {
  const options: Intl.DateTimeFormatOptions = zone ? { timeZone: zone } : {};
  const part = (o: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat('en-US', { ...options, ...o }).format(instant).replace(NBSP, ' ');
  const day = part({ year: 'numeric', month: 'short', day: 'numeric' });
  const time = part({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${day}, ${time}`;
}
