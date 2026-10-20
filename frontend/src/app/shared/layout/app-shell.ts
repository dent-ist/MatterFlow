import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  DestroyRef,
  viewChild,
  ElementRef,
  Type,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Button } from 'primeng/button';
import { AuthStore } from '../../core/auth/auth.store';
import { PendingUsersStore } from '../../core/identity-admin/pending-users.store';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { SEARCH_TYPES } from '../search/search-meta';
import { GlobalSearch } from '../search/global-search';
import { ADMIN_NAV_ITEMS, NAV_ITEMS, NavItem } from './nav-items';
import { originNav, parseOrigin } from '../work-queue/drill';
import { ShortcutHelpState } from './shortcut-help-state';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { SkipTarget } from './skip-target';
import { isShortcut } from './shortcut-registry';
import { ShellLayout } from '../ui/fixed-page';
import { UserMenu } from './user-menu';

/** Phones: below this width the navigation rail collapses behind the Menu button (PM decision, #164). */
const PHONE_QUERY = '(max-width: 639px)';

/** Header (logo, persistent global search, Create Task, user), permission-gated left nav, content outlet. */
@Component({
  selector: 'mf-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    Button,
    GlobalSearch,
    HasPermissionDirective,
    NgComponentOutlet,
    UserMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '[class.mf-shell--fixed]': 'layout.fixed()',
  },
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly auth = inject(AuthStore);
  protected readonly pendingUsers = inject(PendingUsersStore);
  /** True while a fixed-header grid page is on screen: the main area then does not scroll (only the grid does). */
  protected readonly layout = inject(ShellLayout);
  private readonly router = inject(Router);
  private readonly globalSearch = viewChild(GlobalSearch);
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');
  private readonly nav = viewChild<ElementRef<HTMLElement>>('nav');
  private readonly menuButton = viewChild<ElementRef<HTMLElement>>('menuButton');
  private readonly searchButton = viewChild<ElementRef<HTMLElement>>('searchButton');

  /** Phones (below 640 px): the navigation is an overlay panel opened by the Menu button (#164). From 640 px the rail is always shown. */
  protected readonly menuOpen = signal(false);
  /** Phones: the search field sits in its own row under the header, opened by the search icon. */
  protected readonly searchOpen = signal(false);

  /** The header search is offered to anyone who may view at least one searchable type. */
  protected readonly canSearch = computed(() =>
    SEARCH_TYPES.some((t) => this.auth.has(t.permission)),
  );
  private readonly help = inject(ShortcutHelpState);
  private readonly shortcuts = inject(KeyboardShortcuts);
  /** Set while a page offers a first stop of its own ("Skip to task list" on the work pages, #181). */
  protected readonly skipTarget = inject(SkipTarget);
  /** The shortcut list loads the first time it is opened. */
  protected readonly helpHost = signal<Type<unknown> | null>(null);
  protected readonly navItems = computed(() => this.visible(NAV_ITEMS));
  protected readonly adminItems = computed(() => this.visible(ADMIN_NAV_ITEMS));

  /** The global "Create task" button is redundant on the Create Task page itself (UXR-23). */
  private readonly url = signal(this.router.url);
  protected readonly onCreateTaskPage = computed(
    () => this.url().split(/[?#]/)[0] === '/tasks/new',
  );

  constructor() {
    this.shortcuts.listGoShortcuts();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        this.url.set(e.urlAfterRedirects);
        // Choosing an item closes the panel; focus goes to the page (the router's own focus handling), not back to the button.
        this.menuOpen.set(false);
        this.searchOpen.set(false);
      });
    // Growing the window past the phone breakpoint dissolves the overlay.
    if (typeof matchMedia === 'function') {
      const phone = matchMedia(PHONE_QUERY);
      const onChange = (): void => {
        if (!phone.matches) {
          this.menuOpen.set(false);
          this.searchOpen.set(false);
        }
      };
      phone.addEventListener?.('change', onChange);
      inject(DestroyRef).onDestroy(() => phone.removeEventListener?.('change', onChange));
    }
    // The pending-access badge needs User.View; load it once the profile (and so the permissions) are known.
    effect(() => {
      if (this.auth.has('User.View')) untracked(() => void this.pendingUsers.refresh());
    });
  }

  protected toggleMenu(): void {
    if (this.menuOpen()) {
      this.closeMenu(true);
      return;
    }
    this.searchOpen.set(false);
    this.menuOpen.set(true);
    // Focus moves into the panel once it is shown: the current item, else the first link.
    setTimeout(() => {
      const nav = this.nav()?.nativeElement;
      const target =
        nav?.querySelector<HTMLElement>('a[aria-current="page"], a.mf-active') ??
        nav?.querySelector<HTMLElement>('a');
      target?.focus();
    });
  }

  protected closeMenu(restoreFocus: boolean): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    if (restoreFocus) this.menuButton()?.nativeElement.focus();
  }

  protected toggleSearch(): void {
    const open = !this.searchOpen();
    this.searchOpen.set(open);
    if (open) {
      this.menuOpen.set(false);
      setTimeout(() => this.globalSearch()?.focus());
    }
  }

  /** Focus trap while the phone panel is open: Tab and Shift+Tab cycle through the panel's own controls. */
  private trapTab(event: KeyboardEvent): void {
    const nav = this.nav()?.nativeElement;
    if (!nav) return;
    const items = Array.from(nav.querySelectorAll<HTMLElement>('a[href], button'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected toggleHelp(): void {
    const open = !this.help.open();
    if (open && !this.helpHost()) {
      void import('./shortcut-help').then((m) => {
        this.helpHost.set(m.ShortcutHelp);
        this.help.open.set(true);
      });
      return;
    }
    this.help.open.set(open);
  }

  /** A task opened from a list (`/tasks/12?from=my-work`) keeps that list's item current, not Task Queue (M7). */
  protected isActive(item: NavItem): boolean {
    const [path, query] = this.url().split('#')[0].split('?');
    const from =
      /^\/tasks\/[^/]+$/.test(path) && path !== '/tasks/new'
        ? parseOrigin(new URLSearchParams(query ?? '').get('from'))
        : null;
    // From a Matter's or Project's Tasks tab, the Dashboard or Search the page they came from stays current (Search is not in the menu).
    if (from) return item.path === originNav(from);
    return path === item.path || path.startsWith(item.path + '/');
  }

  /** An Administration item is current on its own path and on the paths of its other tabs (and below them). */
  protected isAdminActive(item: NavItem): boolean {
    const path = this.url().split(/[?#]/)[0];
    return [item.path, ...(item.alsoActive ?? [])].some(
      (p) => path === p || path.startsWith(p + '/'),
    );
  }

  private visible(items: NavItem[]): NavItem[] {
    return items.filter(
      (i) =>
        this.auth.hasAny(i.permissions) && (!i.needsDashboardTab || this.auth.hasAnyDashboardTab()),
    );
  }

  protected skipToList(event: Event): void {
    event.preventDefault();
    this.skipTarget.target()?.focus();
  }

  protected skipToMain(event: Event): void {
    event.preventDefault();
    this.main()?.nativeElement.focus();
  }

  protected createTask(): void {
    void this.router.navigate(['/tasks/new']);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Tab' && this.menuOpen()) {
      this.trapTab(event);
      return;
    }
    if (event.key === 'Escape' && this.menuOpen()) {
      event.preventDefault();
      this.closeMenu(true);
      return;
    }
    if (
      event.key === 'Escape' &&
      this.searchOpen() &&
      !document.querySelector('[data-search-panel]')
    ) {
      this.searchOpen.set(false);
      this.searchButton()?.nativeElement.focus();
      return;
    }
    if (this.shortcuts.handleGo(event)) return;
    if (isShortcut('help', event) && this.shortcuts.enabled()) {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      // Not while typing, and not on top of another dialog (the help itself closes with the same key).
      const otherDialog = !this.help.open() && !!document.querySelector('.p-dialog');
      if (!typing && !otherDialog) {
        event.preventDefault();
        this.toggleHelp();
      }
      return;
    }
    if (isShortcut('search', event)) {
      event.preventDefault();
      this.globalSearch()?.focus();
    }
  }
}
