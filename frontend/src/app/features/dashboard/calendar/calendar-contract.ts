/**
 * TEMPORARY (epic #1074, CAL-07 and CAL-08): the Calendar API as sketched in docs/ux/calendar/plan.md section 4, written by hand while the backend (Agent G2) builds
 * the endpoints. When "client pushed" is in progress.md this file and `calendar-fixtures.ts` go and `calendar-api.ts` calls the generated client.
 */

export type CoverageLevel = 'GOOD' | 'WATCH' | 'LOW' | 'CRITICAL' | 'CLOSED' | 'NON_WORKING';

export interface CalHoliday {
  name: string;
  calendarId?: number;
  /** The admin-defined category ("US Holiday", "Firm closure"). */
  category: string;
  colourKey: string;
  appliesToEveryone?: boolean;
}

export interface PodCoverage {
  podId: number;
  name: string;
  expected: number;
  available: number;
  minimum: number;
  level: CoverageLevel;
}

export interface CalDay {
  date: string;
  total: number;
  expected: number;
  available: number;
  outOfOffice: number;
  onHoliday: number;
  offHours: number;
  coveragePercent: number | null;
  level: CoverageLevel;
  holidays: CalHoliday[];
  pods: PodCoverage[];
}

export interface CalRole {
  roleId: number;
  name: string;
}

export interface CalDays {
  asOfUtc: string;
  today: string;
  /** 0 = Sunday. */
  firstDayOfWeek: number;
  roles: CalRole[];
  days: CalDay[];
}

export type UnavailableReason = 'OUT_OF_OFFICE' | 'HOLIDAY' | 'NOT_WORKING';
export type CalAbsenceType = 'VACATION' | 'SICK' | 'TRAINING' | 'CONFERENCE' | 'OTHER';

export interface DayPerson {
  userId: number;
  displayName: string;
  podNames: string[];
  /** Open tasks (New and In progress), a bare number. */
  load: number;
  /** Only in `unavailable`. */
  reason?: UnavailableReason;
  /** First working day after the entry; null when open-ended. */
  backOn?: string | null;
  /** Absent unless the viewer holds Dashboard.ViewAbsenceReasons. */
  absenceType?: CalAbsenceType;
}

export interface RoleGroup {
  roleId: number;
  roleName: string;
  people: DayPerson[];
}

export interface DayPanel {
  date: string;
  level: CoverageLevel;
  holidays: { name: string; category: string; colourKey: string }[];
  counts: {
    total: number;
    expected: number;
    available: number;
    outOfOffice: number;
    onHoliday: number;
    offHours: number;
  };
  pods: PodCoverage[];
  available: RoleGroup[];
  unavailable: RoleGroup[];
}

export interface CalSummary {
  thresholds: { minCoveragePercent: number; podMinimumPercent: number };
  risk: {
    daysAtRisk: number;
    firstRiskDate: string | null;
    firstRiskLevel: CoverageLevel | null;
    worstPod: { podId: number; name: string } | null;
    windowDays: number;
  };
  forecast: { weekStart: string; availablePeople: number; freePercent: number | null }[];
}

/** The filters of every read: `podScope` is the capacity parameter (`all`, `mine` or a pod id), `role` a role id or null. */
export interface CalQuery {
  podScope: string;
  role: number | null;
}
