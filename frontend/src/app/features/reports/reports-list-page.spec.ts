import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ReportFavouritesClient, ReportsClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { NotificationService } from '../../core/notify/notification.service';
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

describe('ReportsListPage (#718, #723)', () => {
  let api: Record<'listMyReports', Mock>;
  let fav: Record<'addReportFavourite' | 'removeReportFavourite' | 'listRecentReports', Mock>;
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
    recent: unknown = { reports: [] },
  ): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    api = {
      listMyReports: vi
        .fn()
        .mockReturnValue(response instanceof Error ? apiError(500, {}) : ok(response)),
    };
    fav = {
      addReportFavourite: vi.fn().mockReturnValue(ok(undefined)),
      removeReportFavourite: vi.fn().mockReturnValue(ok(undefined)),
      listRecentReports: vi
        .fn()
        .mockReturnValue(recent instanceof Error ? apiError(500, {}) : ok(recent)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ReportsClient, useValue: api },
        { provide: ReportFavouritesClient, useValue: fav },
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

    it('shows the heading, the number of reports in the count chip, and the columns of the spec (the star heading is only read) without a Run button or a menu', () => {
      expect(q('h1').textContent).toContain('Reports');
      expect(q('[data-list-count]').textContent).toContain('3');
      expect(all('th[data-col]').map((h) => h.textContent!.trim())).toEqual([
        'Favourite',
        'Report',
        'Parameters',
        'Last Run',
      ]);
      expect(q('th[data-col="star"] .pg-sr').textContent).toContain('Favourite');
      expect(el().querySelector('[data-overflow]')).toBeNull();
      expect(
        Array.from(el().querySelectorAll('button')).some((b) =>
          /run report/i.test(b.textContent ?? b.getAttribute('aria-label') ?? ''),
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
  describe('favourites (#723)', () => {
    const withFavourite = () => {
      const list = twoCategories();
      list.categories[0].reports[1] = aListItem({
        reportId: 6,
        name: 'Tasks per matter',
        description: undefined,
        sortOrder: 2,
        isFavourite: true,
      });
      return list;
    };
    const star = (name: string): HTMLButtonElement =>
      q(`td[data-report="${name}"]`)
        .closest('tr')!
        .querySelector<HTMLButtonElement>('[data-favourite]')!;

    it('draws a text-less star button in the first column of every row, named by the action and the report, with the state in the icon and the tooltip', async () => {
      await create(['Report.Run'], withFavourite());
      expect(all('[data-favourite]')).toHaveLength(3);
      expect(star('Overdue tasks').getAttribute('aria-label')).toBe(
        'Add Overdue tasks to favourites',
      );
      expect(star('Overdue tasks').textContent!.trim()).toBe('');
      expect(star('Overdue tasks').querySelector('.pi-star')).not.toBeNull();
      expect(star('Tasks per matter').getAttribute('aria-label')).toBe(
        'Remove Tasks per matter from favourites',
      );
      expect(star('Tasks per matter').querySelector('.pi-star-fill')).not.toBeNull();
      expect(star('Tasks per matter').hasAttribute('data-on')).toBe(true);
      const row = q('td[data-report="Overdue tasks"]').closest('tr')!;
      expect(row.firstElementChild!.classList).toContain('rl-star');
    });

    it('adds a favourite at once, calls PUT, announces it politely and says nothing in a toast', async () => {
      await create();
      const error = vi.spyOn(TestBed.inject(NotificationService), 'error');
      star('Overdue tasks').click();
      await settle(fixture);
      expect(fav.addReportFavourite).toHaveBeenCalledWith(5);
      expect(star('Overdue tasks').getAttribute('aria-label')).toBe(
        'Remove Overdue tasks from favourites',
      );
      expect(q('[data-favourite-live]').textContent).toContain(
        'Overdue tasks added to favourites.',
      );
      expect(error).not.toHaveBeenCalled();
      // The grid does not reorder.
      expect(names()).toEqual(['Overdue tasks', 'Tasks per matter', 'Billing by client']);
    });

    it('removes a favourite with DELETE', async () => {
      await create(['Report.Run'], withFavourite());
      star('Tasks per matter').click();
      await settle(fixture);
      expect(fav.removeReportFavourite).toHaveBeenCalledWith(6);
      expect(star('Tasks per matter').getAttribute('aria-label')).toBe(
        'Add Tasks per matter to favourites',
      );
      expect(q('[data-favourite-live]').textContent).toContain(
        'Tasks per matter removed from favourites.',
      );
    });

    it("puts the star back and shows the toast Couldn't update favourites. when the call fails", async () => {
      await create();
      const error = vi.spyOn(TestBed.inject(NotificationService), 'error');
      fav.addReportFavourite.mockReturnValue(apiError(500, {}));
      star('Overdue tasks').click();
      await settle(fixture);
      expect(star('Overdue tasks').getAttribute('aria-label')).toBe(
        'Add Overdue tasks to favourites',
      );
      expect(error).toHaveBeenCalledWith("Couldn't update favourites.");
    });

    it('filters to the favourites with the toolbar chip (aria-pressed), drops the empty bands and does not duplicate a row', async () => {
      await create(['Report.Run'], withFavourite());
      const chip = (): HTMLButtonElement =>
        q('[data-favourites-filter] button[data-key="favourites"]');
      expect(chip().getAttribute('aria-pressed')).toBe('false');
      expect(chip().textContent).toContain('Favourites');
      chip().click();
      await settle(fixture);
      const navigate = TestBed.inject(Router).navigate as unknown as Mock;
      expect(JSON.stringify(navigate.mock.calls.at(-1))).toContain('"favourites":"true"');
      query.set({ favourites: 'true' });
      await settle(fixture);
      expect(chip().getAttribute('aria-pressed')).toBe('true');
      expect(names()).toEqual(['Tasks per matter']);
      expect(groups()).toEqual(['Task follow-up (1)']);
    });

    it('says No reports match these filters. with Clear Filters when the person has no favourite and the chip is on', async () => {
      await create(['Report.Run'], twoCategories(), { favourites: 'true' });
      expect(q('[data-filter-empty]').textContent).toContain('No reports match these filters.');
      expect(el().querySelector('[data-search-empty]')).toBeNull();
    });

    it('counts the chip as an active filter: Clear Filters shows and the search-only empty state does not take over', async () => {
      await create(['Report.Run'], withFavourite(), { favourites: 'true', q: 'zzz' });
      expect(el().querySelector('[data-search-empty]')).toBeNull();
      expect(q('[data-filter-empty]')).not.toBeNull();
      expect(el().querySelector('[data-clear-filters]')).not.toBeNull();
    });
  });

  describe('recent reports (#723)', () => {
    const recent = (n = 3) => ({
      reports: [
        {
          reportId: 7,
          name: 'Billing by client',
          categoryName: 'Finance',
          lastRunAtUtc: '2026-11-07T10:00:00Z',
        },
        {
          reportId: 5,
          name: 'Overdue tasks',
          categoryName: 'Task follow-up',
          lastRunAtUtc: '2026-11-06T10:00:00Z',
        },
        {
          reportId: 6,
          name: 'Tasks per matter',
          categoryName: 'Task follow-up',
          lastRunAtUtc: '2026-11-05T10:00:00Z',
        },
      ].slice(0, n),
    });
    const chips = (): string[] => all('[data-recent]').map((c) => c.textContent!.trim());

    it('asks for five, then shows the chips newest first as links to the run page above the grid', async () => {
      await create(['Report.Run'], twoCategories(), {}, recent());
      expect(fav.listRecentReports).toHaveBeenCalledWith(5);
      expect(q('[data-recent-line]').textContent).toContain('Recent');
      expect(chips()).toEqual(['Billing by client', 'Overdue tasks', 'Tasks per matter']);
      expect(all('[data-recent]').map((c) => c.getAttribute('href'))).toEqual([
        '/reports/7',
        '/reports/5',
        '/reports/6',
      ]);
      const line = q('mf-report-recent-line');
      const grid = q('mf-record-grid');
      expect(line.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('is not rendered at all when the person has run nothing', async () => {
      await create(['Report.Run'], twoCategories(), {}, { reports: [] });
      expect(el().querySelector('mf-report-recent-line')).toBeNull();
    });

    it('is left out while a search or a filter is active, and while nothing is assigned', async () => {
      await create(['Report.Run'], twoCategories(), {}, recent());
      expect(chips()).toHaveLength(3);
      query.set({ q: 'overdue' });
      await settle(fixture);
      expect(el().querySelector('mf-report-recent-line')).toBeNull();
      query.set({ q: '', favourites: 'true' });
      await settle(fixture);
      expect(el().querySelector('mf-report-recent-line')).toBeNull();
      query.set({ favourites: '' });
      await settle(fixture);
      expect(chips()).toHaveLength(3);
      fixture.destroy();
      TestBed.resetTestingModule();
      await create(['Report.Run'], { categories: [], totalReports: 0 }, {}, recent());
      expect(el().querySelector('mf-report-recent-line')).toBeNull();
    });

    it('never shows more than five chips and skips a report the list does not hold', async () => {
      const many = {
        reports: [1, 2, 3, 4, 5, 6, 7].map((id) => ({
          reportId: id === 4 ? 99 : id,
          name: `R${id}`,
          categoryName: 'C',
          lastRunAtUtc: '2026-11-07T10:00:00Z',
        })),
      };
      const list = {
        totalReports: 6,
        categories: [
          aCategory({
            reports: [1, 2, 3, 5, 6, 7].map((id) => aListItem({ reportId: id, name: `R${id}` })),
          }),
        ],
      };
      await create(['Report.Run'], list, {}, many);
      expect(chips()).toEqual(['R1', 'R2', 'R3', 'R5', 'R6']);
    });

    it('leaves the line out and says nothing when the recent call fails', async () => {
      await create(['Report.Run'], twoCategories(), {}, new Error('x'));
      expect(el().querySelector('mf-report-recent-line')).toBeNull();
      expect(names()).toHaveLength(3);
    });

    it('puts the category and the last run into the tooltip text of a chip', async () => {
      await create(['Report.Run'], twoCategories(), {}, recent(1));
      const chip = q('[data-recent="7"]');
      chip.dispatchEvent(new Event('mouseenter'));
      const tip = document.querySelector('[role="tooltip"]');
      expect(tip?.textContent).toContain('Finance');
      expect(tip?.textContent).toContain('Last run 11/07 ');
      chip.dispatchEvent(new Event('mouseleave'));
    });
  });
});
