import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injectable,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';

/**
 * Fixed-header grid pages (UX "fixed header"): the page title, tabs, search and control buttons stay where they are and ONLY the grid
 * scrolls, with sticky column headers and a pager pinned underneath.
 *
 *   <mf-fixed-page>                                  height: 100% of the shell's main area, a flex column; never scrolls itself
 *     <mf-page-header .../>  tabs  toolbar           anything outside the scroll area is pinned
 *     <div mfScrollArea="Clients list" ...>table</div>   the one scrolling region: focusable `role="region"`, sticky `thead th`
 *     <mf-pager/>                                    pinned bottom bar
 *   </mf-fixed-page>
 *
 * The fixed layout needs room: below 768 px wide, below 560 px high or at a browser zoom that leaves less than that (200% zoom of a
 * 1366x768 screen is 683x384 CSS px), the page scrolls normally and nothing is pinned, so reflow and zoom (WCAG 1.4.10) keep working.
 * The breakpoints live in `styles/_fixed-page.scss` ("FIXED_MODE") and in `FIXED_MODE_QUERY` below, which must agree.
 *
 * The Dashboard uses it too (fixed height, #137; only regions inside each tab scroll), and so does the workflow version page (VP1, #393: the header and the action bar stay, the panes scroll) and the form designer (FD1, #407: the header and the action bar stay; Add a field, Fields and the details column scroll inside themselves). Create Task, the edit and create forms, the task detail page and the system pages do NOT use it.
 */
/** How long after Back/Forward a grid that is created late (its data arrives first) still gets its old position back. */
const RESTORE_WINDOW_MS = 5000;

/** Input that means the person is scrolling themselves: a pending restore must not fight them. */
const USER_INPUT = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;

export const FIXED_MODE_QUERY = '(min-width: 768px) and (min-height: 561px)';

/** Which screens currently show a fixed page; the app shell stops scrolling its main area while one is on screen. */
@Injectable({ providedIn: 'root' })
export class ShellLayout {
  private readonly count = signal(0);
  /** True while at least one `mf-fixed-page` is on screen (a counter, so a page that replaces another during navigation is safe). */
  readonly fixed = computed(() => this.count() > 0);

  /** Registers a fixed page; call the returned function when it goes away. */
  register(): () => void {
    this.count.update((n) => n + 1);
    return () => this.count.update((n) => Math.max(0, n - 1));
  }
}

@Component({
  selector: 'mf-fixed-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-fixed-page': '',
    '[attr.data-scrolled]': 'scrolled() ? "" : null',
  },
  template: `<ng-content />`,
  styles: `
    :host {
      display: block;
    }
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        display: flex;
        flex-direction: column;
        flex: 1 1 0;
        height: 100%;
        min-height: 0;
      }
    }
  `,
})
export class FixedPage {
  /** True once the grid under the pinned area has scrolled (drives the shadows). */
  readonly scrolled = signal(false);

  constructor() {
    const unregister = inject(ShellLayout).register();
    inject(DestroyRef).onDestroy(unregister);
  }
}

/**
 * Remembers where each grid was scrolled, per address, so Back and Forward put it back (UX "fixed header"). Only a Back/Forward
 * navigation restores; every other navigation starts at the top. It is a small in-memory map: a reload starts at the top again.
 */
@Injectable({ providedIn: 'root' })
export class ScrollMemory {
  private readonly router = inject(Router);
  private readonly tops = new Map<string, number>();
  private popstate = false;
  /** The address a Back/Forward navigation has just arrived at: a grid that is created a little later (once its data is there) restores too. */
  private arrived: { key: string; until: number } | null = null;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.popstate = e.navigationTrigger === 'popstate';
        this.arrived = null;
      } else if (e instanceof NavigationEnd) {
        if (this.popstate)
          this.arrived = { key: this.key(), until: Date.now() + RESTORE_WINDOW_MS };
        // Cleared after the listeners of this very event have run (a grid asks while the navigation ends).
        queueMicrotask(() => (this.popstate = false));
      } else if (e instanceof NavigationCancel || e instanceof NavigationError) {
        this.popstate = false;
      }
    });
  }

  /** True while a Back/Forward navigation is the one that is showing the page. */
  get restoring(): boolean {
    return this.popstate;
  }

  /** Where to put a grid at `key` right now: the remembered position during or just after a Back/Forward navigation to it, else 0. */
  restoreTop(key: string): number {
    if (this.popstate) return this.saved(key);
    const a = this.arrived;
    return a !== null && a.key === key && Date.now() < a.until ? this.saved(key) : 0;
  }

  key(): string {
    return typeof location === 'undefined' ? '' : location.pathname + location.search;
  }

  save(key: string, top: number): void {
    if (top > 0) this.tops.set(key, top);
    else this.tops.delete(key);
    if (this.tops.size > 200) this.tops.delete(this.tops.keys().next().value as string);
  }

  saved(key: string): number {
    return this.tops.get(key) ?? 0;
  }
}

/** True when two addresses (path and query) differ at most in the query parameters named in `ignore` (never true when `ignore` is empty). */
export function sameListAddress(a: string, b: string, ignore: readonly string[]): boolean {
  if (ignore.length === 0) return false; // every navigation of an ordinary list starts at the top
  const strip = (address: string): string => {
    const at = address.indexOf('?');
    if (at < 0) return address;
    const params = new URLSearchParams(address.slice(at + 1));
    for (const name of ignore) params.delete(name);
    const rest = params.toString();
    return rest ? `${address.slice(0, at)}?${rest}` : address.slice(0, at);
  };
  return strip(a) === strip(b);
}

