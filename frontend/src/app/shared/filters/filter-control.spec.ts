import { ddSelect } from '../../testing/dropdown-testing.spec-util';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FilterControl } from './filter-control';
import { FilterDef } from './filter-def';
import { FiltersTestHost, Mounted, cleanup, mountFilters } from './filters-testing';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FilterControl],
  template: `
    @for (d of filters.defs(); track d.key) {
      <div [attr.data-def]="d.key"><mf-filter-control [def]="d" [filters]="filters" /></div>
    }
  `,
})
class Host extends FiltersTestHost {}

describe('filter control', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  let m: Mounted<Host>;
  const cell = (key: string) => m.el.querySelector(`[data-def=${key}]`)!;

  async function mount(url = '/list', defs?: FilterDef[]) {
    m = await mountFilters(Host, { url, defs });
  }

  it('renders the right control for each type, every one named "Filter by <column>"', async () => {
    await mount();
    expect(cell('name').querySelector('input[type=text]')?.getAttribute('aria-label')).toBe(
      'Filter by Name',
    );
    expect(cell('type').querySelector('mf-dropdown button')?.getAttribute('aria-label')).toMatch(
      /^Filter by Type:/,
    );
    expect(
      cell('sensitive').querySelector('mf-dropdown button')?.getAttribute('aria-label'),
    ).toMatch(/^Filter by Sensitive:/);
    // The heavy controls load lazily but are there once the page settles.
    expect(cell('priority').querySelector('button')?.getAttribute('aria-label')).toBe(
      'Filter by Priority, All',
    );
    expect(cell('due').querySelector('button')?.getAttribute('aria-label')).toBe(
      'Filter by Due, Any Date',
    );
    expect(cell('status').querySelector('mf-dropdown button')?.getAttribute('aria-label')).toMatch(
      /^Filter by Status:/,
    );
  });

  it('shows the URL values and the default in the controls', async () => {
    await mount('/list?name=acme&type=5&priority=2&dueFrom=2026-10-01&sensitive=true');
    expect(cell('name').querySelector<HTMLInputElement>('input')!.value).toBe('acme');
    expect(ddSelect(cell('type')).value).toBe('5');
    expect(ddSelect(cell('status')).value).toBe('active');
    expect(cell('priority').textContent).toContain('High');
    expect(cell('due').textContent).toContain('From 10/01');
    expect(ddSelect(cell('sensitive')).value).toBe('true');
  });

  it('writes a change to the URL: select and tri-state push, text replaces', async () => {
    await mount();
    const select = ddSelect(cell('type'));
    select.value = '4';
    select.dispatchEvent(new Event('change'));
    await m.settle();
    expect(m.router.url).toContain('type=4');

    const box = cell('name').querySelector<HTMLInputElement>('input')!;
    box.value = 'acme';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await m.settle();
    expect(m.router.url).toContain('name=acme');

    const tri = ddSelect(cell('sensitive'));
    tri.value = 'false';
    tri.dispatchEvent(new Event('change'));
    await m.settle();
    expect(m.router.url).toContain('sensitive=false');
  });

  it('a disabled text stand-in is not an unlabelled empty box: it says what the filter is (the Audit Object id before a type is chosen)', async () => {
    await mount('/list', [
      {
        key: 'objectId',
        label: 'Object ID',
        type: 'text',
        disabledReason: () => 'Choose an object type first',
      },
    ]);
    const off = cell('objectId').querySelector<HTMLInputElement>('[data-filter-disabled] input')!;
    expect(off.disabled).toBe(true);
    expect(off.getAttribute('placeholder')).toBe('Object ID');
  });

  it('shows a disabled stand-in with the reason when the filter is unavailable', async () => {
    const owned = signal<string | null>('Set by the Due soon tab');
    await mount('/list?due' + 'From=2026-10-01', [
      {
        key: 'due',
        label: 'Due',
        type: 'dateRange',
        fromParam: 'dueFrom',
        toParam: 'dueTo',
        disabledReason: () => owned(),
      },
    ]);
    const off = cell('due').querySelector<HTMLInputElement>('[data-filter-disabled] input')!;
    expect(off.disabled).toBe(true);
    expect(off.getAttribute('aria-label')).toBe('Filter by Due');
    expect(off.value).toContain('from 10/01');
    const why = cell('due').querySelector(`#${off.getAttribute('aria-describedby')}`)!;
    expect(why.textContent).toBe('Set by the Due soon tab');
    expect(cell('due').querySelector('[data-filter-disabled]')?.getAttribute('title')).toBe(
      'Set by the Due soon tab',
    );
    owned.set(null);
    await m.settle();
    expect(cell('due').querySelector('[data-filter-disabled]')).toBeNull();
  });

  it('turns a flag option into its own URL flag (Unassigned)', async () => {
    await mount('/list?unassigned=true', [
      {
        key: 'assignee',
        label: 'Assignee',
        type: 'user',
        options: [{ value: '7', label: 'Ada' }],
        flagOptions: { unassigned: { param: 'unassigned', label: 'Unassigned' } },
      },
    ]);
    expect(cell('assignee').textContent).toContain('Unassigned');
    expect(m.filters.list('assignee')).toEqual(['unassigned']);
  });
});
