import { FilterChip, FilterChips } from '../../../shared/ui/filter-chips';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TaskStep } from './task-step';
import { TaskDetailStore } from './task-detail.store';

/** The Show All / Unresolved filter appears from this many steps. */
export const FILTER_MIN_STEPS = 6;

/**
 * Workflow section (UX S10): the stepper for ordered and unordered workflows. Progress is in the facts strip and on the Workflow tab. The heading is for screen readers: the tab already names the pane. Why the steps are read-only on an On Hold,
 * Completed or Cancelled task is said once, by the status note under the header (#301). The Complete task action is in the page header (#298).
 */
@Component({
  selector: 'mf-task-workflow-tab',
  imports: [FilterChips, TaskStep],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (wf(); as w) {
      <section aria-labelledby="wf-h" data-workflow-tab>
        <div class="wf__head">
          <h2 id="wf-h" class="wf__title mf-sr-only" tabindex="-1" data-section-heading>
            Workflow
          </h2>
          <p class="wf__mode" data-mode>
            {{
              w.isOrdered
                ? 'Ordered: complete or skip each step in order'
                : 'Unordered: work these in any order'
            }}
          </p>
          @if (showFilter()) {
            <div class="wf__filter" role="group" aria-label="Show steps" data-filter-group>
              <span class="pg-label">Show:</span>
              <mf-filter-chips
                label="Show steps"
                [chips]="filterChips"
                [value]="filter()"
                (valueChange)="filter.set($any($event))"
              />
            </div>
          }
        </div>

        <ol class="wf__steps" [attr.aria-label]="'Workflow steps'">
          @for (s of visibleSteps(); track s.stepInstanceId) {
            <li [attr.aria-current]="s.isCurrent && w.isOrdered ? 'step' : null">
              <mf-task-step
                [step]="s"
                [ordered]="w.isOrdered"
                [currentSequenceNo]="currentSequenceNo()"
                [focusRequested]="store.focusStepId() === s.stepInstanceId"
              />
            </li>
          }
        </ol>
      </section>
    }
  `,
  styles: `
    /* One row: the heading, the one-line mode sentence and, from 6 steps, the filter at the right (#310). */
    .wf__head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--mf-s3);
      row-gap: var(--mf-s1);
      margin-bottom: var(--mf-s3);
    }
    .wf__title {
      margin: 0;
      font-size: var(--mf-fs-h3);
      scroll-margin-top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
    }
    .wf__title:focus {
      outline: none;
    }
    .wf__title:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .wf__mode {
      flex: 1 1 14rem;
      min-width: 0;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .wf__filter {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .wf__steps {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
  `,
})
export class TaskWorkflowTab {
  protected readonly store = inject(TaskDetailStore);
  protected readonly filter = signal<'all' | 'unresolved'>('all');
  protected readonly filterChips: readonly FilterChip[] = [
    { key: 'all', label: 'All' },
    { key: 'unresolved', label: 'Unresolved' },
  ];

  protected readonly wf = computed(() => this.store.task()?.workflow ?? null);

  /** The Show filter is noise for a short workflow: it appears from 6 steps (#310). */
  protected readonly showFilter = computed(
    () => (this.wf()?.steps.length ?? 0) >= FILTER_MIN_STEPS,
  );

  protected readonly visibleSteps = computed(() => {
    const w = this.wf();
    if (!w) return [];
    return this.filter() === 'unresolved' && this.showFilter()
      ? w.steps.filter((s) => s.status !== 'COMPLETED' && s.status !== 'SKIPPED')
      : w.steps;
  });

  /** Sequence number of the first unresolved step, which the locked ones wait for. */
  protected readonly currentSequenceNo = computed(
    () => this.wf()?.steps.find((s) => s.isCurrent)?.sequenceNo ?? null,
  );
}