/**
 * The scrolling region of a fixed page: a focusable `role="region"` with an accessible name ("Task list, scrollable") so keyboard users
 * can scroll it, sticky table column headers (see `styles/_fixed-page.scss`), horizontal scrolling inside the same box (the headers
 * scroll sideways with the columns) and `scroll-padding-top` so a focused row is never hidden under the sticky header.
 *
 * It returns to the top when the list changes (every page, sort, filter and tab change is a navigation; `resetKey` covers a list
 * that changes without one), and restores the old position on Back/Forward. Inline edits keep the position.
 */
@Directive({
  selector: '[mfScrollArea]',
  host: {
    class: 'mf-scroll-area',
    '[attr.role]': 'focusable() ? "region" : null',
    '[attr.tabindex]': 'focusable() ? 0 : null',
    '[attr.aria-label]': 'focusable() ? name() : null',
    '[attr.data-scrolled]': 'scrolled() ? "" : null',
    '(scroll)': 'onScroll()',
  },
})
export class ScrollArea {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly router = inject(Router);
  private readonly memory = inject(ScrollMemory);
  private readonly page = inject(FixedPage, { optional: true });

  /** What the grid is ("Task list"): the region is named "<label>, scrollable". */
  readonly mfScrollArea = input('List');
  /** Anything that changes with the shown list but not with the address; a change scrolls back to the top. */
  readonly resetKey = input<unknown>(undefined);
  /**
   * Query parameters that do not change the list (the selected row of a master-detail screen): a navigation that changes only these
   * keeps the scroll position instead of returning to the top.
   */
  readonly keepOn = input<readonly string[]>([]);

  /**
   * A short list inside a page that scrolls as a whole (the My Matters grids, issue #937): the region is a Tab stop only while the box really scrolls, like `mfScrollRegion`,
   * so a grid that fits adds no empty stop to the keyboard order. Off (the default): always a focusable region, as the fixed pages need.
   */
  readonly whileScrolling = input(false);

  protected readonly name = computed(() => `${this.mfScrollArea() || 'List'}, scrollable`);
  protected readonly scrolled = signal(false);
  private readonly overflowing = signal(false);
  protected readonly focusable = computed(() => !this.whileScrolling() || this.overflowing());

  private key = this.memory.key();
  private lastUrl = this.router.url;
  private observer: MutationObserver | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.restore(this.memory.restoreTop(this.key));

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (!this.whileScrolling()) return;
      const measure = (): void =>
        this.overflowing.set(
          this.el.scrollHeight > this.el.clientHeight + 1 ||
            this.el.scrollWidth > this.el.clientWidth + 1,
        );
      measure();
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
      resize?.observe(this.el);
      const content = new MutationObserver(measure);
      content.observe(this.el, { childList: true, subtree: true, characterData: true });
      window.addEventListener('resize', measure);
      destroyRef.onDestroy(() => {
        resize?.disconnect();
        content.disconnect();
        window.removeEventListener('resize', measure);
      });
    });

    this.router.events.pipe(takeUntilDestroyed()).subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      const previous = this.lastUrl;
      this.lastUrl = e.urlAfterRedirects;
      this.key = this.memory.key();
      if (this.memory.restoring) this.restore(this.memory.saved(this.key));
      else if (!sameListAddress(previous, this.lastUrl, this.keepOn())) this.toTop();
    });

    let first = true;
    effect(() => {
      this.resetKey();
      if (first) {
        first = false;
        return;
      }
      untracked(() => this.toTop());
    });

    inject(DestroyRef).onDestroy(() => {
      this.stopRestoring();
      this.page?.scrolled.set(false);
    });
  }

  protected onScroll(): void {
    const top = this.el.scrollTop;
    const scrolled = top > 0;
    if (scrolled !== this.scrolled()) {
      this.scrolled.set(scrolled);
      this.page?.scrolled.set(scrolled);
    }
    this.memory.save(this.key, top);
  }

  private toTop(): void {
    this.stopRestoring();
    this.el.scrollTop = 0;
    this.el.scrollLeft = 0;
  }

  /** Scrolls to `top` as soon as the rows are tall enough (they arrive after the page is created); gives up on any user input. */
  private restore(top: number): void {
    this.stopRestoring();
    if (top <= 0) {
      this.el.scrollTop = 0;
      return;
    }
    const apply = (): boolean => {
      if (this.el.scrollHeight - this.el.clientHeight < top) return false;
      this.el.scrollTop = top;
      return true;
    };
    if (apply() || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver(() => {
      if (apply()) this.stopRestoring();
    });
    this.observer.observe(this.el, { childList: true, subtree: true });
    this.stopTimer = setTimeout(() => this.stopRestoring(), 4000);
    for (const type of USER_INPUT)
      this.el.addEventListener(type, this.onUserInput, { passive: true });
  }

  private readonly onUserInput = (): void => this.stopRestoring();

  private stopRestoring(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    for (const type of USER_INPUT) this.el.removeEventListener(type, this.onUserInput);
  }
}
