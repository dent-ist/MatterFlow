import {
  CalendarDay,
  calendarDayInZone,
  dayIndex,
  formatCalendarDay,
  parseDateOnly,
} from '../../core/time/time';

/**
 * The one period model of the Dashboard (UX review 2, P3): Summary, Trends and Coverage share one list, one label ("Period") and one address
 * (`?period=7d|90d|this-month|last-month|6m|12m|custom`, plus `from` and `to` for a custom range; the default, 30 days, is not written). The period
 * applies to the Created and Completed figures only.
 */
export type PeriodKey =
  '7d' | '30d' | '90d' | 'this-month' | 'last-month' | '6m' | '12m' | 'custom';

export interface Period {
  key: PeriodKey;
  /** `yyyy-MM-dd`, only for a custom range. */
  from: string | null;
  to: string | null;
}

export interface PeriodPreset {
  key: Exclude<PeriodKey, 'custom'>;
  label: string;
}

/** The items every tab offers (Custom is the last one, drawn by the control). */
export const CORE_PRESETS: readonly PeriodPreset[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
];

/** Coverage appends two long windows (training questions need them): 183 and 365 days. */
export const LONG_PRESETS: readonly PeriodPreset[] = [
  { key: '6m', label: 'Last 6 months' },
  { key: '12m', label: 'Last 12 months' },
];

export const ALL_PRESETS: readonly PeriodPreset[] = [...CORE_PRESETS, ...LONG_PRESETS];

export const DEFAULT_PERIOD_KEY: PeriodKey = '30d';
export const DEFAULT_PERIOD: Period = { key: DEFAULT_PERIOD_KEY, from: null, to: null };

/** The longest custom range, in days (both ends included), on every tab. */
export const MAX_CUSTOM_DAYS = 366;

/** The scope note of the Summary: where the period does not apply. */
export const PERIOD_SCOPE_NOTE =
  'Applies to Completed and Created. Open, Overdue, Due soon, Unassigned, On hold and ASAP are not affected.';

export function isPeriodKey(value: unknown): value is PeriodKey {
  return value === 'custom' || ALL_PRESETS.some((p) => p.key === value);
}

/** The list of the control: the core items, plus the long windows on Coverage. Custom is added by the control. */
export function presetsFor(longWindows: boolean): readonly PeriodPreset[] {
  return longWindows ? ALL_PRESETS : CORE_PRESETS;
}

/**
 * Reads a period key saved by an earlier version (`mf.dashboard.v2.<user>`): This week became 7 days, This month became `this-month`, Last 30 days
 * became 30 days and Last quarter became 90 days. A key of the current vocabulary is kept; a custom range is never remembered; anything else is null.
 */
export function migrateStoredPeriod(value: unknown): PeriodKey | null {
  switch (value) {
    case 'week':
      return '7d';
    case 'month':
      return 'this-month';
    case 'quarter':
      return '90d';
    case 'custom':
      return null;
    default:
      return isPeriodKey(value) ? value : null;
  }
}

/** True for the two long windows, which only Coverage offers. */
export function isLongWindow(key: PeriodKey): boolean {
  return key === '6m' || key === '12m';
}

/**
 * The period a tab shows: Summary and Trends have no 6/12 month item, so a shared long window reads as the default there (the shared value
 * itself is kept for Coverage).
 */
export function periodForTab(period: Period, longWindows: boolean): Period {
  return !longWindows && isLongWindow(period.key) ? DEFAULT_PERIOD : period;
}

export function samePeriod(a: Period, b: Period): boolean {
  return a.key === b.key && (a.key !== 'custom' || (a.from === b.from && a.to === b.to));
}

/** A stable text for a period, to tell "the same request" from another one. */
export function periodId(p: Period): string {
  return p.key === 'custom' ? `custom:${p.from}:${p.to}` : p.key;
}

// ---- the range

export interface PeriodRange {
  /** `yyyy-MM-dd`, the viewer's zone, included. */
  from: string;
  to: string;
  days: number;
}

const iso = (d: CalendarDay): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

