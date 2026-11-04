import {
  CAPACITY_STATES,
  CapacityState,
  STATE_META,
  isCapacityState,
  StateMeta,
} from '../../../shared/availability/capacity-state';
import { CapacityPerson, DashboardCapacity } from '../../../api/generated/api-client';

export { STATE_META };

/**
 * The formula, in the words of the issue; the slots per person comes from the response. People who are out of office or on holiday are left out; people only outside their work
 * hours count while the setting "Count people outside work hours as available" is on (decision AV, the default).
 */
export function formulaText(slotsPerPerson: number, countOffHours = true): string {
  return (
    `Remaining capacity = free slots / (${slotsPerPerson} x people who are at work). ` +
    `A slot is free when the person has fewer than ${slotsPerPerson} open tasks. ` +
    'On hold tasks do not count. People who are out of office or on holiday are not counted. ' +
    (countOffHours
      ? 'People who are only outside their work hours are counted as available.'
      : 'People outside their work hours are not counted, so the battery says After hours when nobody is at work.')
  );
}

export type BatteryMode =
  /** Normal: a percentage. */
  | 'normal'
  /** Nobody counts because it is outside working hours AND the setting leaves off-hours people out (neutral "After hours", never 100 % used). */
  | 'after-hours'
  /** Nobody counts because everybody unavailable is on a holiday. */
  | 'holiday'
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

export type CapacityWord = 'Healthy' | 'Watch' | 'Low' | 'Critical';

export interface BatteryView {
  mode: BatteryMode;
  /** 0 to 100: how full the battery is drawn (the REMAINING capacity, the API's freePercent). */
  charge: number;
  /** The text inside the battery: `62%`, or the state word (`After hours`, `Everyone out`, `No workers`). */
  bigText: string;
  /** 0 (healthy) to 5 (darkest red): the colour step of the remaining capacity, null without a percentage. */
  level: number | null;
  /** `Remaining capacity 62%`: the tooltip's first line (the state word in the neutral states). */
  tooltip: string;
  /** `9 unassigned waiting, 12 free slots` (without the waiting part when the caller may not see it). */
  summaryLine: string;
  /** Open unassigned tasks in scope, or null when the caller may not see the count: the waiting part of the line is hidden. */
  waiting: number | null;
  /** The free slots part of the line. */
  freeText: string;
  /** Tasks above the slot count of the people who count; the red line shows only when above 0. */
  overCapacity: number;
  /** `3 tasks over capacity`, or null at 0. */
  overText: string | null;
  /** Healthy (50% and more), Watch (30 to 49), Low (10 to 29), Critical (under 10), or null when there is no percentage. */
  word: CapacityWord | null;
  rateHint: string | null;
  legend: LegendItem[];
  formula: string;
  /** The one spoken name of the battery. */
  ariaLabel: string;
}

/** The word of the remaining capacity: the chip beside the title says it, so the colour is never the only signal. */
export function freeWord(freePercent: number): CapacityWord {
  return freePercent >= 50
    ? 'Healthy'
    : freePercent >= 30
      ? 'Watch'
      : freePercent >= 10
        ? 'Low'
        : 'Critical';
}

/** The icon of each word (it changes with the level). */
export const WORD_ICON: Record<CapacityWord, string> = {
  Healthy: 'pi-check-circle',
  Watch: 'pi-eye',
  Low: 'pi-exclamation-triangle',
  Critical: 'pi-times-circle',
};

/** The colour step: 0 at 50% and more, then one step each time the remaining capacity falls below 40, 30, 20 and 10 percent. */
export function levelOf(freePercent: number): number {
  return freePercent >= 50
    ? 0
    : freePercent >= 40
      ? 1
      : freePercent >= 30
        ? 2
        : freePercent >= 20
          ? 3
          : freePercent >= 10
            ? 4
            : 5;
}

export function rateHintText(assignedLastHour: number | null | undefined): string | null {
  return assignedLastHour === null || assignedLastHour === undefined
    ? null
    : `${assignedLastHour} assigned in the last hour`;
}

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

/** Everything the battery shows, from the server's numbers (nothing is recomputed here: the big number is the API's). */
export function batteryView(c: DashboardCapacity): BatteryView {
  const counts = new Map<string, number>(c.states.map((s) => [s.state, s.count]));
  const legend: LegendItem[] = CAPACITY_STATES.map((state) => ({
    state,
    ...STATE_META[state],
    // The Off hours count stays as information: with the setting on those people are still counted.
    label:
      state === 'OFF_HOURS' && c.countOffHours
        ? 'Outside work hours, still counted'
        : STATE_META[state].label,
    count: counts.get(state) ?? 0,
  }));
  const formula = formulaText(c.slotsPerPerson, c.countOffHours);
  const rateHint = rateHintText(c.assignedLastHour);
  const over = c.overCapacityTasks ?? 0;
  const overText = over > 0 ? `${plural(over, 'task')} over capacity` : null;
  const waiting = c.unassignedWaiting ?? null;
  const freeText = plural(c.freeSlots, 'free slot');
  const summaryLine = waiting === null ? freeText : `${waiting} unassigned waiting, ${freeText}`;
  const common = { waiting, freeText, overCapacity: over, overText, rateHint, legend, formula };
  if (c.state === 'NO_WORKERS' || c.workers === 0) {
    return {
      ...common,
      mode: 'empty',
      charge: 0,
      bigText: 'No workers',
      level: null,
      tooltip: 'No workers in this scope',
      summaryLine: 'No one in this scope takes work yet.',
      word: null,
      rateHint: null,
      ariaLabel: 'Remaining capacity. No one in this scope takes work yet.',
    };
  }
  const neutral = (
    mode: BatteryMode,
    bigText: string,
    tooltip: string,
    spoken: string,
  ): BatteryView => ({
    ...common,
    mode,
    charge: 0,
    bigText,
    level: null,
    tooltip,
    summaryLine,
    word: null,
    ariaLabel: `Remaining capacity. ${spoken}. ${summaryLine}.`,
  });
  if (c.state === 'ALL_OUT') {
    return neutral(
      'all-out',
      'Everyone out',
      'Everyone is out of office',
      'Everyone is out of office',
    );
  }
  if (c.state === 'HOLIDAY') {
    return neutral(
      'holiday',
      'Holiday',
      'Holiday: nobody is at work',
      'Holiday, nobody is at work',
    );
  }
  if (c.state === 'AFTER_HOURS') {
    return neutral('after-hours', 'After hours', 'After hours', 'After hours');
  }
  const free =
    c.freePercent ??
    (c.usedPercent === null || c.usedPercent === undefined ? 0 : 100 - c.usedPercent);
  return {
    ...common,
    mode: 'normal',
    charge: Math.max(0, Math.min(100, free)),
    bigText: `${free}%`,
    level: levelOf(free),
    tooltip: `Remaining capacity ${free}%`,
    summaryLine,
    word: freeWord(free),
    ariaLabel: `Remaining capacity ${free} percent. ${summaryLine}.${overText ? ' ' + overText + '.' : ''} ${freeWord(free)}.`,
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
