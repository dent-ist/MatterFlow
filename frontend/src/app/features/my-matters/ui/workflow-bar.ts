import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Tip } from '../../../shared/ui/tip';
import { MmFilters } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { MmApi } from './mm-api';

const ORDER = [
  { key: 'new', label: 'New', tone: 'new' },
  { key: 'inProgress', label: 'In Progress', tone: 'progress' },
  { key: 'onHold', label: 'On Hold', tone: 'hold' },
  { key: 'completed', label: 'Completed', tone: 'done' },
  { key: 'cancelled', label: 'Cancelled', tone: 'cancel' },
] as const;

/**
 * The workflow bar of the title row (`mf-mm-workflow-bar`, epic #953 UI-11): one stacked bar of the tasks of the chosen client or matter by status (New, In Progress, On Hold,
 * Completed, Cancelled) with "n open, n completed" beside it. It is one image for assistive technology with the five counts in its name, a tab stop whose hover and focus text lists them.
 * The numbers are `byStatus` of the task-counts endpoint, so they equal what the Status chips of the grid show. Nothing is drawn while there are no tasks.
 */
@Component({
  selector: 'mf-mm-workflow-bar',
  imports: [Tip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      @if (d.total > 0) {
        <div
          class="mix"
          tabindex="0"
          role="img"
          [attr.aria-label]="name()"
          [mfTip]="tip()"
          data-workflow-bar
        >
          <span class="l">Workflow</span>
          <span class="bar" aria-hidden="true">
            @for (s of d.segments; track s.key) {
              @if (s.n > 0) {
                <i [attr.data-tone]="s.tone" [style.flex]="s.n + ' 1 0'"></i>
              }
            }
          </span>
          <span class="n" aria-hidden="true"
            ><b>{{ d.open }}</b> open &middot; <b>{{ d.completed }}</b> completed</span
          >
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      margin-left: auto;
      min-width: 0;
    }
    .mix {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      padding: var(--mf-s1) var(--mf-s2);
      border-radius: var(--mf-radius-lg);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .mix:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .l {
      font-weight: 600;
    }
    .bar {
      display: flex;
      width: 168px;
      height: 10px;
      overflow: hidden;
      border-radius: 5px;
      background: var(--mf-surface-alt);
      gap: 1px;
      flex: none;
    }
    .bar i {
      display: block;
      min-width: 3px;
      height: 100%;
    }
    i[data-tone='new'] {
      background: var(--mf-status-new-line);
    }
    i[data-tone='progress'] {
      background: var(--mf-sem-info-solid);
    }
    i[data-tone='hold'] {
      background: var(--mf-sem-neutral-solid);
    }
    i[data-tone='done'] {
      background: var(--mf-sem-healthy-solid);
    }
    i[data-tone='cancel'] {
      background: var(--mf-status-cancel-line);
    }
    b {
      color: var(--mf-text);
    }
    @media (max-width: 767.98px) {
      :host {
        margin-left: 0;
        width: 100%;
      }
      .bar {
        flex: 1;
        width: auto;
      }
    }
  `,
})
export class MmWorkflowBar {
  private readonly api = inject(MmApi);
  readonly filters = input.required<MmFilters>();
  /** What the bar is of ("Northwind v. Meridian", "All your matters"). */
  readonly scopeName = input('All your matters');

  private readonly loader = panelLoader(
    () => this.filters(),
    () => this.api.taskCounts(this.filters(), 'open', 'everything'),
  );
  protected readonly data = computed(() => {
    const c = this.loader.data()?.byStatus;
    if (!c) return null;
    const segments = ORDER.map((o) => ({ ...o, n: c[o.key] }));
    return {
      segments,
      total: segments.reduce((a, s) => a + s.n, 0),
      open: c.allOpen,
      completed: c.completed,
    };
  });
  protected readonly name = computed(
    () =>
      `Workflow of ${this.scopeName()}: ` +
      (this.data()
        ?.segments.map((s) => `${s.label} ${s.n}`)
        .join(', ') ?? ''),
  );
  protected readonly tip = computed(
    () =>
      `Workflow of ${this.scopeName()}\n` +
      (this.data()
        ?.segments.map((s) => `${s.label}: ${s.n}`)
        .join('\n') ?? ''),
  );
}
