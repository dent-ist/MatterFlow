import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  runInInjectionContext,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ReportRowsResponse,
  ReportsClient,
  RunReportResponse,
} from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { ColumnFilterRow } from '../../shared/filters/column-filter-row';
import { ListFilters } from '../../shared/filters/list-filters';
import { ListToolbar } from '../../shared/filters/list-toolbar';
import { LoadState } from '../../shared/ui/data-table';
import { IntPipe } from '../../shared/ui/number-format';
import { Pager } from '../../shared/ui/pager';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridState,
} from '../../shared/ui/record-grid';
import { SortedLine } from '../../shared/ui/sorted-line';
import {
  ResultColumn,
  cellText,
  cellTitle,
  decimalScale,
  gridColumnDefs,
  resultColumns,
} from './report-column-defs';
import {
  DEFAULT_RESULT_PAGE_SIZE,
  RESULT_PAGE_SIZES,
  filterDefsOf,
  serverFilter,
  serverSort,
  sortLabels,
} from './report-result-query';

/**
 * The result grid of the run page (issue #720, spec section 4 of `docs/ux/reports-review/ui-spec-user-pages.md`): the shared `mf-record-grid` with the
 * columns of the run (`report-column-defs.ts`), the shared toolbar (filter chips, Clear Filters, Sorted by, Columns), the typed filter row, the cell formats
 * of spec 4.4 and the shared pager. The rows are never held here: every page, sort and filter change is one `GET /reports/runs/{runId}/rows`, so the
 * server does the work and the page keeps only what is on screen. The grid never drops the person's result (that is the run page, when it is left).
 *
 * What the person arranged (order, hidden columns, widths) is stored per report and person (`mf.grid.v1.report-result-<reportId>.<userId>`); sort, filters
 * and page are not stored and not in the address (a result cannot be reopened from a link). A 410 (the result expired) and a 404 are told to the page
 * (`problem`), which says it in its banner and opens the form again; any other failure is the grid's own error row with Retry.
 */
