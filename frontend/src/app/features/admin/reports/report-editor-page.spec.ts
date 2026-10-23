import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import {
  ReportAdminClient,
  ReportAssignmentClient,
  ReportChoicesClient,
  ReportDefinitionsClient,
  ReportSchemaClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  FakeMeApi,
  apiError,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ReportEditorPage, editorTabOf, problemLength } from './report-editor-page';
import { aCategory, aPreview, aReport, anAnalysis } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

describe('editorTabOf', () => {
  it('opens Details unless the address names a tab the person can use', () => {
    expect(editorTabOf(undefined, false, true)).toBe('details');
    expect(editorTabOf('query', false, false)).toBe('query');
    expect(editorTabOf('parameters', true, false)).toBe('parameters');
    expect(editorTabOf('roles', false, true)).toBe('roles');
    expect(editorTabOf('roles', false, false)).toBe('details');
    expect(editorTabOf('roles', true, true)).toBe('details');
    expect(editorTabOf('history', false, false)).toBe('history');
    expect(editorTabOf('history', true, false)).toBe('details');
    expect(editorTabOf('nonsense', false, true)).toBe('details');
  });

  it('marks a problem to the end of the word, at most 40 characters', () => {
    expect(problemLength('SELECT FROM x', 7)).toBe(4);
    expect(problemLength('SELECT', 6)).toBe(1);
    expect(problemLength('a'.repeat(100), 0)).toBe(40);
    expect(problemLength('x(y', 0)).toBe(1);
  });
});

