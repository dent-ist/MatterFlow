import { toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import {
  BreakdownCell,
  BreakdownRow,
  BreakdownType,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { ExportMenu, ExportResult } from '../../../shared/ui/export-menu';
import { ExportService } from '../../../shared/ui/export.service';
import { ExportFormat, buildList } from '../../../shared/ui/list-export';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { ScrollRegion } from '../../../shared/ui/scroll-region';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { MyMattersFocus } from '../focus';
import { ManagedMatters } from '../managed-matters';
import { MmFilters, commonArgs, queryToParams } from '../my-matters-filters';
import { panelLoader } from '../panel-loader';
import { Segmented } from '../../../shared/ui/segmented';
import { PanelBox } from '../panels/panel-box';

/** Below this width the matrix would need sideways scrolling inside the page: each matter becomes a compact card (README 6.5, issue #912). */
const TABLE_MIN_PX = 720;

export type BreakdownView = 'matrix' | 'types';
export type BreakdownStatus = 'open' | 'onHold';

/** "Focus: 3 task types" (the note of a Breakdown that follows the person's Focus, issue #907). */
export function focusNote(count: number): string {
  return `Focus: ${count} task ${count === 1 ? 'type' : 'types'}`;
}

/** The name of a count, for a screen reader: "MAT-1, Review: 3 open, 1 overdue" (the red mark and the "!" are only the look of the second part). */
export function breakdownCountName(
  where: string,
  count: number,
  overdue: number,
  word: string,
): string {
  return `${where}: ${count} ${word}${overdue > 0 ? `, ${overdue} overdue` : ''}`;
}

/** The one line of the phone's total: "24 open, 9 overdue" (the second part only when something is late). */
export function breakdownTotalLine(open: number, overdue: number, word: string): string {
  return overdue > 0 ? `${open} ${word}, ${overdue} overdue` : `${open} ${word}`;
}

/**
 * The Breakdown tab (PM v2, PV-11, README 6.5; epic #893 issues #911, #912, #907): open work per matter and task type, from `GET /my-matters/breakdown`. "By
 * matter" is a real table (one row per matter, a column only for a task type that has tasks, one number per cell, red with a "!" when something is late, and an
 * "All matters" row only when there are two or more matters); "All together" is one row per task type with open, overdue, at risk and on hold counts. Every
 * number is a link to the Task Queue with exactly the filters it counts. The toggle is drawn only for a person with several matters; "On hold only" and
 * Export are in the Options menu. The person's Focus narrows the task types (and says so: "Focus: 3 task types"). Below 720 px each matter is a compact
 * card with its task types as count chips. The tab is its own lazy chunk, and follows the page's Client / Role / Scope filters.
 */
@Component({
  selector: 'mf-mm-breakdown-tab',
  imports: [ExportMenu, OptionsMenu, PanelBox, RouterLink, ScrollRegion, Segmented, TaskTypeBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .bd__focus {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .bd__check {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 32px;
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
    .bd__table th,
    .bd__table td {
      padding: var(--mf-s2);
      border-bottom: 1px solid var(--mf-border);
      text-align: right;
      vertical-align: middle;
    }
    .bd__table thead th {
      font-weight: 700;
      white-space: nowrap;
    }
    .bd__table th[scope='row'],
    .bd__table thead th:first-child {
      position: sticky;
      left: 0;
      z-index: 1;
      min-width: 12rem;
      max-width: 18rem;
      background: var(--mf-surface);
      text-align: left;
      font-weight: 600;
    }
    .bd__table tfoot th,
    .bd__table tfoot td {
      border-top: 2px solid var(--mf-border-strong);
      font-weight: 700;
    }
    /* One line of header: a long task type name is cut with an ellipsis, the whole name is the tooltip and the accessible name. */
    .bd__tn {
      display: block;
      max-width: 8rem;
      margin-left: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bd__typehead {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .bd__num {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      min-height: 24px;
      min-width: 24px;
      color: var(--mf-link);
      font-weight: 600;
    }
    /* Late work: the number is red AND carries a "!" (never colour alone); its accessible name says "N overdue". */
    .bd__num--late,
    .bd__late {
      color: var(--mf-due-overdue);
      font-weight: 700;
    }
    .bd__bang {
      margin-left: 2px;
    }
    .bd__none {
      color: var(--mf-text-muted);
    }
    .bd__legend {
      margin: var(--mf-s2) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .bd__total {
      margin: 0 0 var(--mf-s2);
      font-weight: 600;
    }
    .bd__cards {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bd__card {
      /* A card may be narrower than its longest word (a 100-character matter or type name): it wraps inside the phone instead of widening the page (PV-38). */
      min-width: 0;
      overflow-wrap: anywhere;
      padding: var(--mf-s1) var(--mf-s3) var(--mf-s2);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .bd__head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0 var(--mf-s3);
    }
    .bd__head h3 {
      flex: 1 1 10rem;
      margin: 0;
      font-size: var(--mf-fs-md);
      font-weight: 700;
    }
    .bd__head a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
    }
    .bd__sum {
      margin: 0;
      font-size: var(--mf-fs-sm);
    }
    .bd__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bd__chips li {
      min-width: 0;
      max-width: 100%;
    }
    .bd__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      min-height: 44px;
      max-width: 100%;
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: 999px;
      color: var(--mf-link);
      font-size: var(--mf-fs-sm);
    }
    .bd__chip b {
      font-variant-numeric: tabular-nums;
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
      .bd__pager .mf-btn,
      .bd__check {
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
      [bare]="bare()"
      (retry)="loader.load()"
    >
      @if (focusCount() > 0) {
        <span mfPanelActions class="bd__focus" data-bd-focus>{{ focusNoteText() }}</span>
      }
      @if (severalMatters()) {
        <div mfPanelActions mfSegmented role="group" aria-label="Matters shown">
          <button
            type="button"
            class="mf-btn"
            data-bd-view="matrix"
            [attr.aria-pressed]="view() === 'matrix'"
            (click)="setView('matrix')"
          >
            By matter
          </button>
          <button
            type="button"
            class="mf-btn"
            data-bd-view="types"
            [attr.aria-pressed]="view() === 'types'"
            (click)="setView('types')"
          >
            All together
          </button>
        </div>
      }
      @if (!bare()) {
        <mf-options-menu mfPanelActions label="Breakdown" [active]="status() === 'onHold' ? 1 : 0">
          <label class="bd__check">
            <input
              type="checkbox"
              data-bd-onhold
              [checked]="status() === 'onHold'"
              (change)="setStatus($any($event.target).checked ? 'onHold' : 'open')"
            />
            On hold only
          </label>
          <mf-export-menu
            [inline]="true"
            fileName="breakdown"
            [run]="exportRun"
            [disabled]="!data() || data()!.types.length === 0"
            reason="Nothing to export."
          />
        </mf-options-menu>
      }
      @if (data(); as d) {
        @if (d.types.length === 0) {
          <p class="bd__empty" data-empty>
            @if (focusCount() > 0) {
              No {{ noun().toLowerCase() }} of your Focus task types on these matters.
            } @else {
              No {{ noun().toLowerCase() }} on these matters.
            }
          </p>
        } @else if (!wide()) {
          <!-- A phone: the total once as a line, then one compact card per matter (or per task type), the task types as count chips (issue #912). -->
          <p class="bd__total" data-bd-total>
            {{ totalLine() }}
          </p>
          @if (view() === 'types') {
            <ul class="bd__cards" data-bd-cards="types">
              @for (t of d.types; track t.taskTypeId) {
                <li class="bd__card" data-bd-type>
                  <div class="bd__head">
                    <h3 class="bd__typehead">
                      <mf-task-type-badge
                        [iconKey]="t.iconKey"
                        [colourKey]="t.colourKey"
                        [name]="t.name"
                        [decorative]="true"
                      />{{ t.name }}
                    </h3>
                    <a
                      routerLink="/tasks"
                      [queryParams]="params(t.query)"
                      [attr.aria-label]="name(t.name, t.open, t.overdue)"
                      >{{ sumLine(t.open, t.overdue) }}</a
                    >
                  </div>
                  <p class="bd__sum">{{ t.atRisk }} at risk, {{ t.onHold }} on hold</p>
                </li>
              }
            </ul>
          } @else {
            <ul class="bd__cards" data-bd-cards="matrix">
              @for (r of d.rows; track r.matterId) {
                <li class="bd__card" data-bd-row [attr.data-matter-id]="r.matterId">
                  <div class="bd__head">
                    <h3>
                      <a [routerLink]="['/matters', r.matterId]"
                        >{{ r.matterRef }} {{ r.matterName }}</a
                      >
                    </h3>
                    <p class="bd__sum" [class.bd__late]="r.overdue > 0">
                      {{ sumLine(r.open, r.overdue) }}
                    </p>
                  </div>
                  <ul class="bd__chips">
                    @for (c of r.cells; track c.taskTypeId) {
                      <li data-bd-cell>
                        <a
                          class="bd__chip"
                          routerLink="/tasks"
                          [queryParams]="params(c.query)"
                          [attr.aria-label]="cellLabel(r, typeOf(d.types, c.taskTypeId), c)"
                          >{{ typeName(d.types, c.taskTypeId) }}
                          <b [class.bd__late]="c.overdue > 0">{{ c.open }}</b>
                          @if (c.overdue > 0) {
                            <span class="bd__late" aria-hidden="true">!</span>
                          }
                        </a>
                      </li>
                    }
                  </ul>
                </li>
              }
            </ul>
          }
        } @else if (view() === 'types') {
          <div class="bd__scroll" mfScrollRegion="Task types table">
            <table class="bd__table" data-bd-table="types">
              <caption class="mf-sr-only">
                {{
                  noun()
                }}
                per task type across all these matters.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Task type</th>
                  <th scope="col">{{ countLabel() }}</th>
                  <th scope="col">Overdue</th>
                  <th scope="col">At risk</th>
                  <th scope="col">On hold</th>
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
                          class="bd__num bd__num--late"
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
                  </tr>
                }
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All task types</th>
                  <td>
                    <a class="bd__num" routerLink="/tasks" [queryParams]="params(d.totals.query)">{{
                      d.totals.open
                    }}</a>
                  </td>
                  <td>
                    @if (d.totals.overdue > 0) {
                      <a
                        class="bd__num bd__num--late"
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
                </tr>
              </tfoot>
            </table>
          </div>
        } @else if (d.rows.length === 0) {
          <p class="bd__empty" data-empty>No {{ noun().toLowerCase() }} on these matters.</p>
        } @else {
          <div class="bd__scroll" mfScrollRegion="Breakdown table">
            <table class="bd__table" data-bd-table="matrix">
              <caption class="mf-sr-only">
                {{
                  noun()
                }}
                per matter and task type. A number opens the Task Queue with those tasks.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Matter</th>
                  @for (t of d.types; track t.taskTypeId) {
                    <th scope="col" data-bd-col [attr.title]="t.name">
                      <span class="bd__tn">{{ t.name }}</span>
                    </th>
                  }
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (r of d.rows; track r.matterId) {
                  <tr data-bd-row [attr.data-matter-id]="r.matterId">
                    <th scope="row" [attr.title]="r.clientName">
                      <a [routerLink]="['/matters', r.matterId]">{{ r.matterRef }}</a>
                      {{ r.matterName }}
                    </th>
                    @for (t of d.types; track t.taskTypeId) {
                      <td>
                        @if (cell(r, t.taskTypeId); as c) {
                          <a
                            class="bd__num"
                            [class.bd__num--late]="c.overdue > 0"
                            data-bd-cell
                            routerLink="/tasks"
                            [queryParams]="params(c.query)"
                            [attr.aria-label]="cellLabel(r, t, c)"
                            [attr.title]="c.overdue > 0 ? c.overdue + ' overdue' : null"
                            >{{ c.open }}
                            @if (c.overdue > 0) {
                              <span class="bd__bang" data-bd-overdue aria-hidden="true">!</span>
                            }
                          </a>
                        } @else {
                          <span class="bd__none" aria-label="None">-</span>
                        }
                      </td>
                    }
                    <td>
                      <span [class.bd__late]="r.overdue > 0"
                        ><strong>{{ r.open }}</strong>
                        @if (r.overdue > 0) {
                          <span class="bd__bang" aria-hidden="true">!</span
                          ><span class="mf-sr-only">, {{ r.overdue }} overdue</span>
                        }
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
              @if (d.matterTotal > 1) {
                <tfoot>
                  <tr data-bd-totals>
                    <th scope="row">
                      All matters{{ d.matterTotal > d.rows.length ? ' (all pages)' : '' }}
                    </th>
                    @for (t of d.types; track t.taskTypeId) {
                      <td>
                        <a
                          class="bd__num"
                          [class.bd__num--late]="t.overdue > 0"
                          routerLink="/tasks"
                          [queryParams]="params(t.query)"
                          [attr.aria-label]="name(t.name + ' on all matters', t.open, t.overdue)"
                          >{{ t.open }}
                          @if (t.overdue > 0) {
                            <span class="bd__bang" aria-hidden="true">!</span>
                          }
                        </a>
                      </td>
                    }
                    <td>
                      <a
                        class="bd__num"
                        [class.bd__num--late]="d.totals.overdue > 0"
                        routerLink="/tasks"
                        [queryParams]="params(d.totals.query)"
                        [attr.aria-label]="name('All matters', d.totals.open, d.totals.overdue)"
                        >{{ d.totals.open }}
                        @if (d.totals.overdue > 0) {
                          <span class="bd__bang" aria-hidden="true">!</span>
                        }
                      </a>
                    </td>
                  </tr>
                </tfoot>
              }
            </table>
          </div>
          @if (d.totals.overdue > 0) {
            <p class="bd__legend" data-bd-legend>! means some of these are overdue.</p>
          }
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
  private readonly exports = inject(ExportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly focus = inject(MyMattersFocus);
  /** The matters the person manages: the By matter / All together toggle is for several of them only. */
  private readonly managed = inject(ManagedMatters, { optional: true });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly wide = viewportAtLeast(TABLE_MIN_PX);

  /** The task types of the person's Focus: the Breakdown counts only these (issue #907). */
  protected readonly focusCount = computed(() => this.focus.types().length);
  protected readonly focusNoteText = computed(() => focusNote(this.focusCount()));

  /** Several matters (true when not known, so the toggle is never hidden by mistake). */
  protected readonly severalMatters = computed(
    () => this.filters().scope === 'all' || !this.managed || this.managed.only() === null,
  );
  /** `?bview=types` is "All together"; absent is "By matter". A person with one matter has only the matter row. */
  protected readonly view = computed<BreakdownView>(() =>
    this.severalMatters() && this.query().get('bview') === 'types' ? 'types' : 'matrix',
  );
  /** `?bstatus=onHold` counts only the tasks on hold. */
  protected readonly status = computed<BreakdownStatus>(() =>
    this.query().get('bstatus') === 'onHold' ? 'onHold' : 'open',
  );
  protected readonly pageNo = computed(() => {
    const n = Number.parseInt(this.query().get('bpage') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  });

  constructor() {
    this.focus.ensure();
  }

  protected readonly loader = panelLoader(
    () => [this.filters(), this.view(), this.status(), this.pageNo(), this.focus.types()],
    () => {
      const a = commonArgs(this.filters());
      const focus = this.focus.types();
      return this.api.getMyMattersBreakdown(
        this.view(),
        this.status(),
        focus.length > 0 ? [...focus] : undefined,
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
  /** No task of any type on these matters (and neither the status choice nor the Focus is what hides them): one muted line, no controls (issue #920). */
  protected readonly bare = computed(
    () =>
      this.status() === 'open' &&
      this.focusCount() === 0 &&
      !!this.data() &&
      this.data()!.types.length === 0,
  );
  protected readonly noun = computed(() =>
    this.status() === 'onHold' ? 'Tasks on hold' : 'Open tasks',
  );
  protected readonly countLabel = computed(() => (this.status() === 'onHold' ? 'On hold' : 'Open'));
  /** The word beside a count: "open", or "on hold". */
  private readonly word = computed(() => (this.status() === 'onHold' ? 'on hold' : 'open'));
  protected readonly pageCount = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.matterTotal / d.pageSize)) : 1;
  });
  /** The phone's one total line: "24 open, 9 overdue". */
  protected readonly totalLine = computed(() => {
    const d = this.data();
    return d ? breakdownTotalLine(d.totals.open, d.totals.overdue, this.word()) : '';
  });

  /** The table on screen as a list (PM v2, #879): by matter, one column per task type (plus the "All matters" row for several matters); all together, one row per task type. */
  protected readonly exportRun = async (format: ExportFormat): Promise<ExportResult> => {
    const d = this.data();
    if (!d) return { text: '', rows: 0 };
    let header: string[];
    let rows: (string | number)[][];
    if (this.view() === 'types') {
      header = ['Task type', this.countLabel(), 'Overdue', 'At risk', 'On hold'];
      rows = d.types.map((t) => [t.name, t.open, t.overdue, t.atRisk, t.onHold]);
    } else {
      header = [
        'Matter',
        'Matter name',
        'Client',
        ...d.types.map((t) => `${t.name} (${this.countLabel().toLowerCase()})`),
        `${this.countLabel()} in total`,
        'Overdue in total',
      ];
      rows = d.rows.map((r) => [
        r.matterRef,
        r.matterName,
        r.clientName,
        ...d.types.map((t) => this.cell(r, t.taskTypeId)?.open ?? 0),
        r.open,
        r.overdue,
      ]);
      if (d.matterTotal > 1)
        rows.push([
          'All matters',
          '',
          '',
          ...d.types.map((t) => t.open),
          d.totals.open,
          d.totals.overdue,
        ]);
    }
    const text = buildList(format, header, rows);
    void this.exports.log(
      'my-matters.breakdown',
      format,
      rows.length,
      `${this.view()}, ${this.status()}, page ${this.pageNo()}${this.focusCount() > 0 ? ', focus' : ''}`,
    );
    return { text, rows: rows.length };
  };

  protected params(query: string): Params {
    return queryToParams(query);
  }

  protected cell(row: BreakdownRow, typeId: number): BreakdownCell | undefined {
    return row.cells.find((c) => c.taskTypeId === typeId);
  }

  protected cellLabel(
    row: BreakdownRow,
    type: BreakdownType | undefined,
    c: BreakdownCell,
  ): string {
    return breakdownCountName(
      `${row.matterRef}, ${type?.name ?? ''}`,
      c.open,
      c.overdue,
      this.word(),
    );
  }

  /** "MAT-1 in all: 8 open, 5 overdue" and the like. */
  protected name(where: string, count: number, overdue: number): string {
    return breakdownCountName(where, count, overdue, this.word());
  }

  /** "8 open, 5 overdue". */
  protected sumLine(count: number, overdue: number): string {
    return breakdownTotalLine(count, overdue, this.word());
  }

  protected typeOf(types: readonly BreakdownType[], id: number): BreakdownType | undefined {
    return types.find((t) => t.taskTypeId === id);
  }

  protected typeName(types: readonly BreakdownType[], id: number): string {
    return this.typeOf(types, id)?.name ?? '';
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
