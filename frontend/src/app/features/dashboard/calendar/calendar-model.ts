import { CalDay, CoverageLevel, PodCoverage } from './calendar-contract';

/*
 * The pure parts of the Dashboard Calendar (epic #1074, CAL-07): the dates of a month and a week grid (Sunday first), the words and icons of the coverage levels, the text of a
 * day cell and the address parameters. No component, no request: the page and its specs both use these.
 */

export type CalView = 'month' | 'week';
export const CAL_VIEWS: readonly CalView[] = ['month', 'week'];
export const DEFAULT_VIEW: CalView = 'month';

/** The address parameters the Calendar owns (the Pod scope is the page-wide `pod`). */
export const CAL_PARAMS = ['cal', 'month', 'week', 'day', 'role'] as const;

const DAY_MS = 86_400_000;
const parse = (date: string): Date => new Date(`${date}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (date: string, n: number): string =>
  iso(new Date(parse(date).getTime() + n * DAY_MS));
export const dayOfWeek = (date: string): number => parse(date).getUTCDay();
export const isWeekend = (date: string): boolean => [0, 6].includes(dayOfWeek(date));
export const monthOf = (date: string): string => date.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Whole weeks (Sunday first) that cover the month: 28 to 42 days. */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const start = first.getTime() - first.getUTCDay() * DAY_MS;
  const n = Math.ceil((first.getUTCDay() + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: n }, (_, i) => iso(new Date(start + i * DAY_MS)));
}

/** The Sunday that starts the week of `date`. */
export const weekStart = (date: string): string => addDays(date, -dayOfWeek(date));

export const weekGrid = (date: string): string[] => {
  const s = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
};

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
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

/** "Wednesday, November 25, 2026" (the spoken form; the numeric style is for the eye). */
export function longDay(date: string): string {
  return `${WEEKDAYS_LONG[dayOfWeek(date)]}, ${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}, ${date.slice(0, 4)}`;
}

export const monthTitle = (month: string): string =>
  `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/** "11/22 to 11/28" (the week of the grid), with the year when it is not the current one. */
export function weekTitle(dates: readonly string[], currentYear: number): string {
  const f = (d: string) => {
    const y = Number(d.slice(0, 4));
    return `${d.slice(5, 7)}/${d.slice(8)}${y === currentYear ? '' : `/${y}`}`;
  };
  return `${f(dates[0])} to ${f(dates[dates.length - 1])}`;
}

export interface LevelInfo {
  /** The word printed in the cell (colour is never the only signal). */
  word: string;
  /** A PrimeIcons class. */
  icon: string;
  /** The token family: `--mf-cov-<key>-{bg,fg,solid}`; null for the neutral levels. */
  key: 'good' | 'watch' | 'low' | 'crit' | null;
  /** Meaning for the legend and tooltips. */
  hint: string;
}

export const LEVELS: Readonly<Record<CoverageLevel, LevelInfo>> = {
  GOOD: { word: 'Good', icon: 'pi-check-circle', key: 'good', hint: 'enough people are in' },
  WATCH: {
    word: 'Watch',
    icon: 'pi-exclamation-triangle',
    key: 'watch',
    hint: 'a pod is below its minimum',
  },
  LOW: { word: 'Low', icon: 'pi-exclamation-circle', key: 'low', hint: 'under the firm minimum' },
  CRITICAL: {
    word: 'Critical',
    icon: 'pi-ban',
    key: 'crit',
    hint: 'far under the minimum, or a pod with nobody',
  },
  CLOSED: { word: 'Closed', icon: 'pi-flag', key: null, hint: 'nobody is expected (firm closure)' },
  NON_WORKING: { word: 'Non-working', icon: 'pi-moon', key: null, hint: 'weekend or nobody works' },
};

/** The levels the legend lists, in order. */
export const LEGEND_LEVELS: readonly CoverageLevel[] = [
  'GOOD',
  'WATCH',
  'LOW',
  'CRITICAL',
  'CLOSED',
  'NON_WORKING',
];

export const isRiskLevel = (level: CoverageLevel): boolean =>
  level === 'WATCH' || level === 'LOW' || level === 'CRITICAL';

/** "6 of 6 expected": available of expected, in words. */
export const expectedText = (d: Pick<CalDay, 'available' | 'expected'>): string =>
  `${d.available} of ${d.expected} expected`;

/** "6/6" for a narrow cell. */
export const expectedShort = (d: Pick<CalDay, 'available' | 'expected'>): string =>
  `${d.available}/${d.expected}`;

/** "2 out" (the count out of office). */
export const outText = (d: Pick<CalDay, 'outOfOffice'>): string => `${d.outOfOffice} out`;

/** The tooltip of a cell: the numbers behind the cell (the total in view, the holiday and non-working counts are not in the cell). */
export function cellTooltip(d: CalDay): string {
  if (d.level === 'NON_WORKING') return `${longDay(d.date)}: non-working day.`;
  const parts = [
    `${d.available} of ${d.expected} expected people available`,
    `${d.outOfOffice} out of office`,
  ];
  if (d.onHoliday > 0) parts.push(`${d.onHoliday} on holiday`);
  if (d.offHours > 0) parts.push(`${d.offHours} not working`);
  parts.push(`${d.total} in view`);
  return `${longDay(d.date)}: ${parts.join(', ')}.`;
}

/** The accessible name of a day button: the date, today, the level word, the numbers and the holidays. */
export function dayAriaLabel(d: CalDay, today: string): string {
  const parts = [longDay(d.date)];
  if (d.date === today) parts.push('today');
  parts.push(`coverage ${LEVELS[d.level].word}`);
  if (d.level !== 'NON_WORKING') {
    parts.push(expectedText(d));
    if (d.outOfOffice > 0) parts.push(`${d.outOfOffice} out of office`);
  }
  if (d.holidays.length > 0) parts.push(`holiday: ${d.holidays.map((h) => h.name).join(', ')}`);
  return parts.join(', ');
}

/** The pods of a week, in the order of their first appearance, with the day each cell belongs to. */
export function weekPods(days: readonly CalDay[]): { podId: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const day of days)
    for (const p of day.pods) if (!seen.has(p.podId)) seen.set(p.podId, p.name);
  return [...seen].map(([podId, name]) => ({ podId, name }));
}

export const podOn = (day: CalDay, podId: number): PodCoverage | null =>
  day.pods.find((p) => p.podId === podId) ?? null;

export interface CalAddress {
  view: CalView;
  /** `yyyy-mm`. */
  month: string | null;
  /** Any date of the week shown, `yyyy-mm-dd`. */
  week: string | null;
  /** The day whose panel is open. */
  day: string | null;
  role: number | null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** What the address names; every value is checked and a bad one is simply not there. */
export function parseCalAddress(get: (key: string) => string | null): CalAddress {
  const view = get('cal');
  const role = Number(get('role'));
  const date = (v: string | null) =>
    v !== null && DATE_RE.test(v) && !Number.isNaN(parse(v).getTime()) ? v : null;
  const month = get('month');
  return {
    view: view === 'week' ? 'week' : 'month',
    month: month !== null && MONTH_RE.test(month) ? month : null,
    week: date(get('week')),
    day: date(get('day')),
    role: Number.isInteger(role) && role > 0 ? role : null,
  };
}

/** The first and last date a read must cover for the view. */
export function viewRange(
  view: CalView,
  anchor: string,
): { from: string; to: string; dates: string[] } {
  const dates = view === 'month' ? monthGrid(monthOf(anchor)) : weekGrid(anchor);
  return { from: dates[0], to: dates[dates.length - 1], dates };
}
