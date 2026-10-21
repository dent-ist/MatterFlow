import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, UrlTree } from '@angular/router';
import { filter, map } from 'rxjs';
import { originUrl } from '../../shared/work-queue/drill';
import { Crumb } from '../../shared/ui/page-header';
import { RETURN_STATE } from '../../shared/ui/row-nav';

/** The ids of the Administration lists with record pages in `data-row-list` and `DrillReturn` (#354), and the address of each. */
export const ADMIN_LIST = {
  taskTypes: { id: 'admin-task-types', path: '/admin/task-types' },
  workflows: { id: 'admin-workflows', path: '/admin/workflows' },
  steps: { id: 'admin-steps', path: '/admin/steps' },
  assetTypes: { id: 'admin-asset-types', path: '/admin/asset-types' },
  customFields: { id: 'admin-custom-fields', path: '/admin/custom-fields' },
} as const;

export type AdminList = (typeof ADMIN_LIST)[keyof typeof ADMIN_LIST];

/**
 * The router state of a link that leaves one of the admin lists (#354): the exact address of the list (page, size, filters, sort) in `returnTo`.
 * The address is read on every navigation, so a link always carries the view as it is (the same rule as the task links, `TaskOriginLinks`).
 *
 *   <a [routerLink]="['/admin/steps', id]" mfRowLink="admin-steps" [rowKey]="id" [state]="leave.state()">
 */
@Injectable({ providedIn: 'root' })
export class AdminListLeave {
  private readonly router = inject(Router);
  private readonly here = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly state = computed(() => ({ returnTo: this.here() }));
}

/** The `returnTo` of the history entry the page was opened with, read once (a pasted address or a reload of a foreign one has none). */
function openedWith(): unknown {
  try {
    return (history.state as { returnTo?: unknown } | null)?.returnTo;
  } catch {
    return undefined;
  }
}

/**
 * Where a record page of an admin list goes back to (#354, decision PM: the address is read once when the page opens and carried in router
 * state, as on the Task page): the exact list view the person left, or the plain list when the page was opened any other way. Only an address
 * on the list's own path counts, so a return address from another section is ignored. Create one in a page's field initialisers.
 *
 *   private readonly back = new ListReturn(ADMIN_LIST.steps, inject(Router));
 *   crumbs: [..., this.back.crumb('Workflow Steps'), ...]     links that go on to another page of the record:  [state]="back.carry"
 */
export class ListReturn {
  /** The exact address of the list, or its plain path. */
  readonly url: string;
  /**
   * The state that carries the page's origin on to the next page of the record: the list address (when it is not the plain list) and
   * `keepRow`, which asks `DrillReturn` to keep the row that was left, so a breadcrumb two pages deep (list, record, form designer)
   * still puts focus back on the row (#354).
   */
  readonly carry: { returnTo?: string; keepRow: true };

  constructor(
    list: Pick<AdminList, 'path'>,
    private readonly router: Router,
  ) {
    this.url = originUrl([list.path], list.path, openedWith());
    this.carry = this.url === list.path ? { keepRow: true } : { returnTo: this.url, keepRow: true };
  }

  get tree(): UrlTree {
    return this.router.parseUrl(this.url);
  }

  /** The list's step of a breadcrumb: the exact view, and a request to put focus back on the row that was left. */
  crumb(label: string): Crumb {
    return { label, link: this.tree, state: { ...RETURN_STATE } };
  }

  /** Router extras for `router.navigate` that carry the address on. */
  get extras(): { state: { returnTo?: string; keepRow: true } } {
    return { state: this.carry };
  }
}
