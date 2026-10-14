/**
 * Explicit parsing of typed dates and times for the form engine's date inputs (UAT2-02). Nothing here depends on the browser's
 * locale or on `Date.parse`: each accepted shape is listed, and anything else is rejected so the caller can show an error.
 *
 * Dates: `2026-10-14`, `2026-1-4`, `2026/10/14`, `10/14/2026`, `10/1/26`, `10-14-2026`, `Oct 14, 2026`, `October 14 2026`,
 * `14 Oct 2026`. Times (datetime fields): `14:30`, `2:30 PM`, `2:30:15pm`; the date and time are separated by a space, a comma or `T`.
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

export interface YearMonthDay {
  year: number;
  month: number;
  day: number;
}

export interface HourMinute {
  hours: number;
  minutes: number;
  seconds: number;
}

function monthFromName(name: string): number | null {
  const lower = name.toLowerCase();
  if (lower === 'sept') return 9;
  if (lower.length < 3) return null;
  const index = MONTHS.findIndex((m) => m === lower || (lower.length === 3 && m.startsWith(lower)));
  return index < 0 ? null : index + 1;
}

function validDay(year: number, month: number, day: number): YearMonthDay | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(year, month, 0).getDate();
  return day <= last ? { year, month, day } : null;
}

function fullYear(text: string): number | null {
  if (/^\d{4}$/.test(text)) return Number(text);
  if (/^\d{2}$/.test(text)) return 2000 + Number(text);
  return null;
}

/** A calendar date typed as text; null when it is not one of the accepted shapes or not a real date. */
export function parseDateText(input: string): YearMonthDay | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text))) {
    return validDay(+m[1], +m[2], +m[3]);
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(text))) {
    const year = fullYear(m[3]);
    return year === null ? null : validDay(year, +m[1], +m[2]);
  }
  // "Oct 14, 2026", "October 14 2026", "Oct. 14, 2026"
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(text))) {
    const month = monthFromName(m[1]);
    return month === null ? null : validDay(+m[3], month, +m[2]);
  }
  // "14 Oct 2026", "14 October, 2026"
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(text))) {
    const month = monthFromName(m[2]);
    return month === null ? null : validDay(+m[3], month, +m[1]);
  }
  return null;
}

/** A time of day typed as text (`14:30`, `2:30 PM`); null when invalid. */
export function parseTimeText(input: string): HourMinute | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(input.trim());
  if (!m) return null;
  let hours = +m[1];
  const minutes = +m[2];
  const seconds = m[3] ? +m[3] : 0;
  const meridiem = m[4]?.toLowerCase();
  if (minutes > 59 || seconds > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return { hours, minutes, seconds };
}

/** A local date, or date and time when `withTime`, typed as text. A missing time in a datetime field is rejected. */
export function parseDateTimeText(input: string, withTime: boolean): Date | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (!withTime) {
    const d = parseDateText(text);
    return d ? new Date(d.year, d.month - 1, d.day) : null;
  }
  // The time is the trailing token (with its AM/PM); everything before it is the date.
  const m = /^(.*?),?[ T](\d{1,2}:\d{2}(?::\d{2})?(?: ?[AaPp][Mm])?)$/.exec(text);
  if (!m) return null;
  const d = parseDateText(m[1]);
  const t = parseTimeText(m[2]);
  if (!d || !t) return null;
  return new Date(d.year, d.month - 1, d.day, t.hours, t.minutes, t.seconds);
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

/** `yyyy-mm-dd`, plus ` hh:mm` (24 hour, local time) when `withTime`. */
export function formatDateTimeText(date: Date, withTime: boolean): string {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}
