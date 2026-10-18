import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TaskQueueViewCounts } from '../../api/generated/api-client';
import { LIST_ORDER } from '../../features/dashboard/dashboard-links';
import { FilterPopover } from '../filters/filter-popover';
import { normalizeColumns } from './column-prefs';
import {
  BuiltInView,
  BuiltInViewKey,
  MORE_VIEW,
  QueueFilters,
  SortDirection,
  ViewContext,
  availableViews,
  matchBuiltIn,
} from './queue-filters';
import { VIEW_TIPS } from './work-vocabulary';

/**
 * The order a quick view starts with (#219): the view is its filters, this sort and its column overlay. `null` keeps the page's default
 * order. Unassigned and Overdue read the Dashboard's `LIST_ORDER`, so a Dashboard "View all" and the quick view of the same name list the
 * same rows in the same order.
 */
export const VIEW_ORDER: Readonly<
  Record<BuiltInViewKey, { sort: string; dir: SortDirection } | null>
> = {
  allOpen: null,
  unassigned: { sort: LIST_ORDER.unassigned.sort, dir: LIST_ORDER.unassigned.dir },
  myPod: null,
  createdByMe: null,
  overdue: { sort: LIST_ORDER.overdue.sort, dir: LIST_ORDER.overdue.dir },
  // The Dashboard's Due soon list: soonest first.
  dueSoon: { sort: LIST_ORDER.dueSoon.sort, dir: LIST_ORDER.dueSoon.dir },
  // ASAP and On hold keep the default order (priority, then oldest): every row has the same Due text or none.
  asap: null,
  onHold: null,
  recentlyCompleted: { sort: 'closed', dir: 'desc' },
};

/** A view's column overlay: a suggestion shown while the view is active, never stored (the user's saved set stays as it is). */
export interface ColumnOverlay {
  remove: readonly string[];
  add: readonly string[];
  /** The Columns panel's note ("Recently completed shows Closed instead of Due"). */
  note: string;
}

export const VIEW_OVERLAY: Readonly<Partial<Record<BuiltInViewKey, ColumnOverlay>>> = {
  recentlyCompleted: {
    remove: ['due'],
    add: ['closed'],
    note: 'Recently completed shows Closed instead of Due.',
  },
};

/** The columns a view shows: the user's set with the view's overlay applied; the same set when the view has none. */
export function overlayColumns(columns: readonly string[], key: BuiltInViewKey | null): string[] {
  const overlay = key ? VIEW_OVERLAY[key] : undefined;
  if (!overlay) return [...columns];
  return normalizeColumns([...columns.filter((c) => !overlay.remove.includes(c)), ...overlay.add]);
}

/** The size of a quick view from the response's `views` block; null while loading, and for My pod without a primary Pod. */
export function viewCount(key: BuiltInViewKey, counts: TaskQueueViewCounts | null): number | null {
  if (!counts) return null;
  switch (key) {
    case 'allOpen':
      return counts.open;
    case 'unassigned':
      return counts.unassigned;
    case 'myPod':
      return counts.myPod ?? null;
    case 'createdByMe':
      return counts.createdByMe;
    case 'overdue':
      return counts.overdue;
    case 'dueSoon':
      return counts.dueSoon;
    case 'asap':
      return counts.asap;
    case 'onHold':
      return counts.onHold;
    case 'recentlyCompleted':
      return counts.recentlyCompleted;
  }
}

/** The width the strip reserves for a button that has not been measured yet. */
const GUESS_WIDTH = 110;
/** The gap between two buttons of the strip. */
const STRIP_GAP = 4;

/**
 * The Task Queue's quick views as presets: choosing one writes its column filters (they can still be changed one by one); a view that
 * does not fit the toolbar's first line moves, last first, into the "More" menu, which always holds Recently completed (#220). Row 1 never
 * wraps because of the views: the strip measures the room the other buttons leave and shows as many views as fit.
 */
