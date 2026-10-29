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
import { Pager } from '../../../shared/ui/pager';
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
import { panelLoader } from '../panel-loader';
import { PREFILTERS, MmPrefilter, prefilterParams } from '../prefilter';
import { PrefilterSelect } from '../prefilter-select';
import { PanelBox } from './panel-box';
import { PANEL_LIST_STYLES } from './panel-styles';

/** Rows per page (issue #943). */
export const GRID_PAGE_SIZE = 25;

/** The order the grid opens in (issue #935): urgency, most urgent first. */
const DEFAULT_SORT = 'attention';

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
  priority: 5.5,
  assignee: 6.5,
  due: 7.5,
  status: 6.5,
};

/** The sorts that start descending (the newest first), as in the Task Queue. */
const DESC_FIRST = new Set(['created', 'updated', 'completed', 'closed']);

/**
 * The one grid of the Overview (epic #893 issue #943): the person's open tasks as the shared table of the Tasks pages (`mf-task-table`: the same columns, sortable
 * headings with `aria-sort`, and below 640 px the same cards), over `GET /task-queue` with the page's Client, Matter, Role and Scope and the person's Focus. It replaces
 * Needs my attention and Next 7 days: the pre-filter dropdown (issue #942) narrows it in place (Overdue, At risk, Unassigned, On hold, Due soon), the default order is
 * Urgency (issue #935: overdue oldest first, at risk, due today, unassigned with a date within 7 days, on hold more than 7 days, then the rest by due date), a click on a heading
 * sorts the whole set on the server, and the grid pages (25 a page). Every task is listed once. The table is read-only here (this is for reading and opening a task).
 */
