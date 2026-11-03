/**
 * TEMPORARY (Dashboard v4, epic #1063): the hand-written types of the new endpoints, written from the contract sketch in
 * `docs/ux/dashboard-v4/plan.md` section 4. They are deleted when Agent G has pushed the regenerated nswag client
 * (`progress.md` says "client pushed") and the page uses the generated types. Nothing outside `dash-v4-api.ts` and the fixtures may
 * import this file for a new purpose.
 */

import { CAPACITY_STATES, CapacityState } from '../../shared/availability/capacity-state';

export { CAPACITY_STATES };
export type { CapacityState };

export interface CapacityStateCount {
  state: CapacityState;
  count: number;
}

/** `GET /api/v1/dashboard/capacity` (Dashboard.ViewUsers; scope parameter). */
export interface CapacitySummary {
  asOfUtc: string;
  workers: number;
  slotsPerPerson: number;
  totalSlots: number;
  freeSlots: number;
  /** Null when nobody can take work because it is outside working hours or everyone is away (owner decision): the battery then says "After hours", never 100 % used. */
  usedPercent: number | null;
  freePercent: number | null;
  canTakeWork: number;
  /** All six states in the fixed order. */
  states: CapacityStateCount[];
  /** Assignments in the last hour (aggregate); absent or null: no rate hint. */
  assignedLastHour?: number | null;
}

/** One row of `GET /api/v1/dashboard/capacity/people` (Dashboard.ViewUsers; at most 200). */
export interface CapacityPerson {
  userId: number;
  displayName: string;
  state: CapacityState;
  load: number;
  /** Date only, for OUT_OF_OFFICE. */
  outUntil?: string | null;
  podNames: string[];
}

/** `unassignedGauge` of `GET /api/v1/dashboard` (Dashboard.ViewSummary; null otherwise). */
export interface UnassignedGauge {
  count: number;
  oldestSinceUtc: string | null;
  /** Working minutes when `ageBasis` is WORKING. */
  oldestAgeMinutes: number;
  ageBasis: 'WORKING' | 'CLOCK';
  /** 0 to 5; computed on the server (one level for all viewers). */
  level: number;
  asOfUtc: string;
}