@Component({
  selector: 'mf-report-result',
  imports: [
    ColumnFilterRow,
    IntPipe,
    ListToolbar,
    Pager,
    RecordCell,
    RecordColumns,
    RecordGrid,
    SortedLine,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    /* The grid frame fills this box and scrolls inside it (sticky heading and filter bands, sideways scroll for wide results); the page scrolls around it. */
    .rr__frame {
      display: flex;
      flex-direction: column;
      height: max(var(--mf-frame-min, 412px), calc(100dvh - 12rem));
    }
    .rr__bar {
      display: block;
      height: 14px;
      border-radius: var(--mf-radius);
      background: var(--mf-border);
      opacity: 0.55;
    }
    .rr__skeleton {
      display: grid;
      gap: var(--mf-s3);
    }
  `,
  template: `
    @if (!ready()) {
      <div class="rr__skeleton" aria-hidden="true" data-result-skeleton>
        <span class="rr__bar"></span>
        <span class="rr__bar"></span>
        <span class="rr__bar"></span>
      </div>
    } @else {
      <mf-list-toolbar [filters]="filters" controls="report-filter-row" searchLabel="Search rows">
        @if (sort()) {
          <mf-sorted-line
            mfBarEnd
            [sort]="sort()"
            defaultSort=""
            [labels]="labels()"
            (resetSort)="setSort(null)"
          />
        }
        <mf-record-columns mfColumns [grid]="grid" />
      </mf-list-toolbar>
      <div class="rr__frame">
        <mf-record-grid
          label="Report result"
          caption="Report result"
          noun="rows"
          tableId="report-result-table"
          [grid]="grid"
          [rows]="rows()"
          [loadState]="state()"
          [empty]="filtered() === 0"
          [filtered]="filters.activeCount() > 0"
          [filters]="filters"
          [sort]="sort()"
          defaultSort=""
          (sorted)="setSort($event)"
          (retry)="load()"
          (clear)="filters.clear()"
        >
          @if (filters.rowVisible()) {
            <tr
              mfGridFilterRow
              mfColumnFilterRow
              id="report-filter-row"
              [filters]="filters"
              [columns]="grid.shown()"
            ></tr>
          }
          @for (c of columns(); track c.key) {
            <ng-template [mfCell]="c.key" let-row>
              <td
                [class.pg-num]="c.kind === 'integer' || c.kind === 'decimal'"
                [style.text-align]="c.kind === 'boolean' ? 'center' : null"
              >
                <span
                  class="pg-clip-fit"
                  [attr.data-cell]="c.index"
                  (mouseenter)="markCut($event, titleOf(row, c))"
                  >{{ textOf(row, c) }}</span
                >
              </td>
            </ng-template>
          }
          <div mfGridFoot>
            @if (state() === 'ready' && filtered() > 0) {
              <mf-pager
                [page]="pageNumber()"
                [pageSize]="pageSize()"
                [pageSizes]="pageSizes"
                [total]="filtered()"
                [edges]="true"
                (pageChange)="setPage($event)"
                (pageSizeChange)="setPageSize($event)"
              >
                @if (filtered() !== total()) {
                  <span pager-note data-filtered-note
                    >Filtered from {{ total() | mfInt }} rows</span
                  >
                }
              </mf-pager>
            }
          </div>
        </mf-record-grid>
      </div>
    }
  `,
})
export class ReportResultGrid implements OnInit {
  private readonly api = inject(ReportsClient);
  private readonly quiet = inject(QuietRequests);
  private readonly injector = inject(Injector);

  /** The run this grid shows (the id of `POST /reports/{id}/runs`); a new run is a new grid. */
  readonly result = input.required<RunReportResponse>();
  /** The report, for the stored column choices of this grid (`report-result-<reportId>`). */
  readonly reportId = input.required<number>();
  /** The result is gone (410) or was never the person's (404): the page says so and opens the form again. */
  readonly problem = output<ApiError>();

  protected readonly pageSizes = RESULT_PAGE_SIZES;
  protected readonly columns = computed<ResultColumn[]>(() => resultColumns(this.result().columns));
  /** The first rows of the first page: they decide the width of the text columns and the decimals of the number columns, once. */
  private readonly sample = signal<readonly (readonly unknown[])[] | null>(null);
  private readonly scales = computed(() => {
    const rows = this.sample() ?? [];
    return new Map(
      this.columns()
        .filter((c) => c.kind === 'decimal')
        .map((c) => [c.index, decimalScale(rows, c.index)] as const),
    );
  });

  grid!: RecordGridState;
  filters!: ListFilters;

  protected readonly ready = signal(false);
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<readonly (readonly unknown[])[]>([]);
  protected readonly total = signal(0);
  protected readonly filtered = signal(0);
  protected readonly sort = signal<string | null>(null);
  protected readonly pageSize = signal(DEFAULT_RESULT_PAGE_SIZE);
  protected readonly labels = computed(() => sortLabels(this.columns()));
  private readonly started = signal(false);

  private readonly filterJson = computed(() => {
    if (!this.started()) return undefined;
    return serverFilter(this.columns(), this.filters.values());
  });
  /**
   * What a page number belongs to: a change of the filters, the sort or the page size is a new list, so its page is 1 again without anyone resetting it
   * (and without a second request for the reset).
   */
  private readonly listKey = computed(() =>
    JSON.stringify([this.filterJson() ?? null, this.sort(), this.pageSize()]),
  );
  private readonly chosen = signal<{ page: number; key: string }>({ page: 1, key: '' });
  protected readonly pageNumber = computed(() =>
    this.chosen().key === this.listKey() ? this.chosen().page : 1,
  );

  private requestId = 0;

  constructor() {
    effect(() => {
      if (!this.started()) return;
      void this.result().runId;
      this.pageNumber();
      this.pageSize();
      this.sort();
      this.filterJson();
      untracked(() => void this.load());
    });
    // The empty body of a filtered grid has its own Clear Filters: the toolbar then shows none, so there is never a second one.
    effect(() => {
      if (!this.started()) return;
      const own = this.filtered() === 0 && this.filters.activeCount() > 0;
      untracked(() => this.filters.emptyClear.set(own));
    });
  }

  ngOnInit(): void {
    // The grid id holds the report, which is an input: the state is made here, in an injection context, once the inputs are known.
    runInInjectionContext(this.injector, () => {
      this.grid = new RecordGridState(
        `report-result-${this.reportId()}`,
        computed(() => gridColumnDefs(this.columns(), this.ready() ? (this.sample() ?? []) : [])),
      );
      this.filters = new ListFilters({
        screen: 'report-result',
        defs: computed(() => filterDefsOf(this.columns())),
        visibleColumns: this.grid.shown,
        noun: 'rows',
        memory: true,
      });
    });
    this.started.set(true);
  }

  protected setSort(sort: string | null): void {
    this.sort.set(sort);
  }

  protected setPage(page: number): void {
    this.chosen.set({ page, key: this.listKey() });
  }

  protected setPageSize(size: number): void {
    this.pageSize.set(size);
  }

  /** (Also the Retry of the error row.) Reads the page that is chosen now; an answer to an older request is dropped. */
  protected async load(): Promise<void> {
    const id = ++this.requestId;
    // The rows of the page before stay on screen while the next page loads; only the very first load and a Retry show the skeleton rows.
    if (!this.ready() || this.state() === 'error') this.state.set('loading');
    const columns = this.columns();
    try {
      const res: ReportRowsResponse = await this.quiet.runInline(() =>
        firstValueFrom(
          this.api.getReportRows(
            this.result().runId,
            this.pageNumber(),
            this.pageSize(),
            serverSort(columns, this.sort()),
            this.filterJson(),
          ),
        ),
      );
      if (id !== this.requestId) return;
      if (!this.ready()) this.sample.set(res.rows.slice(0, 50));
      this.rows.set(res.rows);
      this.total.set(res.totalRows);
      this.filtered.set(res.filteredRows);
      // The server clamps a page past the end; the pager shows the page it sent.
      if (res.page !== this.pageNumber()) this.chosen.set({ page: res.page, key: this.listKey() });
      this.state.set('ready');
      this.ready.set(true);
      this.filters.reportResults(res.filteredRows);
    } catch (error) {
      if (id !== this.requestId) return;
      if (error instanceof ApiError && (error.status === 410 || error.status === 404)) {
        this.problem.emit(error);
        return;
      }
      this.state.set('error');
      this.ready.set(true);
    }
  }

  protected textOf(row: readonly unknown[], c: ResultColumn): string {
    return cellText(row[c.index], c.kind, this.scales().get(c.index) ?? 0);
  }

  protected titleOf(row: readonly unknown[], c: ResultColumn): string | null {
    return cellTitle(row[c.index], c.kind);
  }

  /** The full text as the tooltip, only while the cell cuts it (a date-time always has its long form). */
  protected markCut(event: Event, long: string | null): void {
    const el = event.currentTarget as HTMLElement;
    const text = long ?? (el.scrollWidth > el.clientWidth ? (el.textContent ?? '').trim() : '');
    if (text) el.setAttribute('title', text);
    else el.removeAttribute('title');
  }
}
