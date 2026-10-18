import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TaskStep } from './task-step';
import { TaskDetailStore } from './task-detail.store';

/**
 * Workflow section (UX S10): the stepper for ordered and unordered workflows, the progress summary, an explanation when step
 * actions are blocked (On Hold, closed). The Complete task action is in the page header (#298).
 */
@Component({
  selector: 'mf-task-workflow-tab',
  imports: [TaskStep],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @if (wf(); as w) {
      <section aria-labelledby="wf-h" data-workflow-tab>
        <div class="wf__top">
          <div class="wf__summary">
            <h2 id="wf-h" class="wf__title" tabindex="-1" data-section-heading>
              Workflow
              <span class="wf__mode" data-mode>
                {{
                  w.isOrdered
                    ? 'Ordered: complete or skip each step in order'
                    : 'Unordered: work these in any order'
                }}
              </span>
            </h2>
            <p class="wf__progress" data-progress>
              Resolved {{ w.progress.resolved }} of {{ w.progress.total }}
              <progress
                [max]="w.progress.total"
                [value]="w.progress.resolved"
                [attr.aria-label]="
                  'Resolved ' + w.progress.resolved + ' of ' + w.progress.total + ' steps'
                "
              ></progress>
            </p>
          </div>
        </div>

        @if (notice(); as n) {
          <div class="pg-banner" role="note" data-workflow-notice>{{ n }}</div>
        }

        @if (!w.isOrdered) {
          <div class="wf__filter" role="group" aria-label="Show steps">
            <span class="pg-label">Show:</span>
            <button
              type="button"
              class="chip"
              data-filter="all"
              [attr.aria-pressed]="filter() === 'all'"
              (click)="filter.set('all')"
            >
              All
            </button>
            <button
              type="button"
              class="chip"
              data-filter="unresolved"
              [attr.aria-pressed]="filter() === 'unresolved'"
              (click)="filter.set('unresolved')"
            >
              Unresolved
            </button>
          </div>
        }

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
    .wf__title {
      margin: 0 0 var(--mf-s1);
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
      margin-left: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 400;
    }
    .wf__progress {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      margin: 0 0 var(--mf-s3);
    }
    .wf__filter {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s3);
    }
    .chip {
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
      cursor: pointer;
    }
    .chip[aria-pressed='true'] {
      background: var(--mf-surface-alt);
      font-weight: 600;
    }
    .wf__steps {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .wf__top {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .wf__summary {
      flex: 1 1 18rem;
      min-width: 0;
    }
    .wf__summary .wf__progress {
      margin-bottom: 0;
    }
  `,
})
export class TaskWorkflowTab {
  protected readonly store = inject(TaskDetailStore);
  protected readonly filter = signal<'all' | 'unresolved'>('all');

  protected readonly wf = computed(() => this.store.task()?.workflow ?? null);

  protected readonly visibleSteps = computed(() => {
    const w = this.wf();
    if (!w) return [];
    return this.filter() === 'unresolved' && !w.isOrdered
      ? w.steps.filter((s) => s.status !== 'COMPLETED' && s.status !== 'SKIPPED')
      : w.steps;
  });

  /** Sequence number of the first unresolved step, which the locked ones wait for. */
  protected readonly currentSequenceNo = computed(
    () => this.wf()?.steps.find((s) => s.isCurrent)?.sequenceNo ?? null,
  );

  /** Why step actions are unavailable at the task level. */
  protected readonly notice = computed(() => {
    const t = this.store.task();
    if (!t) return null;
    if (this.store.viewOnly()) {
      return t.status === 'ON_HOLD' || t.status === 'COMPLETED' || t.status === 'CANCELLED'
        ? `This task is ${t.statusLabel}.`
        : null;
    }
    switch (t.status) {
      case 'ON_HOLD':
        return 'This task is On Hold. Resume it before working on its steps.';
      case 'COMPLETED':
        return 'This task is Completed. Reopen a step to change it; the task moves back to In Progress.';
      case 'CANCELLED':
        return 'This task is Cancelled. Reopen the task to work on its steps.';
      default:
        return null;
    }
  });
}
