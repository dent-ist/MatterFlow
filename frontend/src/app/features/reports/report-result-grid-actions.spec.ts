import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER } from 'rxjs';
import {
  ReportRowsResponse,
  ReportViewLayout,
  ReportViewResponse,
  ReportViewsClient,
  ReportsClient,
  RunReportResponse,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { problemDetailsInterceptor } from '../../core/http/interceptors';
import { NotificationService } from '../../core/notify/notification.service';
import { USER_TIME_ZONE } from '../../core/time/clock';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { columnWidthsKey, loadColumnWidths } from '../../shared/ui/resizable-columns';
import { ReportResultGrid } from './report-result-grid';
import { aView } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

const run = (over: Partial<RunReportResponse> = {}): RunReportResponse =>
  ({
    runId: 'run-9',
    columns: [
      { name: 'Matter', type: 'text' },
      { name: 'Open Tasks', type: 'integer' },
      { name: 'Hours', type: 'decimal' },
      { name: 'Active', type: 'boolean' },
    ],
    rowCount: 2380,
    truncated: false,
    durationMs: 12,
    maxRows: 50000,
    ...over,
  }) as RunReportResponse;

const page = (over: Partial<ReportRowsResponse> = {}): ReportRowsResponse =>
  ({
    columns: run().columns,
    rows: [
      ['00017 Acme v. Beta', 1234, 12.5, true],
      ['Merger review', -7, null, false],
    ],
    totalRows: 2380,
    filteredRows: 2380,
    page: 1,
    pageSize: 50,
    truncated: false,
    ...over,
  }) as ReportRowsResponse;

const blob = (text = '\ufeffMatter\r\n'): Blob => new Blob([text], { type: 'text/csv' });
const csvHeaders = (rows: number, truncated = false) => ({
  'Content-Disposition': 'attachment; filename="overdue-tasks-20261107-1405.csv"',
  'X-Export-Rows': String(rows),
  'X-Export-Truncated': truncated ? 'true' : 'false',
});

describe('ReportResultGrid: CSV export (#721) and saved views (#722)', () => {
  let rowsApi: { getReportRows: Mock };
  let viewsApi: Record<string, Mock>;
  let http: HttpTestingController;
  let notify: NotificationService;
  let fixture: ComponentFixture<ReportResultGrid>;
  let problems: ApiError[];
  let downloads: string[];
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));
  const lastCall = (): unknown[] => rowsApi.getReportRows.mock.calls.at(-1)!;
  const toasts = () => notify.toasts();
  const exportButton = () => q<HTMLButtonElement>('[data-export-csv]');
  const exportRequests = () => http.match((r) => r.url.includes('/export.csv'));
  const tip = (): string => {
    exportButton().dispatchEvent(new Event('mouseenter'));
    const text = document.body.querySelector('[role="tooltip"]')?.textContent ?? '';
    exportButton().dispatchEvent(new Event('mouseleave'));
    return text;
  };

  async function create(
    opts: {
      result?: RunReportResponse;
      views?: ReportViewResponse[];
      rows?: (id: string, page?: number, size?: number) => unknown;
      viewsFail?: boolean;
    } = {},
  ): Promise<void> {
    rowsApi = { getReportRows: vi.fn() };
    rowsApi.getReportRows.mockImplementation(
      opts.rows ?? ((_id: string, p = 1, size = 50) => ok(page({ page: p, pageSize: size }))),
    );
    viewsApi = {
      listReportViews: vi.fn().mockReturnValue(ok({ views: opts.views ?? [], limit: 25 })),
      createReportView: vi.fn(),
      updateReportView: vi.fn(),
      deleteReportView: vi.fn().mockReturnValue(ok(undefined)),
      setDefaultReportView: vi.fn(),
      clearDefaultReportView: vi.fn(),
    };
    if (opts.viewsFail) {
      viewsApi['listReportViews'].mockImplementation(() => {
        throw new Error('down');
      });
    }
    downloads = [];
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Report.Run'))),
        { provide: ReportsClient, useValue: rowsApi },
        { provide: ReportViewsClient, useValue: viewsApi },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        provideHttpClient(withInterceptors([problemDetailsInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    http = TestBed.inject(HttpTestingController);
    notify = TestBed.inject(NotificationService);
    fixture = TestBed.createComponent(ReportResultGrid);
    fixture.componentRef.setInput('result', opts.result ?? run());
    fixture.componentRef.setInput('reportId', 5);
    fixture.componentRef.setInput('reportName', 'Overdue tasks');
    problems = [];
    fixture.componentInstance.problem.subscribe((e) => problems.push(e));
    await settle(fixture);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.querySelectorAll('.p-dialog-mask, [role="tooltip"]').forEach((n) => n.remove());
  });

  describe('Export CSV', () => {
    it('is a secondary button with the download icon, last in the toolbar after Columns, in Title Case', async () => {
      await create();
      const button = exportButton();
      expect(button.textContent!.trim()).toBe('Export CSV');
      expect(button.classList.contains('mf-btn')).toBe(true);
      expect(button.classList.contains('mf-btn--primary')).toBe(false);
      expect(button.querySelector('i.pi-download')).not.toBeNull();
      const columns = q('mf-record-columns');
      expect(
        columns.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(button.getAttribute('aria-disabled')).toBeNull();
    });

    it('says in its tooltip what goes out: all rows, the filtered rows of the total, or the first rows of a truncated result', async () => {
      await create();
      expect(tip()).toBe('Exports all 2,380 rows.');
      fixture.destroy();
      TestBed.resetTestingModule();

      await create({
        rows: (_id, p = 1, size = 50) => ok(page({ filteredRows: 143, page: p, pageSize: size })),
      });
      expect(tip()).toBe('Exports the 143 filtered rows (of 2,380).');
      fixture.destroy();
      TestBed.resetTestingModule();

      await create({
        result: run({ truncated: true, rowCount: 50000 }),
        rows: (_id, p = 1, size = 50) =>
          ok(
            page({
              totalRows: 50000,
              filteredRows: 50000,
              truncated: true,
              page: p,
              pageSize: size,
            }),
          ),
      });
      expect(tip()).toBe('Exports the first 50,000 rows.');
    });

    it('is disabled with "There are no rows to export." when the filters leave no row, and a click sends nothing', async () => {
      await create({
        rows: (_id, p = 1, size = 50) =>
          ok(page({ rows: [], filteredRows: 0, page: p, pageSize: size })),
      });
      expect(exportButton().getAttribute('aria-disabled')).toBe('true');
      expect(tip()).toBe('There are no rows to export.');
      exportButton().click();
      await settle(fixture);
      expect(exportRequests()).toHaveLength(0);
    });

    it('is disabled while the first rows load', async () => {
      await create({ rows: () => NEVER });
      // Before the first page there is no toolbar yet (the skeleton shows), so there is nothing to press.
      expect(el().querySelector('[data-export-csv]')).toBeNull();
    });

    it('asks for the filtered and sorted rows in the visible columns and their order, as an authorised blob request, and saves the file under the name of the server', async () => {
      await create();
      q('th[data-col="Open Tasks"] button').click();
      await settle(fixture);
      q('th[data-col="Open Tasks"] button').click();
      await settle(fixture);
      fixture.componentInstance.filters.set('c0', 'acme');
      await settle(fixture);
      // Hours is hidden and Active moved before Open Tasks: the file has Matter, Active, Open Tasks.
      fixture.componentInstance.grid.set({
        order: ['Matter', 'Active', 'Open Tasks', 'Hours'],
        visible: ['Matter', 'Active', 'Open Tasks'],
      });
      await settle(fixture);

      exportButton().click();
      await settle(fixture);
      const [req] = exportRequests();
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      expect(req.request.url).toBe(
        '/api/v1/reports/runs/run-9/export.csv?sort=%231%3Adesc' +
          '&filter=' +
          encodeURIComponent(JSON.stringify([{ column: '#0', op: 'contains', value: 'acme' }])) +
          '&columns=%230&columns=%233&columns=%231',
      );
      req.flush(blob(), { headers: csvHeaders(143) });
      await settle(fixture);
      expect(downloads).toEqual(['overdue-tasks-20261107-1405.csv']);
    });

    it('two columns named Name: the sort, the filter and the export each hit the right one by position, and the header repeats the name (#1291)', async () => {
      const twins = [
        { name: 'Name', type: 'text' },
        { name: 'Name', type: 'text' },
        { name: 'Id', type: 'integer' },
      ];
      await create({
        result: run({ columns: twins as RunReportResponse['columns'] }),
        rows: (_id, p = 1, size = 50) =>
          ok(
            page({
              columns: twins as ReportRowsResponse['columns'],
              rows: [
                ['Ann', 'Smith', 1],
                ['Bob', 'Jones', 2],
              ],
              page: p,
              pageSize: size,
            }),
          ),
      });
      expect(all('thead tr:first-child th').map((th) => th.textContent!.trim())).toEqual([
        'Name',
        'Name',
        'Id',
      ]);
      // Sort by the second Name: position 1.
      q('th[data-col="Name (2)"] button').click();
      await settle(fixture);
      expect(lastCall()[3]).toBe('#1:asc');
      // Filter the second Name: position 1 again, never the first.
      fixture.componentInstance.filters.set('c1', 'smith');
      await settle(fixture);
      expect(JSON.parse(lastCall()[4] as string)).toEqual([
        { column: '#1', op: 'contains', value: 'smith' },
      ]);
      // Export: every visible column by its position, in order, so both Names go out under their own number.
      exportButton().click();
      await settle(fixture);
      const [req] = exportRequests();
      expect(req.request.url).toBe(
        '/api/v1/reports/runs/run-9/export.csv?sort=%231%3Aasc' +
          '&filter=' +
          encodeURIComponent(JSON.stringify([{ column: '#1', op: 'contains', value: 'smith' }])) +
          '&columns=%230&columns=%231&columns=%232',
      );
      req.flush(blob('\ufeffName,Name,Id\r\n'), { headers: csvHeaders(1) });
      await settle(fixture);
    });

    it('shows a spinner and aria-busy on the button while the file is made, ignores a second press, and says so politely', async () => {
      await create();
      exportButton().click();
      await settle(fixture);
      expect(exportButton().getAttribute('aria-busy')).toBe('true');
      expect(exportButton().getAttribute('aria-disabled')).toBe('true');
      expect(exportButton().querySelector('i.pi-spinner')).not.toBeNull();
      expect(q('[data-export-status]').textContent).toContain('Preparing the CSV.');
      exportButton().click();
      await settle(fixture);
      const pending = exportRequests();
      expect(pending).toHaveLength(1);
      pending[0].flush(blob(), { headers: csvHeaders(2380) });
      await settle(fixture);
      expect(exportButton().getAttribute('aria-busy')).toBeNull();
      expect(exportButton().querySelector('i.pi-download')).not.toBeNull();
    });

    it('says "Exported N rows to CSV." with the count of the server, and nothing about truncation for a whole result', async () => {
      await create();
      exportButton().click();
      await settle(fixture);
      exportRequests()[0].flush(blob(), { headers: csvHeaders(2380) });
      await settle(fixture);
      expect(toasts().map((t) => [t.severity, t.summary, t.detail])).toEqual([
        ['success', 'Exported 2,380 rows to CSV.', undefined],
      ]);
    });

    it('says "Exported 50,000 rows (truncated)." with a notice that the result was cut at that many rows', async () => {
      await create({
        result: run({ truncated: true, rowCount: 50000 }),
        rows: (_id, p = 1, size = 50) =>
          ok(
            page({
              totalRows: 50000,
              filteredRows: 50000,
              truncated: true,
              page: p,
              pageSize: size,
            }),
          ),
      });
      exportButton().click();
      await settle(fixture);
      exportRequests()[0].flush(blob(), { headers: csvHeaders(50000, true) });
      await settle(fixture);
      const [toast] = toasts();
      expect(toast.summary).toBe('Exported 50,000 rows (truncated).');
      expect(toast.detail).toBe(
        'The result was truncated at 50,000 rows. Narrow the parameters to export the rest.',
      );
    });

    it('treats an expired result (410) like the rows endpoint does: the page is told, no toast, and the button stays off', async () => {
      await create();
      exportButton().click();
      await settle(fixture);
      exportRequests()[0].flush(
        new Blob([JSON.stringify({ code: 'RESULT_EXPIRED', status: 410 })], {
          type: 'application/problem+json',
        }),
        { status: 410, statusText: 'Gone' },
      );
      await settle(fixture);
      expect(problems).toHaveLength(1);
      expect(problems[0].status).toBe(410);
      expect(toasts()).toEqual([]);
      expect(exportButton().getAttribute('aria-disabled')).toBe('true');
      expect(downloads).toEqual([]);
    });

    it("treats a result that is not the person's (404) the same way", async () => {
      await create();
      exportButton().click();
      await settle(fixture);
      exportRequests()[0].flush(new Blob(['{}'], { type: 'application/problem+json' }), {
        status: 404,
        statusText: 'Not Found',
      });
      await settle(fixture);
      expect(problems.map((p) => p.status)).toEqual([404]);
      expect(toasts()).toEqual([]);
    });

    it('says "Couldn\'t export the report." with Retry for a refused query (400), and Retry asks again', async () => {
      await create();
      exportButton().click();
      await settle(fixture);
      exportRequests()[0].flush(
        new Blob([JSON.stringify({ code: 'RESULT_QUERY_INVALID', detail: 'Unknown column.' })], {
          type: 'application/problem+json',
        }),
        { status: 400, statusText: 'Bad Request' },
      );
      await settle(fixture);
      expect(problems).toEqual([]);
      const toast = toasts()[0];
      expect(toast.severity).toBe('error');
      expect(toast.summary).toBe("Couldn't export the report.");
      expect(toast.action?.label).toBe('Retry');
      expect(exportButton().getAttribute('aria-disabled')).toBeNull();
      toast.action!.run();
      await settle(fixture);
      const again = exportRequests();
      expect(again).toHaveLength(1);
      again[0].flush(blob(), { headers: csvHeaders(2380) });
      await settle(fixture);
      expect(toasts().at(-1)!.summary).toBe('Exported 2,380 rows to CSV.');
    });

    it('does not drop the result: the grid never calls the drop endpoint (one-result rule)', async () => {
      await create();
      exportButton().click();
      await settle(fixture);
      exportRequests()[0].flush(blob(), { headers: csvHeaders(2380) });
      await settle(fixture);
      expect(http.match((r) => r.method === 'DELETE')).toHaveLength(0);
      expect(Object.keys(rowsApi)).toEqual(['getReportRows']);
    });
  });

  describe('Saved Views', () => {
    const userId = (): number | undefined => TestBed.inject(AuthStore).profile()?.userId;
    const layoutOfDefault = aView({
      viewId: 3,
      name: 'Weekly',
      isDefault: true,
      layout: {
        columns: [
          { name: 'Matter', hidden: false, width: 300 },
          { name: 'Active', hidden: false, width: undefined },
          { name: 'Open Tasks', hidden: false, width: 150 },
          { name: 'Hours', hidden: true, width: undefined },
        ],
        sort: [{ column: 'Open Tasks', descending: true }],
        filters: [{ column: 'Matter', op: 'contains', value: 'acme', value2: undefined }],
        pageSize: 25,
      },
    });
    const filterOf = (...f: object[]) => JSON.stringify(f);

    it('reads the views once and puts the button first in the toolbar, saying Saved Views', async () => {
      await create({ views: [aView()] });
      expect(viewsApi['listReportViews']).toHaveBeenCalledTimes(1);
      expect(viewsApi['listReportViews']).toHaveBeenCalledWith(5);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Saved Views');
      const bar = q('[data-list-toolbar]');
      expect(bar.querySelector('[data-views-trigger]')).not.toBeNull();
      // After Search and Filters, before the Sorted by line and Columns (the shared toolbar's view slot).
      const filtersButton = bar.querySelector('mf-filters-toggle')!;
      const trigger = q('[data-views-trigger]');
      expect(
        filtersButton.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        trigger.compareDocumentPosition(q('mf-record-columns')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('opens on the default view: its columns, order, hidden columns, widths, sort, filters and page size are in the first request', async () => {
      await create({ views: [layoutOfDefault] });
      expect(rowsApi.getReportRows).toHaveBeenCalledTimes(1);
      expect(lastCall()).toEqual([
        'run-9',
        1,
        25,
        '#1:desc',
        filterOf({ column: '#0', op: 'contains', value: 'acme' }),
      ]);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Weekly');
      expect(all('thead tr:first-child th').map((th) => th.textContent!.trim())).toEqual([
        'Matter',
        'Active',
        'Open Tasks',
      ]);
      expect(loadColumnWidths(columnWidthsKey('report-result-5', userId()))).toEqual({
        Matter: 300,
        'Open Tasks': 150,
      });
      expect(q('mf-sorted-line').textContent).toContain('Sorted by Open Tasks');
      expect(q('mf-filter-chips').textContent).toContain('Matter');
    });

    it('does not say "(modified)" for what it just applied, and says it after a change of the grid', async () => {
      await create({ views: [layoutOfDefault] });
      expect(q('[data-views-label]').textContent!.trim()).toBe('Weekly');
      q('th[data-col="Matter"] button').click();
      await settle(fixture);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Weekly (modified)');
    });

    it('never runs a report and asks for rows only of the result it was given', async () => {
      await create({ views: [layoutOfDefault] });
      expect(Object.keys(rowsApi)).toEqual(['getReportRows']);
    });

    it('shows no note for a view the result fits, and the info banner with Dismiss for one that names a column the result lacks', async () => {
      await create({ views: [layoutOfDefault] });
      expect(el().querySelector('[data-view-skipped]')).toBeNull();
      fixture.destroy();
      TestBed.resetTestingModule();

      const stale = aView({
        viewId: 4,
        name: 'Old',
        isDefault: true,
        layout: {
          columns: [
            { name: 'Gone', hidden: false, width: undefined },
            { name: 'Matter', hidden: false, width: undefined },
          ],
          sort: [],
          filters: [],
          pageSize: 50,
        },
      });
      await create({ views: [stale] });
      const note = q('[data-view-skipped]');
      expect(note.classList.contains('pg-banner--info')).toBe(true);
      expect(note.textContent).toContain(
        'This view uses columns the report no longer returns. They were skipped.',
      );
      expect(all('thead tr:first-child th').map((th) => th.textContent!.trim())).toEqual([
        'Matter',
        'Open Tasks',
        'Hours',
        'Active',
      ]);
      q('[data-dismiss-view-note]').click();
      await settle(fixture);
      expect(el().querySelector('[data-view-skipped]')).toBeNull();
    });

    it('also shows the note when the server dropped the columns (ignoredColumns)', async () => {
      await create({ views: [aView({ viewId: 4, isDefault: true, ignoredColumns: ['Gone'] })] });
      expect(el().querySelector('[data-view-skipped]')).not.toBeNull();
    });

    it("applies a chosen view at once, on page 1, and the Default row puts the grid back to the report's own columns, no sort, no filters, 50 a page", async () => {
      await create({ views: [{ ...layoutOfDefault, isDefault: false }] });
      expect(lastCall()).toEqual(['run-9', 1, 50, undefined, undefined]);
      q('[data-views-trigger]').click();
      await settle(fixture);
      q('[data-view-apply]').click();
      await settle(fixture);
      expect(lastCall()).toEqual([
        'run-9',
        1,
        25,
        '#1:desc',
        filterOf({ column: '#0', op: 'contains', value: 'acme' }),
      ]);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Weekly');

      q('[data-views-trigger]').click();
      await settle(fixture);
      q('[data-view-default-row]').click();
      await settle(fixture);
      expect(lastCall()).toEqual(['run-9', 1, 50, undefined, undefined]);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Saved Views');
      expect(all('thead tr:first-child th').map((th) => th.textContent!.trim())).toEqual([
        'Matter',
        'Open Tasks',
        'Hours',
        'Active',
      ]);
      expect(loadColumnWidths(columnWidthsKey('report-result-5', userId()))).toEqual({});
      expect(el().querySelector('mf-sorted-line')).toBeNull();
    });

    it('saves the grid as a new view from its own state and shows that view as applied and unchanged', async () => {
      await create();
      q('th[data-col="Hours"] button').click();
      await settle(fixture);
      fixture.componentInstance.grid.set({
        order: ['Hours', 'Matter', 'Open Tasks', 'Active'],
        visible: ['Hours', 'Matter', 'Active'],
      });
      await settle(fixture);
      viewsApi['createReportView'].mockImplementation(
        (_id: number, body: { name: string; layout: ReportViewLayout }) =>
          ok(aView({ viewId: 11, name: body.name, layout: body.layout })),
      );
      q('[data-views-trigger]').click();
      await settle(fixture);
      q('[data-view-save-new]').click();
      await settle(fixture);
      document.body.querySelector<HTMLButtonElement>('[data-panel-primary] button')!.click();
      await settle(fixture);
      expect(viewsApi['createReportView']).toHaveBeenCalledTimes(1);
      const [reportId, body] = viewsApi['createReportView'].mock.calls[0];
      expect(reportId).toBe(5);
      expect(body.name).toBe('Overdue tasks view');
      expect(body.isDefault).toBe(false);
      expect(
        body.layout.columns.map((c: { name: string; hidden: boolean }) => [c.name, c.hidden]),
      ).toEqual([
        ['Hours', false],
        ['Matter', false],
        ['Open Tasks', true],
        ['Active', false],
      ]);
      expect(body.layout.sort).toEqual([{ column: 'Hours', descending: false }]);
      expect(body.layout.pageSize).toBe(50);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Overdue tasks view');
    });

    it('goes back to "Saved Views" when the applied view is deleted', async () => {
      await create({ views: [layoutOfDefault] });
      expect(q('[data-views-label]').textContent!.trim()).toBe('Weekly');
      q('[data-views-trigger]').click();
      await settle(fixture);
      q('[data-view-delete]').click();
      await settle(fixture);
      Array.from(document.body.querySelectorAll<HTMLElement>('.p-dialog button'))
        .find((b) => b.textContent!.trim() === 'Delete View')!
        .click();
      await settle(fixture);
      expect(viewsApi['deleteReportView']).toHaveBeenCalledWith(5, 3);
      expect(q('[data-views-label]').textContent!.trim()).toBe('Saved Views');
    });

    it('still shows the rows when the views cannot be read, and the menu says so with Retry', async () => {
      await create({ viewsFail: true });
      expect(rowsApi.getReportRows).toHaveBeenCalledTimes(1);
      expect(q('mf-record-grid')).not.toBeNull();
      q('[data-views-trigger]').click();
      await settle(fixture);
      expect(q('[data-views-error]').textContent).toContain("Couldn't load saved views.");
    });
  });
});
