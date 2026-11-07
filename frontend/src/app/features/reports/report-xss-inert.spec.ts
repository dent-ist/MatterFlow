import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  ReportRowsResponse,
  ReportViewsClient,
  ReportsClient,
  RunReportResponse,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { USER_TIME_ZONE } from '../../core/time/clock';
import {
  FakeMeApi,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { ReportResultGrid } from './report-result-grid';
import { ReportsListPage } from './reports-list-page';
import { aCategory, aListItem, aView } from './reports-testing';

/**
 * Issue #726 (carried over from #725): text that a report author or a person typed (a report name, a category, a description, a column name, a cell, a
 * saved view name) is DATA. The security suite proves the server never turns it into markup; this spec proves the browser never does either: every one
 * of these strings, written as markup and as script, is shown as the characters it is, creates no element, and runs nothing.
 */
const IMG = '<img src=x onerror="window.__xss = 1">';
const SCRIPT = '<script>window.__xss = 1</script>';
const BOLD = '<b id="xss-bold">bold</b>';
const ANCHOR = '<a href="javascript:window.__xss=1" id="xss-link">click</a>';
const IFRAME = '<iframe src="javascript:window.__xss=1"></iframe>';
const ENTITY = '&lt;i&gt;not italic&lt;/i&gt; &amp; 5 &gt; 3';

/** No element that the markup would have made, anywhere in the page (the menu and the dialogs live in the body). */
function expectInert(root: ParentNode): void {
  for (const selector of [
    'img[src="x"]',
    'script',
    '#xss-bold',
    '#xss-link',
    'iframe',
    '[onerror]',
  ]) {
    expect(root.querySelector(selector), selector).toBeNull();
  }
  expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
}

afterEach(() => {
  delete (window as unknown as { __xss?: number }).__xss;
});

describe('Reports: text from authors and people is inert (XSS, #726)', () => {
  describe('the result grid and the Saved Views menu', () => {
    const columns = [
      { name: IMG, type: 'text' },
      { name: `${SCRIPT}${BOLD}`, type: 'text' },
      { name: 'Plain', type: 'text' },
    ];
    const result = {
      runId: 'run-x',
      columns,
      rowCount: 1,
      truncated: false,
      durationMs: 3,
      maxRows: 50000,
    } as RunReportResponse;
    const rows = {
      columns,
      rows: [[`${SCRIPT}${IMG}`, `${BOLD}${ANCHOR}`, `${IFRAME}${ENTITY}`]],
      totalRows: 1,
      filteredRows: 1,
      page: 1,
      pageSize: 50,
      truncated: false,
    } as ReportRowsResponse;
    const views = [
      aView({ viewId: 1, name: `${IMG}${BOLD}`, isDefault: false }),
      aView({ viewId: 2, name: SCRIPT, isDefault: false }),
    ];
    let fixture: ComponentFixture<ReportResultGrid>;
    const el = (): HTMLElement => fixture.nativeElement;

    beforeEach(async () => {
      localStorage.clear();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideFakeMe(new FakeMeApi(withPermissions('Report.Run'))),
          {
            provide: ReportsClient,
            useValue: { getReportRows: vi.fn().mockReturnValue(ok(rows)) },
          },
          {
            provide: ReportViewsClient,
            useValue: { listReportViews: vi.fn().mockReturnValue(ok({ views, limit: 25 })) },
          },
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: USER_TIME_ZONE, useValue: 'UTC' },
        ],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      fixture = TestBed.createComponent(ReportResultGrid);
      fixture.componentRef.setInput('result', result);
      fixture.componentRef.setInput('reportId', 5);
      fixture.componentRef.setInput('reportName', `${IMG} report`);
      await settle(fixture);
    });

    afterEach(() => {
      document.body
        .querySelectorAll('.p-dialog-mask, [role="tooltip"], [data-views-panel]')
        .forEach((n) => n.remove());
    });

    it('shows a cell as the characters it holds: no element, no script, the entity text stays entity text', () => {
      const cells = Array.from(el().querySelectorAll('tbody td')).map((td) =>
        td.textContent!.trim(),
      );
      expect(cells).toContain(`${SCRIPT}${IMG}`);
      expect(cells).toContain(`${BOLD}${ANCHOR}`);
      // "&lt;" in the data is the five characters &lt;, not a "<": the cell is never decoded as HTML.
      expect(cells).toContain(`${IFRAME}${ENTITY}`);
      expectInert(el());
    });

    it('shows a column name as text in its header, in the Columns chooser and in the filter chip, and uses no name as a selector or an id', async () => {
      const headers = Array.from(el().querySelectorAll('thead tr:first-child th')).map((th) =>
        th.textContent!.trim(),
      );
      expect(headers[0]).toBe(IMG);
      expect(headers[1]).toBe(`${SCRIPT}${BOLD}`);
      fixture.componentInstance.filters.set('c0', 'x');
      await settle(fixture);
      expect(el().querySelector('[data-filter-chips]')?.textContent).toContain(IMG);
      expectInert(el());
      expectInert(document.body);
    });

    it('shows a saved view name as text in the menu, and in the Rename and Delete dialogs', async () => {
      el().querySelector<HTMLButtonElement>('[data-views-trigger]')!.click();
      await settle(fixture);
      const panel = document.body.querySelector('[data-views-panel]')!;
      const names = Array.from(panel.querySelectorAll('[data-view-apply]')).map((b) =>
        b.textContent!.replace(/\s+/g, ' ').trim(),
      );
      expect(names.some((n) => n.includes(`${IMG}${BOLD}`))).toBe(true);
      expect(names.some((n) => n.includes(SCRIPT))).toBe(true);
      expectInert(document.body);

      panel.querySelector<HTMLButtonElement>('[data-view-delete]')!.click();
      await settle(fixture);
      const text = document.body.querySelector('[data-view-delete-text]')!.textContent!;
      expect(text).toContain(`${IMG}${BOLD}`);
      expectInert(document.body);
    });
  });

  describe('the Reports list', () => {
    let fixture: ComponentFixture<ReportsListPage>;

    it('shows a report name, a category and a description as text, in the row, the band and the search', async () => {
      localStorage.clear();
      const query = fakeQuery();
      const response = {
        totalReports: 1,
        categories: [
          aCategory({
            categoryId: 1,
            name: `${SCRIPT}${IMG}`,
            reports: [
              aListItem({
                reportId: 5,
                name: `${IMG}${BOLD}`,
                description: `${ANCHOR}${IFRAME}`,
                parameterLabels: [IMG],
                hasParameters: true,
                parameterCount: 1,
              }),
            ],
          }),
        ],
      };
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          query.provider,
          provideFakeMe(new FakeMeApi(withPermissions('Report.Run'))),
          {
            provide: ReportsClient,
            useValue: { listMyReports: vi.fn().mockReturnValue(ok(response)) },
          },
        ],
      });
      vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
      await TestBed.inject(AuthStore).ensureLoaded();
      query.set({});
      fixture = TestBed.createComponent(ReportsListPage);
      await settle(fixture);
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('td[data-report]')!.getAttribute('data-report')).toBe(
        `${IMG}${BOLD}`,
      );
      expect(root.querySelector('td[data-report]')!.textContent).toContain(`${IMG}${BOLD}`);
      expect(root.querySelector('tr.rg-group')!.textContent).toContain(`${SCRIPT}${IMG}`);
      expect(root.textContent).toContain(`${ANCHOR}${IFRAME}`);
      expectInert(root);
      expectInert(document.body);
    });
  });
});
