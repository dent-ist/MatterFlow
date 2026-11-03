import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AbsenceCheckClient,
  AbsenceDto,
  AbsencesClient,
  MyAvailabilityClient,
  UserAvailabilityClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import type {
  AbsenceCheck,
  AbsenceEntry,
  AbsenceInput,
  AbsenceState,
  AbsenceType,
  HolidayInfo,
} from './absence-contract';

/**
 * The one door of the screens to the Out of office API (plan section 4): entries (`/users/{id}/absences`), "I'm back", the advisory pod check and the person's holiday
 * information. The screens work with the view models of `absence-contract.ts` (null for "no value", string unions); this file maps the generated DTOs to them. Failures
 * are `ApiError`s; a 409 overlap carries the other entry in `problem.meta.overlapsWith`.
 */
export interface AbsenceApi {
  list(userId: number, includePast: boolean): Promise<AbsenceEntry[]>;
  create(userId: number, input: AbsenceInput): Promise<AbsenceEntry>;
  update(userId: number, absenceId: number, input: AbsenceInput): Promise<AbsenceEntry>;
  remove(userId: number, absenceId: number, rowVersion: string): Promise<void>;
  /** "I'm back": the entry ends yesterday (or is removed when it starts today or later). */
  back(userId: number, absenceId: number): Promise<void>;
  check(userId: number, startDate: string, endDate: string | null): Promise<AbsenceCheck>;
  holidayInfo(userId: number): Promise<HolidayInfo>;
}

export function toEntry(d: AbsenceDto): AbsenceEntry {
  return {
    absenceId: d.absenceId,
    userId: d.userId,
    type: d.type as AbsenceType,
    startDate: d.startDate,
    endDate: d.endDate ?? null,
    note: d.note ?? null,
    state: d.state as AbsenceState,
    workingDays: d.workingDays ?? null,
    rowVersion: d.rowVersion,
  };
}

const body = (input: AbsenceInput) => ({
  type: input.type,
  startDate: input.startDate,
  endDate: input.endDate ?? undefined,
  note: input.note ?? undefined,
  rowVersion: input.rowVersion,
});

@Injectable({ providedIn: 'root' })
export class HttpAbsenceApi implements AbsenceApi {
  private readonly absences = inject(AbsencesClient);
  private readonly checks = inject(AbsenceCheckClient);
  private readonly mine = inject(MyAvailabilityClient);
  private readonly others = inject(UserAvailabilityClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);

  async list(userId: number, includePast: boolean): Promise<AbsenceEntry[]> {
    // The list shows its own error state, so the request is quiet: no toast as well.
    const rows = await this.quiet.runInline(() =>
      firstValueFrom(this.absences.listAbsences(userId, includePast)),
    );
    return rows.map(toEntry);
  }

  async create(userId: number, input: AbsenceInput): Promise<AbsenceEntry> {
    // The dialog shows the server's message under the dates: no toast as well.
    return toEntry(
      await this.quiet.run(() => firstValueFrom(this.absences.createAbsence(userId, body(input)))),
    );
  }

  async update(userId: number, absenceId: number, input: AbsenceInput): Promise<AbsenceEntry> {
    return toEntry(
      await firstValueFrom(this.absences.updateAbsence(userId, absenceId, body(input))),
    );
  }

  async remove(userId: number, absenceId: number, rowVersion: string): Promise<void> {
    await this.quiet.run(() =>
      firstValueFrom(this.absences.deleteAbsence(userId, absenceId, rowVersion)),
    );
  }

  async back(userId: number, absenceId: number): Promise<void> {
    // The screen that pressed "I'm back" tells the person itself.
    await this.quiet.run(() => firstValueFrom(this.absences.endAbsenceToday(userId, absenceId)));
  }

  async check(userId: number, startDate: string, endDate: string | null): Promise<AbsenceCheck> {
    const r = await this.quiet.run(() =>
      firstValueFrom(
        this.checks.checkAbsenceCoverage(userId, { startDate, endDate: endDate ?? undefined }),
      ),
    );
    return {
      podsBelowMinimum: r.podsBelowMinimum.map((p) => ({
        podId: p.podId,
        name: p.name,
        days: p.days,
      })),
    };
  }

  async holidayInfo(userId: number): Promise<HolidayInfo> {
    const self = userId === this.auth.profile()?.userId;
    const a = await this.quiet.run(() =>
      firstValueFrom(
        self ? this.mine.getMyAvailability() : this.others.getUserAvailability(userId),
      ),
    );
    return {
      holidayCalendar: a.holidayCalendar
        ? { calendarId: a.holidayCalendar.calendarId, name: a.holidayCalendar.name }
        : null,
      nextHolidays: a.nextHolidays.map((h) => ({ date: h.date, name: h.name })),
    };
  }
}

export const ABSENCE_API = new InjectionToken<AbsenceApi>('AbsenceApi', {
  providedIn: 'root',
  factory: () => inject(HttpAbsenceApi),
});
