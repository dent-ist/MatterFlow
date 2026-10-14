import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
  ElementRef,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Button } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { AuthStore } from '../../core/auth/auth.store';
import { PendingUsersStore } from '../../core/identity-admin/pending-users.store';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { ADMIN_NAV_ITEMS, NAV_ITEMS, NavItem } from './nav-items';

/** Header (logo, persistent global search, Create Task, user), permission-gated left nav, content outlet. */
@Component({
  selector: 'mf-app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Button, InputText, HasPermissionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly auth = inject(AuthStore);
  protected readonly pendingUsers = inject(PendingUsersStore);
  private readonly router = inject(Router);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');

  protected readonly navItems = computed(() => this.visible(NAV_ITEMS));
  protected readonly adminItems = computed(() => this.visible(ADMIN_NAV_ITEMS));

  constructor() {
    // The pending-access badge needs User.View; load it once the profile (and so the permissions) are known.
    effect(() => {
      if (this.auth.has('User.View')) untracked(() => void this.pendingUsers.refresh());
    });
  }

  private visible(items: NavItem[]): NavItem[] {
    return items.filter((i) => this.auth.hasAny(i.permissions));
  }

  protected search(value: string): void {
    const q = value.trim();
    if (q) void this.router.navigate(['/search'], { queryParams: { q } });
  }

  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main()?.nativeElement.focus();
  }

  protected createTask(): void {
    void this.router.navigate(['/tasks/new']);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.searchInput()?.nativeElement.focus();
    }
  }
}
