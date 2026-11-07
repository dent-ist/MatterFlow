import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ReportsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { ddChoose } from '../../testing/dropdown-testing.spec-util';
import {
  FakeMeApi,
  apiError,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { ReportsListPage } from './reports-list-page';
import { aCategory, aListItem } from './reports-testing';

type Mock = ReturnType<typeof vi.fn>;

describe('ReportsListPage (#718)', () => {
  let api: Record<'listMyReports', Mock>;
  let fixture: ComponentFixture<ReportsListPage>;
  let query: ReturnType<typeof fakeQuery>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));

  const twoCategories = () => ({
    totalReports: 3,
    categories: [
      aCategory({
        categoryId: 1,
        name: 'Task follow-up',
        reports: [
          aListItem({
            reportId: 5,
            name: 'Overdue tasks',
            description: 'Tasks past their due date',
            parameterCount: 2,
            hasParameters: true,
            parameterLabels: ['Pod', 'As of'],
            lastRunAtUtc: '2026-10-20T10:00:00Z',
          }),
          aListItem({
            reportId: 6,
            name: 'Tasks per matter',
            description: undefined,
            sortOrder: 2,
          }),
        ],
      }),
      aCategory({
        categoryId: 2,
        name: 'Finance',
        sortOrder: 2,
        reports: [
          aListItem({ reportId: 7, name: 'Billing by client', description: 'Hours billed' }),
        ],
      }),
    ],
  });

  async function create(
    permissions: Permission[] = ['Report.Run'],
    response: unknown = twoCategories(),
    params: Record<string, string> = {},
  ): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    api = {
      listMyReports: vi
        .fn()
        .mockReturnValue(response instanceof Error ? apiError(500, {}) : ok(response)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ReportsClient, useValue: api },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    fixture = TestBed.createComponent(ReportsListPage);
    await settle(fixture);
  }

  const names = (): string[] => all('td[data-report]').map((c) => c.getAttribute('data-report')!);
  const groups = (): string[] =>
    all('tr.rg-group').map((g) => g.textContent!.replace(/\s+/g, ' ').trim());

  describe('with reports assigned', () => {
    beforeEach(() => create());

    it('loads the list once and groups the reports by category in the server order, with a count on each band', () => {
      expect(api.listMyReports).toHaveBeenCalledTimes(1);
      expect(groups()).toEqual(['Task follow-up (2)', 'Finance (1)']);
      expect(names()).toEqual(['Overdue tasks', 'Tasks per matter', 'Billing by client']);
    });

    it('shows the heading, the number of reports in the count chip, and the four columns of the spec without a star, a Run button or a menu', () => {
      expect(q('h1').textContent).toContain('Reports');
      expect(q('[data-list-count]').textContent).toContain('3');
      expect(all('th[data-col]').map((h) => h.textContent!.trim())).toEqual([
        'Report',
        'Parameters',
        'Last Run',
      ]);
      expect(el().querySelector('[data-overflow]')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('button')).some((b) =>
          /run report|favourite/i.test(b.textContent ?? b.getAttribute('aria-label') ?? ''),
        ),
      ).toBe(false);
    });

    it('makes the name the one link to the run page, with the description as a muted line under it', () => {
      const row = q('td[data-report="Overdue tasks"]').closest('tr')!;
      const links = row.querySelectorAll('a');
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe('/reports/5');
      expect(links[0].classList).toContain('mf-btn--name');
      expect(row.querySelector('[data-description]')!.textContent!.trim()).toBe(
        'Tasks past their due date',
      );
      expect(
        q('td[data-report="Tasks per matter"]').closest('tr')!.querySelector('[data-description]'),
      ).toBeNull();
    });

    it('words Parameters and Last Run: No parameters, n parameters, a date with the time, or Never', () => {
      const cell = (name: string, sel: string): string =>
        q(`td[data-report="${name}"]`).closest('tr')!.querySelector(sel)!.textContent!.trim();
      expect(cell('Overdue tasks', '[data-parameters]')).toBe('2 parameters');
      expect(cell('Tasks per matter', '[data-parameters]')).toBe('No parameters');
      expect(cell('Overdue tasks', '[data-last-run]')).toContain('10/20 ');
      expect(cell('Tasks per matter', '[data-last-run]')).toBe('Never');
    });

    it('searches name, description and category on the loaded list, without another call', async () => {
      query.set({ q: 'hours' });
      await settle(fixture);
      expect(names()).toEqual(['Billing by client']);
      expect(groups()).toEqual(['Finance (1)']);
      expect(api.listMyReports).toHaveBeenCalledTimes(1);
    });

    it('says what was searched when nothing matches, with Clear Search', async () => {
      query.set({ q: 'zzz' });
      await settle(fixture);
      expect(q('[data-search-empty]').textContent).toContain('No results for "zzz".');
      const clear = Array.from(el().querySelectorAll('button')).find(
        (b) => b.textContent!.trim() === 'Clear Search',
      );
      expect(clear).toBeTruthy();
    });

    it('filters by category with the toolbar dropdown, combines with search, and says No reports match these filters. with Clear Filters', async () => {
      ddChoose(el(), 'Category', '2');
      await settle(fixture);
      // The choice goes into the address (the filter state is the address); the page follows the address.
      const navigate = TestBed.inject(Router).navigate as unknown as Mock;
      expect(JSON.stringify(navigate.mock.calls.at(-1))).toContain('"category":["2"]');
      query.set({ category: '2' });
      await settle(fixture);
      expect(names()).toEqual(['Billing by client']);
      query.set({ q: 'overdue' });
      await settle(fixture);
      expect(names()).toEqual([]);
      expect(q('[data-filter-empty]').textContent).toContain('No reports match these filters.');
      expect(
        Array.from(el().querySelectorAll('button')).some(
          (b) => b.textContent!.trim() === 'Clear Filters',
        ),
      ).toBe(true);
    });

    it('remembers a closed category per person and opens it again from storage', async () => {
      q('tr.rg-group[data-group="2"] button').click();
      await settle(fixture);
      expect(names()).toEqual(['Overdue tasks', 'Tasks per matter']);
      expect(localStorage.getItem('mf.reports.collapsed.1')).toContain('"2"');
      fixture.destroy();
      TestBed.resetTestingModule();
      const saved = localStorage.getItem('mf.reports.collapsed.1')!;
      await create();
      localStorage.setItem('mf.reports.collapsed.1', saved);
    });

    it('has no Report Setup link for a person without Report.Manage', () => {
      expect(el().querySelector('[data-report-setup-link]')).toBeNull();
    });
  });

  it('shows the way to Report Setup to a person who also holds Report.Manage', async () => {
    await create(['Report.Run', 'Report.Manage']);
    expect(q('[data-report-setup-link]').getAttribute('href')).toBe('/admin/reports');
    expect(q('[data-report-setup-link]').textContent).toContain('Report Setup');
  });

  it('explains an empty list and offers nothing to click: no reports are assigned, ask an administrator', async () => {
    await create(['Report.Run'], { categories: [], totalReports: 0 });
    const block = q('[data-none-assigned]');
    expect(block.textContent).toContain('No reports are assigned to you.');
    expect(block.textContent).toContain('Ask an administrator to assign reports to your role.');
    expect(block.querySelectorAll('button, a')).toHaveLength(0);
    expect(el().querySelector('table')).toBeNull();
    expect(q('[data-list-count]').textContent).toContain('0');
  });

  it("shows Couldn't load reports. with Retry when the call fails, and loads again on Retry", async () => {
    await create(['Report.Run'], new Error('x'));
    expect(q('[data-error]').textContent).toContain("Couldn't load reports.");
    expect(q('[data-list-count]').textContent).toContain('-');
    api.listMyReports.mockReturnValue(ok(twoCategories()));
    Array.from(el().querySelectorAll('button'))
      .find((b) => b.textContent!.trim() === 'Retry')!
      .click();
    await settle(fixture);
    expect(names()).toHaveLength(3);
    expect(api.listMyReports).toHaveBeenCalledTimes(2);
  });
});
