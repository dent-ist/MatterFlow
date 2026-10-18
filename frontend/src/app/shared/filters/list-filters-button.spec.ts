import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FiltersBar } from './filters-bar';
import { DEMO_DEFS, FiltersTestHost, Mounted, cleanup, mountFilters } from './filters-testing';
import { ListFiltersButton } from './list-filters-button';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FiltersBar, ListFiltersButton],
  template: `
    <header>
      <mf-list-filters-button [filters]="filters" controls="row" [clearAlso]="['q']" />
    </header>
    <mf-filters-bar [bare]="true" [filters]="filters" [clearAlso]="['q']" />
  `,
})
class Host extends FiltersTestHost {}

describe('record list filters chrome (WP8 #270)', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const mount = async (url = '/list', options = {}) => {
    m = await mountFilters(Host, {
      url,
      defs: DEMO_DEFS.filter((d) => d.column),
      options: { openByDefault: true, ...options },
    });
  };
  const toggle = () => m.el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!;
  const clears = () => Array.from(m.el.querySelectorAll('[data-clear-filters]'));

  it('has no toolbar row when the row is open and nothing needs the bar; the button is in the header', async () => {
    await mount();
    expect(m.filters.open()).toBe(true);
    expect(m.el.querySelector('[data-grid-toolbar]')).toBeNull();
    expect(m.el.querySelector('header [data-filters-toggle]')).not.toBeNull();
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(clears()).toHaveLength(0);
  });

  it('counts only what the person changed: the default Status is neither counted nor chipped', async () => {
    await mount('/list');
    expect(m.el.querySelector('[data-filter-count]')).toBeNull();
    await m.go('/list?name=acme&status=inactive');
    expect(m.el.querySelector('[data-filter-count]')?.textContent).toBe('(2)');
  });

  it('shows one Clear filters in the header while open (no chips) and one with the chips while closed', async () => {
    await mount('/list?name=acme&status=inactive');
    expect(clears()).toHaveLength(1);
    expect(clears()[0].closest('header')).not.toBeNull();
    expect(m.el.querySelector('[data-chip]')).toBeNull();

    toggle().click();
    await m.settle();
    expect(m.filters.open()).toBe(false);
    expect(clears()).toHaveLength(1);
    expect(clears()[0].closest('header')).toBeNull();
    expect(m.el.querySelectorAll('[data-chip]')).toHaveLength(2);
  });

  it('shows none while the grid itself offers Clear filters (the filtered-empty state)', async () => {
    await mount('/list?name=zzz');
    expect(clears()).toHaveLength(1);
    m.filters.emptyClear.set(true);
    await m.settle();
    expect(clears()).toHaveLength(0);
    toggle().click();
    await m.settle();
    expect(clears()).toHaveLength(0);
  });

  it('Clear filters returns to the default (Active), not to All', async () => {
    await mount('/list?name=acme&status=all');
    clears()[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await m.settle();
    expect(m.router.url).toBe('/list');
    expect(m.filters.text('status')).toBe('active');
  });

  it('starts closed when the person closed it before (remembered per list)', async () => {
    await mount('/list');
    toggle().click();
    await m.settle();
    expect(localStorage.getItem('mf.demo.filters.open.5')).toBe('0');
    expect(m.el.querySelector('[data-chip]')).toBeNull();
  });
});
