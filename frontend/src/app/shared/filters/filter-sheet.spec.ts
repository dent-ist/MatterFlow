import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ColumnFilterRow } from './column-filter-row';
import { FiltersBar } from './filters-bar';
import { FiltersTestHost, Mounted, cleanup, mountFilters } from './filters-testing';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FiltersBar, ColumnFilterRow],
  template: `
    <button id="outside">outside</button>
    <mf-filters-bar [filters]="filters" controls="row" />
    <table>
      <thead>
        <tr>
          <th>Name</th>
        </tr>
        @if (filters.rowVisible()) {
          <tr mfColumnFilterRow [filters]="filters" [columns]="columns"></tr>
        }
      </thead>
    </table>
  `,
})
class Host extends FiltersTestHost {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FiltersBar],
  template: `
    <mf-filters-bar [filters]="filters" controls="row">
      <p mfSheetSort id="sort-slot">Sort by</p>
    </mf-filters-bar>
  `,
})
class SortHost extends FiltersTestHost {}

describe('filter sheet', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const toggle = () => m.el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!;
  const sheet = () => m.el.querySelector<HTMLElement>('[data-filter-sheet]');

  async function mount(narrow = true, url = '/list') {
    m = await mountFilters(Host, { narrow, url });
  }

  it('replaces the filter row below 768 px: the Filters button opens a modal dialog named "Filters"', async () => {
    await mount();
    expect(m.filters.sheetMode()).toBe(true);
    toggle().click();
    await m.settle();
    expect(m.el.querySelector('tr.mf-filter-row')).toBeNull();
    expect(sheet()!.getAttribute('role')).toBe('dialog');
    expect(sheet()!.getAttribute('aria-modal')).toBe('true');
    expect(sheet()!.querySelector('h2')?.textContent).toContain('Filters');
    expect(sheet()!.getAttribute('aria-labelledby')).toBe(sheet()!.querySelector('h2')!.id);
    expect(toggle().getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('shows a projected [mfSheetSort] control (the phone sort select) above the filters, only while the sheet is open', async () => {
    m = await mountFilters(SortHost, { narrow: true });
    expect(m.el.querySelector('#sort-slot')).toBeNull();
    toggle().click();
    await m.settle();
    const slot = sheet()!.querySelector('.fs-body > #sort-slot');
    expect(slot).not.toBeNull();
    expect(sheet()!.querySelector('.fs-body')!.firstElementChild).toBe(slot);
  });

  it('keeps the row on a wide window', async () => {
    await mount(false);
    toggle().click();
    await m.settle();
    expect(sheet()).toBeNull();
    expect(m.el.querySelector('tr.mf-filter-row')).not.toBeNull();
  });

  it('renders every filter stacked and expanded (no popovers), including ones without a cell', async () => {
    await mount();
    toggle().click();
    await m.settle();
    const names = Array.from(sheet()!.querySelectorAll('.fs-field')).map((f) =>
      f.getAttribute('aria-label'),
    );
    expect(names).toEqual(['Name', 'Type', 'Priority', 'Due', 'Status', 'Sensitive']);
    expect(sheet()!.querySelector('mf-filter-popover')).toBeNull();
    expect(sheet()!.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(sheet()!.querySelectorAll('[data-preset]').length).toBeGreaterThan(0);
  });

  it('applies changes live to the URL and reads "Show N results" from the list', async () => {
    await mount();
    m.filters.reportResults(42);
    toggle().click();
    await m.settle();
    expect(sheet()!.querySelector('[data-sheet-show]')?.textContent).toContain('Show 42 results');
    const select = sheet()!.querySelector<HTMLSelectElement>(
      'select[aria-label="Filter by Type"]',
    )!;
    select.value = '5';
    select.dispatchEvent(new Event('change'));
    await m.settle();
    expect(m.router.url).toContain('type=5');
    expect(sheet()!.querySelector('[data-sheet-clear]')).not.toBeNull();
    sheet()!.querySelector<HTMLButtonElement>('[data-sheet-clear]')!.click();
    await m.settle();
    expect(m.router.url).toBe('/list');
  });

  it('moves focus in, keeps it inside, and gives it back to the Filters button on Close', async () => {
    await mount();
    toggle().focus();
    toggle().click();
    await m.settle();
    expect(sheet()!.contains(document.activeElement)).toBe(true);

    const items = Array.from(
      sheet()!.querySelectorAll<HTMLElement>('button, input, select'),
    ).filter((n) => !(n as HTMLInputElement).disabled);
    items.at(-1)!.focus();
    sheet()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(sheet()!.contains(document.activeElement)).toBe(true);

    sheet()!.querySelector<HTMLButtonElement>('[aria-label="Close filters"]')!.click();
    await m.settle();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(toggle());
  });

  it('closes on Esc, but a filled text box takes the first Esc for itself', async () => {
    await mount(true, '/list?name=abc');
    toggle().click();
    await m.settle();
    const box = sheet()!.querySelector<HTMLInputElement>('input[aria-label="Filter by Name"]')!;
    box.focus();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await m.settle();
    expect(sheet()).not.toBeNull(); // cleared the box only
    await m.go('/list');
    sheet()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await m.settle();
    expect(sheet()).toBeNull();
  });
});
