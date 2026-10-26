import { toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import {
  BreakdownCell,
  BreakdownRow,
  BreakdownType,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { PanelBox } from '../panels/panel-box';

/** Below this width the matrix would need sideways scrolling inside the page: each matter becomes a card (README 6.5). */
const TABLE_MIN_PX = 720;

export type BreakdownView = 'matrix' | 'types';
export type BreakdownStatus = 'open' | 'onHold';

/** `4.2 d average, 5 d target: within target (12 done)`: the actual turnaround against the target of a task type, in words (colour is never the signal). */
export function turnaroundText(
  t: Pick<BreakdownType, 'avgDaysDone' | 'targetDays' | 'doneCount'>,
  windowDays: number,
): string {
  if (t.avgDaysDone === null || t.avgDaysDone === undefined)
    return `No tasks completed in the last ${windowDays} days`;
  const avg = `${t.avgDaysDone} d average`;
  const done = `${t.doneCount} done`;
  if (t.targetDays === null || t.targetDays === undefined) return `${avg}, no target (${done})`;
  const verdict = t.avgDaysDone > t.targetDays ? 'over target' : 'within target';
  return `${avg}, ${t.targetDays} d target: ${verdict} (${done})`;
}

/**
 * The Breakdown tab (PM v2, PV-11, README 6.5): open work per matter and task type, from `GET /my-matters/breakdown`. "Per matter" is a real table
 * (one row per matter, a column per task type, a totals row, a cell is open tasks with the overdue ones named in words); "All matters" is
 * one row per task type with open, overdue, at risk and on hold counts and the average actual turnaround against the target (PV-27). Every number is
 * a link to the Task Queue with exactly the filters it counts. On a phone each matter (or type) is a card. The tab is its own lazy chunk, and
 * follows the page's Client / Role / Scope filters.
 */
@Component({
  selector: 'mf-mm-breakdown-tab',
  imports: [PanelBox, RouterLink, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .bd__toggle {
      display: inline-flex;
    }
    .bd__toggle .mf-btn[aria-pressed='true'] {
      border-color: var(--mf-primary);
      background: var(--mf-selected-bg);
      font-weight: 700;
    }
    .bd__bar {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2) var(--mf-s4);
      align-items: center;
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-sm);
      color: var(--mf-text-muted);
    }
    .bd__scroll {
      max-width: 100%;
      overflow-x: auto;
    }
    .bd__scroll:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .bd__table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--mf-fs-sm);
      font-variant-numeric: tabular-nums;
    }
    .bd__table caption {
      padding-bottom: var(--mf-s2);
      text-align: left;
      color: var(--mf-text-muted);
    }
    .bd__table th,
    .bd__table td {
      padding: var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      text-align: right;
      vertical-align: top;
    }
    .bd__table thead th {
      white-space: normal;
      font-weight: 700;
      vertical-align: bottom;
    }
    .bd__table th[scope='row'],
    .bd__table thead th:first-child {
      position: sticky;
      left: 0;
      z-index: 1;
      min-width: 12rem;
      max-width: 16rem;
      background: var(--mf-surface);
      text-align: left;
      font-weight: 600;
    }
    .bd__table tfoot th,
    .bd__table tfoot td {
      border-top: 2px solid var(--mf-border-strong);
      font-weight: 700;
    }
    .bd__table th.bd__type {
      min-width: 6.5rem;
    }
    .bd__typehead {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .bd__sub {
      display: block;
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .bd__num {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      min-width: 24px;
      justify-content: flex-end;
      color: var(--mf-link);
      font-weight: 600;
    }
    .bd__over {
      display: block;
      color: var(--mf-due-overdue);
      font-size: var(--mf-fs-xs);
      font-weight: 700;
    }
    .bd__none {
      color: var(--mf-text-muted);
    }
    .bd__cards {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bd__card {
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .bd__card h3 {
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .bd__card ul {
      display: grid;
      gap: var(--mf-s1);
      margin: var(--mf-s2) 0 0;
      padding: 0;
      list-style: none;
    }
    .bd__line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
      align-items: center;
    }
    .bd__line a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
    .bd__pager {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
      margin-top: var(--mf-s3);
      font-size: var(--mf-fs-sm);
    }
    .bd__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }
    @media (max-width: 639.98px) {
      .bd__toggle .mf-btn,
      .bd__pager .mf-btn {
        min-height: 44px;
      }
    }
  `,
  template: `
    <mf-mm-panel
      name="breakdown"
      title="Breakdown"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <div mfPanelActions class="bd__toggle" role="group" aria-label="Matters shown">
        <button
          type="button"
          class="mf-btn"
          data-bd-view="matrix"
          [attr.aria-pressed]="view() === 'matrix'"
          (click)="setView('matrix')"
        >
          Per matter
        </button>
        <button
          type="button"
          class="mf-btn"
          data-bd-view="types"
          [attr.aria-pressed]="view() === 'types'"
          (click)="setView('types')"
        >
          All matters
        </button>
      </div>
      @if (data(); as d) {
        <div class="bd__bar">
          <span class="bd__toggle" role="group" aria-label="Tasks counted">
            <button
              type="button"
              class="mf-btn"
              data-bd-status="open"
              [attr.aria-pressed]="status() === 'open'"
              (click)="setStatus('open')"
            >
              Open tasks
            </button>
            <button
              type="button"
              class="mf-btn"
              data-bd-status="onHold"
              [attr.aria-pressed]="status() === 'onHold'"
              (click)="setStatus('onHold')"
            >
              On hold only
            </button>
          </span>
          <span data-bd-summary>{{ summary() }}</span>
        </div>

        @if (d.types.length === 0) {
          <p class="bd__empty" data-empty>No {{ noun() }} on these matters.</p>
        } @else if (view() === 'types') {
          @if (wide()) {
            <div class="bd__scroll" tabindex="0" role="region" aria-label="Task types table">
              <table class="bd__table" data-bd-table="types">
                <caption>
                  {{
                    noun()
                  }}
                  per task type across all these matters. The average is over the tasks completed in
                  the last
                  {{
                    d.avgWindowDays
                  }}
                  days.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Task type</th>
                    <th scope="col">{{ countLabel() }}</th>
                    <th scope="col">Overdue</th>
                    <th scope="col">At risk</th>
                    <th scope="col">On hold</th>
                    <th scope="col">Average turnaround against target</th>
                  </tr>
                </thead>
                <tbody>
                  @for (t of d.types; track t.taskTypeId) {
                    <tr data-bd-type [attr.data-type-id]="t.taskTypeId">
                      <th scope="row">
                        <span class="bd__typehead">
                          <mf-task-type-badge
                            [iconKey]="t.iconKey"
                            [colourKey]="t.colourKey"
                            [name]="t.name"
                            [decorative]="true"
                          />{{ t.name }}
                        </span>
                      </th>
                      <td>
                        <a class="bd__num" routerLink="/tasks" [queryParams]="params(t.query)">{{
                          t.open
                        }}</a>
                      </td>
                      <td>
                        @if (t.overdue > 0) {
                          <a
                            class="bd__num"
                            routerLink="/tasks"
                            [queryParams]="params(t.overdueQuery)"
                            >{{ t.overdue }}</a
                          >
                        } @else {
                          <span class="bd__none">0</span>
                        }
                      </td>
                      <td>{{ t.atRisk }}</td>
                      <td>{{ t.onHold }}</td>
                      <td data-bd-turnaround>{{ turnaround(t, d.avgWindowDays) }}</td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">All task types</th>
                    <td>
                      <a
                        class="bd__num"
                        routerLink="/tasks"
                        [queryParams]="params(d.totals.query)"
                        >{{ d.totals.open }}</a
                      >
                    </td>
                    <td>
                      @if (d.totals.overdue > 0) {
                        <a
                          class="bd__num"
                          routerLink="/tasks"
                          [queryParams]="params(d.totals.overdueQuery)"
                          >{{ d.totals.overdue }}</a
                        >
                      } @else {
                        <span class="bd__none">0</span>
                      }
                    </td>
                    <td>{{ d.totals.atRisk }}</td>
                    <td>{{ d.totals.onHold }}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          } @else {
            <ul class="bd__cards" data-bd-cards="types">
              @for (t of d.types; track t.taskTypeId) {
                <li class="bd__card" data-bd-type>
                  <h3 class="bd__typehead">
                    <mf-task-type-badge
                      [iconKey]="t.iconKey"
                      [colourKey]="t.colourKey"
                      [name]="t.name"
                      [decorative]="true"
                    />{{ t.name }}
                  </h3>
                  <div class="bd__line">
                    <a routerLink="/tasks" [queryParams]="params(t.query)"
                      >{{ t.open }} {{ countLabel().toLowerCase() }}</a
                    >
                    @if (t.overdue > 0) {
                      <a class="bd__over" routerLink="/tasks" [queryParams]="params(t.overdueQuery)"
                        >{{ t.overdue }} overdue</a
                      >
                    }
                    <span>{{ t.atRisk }} at risk, {{ t.onHold }} on hold</span>
                  </div>
                  <p class="bd__sub">{{ turnaround(t, d.avgWindowDays) }}</p>
                </li>
              }
            </ul>
          }
        } @else if (d.rows.length === 0) {
          <p class="bd__empty" data-empty>No {{ noun() }} on these matters.</p>
        } @else if (wide()) {
          <div class="bd__scroll" tabindex="0" role="region" aria-label="Breakdown table">
            <table class="bd__table" data-bd-table="matrix">
              <caption>
                {{
                  noun()
                }}
                per matter and task type. A cell opens the Task Queue with those tasks.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  @for (t of d.types; track t.taskTypeId) {
                    <th scope="col" class="bd__type" data-bd-col>
                      <span class="bd__typehead">
                        <mf-task-type-badge
                          [iconKey]="t.iconKey"
                          [colourKey]="t.colourKey"
                          [name]="t.name"
                          [decorative]="true"
                        />{{ t.name }}
                      </span>
                    </th>
                  }
                  <th scope="col">All types</th>
                </tr>
              </thead>
              <tbody>
                @for (r of d.rows; track r.matterId) {
                  <tr data-bd-row [attr.data-matter-id]="r.matterId">
                    <th scope="row">
                      <a [routerLink]="['/matters', r.matterId]">{{ r.matterRef }}</a>
                      {{ r.matterName }}
                      <span class="bd__sub">{{ r.clientName }}</span>
                    </th>
                    @for (t of d.types; track t.taskTypeId) {
                      <td>
                        @if (cell(r, t.taskTypeId); as c) {
                          <a
                            class="bd__num"
                            data-bd-cell
                            routerLink="/tasks"
                            [queryParams]="params(c.query)"
                            [attr.aria-label]="cellLabel(r, t, c)"
                            >{{ c.open }}</a
                          >
                          @if (c.overdue > 0) {
                            <a
                              class="bd__over"
                              data-bd-overdue
                              routerLink="/tasks"
                              [queryParams]="params(c.overdueQuery)"
                              >{{ c.overdue }} overdue</a
                            >
                          }
                        } @else {
                          <span class="bd__none" aria-label="None">-</span>
                        }
                      </td>
                    }
                    <td>
                      <strong>{{ r.open }}</strong>
                      @if (r.overdue > 0) {
                        <span class="bd__over">{{ r.overdue }} overdue</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr data-bd-totals>
                  <th scope="row">
                    All matters{{ d.matterTotal > d.rows.length ? ' (all pages)' : '' }}
                  </th>
                  @for (t of d.types; track t.taskTypeId) {
                    <td>
                      <a class="bd__num" routerLink="/tasks" [queryParams]="params(t.query)">{{
                        t.open
                      }}</a>
                      @if (t.overdue > 0) {
                        <a
                          class="bd__over"
                          routerLink="/tasks"
                          [queryParams]="params(t.overdueQuery)"
                          >{{ t.overdue }} overdue</a
                        >
                      }
                    </td>
                  }
                  <td>
                    <a class="bd__num" routerLink="/tasks" [queryParams]="params(d.totals.query)">{{
                      d.totals.open
                    }}</a>
                    @if (d.totals.overdue > 0) {
                      <a
                        class="bd__over"
                        routerLink="/tasks"
                        [queryParams]="params(d.totals.overdueQuery)"
                        >{{ d.totals.overdue }} overdue</a
                      >
                    }
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        } @else {
          <ul class="bd__cards" data-bd-cards="matrix">
            @for (r of d.rows; track r.matterId) {
              <li class="bd__card" data-bd-row>
                <h3>
                  <a [routerLink]="['/matters', r.matterId]">{{ r.matterRef }}</a>
                  {{ r.matterName }}
                </h3>
                <span class="bd__sub">{{ r.clientName }}</span>
                <p class="bd__line">
                  <strong>{{ r.open }} {{ countLabel().toLowerCase() }}</strong>
                  @if (r.overdue > 0) {
                    <span class="bd__over">{{ r.overdue }} overdue</span>
                  }
                </p>
                <ul>
                  @for (c of r.cells; track c.taskTypeId) {
                    <li class="bd__line" data-bd-cell>
                      <a routerLink="/tasks" [queryParams]="params(c.query)"
                        >{{ typeName(d.types, c.taskTypeId) }}: {{ c.open }}</a
                      >
                      @if (c.overdue > 0) {
                        <a
                          class="bd__over"
                          routerLink="/tasks"
                          [queryParams]="params(c.overdueQuery)"
                          >{{ c.overdue }} overdue</a
                        >
                      }
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>
        }

        @if (view() === 'matrix' && d.matterTotal > d.pageSize) {
          <nav class="bd__pager" aria-label="Breakdown pages">
            <button
              type="button"
              class="mf-btn"
              data-bd-prev
              [disabled]="d.page <= 1"
              (click)="setPage(d.page - 1)"
            >
              Previous
            </button>
            <span data-bd-page>Page {{ d.page }} of {{ pageCount() }}</span>
            <button
              type="button"
              class="mf-btn"
              data-bd-next
              [disabled]="d.page >= pageCount()"
              (click)="setPage(d.page + 1)"
            >
              Next
            </button>
          </nav>
        }
      }
    </mf-mm-panel>
  `,
})
export class BreakdownTab {
  readonly filters = input.required<MmFilters>();

  private readonly api = inject(MyMattersClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly wide = viewportAtLeast(TABLE_MIN_PX);
  protected readonly turnaround = turnaroundText;

  /** `?bview=types` is "All matters"; absent is "Per matter". */
  protected readonly view = computed<BreakdownView>(() =>
    this.query().get('bview') === 'types' ? 'types' : 'matrix',
  );
  /** `?bstatus=onHold` counts only the tasks on hold. */
  protected readonly status = computed<BreakdownStatus>(() =>
    this.query().get('bstatus') === 'onHold' ? 'onHold' : 'open',
  );
  protected readonly pageNo = computed(() => {
    const n = Number.parseInt(this.query().get('bpage') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });

  protected readonly loader = panelLoader(
    () => [this.filters(), this.view(), this.status(), this.pageNo()],
    () => {
      const a = commonArgs(this.filters());
      return this.api.getMyMattersBreakdown(
        this.view(),
        this.status(),
        undefined,
        this.view() === 'matrix' ? this.pageNo() : undefined,
        undefined,
        a.scope,
        a.role,
        a.clientId,
        undefined,
        undefined,
        a.managerId,
      );
    },
  );

  protected readonly data = computed(() => this.loader.data());
  protected readonly noun = computed(() =>
    this.status() === 'onHold' ? 'Tasks on hold' : 'Open tasks',
  );
  protected readonly countLabel = computed(() => (this.status() === 'onHold' ? 'On hold' : 'Open'));
  protected readonly pageCount = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.matterTotal / d.pageSize)) : 1;
  });
  protected readonly summary = computed(() => {
    const d = this.data();
    if (!d) return '';
    const types = `${d.types.length}${d.typeTotal > d.types.length ? ` of ${d.typeTotal}` : ''} task types`;
    return `${d.totals.open} ${this.noun().toLowerCase()} on ${d.matterTotal} ${d.matterTotal === 1 ? 'matter' : 'matters'}, ${types}`;
  });

  protected params(query: string): Params {
    return queryToParams(query);
  }

  protected cell(row: BreakdownRow, typeId: number): BreakdownCell | undefined {
    return row.cells.find((c) => c.taskTypeId === typeId);
  }

  protected cellLabel(row: BreakdownRow, type: BreakdownType, c: BreakdownCell): string {
    const over = c.overdue > 0 ? `, ${c.overdue} overdue` : '';
    return `${row.matterRef}, ${type.name}: ${c.open} ${this.countLabel().toLowerCase()}${over}`;
  }

  protected typeName(types: readonly BreakdownType[], id: number): string {
    return types.find((t) => t.taskTypeId === id)?.name ?? '';
  }

  private go(queryParams: Record<string, string | number | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  protected setView(view: BreakdownView): void {
    this.go({ bview: view === 'types' ? 'types' : null, bpage: null });
  }

  protected setStatus(status: BreakdownStatus): void {
    this.go({ bstatus: status === 'onHold' ? 'onHold' : null, bpage: null });
  }

  protected setPage(page: number): void {
    this.go({ bpage: page > 1 ? page : null });
  }
}
