import { Provider } from '@angular/core';
import { CALENDAR_API } from '../../features/dashboard/calendar/calendar-api';
import { FixtureCalendarApi } from '../../features/dashboard/calendar/calendar-fixtures';
import { HOLIDAY_API } from '../../features/admin/holidays/holiday-api';
import { FixtureHolidayApi } from '../../features/admin/holidays/holiday-fixtures';
import { ABSENCE_API } from '../availability/absences/absence-api';
import { FixtureAbsenceApi } from '../availability/absences/absence-fixtures';

/**
 * Test doubles for the Out of office, Calendar and holiday APIs (epic #1074): in-memory implementations that follow the real rules (overlap 409, past start, the coverage
 * levels, the by-role lists) so a spec can drive the screens without HTTP. They are used by specs and by nothing else; the app uses the generated client.
 */
export function provideCalendarFixtures(): Provider[] {
  return [
    { provide: ABSENCE_API, useExisting: FixtureAbsenceApi },
    { provide: CALENDAR_API, useExisting: FixtureCalendarApi },
    { provide: HOLIDAY_API, useExisting: FixtureHolidayApi },
  ];
}
