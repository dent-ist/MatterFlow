import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  ElementRef,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Button } from 'primeng/button';
import { AuthStore } from '../../core/auth/auth.store';
import { PendingUsersStore } from '../../core/identity-admin/pending-users.store';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { SEARCH_TYPES } from '../search/search-meta';
import { GlobalSearch } from '../search/global-search';
import { ADMIN_NAV_ITEMS, NAV_ITEMS, NavItem } from './nav-items';

/** Header (logo, persistent global search, Create Task, user), permission-gated left nav, content outlet. */
@Component({
  selector: 'mf-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Button,
    GlobalSearch,
    HasPermissionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly auth = inject(AuthStore);
  protected readonly pendingUsers = inject(PendingUsersStore);
  private readonly router = inject(Router);
  private readonly globalSearch = viewChild(GlobalSearch);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');

  /** The header search is offered to anyone who may view at least one searchable type. */
  protected readonly canSearch = computed(() =>
    SEARCH_TYPES.some((t) => this.auth.has(t.permission)),
  );
  protected readonly navItems = computed(() => this.visible(NAV_ITEMS));
  protected readonly adminItems = computed(() => this.visible(ADMIN_NAV_ITEMS));

  /** The global "Create task" button is redundant on the Create Task page itself (UXR-23). */
  private readonly url = signal(this.router.url);
  protected readonly onCreateTaskPage = computed(
    () => this.url().split(/[?#]/)[0] === '/tasks/new',
  );

  constructor() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.url.set(e.urlAfterRedirects));
    // The pending-access badge needs User.View; load it once the profile (and so the permissions) are known.
    effect(() => {
      if (this.auth.has('User.View')) untracked(() => void this.pendingUsers.refresh());
    });
  }

  private visible(items: NavItem[]): NavItem[] {
    return items.filter((i) => this.auth.hasAny(i.permissions));
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
      this.globalSearch()?.focus();
    }
  }
}
