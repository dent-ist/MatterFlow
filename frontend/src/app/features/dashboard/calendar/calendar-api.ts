import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CalendarDay,
  CalendarDayCell,
  CalendarPod,
  DashboardCalendarClient,
} from '../../../api/generated/api-client';
import type {
  CalAbsenceType,
  CalDay,
  CalDays,
  CalQuery,
  CalSummary,
  CoverageLevel,
  DayPanel,
  PodCoverage,
  UnavailableReason,
} from './calendar-contract';

/**
 * The one door of the Calendar to its endpoints (`GET /dashboard/calendar/days`, `/day` and `/summary`, plan section 4). The screens work with the view models of
 * `calendar-contract.ts`; this file maps the generated DTOs to them. Failures are `ApiError`s (403 without Dashboard.ViewCalendar or for a pod outside the person's pods).
 */
export interface CalendarApi {
  days(from: string, to: string, q: CalQuery): Promise<CalDays>;
  day(date: string, q: CalQuery): Promise<DayPanel>;
  summary(q: CalQuery): Promise<CalSummary>;
}

const level = (v: string): CoverageLevel => v as CoverageLevel;

function pod(p: CalendarPod): PodCoverage {
  return {
    podId: p.podId,
    name: p.name,
    expected: p.expected,
    available: p.available,
    minimum: p.minimum,
    level: level(p.level),
  };
}

function cell(c: CalendarDayCell): CalDay {
  return {
    date: c.date,
    total: c.total,
    expected: c.expected,
    available: c.available,
    outOfOffice: c.outOfOffice,
    onHoliday: c.onHoliday,
    offHours: c.offHours,
    coveragePercent: c.coveragePercent ?? null,
    level: level(c.level),
    holidays: c.holidays.map((h) => ({
      name: h.name,
      calendarId: h.calendarId,
      category: h.category,
      colourKey: h.colourKey,
      appliesToEveryone: h.appliesToEveryone,
    })),
    pods: c.pods.map(pod),
  };
}

export function toPanel(d: CalendarDay): DayPanel {
  return {
    date: d.date,
    level: level(d.level),
    holidays: d.holidays.map((h) => ({
      name: h.name,
      category: h.category,
      colourKey: h.colourKey,
    })),
    counts: { ...d.counts },
    pods: d.pods.map(pod),
    available: d.available.map((g) => ({
      roleId: g.roleId,
      roleName: g.roleName,
      people: g.people.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        podNames: p.podNames,
        load: p.load,
      })),
    })),
    unavailable: d.unavailable.map((g) => ({
      roleId: g.roleId,
      roleName: g.roleName,
      people: g.people.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        podNames: p.podNames,
        load: p.load,
        reason: p.reason as UnavailableReason,
        backOn: p.backOn ?? null,
        // Absent unless the viewer holds Dashboard.ViewAbsenceReasons: only copied when the server sent it.
        ...(p.absenceType ? { absenceType: p.absenceType as CalAbsenceType } : {}),
      })),
    })),
  };
}

@Injectable({ providedIn: 'root' })
export class HttpCalendarApi implements CalendarApi {
  private readonly client = inject(DashboardCalendarClient);

  async days(from: string, to: string, q: CalQuery): Promise<CalDays> {
    const r = await firstValueFrom(
      this.client.getDashboardCalendarDays(from, to, q.podScope, q.role ?? undefined),
    );
    return {
      asOfUtc: r.asOfUtc,
      today: r.today,
      firstDayOfWeek: r.firstDayOfWeek,
      roles: r.roles.map((x) => ({ roleId: x.roleId, name: x.name })),
      days: r.days.map(cell),
    };
  }

  async day(date: string, q: CalQuery): Promise<DayPanel> {
    return toPanel(
      await firstValueFrom(
        this.client.getDashboardCalendarDay(date, q.podScope, q.role ?? undefined),
      ),
    );
  }

  async summary(q: CalQuery): Promise<CalSummary> {
    const r = await firstValueFrom(
      this.client.getDashboardCalendarSummary(q.podScope, q.role ?? undefined),
    );
    return {
      thresholds: { ...r.thresholds },
      risk: {
        daysAtRisk: r.risk.daysAtRisk,
        firstRiskDate: r.risk.firstRiskDate ?? null,
        firstRiskLevel: r.risk.firstRiskLevel ? level(r.risk.firstRiskLevel) : null,
        worstPod: r.risk.worstPod
          ? { podId: r.risk.worstPod.podId, name: r.risk.worstPod.name }
          : null,
        windowDays: r.risk.windowDays,
      },
      forecast: r.forecast.map((f) => ({
        weekStart: f.weekStart,
        availablePeople: f.availablePeople,
        freePercent: f.freePercent ?? null,
      })),
    };
  }
}

export const CALENDAR_API = new InjectionToken<CalendarApi>('CalendarApi', {
  providedIn: 'root',
  factory: () => inject(HttpCalendarApi),
});
