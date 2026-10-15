import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardTrend, DashboardTrendType } from '../../../api/generated/api-client';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import { TrendSample } from './trend-sample';
import {
  ALL_STYLE,
  DUE_MEASURES,
  DueMeasure,
  MAX_TYPES,
  MEASURES,
  MEASURE_INFO,
  MEASURE_STYLES,
  Measure,
  TYPE_STYLES,
  TrendChoice,
  typeRows,
} from './trend-model';

let nextId = 0;
/** The legend shows a search box above this many task types. */
export const SEARCH_ABOVE = 8;

/**
 * The legend of the Trends chart, which is also its control (`mf-trend-legend`): a "Due dates" group (Overdue, On time, Completed late for
 * the default chart) and a "Task types" group (the "All task types" line, one checkbox per task type with its icon, name and total for the
 * period, the Show selector for the measure, Select all and Clear). Every row has a sample of its line (colour, dash and marker) so colour is
 * never the only cue. Totals link to the Task Queue. Nothing is drawn or fetched here; the tab owns the choices.
 */
@Component({
  selector: 'mf-trend-legend',
  imports: [RouterLink, NgTemplateOutlet, TrendSample, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group" role="group" [attr.aria-labelledby]="id + '-due'" data-group="due-dates">
      <h4 [id]="id + '-due'">Due dates</h4>
      <ul class="list">
        @for (m of dueMeasures; track m) {
          <li class="row" [class.off]="!defaultMode()">
            <label class="pick">
              <input
                type="checkbox"
                [attr.data-due]="m"
                [checked]="choice().due.includes(m)"
                [disabled]="!defaultMode()"
                [attr.aria-describedby]="id + '-due-hint'"
                (change)="dueChange.emit(m)"
              />
              <mf-trend-sample [style]="styles[m]" />
              <span class="name">{{ info[m].label }}</span>
            </label>
            @if (dueTotal(m); as t) {
              @if (t.count > 0) {
                <a
                  class="total"
                  routerLink="/tasks"
                  [queryParams]="params(t.query)"
                  [attr.data-legend]="m"
                  [attr.aria-label]="t.label + ' ' + t.count + ', view in the Task Queue'"
                  >{{ t.count }}</a
                >
              } @else {
                <span class="total zero">0</span>
              }
            }
          </li>
        }
      </ul>
      <p class="hint" [id]="id + '-due-hint'">
        Uses each task's current due date. Tasks without a due date (ASAP) are not counted.
        @if (!defaultMode()) {
          <span data-due-disabled>
            Shown only while no task type is selected; pick Overdue or On time under Show to compare
            task types.
          </span>
        }
      </p>
    </div>

    <div class="group" role="group" [attr.aria-labelledby]="id + '-types'" data-group="task-types">
      <div class="group-head">
        <h4 [id]="id + '-types'">Task types</h4>
        <span class="actions">
          <button type="button" class="link" data-select-all (click)="selectTop.emit()">
            Select all
          </button>
          <button
            type="button"
            class="link"
            data-clear
            [disabled]="choice().types.length === 0"
            (click)="clear.emit()"
          >
            Clear
          </button>
        </span>
      </div>

      <div
        class="show"
        role="radiogroup"
        [attr.aria-labelledby]="id + '-show'"
        [attr.aria-describedby]="id + '-show-hint'"
        data-show
      >
        <span class="show-label" [id]="id + '-show'">Show:</span>
        @for (m of measures; track m) {
          <label class="radio" [class.off]="defaultMode()">
            <input
              type="radio"
              [name]="id + '-metric'"
              [value]="m"
              [attr.data-metric]="m"
              [checked]="choice().metric === m"
              [disabled]="defaultMode()"
              (change)="metricChange.emit(m)"
            />
            {{ info[m].label }}
          </label>
        }
      </div>
      <p class="hint" [id]="id + '-show-hint'">
        @if (defaultMode()) {
          <span data-show-disabled
            >Created and completed are both shown until you select a task type.</span
          >
        } @else {
          <span>{{ info[choice().metric].totalNote }} (the number on each row).</span>
        }
      </p>

      @if (types().length > searchAbove) {
        <input
          type="search"
          class="search"
          data-search
          autocomplete="off"
          aria-label="Search task types"
          placeholder="Search task types"
          [value]="search()"
          (input)="search.set($any($event.target).value)"
        />
      }

      <ul class="list scroll mf-scroll" data-type-list>
        <li class="row">
          <label class="pick">
            <input
              type="checkbox"
              data-all
              [checked]="choice().showAll"
              (change)="allChange.emit()"
            />
            @if (!defaultMode() && choice().showAll) {
              <mf-trend-sample [style]="allStyle" />
            }
            <span class="name">All task types</span>
          </label>
          @if (!defaultMode()) {
            @if (allTotal(); as t) {
              <ng-container *ngTemplateOutlet="totalTpl; context: { $implicit: t, id: 'all' }" />
            }
          }
        </li>
        @if (defaultMode() && choice().showAll) {
          <li class="row sub">
            <a
              routerLink="/tasks"
              class="sublink"
              data-legend="created"
              [queryParams]="params(data().createdQuery)"
            >
              <mf-trend-sample [style]="styles.created" />
              Created <strong>{{ sum('created') }}</strong>
            </a>
          </li>
          <li class="row sub">
            <a
              routerLink="/tasks"
              class="sublink"
              data-legend="completed"
              [queryParams]="params(data().completedQuery)"
            >
              <mf-trend-sample [style]="styles.completed" />
              Completed <strong>{{ sum('completed') }}</strong>
            </a>
          </li>
        }
        @for (r of visibleRows(); track r.id) {
          <li class="row" [class.muted]="r.total === 0" [attr.data-type]="r.id">
            <label class="pick">
              <input
                type="checkbox"
                [attr.data-type-box]="r.id"
                [checked]="isSelected(r.id)"
                (change)="onType(r.id, $event)"
              />
              @if (isSelected(r.id)) {
                <mf-trend-sample [style]="styleOf(r.id)" />
              }
              <mf-task-type-icon [iconKey]="r.iconKey" size="sm" />
              <span class="name" [title]="r.name">{{ r.name }}</span>
              @if (!r.isActive) {
                <span class="retired">(inactive)</span>
              }
            </label>
            <ng-container
              *ngTemplateOutlet="
                totalTpl;
                context: { $implicit: { count: r.total, query: r.query, label: r.name }, id: r.id }
              "
            />
          </li>
        }
        @if (visibleRows().length === 0) {
          <li class="empty" data-no-match>No task types match.</li>
        }
      </ul>
      <p class="msg" role="status" aria-live="polite" data-limit-msg>{{ message() }}</p>
    </div>

    <ng-template #totalTpl let-t let-key="id">
      @if (t.count > 0 && t.query) {
        <a
          class="total"
          routerLink="/tasks"
          [queryParams]="params(t.query)"
          [attr.data-total]="key"
          [attr.aria-label]="
            info[choice().metric].label +
            ' ' +
            t.count +
            ', ' +
            t.label +
            ', view in the Task Queue'
          "
          >{{ t.count }}</a
        >
      } @else {
        <span class="total zero" [attr.data-total]="key">{{ t.count }}</span>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s4);
      align-content: start;
      min-width: 0;
    }
    .group {
      min-width: 0;
    }
    h4 {
      margin: 0;
      font-size: var(--mf-fs-md);
    }
    .group-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s2);
    }
    .group > h4 {
      margin-bottom: var(--mf-s2);
    }
    .actions {
      display: inline-flex;
      gap: var(--mf-s3);
    }
    .link {
      min-height: var(--mf-target-min);
      padding: 0;
      background: none;
      border: 0;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      text-decoration: underline;
      cursor: pointer;
    }
    .link:disabled {
      color: var(--mf-text-disabled);
      cursor: default;
      text-decoration: none;
    }
    .list {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .scroll {
      max-height: 20rem;
      overflow: auto;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h-compact);
      padding: 0 var(--mf-s1);
    }
    .row:hover {
      background: var(--mf-surface-alt);
    }
    .pick {
      display: inline-flex;
      align-items: center;
      flex: 1;
      gap: var(--mf-s2);
      min-width: 0;
      min-height: var(--mf-target-min);
      cursor: pointer;
    }
    .pick input {
      flex: none;
      width: 1rem;
      height: 1rem;
      margin: 0;
      accent-color: var(--mf-primary);
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .retired {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      white-space: nowrap;
    }
    .muted .name,
    .muted .total {
      color: var(--mf-text-muted);
    }
    .off,
    .off * {
      color: var(--mf-text-muted);
      cursor: default;
    }
    .total {
      flex: none;
      min-width: 2ch;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      color: var(--mf-link);
    }
    .total.zero {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .sub {
      padding-left: calc(1rem + var(--mf-s4));
    }
    .sublink {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min);
      color: var(--mf-text);
      text-decoration: none;
    }
    .sublink:hover {
      text-decoration: underline;
    }
    .hint {
      margin: var(--mf-s1) 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
    .show {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s1) var(--mf-s3);
      font-size: var(--mf-fs-sm);
    }
    .show-label {
      font-weight: 600;
    }
    .radio {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: var(--mf-target-min);
      cursor: pointer;
    }
    .radio input {
      margin: 0;
      accent-color: var(--mf-primary);
    }
    .search {
      box-sizing: border-box;
      width: 100%;
      min-height: var(--mf-row-h-compact);
      margin-bottom: var(--mf-s2);
      padding: 0 var(--mf-s2);
      font: inherit;
      font-size: var(--mf-fs-sm);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
    }
    .empty {
      padding: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .msg {
      min-height: 1.2em;
      margin: var(--mf-s2) 0 0;
      color: var(--mf-warning);
      font-size: var(--mf-fs-sm);
    }
    .msg:empty {
      margin: 0;
      min-height: 0;
    }
  `,
})
export class TrendLegend {
  protected readonly id = `mf-trend-legend-${nextId++}`;
  protected readonly searchAbove = SEARCH_ABOVE;
  protected readonly dueMeasures = DUE_MEASURES;
  protected readonly measures = MEASURES;
  protected readonly info = MEASURE_INFO;
  protected readonly styles = MEASURE_STYLES;
  protected readonly allStyle = ALL_STYLE;

  readonly choice = input.required<TrendChoice>();
  /** The slot (colour, dash, marker) each checked type has. */
  readonly slots = input.required<ReadonlyMap<number, number>>();
  readonly data = input.required<DashboardTrend>();
  /** A short remark under the list (the limit message, or what Select all did). */
  readonly message = input('');

  readonly allChange = output<void>();
  readonly typeChange = output<number>();
  readonly dueChange = output<DueMeasure>();
  readonly metricChange = output<Measure>();
  readonly selectTop = output<void>();
  readonly clear = output<void>();
  /** A ninth type was checked: refused. */
  readonly limit = output<void>();

  protected readonly search = signal('');
  protected readonly defaultMode = computed(() => this.choice().types.length === 0);
  protected readonly types = computed<readonly DashboardTrendType[]>(() => this.data().types);
  private readonly rows = computed(() => typeRows(this.types(), this.choice().metric));
  protected readonly visibleRows = computed(() => {
    const q = this.search().trim().toLowerCase();
    return q ? this.rows().filter((r) => r.name.toLowerCase().includes(q)) : this.rows();
  });

  protected params(query: string | null | undefined) {
    return queueParams(query);
  }

  protected sum(measure: 'created' | 'completed' | 'onTime' | 'late'): number {
    return this.data().all.reduce((a, d) => a + d[measure], 0);
  }

  /** The total of a Due dates row: Overdue is the count now; On time and Late are totals for the period. */
  protected dueTotal(m: DueMeasure) {
    const d = this.data();
    const count = m === 'overdue' ? (d.all[d.all.length - 1]?.overdue ?? 0) : this.sum(m);
    return {
      count,
      query: m === 'overdue' ? d.overdueQuery : d.completedQuery,
      label: m === 'overdue' ? 'Overdue now' : MEASURE_INFO[m].label,
    };
  }

  protected allTotal() {
    const d = this.data();
    const metric = this.choice().metric;
    const count = metric === 'overdue' ? (d.all[d.all.length - 1]?.overdue ?? 0) : this.sum(metric);
    return {
      count,
      query:
        metric === 'overdue'
          ? d.overdueQuery
          : metric === 'created'
            ? d.createdQuery
            : d.completedQuery,
      label: 'All task types',
    };
  }

  protected isSelected(id: number): boolean {
    return this.choice().types.includes(id);
  }

  protected styleOf(id: number) {
    return TYPE_STYLES[(this.slots().get(id) ?? 0) % TYPE_STYLES.length];
  }

  protected onType(id: number, event: Event): void {
    const box = event.target as HTMLInputElement;
    if (box.checked && !this.isSelected(id) && this.choice().types.length >= MAX_TYPES) {
      box.checked = false;
      this.limit.emit();
      return;
    }
    this.typeChange.emit(id);
  }
}
