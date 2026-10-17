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
 * The URL of the exact list view (filters, tab, sort) the person came from, from history state `returnTo`; only an address on the list's own
 * path counts (the state is data a link or an old entry could carry), so a bad value falls back to the plain list path.
 */
export function listUrl(from: DrillSource, returnTo: unknown): string {
  const path = DRILL_SOURCES[from].path;
  if (typeof returnTo !== 'string') return path;
  const bare = returnTo.split(/[?#]/)[0];
  return bare === path ? returnTo : path;
}

/** Where the person came back from: kept between leaving a list row and returning to the list. */
interface Left {
  from: DrillSource;
  taskId: number;
}

/**
 * Remembers the row a person left, so the list can put keyboard focus back on its title link when they return with the browser's Back or
 * the "Back to ..." link (and not when they reach the list some other way).
 */
@Injectable({ providedIn: 'root' })
export class DrillReturn {
  private readonly router = inject(Router);
  private left: Left | null = null;
  /** True when the navigation that is under way (or just done) is a return: browser Back/Forward or the "Back to ..." link. */
  private returning = false;

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe((e) => {
        const state = this.router.currentNavigation()?.extras.state as
          { restoreFocus?: boolean } | undefined;
        this.returning = e.navigationTrigger === 'popstate' || state?.restoreFocus === true;
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
}
