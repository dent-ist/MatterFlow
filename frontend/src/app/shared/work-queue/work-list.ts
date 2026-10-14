import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TaskQueueRow } from '../../api/generated/api-client';
import { Pager } from '../ui/pager';
import { ColumnChooser } from './column-chooser';
import { Density } from './column-prefs';
import { PAGE_SIZES, SortDirection } from './queue-filters';
import { TaskTable } from './task-table';

export type WorkListState = 'loading' | 'ready' | 'error';

const SORT_LABELS: Readonly<Record<string, string>> = {
  priority: 'Priority',
  due: 'Due date',
  created: 'Created',
  number: 'Ref',
  status: 'Status',
  completed: 'Closed',
};

/**
 * Table, sort note, column chooser, paging and the loading, empty and error states of every work list (UX 5.2, 8.6): five skeleton
 * rows while loading, dimmed rows while refreshing, "No results match these filters" with Clear filters, and an inline alert with Retry
 * that keeps the previous rows. A polite live region announces the range after each load.
 */
@Component({
  selector: 'mf-work-list',
  imports: [TaskTable, Pager, ColumnChooser],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './work-list.scss',
  template: `
    <div class="wl-bar">
      <p class="wl-sort" data-sort-note>
        @if (sort(); as s) {
          Sorted by {{ sortLabel() }} ({{ dir() === 'desc' ? 'descending' : 'ascending' }}).
          <button type="button" class="wl-link" (click)="resetSort.emit()">Reset sort</button>
        } @else {
          <span title="Choosing a column header sorts by it and replaces this order.">
            {{ defaultOrder() }}
            <i class="pi pi-info-circle" aria-hidden="true"></i>
          </span>
        }
      </p>
      <mf-column-chooser
        [columns]="columns()"
        [density]="density()"
        (columnsChange)="columnsChange.emit($event)"
        (densityChange)="densityChange.emit($event)"
      />
    </div>

    <div class="wl-sr" role="status" aria-live="polite">{{ announcement() }}</div>

    @if (state() === 'error') {
      <div class="wl-alert" role="alert">
        Something went wrong. Try again.
        <button type="button" class="wl-retry" (click)="retry.emit()">Retry</button>
      </div>
    }

    @if (state() === 'loading' || rows().length > 0) {
      <mf-task-table
        [rows]="rows()"
        [columns]="columns()"
        [caption]="caption()"
        [loading]="state() === 'loading'"
        [density]="density()"
        [sort]="sort()"
        [dir]="dir()"
        [showAssign]="showAssign()"
        (sortChange)="sortChange.emit($event)"
        (assignToMe)="assignToMe.emit($event)"
        (rowChange)="rowChange.emit($event)"
      />
      @if (rows().length > 0) {
        <div class="wl-foot">
          <label class="wl-size">
            Rows per page
            <select [value]="pageSize()" (change)="pageSizeChange.emit(+$any($event.target).value)">
              @for (size of sizes; track size) {
                <option [value]="size" [selected]="size === pageSize()">{{ size }}</option>
              }
            </select>
          </label>
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize()"
            [total]="total()"
            (pageChange)="pageChange.emit($event)"
          />
        </div>
      }
    } @else if (state() === 'ready') {
      <div class="wl-empty" data-empty>
        @if (filtered()) {
          <p>No tasks match these filters.</p>
          <button type="button" class="wl-button" (click)="clearFilters.emit()">
            Clear filters
          </button>
        } @else {
          <p>{{ emptyText() }}</p>
          <ng-content select="[empty-action]" />
        }
      </div>
    }
  `,
})
export class WorkList {
  readonly rows = input.required<readonly TaskQueueRow[]>();
  readonly total = input(0);
  readonly page = input(1);
  readonly pageSize = input(50);
  readonly state = input<WorkListState>('loading');
  readonly columns = input.required<readonly string[]>();
  readonly density = input<Density>('comfortable');
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  readonly caption = input('Tasks');
  /** True when filters are applied, so an empty list says "No tasks match these filters". */
  readonly filtered = input(false);
  readonly emptyText = input('No tasks yet.');
  readonly showAssign = input(false);
  /** What the default order is, for the sort note. */
  readonly defaultOrder = input('Default order: Priority, ASAP first, Due date, Oldest');

  readonly sortChange = output<string>();
  readonly resetSort = output<void>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly columnsChange = output<string[]>();
  readonly densityChange = output<Density>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  readonly assignToMe = output<TaskQueueRow>();
  readonly rowChange = output<TaskQueueRow>();

  protected readonly sizes = PAGE_SIZES;
  protected readonly sortLabel = computed(() => SORT_LABELS[this.sort() ?? ''] ?? this.sort());
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading tasks';
    const total = this.total();
    if (this.state() === 'error') return 'Could not load tasks';
    if (total === 0) return 'No tasks';
    const from = (this.page() - 1) * this.pageSize() + 1;
    return `Showing ${from}-${Math.min(total, this.page() * this.pageSize())} of ${total}`;
  });
}
