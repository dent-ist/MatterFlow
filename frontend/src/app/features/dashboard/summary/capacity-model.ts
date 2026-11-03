import {
  CAPACITY_STATES,
  CapacityState,
  STATE_META,
  isCapacityState,
  StateMeta,
} from '../../../shared/availability/capacity-state';
import { CapacityPerson, DashboardCapacity } from '../../../api/generated/api-client';

export { STATE_META };

/** The formula, in the words of the issue; the slots per person comes from the response. Out of office and off hours people are left out of the people counted. */
export function formulaText(slotsPerPerson: number): string {
  return (
    `Free capacity = free slots / (${slotsPerPerson} x people who are at work now). ` +
    `A slot is free when the person has fewer than ${slotsPerPerson} open tasks. ` +
    'On hold tasks do not count. People who are out of office or outside their work hours have no free slots and are not counted.'
  );
}

export type BatteryMode =
  /** Normal: a percentage. */
  | 'normal'
  /** Nobody can take work right now because it is outside working hours (owner decision: neutral "After hours", never 100 % used). */
  | 'after-hours'
  /** Everybody in the scope is out of office. */
  | 'all-out'
  /** No worker in this scope. */
  | 'empty';

export interface LegendItem {
  state: CapacityState;
  label: string;
  icon: string;
  swatch: StateMeta['swatch'];
  count: number;
}

export interface BatteryView {
  mode: BatteryMode;
  /** 0 to 100: how full the battery is drawn (the FREE capacity). */
  charge: number;
  /** `Capacity used 33%`, `After hours`, or `No one takes work yet`. */
  bigText: string;
  /** `8 of 12 can take work now`. */
  summaryLine: string;
  /** Healthy, Limited, Low (by free capacity), or null when there is no percentage. */
  word: 'Healthy' | 'Limited' | 'Low' | null;
  rateHint: string | null;
  legend: LegendItem[];
  formula: string;
  /** The one spoken name of the battery. */
  ariaLabel: string;
}

export function freeWord(freePercent: number): 'Healthy' | 'Limited' | 'Low' {
  return freePercent >= 50 ? 'Healthy' : freePercent >= 25 ? 'Limited' : 'Low';
}

export function rateHintText(assignedLastHour: number | null | undefined): string | null {
  return assignedLastHour === null || assignedLastHour === undefined
    ? null
    : `${assignedLastHour} assigned in the last hour`;
}

/** Everything the battery shows, from the server's numbers (nothing is recomputed here: the big number is the API's). */
export function batteryView(c: DashboardCapacity): BatteryView {
  const counts = new Map<string, number>(c.states.map((s) => [s.state, s.count]));
  const legend: LegendItem[] = CAPACITY_STATES.map((state) => ({
    state,
    ...STATE_META[state],
    count: counts.get(state) ?? 0,
  }));
  const formula = formulaText(c.slotsPerPerson);
  const rateHint = rateHintText(c.assignedLastHour);
  if (c.state === 'NO_WORKERS' || c.workers === 0) {
    return {
      mode: 'empty',
      charge: 0,
      bigText: 'No one takes work yet',
      summaryLine: 'No one in this scope takes work yet.',
      word: null,
      rateHint: null,
      legend,
      formula,
      ariaLabel: 'Capacity. No one in this scope takes work yet.',
    };
  }
  const summaryLine = `${c.canTakeWork} of ${c.workers} can take work now`;
  if (c.state === 'ALL_OUT') {
    return {
      mode: 'all-out',
      charge: 0,
      bigText: 'Everyone is out of office',
      summaryLine,
      word: null,
      rateHint,
      legend,
      formula,
      ariaLabel: `Capacity. Everyone is out of office. ${summaryLine}.`,
    };
  }
  if (c.state === 'AFTER_HOURS' || c.usedPercent === null || c.usedPercent === undefined) {
    return {
      mode: 'after-hours',
      charge: 0,
      bigText: 'After hours',
      summaryLine: `${summaryLine}. Nobody is taking new work right now.`,
      word: null,
      rateHint,
      legend,
      formula,
      ariaLabel: `Capacity. After hours. ${summaryLine}.`,
    };
  }
  const used = c.usedPercent as number;
  const free = c.freePercent ?? 100 - used;
  return {
    mode: 'normal',
    charge: Math.max(0, Math.min(100, free)),
    bigText: `Capacity used ${used}%`,
    summaryLine,
    word: freeWord(free),
    rateHint,
    legend,
    formula,
    ariaLabel: `Capacity used ${used} percent. ${summaryLine}. ${freeWord(free)} free capacity.`,
  };
}

export interface PeopleGroup {
  state: CapacityState;
  label: string;
  icon: string;
  people: CapacityPerson[];
}

/** People grouped by state in the legend order, each group by name; `query` filters by name or state word (client side, up to 200 rows). */
export function groupPeople(people: readonly CapacityPerson[], query: string): PeopleGroup[] {
  const q = query.trim().toLowerCase();
  const match = (p: CapacityPerson): boolean =>
    q === '' ||
    p.displayName.toLowerCase().includes(q) ||
    (isCapacityState(p.state) && STATE_META[p.state].label.toLowerCase().includes(q));
  return CAPACITY_STATES.map((state) => ({
    state,
    label: STATE_META[state].label,
    icon: STATE_META[state].icon,
    people: people
      .filter((p) => p.state === state && match(p))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  })).filter((g) => g.people.length > 0);
}

/** `Busy, 2 open` / `Out of office until 11/06`: the line of one person in the People list. */
export function personDetail(p: CapacityPerson): string {
  const meta = isCapacityState(p.state) ? STATE_META[p.state].label : p.state;
  if (p.state === 'OUT_OF_OFFICE' && p.outUntil) {
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(p.outUntil);
    return m ? `${meta} until ${m[1]}/${m[2]}` : meta;
  }
  return `${meta}, ${p.load} open`;
}
