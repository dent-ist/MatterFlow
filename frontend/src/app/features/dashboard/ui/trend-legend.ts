import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardTrend, DashboardTrendType } from '../../../api/generated/api-client';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { queueParams } from '../dashboard-links';
import { TrendSample } from './trend-sample';
import {
  ALL_STYLE,
  FlowMeasure,
  MAX_TYPES,
  MEASURE_INFO,
  MEASURE_STYLES,
  TYPE_STYLES,
  TrendChoice,
  allVisible,
  totalMeasure,
  typeRows,
} from './trend-model';

let nextId = 0;
/** The legend shows a search box above this many task types. */
export const SEARCH_ABOVE = 8;

/**
 * The "Compare task types" list of the Trends chart, which is also its legend (`mf-trend-legend`): the "All task types" line, one checkbox
 * per task type with its icon, name and total for the period (of the measure of panel 1), Select all and Clear. The list is never disabled:
 * while panel 1 shows its two-line measure a one-line hint says that picking a type switches it to Created. The measure itself is chosen
 * with the segmented control above each panel. Every row has a sample of its line (colour, dash and marker) so colour is never the only cue.
 * Totals link to the Task Queue. Nothing is drawn or fetched here; the tab owns the choices.
 */
@Component({
  selector: 'mf-trend-legend',
  imports: [RouterLink, NgTemplateOutlet, TrendSample, TaskTypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="group" role="group" [attr.aria-labelledby]="id + '-types'" data-group="task-types">
      <div class="group-head">
        <h4 [id]="id + '-types'">Compare task types</h4>
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
      <p class="hint" [id]="id + '-hint'" data-compare-hint>
        @if (twoLine()) {
          <span data-two-line>Pick a task type and the chart switches to Created.</span>
        } @else {
          <span>{{ info[measure()].totalNote }} (the number on each row).</span>
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

      <div
        class="scroll mf-scroll"
        role="region"
        tabindex="0"
        aria-label="Task types, scrollable"
        data-type-scroll
      >
        <ul class="list" data-type-list>
          <li class="row">
            <label class="pick">
              <input type="checkbox" data-all [checked]="showAll()" (change)="allChange.emit()" />
              @if (!twoLine() && showAll()) {
                <mf-trend-sample [style]="allStyle" />
              }
              <span class="name">All task types</span>
              @if (allHidden()) {
                <span
                  class="retired"
                  data-hidden-for-scale
                  title="Hidden for scale while task types are compared"
                  >(hidden for scale)</span
                >
              }
            </label>
            @if (!twoLine()) {
              @if (allTotal(); as t) {
                <ng-container *ngTemplateOutlet="totalTpl; context: { $implicit: t, id: 'all' }" />
              }
            }
          </li>
          @if (twoLine() && showAll()) {
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
                  context: {
                    $implicit: { count: r.total, query: r.query, label: r.name },
                    id: r.id,
                  }
                "
              />
            </li>
          }
          @if (visibleRows().length === 0) {
            <li class="empty" data-no-match>No task types match.</li>
          }
        </ul>
      </div>
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
            info[measure()].label + ' ' + t.count + ', ' + t.label + ', view in the Task Queue'
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
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .scroll {
      max-height: max(14rem, calc(100vh - 24rem));
      overflow: auto;
    }
    .scroll:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    /* Fixed-height Dashboard (#137): the panel is as tall as the tab's chart column; the controls above the list stay put and the list is
       the only thing that scrolls. */
    @media (min-width: 768px) and (min-height: 561px) {
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .group {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      .group > * {
        flex: none;
      }
      .group > .scroll {
        flex: 1 1 0;
        min-height: 5rem;
        max-height: none;
        overscroll-behavior: contain;
      }
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
  readonly selectTop = output<void>();
  readonly clear = output<void>();
  /** A ninth type was checked: refused. */
  readonly limit = output<void>();

  protected readonly search = signal('');
  protected readonly twoLine = computed(() => this.choice().metric === 'both');
  protected readonly measure = computed(() => totalMeasure(this.choice()));
  protected readonly showAll = computed(() => allVisible(this.choice()));
  /** "All task types" is off only because task types are compared (the automatic rule). */
  protected readonly allHidden = computed(
    () => this.choice().all === 'auto' && this.choice().types.length > 0,
  );
  protected readonly types = computed<readonly DashboardTrendType[]>(() => this.data().types);
  private readonly rows = computed(() => typeRows(this.types(), this.measure()));
  protected readonly visibleRows = computed(() => {
    const q = this.search().trim().toLowerCase();
    return q ? this.rows().filter((r) => r.name.toLowerCase().includes(q)) : this.rows();
  });

  protected params(query: string | null | undefined) {
    return queueParams(query);
  }

  protected sum(measure: FlowMeasure): number {
    return this.data().all.reduce((a, d) => a + d[measure], 0);
  }

  protected allTotal() {
    const d = this.data();
    const metric = this.measure();
    return {
      count: this.sum(metric),
      query: metric === 'created' ? d.createdQuery : d.completedQuery,
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
