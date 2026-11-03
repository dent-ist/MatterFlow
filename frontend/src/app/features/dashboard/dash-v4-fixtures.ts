import {
  CAPACITY_STATES,
  CapacityPerson,
  CapacityState,
  CapacitySummary,
  UnassignedGauge,
} from './dash-v4-contract';

/**
 * TEMPORARY (Dashboard v4, epic #1063): fixtures that follow the contract sketch, used until the generated client carries the endpoints.
 * The 12-worker set is the mockup's: 4 out or away, 8 can take work.
 */
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

export function fixturePeople(count = 12): CapacityPerson[] {
  return Array.from({ length: count }, (_, i) => {
    const state = STATES[i % STATES.length];
    return {
      userId: 100 + i,
      displayName:
        NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''),
      state,
      load: LOAD[state],
      outUntil: state === 'OUT_OF_OFFICE' ? '2026-11-06' : null,
      podNames: [i % 2 === 0 ? 'Review' : 'QC'],
    };
  });
}

export function capacityOf(
  people: readonly CapacityPerson[],
  assignedLastHour = 3,
): CapacitySummary {
  const states = CAPACITY_STATES.map((state) => ({
    state,
    count: people.filter((p) => p.state === state).length,
  }));
  const slotsPerPerson = 3;
  const free = people.reduce(
    (n, p) =>
      p.state === 'OUT_OF_OFFICE' || p.state === 'OFF_HOURS'
        ? n
        : n + Math.max(0, slotsPerPerson - p.load),
    0,
  );
  const total = slotsPerPerson * people.length;
  const canTakeWork = people.filter(
    (p) => p.state !== 'OUT_OF_OFFICE' && p.state !== 'OFF_HOURS' && p.load < slotsPerPerson,
  ).length;
  return {
    asOfUtc: new Date().toISOString(),
    workers: people.length,
    slotsPerPerson,
    totalSlots: total,
    freeSlots: free,
    usedPercent: total === 0 || canTakeWork === 0 ? null : Math.round(100 - (100 * free) / total),
    freePercent: total === 0 ? null : Math.round((100 * free) / total),
    canTakeWork,
    states,
    assignedLastHour,
  };
}

export const FIXTURE_GAUGE: UnassignedGauge = {
  count: 7,
  oldestSinceUtc: new Date(Date.now() - 168 * 60_000).toISOString(),
  oldestAgeMinutes: 168,
  ageBasis: 'WORKING',
  level: 3,
  asOfUtc: new Date().toISOString(),
};
