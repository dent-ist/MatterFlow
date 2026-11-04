import { CapacityPerson, DashboardCapacity } from '../../../api/generated/api-client';
import { CAPACITY_STATES, CapacityState } from '../../../shared/availability/capacity-state';

/** Builders for the Dashboard v4 specs. The 12-person set has 8 people who can take work now: 3 Available, 3 Occupied, 2 Busy, 1 Overloaded, 2 out of office, 1 off hours. */
const NAMES = [
  'Priya Nair',
  'Marcus Oyelaran',
  'Dana Whitfield',
  'Lena Okoro',
  'Tomas Reyes',
  'Hana Sato',
  'Ivan Petrov',
  'Grace Liu',
  'Omar Haddad',
  'Sofia Marin',
  'Ben Carter',
  'Nia Brooks',
];
const STATES: CapacityState[] = [
  'AVAILABLE',
  'OCCUPIED',
  'BUSY',
  'OVERLOADED',
  'AVAILABLE',
  'OUT_OF_OFFICE',
  'OCCUPIED',
  'BUSY',
  'AVAILABLE',
  'OFF_HOURS',
  'OCCUPIED',
  'OUT_OF_OFFICE',
];
const LOAD: Record<CapacityState, number> = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  BUSY: 2,
  OVERLOADED: 3,
  OUT_OF_OFFICE: 1,
  OFF_HOURS: 0,
};

export function somePeople(count = 12): CapacityPerson[] {
  return Array.from({ length: count }, (_, i) => {
    const state = STATES[i % STATES.length];
    return {
      userId: 100 + i,
      displayName:
        NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''),
      state,
      load: LOAD[state],
      outUntil: state === 'OUT_OF_OFFICE' ? '2026-11-06' : undefined,
      podNames: [i % 2 === 0 ? 'Review' : 'QC'],
    };
  });
}

export interface CapacityOptions {
  /** Decision AV: people only outside work hours count as available (default true). */
  countOffHours?: boolean;
  /** Open unassigned tasks in scope; undefined: the caller may not see the count. */
  unassignedWaiting?: number;
}

/**
 * What the capacity endpoint answers for these people (the server's rules, decision AV): people out of office are left out; people only outside their work hours count (3 slots each,
 * free = slots minus load) unless the setting is off; tasks above the slot count are the over-capacity tasks. `OFF_HOURS` keeps its count in `states`.
 */
export function capacityOf(
  people: readonly CapacityPerson[],
  assignedLastHour = 3,
  options: CapacityOptions = {},
): DashboardCapacity {
  const countOffHours = options.countOffHours ?? true;
  const slotsPerPerson = 3;
  const counts = (p: CapacityPerson) =>
    p.state !== 'OUT_OF_OFFICE' && (countOffHours || p.state !== 'OFF_HOURS');
  const present = people.filter(counts);
  const total = slotsPerPerson * present.length;
  const free = present.reduce((n, p) => n + Math.max(0, slotsPerPerson - p.load), 0);
  const over = present.reduce((n, p) => n + Math.max(0, p.load - slotsPerPerson), 0);
  const canTakeWork = present.filter((p) => p.load < slotsPerPerson).length;
  const state =
    people.length === 0
      ? 'NO_WORKERS'
      : present.length > 0
        ? 'OK'
        : !countOffHours && people.some((p) => p.state === 'OFF_HOURS')
          ? 'AFTER_HOURS'
          : 'ALL_OUT';
  return {
    asOfUtc: '2026-11-03T15:42:00Z',
    state,
    workers: people.length,
    presentWorkers: present.length,
    slotsPerPerson,
    totalSlots: total,
    freeSlots: free,
    usedPercent: state === 'OK' ? Math.round(100 - (100 * free) / total) : undefined,
    freePercent: state === 'OK' ? Math.round((100 * free) / total) : undefined,
    canTakeWork,
    states: CAPACITY_STATES.map((s) => ({
      state: s,
      count: people.filter((p) => p.state === s).length,
    })),
    assignedLastHour: people.length === 0 ? 0 : assignedLastHour,
    countOffHours,
    overCapacityTasks: over,
    unassignedWaiting: options.unassignedWaiting,
  };
}
