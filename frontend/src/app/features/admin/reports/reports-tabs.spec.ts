import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  ReportAdminClient,
  ReportAssignmentClient,
  ReportDefinitionsClient,
} from '../../../api/generated/api-client';
import { ReportCategoriesTab } from './report-categories-tab';
import { ReportMatrixTab } from './report-matrix-tab';
import { ReportRunsTab } from './report-runs-tab';
import { ReportsHealthTab } from './reports-health-tab';
import { aCategory } from './reports-testing';
import { ApiError } from '../../../core/http/api-error';
import { HttpErrorResponse } from '@angular/common/http';
import { AdminTabCounts } from '../admin-tabs';

const settle = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
};

describe('ReportCategoriesTab (#712)', () => {
  const api = {
    listReportCategories: vi.fn(),
    createReportCategory: vi.fn(),
    updateReportCategory: vi.fn(),
  };

  async function create() {
    api.listReportCategories.mockReset().mockReturnValue(
      of([
        aCategory(),
        aCategory({
          categoryId: 2,
          name: 'Old',
          sortOrder: 5,
          isActive: false,
          reportCount: 0,
          rowVersion: 'CAT2',
        }),
      ]),
    );
    api.createReportCategory.mockReset();
    api.updateReportCategory.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        AdminTabCounts,
        { provide: ReportDefinitionsClient, useValue: api },
      ],
    });
    const fixture = TestBed.createComponent(ReportCategoriesTab);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lists every category with its order, report count and a status in text', async () => {
    const { el } = await create();
    const cells = [...el.querySelectorAll('tbody tr')].map((r) =>
      [...r.querySelectorAll('td')]
        .map((c) => c.textContent!.replace(/\s+/g, ' ').trim())
        .slice(0, 4),
    );
    expect(cells[0]).toEqual(['Task follow-up', '1', '2', 'Active']);
    expect(cells[1]).toEqual(['Old', '5', '0', 'Inactive']);
  });

  it('adds a category in a row at the top and sends it', async () => {
    const { fixture, el } = await create();
    api.createReportCategory.mockReturnValue(of(aCategory({ categoryId: 3, name: 'Finance' })));
    fixture.componentInstance.startNew();
    await settle(fixture);
    expect(el.querySelector('tr[data-row="new"]')).not.toBeNull();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    const name = el.querySelector<HTMLInputElement>('#cat-name')!;
    name.value = 'Finance';
    name.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await settle(fixture);
    expect(api.createReportCategory).toHaveBeenCalledWith({
      name: 'Finance',
      sortOrder: 6,
      isActive: true,
    });
    expect(el.querySelector('tr[data-editing]')).toBeNull();
  });

  it('refuses an empty name on the field and does not call the API', async () => {
    const { fixture, el } = await create();
    fixture.componentInstance.startNew();
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await settle(fixture);
    expect(api.createReportCategory).not.toHaveBeenCalled();
    expect(el.querySelector('[data-name-error]')!.textContent).toContain('Enter a name.');
    expect(el.querySelector('#cat-name')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('edits a row with its row version, shows a taken name on the field and reloads after a conflict', async () => {
    const { fixture, el } = await create();
    el.querySelector<HTMLButtonElement>('[data-edit][aria-label="Edit Old"]')!.click();
    await settle(fixture);
    const active = el.querySelector<HTMLInputElement>('[data-active]')!;
    active.checked = true;
    active.dispatchEvent(new Event('change'));
    api.updateReportCategory.mockReturnValueOnce(
      throwError(() =>
        ApiError.from(new HttpErrorResponse({ status: 409, error: { code: 'DUPLICATE_NAME' } })),
      ),
    );
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await settle(fixture);
    expect(api.updateReportCategory).toHaveBeenCalledWith(
      2,
      { name: 'Old', sortOrder: 5, isActive: true },
      'CAT2',
    );
    expect(el.querySelector('[data-name-error]')!.textContent).toContain(
      'Another category already has this name.',
    );

    api.updateReportCategory.mockReturnValueOnce(
      throwError(() =>
        ApiError.from(
          new HttpErrorResponse({ status: 409, error: { code: 'CONCURRENCY_CONFLICT' } }),
        ),
      ),
    );
    el.querySelector<HTMLButtonElement>('[data-save]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-failure]')!.textContent).toContain(
      'Someone else changed this category',
    );
    expect(api.listReportCategories).toHaveBeenCalledTimes(2);
  });
});

