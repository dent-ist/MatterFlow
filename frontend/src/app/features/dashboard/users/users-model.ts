import { ParamMap } from '@angular/router';
import { UserStateKey } from '../../../shared/icons/user-state-icon';
import {
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import {
  OPEN_UNASSIGNED_QUERY,
  USERS_AVAILABILITY_PARAM,
  USERS_LOAD_PARAM,
  USERS_NOPOD_PARAM,
  USERS_PRIORITY_PARAM,
  USERS_Q_PARAM,
  USERS_STATE_PARAM,
  queueParams,
} from '../dashboard-links';

// ---- the view (what the toolbar chooses)

export const USER_SORTS = [
  'load',
  'name',
  'priority',
  'open',
  'fewest',
  'overdue',
  'nextdue',
] as const;
export type UserSort = (typeof USER_SORTS)[number];
export const USER_SORT_LABELS: Record<UserSort, string> = {
  load: 'Availability and load',
  name: 'Name',
  priority: 'Highest priority',
  open: 'Open tasks',
  fewest: 'Fewest open tasks',
  overdue: 'Overdue',
  nextdue: 'Next due',
};
/** The sorts the Sort dropdown offers (US-11); Highest priority and Fewest open tasks stay as table-header and "can take work" sorts. */
export const SORT_MENU: readonly UserSort[] = ['load', 'name', 'open', 'overdue', 'nextdue'];
/** `available` is everyone not out of office (the API's meaning); it is set only by "Assign work > Show people who can take work now" and by old links. */
export const AVAILABILITY_FILTERS = ['all', 'available'] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];
export const LAYOUTS = ['cards', 'table'] as const;
export type Layout = (typeof LAYOUTS)[number];

/** The views of the Users tab: the team workload, the task type coverage matrix and the skills and training matrix. */
export const TAB_VIEWS = ['workload', 'coverage', 'skills'] as const;
export type TabView = (typeof TAB_VIEWS)[number];
export const isTabView = (v: unknown): v is TabView => TAB_VIEWS.includes(v as TabView);

export const isUserSort = (v: unknown): v is UserSort => USER_SORTS.includes(v as UserSort);
export const isAvailabilityFilter = (v: unknown): v is AvailabilityFilter =>
  AVAILABILITY_FILTERS.includes(v as AvailabilityFilter);
export const isLayout = (v: unknown): v is Layout => LAYOUTS.includes(v as Layout);

/**
 * The states of the State dropdown (US-11, #1102): the four load levels and the two availability exceptions. A person has their load level, plus Out of office or Off hours
 * when that is their availability; choosing several states shows the people who are in ANY of them. Idle is a person with nothing open.
 */
export const STATE_KEYS = [
  'idle',
  'light',
  'normal',
  'heavy',
  'out',
  'off',
] as const satisfies readonly UserStateKey[];
export const isStateKey = (v: unknown): v is UserStateKey => STATE_KEYS.includes(v as UserStateKey);

/** The states a person is in: the load level, and Out of office or Off hours. */
export function stateKeysOf(u: WorkloadUser): UserStateKey[] {
  const keys: UserStateKey[] = [loadLevelOf(u).toLowerCase() as UserStateKey];
  if (u.availability?.state === 'OUT_OF_OFFICE') keys.push('out');
  if (u.availability?.state === 'OFF_HOURS') keys.push('off');
  return keys;
}

/**
 * The filters of the tab: the name (sent to the API) and the states (applied on the page), in the address (`?tab=users&uq=ann&ustate=idle,out`). `availability`
 * is not a control any more: `available` (hide the people who are out of office) is set by "Assign work > Show people who can take work now" and by old links.
 * The old `uload`, `uavail` and `uprio` addresses still open: loads and out or off become states, the priority is ignored. The Pod is not a filter of the tab:
 * it is the page-wide Scope (`?pod=`, P1).
 */
export interface UsersFilters {
  availability: AvailabilityFilter;
  q: string;
  /** States to show (any of them); empty means all. */
  states: UserStateKey[];
  /**
   * The population (U4, #130), not a filter: false (default) lists the people who can take work (active, in a pod or holding an open task); true adds
   * the rest (`unopod=1`). It is not counted by `filterCount` and "Clear filters" leaves it alone.
   */
  includeNoPod: boolean;
}

export const DEFAULT_FILTERS: UsersFilters = {
  availability: 'all',
  q: '',
  states: [],
  includeNoPod: false,
};

export function sameFilters(a: UsersFilters, b: UsersFilters): boolean {
  return (
    a.availability === b.availability &&
    a.q === b.q &&
    a.includeNoPod === b.includeNoPod &&
    a.states.join() === b.states.join()
  );
}

