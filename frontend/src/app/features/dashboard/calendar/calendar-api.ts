import { InjectionToken, inject } from '@angular/core';
import type { CalDays, CalQuery, CalSummary, DayPanel } from './calendar-contract';
import { FixtureCalendarApi } from './calendar-fixtures';

/**
 * The one door to the Calendar endpoints (plan section 4). Today the fixture implementation answers; with the generated client pushed, the factory returns a class
 * that calls `GET /dashboard/calendar/days`, `/day` and `/summary` and the fixtures and hand-written types are deleted. Failures are `ApiError`s (403 without
 * Dashboard.ViewCalendar or for a pod outside the Pod Lead's pods).
 */
export interface CalendarApi {
  days(from: string, to: string, q: CalQuery): Promise<CalDays>;
  day(date: string, q: CalQuery): Promise<DayPanel>;
  summary(q: CalQuery): Promise<CalSummary>;
}

export const CALENDAR_API = new InjectionToken<CalendarApi>('CalendarApi', {
  providedIn: 'root',
  factory: () => inject(FixtureCalendarApi),
});
