import { InjectionToken, inject } from '@angular/core';
import type {
  CalendarInput,
  CalendarThresholds,
  Holiday,
  HolidayCalendar,
  HolidayDefaults,
  HolidayInput,
  ImportResult,
  PodRef,
  PreviewRow,
} from './holiday-contract';
import { FixtureHolidayApi } from './holiday-fixtures';

/** Where a person's holiday calendar comes from: their own choice, their pod's default or the firm default. */
export interface UserCalendar {
  /** The calendar chosen on the person (null = use the default). */
  explicitCalendarId: number | null;
  effectiveCalendarId: number | null;
  effectiveSource: 'USER' | 'POD' | 'FIRM' | null;
  /** The pod whose default applies, when the source is the pod. */
  podName: string | null;
}

/**
 * The one door to the holiday administration API (plan section 4; Settings.Manage, and User.Manage for the person's calendar). Today the fixture implementation answers; with the
 * generated client pushed, the factory returns a class that calls it and the fixtures, the rule maths and the hand-written types are deleted. Failures are `ApiError`s (409 for a
 * version conflict, 400 with a message for a bad value).
 */
export interface HolidayApi {
  calendars(): Promise<HolidayCalendar[]>;
  saveCalendar(calendarId: number | null, input: CalendarInput): Promise<HolidayCalendar>;
  deleteCalendar(calendarId: number, rowVersion: string): Promise<void>;
  holidays(calendarId: number): Promise<Holiday[]>;
  saveHoliday(calendarId: number, holidayId: number | null, input: HolidayInput): Promise<Holiday>;
  deleteHoliday(calendarId: number, holidayId: number, rowVersion: string): Promise<void>;
  preview(calendarId: number, year: number): Promise<PreviewRow[]>;
  importLines(
    calendarId: number,
    text: string,
    year: number,
    yearly: boolean,
    dryRun: boolean,
  ): Promise<ImportResult>;
  pods(): Promise<PodRef[]>;
  defaults(): Promise<HolidayDefaults>;
  saveDefaults(value: HolidayDefaults): Promise<HolidayDefaults>;
  userCalendar(userId: number): Promise<UserCalendar>;
  setUserCalendar(userId: number, calendarId: number | null): Promise<UserCalendar>;
  thresholds(): Promise<CalendarThresholds>;
  saveThresholds(
    value: Pick<
      CalendarThresholds,
      'minCoveragePercent' | 'podMinimumPercent' | 'podMinimums' | 'rowVersion'
    >,
  ): Promise<CalendarThresholds>;
  resetThresholds(): Promise<CalendarThresholds>;
}

export const HOLIDAY_API = new InjectionToken<HolidayApi>('HolidayApi', {
  providedIn: 'root',
  factory: () => inject(FixtureHolidayApi),
});
