import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { TaskQueueRow } from '../../api/generated/api-client';
import { ListFilters } from '../filters/list-filters';
import { Pager } from '../ui/pager';
import { Density } from './column-prefs';
import { PAGE_SIZES, SortDirection } from './queue-filters';
import { TaskTable } from './task-table';
import { CopyPart } from '../ui/copy-parts';

/** A short list: this many rows or fewer get the "That's everything" line under the last one. */
export const NEAR_EMPTY_MAX = 10;

export type WorkListState = 'loading' | 'ready' | 'error';

/**
 * Table, paging and the loading, empty and error states of every work list (UX 5.2, 8.6): five skeleton
 * rows while loading, dimmed rows while refreshing, "No results match these filters" with Clear filters, and one error row ("Couldn't load tasks." with the reference, Copy and Retry) that replaces the rows. A polite live region announces the range after each load.
 */
@Component({
  selector: 'mf-work-list',
  imports: [TaskTable, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './work-list.scss',
  template: `
    <div class="wl-sr" role="status" aria-live="polite">{{ announcement() }}</div>

    <!-- The column headers and the filter row always show; loading, error and empty are rows of the table body. -->
    <mf-task-table
      [rows]="rows()"
      [columns]="columns()"
      [caption]="caption()"
      [state]="state()"
      [filters]="filters()"
      [filterRowId]="filterRowId()"
      [filtered]="filtered()"
      [emptyText]="emptyText()"
      [emptyParts]="emptyParts()"
      [nearEmpty]="nearEmptyShown()"
      [density]="density()"
      [sort]="sort()"
      [dir]="dir()"
      [showAssign]="showAssign()"
      [newSince]="newSince()"
      (sortChange)="sortChange.emit($event)"
      (retry)="onRetry()"
      (clearFilters)="clearFilters.emit()"
      (columnsShown)="columnsShown.emit($event)"
      (assignToMe)="assignToMe.emit($event)"
      (rowChange)="rowChange.emit($event)"
    >
      <ng-content select="[empty-action]" ngProjectAs="[empty-action]" />
      <ng-content select="[near-empty]" ngProjectAs="[near-empty]" />
    </mf-task-table>
    <div class="wl-footrow">
      @if (rows().length > 0 && state() !== 'error') {
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
  /** The tab the list shows ("Closed"), appended to the range announcement: "Showing 1-50 of 87 in Closed" (M8). */
  readonly scope = input<string | null>(null);
  /** The column filters (the row under the headers). */
  readonly filters = input<ListFilters | null>(null);
  readonly filterRowId = input('work-filter-row');
  /** True when filters are applied, so an empty list says "No tasks match these filters". */
  readonly filtered = input(false);
  readonly emptyText = input('No tasks yet.');
  /** The empty text with links in it (replaces `emptyText`). */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** The projected `[near-empty]` note may show under the last row (My Work, Active) when the list is short and unfiltered. */
  readonly nearEmpty = input(false);
  readonly showAssign = input(false);
  /** Instant (ms) of the previous visit; rows created after it show a "New" marker. */
  readonly newSince = input<number | null>(null);

  readonly sortChange = output<string>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  readonly columnsShown = output<string[]>();
  readonly assignToMe = output<TaskQueueRow>();
  readonly rowChange = output<TaskQueueRow>();

  protected readonly sizes = PAGE_SIZES;
  /** The list is short (10 or fewer), unfiltered and loaded. */
  protected readonly nearEmptyShown = computed(
    () =>
      this.nearEmpty() &&
      this.state() === 'ready' &&
      !this.filtered() &&
      this.rows().length > 0 &&
      this.total() <= NEAR_EMPTY_MAX,
  );
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private focusAfterRetry = false;

  constructor() {
    // Retry that succeeds moves focus to the first row (or the table), so the keyboard user is where the rows are.
    effect(() => {
      if (this.state() !== 'ready' || !this.focusAfterRetry) return;
      this.focusAfterRetry = false;
      queueMicrotask(() => {
        const root = this.host.nativeElement;
        const target =
          root.querySelector<HTMLElement>('tbody a.wt-title') ??
          root.querySelector<HTMLElement>('.wt-wrap');
        target?.focus();
      });
    });
  }

  protected onRetry(): void {
    this.focusAfterRetry = true;
    this.retry.emit();
  }
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading tasks';
    const total = this.total();
    if (this.state() === 'error') return 'Could not load tasks';
    if (total === 0) return 'No tasks';
    const from = (this.page() - 1) * this.pageSize() + 1;
    const where = this.scope() ? ` in ${this.scope()}` : '';
    return `Showing ${from}-${Math.min(total, this.page() * this.pageSize())} of ${total}${where}`;
  });
}
