import { ddSelect } from '../../testing/dropdown-testing.spec-util';
import { TestBed } from '@angular/core/testing';
import { PhoneSort, SortChoice } from './phone-sort';

describe('PhoneSort', () => {
  function create(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(PhoneSort);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const picks: (SortChoice | null)[] = [];
    fixture.componentInstance.sortPick.subscribe((c) => picks.push(c));
    return { fixture, el, picks };
  }
  const change = (select: { value: string; dispatchEvent(e: Event): boolean }, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };

  it('offers the default order (named) and the sortable columns, with the rule under it', () => {
    const { el } = create({
      defaultLabel: 'Closed date',
      defaultOrder: 'Default order: Newest closed first',
    });
    const select = ddSelect(el.querySelector('[data-sort-select]')!);
    expect(select.options[0].textContent?.trim()).toBe('Closed date (default order)');
    const labels = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(labels).toContain('Due date');
    expect(labels).toContain('Priority, then age');
    expect(el.querySelector('[data-dir-select]')).toBeNull();
    expect(el.querySelector('[data-sort-rule]')!.textContent).toContain('Newest closed first');
  });

  it('picking a field emits it with its natural direction (dates newest first), the Order select appears for a sort, in words (no Ascending / Descending)', () => {
    const { el, picks, fixture } = create();
    const select = ddSelect(el.querySelector('[data-sort-select]')!);
    change(select, 'due');
    change(select, 'created');
    expect(picks).toEqual([
      { field: 'due', dir: 'asc' },
      { field: 'created', dir: 'desc' },
    ]);
    fixture.componentRef.setInput('sort', 'due');
    fixture.componentRef.setInput('dir', 'asc');
    fixture.detectChanges();
    const dir = ddSelect(el.querySelector('[data-dir-select]')!);
    expect(dir.value).toBe('asc');
    expect(Array.from(dir.options).map((o) => o.textContent?.trim())).toEqual([
      'Soonest first',
      'Latest first',
    ]);
    change(dir, 'desc');
    expect(picks[picks.length - 1]).toEqual({ field: 'due', dir: 'desc' });
    expect(el.querySelector('[data-sort-rule]')).toBeNull();
  });

  it('picking the default order emits null', () => {
    const { el, picks } = create({ sort: 'due', dir: 'asc' });
    change(ddSelect(el.querySelector('[data-sort-select]')!), '');
    expect(picks).toEqual([null]);
  });

  it('offers Group by only where the list can be grouped, and says so under the default order', () => {
    const none = create();
    expect(none.el.querySelector('[data-group-select]')).toBeNull();
    TestBed.resetTestingModule();
    const { el, fixture } = create({ groupable: true, defaultOrder: 'Default order: Priority' });
    const groups: (string | null)[] = [];
    fixture.componentInstance.groupChange.subscribe((g) => groups.push(g));
    change(ddSelect(el.querySelector('[data-group-select]')!), 'due');
    change(ddSelect(el.querySelector('[data-group-select]')!), '');
    expect(groups).toEqual(['due', null]);
    fixture.componentRef.setInput('grouped', true);
    fixture.detectChanges();
    expect(el.querySelector('[data-sort-rule]')!.textContent).toContain('Grouped by due date');
  });

  it('takes the list\'s own options and default field: no "Default order", the direction always shows (record lists)', () => {
    const { el, picks } = create({
      options: [
        { value: 'name', label: 'Name' },
        { value: 'openTasks', label: 'Open Tasks', descFirst: true },
      ],
      defaultField: 'name',
    });
    const select = ddSelect(el.querySelector('[data-sort-select]')!);
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Name',
      'Open Tasks',
    ]);
    expect(select.value).toBe('name');
    const order = () => ddSelect(el.querySelector('[data-dir-select]')!);
    expect(order().value).toBe('asc');
    expect(Array.from(order().options).map((o) => o.textContent?.trim())).toEqual([
      'A to Z',
      'Z to A',
    ]);
    change(select, 'openTasks');
    expect(picks).toEqual([{ field: 'openTasks', dir: 'desc' }]);
  });
});