export function hasFilterParams(params: ParamMap): boolean {
  return [
    USERS_AVAILABILITY_PARAM,
    USERS_Q_PARAM,
    USERS_LOAD_PARAM,
    USERS_PRIORITY_PARAM,
    USERS_STATE_PARAM,
    USERS_NOPOD_PARAM,
  ].some((k) => params.has(k));
}

export function filtersFromParams(params: ParamMap): UsersFilters {
  const availability = params.get(USERS_AVAILABILITY_PARAM);
  const wanted = new Set<string>(
    (params.get(USERS_STATE_PARAM) ?? '').split(',').filter(isStateKey),
  );
  // Old addresses: loads (`uload=idle,heavy`) and out of office or off hours (`uavail=out`) are states now.
  for (const l of (params.get(USERS_LOAD_PARAM) ?? '').split(',').filter(isStateKey)) wanted.add(l);
  if (availability === 'out' || availability === 'off') wanted.add(availability);
  return {
    availability: availability === 'available' ? 'available' : 'all',
    q: (params.get(USERS_Q_PARAM) ?? '').trim(),
    states: STATE_KEYS.filter((k) => wanted.has(k)),
    includeNoPod: params.get(USERS_NOPOD_PARAM) === '1',
  };
}

/** Router query parameters for the filters; unset ones are `null` so `merge` removes them (the old `uload` and `uprio` too). */
export function filtersToParams(f: UsersFilters): Record<string, string | null> {
  return {
    [USERS_AVAILABILITY_PARAM]: f.availability === 'all' ? null : f.availability,
    [USERS_Q_PARAM]: f.q || null,
    [USERS_STATE_PARAM]: f.states.length ? f.states.join(',') : null,
    [USERS_LOAD_PARAM]: null,
    [USERS_PRIORITY_PARAM]: null,
    [USERS_NOPOD_PARAM]: f.includeNoPod ? '1' : null,
  };
}

export function filterCount(f: UsersFilters): number {
  return (f.availability !== 'all' ? 1 : 0) + (f.q ? 1 : 0) + (f.states.length ? 1 : 0);
}

/** The filters "Clear filters" puts back: everything except the population switch. */
export const CLEARED_FILTERS: Partial<UsersFilters> = {
  availability: 'all',
  q: '',
  states: [],
};

/** What the API is asked for: all, or `available` (not out of office); the states are applied on the page. */
export function apiAvailability(f: UsersFilters): 'all' | 'available' {
  return f.availability;
}

/** True when the person is in any of the chosen states (all when none is chosen). */
export function passesLocalFilters(u: WorkloadUser, f: UsersFilters): boolean {
  return f.states.length === 0 || stateKeysOf(u).some((k) => f.states.includes(k));
}

export function filterUsers(users: readonly WorkloadUser[], f: UsersFilters): WorkloadUser[] {
  return users.filter((u) => passesLocalFilters(u, f));
}

// ---- states of a person

/** The state a card shows. Out of office wins; a person with nothing open is free; everyone else is busy. */
export type CardState = 'ooo' | 'free' | 'busy';

export function cardState(u: WorkloadUser): CardState {
  if (u.availability?.state === 'OUT_OF_OFFICE') return 'ooo';
  return u.openTotal === 0 ? 'free' : 'busy';
}

/** Capacity slots drawn on a person's card: the same 3-slot rule as the Team capacity battery. */
export const CARD_SLOTS = 3;

export type LoadLevel = 'IDLE' | 'LIGHT' | 'NORMAL' | 'HEAVY';

export function loadLevelOf(u: Pick<WorkloadUser, 'loadLevel'>): LoadLevel {
  const l = u.loadLevel;
  return l === 'LIGHT' || l === 'NORMAL' || l === 'HEAVY' ? l : 'IDLE';
}

export const LOAD_LABELS: Record<LoadLevel, string> = {
  IDLE: 'Idle',
  LIGHT: 'Light',
  NORMAL: 'Normal',
  HEAVY: 'Heavy',
};

export const LOAD_ICONS: Record<LoadLevel, string> = {
  IDLE: 'pi-check-circle',
  LIGHT: 'pi-angle-down',
  NORMAL: 'pi-equals',
  HEAVY: 'pi-exclamation-triangle',
};

/** The help text of the load label, with the configured thresholds. */
export function thresholdText(t: WorkloadThresholds | null | undefined): string[] {
  const light = t?.lightMax ?? 3;
  const normal = t?.normalMax ?? 8;
  return [
    'Idle: no open tasks.',
    `Light: 1 to ${light} open tasks.`,
    `Normal: ${light + 1} to ${normal} open tasks.`,
    `Heavy: more than ${normal} open tasks.`,
  ];
}

export interface LegendState {
  key: 'idle' | 'light' | 'normal' | 'heavy' | 'out' | 'off';
  word: string;
  icon: string;
  line: string;
}

