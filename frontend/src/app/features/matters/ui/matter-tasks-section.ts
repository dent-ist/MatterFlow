import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { convertToParamMap } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { LoadState } from '../../../shared/ui/data-table';
import { StateBlock } from '../../../shared/ui/state-block';
import { ColumnWidthMap, pxToRem } from '../../../shared/work-queue/column-widths';
import {
  OPEN_STATUSES,
  parseQueueState,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';
import { DEFAULT_WIDTHS_PX } from '../../../shared/work-queue/scoped-tasks';
import { TaskTable } from '../../../shared/work-queue/task-table';
import { SECTION_ROWS, type SectionStats } from '../../../shared/ui/section-card';

/** The columns of the Tasks tab as they start (Project and Progress are off by default there too). */
const COLUMNS: readonly string[] = [
  'ref',
  'typeChip',
  'title',
  'priority',
  'assignee',
  'due',
  'status',
];
const WIDTHS: ColumnWidthMap = Object.fromEntries(
  Object.entries(DEFAULT_WIDTHS_PX).map(([k, px]) => [k, pxToRem(px)]),
);

/**
 * The Tasks section of the one-page Matter (#1396): the first 10 open tasks of the matter in the Task Queue's default order, in the Tasks tab's own table (`mf-task-table`, compact
 * rows, the same cells and inline editors) and its real columns. It asks for ONE page of 10 (`pageSize` 10) and nothing loads before `active` is true (the page sets it when the section
 * is about 300 px from the window). The filters, columns menu, paging and the bulk tools are in the full view (`?tab=tasks`). Needs `Task.View`.
 */
@Component({
  selector: 'mf-matter-tasks-section',
  imports: [TaskTable, StateBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    /* The heading row is 40 px like every grid heading of the page (the compact table's 36 px is for rows). */
    :host ::ng-deep table.wt.wt--compact th {
      height: var(--mf-grid-head-h, 40px);
    }
  `,
  template: `
    @if (!canView()) {
      <div data-no-access="tasks">
        <mf-state-block icon="pi-lock">You don't have access to tasks.</mf-state-block>
      </div>
    } @else {
      <mf-task-table
        [rows]="rows()"
        [columns]="columns"
        [caption]="'Tasks of this matter'"
        [hideContext]="true"
        origin="matter"
        rowList="matter-tasks"
        density="compact"
        [scrollStopWhenScrolling]="true"
        [state]="state()"
        emptyText="No open tasks."
        [colWidths]="widths"
        [widthsEditable]="false"
        [canHideColumns]="false"
        [sortable]="false"
        [skeletonCount]="rowsShown"
        (retry)="load()"
        (rowChange)="replaceRow($event)"
      />
    }
  `,
})
export class MatterTasksSection {
  readonly matterId = input.required<number>();
  /** False until the section is near the window: nothing is requested before. */
  readonly active = input(false);
  /** Counts up when something changed elsewhere on the page (a new task, a project moved): the rows are read again. */
  readonly reloadTick = input(0);
  readonly stats = output<SectionStats>();

  private readonly api = inject(TaskQueueClient);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);

  protected readonly columns = COLUMNS;
  protected readonly widths = WIDTHS;
  protected readonly rowsShown = SECTION_ROWS;
  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  private readonly total = signal(0);
  private requestId = 0;

  constructor() {
    effect(() => {
      this.matterId();
      this.reloadTick();
      if (!this.active() || !this.canView()) return;
      untracked(() => {
        void this.lookups.ensureLoaded();
        void this.load();
      });
    });
    effect(() => {
      const state = this.state();
      const rows = this.rows().length;
      const total = this.total();
      untracked(() =>
        this.stats.emit({
          state: state === 'error' ? 'error' : state === 'ready' ? 'ready' : 'loading',
          shown: rows,
          total,
        }),
      );
    });
  }

  protected async load(): Promise<void> {
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      const parsed = parseQueueState(convertToParamMap({}));
      const request = queueArgs({
        ...parsed,
        filters: { ...parsed.filters, status: [...OPEN_STATUSES], matter: this.matterId() },
        sort: null,
        dir: null,
        page: 1,
        pageSize: SECTION_ROWS,
      });
      const page = await firstValueFrom(this.api.getTaskQueue(undefined, ...request));
      if (id !== this.requestId) return;
      this.rows.set(page.items);
      this.total.set(page.total);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }

  protected replaceRow(row: TaskQueueRow): void {
    this.rows.update((rows) => rows.map((r) => (r.taskId === row.taskId ? row : r)));
  }
}