describe('ReportRunsTab (#712)', () => {
  const api = { listReportRuns: vi.fn() };
  const run = (n: number, over = {}) => ({
    runId: n,
    reportId: 5,
    reportName: 'Overdue tasks',
    versionNo: 2,
    userId: 1,
    userName: 'Ann',
    startedAtUtc: '2026-10-22T10:00:00Z',
    finishedAtUtc: '2026-10-22T10:00:01Z',
    status: 'Succeeded',
    kind: 'Run',
    rowCount: 132,
    truncated: false,
    durationMs: 412,
    errorCode: undefined,
    parameters: ['MAX=2'],
    ...over,
  });

  it('shows the log, filters by status and kind, and loads older runs', async () => {
    api.listReportRuns.mockReset().mockReturnValueOnce(
      of({
        items: [run(9), run(8, { status: 'Failed', errorCode: 'SQL_8134', rowCount: undefined })],
        nextBefore: 8,
      }),
    );
    TestBed.configureTestingModule({ providers: [{ provide: ReportAdminClient, useValue: api }] });
    const fixture = TestBed.createComponent(ReportRunsTab);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(api.listReportRuns).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      50,
    );
    expect(el.querySelector('[data-run="9"]')!.textContent).toContain('Overdue tasks');
    expect(el.querySelector('[data-run="9"]')!.textContent).toContain('MAX=2');
    expect(el.querySelector('[data-run="8"]')!.textContent).toContain('SQL_8134');

    api.listReportRuns.mockReturnValueOnce(of({ items: [run(7)], nextBefore: undefined }));
    el.querySelector<HTMLButtonElement>('[data-more]')!.click();
    await settle(fixture);
    expect(api.listReportRuns).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      8,
      50,
    );
    expect(el.querySelectorAll('[data-run]')).toHaveLength(3);
    expect(el.querySelector('[data-more]')).toBeNull();

    api.listReportRuns.mockReturnValueOnce(of({ items: [], nextBefore: undefined }));
    const status = el.querySelector<HTMLSelectElement>('#runs-status')!;
    status.value = 'Failed';
    status.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(api.listReportRuns).toHaveBeenLastCalledWith(
      undefined,
      'Failed',
      undefined,
      undefined,
      undefined,
      50,
    );
    expect(el.querySelector('[data-empty]')!.textContent).toContain('No runs yet.');
  });
});

describe('ReportsHealthTab (#712)', () => {
  const ready = {
    enabled: true,
    state: 'Ready',
    message: 'Reports are ready.',
    login: {
      loginName: 'mf_reports',
      writesDenied: true,
      auditTablesDenied: true,
      readableTables: 33,
      compatibilityLevel: 160,
      checkedAtUtc: '2026-10-22T10:00:00Z',
    },
  };

  it('shows the login facts and can check again', async () => {
    const api = {
      getReportsStatus: vi.fn().mockReturnValue(of(ready)),
      checkReportsStatus: vi.fn().mockReturnValue(
        of({
          enabled: false,
          state: 'LoginFailed',
          message: 'The report login could not connect.',
          login: undefined,
        }),
      ),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ReportAdminClient, useValue: api }] });
    const fixture = TestBed.createComponent(ReportsHealthTab);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-chip]')!.textContent).toBe('Ready');
    expect(el.querySelector('[data-login]')!.textContent).toContain('mf_reports');
    expect(el.querySelector('[data-login]')!.textContent).toContain('Denied');
    expect(el.querySelector('[data-login]')!.textContent).toContain('33');

    el.querySelector<HTMLButtonElement>('[data-check]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-chip]')!.textContent).toBe('Not ready');
    expect(el.querySelector('[data-state]')!.textContent).toContain('could not connect');
    expect(el.querySelector('[data-login]')).toBeNull();
  });
});

describe('ReportMatrixTab (#717)', () => {
  it('shows a Yes where a role holds a report and a text alternative where it does not', async () => {
    const matrix = {
      roles: [
        { id: 1, name: 'Pod Lead' },
        { id: 2, name: 'Director' },
      ],
      reports: [
        {
          reportId: 5,
          name: 'Overdue tasks',
          categoryId: 1,
          categoryName: 'Task follow-up',
          categorySortOrder: 1,
          sortOrder: 1,
          isActive: true,
          assigned: false,
        },
        {
          reportId: 6,
          name: 'Open tasks',
          categoryId: 1,
          categoryName: 'Task follow-up',
          categorySortOrder: 1,
          sortOrder: 2,
          isActive: false,
          assigned: false,
        },
      ],
      cells: [
        { roleId: 1, reportId: 5 },
        { roleId: 2, reportId: 6 },
      ],
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReportAssignmentClient,
          useValue: { getReportAssignmentMatrix: vi.fn().mockReturnValue(of(matrix)) },
        },
      ],
    });
    const fixture = TestBed.createComponent(ReportMatrixTab);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const row = (id: number) =>
      [...el.querySelectorAll(`[data-report="${id}"] td`)].map((c) =>
        c.textContent!.replace(/\s+/g, ' ').trim(),
      );
    expect(row(5)).toEqual(['Yes', 'No-']);
    expect(row(6)).toEqual(['No-', 'Yes']);
    expect(el.querySelector('[data-report="6"] th')!.textContent).toContain('inactive');
    expect([...el.querySelectorAll('thead th')].map((t) => t.textContent!.trim())).toEqual([
      'Report',
      'Pod Lead',
      'Director',
    ]);
    expect(el.querySelector('.mf-scroll table')).not.toBeNull();
    expect(TestBed.inject(Router)).toBeDefined();
  });

  it('says so when there is nothing to show', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ReportAssignmentClient,
          useValue: {
            getReportAssignmentMatrix: vi
              .fn()
              .mockReturnValue(of({ roles: [], reports: [], cells: [] })),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(ReportMatrixTab);
    await settle(fixture);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-empty]')!.textContent,
    ).toContain('There are no reports yet.');
  });
});
