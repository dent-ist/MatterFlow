import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ColumnFilterRow } from './column-filter-row';
import { FilterDef } from './filter-def';
import { FiltersTestHost, Mounted, cleanup, mountFilters } from './filters-testing';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ColumnFilterRow],
  template: `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Priority</th>
          <th>Due</th>
          <th>Status</th>
        </tr>
        <tr mfColumnFilterRow id="row" [filters]="filters" [columns]="columns"></tr>
      </thead>
    </table>
  `,
})
class Host extends FiltersTestHost {}

describe('column filter row', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const row = () => m.el.querySelector<HTMLTableRowElement>('tr.mf-filter-row')!;

  it('is the second head row, labelled "Column filters", with one cell per column', async () => {
    m = await mountFilters(Host);
    expect(row().parentElement?.tagName).toBe('THEAD');
    expect(row().previousElementSibling?.querySelector('th')).not.toBeNull();
    expect(row().getAttribute('aria-label')).toBe('Column filters');
    expect(row().hasAttribute('data-filter-row')).toBe(true);
    expect(row().querySelectorAll('td')).toHaveLength(5);
    expect(
      Array.from(row().querySelectorAll('td')).map((td) =>
        td.querySelector('[aria-label^="Filter by"]')?.getAttribute('aria-label'),
      ),
    ).toEqual([
      'Filter by Name',
      'Filter by Type',
      'Filter by Priority, All',
      'Filter by Due, Any date',
      'Filter by Status',
    ]);
  });

  it('leaves a cell empty for a column without a filter and does not render filters of other columns', async () => {
    const defs: FilterDef[] = [
      { key: 'name', label: 'Name', column: 'name', type: 'text' },
      { key: 'created', label: 'Created', column: 'created', type: 'dateRange' },
    ];
    m = await mountFilters(Host, { defs });
    const cells = Array.from(row().querySelectorAll('td'));
    expect(cells).toHaveLength(5);
    expect(cells[0].querySelector('input')).not.toBeNull();
    expect(cells.slice(1).every((c) => c.children.length === 0)).toBe(true);
  });

  it('lets one filter span the columns it searches ("Filter by Title or Ref")', async () => {
    const defs: FilterDef[] = [
      { key: 'q', label: 'Title or Ref', column: 'name', type: 'text', span: 2 },
      { key: 'status', label: 'Status', column: 'priority', type: 'select', options: [] },
    ];
    m = await mountFilters(Host, { defs });
    const cells = Array.from(row().querySelectorAll('td'));
    expect(cells[0].getAttribute('colspan')).toBe('2');
    expect(cells[0].querySelector('input')?.getAttribute('aria-label')).toBe(
      'Filter by Title or Ref',
    );
    // name + type are one cell now: 5 columns - 1 = 4 cells.
    expect(cells).toHaveLength(4);
    expect(cells[1].querySelector('select')).not.toBeNull();
  });

  it('stacks several filters of one column', async () => {
    const defs: FilterDef[] = [
      { key: 'event', label: 'Event type', column: 'name', type: 'select', options: [] },
      { key: 'summary', label: 'Summary', column: 'name', type: 'text' },
    ];
    m = await mountFilters(Host, { defs });
    expect(row().querySelector('td')!.querySelectorAll('mf-filter-control')).toHaveLength(2);
  });

  it('leaves out link-only filters and shows the current values', async () => {
    m = await mountFilters(Host, {
      url: '/list?name=zz&status=inactive',
      defs: [
        { key: 'name', label: 'Name', column: 'name', type: 'text' },
        { key: 'matterId', label: 'Matter', column: 'name', type: 'text', noControl: true },
        {
          key: 'status',
          label: 'Status',
          column: 'status',
          type: 'select',
          default: 'active',
          options: [
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ],
        },
      ],
    });
    expect(m.el.querySelectorAll('[aria-label="Filter by Matter"]')).toHaveLength(0);
    expect(m.el.querySelector<HTMLInputElement>('[aria-label="Filter by Name"]')!.value).toBe('zz');
    expect(m.el.querySelector<HTMLSelectElement>('[aria-label="Filter by Status"]')!.value).toBe(
      'inactive',
    );
  });
});
