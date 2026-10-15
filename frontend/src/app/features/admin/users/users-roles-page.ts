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
import { PageHeader } from '../../../shared/ui/page-header';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { RolesPage } from '../roles/roles-page';
import { UsersPage } from './users-page';

type UsersTab = 'users' | 'roles';

/**
 * Administration: Users. Two tabs, Users (User.View / User.Manage) and Roles (Role.Manage), kept in the address: `/admin/users` and
 * `/admin/roles` open the matching tab. A tab the person may not use is not offered, and a link to it lands on the other one.
 * Leaving the Roles tab with an unsaved role edit asks first (the route's leave guard).
 */
@Component({
  selector: 'mf-users-roles-page',
  imports: [PageHeader, Tabs, UsersPage, RolesPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-page-header heading="Users" />
    <mf-tabs
      label="Users and roles"
      idPrefix="users"
      [tabs]="tabs()"
      [selected]="current()"
      (tabChange)="select($event)"
    />
    <div role="tabpanel" id="users-panel" [attr.aria-labelledby]="'users-tab-' + current()">
      @if (current() === 'users') {
        <mf-users-page />
      } @else {
        <mf-roles-page #roles />
      }
    </div>
  `,
})
export class UsersRolesPage implements HasUnsavedChanges {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly roles = viewChild<RolesPage>('roles');

  /** The `:tab` path segment (`users` or `roles`). */
  readonly tab = input<string>();

  protected readonly tabs = computed<MfTab[]>(() => {
    const tabs: MfTab[] = [];
    if (this.auth.hasAny(['User.View', 'User.Manage'])) tabs.push({ key: 'users', label: 'Users' });
    if (this.auth.has('Role.Manage')) tabs.push({ key: 'roles', label: 'Roles' });
    return tabs;
  });

  protected readonly current = computed<UsersTab>(() => {
    const wanted = this.tab() === 'roles' ? 'roles' : 'users';
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
    return this.roles()?.hasUnsavedChanges() ?? false;
  }

  protected select(key: string): void {
    void this.router.navigate(['/admin', key]);
  }
}
