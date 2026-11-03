import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CalendarSettingsAdminView,
  HolidayCalendarDto,
  HolidayCalendarsClient,
  HolidayDto,
  SettingsCalendarClient,
  SettingsHolidaysClient,
  UserAvailabilityClient,
  UserHolidayCalendarClient,
} from '../../../api/generated/api-client';
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
 * The one door of the screens to the holiday administration API (plan section 4; Settings.Manage, and User.Manage for the person's calendar). The screens work with the view
 * models of `holiday-contract.ts`; this file maps the generated DTOs to them. Failures are `ApiError`s (409 for a version conflict, 400 with a message for a bad value).
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
}

const calendar = (c: HolidayCalendarDto): HolidayCalendar => ({
  calendarId: c.calendarId,
  name: c.name,
  colourKey: c.colourKey,
  regionNote: c.regionNote ?? null,
  appliesToEveryone: c.appliesToEveryone,
  isActive: c.isActive,
  holidayCount: c.holidayCount,
  peopleCount: c.peopleCount,
  rowVersion: c.rowVersion,
});

const holiday = (h: HolidayDto): Holiday => ({
  holidayId: h.holidayId,
  name: h.name,
  ruleKind: h.ruleKind as Holiday['ruleKind'],
  month: h.month ?? null,
  day: h.day ?? null,
  nth: h.nth ?? null,
  weekday: h.weekday ?? null,
  easterOffset: h.easterOffset ?? null,
  onceDate: h.onceDate ?? null,
  endMonth: h.rangeEndMonth ?? null,
  endDay: h.rangeEndDay ?? null,
  onceEnd: h.rangeEndDate ?? null,
  yearly: h.yearly,
  weekendRule: h.weekendRule as Holiday['weekendRule'],
  regionNote: h.regionNote ?? null,
  plusDays: h.plusDays || null,
  rowVersion: h.rowVersion,
});

const holidayBody = (i: HolidayInput) => ({
  name: i.name,
  ruleKind: i.ruleKind,
  month: i.month ?? undefined,
  day: i.day ?? undefined,
  nth: i.nth ?? undefined,
  weekday: i.weekday ?? undefined,
  plusDays: i.plusDays ?? 0,
  easterOffset: i.easterOffset ?? undefined,
  onceDate: i.onceDate ?? undefined,
  rangeEndMonth: i.endMonth ?? undefined,
  rangeEndDay: i.endDay ?? undefined,
  rangeEndDate: i.onceEnd ?? undefined,
  yearly: i.yearly,
  weekendRule: i.weekendRule,
  regionNote: i.regionNote ?? undefined,
  rowVersion: i.rowVersion,
});

@Injectable({ providedIn: 'root' })
export class HttpHolidayApi implements HolidayApi {
  private readonly calendarsClient = inject(HolidayCalendarsClient);
  private readonly settings = inject(SettingsHolidaysClient);
  private readonly limits = inject(SettingsCalendarClient);
  private readonly users = inject(UserHolidayCalendarClient);
  private readonly availability = inject(UserAvailabilityClient);

  async calendars(): Promise<HolidayCalendar[]> {
    return (await firstValueFrom(this.calendarsClient.listHolidayCalendars())).map(calendar);
  }

  async saveCalendar(calendarId: number | null, input: CalendarInput): Promise<HolidayCalendar> {
    const body = {
      name: input.name,
      colourKey: input.colourKey,
      regionNote: input.regionNote ?? undefined,
      appliesToEveryone: input.appliesToEveryone,
      isActive: true,
      rowVersion: input.rowVersion,
    };
    return calendar(
      await firstValueFrom(
        calendarId === null
          ? this.calendarsClient.createHolidayCalendar(body)
          : this.calendarsClient.updateHolidayCalendar(calendarId, body),
      ),
    );
  }

  async deleteCalendar(calendarId: number, rowVersion: string): Promise<void> {
    await firstValueFrom(this.calendarsClient.deleteHolidayCalendar(calendarId, rowVersion));
  }

  async holidays(calendarId: number): Promise<Holiday[]> {
    return (await firstValueFrom(this.calendarsClient.listHolidays(calendarId))).map(holiday);
  }

  async saveHoliday(
    calendarId: number,
    holidayId: number | null,
    input: HolidayInput,
  ): Promise<Holiday> {
    return holiday(
      await firstValueFrom(
        holidayId === null
          ? this.calendarsClient.createHoliday(calendarId, holidayBody(input))
          : this.calendarsClient.updateHoliday(calendarId, holidayId, holidayBody(input)),
      ),
    );
  }

  async deleteHoliday(calendarId: number, holidayId: number, rowVersion: string): Promise<void> {
    await firstValueFrom(this.calendarsClient.deleteHoliday(calendarId, holidayId, rowVersion));
  }

