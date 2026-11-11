/** Calendar date (`yyyy-MM-dd`) of "now plus `offsetDays`" as seen in an IANA time zone. */
export function dateInZone(timeZone: string, offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/** The firm's working zone (the API falls back to it when a request names none). */
export const FIRM_ZONE = 'America/New_York';

/** Westernmost and easternmost zones in use: their calendar dates always differ by at least one day. */
export const ZONE_BEHIND = 'Etc/GMT+12';
export const ZONE_AHEAD = 'Pacific/Kiritimati';

/**
 * What the screens print for a moment (UI2, D-60): `MM/DD hh:mm AM/PM`, the year added only outside the current year (`MM/DD/YYYY hh:mm AM/PM`). The long
 * date with the zone ("October 28, 2026, 3:00 PM EDT") is the tooltip of the lists and the Task page; a comment or activity time keeps the UTC moment as its tooltip.
 */
export const NUMERIC_STAMP = /^\d{2}\/\d{2}(?:\/\d{4})? \d{2}:\d{2} [AP]M$/;

/** The long date with the zone of a tooltip or an accessible name ("October 28, 2026, 3:00 PM EDT"). */
export const LONG_STAMP = /^[A-Z][a-z]+ \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M \S+$/;
