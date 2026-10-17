import { CalendarDay, calendarDayInZone } from '../../core/time/time';
import { RangeValue } from './filter-def';

/**
 * Date range presets of the date filter. Every preset is worked out from today's date in the VIEWER's time zone and a week starts on
 * Monday (as on the Dashboard); the filter writes the resulting absolute dates (`yyyy-MM-dd`) to the URL, never the preset name.
 */
export interface DatePreset {
  readonly key: string;
  readonly label: string;
}

export const DATE_PRESETS: readonly DatePreset[] = [
  { key: 'today', label: 'Today' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'next7', label: 'Next 7 days' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'nextWeek', label: 'Next week' },
];

/** The Due column looks ahead (G2): in this order. There is no Overdue preset (see `queueFilterDefs`). */
export const DUE_PRESETS: readonly string[] = [
  'today',
  'tomorrow',
  'next7',
  'thisWeek',
  'nextWeek',
  'thisMonth',
];

export const DEFAULT_DATE_PRESETS: readonly string[] = [
  'today',
  'thisWeek',
  'last7',
  'last30',
  'thisMonth',
];

const pad = (n: number): string => String(n).padStart(2, '0');

export function toIso(d: CalendarDay): string {
  return `${String(d.year).padStart(4, '0')}-${pad(d.month)}-${pad(d.day)}`;
}

/** Calendar arithmetic without time zones or DST: `days` after (or before, when negative) a calendar day. */
export function addDays(d: CalendarDay, days: number): CalendarDay {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayMonday(d: CalendarDay): number {
  return (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
}

export function todayInZone(now: Date, zone: string): CalendarDay {
  return calendarDayInZone(now, zone);
}

/** The dates of a preset, or null for an unknown key. */
export function presetRange(key: string, today: CalendarDay): RangeValue | null {
  switch (key) {
    case 'today':
      return { from: toIso(today), to: toIso(today) };
    case 'thisWeek': {
      const monday = addDays(today, -weekdayMonday(today));
      return { from: toIso(monday), to: toIso(addDays(monday, 6)) };
    }
    case 'tomorrow': {
      const t = toIso(addDays(today, 1));
      return { from: t, to: t };
    }
    case 'nextWeek': {
      const monday = addDays(today, 7 - weekdayMonday(today));
      return { from: toIso(monday), to: toIso(addDays(monday, 6)) };
    }
    case 'last7':
      return { from: toIso(addDays(today, -6)), to: toIso(today) };
    case 'last30':
      return { from: toIso(addDays(today, -29)), to: toIso(today) };
    case 'next7':
      return { from: toIso(today), to: toIso(addDays(today, 6)) };
    case 'thisMonth': {
      const first = { year: today.year, month: today.month, day: 1 };
      const last = addDays({ year: today.year, month: today.month + 1, day: 1 }, -1);
      return { from: toIso(first), to: toIso({ ...last }) };
    }
    default:
      return null;
  }
}

/** The preset whose dates equal the range (to mark it as chosen), if any. */
export function matchingPreset(
  range: RangeValue,
  today: CalendarDay,
  keys: readonly string[] = DATE_PRESETS.map((p) => p.key),
): string | null {
  return (
    keys.find((k) => {
      const r = presetRange(k, today);
      return r !== null && r.from === range.from && r.to === range.to;
    }) ?? null
  );
}

/** True when `from` is after `to` (both set): the range is not valid and must not be applied. */
export function rangeReversed(r: RangeValue): boolean {
  return !!r.from && !!r.to && r.from > r.to;
}
