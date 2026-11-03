import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { ApiError } from '../../../core/http/api-error';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import type { AbsenceApi } from './absence-api';
import type {
  AbsenceCheck,
  AbsenceEntry,
  AbsenceInput,
  AbsenceState,
  HolidayInfo,
} from './absence-contract';
import { addDays } from './absence-rules';

/** An `ApiError` shaped like the server's, so the screens handle the fixture and the real API the same way. */
export function fixtureError(
  status: number,
  code: string,
  detail: string,
  extra: Record<string, unknown> = {},
): ApiError {
  const body = { status, code, detail, ...extra };
  return ApiError.from(new HttpErrorResponse({ status, error: body }));
}

/** Working days (Mon to Fri) from `start` to `end`, both included. */
export function workingDaysBetween(start: string, end: string): number {
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/**
 * TEMPORARY: an in-memory Out of office API that follows plan section 4 (overlap 409 naming the other entry, past-start refusal, "I'm back", the advisory check)
 * for the Profile, the header and the Calendar toolbar until the generated client is pushed. Each person starts with the same few entries around today.
 */
@Injectable({ providedIn: 'root' })
export class FixtureAbsenceApi implements AbsenceApi {
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly store = new Map<number, AbsenceEntry[]>();
  private nextId = 100;

  private today(): string {
    const d = calendarDayInZone(this.clock.now(), this.zone);
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  }

  private stateOf(e: { startDate: string; endDate: string | null }): AbsenceState {
    const t = this.today();
    if (e.endDate !== null && e.endDate < t) return 'PAST';
    return e.startDate > t ? 'UPCOMING' : 'NOW';
  }

  private entry(userId: number, input: AbsenceInput, id = this.nextId++): AbsenceEntry {
    return {
      absenceId: id,
      userId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note,
      state: this.stateOf(input),
      workingDays: input.endDate ? workingDaysBetween(input.startDate, input.endDate) : null,
      rowVersion: `v${id}-${Date.now()}`,
    };
  }

  private entries(userId: number): AbsenceEntry[] {
    let list = this.store.get(userId);
    if (!list) {
      const t = this.today();
      list = [
        this.entry(userId, {
          type: 'VACATION',
          startDate: addDays(t, 14),
          endDate: addDays(t, 18),
          note: 'Back on the 25th. Dana covers.',
        }),
        this.entry(userId, {
          type: 'TRAINING',
          startDate: addDays(t, 40),
          endDate: addDays(t, 41),
          note: null,
        }),
        this.entry(userId, {
          type: 'SICK',
          startDate: addDays(t, -60),
          endDate: addDays(t, -59),
          note: null,
        }),
        this.entry(userId, {
          type: 'CONFERENCE',
          startDate: addDays(t, -120),
          endDate: addDays(t, -118),
          note: 'ILTA',
        }),
      ];
      this.store.set(userId, list);
    }
    return list;
  }

  private refresh(e: AbsenceEntry): AbsenceEntry {
    return { ...e, state: this.stateOf(e) };
  }

  list(userId: number, includePast: boolean): Promise<AbsenceEntry[]> {
    return Promise.resolve(
      this.entries(userId)
        .map((e) => this.refresh(e))
        .filter((e) => includePast || e.state !== 'PAST'),
    );
  }

  private overlap(userId: number, input: AbsenceInput, ignore: number | null): AbsenceEntry | null {
    const end = input.endDate ?? '9999-12-31';
    return (
      this.entries(userId).find(
        (e) =>
          e.absenceId !== ignore &&
          e.startDate <= end &&
          (e.endDate ?? '9999-12-31') >= input.startDate,
      ) ?? null
    );
  }

  private validate(userId: number, input: AbsenceInput, ignore: number | null): void {
    if (input.endDate !== null && input.endDate < input.startDate) {
      throw fixtureError(
        400,
        'ABSENCE_RANGE_INVALID',
        'The last day cannot be before the first day.',
      );
    }
    const t = this.today();
    if (ignore === null && input.startDate < t) {
      const sickOk = input.type === 'SICK' && input.startDate >= addDays(t, -14);
      if (!sickOk) {
        throw fixtureError(400, 'ABSENCE_START_IN_PAST', 'The first day cannot be in the past.');
      }
    }
    const other = this.overlap(userId, input, ignore);
    if (other) {
      throw fixtureError(409, 'ABSENCE_OVERLAP', 'These dates overlap another entry.', {
        overlapsWith: {
          absenceId: other.absenceId,
          type: other.type,
          startDate: other.startDate,
          endDate: other.endDate,
        },
      });
    }
  }

  create(userId: number, input: AbsenceInput): Promise<AbsenceEntry> {
    try {
      this.validate(userId, input, null);
    } catch (e) {
      return Promise.reject(e);
    }
    const e = this.entry(userId, input);
    this.entries(userId).push(e);
    return Promise.resolve(e);
  }

  update(userId: number, absenceId: number, input: AbsenceInput): Promise<AbsenceEntry> {
    const list = this.entries(userId);
    const i = list.findIndex((e) => e.absenceId === absenceId);
    if (i < 0)
      return Promise.reject(fixtureError(404, 'NOT_FOUND', 'This entry no longer exists.'));
    if (input.rowVersion !== list[i].rowVersion) {
      return Promise.reject(
        fixtureError(409, 'CONCURRENCY_CONFLICT', 'This entry was changed somewhere else.'),
      );
    }
    try {
      this.validate(userId, input, absenceId);
    } catch (e) {
      return Promise.reject(e);
    }
    list[i] = this.entry(userId, input, absenceId);
    return Promise.resolve(list[i]);
  }

  remove(userId: number, absenceId: number): Promise<void> {
    const list = this.entries(userId);
    this.store.set(
      userId,
      list.filter((e) => e.absenceId !== absenceId),
    );
    return Promise.resolve();
  }

  back(userId: number, absenceId: number): Promise<void> {
    const list = this.entries(userId);
    const i = list.findIndex((e) => e.absenceId === absenceId);
    if (i < 0) return Promise.resolve();
    const yesterday = addDays(this.today(), -1);
    if (list[i].startDate > yesterday) return this.remove(userId, absenceId);
    list[i] = this.entry(userId, { ...list[i], endDate: yesterday }, absenceId);
    return Promise.resolve();
  }

  check(userId: number, startDate: string, endDate: string | null): Promise<AbsenceCheck> {
    // Fixture rule: an entry that touches the 25th of any month would leave Data Science below its minimum.
    const end = endDate ?? startDate;
    const days: string[] = [];
    for (let d = startDate; d <= end && days.length < 31; d = addDays(d, 1)) {
      if (d.endsWith('-25')) days.push(d);
    }
    return Promise.resolve({
      podsBelowMinimum: days.length ? [{ podId: 5, name: 'Data Science', days }] : [],
    });
  }

  holidayInfo(): Promise<HolidayInfo> {
    const y = Number(this.today().slice(0, 4));
    return Promise.resolve({
      holidayCalendar: { calendarId: 1, name: 'US Holiday' },
      nextHolidays: [
        { date: `${y}-11-26`, name: 'Thanksgiving' },
        { date: `${y}-11-27`, name: 'Day after Thanksgiving' },
        { date: `${y}-12-25`, name: 'Christmas Day' },
      ],
    });
  }
}
