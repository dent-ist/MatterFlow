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
  const change = (select: HTMLSelectElement, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };

  it('offers the default order (named) and the sortable columns, with the rule under it', () => {
    const { el } = create({
      defaultLabel: 'Closed date',
      defaultOrder: 'Default order: Newest closed first',
    });
    const select = el.querySelector<HTMLSelectElement>('[data-sort-select]')!;
    expect(select.options[0].textContent?.trim()).toBe('Default order (Closed date)');
    const labels = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(labels).toContain('Due date');
    expect(labels).toContain('Priority, then age');
    expect(el.querySelector('[data-dir-select]')).toBeNull();
    expect(el.querySelector('[data-sort-rule]')!.textContent).toContain('Newest closed first');
  });

  it('picking a field emits it with its natural direction (dates newest first), the Direction select appears for a sort', () => {
    const { el, picks, fixture } = create();
    const select = el.querySelector<HTMLSelectElement>('[data-sort-select]')!;
    change(select, 'due');
    change(select, 'created');
    expect(picks).toEqual([
      { field: 'due', dir: 'asc' },
      { field: 'created', dir: 'desc' },
    ]);
    fixture.componentRef.setInput('sort', 'due');
    fixture.componentRef.setInput('dir', 'asc');
    fixture.detectChanges();
    const dir = el.querySelector<HTMLSelectElement>('[data-dir-select]')!;
    expect(dir.value).toBe('asc');
    change(dir, 'desc');
    expect(picks[picks.length - 1]).toEqual({ field: 'due', dir: 'desc' });
    expect(el.querySelector('[data-sort-rule]')).toBeNull();
  });

  it('picking the default order emits null', () => {
    const { el, picks } = create({ sort: 'due', dir: 'asc' });
    change(el.querySelector<HTMLSelectElement>('[data-sort-select]')!, '');
    expect(picks).toEqual([null]);
  });

  it('offers Group by only where the list can be grouped, and says so under the default order', () => {
    const none = create();
    expect(none.el.querySelector('[data-group-select]')).toBeNull();
    TestBed.resetTestingModule();
    const { el, fixture } = create({ groupable: true, defaultOrder: 'Default order: Priority' });
    const groups: (string | null)[] = [];
    fixture.componentInstance.groupChange.subscribe((g) => groups.push(g));
    change(el.querySelector<HTMLSelectElement>('[data-group-select]')!, 'due');
    change(el.querySelector<HTMLSelectElement>('[data-group-select]')!, '');
    expect(groups).toEqual(['due', null]);
    fixture.componentRef.setInput('grouped', true);
    fixture.detectChanges();
    expect(el.querySelector('[data-sort-rule]')!.textContent).toContain('Grouped by due date');
  });
});
