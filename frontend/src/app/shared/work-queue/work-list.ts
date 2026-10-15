import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TaskQueueRow } from '../../api/generated/api-client';
import { Pager } from '../ui/pager';
import { Density } from './column-prefs';
import { PAGE_SIZES, SortDirection } from './queue-filters';
import { TaskTable } from './task-table';
import { ErrorReference } from '../ui/error-reference';

export type WorkListState = 'loading' | 'ready' | 'error';

/**
 * Table, paging and the loading, empty and error states of every work list (UX 5.2, 8.6): five skeleton
 * rows while loading, dimmed rows while refreshing, "No results match these filters" with Clear filters, and an inline alert with Retry
 * that keeps the previous rows. A polite live region announces the range after each load.
 */
@Component({
  selector: 'mf-work-list',
  imports: [ErrorReference, TaskTable, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './work-list.scss',
  template: `
    <div class="wl-sr" role="status" aria-live="polite">{{ announcement() }}</div>

    @if (state() === 'error') {
      <div class="wl-alert" role="alert">
        Something went wrong. Try again.
        <mf-error-reference />
        <button type="button" class="mf-btn wl-retry" (click)="retry.emit()">Retry</button>
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
        [newSince]="newSince()"
        (sortChange)="sortChange.emit($event)"
        (assignToMe)="assignToMe.emit($event)"
        (rowChange)="rowChange.emit($event)"
      />
      <div class="wl-footrow">
        @if (state() === 'ready' && !filtered() && rows().length > 0 && rows().length < 5) {
          <div class="wl-near" data-near-empty><ng-content select="[near-empty]" /></div>
        }
        @if (rows().length > 0) {
          <mf-pager
            class="wl-pager"
            [page]="page()"
            [pageSize]="pageSize()"
            [pageSizes]="sizes"
            [total]="total()"
            (pageChange)="pageChange.emit($event)"
            (pageSizeChange)="pageSizeChange.emit($event)"
          />
        }
      </div>
    } @else if (state() === 'ready') {
      <div class="wl-empty" data-empty>
        @if (filtered()) {
          <p>No tasks match these filters.</p>
          <button type="button" class="mf-btn wl-button" (click)="clearFilters.emit()">
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
  /** Instant (ms) of the previous visit; rows created after it show a "New" marker. */
  readonly newSince = input<number | null>(null);

  readonly sortChange = output<string>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  readonly assignToMe = output<TaskQueueRow>();
  readonly rowChange = output<TaskQueueRow>();

  protected readonly sizes = PAGE_SIZES;
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading tasks';
    const total = this.total();
    if (this.state() === 'error') return 'Could not load tasks';
    if (total === 0) return 'No tasks';
    const from = (this.page() - 1) * this.pageSize() + 1;
    return `Showing ${from}-${Math.min(total, this.page() * this.pageSize())} of ${total}`;
  });
}
