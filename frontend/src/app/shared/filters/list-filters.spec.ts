import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthStore } from '../../core/auth/auth.store';
import { FilterDef } from './filter-def';
import { ListFilters } from './list-filters';

const columns = signal<readonly string[] | null>(null);
const defs: FilterDef[] = [
  { key: 'name', label: 'Name', column: 'name', type: 'text' },
  {
    key: 'status',
    label: 'Status',
    column: 'status',
    type: 'select',
    default: 'active',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'all', label: 'All' },
    ],
  },
  {
    key: 'priority',
    label: 'Priority',
    column: 'priority',
    type: 'multiSelect',
    options: [
      { value: '1', label: 'Critical' },
      { value: '2', label: 'High' },
    ],
  },
  { key: 'created', label: 'Created', type: 'dateRange' },
  { key: 'matterId', label: 'Matter', type: 'text', noControl: true },
];

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Host {
  readonly filters = new ListFilters({
    screen: 'demo',
    noun: 'things',
    defs,
    visibleColumns: columns,
  });
}

describe('ListFilters', { timeout: 20_000 }, () => {
  let harness: RouterTestingHarness;
  let host: Host;
  const profile = signal<{ userId: number } | null>({ userId: 5 });

  async function open(url: string, matches = false): Promise<ListFilters> {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    // A fresh page every time (leave the route first), so each call builds a new ListFilters.
    await harness.navigateByUrl('/other');
    host = await harness.navigateByUrl(url, Host);
    return host.filters;
  }

  const url = () => TestBed.inject(Router).url;

  beforeEach(async () => {
    localStorage.clear();
    columns.set(null);
    profile.set({ userId: 5 });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'list', component: Host },
          { path: 'other', component: Blank },
        ]),
        { provide: AuthStore, useValue: { profile } },
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  describe('URL state', () => {
    it('reads every filter from the URL and shows defaults without counting them', async () => {
      const f = await open('/list');
      expect(f.text('status')).toBe('active');
      expect(f.activeCount()).toBe(0);
      expect(f.chips()).toEqual([]);
      expect(f.isDeepLink()).toBe(false);

      const g = await open(
        '/list?name=acme&priority=1&priority=2&status=all&createdFrom=2026-10-01',
      );
      expect(g.text('name')).toBe('acme');
      expect(g.list('priority')).toEqual(['1', '2']);
      expect(g.activeCount()).toBe(4);
      expect(g.isDeepLink()).toBe(true);
    });

    it('follows the URL when it changes (Back button, links)', async () => {
      const f = await open('/list?name=a');
      expect(f.activeCount()).toBe(1);
      await harness.navigateByUrl('/list?name=b&priority=1');
      expect(f.text('name')).toBe('b');
      expect(f.activeCount()).toBe(2);
    });

    it('writes a change to the URL, keeps the rest and resets the page', async () => {
      const f = await open('/list?page=3&sort=name&name=a');
      f.set('priority', ['1', '2']);
      await harness.fixture.whenStable();
      expect(url()).toContain('priority=1&priority=2');
      expect(url()).toContain('name=a');
      expect(url()).toContain('sort=name');
      expect(url()).not.toContain('page=');
    });

    it('never writes a default and removes a filter that returns to it', async () => {
      const f = await open('/list?status=all');
      f.set('status', 'active');
      await harness.fixture.whenStable();
      expect(url()).toBe('/list');
    });

    it('rewrites the history entry while typing (replace) and pushes otherwise', async () => {
      const f = await open('/list');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      f.set('name', 'ab', { replace: true });
      f.set('priority', ['1']);
      expect(navigate.mock.calls[0][1]).toMatchObject({ replaceUrl: true });
      expect(navigate.mock.calls[1][1]?.replaceUrl).toBeUndefined();
    });

    it('sets several filters at once and applies a preset that resets the others to their defaults', async () => {
      const f = await open('/list?name=a&priority=2');
      f.setMany({ status: 'inactive' });
      await harness.fixture.whenStable();
      expect(url()).toContain('status=inactive');
      expect(url()).toContain('name=a');
      f.applyPreset({ priority: ['1'] });
      await harness.fixture.whenStable();
      expect(url()).toContain('priority=1');
      expect(url()).not.toContain('name=');
      expect(url()).not.toContain('status=');
    });

    it('clears to the defaults (not to nothing), also dropping legacy parameters, and keeps sort and size', async () => {
      const f = await open('/list?name=a&status=all&q=old&sort=name&size=50&matterId=7');
      f.clear(['q']);
      await harness.fixture.whenStable();
      expect(url()).toBe('/list?sort=name&size=50');
      expect(f.text('status')).toBe('active');
    });

    it('removes one chip at a time and keeps the other values of a multi-select', async () => {
      const f = await open('/list?priority=1&priority=2&name=a');
      const chip = f.chips().find((c) => c.id === 'priority:1')!;
      f.removeChip(chip);
      await harness.fixture.whenStable();
      expect(f.list('priority')).toEqual(['2']);
      expect(f.text('name')).toBe('a');
    });

    it('lets a cleared default stay cleared (Status "All" is a chip that removes back to Active)', async () => {
      const f = await open('/list?status=all');
      const chip = f.chips()[0];
      expect(chip.label).toBe('Status: All');
      f.removeChip(chip);
      await harness.fixture.whenStable();
      expect(url()).toBe('/list');
    });

    it('ignores unknown filters and is not confused by values for filters it does not define', async () => {
      const f = await open('/list?bogus=1&name=x');
      expect(f.activeCount()).toBe(1);
      expect(f.queryParams()['name']).toBe('x');
    });
  });

  describe('chips, hidden columns and More filters', () => {
    it('shows one chip per value with the filter name, including a filter without a column', async () => {
      const f = await open('/list?priority=1&priority=2&matterId=7&created' + 'From=2026-10-01');
      expect(f.chips().map((c) => c.label)).toEqual([
        'Priority: Critical',
        'Priority: High',
        'Created: from Oct 1, 2026',
        'Matter: 7',
      ]);
    });

    it('keeps a filter on a hidden column active and marks its chip', async () => {
      columns.set(['name', 'status']);
      const f = await open('/list?priority=1&name=a');
      expect(f.activeCount()).toBe(2);
      const hidden = f.hiddenChips();
      expect(hidden.map((c) => c.label)).toContain('Priority: Critical');
      expect(hidden.find((c) => c.defKey === 'priority')?.hiddenColumn).toBe(true);
      expect(hidden.find((c) => c.defKey === 'name')).toBeUndefined();
      expect(f.moreDefs().map((d) => d.key)).toEqual(['priority', 'created']);
    });

    it('lists a filter with no column in More filters, but not a link-only filter', async () => {
      const f = await open('/list');
      expect(f.moreDefs().map((d) => d.key)).toEqual(['created']);
    });

    it('does not count or chip a filter that a tab owns (disabled with a reason)', async () => {
      const owned = signal<string | null>('Set by the Due soon tab');
      const f = TestBed.runInInjectionContext(
        () =>
          new ListFilters({
            screen: 'owned',
            defs: [
              { key: 'name', label: 'Name', type: 'text' },
              { key: 'status', label: 'Status', type: 'select', disabledReason: () => owned() },
            ],
          }),
      );
      await open('/list?status=x');
      expect(f.isDisabled(f.defs()[1])).toBe('Set by the Due soon tab');
      expect(f.activeCount()).toBe(0);
      expect(f.chips()).toEqual([]);
      owned.set(null);
      expect(f.isDisabled(f.defs()[1])).toBeNull();
      expect(f.activeCount()).toBe(1);
    });
  });

  describe('print line', () => {
    it('lists what limits the grid, defaults included, and is empty when nothing does', async () => {
      const f = await open('/list?name=acme&priority=1&priority=2');
      expect(f.printLine()).toBe('Filters: Name acme, Status Active, Priority Critical or High');
      await harness.navigateByUrl('/list');
      const none = TestBed.runInInjectionContext(
        () => new ListFilters({ screen: 'x', defs: [defs[0]] }),
      );
      expect(none.printLine()).toBe('');
    });
  });

  describe('open state', () => {
    it('is closed at first, remembered per user and restored on the next visit', async () => {
      const f = await open('/list');
      expect(f.open()).toBe(false);
      f.toggle();
      expect(f.open()).toBe(true);
      expect(localStorage.getItem('mf.demo.filters.open.5')).toBe('1');
      const again = await open('/list?x=1');
      expect(again.open()).toBe(true);
      again.toggle();
      expect(localStorage.getItem('mf.demo.filters.open.5')).toBe('0');
    });

    it('starts open where the screen asks for it, until the user closes it', async () => {
      await open('/list');
      const f = TestBed.runInInjectionContext(
        () => new ListFilters({ screen: 'queue', defs: [defs[0]], openByDefault: true }),
      );
      TestBed.tick();
      expect(f.open()).toBe(true);
      f.toggle();
      TestBed.tick();
      expect(f.open()).toBe(false);
      expect(localStorage.getItem('mf.queue.filters.open.5')).toBe('0');
    });

    it('does not undo a toggle when the profile (and with it the per-user key) arrives later', async () => {
      localStorage.setItem('mf.demo.filters.open.5', '0');
      profile.set(null);
      const f = await open('/list');
      f.toggle();
      expect(f.open()).toBe(true);
      profile.set({ userId: 5 });
      await harness.fixture.whenStable();
      TestBed.tick();
      expect(f.open()).toBe(true);
    });

    it('takes the remembered per-user value once the profile is known', async () => {
      localStorage.setItem('mf.demo.filters.open.5', '1');
      const f = await open('/list');
      TestBed.tick();
      expect(f.open()).toBe(true);
    });

    it('opens by itself when the URL carries active filters but not for a default', async () => {
      expect((await open('/list?status=active')).open()).toBe(false);
      expect((await open('/list?name=a')).open()).toBe(true);
    });

    it('copes with blocked storage', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const f = await open('/list');
      expect(f.open()).toBe(false);
      f.toggle();
      expect(f.open()).toBe(true);
    });
  });

  describe('sheet mode', () => {
    it('uses the row on a wide window and the sheet on a narrow one', async () => {
      const wide = await open('/list');
      wide.toggle();
      expect(wide.sheetMode()).toBe(false);
      expect(wide.rowVisible()).toBe(true);
      expect(wide.sheetOpen()).toBe(false);

      const narrow = await open('/list', true);
      expect(narrow.sheetMode()).toBe(true);
      narrow.toggle();
      expect(narrow.sheetOpen()).toBe(true);
      expect(narrow.rowVisible()).toBe(false);
      expect(narrow.toggleOpen()).toBe(true);
      narrow.closeSheet();
      expect(narrow.sheetOpen()).toBe(false);
    });
  });

  describe('restored last view', () => {
    it('shows the notice until it is dismissed, reset or the filters are cleared', async () => {
      const f = await open('/list?name=a');
      f.markRestored();
      expect(f.restored()).toBe(true);
      f.dismissRestored();
      expect(f.restored()).toBe(false);
      f.markRestored();
      f.resetToDefault();
      await harness.fixture.whenStable();
      expect(f.restored()).toBe(false);
      expect(url()).toBe('/list');
    });
  });

  describe('result announcements', () => {
    it('is silent for the first load and for paging, and announces the count after a filter change', async () => {
      const f = await open('/list');
      f.reportResults(23);
      expect(f.announcement()).toBe('');
      f.reportResults(23);
      expect(f.announcement()).toBe('');

      await harness.navigateByUrl('/list?name=a');
      f.reportResults(5);
      expect(f.announcement().replace('\u200b', '')).toBe('5 things');
      await harness.navigateByUrl('/list?name=a&page=2');
      const before = f.announcement();
      f.reportResults(5);
      expect(f.announcement()).toBe(before);
    });

    it('says what happened for one result, none, and a cleared filter set', async () => {
      const f = await open('/list');
      f.reportResults(9);
      await harness.navigateByUrl('/list?name=a');
      f.reportResults(1);
      expect(f.announcement().replace('\u200b', '')).toBe('1 thing');
      await harness.navigateByUrl('/list?name=ab');
      f.reportResults(0);
      expect(f.announcement().replace('\u200b', '')).toBe('No things');
      await harness.navigateByUrl('/list');
      f.reportResults(9);
      expect(f.announcement().replace('\u200b', '')).toBe('Filters cleared. 9 things');
    });

    it('uses "results" when the screen names no noun', async () => {
      const f = TestBed.runInInjectionContext(
        () => new ListFilters({ screen: 'plain', defs: [defs[0]] }),
      );
      await open('/list');
      f.reportResults(3);
      await harness.navigateByUrl('/list?name=z');
      f.reportResults(23);
      expect(f.announcement().replace('\u200b', '')).toBe('23 results');
      expect(f.resultTotal()).toBe(23);
    });
  });
});
