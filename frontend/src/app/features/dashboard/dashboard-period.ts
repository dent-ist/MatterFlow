import { calendarDayInZone } from '../../core/time/time';

/** The period presets of the Dashboard. They apply only to the Created and Completed figures and the daily trend. */
export type PeriodKey = 'week' | 'month' | '30d' | 'quarter';

export interface PeriodPreset {
  key: PeriodKey;
  label: string;
  /** Short wording for captions under a number, for example "This week". */
  caption: string;
}

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  { key: 'week', label: 'This week', caption: 'This week' },
  { key: 'month', label: 'This month', caption: 'This month' },
  { key: '30d', label: 'Last 30 days', caption: 'Last 30 days' },
  { key: 'quarter', label: 'Last quarter', caption: 'Last quarter (90 days)' },
];

export const DEFAULT_PERIOD: PeriodKey = '30d';

export function isPeriodKey(value: unknown): value is PeriodKey {
  return PERIOD_PRESETS.some((p) => p.key === value);
}

/**
 * Number of days (counting today) the API's `periodDays` must cover for a preset, in the viewer's zone: this week starts on Monday, this
 * month on the 1st, "last quarter" is the last 90 days.
 */
export function periodDays(key: PeriodKey, now: Date, zone: string): number {
  const today = calendarDayInZone(now, zone);
  switch (key) {
    case 'week': {
      const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay(); // 0 = Sunday
      return ((weekday + 6) % 7) + 1;
    }
    case 'month':
      return today.day;
    case '30d':
      return 30;
    case 'quarter':
      return 90;
  }
}

export function presetOf(key: PeriodKey): PeriodPreset {
  return PERIOD_PRESETS.find((p) => p.key === key) ?? PERIOD_PRESETS[2];
}