  async preview(calendarId: number, year: number): Promise<PreviewRow[]> {
    const rows = await firstValueFrom(
      this.calendarsClient.previewHolidayCalendar(calendarId, year),
    );
    return rows.map((r) => ({
      date: r.date,
      endDate: r.endDate ?? null,
      name: r.name,
      observedFrom: r.observedFrom ?? null,
    }));
  }

  async importLines(
    calendarId: number,
    text: string,
    year: number,
    dryRun: boolean,
  ): Promise<ImportResult> {
    // A real import saves every good line in one transaction (the dry run already showed the bad ones).
    const r = await firstValueFrom(
      this.calendarsClient.importHolidays(
        calendarId,
        { text, year },
        dryRun,
        dryRun ? undefined : true,
      ),
    );
    return {
      okCount: r.okCount,
      errorCount: r.errorCount,
      lines: r.lines.map((l) => ({
        line: l.line,
        ok: l.ok,
        message: l.message ?? (l.ok ? 'Ready' : ''),
        parsed: l.parsed
          ? { date: l.parsed.date, endDate: l.parsed.endDate ?? null, name: l.parsed.name }
          : undefined,
      })),
    };
  }

  async defaults(): Promise<HolidayDefaults> {
    const s = await firstValueFrom(this.settings.getHolidaySettings());
    return {
      firmCalendarId: s.firmCalendarId ?? null,
      podDefaults: s.podDefaults.map((p) => ({ podId: p.podId, calendarId: p.calendarId ?? null })),
      rowVersion: s.rowVersion,
    };
  }

  /** The pods the defaults can be set for: the server lists them with the defaults. */
  async pods(): Promise<PodRef[]> {
    const s = await firstValueFrom(this.settings.getHolidaySettings());
    return s.podDefaults.map((p) => ({ podId: p.podId, name: p.podName ?? `Pod ${p.podId}` }));
  }

  async saveDefaults(value: HolidayDefaults): Promise<HolidayDefaults> {
    const s = await firstValueFrom(
      this.settings.setHolidaySettings({
        firmCalendarId: value.firmCalendarId ?? undefined,
        podDefaults: value.podDefaults.map((p) => ({
          podId: p.podId,
          podName: undefined,
          calendarId: p.calendarId ?? undefined,
        })),
        rowVersion: value.rowVersion,
      }),
    );
    return {
      firmCalendarId: s.firmCalendarId ?? null,
      podDefaults: s.podDefaults.map((p) => ({ podId: p.podId, calendarId: p.calendarId ?? null })),
      rowVersion: s.rowVersion,
    };
  }

  async userCalendar(userId: number): Promise<UserCalendar> {
    const a = await firstValueFrom(this.availability.getUserAvailability(userId));
    const c = a.holidayCalendar;
    return {
      explicitCalendarId: c?.source === 'PERSON' ? c.calendarId : null,
      effectiveCalendarId: c?.calendarId ?? null,
      effectiveSource: c ? (c.source === 'PERSON' ? 'USER' : (c.source as 'POD' | 'FIRM')) : null,
      podName: null,
    };
  }

  async setUserCalendar(userId: number, calendarId: number | null): Promise<UserCalendar> {
    await firstValueFrom(
      this.users.setUserHolidayCalendar(userId, { calendarId: calendarId ?? undefined }),
    );
    return this.userCalendar(userId);
  }

  private thresholdsOf(s: CalendarSettingsAdminView): CalendarThresholds {
    return {
      minCoveragePercent: s.minCoveragePercent,
      podMinimumPercent: s.podMinimumPercent,
      podMinimums: s.podMinimums.map((m) => ({ podId: m.podId, people: m.people })),
      defaults: {
        minCoveragePercent: s.defaults.minCoveragePercent,
        podMinimumPercent: s.defaults.podMinimumPercent,
      },
      isCustom: s.isCustom,
      rowVersion: s.rowVersion,
    };
  }

  async thresholds(): Promise<CalendarThresholds> {
    return this.thresholdsOf(await firstValueFrom(this.limits.getCalendarSettings()));
  }

  async saveThresholds(
    value: Pick<
      CalendarThresholds,
      'minCoveragePercent' | 'podMinimumPercent' | 'podMinimums' | 'rowVersion'
    >,
  ): Promise<CalendarThresholds> {
    return this.thresholdsOf(
      await firstValueFrom(
        this.limits.setCalendarSettings({
          minCoveragePercent: value.minCoveragePercent,
          podMinimumPercent: value.podMinimumPercent,
          podMinimums: value.podMinimums,
          rowVersion: value.rowVersion,
        }),
      ),
    );
  }
}

export const HOLIDAY_API = new InjectionToken<HolidayApi>('HolidayApi', {
  providedIn: 'root',
  factory: () => inject(HttpHolidayApi),
});
