/**
 * The gauge settings of the Dashboard (epic #1063, DB-06; plan section 3): the working hours the age of the oldest unassigned task is counted in, and how the level is
 * worked out. The defaults live in code on the server (no seed row); the form shows them and "Reset to default" fills them in.
 */
export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

export type AgeBasis = 'WORKING' | 'CLOCK';

export interface GaugeSettings {
  /** `HH:mm`, the firm's local time. */
  workdayStart: string;
  workdayEnd: string;
  workDays: Weekday[];
  ageBasis: AgeBasis;
  /** Hours of the oldest unassigned task for levels 1 to 5 (strictly increasing). */
  levelHours: number[];
  /** One more level for every this many unassigned tasks. */
  tasksPerLevel: number;
  /** At most this many extra levels from the count. */
  countBonusMax: number;
}

export const DEFAULT_GAUGE_SETTINGS: GaugeSettings = {
  workdayStart: '08:00',
  workdayEnd: '18:00',
  workDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  ageBasis: 'WORKING',
  levelHours: [1, 2, 3, 4, 5],
  tasksPerLevel: 5,
  countBonusMax: 2,
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sameSettings(a: GaugeSettings, b: GaugeSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Field errors by name; empty when the form can be saved. The server checks again and its messages are shown the same way. */
export function validateGaugeSettings(s: GaugeSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!TIME.test(s.workdayStart)) errors['workdayStart'] = 'Enter the start as a time, like 08:00.';
  if (!TIME.test(s.workdayEnd)) errors['workdayEnd'] = 'Enter the end as a time, like 18:00.';
  if (!errors['workdayStart'] && !errors['workdayEnd'] && s.workdayEnd <= s.workdayStart) {
    errors['workdayEnd'] = 'The workday must end after it starts.';
  }
  if (s.workDays.length === 0) errors['workDays'] = 'Choose at least one working day.';
  const hours = s.levelHours;
  if (hours.length !== 5 || hours.some((h) => !Number.isFinite(h) || h <= 0)) {
    errors['levelHours'] = 'Enter five hours greater than zero.';
  } else if (hours.some((h, i) => i > 0 && h <= hours[i - 1])) {
    errors['levelHours'] = 'Each level needs more hours than the one before it.';
  }
  if (!Number.isInteger(s.tasksPerLevel) || s.tasksPerLevel < 1) {
    errors['tasksPerLevel'] = 'Enter a whole number of tasks, 1 or more.';
  }
  if (!Number.isInteger(s.countBonusMax) || s.countBonusMax < 0 || s.countBonusMax > 5) {
    errors['countBonusMax'] = 'Enter a whole number from 0 to 5.';
  }
  return errors;
}
