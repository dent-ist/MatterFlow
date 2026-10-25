import { Injectable, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

/** The lists a task is opened from (`?from=`); anything else is dropped (M7). */
export type DrillSource = 'my-work' | 'task-queue' | 'pod-work';

export interface DrillInfo {
  /** "My Work", "Task Queue", "Pod Work". */
  label: string;
  /** The list's plain path (the fallback for the crumb and the Back link). */
  path: string;
}

export const DRILL_SOURCES: Readonly<Record<DrillSource, DrillInfo>> = {
  'my-work': { label: 'My Work', path: '/my-work' },
  'task-queue': { label: 'Task Queue', path: '/tasks' },
  'pod-work': { label: 'Pod Work', path: '/pods/work' },
};

/** The whitelisted value of `?from=`, or null. */
export function parseFrom(value: string | null | undefined): DrillSource | null {
  return value && Object.prototype.hasOwnProperty.call(DRILL_SOURCES, value)
    ? (value as DrillSource)
    : null;
}

/**
 * The pages other than the three work lists a task is opened from (T9, #324): a Matter's or a Project's Tasks tab, the Dashboard and Search.
 * Only the Task page reads them (its crumb, Back link and navigation highlight); the work lists' own `DRILL_SOURCES` are unchanged.
 */
export type RecordOrigin = 'matter' | 'project' | 'dashboard' | 'search' | 'my-matters';
export type TaskOrigin = DrillSource | RecordOrigin;

export interface RecordOriginInfo {
  /** The crumb and "Back to" label when the page has no better name ("Matter 00107-00001" is built from the task). */
  label: string;
  /** The navigation item that stays current while the task is open (null: Search is not in the navigation). */
  nav: string | null;
  /** The paths of the origin page that count as "the page the person came from"; the Task page only returns to an address on one of them. */
  paths: readonly string[];
}

export const RECORD_ORIGINS: Readonly<Record<RecordOrigin, RecordOriginInfo>> = {
  matter: { label: 'Matter', nav: '/matters', paths: [] },
  project: { label: 'Project', nav: '/projects', paths: [] },
  dashboard: { label: 'Dashboard', nav: '/dashboard', paths: ['/dashboard'] },
  search: { label: 'Search', nav: null, paths: ['/search'] },
  // My Matters (#693): a row of a panel opens the task, Back returns to the page with its filters.
  'my-matters': { label: 'My Matters', nav: '/my-matters', paths: ['/my-matters'] },
};

/** The whitelisted value of `?from=` for the Task page (the work lists and the record pages), or null: anything else is dropped. */
export function parseOrigin(value: string | null | undefined): TaskOrigin | null {
  if (!value) return null;
  const list = parseFrom(value);
  if (list) return list;
  return Object.prototype.hasOwnProperty.call(RECORD_ORIGINS, value)
    ? (value as RecordOrigin)
    : null;
}

export function isRecordOrigin(origin: TaskOrigin): origin is RecordOrigin {
  return Object.prototype.hasOwnProperty.call(RECORD_ORIGINS, origin);
}

/** The navigation item a task opened from `origin` keeps current (Task Queue, My Work, Pod Work, Matters, Projects, Dashboard; none for Search). */
export function originNav(origin: TaskOrigin): string | null {
  return isRecordOrigin(origin) ? RECORD_ORIGINS[origin].nav : DRILL_SOURCES[origin].path;
}

/**
 * The exact address the person came from, from history state `returnTo` (filters, tab, query kept): only an address on one of the origin's
 * own `paths` counts (the state is data a link or an old entry could carry), so a foreign or malformed value falls back to `fallback`.
 */
export function originUrl(paths: readonly string[], fallback: string, returnTo: unknown): string {
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//'))
    return fallback;
  const bare = returnTo.split(/[?#]/)[0];
  return paths.includes(bare) ? returnTo : fallback;
}

/**
 * The URL of the exact list view (filters, tab, sort) the person came from, from history state `returnTo`; only an address on the list's own
 * path counts (the state is data a link or an old entry could carry), so a bad value falls back to the plain list path.
 */
export function listUrl(from: DrillSource, returnTo: unknown): string {
  const path = DRILL_SOURCES[from].path;
  if (typeof returnTo !== 'string') return path;
  const bare = returnTo.split(/[?#]/)[0];
  return bare === path ? returnTo : path;
}

const pathOf = (url: string): string => url.split(/[?#]/)[0];

/** Where the person came back from: kept between leaving a list row and returning to the list. */
interface Left {
  from: DrillSource;
  taskId: number;
}

/**
 * A list row a person left (#281): which list (`clients`, `matters`, `projects`, `client-matters`, `matter-projects`; Task Detail adds its
 * own ids) and the row's key as text. It is written to `history.state.focusRow`, never to the URL.
 */
export interface RowRef {
  list: string;
  key: string;
}

/** The `focusRow` of a history state, or null when it is not a well-formed row (the state is data an old entry could carry). */
export function parseRowRef(value: unknown): RowRef | null {
  if (!value || typeof value !== 'object') return null;
  const { list, key } = value as Partial<RowRef>;
  return typeof list === 'string' && list !== '' && typeof key === 'string' && key !== ''
    ? { list, key }
    : null;
}

/**
 * Remembers the row a person left, so the list can put keyboard focus back on its title link when they return with the browser's Back or
 * the "Back to ..." link (and not when they reach the list some other way).
 *
 * Two families share one detector of "this navigation is a return":
 *   - tasks (`leave` / `take`): in memory, keyed by the work list (`my-work`, `task-queue`, `pod-work`) and the task id (#160);
 *   - records (`leaveRow` / `takeRow` / `takeTab`, #281): the row key goes to `history.state.focusRow`, so it survives several steps
 *     (list, record, Edit, Back, Back), a reload of the list (a reload is not a return, so nothing is focused) and Forward.
 * A return is a popstate (browser Back or Forward) or a link that sends the router state `{ restoreFocus: true }` (`RETURN_STATE`).
 */
@Injectable({ providedIn: 'root' })
export class DrillReturn {
  private readonly router = inject(Router);
  private left: Left | null = null;
  /** True when the navigation that is under way (or just done) is a return: browser Back/Forward or the "Back to ..." link. */
  private returning = false;
  /**
   * The row of a record list that was left last, with the list address it was left from (in memory, for the "Back to ..." links; browser
   * Back reads the history state).
   */
  private leftRow: (RowRef & { url: string }) | null = null;
  /** `leaveRow` was called and the navigation it started has not begun yet. */
  private leaving = false;
  /** Set by a return navigation: what it can still hand out once. */
  private pending: { row: RowRef | null; tab: boolean } | null = null;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe((e) => {
        const state = this.router.currentNavigation()?.extras.state as
          { restoreFocus?: boolean; keepRow?: boolean } | undefined;
        this.returning = e.navigationTrigger === 'popstate' || state?.restoreFocus === true;
        if (!this.returning) {
          // A forward navigation: the one that leaves a row keeps it for a "Back to ..." link; a later one to another page forgets it
          // (a tab or a filter inside the record page changes only the address's query).
          // A link that sends `keepRow` goes one level deeper into the same record (Task Type page to its form designer, #354): the row
          // stays remembered, so the breadcrumb two levels up still lands on it.
          if (this.leaving) this.leaving = false;
          else if (state?.keepRow !== true && pathOf(e.url) !== pathOf(this.router.url))
            this.leftRow = null;
          this.pending = null;
          return;
        }
        const restored = (e.restoredState as { focusRow?: unknown } | null | undefined)?.focusRow;
        this.pending = {
          row: e.navigationTrigger === 'popstate' ? parseRowRef(restored) : this.leftRow,
          tab: true,
        };
      });
  }

  /** A row's title link was used. */
  leave(from: DrillSource, taskId: number): void {
    this.left = { from, taskId };
  }

  /** The row to focus on this list, once; null when the list was not reached by a return. */
  take(from: DrillSource): number | null {
    const left = this.left;
    if (!left || left.from !== from || !this.returning) return null;
    this.left = null;
    return left.taskId;
  }

  /**
   * A record list's row link was used (#281): remembers the row in `history.state.focusRow` of the entry that is on screen (merged into the
   * router's own state, the URL is untouched) and in memory for the "Back to ..." links.
   */
  leaveRow(list: string, key: string | number): void {
    const row: RowRef = { list, key: String(key) };
    this.leftRow = { ...row, url: this.router.url };
    this.leaving = true;
    try {
      history.replaceState({ ...(history.state as object | null), focusRow: row }, '');
    } catch {
      /* no history (a unit test without a window): the memory copy still serves a "Back to ..." link */
    }
  }

  /**
   * Where a "Back to Clients" link goes: the exact list view (filters, sort, page) the last row was left from when that was this list,
   * else the plain `path`. Only an address of the list itself is returned, whatever else the state holds.
   */
  returnUrl(path: string): string {
    const url = this.leftRow?.url;
    return url && pathOf(url) === path ? url : path;
  }

  /**
   * The key of the row to focus on this list, once, when the navigation that brought the person here was a return from that row; null
   * otherwise (a forward visit, a reload, another list's row). Clears the entry's `focusRow`, so Back and Forward again do not repeat it.
   */
  takeRow(list: string): string | null {
    const row = this.pending?.row;
    if (!this.pending || !row || row.list !== list) return null;
    this.pending.row = null;
    try {
      const rest = { ...(history.state as Record<string, unknown> | null) };
      delete rest['focusRow'];
      history.replaceState(rest, '');
    } catch {
      /* ignore */
    }
    return row.key;
  }

  /** True once after a return, unless the row left belongs to one of `lists` (a list inside the page, which focuses its own row). */
  takeTab(lists: readonly string[] = []): boolean {
    const pending = this.pending;
    if (!pending?.tab) return false;
    if (pending.row && lists.includes(pending.row.list)) return false;
    pending.tab = false;
    return true;
  }
}
