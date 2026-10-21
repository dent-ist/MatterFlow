import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PodsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { MfTab } from '../../../shared/ui/tabs';
import { AdminTab, AdminTabCounts, adminTabItems, resolveAdminTab } from '../admin-tabs';
import { AdminShellFilters } from '../task-types/shell-filters';
import { PodsPage } from '../pods/pods-page';
import { RolesPage } from '../roles/roles-page';
import { UsersPage } from './users-page';

type UsersTab = 'users' | 'roles' | 'pods';

/** The three tabs, each with the permissions that open it and the key of its count (#430). */
export const USERS_TABS: readonly AdminTab[] = [
  {
    id: 'users',
    label: 'Users',
    route: '/admin/users',
    permission: ['User.View', 'User.Manage'],
    countKey: 'users',
  },
  {
    id: 'roles',
    label: 'Roles',
    route: '/admin/roles',
    permission: ['Role.Manage'],
    countKey: 'roles',
  },
  {
    id: 'pods',
    label: 'Pods',
    route: '/admin/pods',
    permission: ['Pod.Manage', 'Pod.ManageMembers'],
    countKey: 'pods',
  },
];

/**
 * Administration: Users. Three tabs, Users (User.View / User.Manage), Roles (Role.Manage) and Pods (Pod.Manage / Pod.ManageMembers), kept
 * in the address: `/admin/users`, `/admin/roles` and `/admin/pods` open the matching tab. A tab the person may not use is not offered,
 * and a link to it lands on the first one they may use. Leaving the Roles or Pods tab with an unsaved edit asks first (the route's
 * leave guard). The Pods tab is a nested component, so the list state and the open pod editor of the address (`status`, `page`,
 * `size`, `sort`, `pod`) are bound here and handed down.
 */
@Component({
  selector: 'mf-users-roles-page',
  imports: [AdminListShell, UsersPage, RolesPage, PodsPage],
  providers: [AdminShellFilters, AdminTabCounts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Users"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Users, roles and pods"
      idPrefix="users"
      [filters]="shell.current()?.filters ?? null"
      [controls]="shell.current()?.controls ?? ''"
      [clearAlso]="['q']"
      [bare]="editingPod()"
      (tabChange)="select($event)"
    >
      @if (current() === 'users') {
        <mf-users-page />
      } @else if (current() === 'roles') {
        <mf-roles-page #roles />
      } @else {
        <mf-pods-page
          #pods
          [pod]="pod()"
          [status]="status()"
          [page]="page()"
          [size]="size()"
          [sort]="sort()"
        />
      }
    </mf-admin-list-shell>
  `,
})
export class UsersRolesPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  protected readonly shell = inject(AdminShellFilters);
  private readonly router = inject(Router);
  private readonly counts = inject(AdminTabCounts);
  private readonly identityApi = inject(IdentityAdminApi);
  private readonly podsApi = inject(PodsClient);
  private readonly can = (permission: string) => this.auth.has(permission);
  private readonly roles = viewChild<RolesPage>('roles');
  private readonly pods = viewChild<PodsPage>('pods');

  /** The `:tab` path segment (`users`, `roles` or `pods`). */
  readonly tab = input<string>();
  /** Query parameters of the Pods tab (its list state and the open pod editor), handed to it. */
  readonly pod = input<string>();
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  /** Only the tabs the person may use, with the number of active records in the name: `Users (62)`, `Roles (7)`, `Pods (5)` (`--` while unknown). */
  protected readonly tabs = computed<MfTab[]>(() =>
    adminTabItems(USERS_TABS, this.can, this.counts.snapshot()),
  );

  /** One line, 90 characters at most, for the Users tab; Roles and Pods say theirs in the tab itself. */
  protected readonly description = computed(() =>
    this.current() === 'users'
      ? 'Who can sign in, what they can do and who is waiting for access.'
      : '',
  );

  /** A pod's editor is a record page: the Users header and tabs give way to the record header (Administration > Users > Pods > name). */
  protected readonly editingPod = computed(() => this.current() === 'pods' && !!this.pod());

  protected readonly current = computed<UsersTab>(
    () => (resolveAdminTab(USERS_TABS, this.tab(), this.can)?.id as UsersTab) ?? 'users',
  );

  constructor() {
    // The numbers are quiet background requests (a failure shows `--`, no toast). The open tab reports its own number after each load.
    void this.counts.start(
      USERS_TABS,
      {
        // People who can sign in: waiting for access or active (the Inactive segment is not counted).
        users: () =>
          firstValueFrom(this.identityApi.userCounts()).then((c) => c.pending + c.active),
        roles: () => firstValueFrom(this.identityApi.listRoles()).then((r) => r.length),
        pods: () =>
          firstValueFrom(this.podsApi.listPods(undefined, undefined, true, 1, 1)).then(
            (r) => r.total,
          ),
      },
      this.can,
    );
    // A deep link to a tab the person may not use is replaced by the one they may.
    effect(() => {
      const current = this.current();
      if (this.tab() && this.tab() !== current) {
        void this.router.navigate(['/admin', current], { replaceUrl: true });
      }
    });
  }

  hasUnsavedChanges(): boolean {
    return (
      (this.roles()?.hasUnsavedChanges() ?? false) || (this.pods()?.hasUnsavedChanges() ?? false)
    );
  }

  protected select(key: string): void {
    void this.router.navigate(['/admin', key]);
  }
}
