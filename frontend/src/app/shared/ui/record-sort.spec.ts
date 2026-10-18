import { TestBed } from '@angular/core/testing';
import { SortOption } from '../work-queue/phone-sort';
import { RecordSort, parseSortExpression, sortExpression } from './record-sort';

const OPTIONS: SortOption[] = [
  { value: 'clientNumber', label: 'Client number' },
  { value: 'name', label: 'Name' },
  { value: 'openTasks', label: 'Open tasks', descFirst: true },
  { value: 'overdue', label: 'Overdue', descFirst: true },
];

describe('sort expressions', () => {
  it('reads field and direction from the address', () => {
    expect(parseSortExpression('-openTasks')).toEqual({ field: 'openTasks', dir: 'desc' });
    expect(parseSortExpression('name')).toEqual({ field: 'name', dir: 'asc' });
    expect(parseSortExpression('overdue,name')).toEqual({ field: 'overdue', dir: 'asc' });
    expect(parseSortExpression('')).toBeNull();
    expect(parseSortExpression(null)).toBeNull();
  });

  it('writes the header form; the default order ascending is no sort', () => {
    expect(sortExpression({ field: 'openTasks', dir: 'desc' }, 'name')).toBe('-openTasks');
    expect(sortExpression({ field: 'name', dir: 'asc' }, 'name')).toBeNull();
    expect(sortExpression({ field: 'name', dir: 'desc' }, 'name')).toBe('-name');
    expect(sortExpression(null, 'name')).toBeNull();
  });
});

describe('RecordSort', () => {
  function create(sort: string | null = null) {
    const fixture = TestBed.createComponent(RecordSort);
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('defaultSort', 'clientNumber');
    fixture.componentRef.setInput('sort', sort);
    fixture.detectChanges();
    const picks: (string | null)[] = [];
    fixture.componentInstance.sorted.subscribe((p) => picks.push(p));
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, picks };
  }
  const change = (select: HTMLSelectElement, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };

  it('lists the options with the default one selected and no separate "Default order" entry', () => {
    const { el } = create();
    const select = el.querySelector<HTMLSelectElement>('[data-sort-select]')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Client number',
      'Name',
      'Open tasks',
      'Overdue',
    ]);
    expect(select.value).toBe('clientNumber');
    expect(el.querySelector<HTMLSelectElement>('[data-dir-select]')!.value).toBe('asc');
  });

  it('a count is picked descending, a name ascending; the default ascending clears the sort', () => {
    const { el, picks } = create('-openTasks');
    const select = el.querySelector<HTMLSelectElement>('[data-sort-select]')!;
    expect(select.value).toBe('openTasks');
    expect(el.querySelector<HTMLSelectElement>('[data-dir-select]')!.value).toBe('desc');
    change(select, 'overdue');
    change(select, 'name');
    change(select, 'clientNumber');
    expect(picks).toEqual(['-overdue', 'name', null]);
    change(el.querySelector<HTMLSelectElement>('[data-dir-select]')!, 'asc');
    expect(picks[picks.length - 1]).toBe('openTasks');
  });
});
