import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ReportAdminClient, ReportDefinitionsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  apiError,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AdminTabCounts } from '../admin-tabs';
import { ReportsListTab } from './reports-list-tab';
import { aCategory, aListItem } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

describe('ReportsListTab (#712)', () => {
  let defs: Record<'listAdminReports' | 'listReportCategories', Mock>;
  let admin: Record<'activateReport' | 'deactivateReport', Mock>;
  let fixture: ComponentFixture<ReportsListTab>;
  let query: ReturnType<typeof fakeQuery>;
  let navigate: Mock;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));

  const overdue = () =>
    aListItem({
      reportId: 5,
      name: 'Overdue tasks',
      roleCount: 3,
      lastRunAtUtc: '2026-10-20T10:00:00Z',
    });
  const perMatter = () =>
    aListItem({ reportId: 6, name: 'Tasks per matter', sortOrder: 2, roleCount: 1 });
  const finance = () =>
    aListItem({
      reportId: 7,
      name: 'Open tasks by client',
      categoryId: 2,
      categoryName: 'Finance',
      previewed: false,
      isActive: false,
      roleCount: 0,
    });

  async function create(
    permissions: Permission[],
    params: Record<string, string> = {},
    rows = [overdue(), perMatter(), finance()],
  ): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    defs = {
      listAdminReports: vi.fn().mockReturnValue(ok({ items: rows, total: rows.length })),
      listReportCategories: vi
        .fn()
        .mockReturnValue(
          ok([aCategory(), aCategory({ categoryId: 2, name: 'Finance', sortOrder: 2 })]),
        ),
    };
    admin = {
      activateReport: vi.fn().mockReturnValue(ok({})),
      deactivateReport: vi.fn().mockReturnValue(ok({})),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        AdminTabCounts,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ReportDefinitionsClient, useValue: defs },
        { provide: ReportAdminClient, useValue: admin },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    fixture = TestBed.createComponent(ReportsListTab);
    await settle(fixture);
  }

  async function show(params: Record<string, string>): Promise<void> {
    query.reset();
    query.set(params);
    fixture.componentRef.setInput('status', params['status']);
    await settle(fixture);
  }

  const rowNames = (): string[] =>
    all('[data-reports] tbody tr[data-row]').map((r) => r.getAttribute('data-row')!);

  async function menuOf(name: string): Promise<HTMLElement[]> {
    q<HTMLButtonElement>(`tr[data-row="${name}"] button[data-overflow]`).click();
    await settle(fixture);
    return all('[role=menuitem]');
  }

  describe('as a person who manages and assigns reports', () => {
    beforeEach(() => create(['Report.Manage', 'Report.Assign']));

    it('loads every report once and shows the active ones in category and report order', () => {
      expect(defs.listAdminReports).toHaveBeenCalledTimes(1);
      expect(rowNames()).toEqual(['Overdue tasks', 'Tasks per matter']);
    });

    it('shows the name as the one link, the category, the roles, the last run and the status', () => {
      const row = q('tr[data-row="Overdue tasks"]');
      expect(row.querySelectorAll('a')).toHaveLength(1);
      expect(row.querySelector('a')!.getAttribute('href')).toBe('/admin/reports/5');
      expect(row.querySelector('[data-category]')!.textContent).toBe('Task follow-up');
      expect(row.querySelector('[data-roles]')!.textContent).toBe('3');
      expect(row.querySelector('[data-last-run]')!.textContent).toContain('Oct 20, 2026');
      expect(q('tr[data-row="Tasks per matter"] [data-last-run]').textContent).toContain('Never');
      expect(row.textContent).toContain('Active');
    });

    it('shows inactive reports with a status chip in text when the status is All, and nothing deletes a report', async () => {
      await show({ status: 'all' });
      expect(rowNames()).toEqual(['Overdue tasks', 'Tasks per matter', 'Open tasks by client']);
      expect(q('tr[data-row="Open tasks by client"]').textContent).toContain('Inactive');
      const items = (await menuOf('Open tasks by client')).map((i) => i.textContent!.trim());
      expect(items.join('|')).not.toMatch(/delete|remove/i);
    });

    it('offers Edit, Roles, History and Deactivate on an active report', async () => {
      const items = (await menuOf('Overdue tasks')).map((i) =>
        i.textContent!.trim().split('\n')[0].trim(),
      );
      expect(items).toEqual(['Edit', 'Roles', 'History', 'Deactivate']);
    });

    it('opens the editor on the tab the menu names', async () => {
      const items = await menuOf('Overdue tasks');
      items.find((i) => i.textContent!.includes('Roles'))!.click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith(
        ['/admin/reports', 5],
        expect.objectContaining({ queryParams: { tab: 'roles' } }),
      );
    });

    it('deactivates only after the question and then reloads the list', async () => {
      const items = await menuOf('Overdue tasks');
      items.find((i) => i.textContent!.includes('Deactivate'))!.click();
      await settle(fixture);
      expect(admin.deactivateReport).not.toHaveBeenCalled();
      const confirm = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Deactivate' && b.closest('p-dialog, .p-dialog'),
      );
      confirm!.click();
      await settle(fixture);
      expect(admin.deactivateReport).toHaveBeenCalledWith(5);
      expect(defs.listAdminReports).toHaveBeenCalledTimes(2);
      expect(q('[data-announce]').textContent).toContain('Overdue tasks deactivated.');
    });

    it('explains why a report that was not previewed cannot be activated', async () => {
      await show({ status: 'all' });
      const activate = (await menuOf('Open tasks by client')).find((i) =>
        i.textContent!.includes('Activate'),
      )!;
      expect(
        activate.getAttribute('aria-disabled') ?? activate.hasAttribute('disabled'),
      ).toBeTruthy();
      expect(activate.textContent).toContain('Preview the current version first.');
      activate.click();
      await settle(fixture);
      expect(admin.activateReport).not.toHaveBeenCalled();
    });

    it('filters by name and by category', async () => {
      await show({ status: 'all', name: 'per matter' });
      expect(rowNames()).toEqual(['Tasks per matter']);
      await show({ status: 'all', category: '2' });
      expect(rowNames()).toEqual(['Open tasks by client']);
    });
  });

  describe('permission variants', () => {
    it('activates a report whose current version was previewed', async () => {
      await create(['Report.Manage'], {}, [{ ...finance(), previewed: true }]);
      await show({ status: 'all' });
      (await menuOf('Open tasks by client'))
        .find((i) => i.textContent!.includes('Activate'))!
        .click();
      await settle(fixture);
      expect(admin.activateReport).toHaveBeenCalledWith(7);
    });

    it('says there are no reports yet, with the way to add one', async () => {
      await create(['Report.Manage'], {}, []);
      expect(el().textContent).toContain(
        'No reports yet. Use New report above to add the first one.',
      );
    });

    it('hides Roles without Report.Assign', async () => {
      await create(['Report.Manage']);
      const items = (await menuOf('Overdue tasks')).map((i) =>
        i.textContent!.trim().split('\n')[0].trim(),
      );
      expect(items).toEqual(['Edit', 'History', 'Deactivate']);
    });

    it('shows a retry when the list cannot be loaded', async () => {
      await create(['Report.Manage']);
      defs.listAdminReports.mockReturnValue(apiError(500, { code: 'INTERNAL_ERROR', title: 'x' }));
      await fixture.componentInstance.load();
      await settle(fixture);
      expect(el().textContent).toMatch(/try again|retry/i);
    });
  });
});
