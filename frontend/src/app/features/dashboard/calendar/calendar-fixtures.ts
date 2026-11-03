import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { calendarDayInZone } from '../../../core/time/time';
import type { CalendarApi } from './calendar-api';
import type {
  CalAbsenceType,
  CalDay,
  CalDays,
  CalHoliday,
  CalQuery,
  CalSummary,
  CoverageLevel,
  DayPanel,
  DayPerson,
  PodCoverage,
  RoleGroup,
  UnavailableReason,
} from './calendar-contract';
import { FIX_ENTRIES, FIX_HOLIDAYS, FIX_PEOPLE } from './calendar-fixture-data';

const PODS = [
  { id: 1, key: 'rev', name: 'Review', min: 6 },
  { id: 2, key: 'prc', name: 'Processing', min: 5 },
  { id: 3, key: 'prd', name: 'Production', min: 4 },
  { id: 4, key: 'qc', name: 'QC', min: 4 },
  { id: 5, key: 'ds', name: 'Data Science', min: 3 },
];
/** Roles in the order the server groups them: the Admin > Roles order (name A to Z). */
const ROLES = [
  { roleId: 1, name: 'Data Scientist' },
  { roleId: 2, name: 'Data Technician' },
  { roleId: 3, name: 'Pod Lead' },
];
const CALENDARS: Record<
  string,
  { id: number; category: string; colourKey: string; everyone: boolean }
> = {
  us: { id: 1, category: 'US Holiday', colourKey: 'indigo', everyone: false },
  uk: { id: 2, category: 'UK Holiday', colourKey: 'rose', everyone: false },
  firm: { id: 3, category: 'Firm closure', colourKey: 'green', everyone: true },
};
const TYPE_OF: Record<string, CalAbsenceType> = {
  V: 'VACATION',
  S: 'SICK',
  T: 'TRAINING',
  C: 'CONFERENCE',
  O: 'OTHER',
};
const MIN_PERCENT = 75;
const POD_PERCENT = 60;

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

type Code = 'AVAILABLE' | 'OUT' | 'HOLIDAY' | 'OFF' | 'WEEKEND';
interface Worker {
  id: number;
  name: string;
  podId: number;
  role: string;
  roleId: number;
  cal: string;
  pt: boolean;
  load: number;
}
const WORKERS: Worker[] = FIX_PEOPLE.map((p) => ({
  id: p.id,
  name: p.name,
  podId: PODS.find((x) => x.key === p.pod)!.id,
  role: p.role,
  roleId: ROLES.find((r) => r.name === p.role)!.roleId,
  cal: p.cal,
  pt: p.pt,
  load: p.load,
}));

function httpError(status: number, code: string, detail: string): ApiError {
  return ApiError.from(new HttpErrorResponse({ status, error: { status, code, detail } }));
}

/**
 * TEMPORARY: the Calendar endpoints computed in the browser from the mockup's roster (36 workers in five pods, 145 absences, US, UK and Firm closure calendars), by the rules of plan
 * section 3: holiday wins over out of office, expected = in view minus holiday and non-working, level from the thresholds 75 and 60, the by-role lists sorted by workload. Used until the
 * generated client is pushed.
 */
