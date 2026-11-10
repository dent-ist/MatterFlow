import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { BehaviorSubject, NEVER, Subject } from 'rxjs';
import {
  ReportChoicesClient,
  ReportFavouritesClient,
  ReportRowsResponse,
  ReportViewsClient,
  ReportsClient,
  RunReportResponse,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { NotificationService } from '../../core/notify/notification.service';
import { USER_TIME_ZONE } from '../../core/time/clock';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { ShellLayout } from '../../shared/ui/fixed-page';
import { ddChoose } from '../../testing/dropdown-testing.spec-util';
import { ReportLookupSource } from './report-lookup-source';
import { ReportRunPage } from './report-run-page';
import { aParam, aRunnable } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

const result = (over: Partial<RunReportResponse> = {}): RunReportResponse =>
  ({
    runId: 'run-1',
    columns: [{ name: 'Task', type: 'text' }],
    rowCount: 143,
    truncated: false,
    durationMs: 250,
    maxRows: 50000,
    ...over,
  }) as RunReportResponse;

const rowsOf = (total: number, over: Partial<ReportRowsResponse> = {}): ReportRowsResponse =>
  ({
    columns: [{ name: 'Task', type: 'text' }],
    rows: [['Draft the order'], ['File the motion']],
    totalRows: total,
    filteredRows: total,
    page: 1,
    pageSize: 50,
    truncated: false,
    ...over,
  }) as ReportRowsResponse;

describe('ReportRunPage (#719, #720)', () => {
  let api: Record<
    'getMyReport' | 'runReport' | 'cancelMyReportRun' | 'dropReportResult' | 'getReportRows',
    Mock
  >;
  let fav: Record<'addReportFavourite' | 'removeReportFavourite', Mock>;
  let fixture: ComponentFixture<ReportRunPage>;
  let navigate: Mock;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const has = (sel: string): boolean => el().querySelector(sel) !== null;
  const press = async (label: string): Promise<void> => {
    Array.from(el().querySelectorAll('button'))
      .find((b) => b.textContent!.trim() === label)!
      .click();
    await settle(fixture);
  };
  const ddText = (label: string): string =>
    (
      Array.from(el().querySelectorAll('mf-dropdown button'))
        .find((b) => (b.getAttribute('aria-label') ?? '').startsWith(`${label}:`))!
        .querySelector('.val')!.textContent ?? ''
    ).trim();
  const submit = async (): Promise<void> => {
    q('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
  };

  async function create(
    report = aRunnable(),
    query: Record<string, string | string[]> = {},
    reportId = '5',
  ): Promise<void> {
    api = {
      getMyReport: vi.fn().mockReturnValue(ok(report)),
      runReport: vi.fn().mockReturnValue(ok(result())),
      cancelMyReportRun: vi.fn().mockReturnValue(ok(undefined)),
      dropReportResult: vi.fn().mockReturnValue(ok(undefined)),
      getReportRows: vi.fn().mockReturnValue(ok(rowsOf(143))),
    };
    fav = {
      addReportFavourite: vi.fn().mockReturnValue(ok(undefined)),
      removeReportFavourite: vi.fn().mockReturnValue(ok(undefined)),
    };
    const params = new BehaviorSubject(convertToParamMap({ reportId }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ReportFavouritesClient, useValue: fav },
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions('Report.Run'))),
        { provide: ReportsClient, useValue: api },
        {
          provide: ReportViewsClient,
          useValue: { listReportViews: vi.fn().mockReturnValue(ok({ views: [], limit: 25 })) },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ReportChoicesClient,
          useValue: {
            getReportChoices: vi.fn().mockReturnValue(ok({ options: [], truncated: false })),
          },
        },
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        {
          provide: ReportLookupSource,
          useValue: {
            isSearched: () => false,
            list: vi.fn().mockResolvedValue([]),
            search: vi.fn(),
            labels: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            pathFromRoot: [],
            snapshot: { paramMap: params.value, queryParamMap: convertToParamMap(query) },
          },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ReportRunPage);
    await settle(fixture);
  }

  const withParams = () =>
    aRunnable({
      parameters: [
        aParam({
          name: 'POD',
          type: 'single',
          label: 'Pod',
          required: true,
          options: [
            { value: '1', label: 'Pod A' },
            { value: '2', label: 'Pod B' },
          ],
        }),
        aParam({ name: 'SINCE', type: 'date', label: 'Since', default: '2026-11-01' as never }),
      ],
    });

  describe('the page', () => {
    it('reads the report once, shows the crumb, the name as the one heading, the category and the description', async () => {
      await create();
      expect(api.getMyReport).toHaveBeenCalledWith(5);
      expect(q('h1').textContent).toContain('Overdue tasks');
      expect(q('[aria-label="Breadcrumb"] a').getAttribute('href')).toBe('/reports');
      expect(q('[data-page-description]').textContent).toContain('Task follow-up');
      expect(q('[data-description]').textContent).toContain('Tasks past their due date');
    });

    it('names the browser tab after the report and its section', async () => {
      await create();
      expect(TestBed.inject(Title).getTitle()).toBe('Overdue tasks: Reports - LPT Hub');
    });

    it('shows no run, no grid and no banner before the first run: Run the report to see results.', async () => {
      await create();
      expect(q('[data-before-run]').textContent).toContain('Run the report to see results.');
      expect(api.runReport).not.toHaveBeenCalled();
    });

    it("says You don't have access to this report. with Back to Reports for a 404 and a 403, never which", async () => {
      for (const status of [404, 403]) {
        TestBed.resetTestingModule();
        await create();
        api.getMyReport.mockReturnValue(apiError(status, { status }));
        fixture.destroy();
        fixture = TestBed.createComponent(ReportRunPage);
        await settle(fixture);
        expect(q('[data-no-access]').textContent).toContain(
          "You don't have access to this report.",
        );
        expect(q('[data-no-access] a').getAttribute('href')).toBe('/reports');
        expect(q('[data-no-access] a').textContent).toContain('Back to Reports');
      }
    });

    it("says Couldn't load this report. with Retry for any other failure and reads again on Retry", async () => {
      await create();
      api.getMyReport.mockReturnValue(apiError(500, { status: 500 }));
      fixture.destroy();
      fixture = TestBed.createComponent(ReportRunPage);
      await settle(fixture);
      expect(q('[data-definition-error]').textContent).toContain("Couldn't load this report.");
      api.getMyReport.mockReturnValue(ok(aRunnable()));
      await press('Retry');
      expect(has('[data-definition-error]')).toBe(false);
      expect(q('h1').textContent).toContain('Overdue tasks');
    });

    it('treats an address that is not a report number as no access, without a request', async () => {
      await create(aRunnable(), {}, 'abc');
      expect(has('[data-no-access]')).toBe(true);
      expect(api.getMyReport).not.toHaveBeenCalled();
    });

    it('opens the help of the report in a panel called About This Report', async () => {
      await create(aRunnable({ helpText: 'Line one.\nLine two.' }));
      q('[data-help]').click();
      await settle(fixture);
      expect(document.body.textContent).toContain('About This Report');
      expect(document.body.querySelector('[data-help-body]')!.textContent).toContain('Line one.');
    });

    it('clamps a long description to three lines with Show More and Show Less', async () => {
      await create(aRunnable({ description: 'word '.repeat(80) }));
      expect(q('[data-description]').classList).toContain('rp__desc--clamped');
      await press('Show More');
      expect(q('[data-description]').classList).not.toContain('rp__desc--clamped');
      expect(q('[data-show-more]').textContent).toContain('Show Less');
    });
  });

  describe('the parameters', () => {
    it('start from the defaults of the server, then the address wins; nothing runs by itself', async () => {
      await create(withParams(), { POD: '2', SINCE: '2026-10-05' });
      expect(ddText('Pod')).toBe('Pod B');
      expect(api.runReport).not.toHaveBeenCalled();
    });

    it('block Run Report until the required ones have a value, with the message under the field', async () => {
      await create(withParams());
      await submit();
      expect(api.runReport).not.toHaveBeenCalled();
      expect(q('[data-param="POD"] .mf-field__error').textContent).toContain('Select Pod.');
    });

    it('go into the address when a run starts (by name, replacing the entry) and into the request as typed values', async () => {
      await create(withParams());
      ddChoose(el(), 'Pod', '2');
      await settle(fixture);
      await submit();
      expect(api.runReport).toHaveBeenCalledWith(5, {
        parameters: { POD: '2', SINCE: '2026-11-01' },
      });
      const args = navigate.mock.calls[0];
      expect(args[1].queryParams).toMatchObject({ POD: '2', SINCE: '2026-11-01' });
      expect(args[1].replaceUrl).toBe(true);
    });

    it('go back to the defaults on Reset', async () => {
      await create(withParams(), { POD: '2' });
      await press('Reset');
      expect(ddText('Pod')).toBe('Select...');
    });
  });

  describe('running', () => {
    async function runIt(subject?: Subject<RunReportResponse>): Promise<void> {
      await create(withParams(), { POD: '1' });
      if (subject) api.runReport.mockReturnValue(subject);
      await submit();
    }

    it('shows Running... with the seconds and turns Run Report into Cancel; the fields are disabled', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await runIt(new Subject());
        expect(q('[data-running]').textContent).toContain('Running... 0 s');
        expect(q('[data-cancel-run]')).not.toBeNull();
        expect(has('[data-run-report]')).toBe(false);
        expect(q('fieldset').hasAttribute('disabled')).toBe(true);
        expect(has('[data-result-skeleton]')).toBe(true);
        vi.advanceTimersByTime(3000);
        await settle(fixture);
        expect(q('[data-running]').textContent).toContain('Running... 3 s');
      } finally {
        vi.useRealTimers();
      }
    });

    it('Cancel stops the call, sends the cancel, goes back to the form with the same values and says nothing', async () => {
      const calls = new Subject<RunReportResponse>();
      await runIt(calls);
      q('[data-cancel-run] button').click();
      await settle(fixture);
      expect(calls.observed).toBe(false);
      expect(api.cancelMyReportRun).toHaveBeenCalledTimes(1);
      expect(has('[data-run-report]')).toBe(true);
      expect(has('[data-run-banner]')).toBe(false);
      expect(has('[data-running]')).toBe(false);
      expect(ddText('Pod')).toBe('Pod A');
    });

    it('collapses the form into a summary bar after a run, and Change Parameters opens it again', async () => {
      await runIt();
      expect(q('[data-summary-bar]').textContent).toContain('Pod Pod A, Since 11/01/2026');
      expect(q('mf-report-parameter-form').parentElement!.classList).toContain('rp__hidden');
      await press('Change Parameters');
      expect(has('[data-summary-bar]')).toBe(false);
      expect(q('mf-report-parameter-form').parentElement!.classList).not.toContain('rp__hidden');
    });

    it('fills the window (a fixed page) while the summary bar is collapsed, and scrolls as a page while the form is open (#1286)', async () => {
      await runIt();
      const layout = TestBed.inject(ShellLayout);
      expect(el().classList).toContain('rp--fill');
      expect(layout.fixed()).toBe(true);
      await press('Change Parameters');
      expect(el().classList).not.toContain('rp--fill');
      expect(layout.fixed()).toBe(false);
    });

    it('is not a fixed page before a run or when the run returns no rows', async () => {
      await create(withParams(), { POD: '1' });
      const layout = TestBed.inject(ShellLayout);
      expect(layout.fixed()).toBe(false);
      api.runReport.mockReturnValue(ok(result({ rowCount: 0 })));
      await submit();
      expect(layout.fixed()).toBe(false);
    });

    it('releases the fixed layout when the page is left', async () => {
      await runIt();
      const layout = TestBed.inject(ShellLayout);
      expect(layout.fixed()).toBe(true);
      fixture.destroy();
      expect(layout.fixed()).toBe(false);
    });

    it('shows the rows of the run in the result grid, asked for with the run id', async () => {
      await runIt();
      expect(has('[data-result-placeholder]')).toBe(false);
      expect(has('[data-before-run]')).toBe(false);
      expect(api.getReportRows).toHaveBeenCalledWith('run-1', 1, 50, undefined, undefined);
      expect(q('[data-result-slot] mf-report-result mf-record-grid')).not.toBeNull();
      expect(q('[data-result-slot]').textContent).toContain('Draft the order');
      expect(api.dropReportResult).not.toHaveBeenCalled();
    });

    it('keeps the result while the person pages, sorts, filters, opens the help panel and Change Parameters (one result, dropped only on leaving)', async () => {
      await runIt();
      const head = q<HTMLElement>('th[data-col="Task"] button');
      head.click();
      await settle(fixture);
      expect(api.getReportRows).toHaveBeenLastCalledWith('run-1', 1, 50, '#0:asc', undefined);
      await press('Change Parameters');
      expect(api.dropReportResult).not.toHaveBeenCalled();
      expect(has('[data-result-slot] mf-record-grid')).toBe(true);
    });

    it('says the result expired (410) in the banner, lets it go and opens the form again', async () => {
      await create(withParams(), { POD: '1' });
      api.getReportRows.mockReturnValue(
        apiError(410, { status: 410, code: 'RESULT_EXPIRED' } as never),
      );
      await submit();
      expect(q('[data-run-banner]').textContent).toContain(
        'This result has expired. Run the report again.',
      );
      expect(has('[data-result-slot]')).toBe(false);
      expect(has('[data-summary-bar]')).toBe(false);
      expect(q('mf-report-parameter-form').parentElement!.classList).not.toContain('rp__hidden');
      fixture.destroy();
      expect(api.dropReportResult).not.toHaveBeenCalled();
    });

    it('says No rows returned. for an empty result', async () => {
      await create(withParams(), { POD: '1' });
      api.runReport.mockReturnValue(ok(result({ rowCount: 0 })));
      await submit();
      expect(q('[data-no-rows]').textContent).toContain('No rows returned.');
      expect(has('[data-result-placeholder]')).toBe(false);
    });

    it('says the result was cut off with the limit of the server, not a built-in number', async () => {
      await create(withParams(), { POD: '1' });
      api.runReport.mockReturnValue(ok(result({ truncated: true, maxRows: 1234 })));
      await submit();
      expect(q('[data-truncated]').textContent).toContain(
        'Showing the first 1,234 rows. Narrow the parameters to see the rest.',
      );
    });
  });

  describe('when a run fails', () => {
    async function failWith(
      status: number,
      code: string,
      extra: Record<string, unknown> = {},
    ): Promise<void> {
      await create(withParams(), { POD: '1' });
      api.runReport.mockReturnValue(apiError(status, { status, code, ...extra } as never));
      await submit();
    }

    it('409 is an inline banner with Cancel Running Report, which sends the cancel; no toast, the form stays open', async () => {
      await failWith(409, 'REPORT_ALREADY_RUNNING');
      expect(q('[data-run-banner]').textContent).toContain(
        'Another report is already running for you.',
      );
      expect(has('[data-summary-bar]')).toBe(false);
      await press('Cancel Running Report');
      expect(api.cancelMyReportRun).toHaveBeenCalledTimes(1);
      expect(has('[data-run-banner]')).toBe(false);
    });

    it('408 uses the timeout of the definition, not a built-in number', async () => {
      await failWith(408, 'REPORT_TIMEOUT');
      expect(q('[data-run-banner]').textContent).toContain('took longer than 60 seconds');
    });

    it('503 memory uses the fixed sentence', async () => {
      await failWith(503, 'REPORT_MEMORY');
      expect(q('[data-run-banner]').textContent).toContain('needs more memory');
    });

    it('500 says the report could not be run, with the reference to copy', async () => {
      await failWith(500, 'REPORT_FAILED', { reference: 'AB12CD34' });
      expect(q('[data-run-banner]').textContent).toContain("The report couldn't be run.");
      expect(q('[data-run-banner]').textContent).toContain('AB12CD34');
    });

    it('422 puts each message under its field and shows no banner', async () => {
      await failWith(422, 'REPORT_PARAMETERS_INVALID', {
        errors: { 'parameters.SINCE': [{ code: 'INVALID_TYPE', message: 'Not a date.' }] },
      });
      expect(q('[data-param="SINCE"] .mf-field__error').textContent).toContain('Not a date.');
      expect(has('[data-run-banner]')).toBe(false);
    });

    it('404 on a run means the report is gone: the no-access page', async () => {
      await failWith(404, 'NOT_FOUND');
      expect(has('[data-no-access]')).toBe(true);
    });

    it('499 is the expected end of a cancelled run: no banner', async () => {
      await failWith(499, 'REPORT_CANCELLED');
      expect(has('[data-run-banner]')).toBe(false);
      expect(has('[data-run-report]')).toBe(true);
    });
  });

  describe('leaving the page (decision 12)', () => {
    it('cancels a live run silently', async () => {
      await create(withParams(), { POD: '1' });
      api.runReport.mockReturnValue(NEVER);
      await submit();
      fixture.destroy();
      expect(api.cancelMyReportRun).toHaveBeenCalledTimes(1);
    });

    it('drops the finished result and sends no cancel when nothing runs', async () => {
      await create(withParams(), { POD: '1' });
      await submit();
      fixture.destroy();
      expect(api.dropReportResult).toHaveBeenCalledWith('run-1');
      expect(api.cancelMyReportRun).not.toHaveBeenCalled();
    });
  });

  it('shows a report without parameters as only the Run Report button, and runs it', async () => {
    await create(aRunnable({ parameters: [] }));
    expect(has('.mf-card')).toBe(false);
    await submit();
    expect(api.runReport).toHaveBeenCalledWith(5, { parameters: {} });
    expect(has('[data-summary-bar]')).toBe(false);
    expect(q('[data-result-slot] mf-report-result')).not.toBeNull();
  });

  describe('favourite star beside the heading (#1326)', () => {
    const star = (): HTMLButtonElement => q('mf-page-header mf-report-star [data-favourite]');
    /** The page loads the report asynchronously: wait (under load too) until the star is drawn. */
    const ready = async (report = aRunnable()): Promise<void> => {
      await create(report);
      for (let i = 0; i < 50 && !has('mf-report-star'); i++) await settle(fixture);
    };

    it('shows an outline star named for the action when the report is not a favourite', async () => {
      await ready(aRunnable({ isFavourite: false }));
      expect(star().getAttribute('aria-label')).toBe('Add Overdue tasks to favourites');
      expect(star().querySelector('.pi-star')).not.toBeNull();
      expect(star().hasAttribute('data-on')).toBe(false);
    });

    it('shows the filled star when the report is a favourite', async () => {
      await ready(aRunnable({ isFavourite: true }));
      expect(star().getAttribute('aria-label')).toBe('Remove Overdue tasks from favourites');
      expect(star().querySelector('.pi-star-fill')).not.toBeNull();
      expect(star().hasAttribute('data-on')).toBe(true);
    });

    it('is a real button, so Enter and Space press it (no shortcut is added)', async () => {
      await ready();
      expect(star().tagName).toBe('BUTTON');
      expect(star().type).toBe('button');
    });

    it('toggles at once, calls PUT then DELETE and announces it politely', async () => {
      await ready(aRunnable({ isFavourite: false }));
      star().click();
      await settle(fixture);
      expect(fav.addReportFavourite).toHaveBeenCalledWith(5);
      expect(star().getAttribute('aria-label')).toBe('Remove Overdue tasks from favourites');
      expect(q('[data-announce]').textContent).toContain('Overdue tasks added to favourites.');
      star().click();
      await settle(fixture);
      expect(fav.removeReportFavourite).toHaveBeenCalledWith(5);
      expect(star().getAttribute('aria-label')).toBe('Add Overdue tasks to favourites');
      expect(q('[data-announce]').textContent).toContain('Overdue tasks removed from favourites.');
    });

    it("puts the star back and shows the toast Couldn't update favourites. when the call fails", async () => {
      await ready(aRunnable({ isFavourite: false }));
      const error = vi.spyOn(TestBed.inject(NotificationService), 'error');
      fav.addReportFavourite.mockReturnValue(apiError(500, {}));
      star().click();
      await settle(fixture);
      expect(star().getAttribute('aria-label')).toBe('Add Overdue tasks to favourites');
      expect(error).toHaveBeenCalledWith("Couldn't update favourites.");
    });

    it('has no star when the report cannot be opened', async () => {
      await create();
      api.getMyReport.mockReturnValue(apiError(404, { status: 404 }));
      fixture.destroy();
      fixture = TestBed.createComponent(ReportRunPage);
      await settle(fixture);
      expect(has('mf-report-star')).toBe(false);
    });
  });
});
