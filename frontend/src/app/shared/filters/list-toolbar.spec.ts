import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { SortedLine } from '../ui/sorted-line';
import { FilterDef } from './filter-def';
import { DEMO_DEFS, FiltersTestHost, Mounted, cleanup, mountFilters } from './filters-testing';
import { ListToolbar } from './list-toolbar';

const DEFS: FilterDef[] = DEMO_DEFS.map((d) => (d.key === 'name' ? { ...d, search: true } : d));

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ListToolbar, SortedLine],
  template: `
    <mf-list-toolbar
      [filters]="filters"
      controls="row"
      searchLabel="Search things"
      [bulkActive]="bulk()"
    >
      <span mfView class="view">View</span>
      <button mfColumns type="button" class="cols">Columns</button>
      <button mfMore type="button" class="more">More</button>
      <mf-sorted-line mfBarEnd [sort]="sort()" defaultSort="name" [labels]="labels" />
      <div mfBulk class="bulk">3 selected</div>
    </mf-list-toolbar>
  `,
})
class Host extends FiltersTestHost {
  bulk = signal(false);
  sort = signal<string | null>(null);
  labels = { name: 'Name', due: 'Due' };
}

describe('list toolbar', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const mount = async (url = '/list') => {
    m = await mountFilters(Host, { url, defs: DEFS });
  };
  const row2 = () => m.el.querySelector('[data-list-toolbar]')!;
  const search = () => m.el.querySelector<HTMLInputElement>('[data-list-search] input')!;
  const search_input = search;
  const clear = () => m.el.querySelector<HTMLButtonElement>('[data-clear-filters]');

  it('puts Search first, Filters right after it, then the view, and Columns and the menu together at the right end', async () => {
    await mount();
    const zones = Array.from(row2().children);
    const at = (test: (c: Element) => boolean) => zones.findIndex(test);
    const search = at((c) => c.hasAttribute('data-list-search'));
    const filters = at(
      (c) => !!c.querySelector('[data-filters-toggle]') || c.matches('.lt__filters'),
    );
    const view = at((c) => c.classList.contains('view'));
    const tail = at((c) => c.classList.contains('lt__tail'));
    // Search first, Filters right after it, then (Other filters and) the view, and the tail last.
    expect([search, filters]).toEqual([0, 1]);
    expect(view).toBeGreaterThan(filters);
    expect(tail).toBeGreaterThan(view);
    const inTail = Array.from(zones[tail].querySelectorAll('.cols, .more')).map((c) => c.className);
    expect(inTail).toEqual(['cols', 'more']);
    expect(search_input().placeholder).toBe('Search things');
    expect(search_input().getAttribute('type')).toBe('search');
  });

  it('shows the text of the search filter in Search, not in a chip, and not in the Filters badge', async () => {
    await mount('/list?name=smith');
    expect(search().value).toBe('smith');
    expect(m.el.querySelector('[data-chip-id]')).toBeNull();
    expect(m.el.querySelector('[data-filter-count]')).toBeNull();
    // Clear filters is still offered: the text is an active filter.
    expect(clear()).not.toBeNull();
    clear()!.click();
    await m.settle();
    expect(m.filters.text('name')).toBe('');
    expect(search().value).toBe('');
  });

  it('writes what is typed into Search to the filter after the pause', async () => {
    await mount();
    search().value = 'jones';
    search().dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 450));
    await m.settle();
    expect(m.filters.text('name')).toBe('jones');
  });

  it('counts the active filters on the Filters button and shows chips with Clear filters while the row is closed or open', async () => {
    await mount('/list?priority=1&priority=2&type=4');
    expect(m.el.querySelector('[data-filter-count]')?.textContent).toBe('(2)');
    expect(m.filters.rowVisible()).toBe(true);
    expect(m.el.querySelectorAll('[data-chip-id]').length).toBeGreaterThan(0);
    expect(clear()).not.toBeNull();
    m.el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await m.settle();
    expect(m.filters.rowVisible()).toBe(false);
    expect(m.el.querySelectorAll('[data-chip-id]').length).toBeGreaterThan(0);
    expect(clear()).not.toBeNull();
  });

  it('keeps row 3 with the Sorted by line and offers Reset sort only for a sort the person chose', async () => {
    await mount();
    expect(m.el.querySelector('[data-sorted-text]')?.textContent).toBe('Sorted by Name, A to Z');
    expect(m.el.querySelector('[data-reset-sort]')).toBeNull();
    m.host.sort.set('-due');
    await m.settle();
    expect(m.el.querySelector('[data-sorted-text]')?.textContent).toBe(
      'Sorted by Due, latest first',
    );
    expect(m.el.querySelector('[data-reset-sort]')).not.toBeNull();
  });

  it('replaces row 2 with the bulk bar while rows are selected', async () => {
    await mount();
    expect(m.el.querySelector('.bulk')).toBeNull();
    m.host.bulk.set(true);
    await m.settle();
    expect(m.el.querySelector('.bulk')?.textContent).toContain('3 selected');
    expect(search()).toBeNull();
  });

  it('leaves out the search zone when no filter is marked as the search, without moving the rest', async () => {
    m = await mountFilters(Host, { url: '/list' });
    expect(m.el.querySelector('[data-list-search]')).toBeNull();
    expect(m.el.querySelector('[data-filters-toggle]')).not.toBeNull();
  });
});

describe('list toolbar on a phone', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('keeps Search and Filters; Columns is hidden by the layout and the Filters button opens the sheet', async () => {
    const m = await mountFilters(Host, { url: '/list', defs: DEFS, narrow: true });
    expect(m.el.querySelector('[data-list-search]')).not.toBeNull();
    const toggle = m.el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!;
    expect(toggle.getAttribute('aria-haspopup')).toBe('dialog');
    expect(m.filters.sheetMode()).toBe(true);
  });
});