@Injectable({ providedIn: 'root' })
export class FixtureCalendarApi implements CalendarApi {
  private readonly auth = inject(AuthStore);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);

  private today(): string {
    const d = calendarDayInZone(this.clock.now(), this.zone);
    return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  }

  private isPodLead(): boolean {
    return (this.auth.profile()?.roles ?? []).includes('Pod Lead');
  }

  private podIdsOf(q: CalQuery): number[] {
    const lead = this.isPodLead();
    const mine = lead ? [1, 4] : [1];
    const all = lead ? mine : PODS.map((p) => p.id);
    if (q.podScope === 'all') {
      if (lead) throw httpError(403, 'FORBIDDEN', 'Pod Leads see their own pods.');
      return all;
    }
    if (q.podScope === 'mine') return mine;
    const id = Number(q.podScope);
    if (!all.includes(id)) throw httpError(403, 'FORBIDDEN', 'That pod is outside your pods.');
    return [id];
  }

  private inView(q: CalQuery): Worker[] {
    const pods = this.podIdsOf(q);
    return WORKERS.filter(
      (w) => pods.includes(w.podId) && (q.role === null || w.roleId === q.role),
    );
  }

  private holidaysOn(date: string, cal: string): CalHoliday[] {
    return (['firm', cal] as const)
      .filter((c, i, a) => a.indexOf(c) === i)
      .flatMap((c) =>
        (FIX_HOLIDAYS[c] ?? [])
          .filter((h) => h[0] === date)
          .map((h) => ({
            name: h[1],
            calendarId: CALENDARS[c].id,
            category: CALENDARS[c].category,
            colourKey: CALENDARS[c].colourKey,
            appliesToEveryone: CALENDARS[c].everyone,
          })),
      );
  }

  private codeOf(w: Worker, date: string): { code: Code; entry?: (typeof FIX_ENTRIES)[number] } {
    const d = dow(date);
    if (d === 0 || d === 6) return { code: 'WEEKEND' };
    if (this.holidaysOn(date, w.cal).length > 0) return { code: 'HOLIDAY' };
    if (w.pt && d === 5) return { code: 'OFF' };
    const entry = FIX_ENTRIES.find((e) => e[0] === w.id && e[1] <= date && e[2] >= date);
    return entry ? { code: 'OUT', entry } : { code: 'AVAILABLE' };
  }

  private podLevel(available: number, expected: number, minimum: number): CoverageLevel {
    if (expected === 0) return 'CLOSED';
    if (available === 0) return 'CRITICAL';
    if (available >= minimum) return 'GOOD';
    return available / expected < POD_PERCENT / 100 ? 'CRITICAL' : 'LOW';
  }

  private evaluate(date: string, people: Worker[]): CalDay {
    const weekend = [0, 6].includes(dow(date));
    const pods = new Map<number, { expected: number; available: number }>();
    let available = 0;
    let outOfOffice = 0;
    let onHoliday = 0;
    let offHours = 0;
    for (const w of people) {
      const { code } = this.codeOf(w, date);
      const p = pods.get(w.podId) ?? { expected: 0, available: 0 };
      if (code === 'AVAILABLE') {
        available++;
        p.expected++;
        p.available++;
      } else if (code === 'OUT') {
        outOfOffice++;
        p.expected++;
      } else if (code === 'HOLIDAY') onHoliday++;
      else if (code === 'OFF') offHours++;
      pods.set(w.podId, p);
    }
    const expected = available + outOfOffice;
    const podRows: PodCoverage[] = PODS.filter((p) => pods.has(p.id)).map((p) => {
      const v = pods.get(p.id)!;
      const minimum = Math.min(
        v.expected,
        Math.max(p.min, Math.ceil((POD_PERCENT / 100) * v.expected)),
      );
      return {
        podId: p.id,
        name: p.name,
        expected: v.expected,
        available: v.available,
        minimum: weekend ? 0 : minimum,
        level: weekend ? 'NON_WORKING' : this.podLevel(v.available, v.expected, minimum),
      };
    });
    const first = people[0]?.cal ?? 'us';
    const holidays = weekend ? [] : this.holidaysOn(date, first);
    const coverage = expected > 0 ? Math.round((available / expected) * 100) : null;
    let level: CoverageLevel;
    if (weekend) level = 'NON_WORKING';
    else if (expected === 0) level = 'CLOSED';
    else {
      const pct = (available / expected) * 100;
      const hole = podRows.some((p) => p.expected > 0 && p.available === 0);
      const below = podRows.some((p) => p.expected > 0 && p.available < p.minimum);
      level =
        pct < POD_PERCENT || hole
          ? 'CRITICAL'
          : pct < MIN_PERCENT
            ? 'LOW'
            : below
              ? 'WATCH'
              : 'GOOD';
    }
    return {
      date,
      total: people.length,
      expected: weekend ? 0 : expected,
      available: weekend ? 0 : available,
      outOfOffice: weekend ? 0 : outOfOffice,
      onHoliday: weekend ? 0 : onHoliday,
      offHours: weekend ? 0 : offHours,
      coveragePercent: weekend ? null : coverage,
      level,
      holidays,
      pods: weekend ? [] : podRows,
    };
  }

  days(from: string, to: string, q: CalQuery): Promise<CalDays> {
    try {
      const people = this.inView(q);
      const out: CalDay[] = [];
      for (let d = from; d <= to && out.length < 62; d = addDays(d, 1))
        out.push(this.evaluate(d, people));
      return Promise.resolve({
        asOfUtc: this.clock.now().toISOString(),
        today: this.today(),
        firstDayOfWeek: 0,
        roles: ROLES,
        days: out,
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  day(date: string, q: CalQuery): Promise<DayPanel> {
    let people: Worker[];
    try {
      people = this.inView(q);
    } catch (e) {
      return Promise.reject(e);
    }
    const day = this.evaluate(date, people);
    const reasons = this.auth.has('Dashboard.ViewAbsenceReasons');
    const available: Record<number, DayPerson[]> = {};
    const unavailable: Record<number, DayPerson[]> = {};
    for (const w of people) {
      const { code, entry } = this.codeOf(w, date);
      const base: DayPerson = {
        userId: w.id,
        displayName: w.name,
        podNames: [PODS.find((p) => p.id === w.podId)!.name],
        load: w.load,
      };
      if (code === 'AVAILABLE') (available[w.roleId] ??= []).push(base);
      else if (code !== 'WEEKEND') {
        const reason: UnavailableReason =
          code === 'OUT' ? 'OUT_OF_OFFICE' : code === 'HOLIDAY' ? 'HOLIDAY' : 'NOT_WORKING';
        const person: DayPerson = {
          ...base,
          reason,
          backOn: entry ? addDays(entry[2], dow(entry[2]) === 5 ? 3 : 1) : null,
        };
        if (code === 'OUT' && reasons && entry) person.absenceType = TYPE_OF[entry[3]];
        (unavailable[w.roleId] ??= []).push(person);
      }
    }
    const byName = (a: DayPerson, b: DayPerson) => a.displayName.localeCompare(b.displayName);
    const group = (src: Record<number, DayPerson[]>, ascending: boolean): RoleGroup[] =>
      ROLES.filter((r) => src[r.roleId]?.length).map((r) => ({
        roleId: r.roleId,
        roleName: r.name,
        people: src[r.roleId].sort(
          (a, b) => (ascending ? a.load - b.load : b.load - a.load) || byName(a, b),
        ),
      }));
    return Promise.resolve({
      date,
      level: day.level,
      holidays: day.holidays.map((h) => ({
        name: h.name,
        category: h.category,
        colourKey: h.colourKey,
      })),
      counts: {
        total: day.total,
        expected: day.expected,
        available: day.available,
        outOfOffice: day.outOfOffice,
        onHoliday: day.onHoliday,
        offHours: day.offHours,
      },
      pods: day.pods,
      available: group(available, true),
      unavailable: group(unavailable, false),
    });
  }

  summary(q: CalQuery): Promise<CalSummary> {
    let people: Worker[];
    try {
      people = this.inView(q);
    } catch (e) {
      return Promise.reject(e);
    }
    const today = this.today();
    const risky: { date: string; level: CoverageLevel; worst: PodCoverage | null }[] = [];
    for (let i = 0; i <= 30; i++) {
      const date = addDays(today, i);
      const d = this.evaluate(date, people);
      if (d.level === 'LOW' || d.level === 'CRITICAL' || d.level === 'WATCH') {
        const worst =
          [...d.pods].sort((a, b) => a.available - a.minimum - (b.available - b.minimum))[0] ??
          null;
        if (d.level !== 'WATCH' || worst) risky.push({ date, level: d.level, worst });
      }
    }
    const open = people.reduce((n, w) => n + w.load, 0);
    const forecast = [0, 1, 2, 3].map((k) => {
      const start = addDays(today, -dow(today) + 7 * k);
      let days = 0;
      let present = 0;
      for (let i = 0; i < 7; i++) {
        const date = addDays(start, i);
        if (date < today || [0, 6].includes(dow(date))) continue;
        days++;
        present += this.evaluate(date, people).available;
      }
      const avg = days ? present / days : 0;
      return {
        weekStart: start,
        availablePeople: Math.round(avg * 10) / 10,
        freePercent:
          avg > 0
            ? Math.max(0, Math.min(100, Math.round(((3 * avg - open) / (3 * avg)) * 100)))
            : null,
      };
    });
    const first = risky[0];
    return Promise.resolve({
      thresholds: { minCoveragePercent: MIN_PERCENT, podMinimumPercent: POD_PERCENT },
      risk: {
        daysAtRisk: risky.length,
        firstRiskDate: first?.date ?? null,
        firstRiskLevel: first?.level ?? null,
        worstPod: first?.worst ? { podId: first.worst.podId, name: first.worst.name } : null,
        windowDays: 30,
      },
      forecast,
    });
  }
}