@Component({
  selector: 'mf-quick-views',
  imports: [FilterPopover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qv" role="group" aria-label="Quick views" #strip>
      @for (view of shown(); track view.key) {
        <button
          type="button"
          class="qv-view"
          [attr.aria-pressed]="active() === view.key"
          [attr.data-view]="view.key"
          [attr.data-count]="count(view.key)"
          [attr.aria-label]="name(view)"
          [attr.title]="tip(view.key)"
          (click)="viewSelect.emit(view.key)"
        >
          {{ view.label }}
          @if (hasCount(view.key)) {
            @if (count(view.key) === null) {
              <span class="qv-n qv-n--pending" data-count-pending aria-hidden="true">--</span>
            } @else {
              <span class="qv-n" [class.qv-n--zero]="count(view.key) === 0" aria-hidden="true">{{
                format(count(view.key))
              }}</span>
            }
          }
        </button>
      }
      <button
        #moreButton
        type="button"
        class="qv-view qv-more"
        data-more-views
        aria-haspopup="dialog"
        [attr.aria-expanded]="menuOpen()"
        [attr.aria-pressed]="moreActive() ? true : null"
        [attr.data-view-in-more]="moreActive()?.key ?? null"
        [attr.data-count]="moreActive() ? count(moreActive()!.key) : null"
        [attr.aria-label]="moreActive() ? name(moreActive()!) : 'More views'"
        [attr.title]="moreActive() ? tip(moreActive()!.key) : 'More views'"
        (click)="toggleMenu()"
      >
        {{ moreActive()?.label ?? 'More' }}
        @if (moreActive(); as pressed) {
          @if (count(pressed.key) !== null) {
            <span class="qv-n" [class.qv-n--zero]="count(pressed.key) === 0" aria-hidden="true">{{
              format(count(pressed.key))
            }}</span>
          }
        }
        <i class="pi pi-chevron-down qv-chevron" aria-hidden="true"></i>
      </button>
    </div>
    @if (menuOpen()) {
      <mf-filter-popover [anchor]="moreButton" label="More views" (closed)="menuOpen.set(false)">
        <ul class="qv-menu" data-more-menu>
          @for (view of menu(); track view.key) {
            <li>
              <button
                type="button"
                class="qv-item"
                [attr.aria-pressed]="active() === view.key"
                [attr.data-view]="view.key"
                [attr.data-count]="count(view.key)"
                [attr.aria-label]="name(view)"
                [attr.title]="tip(view.key)"
                (click)="choose(view.key)"
              >
                <span>{{ view.label }}</span>
                @if (hasCount(view.key) && count(view.key) !== null) {
                  <span
                    class="qv-n"
                    [class.qv-n--zero]="count(view.key) === 0"
                    aria-hidden="true"
                    >{{ format(count(view.key)) }}</span
                  >
                }
              </button>
            </li>
          }
        </ul>
      </mf-filter-popover>
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      /* Left in the bar whatever wraps: the rest of the bar is right aligned. */
      margin-right: auto;
    }
    /* Never wraps: what does not fit goes into the More menu (the strip measures the room, see measure()). */
    .qv {
      display: flex;
      flex-wrap: nowrap;
      gap: 4px;
    }
    .qv-view {
      min-height: var(--mf-row-h-compact);
      padding: 0 5px;
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      white-space: nowrap;
      cursor: pointer;
    }
    /* The strip's number: tabular digits and room for three bold digits (2em, measured: "139" is 1.94em), so the count replaces "--" without moving the next button (and row 1 stays one line at 1366). */
    .qv-n {
      display: inline-block;
      min-width: 2em;
      margin-left: 2px;
      color: var(--mf-text);
      font-size: 0.9em;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .qv-n--zero,
    .qv-n--pending {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .qv-view[aria-pressed='true'] .qv-n:not(.qv-n--zero),
    .qv-item[aria-pressed='true'] .qv-n:not(.qv-n--zero) {
      color: inherit;
    }
    .qv-view[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
    }
    .qv-chevron {
      margin-left: 4px;
      font-size: 0.7em;
    }
    .qv-menu {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .qv-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: 32px;
      padding: 0 var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .qv-item:hover {
      background: var(--mf-surface-alt);
    }
    .qv-item[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      color: var(--mf-primary);
    }
    @media print {
      :host {
        display: none;
      }
    }
  `,
})
export class QuickViews {
  readonly filters = input.required<QueueFilters>();
  readonly context = input.required<ViewContext>();
  /**
   * The counts of the response (`views`), null while loading: shown in each button (`--` while null), also as `data-count`. They are
   * not narrowed by the filters, so they stay the same while a filter is edited.
   */
  readonly counts = input<TaskQueueViewCounts | null>(null);
  readonly viewSelect = output<BuiltInViewKey>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly strip = viewChild<ElementRef<HTMLElement>>('strip');
  protected readonly menuOpen = signal(false);

  /** The views of the row that this viewer is offered, without the one that always sits in More. */
  private readonly main = computed(() =>
    availableViews(this.context()).filter((v) => v.key !== MORE_VIEW),
  );
  /** How many of them fit the first line; null until measured (all of them). */
  private readonly fit = signal<number | null>(null);
  private readonly widths = new Map<string, number>();
  private moreWidth = 0;

  /** The buttons of the strip. */
  protected readonly shown = computed<readonly BuiltInView[]>(() => {
    const main = this.main();
    const fit = this.fit();
    return fit === null ? main : main.slice(0, Math.max(1, Math.min(fit, main.length)));
  });
  /** The views in the More menu: the ones that did not fit, then Recently completed. */
  protected readonly menu = computed<readonly BuiltInView[]>(() => {
    const more = availableViews(this.context()).filter((v) => v.key === MORE_VIEW);
    return [...this.main().slice(this.shown().length), ...more];
  });

  /** The pressed view: the one whose filters the address carries (by shape, extra filters allowed, #221). */
  protected readonly active = computed(
    () => matchBuiltIn(this.filters(), this.context())?.key ?? null,
  );
  /** The pressed view when it sits in the More menu: the button then shows its name and counts as pressed. */
  protected readonly moreActive = computed(() => {
    const key = this.active();
    return this.menu().find((v) => v.key === key) ?? null;
  });

  constructor() {
    afterNextRender(() => this.watchRoom());
    // The text of a button changes its width (a count, the pressed view's name in More): measure again.
    effect(() => {
      this.counts();
      this.main();
      this.moreActive();
      queueMicrotask(() => this.measure());
    });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((v) => !v);
  }

  protected choose(key: BuiltInViewKey): void {
    this.menuOpen.set(false);
    this.viewSelect.emit(key);
  }

  protected tip(key: BuiltInViewKey): string {
    return VIEW_TIPS[key];
  }

  protected count(key: BuiltInViewKey): number | null {
    return viewCount(key, this.counts());
  }

  /** My pod has no count while the viewer has no primary Pod (and then it is not offered). */
  protected hasCount(key: BuiltInViewKey): boolean {
    return !(key === 'myPod' && !this.context().primaryPodId);
  }

  protected format(n: number | null): string {
    return n === null ? '--' : n.toLocaleString('en-US');
  }

  /** "Overdue, 101 tasks"; the bare name while the count is unknown. */
  protected name(view: { key: BuiltInViewKey; label: string }): string {
    const n = this.hasCount(view.key) ? this.count(view.key) : null;
    return n === null
      ? view.label
      : `${view.label}, ${this.format(n)} ${n === 1 ? 'task' : 'tasks'}`;
  }

  /** Measures again whenever the toolbar or the strip changes size. */
  private watchRoom(): void {
    if (typeof ResizeObserver !== 'function') return;
    const parent = this.host.nativeElement.parentElement;
    const strip = this.strip()?.nativeElement;
    if (!parent || !strip) return;
    const observer = new ResizeObserver(() => this.measure());
    observer.observe(parent);
    observer.observe(strip);
    inject(DestroyRef).onDestroy(() => observer.disconnect());
    this.measure();
  }

  /**
   * Row 1 of the toolbar is one line: the room for the views is the toolbar's width less the other buttons. The widths of the buttons seen so
   * far are remembered (a view in the menu has none yet and is guessed), and as many views as fit, with the More button, stay in the strip.
   */
  private measure(): void {
    const host = this.host.nativeElement;
    const parent = host.parentElement;
    const strip = this.strip()?.nativeElement;
    if (!parent || !strip || parent.clientWidth === 0) return;
    for (const button of Array.from(strip.querySelectorAll<HTMLElement>('button[data-view]'))) {
      const key = button.getAttribute('data-view');
      if (key && button.offsetWidth > 0) this.widths.set(key, button.offsetWidth);
    }
    const more = strip.querySelector<HTMLElement>('[data-more-views]');
    if (more && more.offsetWidth > 0) this.moreWidth = Math.max(this.moreWidth, more.offsetWidth);
    const gap = parseFloat(getComputedStyle(parent).columnGap) || 0;
    let others = 0;
    let count = 0;
    for (const child of Array.from(parent.children) as HTMLElement[]) {
      if (child === host || child.offsetWidth === 0) continue;
      others += child.offsetWidth;
      count++;
    }
    let room = parent.clientWidth - others - count * gap;
    // Too little room beside the other buttons: the strip has the first line to itself and the rest wraps below it.
    if (room < 240) room = parent.clientWidth;
    let used = this.moreWidth || 72;
    let fit = 0;
    const main = this.main();
    for (const view of main) {
      const width = (this.widths.get(view.key) ?? GUESS_WIDTH) + STRIP_GAP;
      if (used + width > room) break;
      used += width;
      fit++;
    }
    this.fit.set(fit >= main.length ? null : Math.max(1, fit));
  }
}