/** The Legend of the Users tab: the six states, each with its icon and ONE plain line; the load lines come from the real thresholds of the board. */
export function legendStates(t: WorkloadThresholds | null | undefined): LegendState[] {
  const light = t?.lightMax ?? 3;
  const normal = t?.normalMax ?? 8;
  return [
    { key: 'idle', word: 'Idle', icon: LOAD_ICONS.IDLE, line: 'No open tasks' },
    { key: 'light', word: 'Light', icon: LOAD_ICONS.LIGHT, line: `1 to ${light} open tasks` },
    {
      key: 'normal',
      word: 'Normal',
      icon: LOAD_ICONS.NORMAL,
      line: `${light + 1} to ${normal} open tasks`,
    },
    {
      key: 'heavy',
      word: 'Heavy',
      icon: LOAD_ICONS.HEAVY,
      line: `${normal + 1} or more open tasks`,
    },
    {
      key: 'out',
      word: 'Out of office',
      icon: 'pi-calendar-minus',
      line: 'Away; the day they are back is on the card',
    },
    {
      key: 'off',
      word: 'Off hours',
      icon: 'pi-moon',
      line: 'Outside their working hours right now',
    },
  ];
}

/** The visible and spoken name of a load level: the word, then what it means with the thresholds ("Light: 1 to 3 open tasks"). */
export function loadHelp(level: LoadLevel, t: WorkloadThresholds | null | undefined): string {
  return thresholdText(t)[['IDLE', 'LIGHT', 'NORMAL', 'HEAVY'].indexOf(level)].replace(/\.$/, '');
}

// ---- the capacity strip (U1, #127)

export interface CapacitySegment {
  level: LoadLevel;
  count: number;
  /** Share of the bar in percent (the counts add up to the people on the board). */
  percent: number;
}

/** The people by load level, in the chips' order; the segments' widths follow the counts (a level nobody is in has none). */
export function capacitySegments(
  users: readonly Pick<WorkloadUser, 'loadLevel'>[],
): CapacitySegment[] {
  const levels: LoadLevel[] = ['IDLE', 'LIGHT', 'NORMAL', 'HEAVY'];
  const total = users.length;
  return levels.map((level) => {
    const count = users.filter((u) => loadLevelOf(u) === level).length;
    return { level, count, percent: total === 0 ? 0 : (count / total) * 100 };
  });
}

/** What "Assign work > Show people who can take work now" sets: not out of office, Idle or Light, fewest open tasks first. */
export const CAN_TAKE_WORK_NOW: Partial<UsersFilters> = {
  availability: 'available',
  states: ['idle', 'light'],
};

// ---- colours

/**
 * The fill of an Idle tile, chip, strip segment and pill (U7, #133): the existing Idle token (`--mf-success-bg`) at 45% over the surface. A fact, not
 * a trophy: the saturated fills are for Heavy and Out of office. Text stays `--mf-success` or `--mf-text` (4.5:1) and the thin outline `--mf-success` (3:1);
 * `users-model.spec.ts` checks both with the token values. Components that style with CSS repeat the same expression.
 */
export const IDLE_TINT_PERCENT = 45;
export const IDLE_TINT = `color-mix(in srgb, var(--mf-success-bg) ${IDLE_TINT_PERCENT}%, var(--mf-surface))`;

/**
 * The colour token of a user's card: the highest priority among the open tasks (token or `#RRGGBB`, the same value the priority badge
 * takes), `free` for nothing open, `ooo` for out of office. Used for the `data-tone` attribute and the band colours.
 */
export function toneOf(u: WorkloadUser): string {
  switch (cardState(u)) {
    case 'ooo':
      return 'ooo';
    case 'free':
      return 'free';
    default:
      return u.topPriority?.color ?? 'neutral';
  }
}

export interface Segment {
  priorityId: number;
  label: string;
  color: string;
  count: number;
  /** Share of the bar track, in percent. */
  percent: number;
}

/**
 * The segments of the load bar: one per priority with open tasks, in rank order (the legend order). The track is as wide as the Normal
 * ceiling, or as the open total when there are more tasks than that, so a Heavy person has a full bar.
 */
export function segmentsOf(
  u: WorkloadUser,
  legend: readonly WorkloadPriority[],
  thresholds: WorkloadThresholds | null | undefined,
): Segment[] {
  const scale = Math.max(thresholds?.normalMax ?? 8, u.openTotal, 1);
  const counts = new Map((u.byPriority ?? []).map((c) => [c.priorityId, c.count] as const));
  return legend
    .filter((p) => (counts.get(p.priorityId) ?? 0) > 0)
    .map((p) => {
      const count = counts.get(p.priorityId) ?? 0;
      return {
        priorityId: p.priorityId,
        label: p.label,
        color: p.color,
        count,
        percent: (count / scale) * 100,
      };
    });
}

