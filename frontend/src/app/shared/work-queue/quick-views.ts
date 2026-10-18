import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TaskQueueViewCounts } from '../../api/generated/api-client';
import {
  BUILT_IN_VIEWS,
  BuiltInViewKey,
  QueueFilters,
  ViewContext,
  activeBuiltIn,
} from './queue-filters';

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
          [disabled]="view.key === 'myPod' && !context().primaryPodId"
          [attr.title]="
            view.key === 'myPod' && !context().primaryPodId ? 'You have no primary Pod' : null
          "
          (click)="viewSelect.emit(view.key)"
        >
          {{ view.label }}
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
      gap: var(--mf-s2);
    }
    .qv-view {
      min-height: var(--mf-row-h-compact);
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .qv-view[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
      font-weight: 600;
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
   * The counts of the response (`views`), null while loading. Plumbing for the count display (#219): this component only carries them as
   * `data-count` so the display can render them without another request.
   */
  readonly counts = input<TaskQueueViewCounts | null>(null);
  readonly viewSelect = output<BuiltInViewKey>();

  protected count(key: BuiltInViewKey): number | null {
    return viewCount(key, this.counts());
  }

  protected readonly views = BUILT_IN_VIEWS;
  protected readonly active = computed(() => activeBuiltIn(this.filters(), this.context()));
}
