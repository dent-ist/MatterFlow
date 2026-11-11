import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { convertToParamMap } from '@angular/router';
import { DashboardSummary, TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { FilterDef } from '../../../shared/filters/filter-def';
import { ListFilters } from '../../../shared/filters/list-filters';
import { ListToolbar } from '../../../shared/filters/list-toolbar';
import { queueFilterDefs } from '../../../shared/filters/queue-defs';
import { GridColumns } from '../../../shared/ui/grid-columns';
import {
  DEFAULT_GRID_PREFS,
  GridColumnDef,
  GridPrefs,
  clearGridPrefs,
  gridPrefsKey,
  loadGridPrefs,
  moveBefore,
  saveGridPrefs,
  shownKeys,
} from '../../../shared/ui/grid-prefs';
import { phoneCards } from '../../../shared/ui/record-card-list';
import { ColumnMove } from '../../../shared/ui/reorder-columns';
import { SortedLine } from '../../../shared/ui/sorted-line';
import { ColumnAction } from '../../../shared/work-queue/column-menu-items';
import { ColumnWidthMap, pxToRem } from '../../../shared/work-queue/column-widths';
import { PhoneSort, SortChoice, SortOption } from '../../../shared/work-queue/phone-sort';
import { QueueChoices } from '../../../shared/work-queue/queue-choices';
import {
  OPEN_STATUSES,
  QueueFilters,
  SortDirection,
  parseQueueState,
  taskQueueArgs,
} from '../../../shared/work-queue/queue-filters';
import { SORT_LABELS } from '../../../shared/work-queue/sort-note';
import { WorkList, WorkListState } from '../../../shared/work-queue/work-list';
import { WorkWidths } from '../../../shared/work-queue/work-widths';
import { queueParams } from '../dashboard-links';
import { CARD_KEYS, CardKey, isCardKey } from './dash-cards';
import { IntPipe } from '../../../shared/ui/number-format';
export { DASH_GRID_PARAMS } from './dash-grid-params';

/**
 * The standard task column order (decision AR 5 to 7). Title cannot be hidden. The default set fits the 718 px frame of 1366 with the right panel shown (D-43a, #1236):
 * Type (128, chip and name), Title, Priority, Assignee, Due. Ref (pinned first when added), CM Number, Matter Name, Project, Status and Progress are one click away in Columns.
 */
export const SUMMARY_GRID_COLUMNS: readonly GridColumnDef[] = [
  { key: 'ref', label: 'Ref', pinned: true, defaultHidden: true },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title', locked: true },
  { key: 'matter', label: 'CM Number', defaultHidden: true },
  { key: 'matterName', label: 'Matter Name', defaultHidden: true },
  { key: 'project', label: 'Project', defaultHidden: true },
  { key: 'priority', label: 'Priority' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'due', label: 'Due' },
  { key: 'status', label: 'Status', defaultHidden: true },
  { key: 'progress', label: 'Progress', defaultHidden: true },
];

/** The page size of a list (decision AR 10): 50, chosen from 25 / 50 / 100. */
const PAGE_SIZE = 50;
/** Default width of the Assignee column (px): the person's name, or "Unassigned" with its chevron (the one control), on one line, as in Task Queue. */
export const ASSIGNEE_PX = 136;
const CARD_NAMES: Record<CardKey, string> = {
  overdue: 'Overdue',
  unassigned: 'Unassigned',
  onHold: 'On Hold',
};
const EMPTY_TEXT: Record<CardKey, string> = {
  overdue: 'Nothing is overdue.',
  unassigned: 'No unassigned tasks.',
  onHold: 'Nothing is on hold.',
};
/** The filters this grid offers (the shared Task Queue definitions, limited to what the Summary needs). `pod` is left out: the Dashboard Scope is the pod. */
const KEPT = new Set([
  'q',
  'status',
  'matterText',
  'projectText',
  'type',
  'priority',
  'assignee',
  'due',
]);
const OWNED_BY_CARD: Record<CardKey, readonly string[]> = {
  overdue: ['status', 'due'],
  unassigned: ['status', 'assignee'],
  onHold: ['status'],
};

/**
 * The task grid of the Dashboard Summary (epic #1063, DB-03): the shared list standard (theme guide 11.1) over the Task Queue endpoint. The base query is the card's (`Overdue`,
 * `Unassigned`, `On Hold`: the server's own query for that count, scope included) or the scope's open tasks when no card is on; Search and Filters narrow it further and never change
 * the cards' counts. Standard column order (Ref, Type, Title, CM Number, Matter Name, Project, Priority, Assignee, Due, Status, Progress), 50 rows a page, the frame scrolls sideways
 * with Ref pinned. The Type column is the standard chip and name, Due shows `+9d` on one line, an unassigned task's Assignee cell is "Unassigned" with a chevron (the one control), and while the Unassigned card is on an
 * extra "Unassigned for" column shows and the grid sorts longest waiting first. An assignment is reported (`assigned`) so the page can refresh the cards, the gauge and the battery.
 */
@Component({
  selector: 'mf-dash-grid',
  imports: [IntPipe, ListToolbar, GridColumns, SortedLine, PhoneSort, WorkList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styles: `
    :host {
      display: flex;
      min-height: 0;
      min-width: 0;
      flex-direction: column;
    }
    .frame {
      display: flex;
      min-height: 0;
      min-width: 0;
      flex: 1 1 auto;
      flex-direction: column;
      overflow: hidden;
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-soft);
      border-radius: var(--mf-radius-xl);
    }
    h2 {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .body {
      display: flex;
      min-height: 0;
      flex: 1 1 auto;
      flex-direction: column;
      padding: var(--mf-s3) var(--mf-s3) var(--mf-s2);
    }
  `,
  template: `
    <section class="frame" data-dash-grid aria-labelledby="dg-title">
      <!-- No title row (DB-09): the toolbar is the first row. The heading stays for screen readers and the total is the footer's "Showing 1-50 of N"; the hidden count keeps the figure for assistive tools and specs. -->
      <h2 id="dg-title">
        {{ heading() }}
        @if (state() === 'ready') {
          <span data-list-count>{{ total() | mfInt }}</span>
        }
      </h2>
      <div class="body">
        <mf-list-toolbar [filters]="filters" [controls]="filterRowId" searchLabel="Search tasks">
          @if (!phone()) {
            <mf-grid-columns
              mfColumns
              [defs]="gridDefs()"
              [prefs]="prefs()"
              (prefsChange)="setPrefs($event)"
              [widthReset]="true"
              (resetColumns)="resetPrefs()"
              (resetWidths)="resetWidths()"
            />
          }
          <mf-phone-sort
            mfSheetSort
            [sort]="sortField()"
            [dir]="sortDir()"
            [options]="phoneSorts()"
            [defaultOrder]="defaultOrderRule"
            (sortPick)="pickSort($event)"
          />
          <mf-sorted-line
            mfBarEnd
            [field]="sortField()"
            [dir]="sortDir()"
            [labels]="sortLabels"
            defaultText="Priority, most urgent first"
            [rule]="defaultOrderRule"
            (resetSort)="resetSort()"
          />
        </mf-list-toolbar>
        <mf-work-list
          [dash]="true"
          [reorderable]="true"
          [rows]="rows()"
          [total]="total()"
          [page]="page()"
          [pageSize]="pageSize()"
          [state]="state()"
          [columns]="columns()"
          [colWidths]="colWidths()"
          [sort]="sortField()"
          [dir]="sortDir()"
          [filtered]="filters.activeCount() > 0"
          [filters]="filters"
          [filterRowId]="filterRowId"
          [caption]="heading()"
          [scope]="card() ? cardName() : null"
          [emptyText]="emptyText()"
          skipLabel="Skip to task list"
          (sortChange)="sortBy($event)"
          (pageChange)="goTo($event)"
          (pageSizeChange)="setPageSize($event)"
          (retry)="load(false, true)"
          (clearFilters)="clearAll()"
          (rowChange)="onRowChange($event)"
          (columnMoved)="onColumnMoved($event)"
          (columnResized)="onColumnResized($event)"
          (columnAction)="onColumnAction($event)"
        />
      </div>
    </section>
  `,
})
export class DashGrid {
  private readonly api = inject(TaskQueueClient);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly choices = inject(QueueChoices);
  private readonly widthStore = inject(WorkWidths);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  /** The summary of the page: its three card queries and the open query are the grid's base. */
  readonly summary = input.required<DashboardSummary>();
  /** Changes whenever the page read the summary again; the grid reads its rows again without the skeleton. */
  readonly refreshKey = input<unknown>(null);
  /** The pressed card (the `card` parameter of the address), or null. */
  readonly card = input<CardKey | null>(null);
  /** Counts up when the person asks for "longest waiting first" (the gauge): a sort of their own is dropped for the card's order. */
  readonly resetSortKey = input(0);
  /** A task was assigned (an Assign pick succeeded): the page refreshes the cards, the gauge and the battery. */
  readonly assigned = output<{ taskNumber: string; name: string }>();

  private static nextId = 0;
  protected readonly filterRowId = `dash-filter-row-${DashGrid.nextId++}`;
  protected readonly sortLabels = SORT_LABELS;
  protected readonly defaultOrderRule =
    'Default order: Priority, then ASAP first, then due date, then oldest';
  protected readonly phone = phoneCards();

  protected readonly state = signal<WorkListState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly pageSize = signal(PAGE_SIZE);
  /** The sort the person chose (header click); null follows the card (Unassigned: longest waiting first) or the default order. */
  private readonly chosenSort = signal<{ field: string; dir: SortDirection } | null>(null);
  protected readonly sortField = computed(
    () => this.chosenSort()?.field ?? (this.card() === 'unassigned' ? 'unassignedSince' : null),
  );
  protected readonly sortDir = computed<SortDirection | null>(
    () => this.chosenSort()?.dir ?? (this.card() === 'unassigned' ? 'asc' : null),
  );

  protected readonly cardName = computed(() => {
    const c = this.card();
    return c ? CARD_NAMES[c] : '';
  });
  protected readonly heading = computed(() =>
    this.card() ? `Tasks: ${this.cardName()}` : 'Tasks',
  );
  protected readonly emptyText = computed(() => {
    const c = this.card();
    return c ? EMPTY_TEXT[c] : 'No open tasks in this scope.';
  });

  // ---- columns

  protected readonly gridDefs = computed((): readonly GridColumnDef[] => SUMMARY_GRID_COLUMNS);
  protected readonly prefs = signal<GridPrefs>(DEFAULT_GRID_PREFS);
  private readonly prefsKey = computed(() =>
    gridPrefsKey('dashboardSummary', this.auth.profile()?.userId),
  );
  /**
   * The shown columns; "Unassigned for" joins them after Assignee only while the Unassigned card is on (it is not in the Columns menu) and takes the place of Due, so the row keeps
   * the same width (#1236). The saved column choice is never changed.
   */
  protected readonly columns = computed(() => {
    const keys = shownKeys(this.gridDefs(), this.prefs());
    if (this.card() !== 'unassigned') return keys;
    const rest = keys.filter((k) => k !== 'due');
    const at = rest.indexOf('assignee');
    return at < 0
      ? [...rest, 'unassignedFor']
      : [...rest.slice(0, at + 1), 'unassignedFor', ...rest.slice(at + 1)];
  });
  /** The Assignee column default of this grid; a width the person chose wins. */
  protected readonly colWidths = computed<ColumnWidthMap>(() => ({
    assignee: pxToRem(ASSIGNEE_PX),
    ...this.widthStore.widths('dashboardSummary', this.auth.profile()?.userId ?? null),
  }));

  protected setPrefs(next: GridPrefs): void {
    this.prefs.set(next);
    saveGridPrefs(this.prefsKey(), next);
  }
  /** "Reset to Default" also drops a stored Title width (as on Task Queue): the Title is the spring and returns to filling the free room. */
  protected resetPrefs(): void {
    this.prefs.set(DEFAULT_GRID_PREFS);
    clearGridPrefs(this.prefsKey());
    this.widthStore.reset('dashboardSummary', this.auth.profile()?.userId ?? null, 'title');
  }
  /** "Reset Width" of the Columns panel: every stored width of this grid goes (the Title and the others). */
  protected resetWidths(): void {
    this.widthStore.resetAll('dashboardSummary', this.auth.profile()?.userId ?? null);
  }
  protected onColumnMoved(move: ColumnMove): void {
    this.setPrefs({
      order: moveBefore(this.gridDefs(), this.prefs(), move.key, move.beforeKey),
      visible: this.prefs().visible,
    });
  }
  protected onColumnResized(e: { key: string; rem: number; defaultRem?: number }): void {
    this.widthStore.set(
      'dashboardSummary',
      this.auth.profile()?.userId ?? null,
      e.key,
      e.rem,
      e.defaultRem,
    );
  }
  protected onColumnAction(a: ColumnAction): void {
    if (a.kind === 'reset') {
      this.widthStore.reset('dashboardSummary', this.auth.profile()?.userId ?? null, a.key);
    } else if (a.kind === 'sort') {
      this.chosenSort.set({ field: a.field, dir: a.dir });
      this.page.set(1);
      void this.load(false);
    }
  }

  // ---- filters

  /** A card owns the filters its query already says (status, due, assignee): they show what the card set and are not sent. */
  private ownedBy(key: string): Pick<FilterDef, 'disabledReason' | 'fixedValue'> {
    const owns = (): CardKey | null => {
      const c = this.card();
      return c && OWNED_BY_CARD[c].includes(key) ? c : null;
    };
    return {
      disabledReason: () => {
        const c = owns();
        return c ? `Set by the ${CARD_NAMES[c]} card above.` : null;
      },
      fixedValue: () => (owns() ? CARD_NAMES[owns() as CardKey] : null),
    };
  }

  private readonly defs = computed((): FilterDef[] => {
    const lookups = this.lookups;
    const base = queueFilterDefs(
      {
        statuses: ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((code) => ({
          value: code,
          label: lookups.statusLabel(code),
        })),
        priorities: lookups.priorities().map((p) => ({ value: String(p.id), label: p.label })),
        types: this.choices.types(),
        users: this.choices.people(),
      },
      { defaultStatus: OPEN_STATUSES },
    )
      .filter((d) => KEPT.has(d.key))
      .map((d) =>
        ['status', 'due', 'assignee'].includes(d.key) ? { ...d, ...this.ownedBy(d.key) } : d,
      );
    // The pressed card as a removable chip ("Needs attention: Overdue") with the others; Clear filters removes it too.
    const card: FilterDef = {
      key: 'card',
      label: 'Needs Attention',
      type: 'select',
      param: 'card',
      noControl: true,
      notInBadge: true,
      options: CARD_KEYS.map((k) => ({ value: k, label: CARD_NAMES[k] })),
      normalize: (v: string) => (isCardKey(v) ? v : null),
    };
    return [...base, card];
  });

  protected readonly filters = new ListFilters({
    screen: 'dashboard-summary',
    noun: 'tasks',
    announceResults: false,
    defs: this.defs,
    visibleColumns: signal(null),
  });

  /** Everything that changes which rows are asked for. */
  private readonly filterKey = computed(
    () =>
      JSON.stringify(this.filters.queryParams()) +
      '|' +
      (this.card() ?? '') +
      '|' +
      this.baseQuery(),
  );

  /** The Task Queue query of the card, or of the scope's open tasks. It already carries the Scope. */
  private baseQuery(): string {
    const s = this.summary();
    switch (this.card()) {
      case 'overdue':
        return s.overdue.query;
      case 'unassigned':
        return s.unassigned.query;
      case 'onHold':
        return s.onHold.query;
      default:
        return s.open.query;
    }
  }

  protected readonly phoneSorts = computed<readonly SortOption[]>(() => {
    const values = ['priority', 'due', 'created', 'number', 'status', 'title', 'assignee'];
    if (this.card() === 'unassigned') values.unshift('unassignedSince');
    return values.map((value) => ({
      value,
      label: SORT_LABELS[value] ?? value,
      descFirst: value === 'created',
    }));
  });

  // ---- reading

  private requestId = 0;
  private lastKey = '';

  constructor() {
    effect(() => {
      const key = this.prefsKey();
      untracked(() => this.prefs.set(loadGridPrefs(key)));
    });
    void this.lookups.ensureLoaded();
    this.choices.ensure();
    // A new card, filter, scope or base query starts again on the first page and the card's own order.
    let seenCard: CardKey | null | undefined;
    effect(() => {
      this.filterKey();
      const card = this.card();
      untracked(() => {
        if (seenCard !== undefined && seenCard !== card) this.chosenSort.set(null);
        seenCard = card;
        this.page.set(1);
        void this.load(false);
      });
    });
    // The page read the summary again (refresh, auto refresh, an assignment): read the rows again and keep what is on screen meanwhile.
    // Inputs are not bound in the constructor: the first run of each effect only records the value it starts with.
    let seenRefresh: unknown;
    let refreshSeen = false;
    effect(() => {
      const key = this.refreshKey();
      untracked(() => {
        const first = !refreshSeen;
        refreshSeen = true;
        if (first || key === seenRefresh) {
          seenRefresh = key;
          return;
        }
        seenRefresh = key;
        void this.load(true);
      });
    });
    let seenReset = -1;
    effect(() => {
      const n = this.resetSortKey();
      untracked(() => {
        if (seenReset === -1) {
          seenReset = n;
          return;
        }
        if (n === seenReset) return;
        seenReset = n;
        this.chosenSort.set(null);
        this.page.set(1);
        void this.load(false);
      });
    });
    effect(() =>
      this.filters.emptyClear.set(
        this.state() === 'ready' && this.rows().length === 0 && this.filters.activeCount() > 0,
      ),
    );
  }

  /** The Task Queue state of this grid: the base query overlaid with the person's filters. A card's own filters win over the filter row. */
  private queueState() {
    const base = parseQueueState(convertToParamMap(queueParams(this.baseQuery())));
    const mine = parseQueueState(this.filters.params());
    const own = this.card();
    const f: QueueFilters = { ...base.filters };
    if (mine.filters.q) f.q = mine.filters.q;
    if (mine.filters.matterText) f.matterText = mine.filters.matterText;
    if (mine.filters.projectText) f.projectText = mine.filters.projectText;
    if (mine.filters.priority.length) f.priority = mine.filters.priority;
    if (mine.filters.type.length) f.type = mine.filters.type;
    if (!own || !OWNED_BY_CARD[own].includes('assignee')) {
      if (mine.filters.assignee.length) f.assignee = mine.filters.assignee;
      if (mine.filters.unassigned) f.unassigned = true;
    }
    if (!own || !OWNED_BY_CARD[own].includes('due')) {
      if (mine.filters.dueFrom) f.dueFrom = mine.filters.dueFrom;
      if (mine.filters.dueTo) f.dueTo = mine.filters.dueTo;
    }
    if (!own) {
      const status = this.filters.list('status');
      if (status.length) f.status = [...status];
    }
    return {
      ...base,
      filters: f,
      sort: this.sortField(),
      dir: this.sortDir(),
      page: this.page(),
      pageSize: this.pageSize(),
    };
  }

  /** `silent`: a refresh keeps the rows on screen; otherwise the skeleton shows. */
  protected load(silent: boolean, force = false): void {
    const args = taskQueueArgs(this.queueState());
    // The same question twice in a row (a filter effect that fired again with nothing new) is asked once; a refresh and a Retry always ask.
    const key = JSON.stringify(args);
    if (!silent && !force && key === this.lastKey && this.state() !== 'error') return;
    this.lastKey = key;
    const id = ++this.requestId;
    if (!silent || this.state() !== 'ready') this.state.set('loading');
    this.api
      .getTaskQueue(...args)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          if (id !== this.requestId) return;
          this.rows.set(page.items);
          this.total.set(page.total);
          this.state.set('ready');
          this.filters.reportResults(page.total);
        },
        error: () => {
          if (id !== this.requestId) return;
          // A failed background refresh keeps the rows (the page's banner says so); a first read shows the error row with Retry.
          if (!silent || this.rows().length === 0) this.state.set('error');
        },
      });
  }

  // ---- interaction

  protected sortBy(field: string): void {
    const cur =
      this.chosenSort() ??
      (this.sortField()
        ? { field: this.sortField() as string, dir: this.sortDir() ?? 'asc' }
        : null);
    const descFirst = field === 'created';
    this.chosenSort.set(
      cur?.field === field
        ? { field, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
        : { field, dir: descFirst ? 'desc' : 'asc' },
    );
    this.page.set(1);
    void this.load(false);
  }

  protected pickSort(choice: SortChoice | null): void {
    if (!choice) this.resetSort();
    else {
      this.chosenSort.set({ field: choice.field, dir: choice.dir });
      this.page.set(1);
      void this.load(false);
    }
  }

  protected resetSort(): void {
    this.chosenSort.set(null);
    this.page.set(1);
    void this.load(false);
  }

  protected goTo(page: number): void {
    this.page.set(page);
    void this.load(false);
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    void this.load(false);
  }

  /** Clear filters of the empty state: every filter of the row, the search and the card. */
  protected clearAll(): void {
    this.filters.clear();
  }

  /** Tasks whose optimistic assignment is on screen and not yet answered by the server. */
  private readonly optimisticAssign = new Set<number>();

  /**
   * An inline edit changed a row (the Assign pick: first the optimistic row, then the server's, or the old row again after a failure). A committed assignment (a new row version
   * with a person on it) takes the task out of a grid that lists unassigned tasks, and tells the page to refresh the cards, the gauge and the battery; any other change shows in place.
   */
  protected onRowChange(row: TaskQueueRow): void {
    const rows = this.rows();
    const index = rows.findIndex((r) => r.taskId === row.taskId);
    if (index < 0) return;
    const before = rows[index];
    const committed = row.rowVersion !== before.rowVersion;
    // The inline assign emits twice: the optimistic row (a person, the old row version), then the server's row (a new version). By the second call the
    // grid already holds the optimistic row, so "was unassigned" is remembered from the first (#1363); a failure puts the old row back and forgets it.
    const wasUnassigned = !before.assignedUser || this.optimisticAssign.has(row.taskId);
    if (!committed) {
      if (row.assignedUser && !before.assignedUser) this.optimisticAssign.add(row.taskId);
      else if (!row.assignedUser) this.optimisticAssign.delete(row.taskId);
    } else {
      this.optimisticAssign.delete(row.taskId);
    }
    const nowAssigned = !!row.assignedUser && wasUnassigned && committed;
    const leaves = nowAssigned && this.card() === 'unassigned';
    if (leaves) {
      this.rows.set(rows.filter((r) => r.taskId !== row.taskId));
      this.total.update((n) => Math.max(0, n - 1));
      afterNextRender(() => this.focusNear(index), { injector: this.injector });
    } else {
      this.rows.set(rows.map((r) => (r.taskId === row.taskId ? row : r)));
    }
    if (nowAssigned) {
      this.assigned.emit({ taskNumber: row.taskNumber, name: row.assignedUser?.displayName ?? '' });
    }
  }

  /** The Assign button that had focus is gone: focus goes to the row that took its place (or the one above, or the list). */
  private focusNear(index: number): void {
    const links = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-task] a.wt-title'),
    );
    const target = links[Math.min(index, links.length - 1)];
    (target ?? this.host.nativeElement.querySelector<HTMLElement>('.wt-wrap'))?.focus();
  }
}
