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
  ReportViewLayout,
  ReportViewResponse,
  ReportsClient,
  RunReportResponse,
} from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { QuietRequests } from '../../core/http/interceptors';
import { NotificationService } from '../../core/notify/notification.service';
import { USER_TIME_ZONE } from '../../core/time/clock';
import { ColumnFilterRow } from '../../shared/filters/column-filter-row';
import { FilterValues, emptyValue, sameValue } from '../../shared/filters/filter-def';
import { ListFilters } from '../../shared/filters/list-filters';
import { ListToolbar } from '../../shared/filters/list-toolbar';
import { LoadState } from '../../shared/ui/data-table';
import { orderedKeys } from '../../shared/ui/grid-prefs';
import { IntPipe, formatInt } from '../../shared/ui/number-format';
import { Pager } from '../../shared/ui/pager';
import { DEFAULT_GRID_PREFS } from '../../shared/ui/grid-prefs';
import {
  RecordCell,
  RecordColumns,
  RecordGrid,
  RecordGridState,
} from '../../shared/ui/record-grid';
import { SortedLine } from '../../shared/ui/sorted-line';
import { Tip } from '../../shared/ui/tip';
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
  MAX_FILTERS,
  filterCount,
  filterDefsOf,
  serverFilter,
  serverSort,
  sortKinds,
  sortLabels,
} from './report-result-query';
import { ReportExportService, exportedText } from './report-export';
import { ReportViewsMenu } from './report-views-menu';
import { ReportViewsStore } from './report-views-store';
import { ResolvedLayout, captureLayout, layoutKey, resolveLayout } from './report-view-layout';

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
    ReportViewsMenu,
    SortedLine,
    Tip,
  ],
  providers: [ReportViewsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    /* A flex column that takes what its parent leaves (the run page fills the window, #1286); in a plain block parent it is as tall as its content. */
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: auto;
    }
    :host > * {
      flex: none;
    }
    /* The grid frame takes the rest of the column and scrolls inside it (sticky heading and filter bands, sideways scroll for wide results), never fewer than
       about seven rows. The run page sets --rr-max to none while it fills the window; when the page scrolls instead (form open, a short window) the frame
       is at most most of a window tall and the page scrolls around it. */
    .rr__frame {
      display: flex;
      flex-direction: column;
      flex: 1 1 0;
      min-height: var(--mf-frame-min, 412px);
      max-height: var(--rr-max, 70dvh);
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
        <mf-report-views
          mfView
          [reportId]="reportId()"
          [reportName]="reportName()"
          [current]="layout()"
          [appliedId]="appliedId()"
          [modified]="modified()"
          (pick)="applyView($event)"
          (saved)="markApplied($event)"
          (removed)="viewRemoved($event)"
        />
        @if (sort()) {
          <mf-sorted-line
            mfBarEnd
            [sort]="sort()"
            defaultSort=""
            [labels]="labels()"
            [kinds]="kinds()"
            (resetSort)="setSort(null)"
          />
        }
        <mf-record-columns mfColumns [grid]="grid" />
        <button
          mfMore
          type="button"
          class="mf-btn"
          data-export-csv
          [attr.aria-disabled]="exportOff() ? 'true' : null"
          [attr.aria-busy]="exporting() ? 'true' : null"
          [mfTip]="exportTip()"
          (click)="exportCsv()"
        >
          <i
            class="pi"
            [class]="exporting() ? 'pi-spin pi-spinner' : 'pi-download'"
            aria-hidden="true"
          ></i>
          Export CSV
        </button>
      </mf-list-toolbar>
      <span class="mf-sr-only" role="status" aria-live="polite" data-export-status>{{
        exportStatus()
      }}</span>
      @if (viewNote()) {
        <div class="pg-banner pg-banner--info" role="status" data-view-skipped>
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span>This view uses columns the report no longer returns. They were skipped.</span>
          <button type="button" class="mf-btn" data-dismiss-view-note (click)="viewNote.set(false)">
            Dismiss
          </button>
        </div>
      }
      @if (limitReached()) {
        <div class="pg-banner pg-banner--info" role="status" data-filter-limit>
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span>Remove a filter to add another.</span>
          <button type="button" class="mf-btn" data-dismiss-limit (click)="limitReached.set(false)">
            Dismiss
          </button>
        </div>
      }
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
  private readonly exporter = inject(ReportExportService);
  private readonly notify = inject(NotificationService);
  private readonly views = inject(ReportViewsStore);
  /** The person's time zone: a date-time with a zone is shown in it (#1287). */
  private readonly zone = inject(USER_TIME_ZONE);

  /** The run this grid shows (the id of `POST /reports/{id}/runs`); a new run is a new grid. */
  readonly result = input.required<RunReportResponse>();
  /** The report, for the stored column choices of this grid (`report-result-<reportId>`) and its saved views. */
  readonly reportId = input.required<number>();
  /** The name of the report (the Save View dialog starts with "<name> view"). */
  readonly reportName = input('Report');
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
  protected readonly kinds = computed(() => sortKinds(this.columns()));
  private readonly started = signal(false);

  /** The filters (values and server text) of the last request that was allowed: a 21st filter is turned back to these, and no request is made for it (#1290). */
  private okValues: FilterValues = {};
  private okJson: string | undefined;
  private readonly overLimit = computed(
    () =>
      this.started() &&
      filterCount(serverFilter(this.columns(), this.filters.values())) > MAX_FILTERS,
  );
  /** "Remove a filter to add another." is shown (until it is dismissed or a filter is removed). */
  protected readonly limitReached = signal(false);
  private readonly filterJson = computed(() => {
    if (!this.started()) return undefined;
    if (this.overLimit()) return this.okJson;
    this.okValues = this.filters.values();
    return (this.okJson = serverFilter(this.columns(), this.okValues));
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
    // The rows endpoint takes 20 filters: the one filter too many is put back and says why, instead of a request the server refuses.
    effect(() => {
      if (this.overLimit()) {
        untracked(() => this.turnBackLastFilter());
      } else if (this.started() && filterCount(this.filterJson()) < MAX_FILTERS) {
        untracked(() => this.limitReached.set(false));
      }
    });
    // The empty body of a filtered grid has its own Clear Filters: the toolbar then shows none, so there is never a second one.
    effect(() => {
      if (!this.started()) return;
      const own = this.filtered() === 0 && this.filters.activeCount() > 0;
      untracked(() => this.filters.emptyClear.set(own));
    });
  }

  async ngOnInit(): Promise<void> {
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
    // The person's default view is applied before the first rows are asked for, so the result opens the way they saved it and no page is read twice. A list
    // that cannot be read is no reason to hold the result back: the menu says it could not load and offers Retry.
    await this.views.load(this.reportId());
    const first = this.views.defaultView();
    if (first) this.applyView(first);
    this.started.set(true);
    if (first) this.rebase();
  }

  /** Puts every filter that differs from the last allowed state back to it (the one the person has just set), and shows the message. */
  private turnBackLastFilter(): void {
    const now = this.filters.values();
    const back: Record<string, FilterValues[string]> = {};
    for (const def of this.filters.defs()) {
      const before = this.okValues[def.key] ?? emptyValue(def);
      if (!sameValue(now[def.key] ?? emptyValue(def), before)) back[def.key] = before;
    }
    this.filters.setMany(back, { replace: true });
    this.limitReached.set(true);
  }

  // ---- saved views (#722)

  /** The view the grid shows (null: the report's own Default) and what the grid looked like right after it was applied or saved. */
  protected readonly appliedId = signal<number | null>(null);
  private readonly baseline = signal<string | null>(null);
  /** The applied view names columns this result lacks: the banner says it was skipped, until Dismiss. */
  protected readonly viewNote = signal(false);

  /** The grid as a view would store it, built from the grid's own state (order, shown columns, widths, sort, the filters the request sends, page size). */
  protected readonly layout = computed<ReportViewLayout>(() =>
    captureLayout({
      columns: this.columns(),
      order: orderedKeys(this.grid.defs(), this.grid.prefs()),
      shown: this.grid.shown(),
      widths: this.grid.widths(),
      sort: this.sort(),
      filterJson: this.filterJson(),
      pageSize: this.pageSize(),
    }),
  );
  /** A view is applied and the grid differs from it now: the button says "(modified)" and Save View is on. */
  protected readonly modified = computed(
    () => this.appliedId() !== null && this.baseline() !== layoutKey(this.layout()),
  );

  /** A view was picked (null: the Default row). Columns, widths, sort, filters and page size replace what is on the grid; the page is 1 again by itself. */
  protected applyView(view: ReportViewResponse | null): void {
    const resolved: ResolvedLayout = view
      ? resolveLayout(view.layout, this.columns())
      : {
          prefs: DEFAULT_GRID_PREFS,
          widths: {},
          sort: null,
          filters: {},
          pageSize: DEFAULT_RESULT_PAGE_SIZE,
          skipped: false,
        };
    this.grid.set(resolved.prefs);
    this.grid.setWidths(resolved.widths);
    this.sort.set(resolved.sort);
    this.pageSize.set(resolved.pageSize);
    const values: Record<string, FilterValues[string]> = {};
    for (const def of this.filters.defs())
      values[def.key] = resolved.filters[def.key] ?? emptyValue(def);
    this.filters.setMany(values, { replace: true });
    this.appliedId.set(view?.viewId ?? null);
    this.viewNote.set(!!view && (resolved.skipped || view.ignoredColumns.length > 0));
    if (this.started()) this.rebase();
  }

  /** A view now holds exactly what the grid shows (it was just saved or created): it is the applied one and the grid is unchanged from it. */
  protected markApplied(view: ReportViewResponse): void {
    this.appliedId.set(view.viewId);
    this.viewNote.set(false);
    this.rebase();
  }

  protected viewRemoved(viewId: number): void {
    if (this.appliedId() === viewId) {
      this.appliedId.set(null);
      this.baseline.set(null);
    }
  }

  private rebase(): void {
    this.baseline.set(layoutKey(untracked(() => this.layout())));
  }

  // ---- CSV export (#721)

  protected readonly exporting = signal(false);
  /** A page, sort or filter request is in flight: the rows on screen are about to change, so the export waits for them. */
  private readonly pending = signal(false);
  /** The server said the result is gone: the page opens the form again, and until then there is nothing to export. */
  private readonly gone = signal(false);
  protected readonly exportStatus = signal('');
  protected readonly exportOff = computed(
    () =>
      !this.ready() ||
      this.state() !== 'ready' ||
      this.pending() ||
      this.filtered() === 0 ||
      this.exporting() ||
      this.gone(),
  );
  /** What the button will export (spec 5.1): the filtered rows of the total, all rows, or the first rows of a truncated result; nothing to export when there are no rows. */
  protected readonly exportTip = computed(() => {
    if (this.exporting()) return 'Preparing the CSV.';
    if (this.ready() && this.state() === 'ready' && this.filtered() === 0) {
      return 'There are no rows to export.';
    }
    const total = formatInt(this.total());
    if (this.filtered() !== this.total()) {
      return `Exports the ${formatInt(this.filtered())} filtered ${this.filtered() === 1 ? 'row' : 'rows'} (of ${total}).`;
    }
    return this.result().truncated
      ? `Exports the first ${total} rows.`
      : `Exports all ${total} rows.`;
  });

  /**
   * Export CSV: the filtered and sorted rows (all of them, not the page) in the visible columns and their order, as one authorised request whose answer is
   * saved as a file. It never drops the result. A 410 or 404 is the result being gone (the page says so); any other failure is a toast with Retry.
   */
  protected async exportCsv(): Promise<void> {
    if (this.exportOff()) return;
    this.exporting.set(true);
    this.exportStatus.set('Preparing the CSV.');
    const columns = this.columns();
    const byKey = new Map(columns.map((c) => [c.key, c.index] as const));
    try {
      const done = await this.exporter.download(this.result().runId, {
        sort: serverSort(columns, this.sort()),
        filter: this.filterJson(),
        columns: this.grid.shown().flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])),
      });
      const rows = done.rows > 0 ? done.rows : this.filtered();
      this.exportStatus.set(`Exported ${formatInt(rows)} ${rows === 1 ? 'row' : 'rows'}.`);
      this.notify.success(
        exportedText(rows, done.truncated),
        done.truncated
          ? `The result was truncated at ${formatInt(rows)} rows. Narrow the parameters to export the rest.`
          : undefined,
      );
    } catch (error) {
      this.exportStatus.set('');
      if (error instanceof ApiError && (error.status === 410 || error.status === 404)) {
        this.gone.set(true);
        this.problem.emit(error);
        return;
      }
      this.notify.error("Couldn't export the report.", undefined, {
        copy: error instanceof ApiError ? error.traceId : undefined,
        action: { label: 'Retry', run: () => void this.exportCsv() },
      });
    } finally {
      this.exporting.set(false);
    }
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
    this.pending.set(true);
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
      this.pending.set(false);
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
      this.pending.set(false);
      if (error instanceof ApiError && (error.status === 410 || error.status === 404)) {
        this.problem.emit(error);
        return;
      }
      this.state.set('error');
      this.ready.set(true);
    }
  }

  protected textOf(row: readonly unknown[], c: ResultColumn): string {
    return cellText(row[c.index], c.kind, this.scales().get(c.index) ?? 0, this.zone);
  }

  protected titleOf(row: readonly unknown[], c: ResultColumn): string | null {
    return cellTitle(row[c.index], c.kind, this.zone);
  }

  /** The full text as the tooltip, only while the cell cuts it (a date-time always has its long form). */
  protected markCut(event: Event, long: string | null): void {
    const el = event.currentTarget as HTMLElement;
    const text = long ?? (el.scrollWidth > el.clientWidth ? (el.textContent ?? '').trim() : '');
    if (text) el.setAttribute('title', text);
    else el.removeAttribute('title');
  }
}
