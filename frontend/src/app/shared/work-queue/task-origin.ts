import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { RecordOrigin } from './drill';

/**
 * What a link to a task needs on a page that is not a work list (a Matter's or Project's Tasks tab, the Dashboard, Search; T9, #324):
 * `?from=<origin>` so the Task page names where the person came from, and the exact address of this page (filters, tab, query) in the router
 * state `returnTo`, so Back brings them to the same view. The address is read on every navigation, so a link always carries the view as it is.
 *
 *   <a [routerLink]="['/tasks', id]" [queryParams]="origin.params('dashboard')" [state]="origin.state()">
 */
@Injectable({ providedIn: 'root' })
export class TaskOriginLinks {
  private readonly router = inject(Router);
  private readonly here = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** The router state of a task link: the address of the page it is on. */
  readonly state = computed(() => ({ returnTo: this.here() }));

  params(origin: RecordOrigin): { from: RecordOrigin } {
    return PARAMS[origin];
  }
}

const PARAMS: Readonly<Record<RecordOrigin, { from: RecordOrigin }>> = {
  matter: { from: 'matter' },
  project: { from: 'project' },
  dashboard: { from: 'dashboard' },
  search: { from: 'search' },
};
