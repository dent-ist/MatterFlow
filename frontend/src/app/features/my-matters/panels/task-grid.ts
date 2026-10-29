import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, convertToParamMap } from '@angular/router';
import { TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { ExportMenu, ExportResult } from '../../../shared/ui/export-menu';
import { ExportService } from '../../../shared/ui/export.service';
import { ExportFormat, buildList } from '../../../shared/ui/list-export';
import { OptionsMenu } from '../../../shared/ui/options-menu';
import { viewportAtLeast } from '../../../shared/ui/viewport';
import { restoreRowFocus } from '../../../shared/ui/row-nav';
import {
  OPEN_STATUSES,
  parseQueueState,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { TaskTable } from '../../../shared/work-queue/task-table';
import { QUEUE_ROW_HEADER, queueRowExport } from '../export-rows';
import { MyMattersFocus } from '../focus';
import { MmFilters, commonArgs } from '../my-matters-filters';
import { OverviewStates } from '../overview-states';
import { panelLoader } from '../panel-loader';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

export type GridKind = 'attention' | 'deadlines';

/** How many rows each grid shows (owner decisions: five for Needs my attention, three for Next 7 days). */
export const ATTENTION_ROWS = 5;
export const NEXT_DAYS_ROWS = 3;

interface GridConfig {
  title: string;
  hint: string;
  /** Rows shown. */
  rows: number;
  /** Rows asked for: the Next 7 days grid also gets the rows Needs my attention already lists, which it leaves out, so it can still fill its own. */
  fetch: number;
  /** The Task Queue's own filter that counts this list. */
  filter: Record<string, string>;
  /** The default order, also what "View all" opens. */
  sort: string;
  rowList: string;
  exportName: string;
  surface: string;
  /** "View all N tasks that need attention". */
  allName: string;
  /** The same for exactly one task ("View all 1 task that needs attention"). */
  allNameOne: string;
  nothing: string;
  nothingInFocus: string;
}

const CONFIG: Readonly<Record<GridKind, GridConfig>> = {
  attention: {
    title: 'Needs my attention',
    hint: 'Overdue, at risk, due today, unassigned with a date within 7 days, or on hold for more than 7 days. Soonest due first; click a heading to sort.',
    rows: ATTENTION_ROWS,
    fetch: ATTENTION_ROWS,
    filter: { needsAttention: 'true' },
    sort: 'due',
    rowList: 'my-matters-attention',
    exportName: 'needs-my-attention',
    surface: 'my-matters.attention',
    allName: 'tasks that need attention',
    allNameOne: 'task that needs attention',
    nothing: 'Nothing needs your attention.',
    nothingInFocus: 'Nothing in your Focus needs your attention.',
  },
  deadlines: {
    title: 'Next 7 days',
    hint: 'Open tasks due from today to seven days ahead, not overdue. Soonest due first; click a heading to sort.',
    rows: NEXT_DAYS_ROWS,
    fetch: NEXT_DAYS_ROWS + ATTENTION_ROWS,
    filter: { dueWithin: '7' },
    sort: 'due',
    rowList: 'my-matters-deadlines',
    exportName: 'next-7-days',
    surface: 'my-matters.deadlines',
    allName: 'tasks due in the next 7 days',
    allNameOne: 'task due in the next 7 days',
    nothing: 'Nothing is due in the next 7 days.',
    nothingInFocus: 'Nothing in your Focus is due in the next 7 days.',
  },
};

/** Column widths in rem of the wide grid: Due is never cut, the Matter and the others stay short. */
const WIDE_WIDTHS: Record<string, number> = {
  matterName: 14,
  priority: 6.5,
  assignee: 8,
  due: 9.5,
  status: 7.5,
};
/** A tablet: every column at its narrowest, so the grid fits 768 px without scrolling sideways (the Title keeps 10 rem). */
const TABLET_WIDTHS: Record<string, number> = {
  ref: 5,
  matterName: 7,
  priority: 6,
  assignee: 7,
  due: 7.5,
  status: 7,
};

/** The sorts that start descending (the newest first), as in the Task Queue. */
const DESC_FIRST = new Set(['created', 'updated', 'completed', 'closed']);

/**
 * Needs my attention and Next 7 days as grids (epic #893 issue #929): the SAME table as the Tasks pages (`mf-task-table`), with the same columns, the same sortable
 * headings (`aria-sort`, the sort icon) and, below 640 px, the same cards, over the Task Queue endpoint with the page's Client / Role / Scope filters and the person's
 * Focus. Each grid shows the first rows of the sort in force (five and three) and "View all N" opens the Task Queue with exactly the filter that counts them, in the
 * same order, so the tiles, this number and that list agree. The table is read-only here (no inline editors: this is for reading and opening a task).
 *
 * - Needs my attention = the Task Queue's `needsAttention=true` (overdue, at risk, due today, unassigned with a date within 7 days, on hold too long).
 * - Next 7 days = `dueWithin=7` (open, due today to seven days ahead, not overdue), and it leaves out the tasks Needs my attention lists: a task is listed once per
 *   screen, in its most urgent place (so it asks for more rows than it shows).
 *
 * The default order is the Due column, soonest first (overdue work, oldest first, comes first); a click on a heading sorts the whole set, not just the rows on screen.
 */
@Component({
  selector: 'mf-mm-grid',
  imports: [ExportMenu, OptionsMenu, PanelBox, RouterLink, TaskTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    PANEL_LIST_STYLES,
    `
      .tg__all {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        color: var(--mf-link);
        font-weight: 600;
      }
      .tg__actions {
        display: contents;
      }
      /* The table sits in the section like a list: no shadow, no second frame inside the flat section. */
      :host ::ng-deep .tg__grid .wt-wrap {
        box-shadow: none;
        overflow-y: visible;
      }
      /* The rows do not spread over a very wide screen: a short Title would leave a big gap before Priority. */
      :host ::ng-deep .tg__grid {
        max-width: 82rem;
      }
      /* A heading row of 30 px (the rows are 36): the first task sits higher on the first screen. */
      :host ::ng-deep .tg__grid .wt thead th {
        height: 30px;
      }
      :host ::ng-deep .tg__grid .wt-sort {
        min-height: 24px;
      }
      :host ::ng-deep .tg__grid.mf-fill {
        display: block;
      }
      @media (max-width: 639.98px) {
        :host ::ng-deep .tg__grid .wt-sort {
          min-height: 44px;
        }
        /* The cards' links (title, matter) are 44 px targets on a phone. */
        :host ::ng-deep .tg__grid a,
        :host ::ng-deep .tg__grid a.mf-ref {
          display: inline-flex;
          align-items: center;
          min-height: 44px;
        }
        .tg__all {
          min-height: 44px;
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      [name]="kind()"
      [title]="cfg().title"
      [hint]="cfg().hint"
      [flat]="true"
      [skeleton]="cfg().rows"
      [state]="loader.state()"
      [busy]="loader.busy()"
      [bare]="bare()"
      (retry)="loader.load()"
    >
      <span mfPanelActions class="tg__actions">
        <ng-content select="[mfGridActions]" />
        @if (!bare() && total() > 0) {
          <a
            class="tg__all"
            data-view-all
            routerLink="/tasks"
            [queryParams]="allParams()"
            [attr.aria-label]="
              'View all ' + total() + ' ' + (total() === 1 ? cfg().allNameOne : cfg().allName)
            "
            >View all {{ total() }}</a
          >
        }
        @if (!bare() && kind() === 'attention') {
          <mf-options-menu [label]="cfg().title">
            <mf-export-menu
              [inline]="true"
              [fileName]="cfg().exportName"
              [run]="exportRun"
              [disabled]="rows().length === 0"
              reason="Nothing to export."
            />
          </mf-options-menu>
        }
      </span>
      @if (rows().length === 0) {
        @if (focused()) {
          <p class="pl__empty" data-empty data-filtered-empty>
            {{ cfg().nothingInFocus }}
            <button type="button" class="mf-btn mf-btn--text" data-show-all (click)="focus.clear()">
              Clear Focus
            </button>
          </p>
        } @else if (leftOut() > 0 && kind() === 'deadlines') {
          <p class="pl__empty" data-empty data-all-above>
            Everything due in the next 7 days is listed under Needs my attention.
          </p>
        } @else {
          <p class="pl__empty" data-empty>{{ cfg().nothing }}</p>
        }
      } @else {
        <mf-task-table
          class="tg__grid"
          [attr.data-grid]="kind()"
          [rows]="rows()"
          [columns]="columns()"
          [caption]="cfg().title"
          [state]="loader.busy() ? 'loading' : 'ready'"
          [sort]="sort()"
          [dir]="dir()"
          [density]="'compact'"
          [readOnly]="true"
          [quiet]="true"
          [colWidths]="widths()"
          [widthsEditable]="false"
          [canHideColumns]="false"
          [phoneCards]="true"
          [origin]="'my-matters'"
          [rowList]="cfg().rowList"
          (sortChange)="sortBy($event)"
        />
      }
    </mf-mm-panel>
  `,
})
export class TaskGrid {
  /** Column widths in rem: Due is never cut ("Overdue 126d" in full), Matter and the others stay short; the Title takes the rest. */
  private readonly wide = viewportAtLeast(1000);
  protected readonly widths = computed(() => (this.wide() ? WIDE_WIDTHS : TABLET_WIDTHS));
  readonly kind = input.required<GridKind>();
  readonly filters = input.required<MmFilters>();
  /** The matter's name is a column: the person has several matters (it would say the same on every row for one). */
  readonly showMatter = input(false);
  /** Task ids already listed above: this grid leaves them out (a task is listed once per screen). */
  readonly exclude = input<readonly number[]>([]);
  /** The ids of the tasks listed, for the page. */
  readonly listed = output<number[]>();

  private readonly api = inject(TaskQueueClient);
  private readonly exports = inject(ExportService);
  private readonly states = inject(OverviewStates, { optional: true });
  protected readonly focus = inject(MyMattersFocus);
  protected readonly cfg = computed(() => CONFIG[this.kind()]);
  protected readonly focused = computed(() => this.focus.types().length > 0);

  /** The person's own sort (null: the default order). */
  protected readonly chosen = signal<{ field: string; dir: 'asc' | 'desc' } | null>(null);
  protected readonly sort = computed(() => this.chosen()?.field ?? this.cfg().sort);
  protected readonly dir = computed(() => this.chosen()?.dir ?? 'asc');

  /** The Task Queue filters that count this grid: the page's scope, role and client, the open statuses, the list's own filter and the Focus. */
  private readonly baseParams = computed(() => {
    const a = commonArgs(this.filters());
    const params: Record<string, string | string[]> = {
      ...(a.scope === 'all' ? {} : { managedByMe: 'true' }),
      ...(a.managerId === undefined ? {} : { managerId: String(a.managerId) }),
      ...(a.role === undefined ? {} : { role: a.role }),
      ...(a.clientId === undefined ? {} : { client: String(a.clientId) }),
      status: [...OPEN_STATUSES],
      ...this.cfg().filter,
    };
    const types = this.focus.types();
    if (types.length > 0) params['type'] = types.map(String);
    return params;
  });

  protected readonly loader = panelLoader(
    () => [this.kind(), this.baseParams(), this.chosen()],
    () => {
      const base = parseQueueState(convertToParamMap(this.baseParams()));
      const request = queueArgs({
        ...base,
        sort: this.sort(),
        dir: this.dir(),
        page: 1,
        pageSize: this.cfg().fetch,
      });
      return this.api.getTaskQueue(undefined, ...request);
    },
  );

  /** The rows the Task Queue returned, before the ones listed above are left out. */
  private readonly all = computed<TaskQueueRow[]>(() => this.loader.data()?.items ?? []);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);
  protected readonly leftOut = computed(() => {
    const skip = new Set(this.exclude());
    return this.all().filter((t) => skip.has(t.taskId)).length;
  });
  protected readonly rows = computed<TaskQueueRow[]>(() => {
    const skip = new Set(this.exclude());
    return this.all()
      .filter((t) => !skip.has(t.taskId))
      .slice(0, this.cfg().rows);
  });

  /** Nothing to show and no Focus hiding anything: one muted line, no toolbar (issue #920). */
  protected readonly bare = computed(
    () => this.loader.state() === 'ready' && this.total() === 0 && !this.focused(),
  );

  protected readonly columns = computed(() => [
    'ref',
    'title',
    ...(this.showMatter() ? ['matterName'] : []),
    'priority',
    'assignee',
    'due',
    'status',
  ]);

  /** "View all N": the Task Queue with the filter that counts these tasks, in the order in force. */
  protected readonly allParams = computed(() => ({
    ...this.baseParams(),
    sort: this.sort(),
    dir: this.dir(),
  }));

  constructor() {
    this.focus.ensure();
    restoreRowFocus(
      () => this.cfg().rowList,
      () => this.loader.state() === 'ready',
    );
    effect(() => {
      this.states?.report(this.kind(), this.bare() ? 'empty' : 'content');
    });
    effect(() => this.listed.emit(this.rows().map((t) => t.taskId)));
  }

  /** A click on a heading: the same field turns the order round, another field starts in its natural direction. */
  protected sortBy(field: string): void {
    const now = this.chosen();
    const current = now?.field ?? this.cfg().sort;
    if (current === field) {
      this.chosen.set({ field, dir: this.dir() === 'asc' ? 'desc' : 'asc' });
    } else {
      this.chosen.set({ field, dir: DESC_FIRST.has(field) ? 'desc' : 'asc' });
    }
  }

  /** The rows on screen as a list: the export is logged, never the data. */
  protected readonly exportRun = async (format: ExportFormat): Promise<ExportResult> => {
    const rows = this.rows().map((t) => queueRowExport(t));
    const text = buildList(format, QUEUE_ROW_HEADER, rows);
    void this.exports.log(
      this.cfg().surface,
      format,
      rows.length,
      this.focused() ? 'focus applied' : '',
    );
    return { text, rows: rows.length };
  };
}
