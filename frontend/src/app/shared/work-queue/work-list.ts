import {
  ChangeDetectionStrategy,
  DestroyRef,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  untracked,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TaskQueueRow } from '../../api/generated/api-client';
import { BucketCounts } from './due-groups';
import { ListFilters } from '../filters/list-filters';
import { SkipTarget } from '../layout/skip-target';
import { ROW_SHORTCUTS, ShortcutRegistry } from '../layout/shortcut-registry';
import { PageFooter } from '../ui/page-footer';
import { Pager } from '../ui/pager';
import { Density } from './column-prefs';
import { ColumnWidthMap } from './column-widths';
import { ColumnAction } from './column-menu-items';
import { PAGE_SIZES, SortDirection } from './queue-filters';
import { resultsAnnouncement } from './list-announce';
import { PrintLine } from './print-line';
import { TaskTable } from './task-table';
import { DrillReturn, DrillSource } from './drill';
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
  imports: [PageFooter, TaskTable, Pager, PrintLine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-fill' },
  styleUrl: './work-list.scss',
  template: `
    <div class="wl-sr" role="status" aria-live="polite">{{ announcement() }}</div>
    <!-- A column's new width ("Due column 144 pixels"), apart from the results message so the count is not read again. -->
    <div class="wl-note" role="status" aria-live="polite" data-width-note>{{ widthNote() }}</div>

    <mf-print-line
      [name]="caption()"
      [sort]="sort()"
      [dir]="dir()"
      [total]="total()"
      [page]="page()"
      [pageSize]="pageSize()"
    />

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
      [colWidths]="colWidths()"
      [sort]="sort()"
      [dir]="dir()"
      [assignLink]="assignLink()"
      [newSince]="newSince()"
      [leaving]="leaving()"
      [from]="from()"
      [groupBuckets]="groupBuckets()"
      [groupOffset]="groupOffset()"
      [groupDir]="groupDir()"
      (sortChange)="sortChange.emit($event)"
      (columnResized)="columnResized.emit($event)"
      (columnAction)="columnAction.emit($event)"
      (announce)="say($event)"
      (retry)="onRetry()"
      (clearFilters)="clearFilters.emit()"
      (columnsShown)="columnsShown.emit($event)"
      (rowChange)="rowChange.emit($event)"
    >
      <ng-content select="[empty-action]" ngProjectAs="[empty-action]" />
      <ng-content select="[near-empty]" ngProjectAs="[near-empty]" />
    </mf-task-table>
    <div class="wl-footrow" mfPageFooter>
      @if (rows().length > 0 && state() !== 'error') {
        <mf-pager
          class="wl-pager"
          [page]="page()"
          [pageSize]="pageSize()"
          [pageSizes]="sizes"
          [total]="total()"
          (pageChange)="pageChange.emit($event)"
          (pageSizeChange)="pageSizeChange.emit($event)"
        >
          <ng-content select="[foot-note]" ngProjectAs="[pager-note]" />
        </mf-pager>
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
  /** The widths the user chose for this scope (sparse, rem): see `work-widths.ts`. */
  readonly colWidths = input<ColumnWidthMap>({});
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDirection | null>(null);
  readonly caption = input('Tasks');
  /** The tab the list shows ("Closed"), leads the one announcement: "Closed: 87 tasks, showing 1 to 50" (M8, TQ36). */
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
  /** Pod Work: an "Assign to me" link-button next to "Unassigned" in the Assignee cell. */
  readonly assignLink = input(false);
  /** The list the rows belong to: task links carry `?from=`, and Back from a task focuses the row that was left (M7). */
  readonly from = input<DrillSource | null>(null);
  /** Instant (ms) of the previous visit; rows created after it show a "New" marker. */
  readonly newSince = input<number | null>(null);
  /** Tasks that just left the tab; their rows show muted until the page removes them. */
  readonly leaving = input<ReadonlySet<number>>(new Set());
  /** My Work grouped by due: the size of each bucket over the whole filtered set (null: no grouping), and the index of the page's first row. */
  readonly groupBuckets = input<BucketCounts | null>(null);
  readonly groupDir = input<'asc' | 'desc'>('asc');
  readonly groupOffset = input(0);

  readonly sortChange = output<string>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();
  readonly columnsShown = output<string[]>();
  /** A column was resized by dragging its header edge (#204). */
  readonly columnResized = output<{ key: string; rem: number; defaultRem?: number }>();
  /** The column menu asks the page to sort one way, hide a column or forget a stored width (#207). */
  readonly columnAction = output<ColumnAction>();
  readonly rowChange = output<TaskQueueRow>();

  /** The last width message, read once by the screen reader (cleared first so the same message can be said again). */
  protected readonly widthNote = signal('');
  protected say(message: string): void {
    this.widthNote.set('');
    setTimeout(() => this.widthNote.set(message), 50);
  }

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
  private readonly drill = inject(DrillReturn);
  private readonly injector = inject(Injector);
  private returnHandled = false;

  constructor() {
    // The work pages' first Tab stop (#181): "Skip to task list" moves to the first row (or the list itself while there are no rows),
    // and the row keys are listed in the shortcut help while a list is on screen.
    const destroyRef = inject(DestroyRef);
    const offs = [
      inject(SkipTarget).register({ label: 'Skip to task list', focus: () => this.focusList() }),
      ...ROW_SHORTCUTS.map((def) => inject(ShortcutRegistry).register(def)),
    ];
    destroyRef.onDestroy(() => offs.forEach((off) => off()));
    // Coming back from a task (browser Back or "Back to ..."): focus the title link of the row that was left, else the page heading.
    effect(() => {
      const from = this.from();
      if (this.state() !== 'ready' || !from || this.returnHandled) return;
      this.returnHandled = true;
      const taskId = untracked(() => this.drill.take(from));
      if (taskId === null) return;
      afterNextRender(
        () => {
          const root = this.host.nativeElement;
          const link = root.querySelector<HTMLElement>(`a.wt-title[data-task-id="${taskId}"]`);
          if (link) {
            link.focus();
            return;
          }
          const heading = document.querySelector<HTMLElement>('[data-page-title]');
          heading?.setAttribute('tabindex', '-1');
          heading?.focus();
        },
        { injector: this.injector },
      );
    });
    // Retry that succeeds moves focus to the first row (or the table), so the keyboard user is where the rows are.
    effect(() => {
      if (this.state() !== 'ready' || !this.focusAfterRetry) return;
      this.focusAfterRetry = false;
      queueMicrotask(() => {
        this.focusList();
      });
    });
  }

  /** The first row's title link, or the list's scroll region when there is no row. */
  private focusList(): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLElement>('tbody tr[data-task] a.wt-title') ??
      root.querySelector<HTMLElement>('.wt-wrap');
    target?.focus();
  }

  protected onRetry(): void {
    this.focusAfterRetry = true;
    this.retry.emit();
  }
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading tasks';
    const total = this.total();
    if (this.state() === 'error') return 'Could not load tasks';
    return resultsAnnouncement(this.scope(), total, this.page(), this.pageSize());
  });
}