@Component({
  selector: 'mf-mm-grid',
  imports: [ExportMenu, OptionsMenu, PanelBox, Pager, PrefilterSelect, RouterLink, TaskTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: [
    PANEL_LIST_STYLES,
    `
      .tg__actions {
        display: contents;
      }
      /* What the grid shows ("16 overdue tasks") and the one way back. */
      .tg__status {
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s2);
        color: var(--mf-text-muted);
      }
      .tg__clear {
        min-height: 24px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--mf-link);
        font: inherit;
        cursor: pointer;
      }
      .tg__clear:hover {
        text-decoration: underline;
      }
      .tg__only {
        min-width: 0;
        color: var(--mf-text-muted);
        overflow-wrap: anywhere;
      }
      .tg__only a {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        color: var(--mf-link);
      }
      /* The default order of the grid is Urgency (issue #935): it has no column, so it is named here, marked like the active heading (underlined, bold) and a
         click on it brings the order back after a heading was chosen. */
      .tg__urgency {
        display: inline-flex;
        align-items: center;
        gap: var(--mf-s1);
        min-height: 24px;
        padding: 0;
        border: 0;
        background: none;
        color: var(--mf-text-muted);
        font: inherit;
        cursor: pointer;
      }
      .tg__urgency[aria-pressed='true'] {
        color: var(--mf-text);
        font-weight: 700;
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .tg__urgency:focus-visible,
      .tg__clear:focus-visible {
        outline: 2px solid var(--mf-focus);
        outline-offset: 2px;
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
      /* A heading row of 28 px (the rows are 36): the first task sits higher on the first screen; the sort button fills it (a 28 px target). */
      :host ::ng-deep .tg__grid .wt thead th {
        height: 28px;
        padding-block: 0;
      }
      /* The sort button is a 32 px target inside the 28 px heading row (the extra 2 px each side overlap the row's padding, so the row stays low). */
      :host ::ng-deep .tg__grid .wt-sort {
        min-height: 32px;
        margin-block: -2px;
      }
      /* On a page that scrolls as a whole (a phone, a short window) the table is a plain block; in a fixed page it fills what is left (shared/ui/fixed-page.ts). */
      @media (max-width: 767px), (max-height: 560px) {
        :host ::ng-deep .tg__grid.mf-fill {
          display: block;
        }
      }
      .tg__pager {
        display: block;
        max-width: 82rem;
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
        .tg__urgency,
        .tg__clear {
          min-height: 44px;
        }
        .tg__only {
          display: none;
        }
      }
    `,
  ],
  template: `
    <mf-mm-panel
      name="tasks"
      title="Open tasks"
      [fill]="true"
      [hint]="hint"
      [flat]="true"
      [skeleton]="6"
      [state]="loader.state()"
      [busy]="loader.busy()"
      (retry)="loader.load()"
    >
      <span mfPanelStart class="tg__start">
        @if (selectShown()) {
          <mf-mm-prefilter
            [filters]="filters()"
            [show]="show()"
            (showChange)="filterChange.emit({ show: $event })"
          />
        }
        @if (show() !== 'open') {
          <span class="tg__status" role="status" data-grid-status>
            <span>{{ statusText() }}</span>
            <button
              type="button"
              class="tg__clear"
              data-clear-prefilter
              (click)="filterChange.emit({ show: 'open' })"
            >
              Clear filter
            </button>
          </span>
        }
        @if (only(); as m) {
          <span class="tg__only" data-grid-matter
            >on <a [routerLink]="['/matters', m.matterId]">{{ m.matterRef }} {{ m.name }}</a></span
          >
        }
      </span>
      <span mfPanelActions class="tg__actions">
        <ng-content select="[mfGridActions]" />
        @if (total() > 1) {
          <button
            type="button"
            class="tg__urgency"
            data-sort-urgency
            aria-label="Sort by urgency, most urgent first"
            [attr.aria-pressed]="sort() === 'attention'"
            (click)="chosen.set(null)"
          >
            <i class="pi pi-sort-amount-down" aria-hidden="true"></i>
            Urgency
          </button>
        }
        @if (total() > 0) {
          <mf-options-menu label="Open tasks">
            <mf-export-menu
              [inline]="true"
              fileName="open-tasks"
              [run]="exportRun"
              [disabled]="rows().length === 0"
              reason="Nothing to export."
            />
          </mf-options-menu>
        }
      </span>
      @if (rows().length === 0) {
        @if (focused() && show() === 'open') {
          <p class="pl__empty" data-empty data-filtered-empty>
            Nothing in your Focus is open.
            <button type="button" class="mf-btn mf-btn--text" data-show-all (click)="focus.clear()">
              Clear Focus
            </button>
          </p>
        } @else if (show() !== 'open') {
          <p class="pl__empty" data-empty>No {{ prefilterNoun() }}.</p>
        } @else {
          <p class="pl__empty" data-empty>No open tasks.</p>
        }
      } @else {
        <mf-task-table
          class="tg__grid"
          data-grid="tasks"
          [rows]="rows()"
          [columns]="columns()"
          caption="Open tasks"
          [state]="loader.busy() ? 'loading' : 'ready'"
          [sort]="sort()"
          [dir]="dir()"
          [density]="'compact'"
          [readOnly]="true"
          [scrollStopWhenScrolling]="true"
          [quiet]="true"
          [colWidths]="widths()"
          [widthsEditable]="false"
          [canHideColumns]="false"
          [phoneCards]="true"
          [origin]="'my-matters'"
          [rowList]="rowList"
          (sortChange)="sortBy($event)"
        />
        @if (total() > pageSize) {
          <mf-pager
            class="tg__pager"
            [page]="page()"
            [pageSize]="pageSize"
            [pageSizes]="[]"
            [total]="total()"
            (pageChange)="goPage($event)"
          />
        }
      }
    </mf-mm-panel>
  `,
})
export class TaskGrid {
  protected readonly hint =
    'Most urgent first: overdue, at risk, due today, unassigned with a date within 7 days, then on hold for more than 7 days. Click a heading to sort.';
  protected readonly rowList = 'my-matters-tasks';
  protected readonly pageSize = GRID_PAGE_SIZE;

  /** Column widths in rem: Due is never cut ("Overdue 126d" in full), Matter and the others stay short; the Title takes the rest. */
  private readonly wide = viewportAtLeast(1000);
  protected readonly widths = computed(() => (this.wide() ? WIDE_WIDTHS : TABLET_WIDTHS));

  readonly filters = input.required<MmFilters>();
  /** The matter's name is a column: the person has several matters (it would say the same on every row for one). */
  readonly showMatter = input(false);
  /** The person's one matter: named after the heading (wide screens), where the six tiles used to name it. */
  readonly only = input<{ matterId: number; matterRef: string; name: string } | null>(null);
  readonly filterChange = output<Partial<MmFilters>>();

  private readonly api = inject(TaskQueueClient);
  private readonly exports = inject(ExportService);
  protected readonly focus = inject(MyMattersFocus);
  protected readonly focused = computed(() => this.focus.types().length > 0);
  protected readonly show = computed<MmPrefilter>(() => this.filters().show);

  /** The person's own sort (null: the default order, Urgency). */
  protected readonly chosen = signal<{ field: string; dir: 'asc' | 'desc' } | null>(null);
  protected readonly sort = computed(() => this.chosen()?.field ?? DEFAULT_SORT);
  protected readonly dir = computed(() => this.chosen()?.dir ?? 'asc');

  /** The Task Queue filters that count this grid: the page's scope, role and client, the open statuses, the pre-filter and the Focus. */
  private readonly baseParams = computed(() => {
    const a = commonArgs(this.filters());
    const params: Record<string, string | string[]> = {
      ...(a.scope === 'all' ? {} : { managedByMe: 'true' }),
      ...(a.managerId === undefined ? {} : { managerId: String(a.managerId) }),
      ...(a.role === undefined ? {} : { role: a.role }),
      ...(a.clientId === undefined ? {} : { client: String(a.clientId) }),
      ...(a.matterId === undefined ? {} : { matter: String(a.matterId) }),
      status: [...OPEN_STATUSES],
      ...prefilterParams(this.show()),
    };
    const types = this.focus.types();
    if (types.length > 0) params['type'] = types.map(String);
    return params;
  });

  /** The page shown: back to the first when the filters or the order change (the page is kept with the filters and the order it was chosen under). */
  private readonly pageAt = signal<{ key: string; page: number }>({ key: '', page: 1 });
  private readonly key = computed(() =>
    JSON.stringify([this.baseParams(), this.sort(), this.dir()]),
  );
  protected readonly page = computed(() =>
    this.pageAt().key === this.key() ? this.pageAt().page : 1,
  );

  protected readonly loader = panelLoader(
    () => [this.baseParams(), this.sort(), this.dir(), this.page()],
    () => {
      const base = parseQueueState(convertToParamMap(this.baseParams()));
      const request = queueArgs({
        ...base,
        sort: this.sort(),
        dir: this.dir(),
        page: this.page(),
        pageSize: GRID_PAGE_SIZE,
      });
      return this.api.getTaskQueue(undefined, ...request);
    },
  );

  protected readonly rows = computed<TaskQueueRow[]>(() => this.loader.data()?.items ?? []);
  protected readonly total = computed(() => this.loader.data()?.total ?? 0);

  /** The dropdown is there while there is something to choose from: not for a person with no open task at all (one muted line instead). */
  protected readonly selectShown = computed(
    () => this.total() > 0 || this.show() !== 'open' || this.focused(),
  );

  protected readonly prefilterNoun = computed(() => PREFILTERS[this.show()].noun);
  /** "16 overdue tasks": what the grid shows, said (not only in the dropdown). */
  protected readonly statusText = computed(() => {
    const info = PREFILTERS[this.show()];
    const n = this.total();
    return `${n} ${n === 1 ? info.one : info.noun}`;
  });

  protected readonly columns = computed(() => [
    'ref',
    'title',
    ...(this.showMatter() ? ['matterName'] : []),
    'priority',
    'assignee',
    'due',
    'status',
  ]);

  constructor() {
    this.focus.ensure();
    restoreRowFocus(
      () => this.rowList,
      () => this.loader.state() === 'ready',
    );
    effect(() => {
      // A page past the last one (the filters shrank the set) steps back to the last.
      const pages = Math.max(1, Math.ceil(this.total() / GRID_PAGE_SIZE));
      if (this.loader.state() === 'ready' && this.page() > pages) this.goPage(pages);
    });
  }

  protected goPage(page: number): void {
    this.pageAt.set({ key: this.key(), page });
  }

  /** A click on a heading: the same field turns the order round, another field starts in its natural direction. */
  protected sortBy(field: string): void {
    const current = this.sort();
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
      'my-matters.attention',
      format,
      rows.length,
      this.focused() ? 'focus applied' : '',
    );
    return { text, rows: rows.length };
  };
}