describe('ReportEditorPage (#713, #714)', () => {
  let admin: Record<
    'analyzeReportSql' | 'previewReport' | 'activateReport' | 'deactivateReport',
    Mock
  >;
  let defs: Record<
    | 'listReportCategories'
    | 'getAdminReport'
    | 'createReport'
    | 'updateReport'
    | 'restoreReportVersion'
    | 'listReportVersions'
    | 'compareReportVersions',
    Mock
  >;
  let fixture: ComponentFixture<ReportEditorPage>;
  let navigate: Mock;
  let report = aReport();
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const type = (sel: string, value: string): void => {
    const input = q<HTMLInputElement>(sel);
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function create(
    permissions: Permission[],
    id: string | undefined,
    tab?: string,
    analysis = anAnalysis(),
  ): Promise<void> {
    localStorage.clear();
    report = aReport();
    admin = {
      analyzeReportSql: vi.fn().mockReturnValue(ok(analysis)),
      previewReport: vi.fn().mockReturnValue(ok(aPreview())),
      activateReport: vi.fn().mockReturnValue(ok({ reportId: 5, isActive: true })),
      deactivateReport: vi.fn().mockReturnValue(ok({ reportId: 5, isActive: false })),
    };
    defs = {
      listReportCategories: vi
        .fn()
        .mockReturnValue(
          ok([
            aCategory(),
            aCategory({ categoryId: 2, name: 'Finance', sortOrder: 2 }),
            aCategory({ categoryId: 3, name: 'Old', isActive: false }),
          ]),
        ),
      getAdminReport: vi.fn().mockImplementation(() => ok(report)),
      createReport: vi
        .fn()
        .mockReturnValue(ok({ reportId: 9, versionId: 1, versionNo: 1, rowVersion: 'N1' })),
      updateReport: vi.fn().mockImplementation(() => {
        report = aReport({ versionNo: 4, rowVersion: 'RV2' });
        return ok({
          versionId: 41,
          versionNo: 4,
          isActive: false,
          deactivated: false,
          unchanged: false,
          rowVersion: 'RV2',
          preview: undefined,
        });
      }),
      restoreReportVersion: vi.fn().mockReturnValue(
        ok({
          versionId: 50,
          versionNo: 5,
          isActive: false,
          deactivated: true,
          unchanged: false,
          rowVersion: 'RV3',
          preview: undefined,
        }),
      ),
      listReportVersions: vi.fn().mockReturnValue(ok([])),
      compareReportVersions: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ReportAdminClient, useValue: admin },
        { provide: ReportDefinitionsClient, useValue: defs },
        {
          provide: ReportSchemaClient,
          useValue: {
            searchReportSchema: vi
              .fn()
              .mockReturnValue(of({ tables: [], total: 0, page: 1, pageSize: 40 })),
          },
        },
        { provide: ReportChoicesClient, useValue: { testReportChoiceQuery: vi.fn() } },
        {
          provide: ReportAssignmentClient,
          useValue: {
            getRolesOfReport: vi.fn().mockReturnValue(ok([])),
            setRolesOfReport: vi.fn(),
          },
        },
      ],
    });
    await TestBed.compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ReportEditorPage);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    if (tab) fixture.componentRef.setInput('tab', tab);
    await settle(fixture);
  }

  const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

  describe('as a person who manages reports and may assign them', () => {
    beforeEach(() => create(['Report.Manage', 'Report.Assign'], '5'));

    it('loads the report into the header, the status line and the Details tab', () => {
      expect(q('[data-page-title]').textContent).toContain('Overdue tasks');
      expect(q('[data-status]').textContent).toBe('Inactive');
      expect(q('[data-state-line]').textContent).toContain('Version 3');
      expect(q<HTMLInputElement>('#rep-name').value).toBe('Overdue tasks');
      expect(q<HTMLSelectElement>('#rep-category').selectedOptions[0].textContent).toContain(
        'Task follow-up',
      );
      // An inactive category is not offered for a different report.
      expect(
        [...el().querySelectorAll('#rep-category option')].map((o) => o.textContent!.trim()),
      ).toEqual(['Task follow-up', 'Finance']);
      expect(
        [...el().querySelectorAll('[role=tab]')].map((t) =>
          t.textContent!.replace(/\s+/g, ' ').trim(),
        ),
      ).toEqual(['Details', 'Query', 'Parameters (0)', 'Roles', 'History']);
    });

    it('hides Activate and says why until the saved version has a successful preview', async () => {
      expect(el().querySelector('[data-activate]')).toBeNull();
      expect(q('[data-activate-reason]').textContent).toContain(
        'Preview the current version to activate it.',
      );

      report = aReport({ canActivate: true });
      await TestBed.inject(Router).navigate([]);
      fixture.componentRef.setInput('id', '5');
      // A load of the same report again (the Reload button) shows Activate.
      (fixture.componentInstance as unknown as { load(id: string): Promise<void> }).load('5');
      await settle(fixture);
      expect(q('[data-activate]')).not.toBeNull();
      expect(el().querySelector('[data-activate-reason]')).toBeNull();
    });

    it('detects a new placeholder after a pause in typing and adds its parameter', async () => {
      admin.analyzeReportSql.mockReturnValue(
        ok(anAnalysis([{ name: 'CLIENT' }, { name: 'TODAY', builtIn: true }])),
      );
      (fixture.componentInstance as unknown as { sql: { set(v: string): void } }).sql.set(
        'SELECT :CLIENT, :TODAY',
      );
      await waitFor(500);
      await settle(fixture);

      expect(admin.analyzeReportSql).toHaveBeenLastCalledWith({
        sql: 'SELECT :CLIENT, :TODAY',
        lists: [],
      });
      expect(
        [...el().querySelectorAll('[role=tab]')].map((t) =>
          t.textContent!.replace(/\s+/g, ' ').trim(),
        )[2],
      ).toBe('Parameters (1)');
      expect(q('[data-announce]').textContent).toContain('Parameter CLIENT added.');
    });

    it('blocks Save with explicit messages for invalid SQL and a missing definition and writes nothing', async () => {
      admin.analyzeReportSql.mockReturnValue(
        ok(
          anAnalysis([{ name: 'KIND' }], [{ line: 2, column: 5, message: 'Only one statement.' }]),
        ),
      );
      type('#rep-name', '');
      (fixture.componentInstance as unknown as { sql: { set(v: string): void } }).sql.set(
        'SELECT 1;\nDROP TABLE x',
      );
      await waitFor(500);
      await settle(fixture);
      (fixture.componentInstance as unknown as { defs: { set(v: unknown[]): void } }).defs.set([]);
      q<HTMLButtonElement>('[data-save]').click();
      await settle(fixture);

      const summary = q('[data-summary]').textContent!;
      expect(summary).toContain('Enter a name for the report.');
      expect(summary).toContain('Query, line 2, column 5: Only one statement.');
      expect(defs.updateReport).not.toHaveBeenCalled();
      expect(q('[data-summary]').hasAttribute('hidden')).toBe(false);
    });

    it('saves with the row version it last read and reloads, saying which version it is', async () => {
      const notify = TestBed.inject(NotificationService);
      const success = vi.spyOn(notify, 'success');
      type('#rep-name', 'Overdue tasks by pod');
      type('#rep-note', 'renamed');
      q<HTMLButtonElement>('[data-save]').click();
      await settle(fixture);

      expect(defs.updateReport).toHaveBeenCalledTimes(1);
      const [id, body, ifMatch] = defs.updateReport.mock.calls[0];
      expect(id).toBe(5);
      expect(ifMatch).toBe('RV1');
      expect(body).toMatchObject({
        name: 'Overdue tasks by pod',
        categoryId: 1,
        sql: 'SELECT 1 AS one',
        parameters: [],
        changeNote: 'renamed',
        keepActive: false,
      });
      expect(success).toHaveBeenCalledWith('Saved as version 4.');
      expect(defs.getAdminReport).toHaveBeenCalledTimes(2);
      expect(q('[data-state-line]').textContent).toContain('Version 4');
    });

    it('offers the Reload button when someone else saved first', async () => {
      defs.updateReport.mockReturnValue(
        apiError(409, { code: 'CONCURRENCY_CONFLICT', title: 'Conflict' }),
      );
      q<HTMLButtonElement>('[data-save]').click();
      await settle(fixture);

      expect(q('[data-conflict]').textContent).toContain('Someone else saved this report');
      q<HTMLButtonElement>('[data-reload]').click();
      await settle(fixture);
      expect(el().querySelector('[data-conflict]')).toBeNull();
    });

    it('shows a name that is taken as an error on the name field', async () => {
      defs.updateReport.mockReturnValue(
        apiError(409, { code: 'DUPLICATE_NAME', title: 'Duplicate' }),
      );
      q<HTMLButtonElement>('[data-save]').click();
      await settle(fixture);

      expect(q('#rep-name-error').textContent).toContain('Another report already has this name.');
      expect(q('#rep-name').getAttribute('aria-invalid')).toBe('true');
    });

    it('previews the unsaved text with the parameters, shows the rows and then offers Activate for the saved version', async () => {
      admin.previewReport.mockReturnValue(
        ok(aPreview({ countsForActivation: true, rowVersion: 'RV9' })),
      );
      q<HTMLButtonElement>('[data-preview]').click();
      await settle(fixture);

      expect(admin.previewReport).toHaveBeenCalledWith(5, {
        sql: 'SELECT 1 AS one',
        parameters: [],
        sampleValues: {},
      });
      expect(q('[data-preview-ok]').textContent).toContain('First 1 of 1 row');
      expect(q('[data-activate]')).not.toBeNull();

      // The next save uses the row version the preview produced, or it would be a conflict.
      q<HTMLButtonElement>('[data-save]').click();
      await settle(fixture);
      expect(defs.updateReport.mock.calls[0][2]).toBe('RV9');
    });

    it('does not offer Activate while the editor holds unsaved changes', async () => {
      admin.previewReport.mockReturnValue(
        ok(aPreview({ countsForActivation: true, rowVersion: 'RV9' })),
      );
      q<HTMLButtonElement>('[data-preview]').click();
      await settle(fixture);
      type('#rep-name', 'Changed');
      await settle(fixture);

      expect(el().querySelector('[data-activate]')).toBeNull();
      expect(q('[data-activate-reason]').textContent).toContain('Save your changes');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });

    it('activates and deactivates (with a question), keeping everything else', async () => {
      report = aReport({ canActivate: true });
      (fixture.componentInstance as unknown as { load(id: string): Promise<void> }).load('5');
      await settle(fixture);
      q<HTMLButtonElement>('[data-activate]').click();
      await settle(fixture);
      expect(admin.activateReport).toHaveBeenCalledWith(5);

      report = aReport({ isActive: true, canActivate: true });
      (fixture.componentInstance as unknown as { load(id: string): Promise<void> }).load('5');
      await settle(fixture);
      expect(q('[data-status]').textContent).toBe('Active');
      q<HTMLButtonElement>('[data-deactivate]').click();
      await settle(fixture);
      const confirm = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Deactivate' && b.closest('p-dialog, .p-dialog'),
      );
      confirm!.click();
      await settle(fixture);
      expect(admin.deactivateReport).toHaveBeenCalledWith(5);
    });

    it('restores a version with the current row version and tells the author to preview it', async () => {
      const notify = TestBed.inject(NotificationService);
      const success = vi.spyOn(notify, 'success');
      await (fixture.componentInstance as unknown as { restore(n: number): Promise<void> }).restore(
        1,
      );
      await settle(fixture);

      expect(defs.restoreReportVersion).toHaveBeenCalledWith(5, 1, 'RV1');
      expect(success).toHaveBeenCalledWith(
        'Version 1 restored as version 5. Preview it to activate.',
      );
    });

    it('keeps the numbers of the query tab: line numbers, a labelled editor and a problem list', async () => {
      admin.analyzeReportSql.mockReturnValue(
        ok(anAnalysis([], [{ line: 1, column: 8, message: 'Bad.' }])),
      );
      fixture.componentRef.setInput('tab', 'query');
      await settle(fixture);
      await waitFor(500);
      await settle(fixture);

      expect(q('textarea').getAttribute('aria-label')).toBe('Query');
      expect(q('[data-sql-problems]').textContent).toContain('Line 1, column 8');
      expect(q('[data-analysis-state]').textContent).toContain('1 problem found');
    });
  });

  describe('permission variants', () => {
    it('hides the Roles tab without Report.Assign', async () => {
      await create(['Report.Manage'], '5');
      expect(
        [...el().querySelectorAll('[role=tab]')].map((t) => t.textContent!.trim()),
      ).not.toContain('Roles');
    });

    it('creates a new report with the starter query and goes to its page', async () => {
      await create(['Report.Manage'], undefined);
      expect(q('[data-page-title]').textContent).toContain('New report');
      expect(el().querySelector('[data-preview]')).toBeNull();
      type('#rep-name', 'My report');
      q<HTMLButtonElement>('[data-save]').click();
      await settle(fixture);

      expect(defs.createReport).toHaveBeenCalledTimes(1);
      expect(defs.createReport.mock.calls[0][0]).toMatchObject({
        name: 'My report',
        categoryId: 1,
        sql: 'SELECT 1 AS Example',
        parameters: [],
      });
      expect(navigate).toHaveBeenCalledWith(['/admin/reports', 9], { replaceUrl: true });
    });

    it('shows a plain message for a report that does not exist', async () => {
      defs = undefined as never;
      await create(['Report.Manage'], '12abc');
      expect(q('[data-not-found]').textContent).toContain('Report not found');
    });
  });
});
