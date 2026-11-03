/**
 * TEMPORARY (epic #1074, CAL-05): the Out of office API as sketched in docs/ux/calendar/plan.md section 4, written by hand while the backend
 * (Agent G2) builds the endpoints. When "client pushed" is in progress.md this file and the fixture implementation go, and `AbsenceApi` calls the
 * generated client instead (one change, in `absence-api.ts`). Never imported outside this folder except through `AbsenceApi`.
 */

export const ABSENCE_TYPES = ['VACATION', 'SICK', 'TRAINING', 'CONFERENCE', 'OTHER'] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

/** Where an entry is in time, as the server works it out for the person's zone. */
export type AbsenceState = 'NOW' | 'UPCOMING' | 'PAST';

export interface AbsenceEntry {
  absenceId: number;
  userId: number;
  type: AbsenceType;
  /** `yyyy-MM-dd`, a floating date. */
  startDate: string;
  /** Last day out, included; null while open-ended. */
  endDate: string | null;
  note: string | null;
  state: AbsenceState;
  /** Working days of the person inside the entry (null while open-ended). */
  workingDays: number | null;
  rowVersion: string;
}

export interface AbsenceInput {
  type: AbsenceType;
  startDate: string;
  endDate: string | null;
  note: string | null;
  /** On edit. */
  rowVersion?: string;
}

/** The advisory answer of `POST /absences/check`: pods that would fall below their minimum on some of the days. Never blocks. */
export interface AbsenceCheck {
  podsBelowMinimum: { podId: number; name: string; days: string[] }[];
}

/** The 409 body of a create or edit that overlaps another entry. */
export interface AbsenceOverlap {
  absenceId: number;
  type: AbsenceType;
  startDate: string;
  endDate: string | null;
}

/** What the Profile also shows beside the list. */
export interface HolidayInfo {
  holidayCalendar: { calendarId: number; name: string } | null;
  nextHolidays: { date: string; name: string }[];
}

export const ABSENCE_TYPE_LABELS: Readonly<Record<AbsenceType, string>> = {
  VACATION: 'Vacation',
  SICK: 'Sick',
  TRAINING: 'Training',
  CONFERENCE: 'Conference',
  OTHER: 'Other',
};

/** One icon and one semantic hue per type, so the type is a word, a glyph and a colour (never colour alone). */
export const ABSENCE_TYPE_ICONS: Readonly<Record<AbsenceType, string>> = {
  VACATION: 'pi-sun',
  SICK: 'pi-heart',
  TRAINING: 'pi-book',
  CONFERENCE: 'pi-users',
  OTHER: 'pi-ellipsis-h',
};
export const ABSENCE_TYPE_HUES: Readonly<Record<AbsenceType, string>> = {
  VACATION: 'info',
  SICK: 'critical',
  TRAINING: 'healthy',
  CONFERENCE: 'person',
  OTHER: 'neutral',
};

export function isAbsenceType(value: unknown): value is AbsenceType {
  return typeof value === 'string' && (ABSENCE_TYPES as readonly string[]).includes(value);
}
