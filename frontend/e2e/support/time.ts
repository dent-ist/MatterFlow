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
