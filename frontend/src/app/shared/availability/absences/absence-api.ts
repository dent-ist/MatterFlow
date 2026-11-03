import { InjectionToken, inject } from '@angular/core';
import type { AbsenceCheck, AbsenceEntry, AbsenceInput, HolidayInfo } from './absence-contract';
import { FixtureAbsenceApi } from './absence-fixtures';

/**
 * The one door to the Out of office API (plan section 4). Today it is the fixture implementation; when the generated client is pushed, the factory
 * below returns a class that calls it and `absence-fixtures.ts` and `absence-contract.ts` are deleted. Failures are `ApiError`s, as everywhere (a 409 carries
 * `overlapsWith` in its problem body).
 */
export interface AbsenceApi {
  list(userId: number, includePast: boolean): Promise<AbsenceEntry[]>;
  create(userId: number, input: AbsenceInput): Promise<AbsenceEntry>;
  update(userId: number, absenceId: number, input: AbsenceInput): Promise<AbsenceEntry>;
  remove(userId: number, absenceId: number, rowVersion: string): Promise<void>;
  /** "I'm back": the entry ends yesterday (or is removed when it starts today). */
  back(userId: number, absenceId: number): Promise<void>;
  check(userId: number, startDate: string, endDate: string | null): Promise<AbsenceCheck>;
  holidayInfo(userId: number): Promise<HolidayInfo>;
}

export const ABSENCE_API = new InjectionToken<AbsenceApi>('AbsenceApi', {
  providedIn: 'root',
  factory: () => inject(FixtureAbsenceApi),
});