function addDays(d: CalendarDay, days: number): CalendarDay {
  const date = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const rangeOf = (from: CalendarDay, to: CalendarDay): PeriodRange => ({
  from: iso(from),
  to: iso(to),
  days: dayIndex(to) - dayIndex(from) + 1,
});

/**
 * The first and last day of a period in the viewer's zone: This month = the 1st to today, Last month = the whole previous calendar month,
 * custom ends are inclusive. The server resolves the same keys from the same zone; this is for captions and the custom fields before the answer arrives.
 */
export function resolveRange(period: Period, now: Date, zone: string): PeriodRange {
  const today = calendarDayInZone(now, zone);
  switch (period.key) {
    case '7d':
      return rangeOf(addDays(today, -6), today);
    case '90d':
      return rangeOf(addDays(today, -89), today);
    case '6m':
      return rangeOf(addDays(today, -182), today);
    case '12m':
      return rangeOf(addDays(today, -364), today);
    case 'this-month':
      return rangeOf({ ...today, day: 1 }, today);
    case 'last-month': {
      const lastDay = addDays({ ...today, day: 1 }, -1);
      return rangeOf({ ...lastDay, day: 1 }, lastDay);
    }
    case 'custom': {
      const from = period.from ? parseDateOnly(period.from) : null;
      const to = period.to ? parseDateOnly(period.to) : null;
      return from && to ? rangeOf(from, to) : rangeOf(addDays(today, -29), today);
    }
    default:
      return rangeOf(addDays(today, -29), today);
  }
}

/**
 * "Sep 17 to Oct 16": the resolved range as it reads under a number. The year is left out when both ends are in `currentYear` and written
 * ("Dec 20, 2025 to Jan 3, 2026") otherwise; one day reads as that day.
 */
export function rangeText(range: PeriodRange, currentYear: number): string {
  const from = parseDateOnly(range.from);
  const to = parseDateOnly(range.to);
  if (!from || !to) return '';
  const bare = from.year === currentYear && to.year === currentYear;
  const text = (d: CalendarDay) => {
    const full = formatCalendarDay(d);
    return bare ? full.replace(/,?\s\d{4}$/, '') : full;
  };
  return range.from === range.to ? text(from) : `${text(from)} to ${text(to)}`;
}

/** The range as it reads inside a sentence about the figures: "from Sep 17 to Oct 16". */
export function periodPhrase(range: PeriodRange | null | undefined, currentYear: number): string {
  return range ? `from ${rangeText(range, currentYear)}` : 'in the chosen period';
}

// ---- custom ranges

/** Why a custom range cannot be used, or null. The previous valid period stays in effect while this is shown. */
export function customProblem(from: string | null, to: string | null): string | null {
  if (!from || !to) return 'Choose both dates of the custom range.';
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  if (!a || !b) return 'Enter the dates as yyyy-mm-dd.';
  if (dayIndex(a) > dayIndex(b)) return 'The start of the period is after its end.';
  if (dayIndex(b) - dayIndex(a) + 1 > MAX_CUSTOM_DAYS) {
    return `The period can be at most ${MAX_CUSTOM_DAYS} days.`;
  }
  return null;
}

// ---- the address

/**
 * The period named by the address, or null when it names none (or a bad one: an unknown key, a custom range that is reversed, over 366 days or
 * incomplete). The address wins over memory; a bad one falls back to memory like a missing one.
 */
export function periodFromParams(get: (key: string) => string | null): Period | null {
  const key = get('period');
  if (!isPeriodKey(key)) return null;
  if (key !== 'custom') return { key, from: null, to: null };
  const from = get('from');
  const to = get('to');
  return customProblem(from, to) === null ? { key, from, to } : null;
}

/** The address parameters of a period: the default is not written (P9), the dates only with a custom range. */
export function periodToParams(period: Period): Record<'period' | 'from' | 'to', string | null> {
  const custom = period.key === 'custom';
  return {
    period: period.key === DEFAULT_PERIOD_KEY ? null : period.key,
    from: custom ? period.from : null,
    to: custom ? period.to : null,
  };
}

/** The API arguments of a period (`period`, and `from` / `to` for a custom range). The server resolves keys in the viewer's zone. */
export function periodArgs(period: Period): { period: string; from?: string; to?: string } {
  return period.key === 'custom' && period.from && period.to
    ? { period: 'custom', from: period.from, to: period.to }
    : { period: period.key === 'custom' ? DEFAULT_PERIOD_KEY : period.key };
}
