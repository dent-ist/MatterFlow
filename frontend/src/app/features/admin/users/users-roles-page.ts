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
import { AuthStore } from '../../../core/auth/auth.store';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AdminListShell } from '../../../shared/ui/admin-list-shell';
import { MfTab } from '../../../shared/ui/tabs';
import { AdminShellFilters } from '../task-types/shell-filters';
import { PodsPage } from '../pods/pods-page';
import { RolesPage } from '../roles/roles-page';
import { UsersPage } from './users-page';

type UsersTab = 'users' | 'roles' | 'pods';
const TABS: readonly UsersTab[] = ['users', 'roles', 'pods'];

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
  providers: [AdminShellFilters],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-admin-list-shell
      heading="Users"
      [description]="description()"
      [tabs]="tabs()"
      [tab]="current()"
      tabsLabel="Users, roles and pods"
      idPrefix="users"
      [filters]="current() === 'users' ? (shell.current()?.filters ?? null) : null"
      [controls]="shell.current()?.controls ?? ''"
      [clearAlso]="['q']"
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

  protected readonly tabs = computed<MfTab[]>(() => {
    const tabs: MfTab[] = [];
    if (this.auth.hasAny(['User.View', 'User.Manage'])) tabs.push({ key: 'users', label: 'Users' });
    if (this.auth.has('Role.Manage')) tabs.push({ key: 'roles', label: 'Roles' });
    if (this.auth.hasAny(['Pod.Manage', 'Pod.ManageMembers'])) {
      tabs.push({ key: 'pods', label: 'Pods' });
    }
    return tabs;
  });

  /** One line, 90 characters at most, for the Users tab; Roles and Pods say theirs in the tab itself. */
  protected readonly description = computed(() =>
    this.current() === 'users'
      ? 'Who can sign in, what they can do and who is waiting for access.'
      : '',
  );

  protected readonly current = computed<UsersTab>(() => {
    const wanted = TABS.find((t) => t === this.tab()) ?? 'users';
    const keys = this.tabs().map((t) => t.key);
    return (keys.includes(wanted) ? wanted : (keys[0] ?? wanted)) as UsersTab;
  });

  constructor() {
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
