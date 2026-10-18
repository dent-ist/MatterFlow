import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TaskQueueViewCounts } from '../../api/generated/api-client';
import { LIST_ORDER } from '../../features/dashboard/dashboard-links';
import { normalizeColumns } from './column-prefs';
import {
  BUILT_IN_VIEWS,
  BuiltInViewKey,
  QueueFilters,
  SortDirection,
  ViewContext,
  activeBuiltIn,
} from './queue-filters';

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
    case 'recentlyCompleted':
      return counts.recentlyCompleted;
  }
}

/**
 * The Task Queue's quick views (All open, Unassigned, My pod, Created by me, Overdue, Recently completed) as presets: choosing one writes
 * its column filters (they show in the filter row and as chips, and can be removed one by one); changing any filter by hand un-presses it.
 */
@Component({
  selector: 'mf-quick-views',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qv" role="group" aria-label="Quick views">
      @for (view of views; track view.key) {
        <button
          type="button"
          class="qv-view"
          [attr.aria-pressed]="active() === view.key"
          [attr.data-view]="view.key"
          [attr.data-count]="count(view.key)"
          [attr.aria-label]="name(view)"
          [disabled]="view.key === 'myPod' && !context().primaryPodId"
          [attr.title]="
            view.key === 'myPod' && !context().primaryPodId ? 'You have no primary Pod' : null
          "
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
    </div>
  `,
  styles: `
    :host {
      display: block;
      /* Left in the bar whatever wraps: the rest of the bar is right aligned. */
      margin-right: auto;
    }
    .qv {
      display: flex;
      flex-wrap: wrap;
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
      cursor: pointer;
    }
    /* The strip's number: tabular digits and room for three of them, so the count replaces "--" without moving the next button (and row 1 stays one line at 1366). */
    .qv-n {
      display: inline-block;
      min-width: 1.8em;
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
    .qv-view[aria-pressed='true'] .qv-n:not(.qv-n--zero) {
      color: inherit;
    }
    .qv-view[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
    }
    .qv-view:disabled {
      color: var(--mf-text-disabled);
      cursor: default;
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
   * The counts of the response (`views`), null while loading: shown in each button (`(--)` while null), also as `data-count`. They are
   * not narrowed by the filters, so they stay the same while a filter is edited.
   */
  readonly counts = input<TaskQueueViewCounts | null>(null);
  readonly viewSelect = output<BuiltInViewKey>();

  protected count(key: BuiltInViewKey): number | null {
    return viewCount(key, this.counts());
  }

  /** My pod has no count without a primary Pod (and is disabled then). */
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

  protected readonly views = BUILT_IN_VIEWS;
  protected readonly active = computed(() => activeBuiltIn(this.filters(), this.context()));
}
