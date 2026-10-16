import { ParamMap } from '@angular/router';
import {
  WorkloadBoard,
  WorkloadPriority,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import {
  OPEN_UNASSIGNED_QUERY,
  USERS_AVAILABILITY_PARAM,
  USERS_LOAD_PARAM,
  USERS_POD_PARAM,
  USERS_PRIORITY_PARAM,
  USERS_Q_PARAM,
  queueParams,
} from '../dashboard-links';

// ---- the view (what the toolbar chooses)

export const USER_SORTS = ['load', 'name', 'priority', 'open'] as const;
export type UserSort = (typeof USER_SORTS)[number];
export const USER_SORT_LABELS: Record<UserSort, string> = {
  load: 'Availability and load',
  name: 'Name',
  priority: 'Highest priority',
  open: 'Open tasks',
};
/** `available` is everyone not out of office (the API's meaning); `off` (off hours) is applied on the page. */
export const AVAILABILITY_FILTERS = ['all', 'available', 'off', 'out'] as const;
export type AvailabilityFilter = (typeof AVAILABILITY_FILTERS)[number];
export const AVAILABILITY_LABELS: Record<AvailabilityFilter, string> = {
  all: 'All',
  available: 'Available',
  off: 'Off hours',
  out: 'Out of office',
};
export const LAYOUTS = ['cards', 'table'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/** The two views of the Users tab: the team workload cards and the task type coverage matrix. */
export const TAB_VIEWS = ['workload', 'coverage'] as const;
export type TabView = (typeof TAB_VIEWS)[number];
export const isTabView = (v: unknown): v is TabView => TAB_VIEWS.includes(v as TabView);

export const isUserSort = (v: unknown): v is UserSort => USER_SORTS.includes(v as UserSort);
export const isAvailabilityFilter = (v: unknown): v is AvailabilityFilter =>
  AVAILABILITY_FILTERS.includes(v as AvailabilityFilter);
export const isLayout = (v: unknown): v is Layout => LAYOUTS.includes(v as Layout);
export const isDensity = (v: unknown): v is Density => DENSITIES.includes(v as Density);

/** The load filters (chips): `idle` is a person with nothing open and not out of office; the others follow the API's load level. */
export const LOAD_FILTERS = ['idle', 'light', 'normal', 'heavy'] as const;
export type LoadFilter = (typeof LOAD_FILTERS)[number];
export const isLoadFilter = (v: unknown): v is LoadFilter => LOAD_FILTERS.includes(v as LoadFilter);

/**
 * The filters of the tab. Pod, availability (all, available, out) and name are sent to the API; load, priority and off hours are applied on
 * the page. All of them live in the address (`?tab=users&upod=3&uavail=out&uq=ann&uload=idle,heavy&uprio=1`).
 */
export interface UsersFilters {
  pod: number | null;
  availability: AvailabilityFilter;
  q: string;
  /** Load levels to show (any of them); empty means all. */
  load: LoadFilter[];
  /** Highest open priority to show (a priority id), or null for all. */
  priority: number | null;
}

export const DEFAULT_FILTERS: UsersFilters = {
  pod: null,
  availability: 'all',
  q: '',
  load: [],
  priority: null,
};

export function sameFilters(a: UsersFilters, b: UsersFilters): boolean {
  return (
    a.pod === b.pod &&
    a.availability === b.availability &&
    a.q === b.q &&
    a.priority === b.priority &&
    a.load.join() === b.load.join()
  );
}

export function hasFilterParams(params: ParamMap): boolean {
  return [
    USERS_POD_PARAM,
    USERS_AVAILABILITY_PARAM,
    USERS_Q_PARAM,
    USERS_LOAD_PARAM,
    USERS_PRIORITY_PARAM,
  ].some((k) => params.has(k));
}

export function filtersFromParams(params: ParamMap): UsersFilters {
  const pod = Number(params.get(USERS_POD_PARAM));
  const prio = Number(params.get(USERS_PRIORITY_PARAM));
  const availability = params.get(USERS_AVAILABILITY_PARAM);
  const load = (params.get(USERS_LOAD_PARAM) ?? '').split(',').filter(isLoadFilter);
  return {
    pod: Number.isInteger(pod) && pod > 0 ? pod : null,
    availability: isAvailabilityFilter(availability) ? availability : 'all',
    q: (params.get(USERS_Q_PARAM) ?? '').trim(),
    load: LOAD_FILTERS.filter((l) => load.includes(l)),
    priority: Number.isInteger(prio) && prio > 0 ? prio : null,
  };
}

/** Router query parameters for the filters; unset ones are `null` so `merge` removes them. */
export function filtersToParams(f: UsersFilters): Record<string, string | null> {
  return {
    [USERS_POD_PARAM]: f.pod === null ? null : String(f.pod),
    [USERS_AVAILABILITY_PARAM]: f.availability === 'all' ? null : f.availability,
    [USERS_Q_PARAM]: f.q || null,
    [USERS_LOAD_PARAM]: f.load.length ? f.load.join(',') : null,
    [USERS_PRIORITY_PARAM]: f.priority === null ? null : String(f.priority),
  };
}

export function filterCount(f: UsersFilters): number {
  return (
    (f.pod !== null ? 1 : 0) +
    (f.availability !== 'all' ? 1 : 0) +
    (f.q ? 1 : 0) +
    (f.load.length ? 1 : 0) +
    (f.priority !== null ? 1 : 0)
  );
}

/** What the API is asked for: it knows all, available and out; "off hours" is read as "all" and narrowed on the page. */
export function apiAvailability(f: UsersFilters): 'all' | 'available' | 'out' {
  return f.availability === 'off' ? 'all' : f.availability;
}

/** True when the person passes the filters that are applied on the page (load, priority, off hours). */
export function passesLocalFilters(u: WorkloadUser, f: UsersFilters): boolean {
  if (f.availability === 'off' && u.availability?.state !== 'OFF_HOURS') return false;
  if (f.priority !== null && (u.openTotal === 0 || u.topPriority?.priorityId !== f.priority)) {
    return false;
  }
  return f.load.length === 0 || f.load.includes(loadLevelOf(u).toLowerCase() as LoadFilter);
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

// ---- colours

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

/** The Task Queue query of every open task nobody has, highest priority first. */
export function unassignedQueueParams() {
  return { ...queueParams(OPEN_UNASSIGNED_QUERY), sort: 'priorityAge', dir: 'asc' };
}

/** Pod ids and names seen on the board (feeds the pod filter when the pod list is not readable). */
export function podsOf(board: WorkloadBoard | null): Map<number, string> {
  const map = new Map<number, string>();
  for (const u of board?.users ?? []) for (const p of u.pods ?? []) map.set(p.podId, p.name);
  return map;
}
