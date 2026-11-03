import { Holiday, PreviewRow, WeekendRule } from './holiday-contract';

/*
 * Holiday rule maths in the browser (epic #1074, CAL-06): used by the fixture implementation of the preview until the server answers it, and by the specs that check the rules
 * against the approved mockup (Easter, nth weekday, observed days, ranges). Floating `yyyy-MM-dd` days.
 */

const DAY = 86_400_000;
const p2 = (n: number): string => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number): string => `${y}-${p2(m)}-${p2(d)}`;
const parse = (s: string): Date => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number): string =>
  new Date(parse(s).getTime() + n * DAY).toISOString().slice(0, 10);
export const dow = (s: string): number => parse(s).getUTCDay();
const diff = (a: string, b: string): number =>
  Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);

/** Easter Sunday of a year (the anonymous Gregorian algorithm). */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

/** The nth weekday of a month (`n` 1 to 4), or the last one (`n` -1). `weekday` 0 = Sunday. */
export function nthWeekday(y: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = ymd(y, month, 1);
    return addDays(first, ((weekday - dow(first) + 7) % 7) + 7 * (n - 1));
  }
  const end = addDays(new Date(Date.UTC(y, month, 1)).toISOString().slice(0, 10), -1); // the last day of the month
  return addDays(end, -((dow(end) - weekday + 7) % 7));
}

/** The weekend rule: the day a holiday that falls on a Saturday or Sunday is observed, or null when it is not moved. */
export function observed(
  date: string,
  rule: WeekendRule,
  taken: ReadonlySet<string>,
): string | null {
  const w = dow(date);
  if (rule === 'NONE' || (w !== 0 && w !== 6)) return null;
  if (rule === 'US') return addDays(date, w === 6 ? -1 : 1);
  let moved = addDays(date, w === 6 ? 2 : 1);
  while (taken.has(moved)) moved = addDays(moved, 1);
  return moved;
}

/** The days of one holiday in a year (a range gives its first and last day), before the weekend rule. */
function raw(h: Holiday, year: number): { date: string; endDate: string | null } | null {
  switch (h.ruleKind) {
    case 'FIXED':
      return h.month && h.day ? { date: ymd(year, h.month, h.day), endDate: null } : null;
    case 'NTH_WEEKDAY': {
      if (!h.month || h.weekday === null || !h.nth) return null;
      return {
        date: addDays(nthWeekday(year, h.month, h.weekday, h.nth), h.plusDays ?? 0),
        endDate: null,
      };
    }
    case 'EASTER_OFFSET':
      return { date: addDays(easter(year), h.easterOffset ?? 0), endDate: null };
    case 'ONCE':
      return h.onceDate && h.onceDate.startsWith(String(year))
        ? { date: h.onceDate, endDate: null }
        : null;
    case 'RANGE': {
      if (h.yearly) {
        if (!h.month || !h.day || !h.endMonth || !h.endDay) return null;
        return { date: ymd(year, h.month, h.day), endDate: ymd(year, h.endMonth, h.endDay) };
      }
      return h.onceDate && h.onceEnd && h.onceDate.startsWith(String(year))
        ? { date: h.onceDate, endDate: h.onceEnd }
        : null;
    }
  }
}

/** Every date of a calendar's holidays in a year, in date order, with the weekend rule applied. */
export function expandYear(holidays: readonly Holiday[], year: number): PreviewRow[] {
  const rows = holidays.flatMap((h) => {
    const r = raw(h, year);
    return r ? [{ h, ...r }] : [];
  });
  const taken = new Set(rows.map((r) => r.date));
  const out: PreviewRow[] = rows.map(({ h, date, endDate }) => {
    const moved = endDate === null ? observed(date, h.weekendRule, taken) : null;
    if (moved) taken.add(moved);
    return { date: moved ?? date, endDate, name: h.name, observedFrom: moved ? date : null };
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

export const daysIn = (r: Pick<PreviewRow, 'date' | 'endDate'>): number =>
  r.endDate ? diff(r.date, r.endDate) + 1 : 1;

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ORDINALS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', [-1]: 'last' };
const md = (m: number | null, d: number | null): string => (m && d ? `${p2(m)}/${p2(d)}` : '');

/** The "Repeats" column in words: "Every year, 4th Thursday of November", "One time, 02/12/2027". */
export function ruleText(h: Holiday): string {
  switch (h.ruleKind) {
    case 'FIXED':
      return `Every year, ${md(h.month, h.day)}`;
    case 'NTH_WEEKDAY': {
      const base = `${ORDINALS[h.nth ?? 1]} ${WEEKDAY_NAMES[h.weekday ?? 0]} of ${MONTH_NAMES[(h.month ?? 1) - 1]}`;
      const plus = h.plusDays ? `, plus ${h.plusDays} ${h.plusDays === 1 ? 'day' : 'days'}` : '';
      return `Every year, ${base}${plus}`;
    }
    case 'EASTER_OFFSET': {
      const n = h.easterOffset ?? 0;
      return n === 0
        ? 'Every year, Easter Sunday'
        : `Every year, ${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} ${n < 0 ? 'before' : 'after'} Easter`;
    }
    case 'ONCE':
      return 'One time';
    case 'RANGE':
      return h.yearly
        ? `Every year, ${md(h.month, h.day)} to ${md(h.endMonth, h.endDay)}`
        : 'One time, a range of days';
  }
}