/** The count of each legend priority for a user, in legend (rank) order, zeros included. */
export function countsOf(
  u: WorkloadUser,
  legend: readonly WorkloadPriority[],
): { priority: WorkloadPriority; count: number }[] {
  const counts = new Map((u.byPriority ?? []).map((c) => [c.priorityId, c.count] as const));
  return legend.map((priority) => ({ priority, count: counts.get(priority.priorityId) ?? 0 }));
}

// ---- sorting

const availabilityRank = (u: WorkloadUser): number =>
  u.availability?.state === 'OUT_OF_OFFICE' ? 2 : u.availability?.state === 'OFF_HOURS' ? 1 : 0;

const byName = (a: WorkloadUser, b: WorkloadUser) =>
  a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) ||
  a.userId - b.userId;

/**
 * The people in the order chosen. `load` (the default) is the API's order: available people first, then off hours, then out of office,
 * the lighter load first, then by name. `priority` puts the most urgent open work first (people with nothing open last), `open` the
 * most open tasks first. Equal people are ordered by name, so the order never jumps around.
 */
/** The instant of a person's next due task; people without one sort last. */
function nextDueKey(u: WorkloadUser): number {
  const d = u.nextDue?.dueAtUtc ?? u.nextDue?.dueDate;
  const t = d ? Date.parse(d) : NaN;
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

export function sortUsers(users: readonly WorkloadUser[], sort: UserSort): WorkloadUser[] {
  const list = [...users];
  switch (sort) {
    case 'name':
      return list.sort(byName);
    case 'priority':
      return list.sort(
        (a, b) =>
          (a.topPriority?.rank ?? Number.MAX_SAFE_INTEGER) -
            (b.topPriority?.rank ?? Number.MAX_SAFE_INTEGER) ||
          b.openTotal - a.openTotal ||
          byName(a, b),
      );
    case 'open':
      return list.sort((a, b) => b.openTotal - a.openTotal || byName(a, b));
    case 'fewest':
      return list.sort((a, b) => a.openTotal - b.openTotal || byName(a, b));
    case 'overdue':
      return list.sort((a, b) => b.overdue - a.overdue || byName(a, b));
    case 'nextdue':
      return list.sort((a, b) => nextDueKey(a) - nextDueKey(b) || byName(a, b));
    default:
      return list.sort(
        (a, b) =>
          availabilityRank(a) - availabilityRank(b) || a.openTotal - b.openTotal || byName(a, b),
      );
  }
}

// ---- text

export function plural(n: number, one: string, many = one + 's'): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Everything a tile says, as sentences for the tile's accessible name and its tooltip: the name, the availability when it is not the usual
 * ("Out of office until Oct 20", "Off hours") and the work ("No open tasks", or the open count, highest priority, overdue, due soon, on hold
 * and load). The tiles themselves carry no such words; colours and icons stand for them.
 */
export function cardSummary(u: WorkloadUser, availabilityText: string): string {
  const parts: string[] = [u.displayName];
  if (u.availability?.state === 'OUT_OF_OFFICE' || u.availability?.state === 'OFF_HOURS') {
    parts.push(availabilityText);
    if (u.availability.note) parts.push(u.availability.note);
  }
  if (u.openTotal === 0) {
    parts.push('No open tasks');
    return parts.join('. ');
  }
  const work = [plural(u.openTotal, 'open task')];
  if (u.topPriority) work.push(`highest priority ${u.topPriority.label}`);
  if (u.overdue > 0) work.push(`${u.overdue} overdue`);
  if (u.dueSoon > 0) work.push(`${u.dueSoon} due soon`);
  if (u.onHold > 0) work.push(`${u.onHold} on hold`);
  work.push(`${LOAD_LABELS[loadLevelOf(u)].toLowerCase()} load`);
  parts.push(work.join(', '));
  return parts.join('. ');
}

// ---- links to the Task Queue

const OPEN_STATUS_LIST = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

/** The Task Queue query of one person's open tasks. */
export function userQueueParams(userId: number): Record<string, string | string[]> {
  return { status: OPEN_STATUS_LIST, assignee: [String(userId)], sort: 'priority', dir: 'asc' };
}

/**
 * The Task Queue query of every open task nobody has, highest priority first. Under a Pod scope it carries the scope's `pod` filter, so the
 * queue lists the tasks the Unassigned number counts.
 */
export function unassignedQueueParams(pods: readonly string[] = []) {
  return {
    ...queueParams(OPEN_UNASSIGNED_QUERY),
    ...(pods.length > 0 ? { pod: [...pods] } : {}),
    sort: 'priorityAge',
    dir: 'asc',
  };
}
