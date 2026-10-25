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
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { Button } from 'primeng/button';
import { AuthStore } from '../../core/auth/auth.store';
import { PendingUsersStore } from '../../core/identity-admin/pending-users.store';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { SEARCH_TYPES } from '../search/search-meta';
import { GlobalSearch } from '../search/global-search';
import { landsOnMyMatters } from '../../core/auth/guards';
import { ADMIN_NAV_ITEMS, NAV_GROUPS, NAV_ITEMS, NavItem, compactNav } from './nav-items';
import { originNav, parseOrigin } from '../work-queue/drill';
import { ShortcutHelpState } from './shortcut-help-state';
import { KeyboardShortcuts } from './keyboard-shortcuts';
import { SkipTarget, skipId } from './skip-target';
import { isShortcut } from './shortcut-registry';
import { ShellLayout } from '../ui/fixed-page';
import { UserMenu } from './user-menu';
import { ConnectionBanner } from './connection-banner';
import { NotificationBell } from './notification-bell';
import { NavTip } from './nav-tip';
import { RouteAnnouncer } from './route-announcer';

/**
 * Route data that hides the shell's global "Create task" button because the page's record header has its own, prefilled with the record
 * (Matter and Project records). A route opts in with `data: { hidesGlobalCreateTask: true }`.
 */
export const HIDES_GLOBAL_CREATE_TASK = 'hidesGlobalCreateTask';

/** One block of the navigation: the Work and Records groups, or the single block of the compact menu. */
interface NavSection {
  key: string;
  label: string;
  /** The heading is read by assistive technology only (the compact menu has one block). */
  srOnly: boolean;
  items: NavItem[];
}

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
    ConnectionBanner,
    NotificationBell,
    RouteAnnouncer,
    NavTip,
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
  /** Set while the target page's element carrying the skip id is in the document; the link is drawn only then (#586). */
  private readonly skipPresent = signal(false);
  protected readonly skipHref = computed(() => {
    const def = this.skipTarget.target();
    return def && this.skipPresent() ? '#' + skipId(def) : null;
  });
  /** The shortcut list loads the first time it is opened. */
  protected readonly helpHost = signal<Type<unknown> | null>(null);
  protected readonly navItems = computed(() => this.visible(NAV_ITEMS));
  /**
   * The short menu of a person who lands on My Matters (epic #758, PX-17): My Matters, Matters, Tasks and Assets, with Clients, Projects and My Work
   * in a collapsed "More" group. The rule is the landing test (permissions), not a role name: a System Admin who does not land there keeps the
   * full menu.
   */
  protected readonly compact = computed(() => landsOnMyMatters(this.auth));
  private readonly compactItems = computed(() => compactNav(this.navItems()));
  /** The visible items under their group label (Work, Records); a group with nothing visible is not drawn (S6, #621). */
  protected readonly navGroups = computed((): NavSection[] => {
    if (this.compact()) {
      const items = this.compactItems().main;
      return items.length > 0 ? [{ key: 'main', label: 'Main menu', srOnly: true, items }] : [];
    }
    return NAV_GROUPS.map((g) => ({
      ...g,
      srOnly: false,
      items: this.navItems().filter((i) => i.group === g.key),
    })).filter((g) => g.items.length > 0);
  });
  /** The items of the compact menu's "More" group; empty in the full menu. */
  protected readonly moreItems = computed(() => (this.compact() ? this.compactItems().more : []));
  /** "More" open or closed: remembered per person (a convenience); a page inside the group opens it. */
  protected readonly moreOpen = signal(false);
  private readonly moreKey = computed(() => `mf.nav.more.${this.auth.profile()?.userId ?? 0}`);
  protected readonly adminItems = computed(() => this.visible(ADMIN_NAV_ITEMS));

  /** The global "Create task" button is redundant on the Create Task page itself (UXR-23). */
  private readonly url = signal(this.router.url);
  /** True while the page on screen has `data: { hidesGlobalCreateTask: true }` on its route: its record header has its own (S1, #625). */
  private readonly routeHidesCreate = signal(this.routeFlag());
  protected readonly onCreateTaskPage = computed(
    () => this.url().split(/[?#]/)[0] === '/tasks/new' || this.routeHidesCreate(),
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
        this.routeHidesCreate.set(this.routeFlag());
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
    this.watchSkipTarget();
    // The remembered state of "More" (read again when another person signs in); a page inside the group opens it.
    effect(() => {
      const key = this.moreKey();
      untracked(() => this.moreOpen.set(this.readMore(key)));
    });
    effect(() => {
      if (this.moreItems().some((i) => this.isActive(i))) untracked(() => this.moreOpen.set(true));
    });
    // The pending-access badge needs User.View; load it once the profile (and so the permissions) are known.
    effect(() => {
      if (this.auth.has('User.View')) untracked(() => void this.pendingUsers.refresh());
    });
  }

  /** The route flag `hidesGlobalCreateTask` anywhere on the active route chain (Matter and Project records, #625; Assets can opt in the same way). */
  private routeFlag(): boolean {
    let route: ActivatedRouteSnapshot | null = this.router.routerState.snapshot.root;
    while (route) {
      if (route.data?.[HIDES_GLOBAL_CREATE_TASK] === true) return true;
      route = route.firstChild;
    }
    return false;
  }

  /** Keeps `skipPresent` true exactly while an element with the registered id exists (a page's list region mounts after the page). */
  private watchSkipTarget(): void {
    if (typeof MutationObserver !== 'function') return;
    let frame = 0;
    const check = (): void => {
      frame = 0;
      const def = this.skipTarget.target();
      this.skipPresent.set(!!def && !!document.getElementById(skipId(def)));
    };
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(check);
    });
    // Watched only while a page offers the link.
    effect(() => {
      observer.disconnect();
      if (!this.skipTarget.target()) {
        untracked(() => this.skipPresent.set(false));
        return;
      }
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['id'],
      });
      untracked(check);
    });
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
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

  protected toggleMore(): void {
    const open = !this.moreOpen();
    this.moreOpen.set(open);
    try {
      localStorage.setItem(this.moreKey(), open ? '1' : '0');
    } catch {
      // Not remembering is fine.
    }
  }

  private readMore(key: string): boolean {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
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
        this.auth.hasAny(i.permissions) &&
        (i.permissionsAll ?? []).every((c) => this.auth.has(c)) &&
        (!i.needsDashboardTab || this.auth.hasAnyDashboardTab()),
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
