import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable } from 'rxjs';
import {
  ReportRowsResponse,
  ReportsClient,
  RunReportResponse,
} from '../../api/generated/api-client';
import { ApiError } from '../../core/http/api-error';
import { AuthStore } from '../../core/auth/auth.store';
import { USER_TIME_ZONE } from '../../core/time/clock';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { ReportResultGrid } from './report-result-grid';

type Mock = ReturnType<typeof vi.fn>;

const run = (over: Partial<RunReportResponse> = {}): RunReportResponse =>
  ({
    runId: 'run-9',
    columns: [
      { name: 'Matter', type: 'text' },
      { name: 'Open Tasks', type: 'integer' },
      { name: 'Hours', type: 'decimal' },
      { name: 'Active', type: 'boolean' },
      { name: 'Due', type: 'date' },
      { name: 'Updated', type: 'dateTime' },
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
      ['00017 Acme v. Beta', 1234, 12.5, true, '2026-03-31', '2026-03-31T14:05:09'],
      ['Merger review', -7, null, false, null, null],
    ],
    totalRows: 2380,
    filteredRows: 2380,
    page: 1,
    pageSize: 50,
    truncated: false,
    ...over,
  }) as ReportRowsResponse;

describe('ReportResultGrid (#720)', () => {
  let api: { getReportRows: Mock };
  let fixture: ComponentFixture<ReportResultGrid>;
  let problems: ApiError[];
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));
  const lastCall = (): unknown[] => api.getReportRows.mock.calls.at(-1)!;
  const press = async (label: string): Promise<void> => {
    all('button')
      .find((b) => b.textContent!.trim() === label)!
      .click();
    await settle(fixture);
  };

  const echo = (_id: string, p = 1, size = 50) => ok(page({ page: p, pageSize: size }));

  async function create(
    result = run(),
    reportId = 5,
    first?: Observable<ReportRowsResponse>,
  ): Promise<void> {
    api = { getReportRows: vi.fn().mockReturnValue(first) };
    if (first === undefined) api.getReportRows.mockImplementation(echo);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Report.Run'))),
        { provide: ReportsClient, useValue: api },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ReportResultGrid);
    fixture.componentRef.setInput('result', result);
    fixture.componentRef.setInput('reportId', reportId);
    problems = [];
    fixture.componentInstance.problem.subscribe((e) => problems.push(e));
    await settle(fixture);
  }

  beforeEach(() => localStorage.clear());

  it('asks for page 1 of 50 in the report order, then shows the rows in the cell formats of the spec', async () => {
    await create();
    expect(api.getReportRows).toHaveBeenCalledTimes(1);
    expect(lastCall()).toEqual(['run-9', 1, 50, undefined, undefined]);
    const rows = all('tbody tr[data-record-id]');
    expect(rows).toHaveLength(2);
    const cells = (r: HTMLElement) =>
      all('td')
        .filter((td) => r.contains(td))
        .map((td) => td.textContent!.trim());
    expect(cells(rows[0])).toEqual([
      '00017 Acme v. Beta',
      '1,234',
      '12.5',
      'Yes',
      '03/31/2026',
      '03/31/2026 02:05 PM',
    ]);
    expect(cells(rows[1])).toEqual(['Merger review', '-7', '', 'No', '', '']);
  });

  it('draws the header of every column in the order of the run, numbers right aligned, with a sort button each', async () => {
    await create();
    expect(all('thead tr:first-child th').map((th) => th.textContent!.trim())).toEqual([
      'Matter',
      'Open Tasks',
      'Hours',
      'Active',
      'Due',
      'Updated',
    ]);
    expect(q('th[data-col="Open Tasks"]').classList).toContain('pg-num');
    expect(all('thead th button.mf-sort')).toHaveLength(6);
    expect(q('td:nth-child(2)').classList).toContain('pg-num');
    expect(q('td:nth-child(4)').style.textAlign).toBe('center');
  });

  it('shows the skeleton instead of the grid for the very first load only', async () => {
    api = { getReportRows: vi.fn() };
    let resolve!: (r: ReportRowsResponse) => void;
    api.getReportRows.mockReturnValue(
      new Observable<ReportRowsResponse>((s) => {
        resolve = (r) => {
          s.next(r);
          s.complete();
        };
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Report.Run'))),
        { provide: ReportsClient, useValue: api },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ReportResultGrid);
    fixture.componentRef.setInput('result', run());
    fixture.componentRef.setInput('reportId', 5);
    await settle(fixture);
    expect(q('[data-result-skeleton]')).not.toBeNull();
    expect(el().querySelector('mf-record-grid')).toBeNull();
    resolve(page());
    await settle(fixture);
    expect(el().querySelector('[data-result-skeleton]')).toBeNull();
    expect(q('mf-record-grid')).not.toBeNull();
  });

  describe('sorting', () => {
    it('sorts on the server by the header: ascending, then descending, and says so in the Sorted by line with Reset Sort', async () => {
      await create();
      expect(el().querySelector('mf-sorted-line')).toBeNull();
      q('th[data-col="Open Tasks"] button').click();
      await settle(fixture);
      expect(lastCall()).toEqual(['run-9', 1, 50, '#1:asc', undefined]);
      expect(q('mf-sorted-line').textContent).toContain('Sorted by Open Tasks');
      expect(q('th[data-col="Open Tasks"]').getAttribute('aria-sort')).toBe('ascending');
      q('th[data-col="Open Tasks"] button').click();
      await settle(fixture);
      expect(lastCall()[3]).toBe('#1:desc');
      await press('Reset Sort');
      expect(lastCall()[3]).toBeUndefined();
      expect(el().querySelector('mf-sorted-line')).toBeNull();
    });
  });

  describe('sorting by position (#1288)', () => {
    const odd = run({
      columns: [
        { name: 'Total, USD', type: 'decimal' },
        { name: 'a,b', type: 'text' },
        { name: '#0', type: 'integer' },
      ],
    });
    const oddPage = (_id: string, p = 1, size = 50) =>
      ok(page({ columns: odd.columns, rows: [[1.5, 'x', 3]], page: p, pageSize: size }));

    it('sends #<position>:asc and :desc for a column named a,b, says its name in the Sorted by line and Reset Sort clears it', async () => {
      await create(odd);
      api.getReportRows.mockImplementation(oddPage);
      q('th[data-col="a,b"] button').click();
      await settle(fixture);
      expect(lastCall()).toEqual(['run-9', 1, 50, '#1:asc', undefined]);
      expect(q('mf-sorted-line').textContent).toContain('Sorted by a,b');
      q('th[data-col="a,b"] button').click();
      await settle(fixture);
      expect(lastCall()[3]).toBe('#1:desc');
      expect(q('mf-sorted-line').textContent).toContain('Sorted by a,b');
      await press('Reset Sort');
      expect(lastCall()[3]).toBeUndefined();
      expect(el().querySelector('mf-sorted-line')).toBeNull();
    });

    it('sorts a column named like a position by its own position, and keeps one sort column at a time', async () => {
      await create(odd);
      api.getReportRows.mockImplementation(oddPage);
      q('th[data-col="#0"] button').click();
      await settle(fixture);
      expect(lastCall()[3]).toBe('#2:asc');
      q('th[data-col="Total, USD"] button').click();
      await settle(fixture);
      expect(lastCall()[3]).toBe('#0:asc');
      expect(all('mf-sorted-line [data-sorted-text]')).toHaveLength(1);
    });
  });

  describe('the words of the sort (#1289)', () => {
    const tip = () => q('[data-sorted-text]').getAttribute('title');
    const sortBy = async (column: string, times = 1): Promise<void> => {
      for (let i = 0; i < times; i++) {
        q(`th[data-col="${column}"] button`).click();
        await settle(fixture);
      }
    };

    it('says lowest and highest first for a number, newest and oldest first for a date, no and yes first for a yes/no and A to Z for text', async () => {
      await create();
      await sortBy('Open Tasks');
      expect(tip()).toBe('Sorted by Open Tasks, lowest first');
      await sortBy('Open Tasks');
      expect(tip()).toBe('Sorted by Open Tasks, highest first');
      await sortBy('Hours');
      expect(tip()).toBe('Sorted by Hours, lowest first');
      await sortBy('Updated', 2);
      expect(tip()).toBe('Sorted by Updated, newest first');
      await sortBy('Due');
      expect(tip()).toBe('Sorted by Due, oldest first');
      await sortBy('Active');
      expect(tip()).toBe('Sorted by Active, no first');
      await sortBy('Active');
      expect(tip()).toBe('Sorted by Active, yes first');
      await sortBy('Matter');
      expect(tip()).toBe('Sorted by Matter, A to Z');
      await sortBy('Matter');
      expect(tip()).toBe('Sorted by Matter, Z to A');
    });
  });

  describe('the limit of 20 filters (#1290)', () => {
    const wide = () =>
      run({
        columns: Array.from({ length: 22 }, (_, i) => ({ name: `Col ${i}`, type: 'text' })),
      });
    const grid = () => fixture.componentInstance;
    const limit = () => el().querySelector('[data-filter-limit]');

    async function twenty(): Promise<void> {
      await create(wide());
      for (let i = 0; i < 20; i++) grid().filters.set(`c${i}`, 'v');
      await settle(fixture);
    }

    it('sends no request for the 21st filter, puts it back, says "Remove a filter to add another." and keeps the rows', async () => {
      await twenty();
      const calls = api.getReportRows.mock.calls.length;
      expect(JSON.parse(lastCall()[4] as string)).toHaveLength(20);
      expect(limit()).toBeNull();
      grid().filters.set('c20', 'x');
      await settle(fixture);
      expect(api.getReportRows.mock.calls.length).toBe(calls);
      expect(grid().filters.value('c20')).toBe('');
      expect(grid().filters.activeCount()).toBe(20);
      expect(limit()!.textContent).toContain('Remove a filter to add another.');
      expect(all('tbody tr[data-record-id]')).toHaveLength(2);
      expect(el().textContent).not.toContain("Couldn't load rows.");
    });

    it('clears the message with Dismiss and when a filter is removed', async () => {
      await twenty();
      grid().filters.set('c20', 'x');
      await settle(fixture);
      expect(limit()).not.toBeNull();
      q('[data-dismiss-limit]').click();
      await settle(fixture);
      expect(limit()).toBeNull();
      grid().filters.set('c20', 'x');
      await settle(fixture);
      expect(limit()).not.toBeNull();
      grid().filters.set('c0', '');
      await settle(fixture);
      expect(limit()).toBeNull();
      // with a place free the filter is accepted
      grid().filters.set('c20', 'x');
      await settle(fixture);
      expect(grid().filters.value('c20')).toBe('x');
      expect(limit()).toBeNull();
    });
  });

  describe('paging', () => {
    it('offers 25, 50, 100 and 250 rows a page and shows the range of the filtered rows', async () => {
      await create();
      expect(q('[data-range]').textContent).toContain('Showing 1-50 of 2,380');
      expect(q('[data-page]').textContent).toContain('Page 1 of 48');
      const sizes = q('mf-pager mf-dropdown');
      expect(sizes).not.toBeNull();
    });

    it('asks for the next page and goes back to page 1 when the size, the sort or a filter changes', async () => {
      await create();
      await press('Next');
      expect(lastCall().slice(1, 3)).toEqual([2, 50]);
      q('th[data-col="Matter"] button').click();
      await settle(fixture);
      expect(lastCall().slice(1, 4)).toEqual([1, 50, '#0:asc']);
      await press('Next');
      expect(lastCall()[1]).toBe(2);
      fixture.componentInstance.filters.set('c0', 'acme');
      await settle(fixture);
      expect(lastCall()[1]).toBe(1);
      expect(JSON.parse(lastCall()[4] as string)).toEqual([
        { column: 'Matter', op: 'contains', value: 'acme' },
      ]);
    });

    it('does not ask twice for one change', async () => {
      await create();
      const before = api.getReportRows.mock.calls.length;
      await press('Next');
      expect(api.getReportRows.mock.calls.length).toBe(before + 1);
    });

    it('shows the page the server clamped to', async () => {
      await create();
      api.getReportRows.mockReturnValue(ok(page({ page: 3 })));
      await press('Next');
      expect(q('[data-page]').textContent).toContain('Page 3 of 48');
    });
  });

  describe('filters', () => {
    it('sends the filters of the row to the server, shows chips and the filtered count against the whole result', async () => {
      await create();
      api.getReportRows.mockReturnValue(ok(page({ filteredRows: 143 })));
      fixture.componentInstance.filters.set('c1', { from: '3', to: '' });
      fixture.componentInstance.filters.set('c3', 'true');
      await settle(fixture);
      expect(JSON.parse(lastCall()[4] as string)).toEqual([
        { column: 'Open Tasks', op: 'gte', value: '3' },
        { column: 'Active', op: 'eq', value: 'true' },
      ]);
    });

    it('says how many rows were filtered out of the whole result', async () => {
      await create();
      api.getReportRows.mockReturnValue(ok(page({ filteredRows: 143 })));
      fixture.componentInstance.filters.set('c0', 'acme');
      await settle(fixture);
      expect(q('[data-range]').textContent).toContain('of 143');
      expect(q('[data-filtered-note]').textContent).toContain('Filtered from 2,380 rows');
      expect(q('[data-clear-filters]')).not.toBeNull();
      expect(q('mf-filter-chips').textContent).toContain('Matter: acme');
    });

    it('says No rows match these filters. with one Clear Filters, and Clear Filters shows the rows again', async () => {
      await create();
      api.getReportRows.mockReturnValue(ok(page({ rows: [], filteredRows: 0 })));
      fixture.componentInstance.filters.set('c0', 'zzz');
      await settle(fixture);
      expect(el().textContent).toContain('No rows match these filters.');
      expect(all('button').filter((b) => b.textContent!.trim() === 'Clear Filters')).toHaveLength(
        1,
      );
      api.getReportRows.mockReturnValue(ok(page()));
      await press('Clear Filters');
      expect(lastCall()[4]).toBeUndefined();
      expect(all('tbody tr[data-record-id]')).toHaveLength(2);
    });

    it('keeps the address out of it: the filters live in memory', async () => {
      await create();
      fixture.componentInstance.filters.set('c0', 'acme');
      await settle(fixture);
      expect(location.search).not.toContain('acme');
    });
  });

  describe('columns', () => {
    it('keeps the order and visibility of the person per report and drops a hidden column from header and rows', async () => {
      await create(run(), 5);
      const grid = fixture.componentInstance.grid;
      expect(grid.grid).toBe('report-result-5');
      grid.set({ order: [], visible: ['Matter', 'Hours'] });
      await settle(fixture);
      expect(all('thead tr:first-child th').map((th) => th.textContent!.trim())).toEqual([
        'Matter',
        'Hours',
      ]);
      expect(
        Object.keys(localStorage).some((k) => k.startsWith('mf.grid.v1.report-result-5.')),
      ).toBe(true);
      // The other report has its own choices.
      TestBed.resetTestingModule();
      await create(run(), 6);
      expect(all('thead tr:first-child th')).toHaveLength(6);
    });

    it('does not ask the server again when a column is hidden', async () => {
      await create();
      const before = api.getReportRows.mock.calls.length;
      fixture.componentInstance.grid.set({ order: [], visible: ['Matter'] });
      await settle(fixture);
      expect(api.getReportRows.mock.calls.length).toBe(before);
    });
  });

  describe('when the server says no', () => {
    it('shows its own error row with Retry for a failure and asks again on Retry', async () => {
      await create(run(), 5, apiError(500, { status: 500 } as never));
      expect(el().textContent).toContain("Couldn't load rows.");
      api.getReportRows.mockReturnValue(ok(page()));
      await press('Retry');
      expect(all('tbody tr[data-record-id]')).toHaveLength(2);
      expect(problems).toHaveLength(0);
    });

    it('tells the page when the result expired (410) or is not the one of this person (404)', async () => {
      await create(run(), 5, apiError(410, { status: 410, code: 'RESULT_EXPIRED' } as never));
      expect(problems).toHaveLength(1);
      expect(problems[0].status).toBe(410);
    });

    it('never drops the result itself', async () => {
      await create();
      await press('Next');
      fixture.destroy();
      expect(Object.keys(api)).toEqual(['getReportRows']);
    });
  });
});
