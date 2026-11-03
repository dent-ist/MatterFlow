/**
 * TEMPORARY (epic #1074, CAL-06): the holiday administration API as sketched in docs/ux/calendar/plan.md section 4, written by hand while the backend (Agent G2)
 * builds it. When "client pushed" is in progress.md this file, `holiday-rules.ts` (the preview maths is the server's then) and `holiday-fixtures.ts` go and `holiday-api.ts`
 * calls the generated client. Field names follow the sketch; the parts it leaves open ("rangeEnd...") are my reading and are listed in progress.md.
 */

export type HolidayRuleKind = 'FIXED' | 'NTH_WEEKDAY' | 'EASTER_OFFSET' | 'ONCE' | 'RANGE';
/** What happens when a fixed date falls on a weekend: nothing, the US rule (Saturday to Friday, Sunday to Monday) or the UK rule (the next Monday). */
export type WeekendRule = 'NONE' | 'US' | 'UK';

export interface HolidayCalendar {
  calendarId: number;
  /** The category name people see ("US Holiday", "Firm closure"). */
  name: string;
  colourKey: string;
  regionNote: string | null;
  appliesToEveryone: boolean;
  isActive: boolean;
  holidayCount: number;
  peopleCount: number;
  rowVersion: string;
}

export interface CalendarInput {
  name: string;
  colourKey: string;
  regionNote: string | null;
  appliesToEveryone: boolean;
  rowVersion?: string;
}

export interface Holiday {
  holidayId: number;
  name: string;
  ruleKind: HolidayRuleKind;
  /** FIXED, RANGE (yearly): the first day. */
  month: number | null;
  day: number | null;
  /** NTH_WEEKDAY: 1 to 4, or -1 for the last; weekday 0 = Sunday. */
  nth: number | null;
  weekday: number | null;
  /** EASTER_OFFSET: days from Easter Sunday (Good Friday is -2). */
  easterOffset: number | null;
  /** ONCE: the day; RANGE (one-off): the first day. */
  onceDate: string | null;
  /** RANGE: the last day (month and day when yearly, a date when one-off). */
  endMonth: number | null;
  endDay: number | null;
  onceEnd: string | null;
  yearly: boolean;
  weekendRule: WeekendRule;
  regionNote: string | null;
  /** NTH_WEEKDAY only: extra days after the weekday (Thanksgiving's Friday is 1). */
  plusDays: number | null;
  rowVersion: string;
}

export type HolidayInput = Omit<Holiday, 'holidayId' | 'rowVersion'> & { rowVersion?: string };

export interface PreviewRow {
  date: string;
  endDate: string | null;
  name: string;
  /** The weekend date the holiday really falls on when it is observed on `date`. */
  observedFrom: string | null;
}

export interface ImportLine {
  line: number;
  ok: boolean;
  message: string;
  parsed?: { date: string; endDate: string | null; name: string };
}
export interface ImportResult {
  lines: ImportLine[];
  okCount: number;
  errorCount: number;
}

export interface HolidayDefaults {
  firmCalendarId: number | null;
  podDefaults: { podId: number; calendarId: number | null }[];
  rowVersion: string;
}

export interface CalendarThresholds {
  minCoveragePercent: number;
  podMinimumPercent: number;
  podMinimums: { podId: number; people: number }[];
  defaults: { minCoveragePercent: number; podMinimumPercent: number };
  isCustom: boolean;
  rowVersion: string;
}

export interface PodRef {
  podId: number;
  name: string;
}

/** The colours an administrator picks for a category: the note-tag palette, always shown with the flag icon and the name. */
export const CATEGORY_COLOURS = [
  'indigo',
  'rose',
  'green',
  'blue',
  'teal',
  'amber',
  'orange',
  'violet',
  'slate',
] as const;
export type CategoryColour = (typeof CATEGORY_COLOURS)[number];
