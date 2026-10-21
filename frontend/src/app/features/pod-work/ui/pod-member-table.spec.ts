import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PodMemberLoad } from '../../../api/generated/api-client';
import { provideClock } from '../../../shared/work-queue/work-queue-testing';
import {
  MemberSort,
  PodMemberTable,
  barFraction,
  loadLine,
  nextSort,
  sortLoads,
  splitLoads,
} from './pod-member-table';

const load = (
  userId: number,
  displayName: string,
  over: Partial<PodMemberLoad> = {},
): PodMemberLoad => ({
  userId,
  displayName,
  isActive: true,
  isMember: true,
  open: 0,
  overdue: 0,
  onHold: 0,
  ...over,
});

const names = (loads: readonly PodMemberLoad[]) => loads.map((m) => m.displayName);

describe('the sort of the workload table (#568)', () => {
  const loads = [
    load(1, 'Cleo', { open: 3, overdue: 0, onHold: 1 }),
    load(2, 'alma', { open: 3, overdue: 2, onHold: 0 }),
    load(3, 'Boris', { open: 9, overdue: 1, onHold: 1 }),
    load(4, 'Dev', { open: 1, overdue: 1, onHold: 0, isActive: false }),
  ];

  it('is alphabetical by default, ignoring case', () => {
    expect(names(sortLoads(loads, null))).toEqual(['alma', 'Boris', 'Cleo', 'Dev']);
  });

  it('never orders by load unless the viewer asks: the default ignores the numbers', () => {
    const sorted = sortLoads([load(1, 'Zed', { open: 99 }), load(2, 'Amy', { open: 0 })], null);
    expect(names(sorted)).toEqual(['Amy', 'Zed']);
  });

  it('sorts a number column ascending and descending, equal values by name', () => {
    const asc: MemberSort = { key: 'open', dir: 'asc' };
    expect(names(sortLoads(loads, asc))).toEqual(['Dev', 'alma', 'Cleo', 'Boris']);
    expect(names(sortLoads(loads, { key: 'open', dir: 'desc' }))).toEqual([
      'Boris',
      'alma',
      'Cleo',
      'Dev',
    ]);
    expect(names(sortLoads(loads, { key: 'overdue', dir: 'desc' }))).toEqual([
      'alma',
      'Boris',
      'Dev',
      'Cleo',
    ]);
    expect(names(sortLoads(loads, { key: 'onHold', dir: 'asc' }))).toEqual([
      'alma',
      'Dev',
      'Boris',
      'Cleo',
    ]);
  });

  it('sorts the Member column by name in both directions; an inactive member sorts like any other', () => {
    expect(names(sortLoads(loads, { key: 'member', dir: 'asc' }))).toEqual([
      'alma',
      'Boris',
      'Cleo',
      'Dev',
    ]);
    expect(names(sortLoads(loads, { key: 'member', dir: 'desc' }))).toEqual([
      'Dev',
      'Cleo',
      'Boris',
      'alma',
    ]);
  });

  it('breaks a tie of equal names by id so the order never shuffles, and does not change its input', () => {
    const same = [load(8, 'Sam'), load(5, 'Sam')];
    expect(sortLoads(same, null).map((m) => m.userId)).toEqual([5, 8]);
    expect(same.map((m) => m.userId)).toEqual([8, 5]);
  });

  it('goes ascending, descending, then back to the default; another heading starts ascending', () => {
    let sort = nextSort(null, 'open');
    expect(sort).toEqual({ key: 'open', dir: 'asc' });
    sort = nextSort(sort, 'open');
    expect(sort).toEqual({ key: 'open', dir: 'desc' });
    expect(nextSort(sort, 'open')).toBeNull();
    expect(nextSort(sort, 'overdue')).toEqual({ key: 'overdue', dir: 'asc' });
  });
});

describe('the pieces of the workload table (#566)', () => {
  it('splits the people with open work from the idle ones, keeping the order', () => {
    const { working, idle } = splitLoads([
      load(1, 'A', { open: 2 }),
      load(2, 'B'),
      load(3, 'C', { open: 1 }),
    ]);
    expect(names(working)).toEqual(['A', 'C']);
    expect(names(idle)).toEqual(['B']);
  });

  it('scales the bar to the largest load and never past 0 to 1', () => {
    expect(barFraction(5, 10)).toBe(0.5);
    expect(barFraction(10, 10)).toBe(1);
    expect(barFraction(0, 10)).toBe(0);
    expect(barFraction(3, 0)).toBe(0);
    expect(barFraction(20, 10)).toBe(1);
  });

  it('says the three numbers on one card line', () => {
    expect(loadLine({ open: 5, overdue: 0, onHold: 1 })).toBe('5 open · 0 overdue · 1 on hold');
  });
});

@Component({
  imports: [PodMemberTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-pod-member-table
    [loads]="loads()"
    [unassigned]="3"
    [selected]="selected()"
    (memberToggle)="toggled.push($event)"
    (showUnassigned)="unassignedShown = unassignedShown + 1"
  />`,
})
class Host {
  readonly loads = signal<PodMemberLoad[]>([
    load(1, 'Test User 21', { open: 5, overdue: 0, onHold: 1 }),
    load(2, 'Test User 41', {
      open: 7,
      overdue: 1,
      onHold: 2,
      availability: { state: 'OUT_OF_OFFICE', outUntil: '2026-10-27T00:00:00Z', note: undefined },
    }),
    load(3, 'Test User 01'),
    load(4, 'Test User 05', {
      availability: { state: 'OUT_OF_OFFICE', outUntil: undefined, note: undefined },
    }),
    load(5, 'Test User 08', { isActive: false }),
  ]);
  readonly selected = signal<number[]>([]);
  readonly toggled: number[] = [];
  unassignedShown = 0;
}

describe('PodMemberTable', () => {
  function mount() {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), ...provideClock('2026-10-14T15:00:00Z', 'UTC')],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }
  const el = (f: ReturnType<typeof mount>) => f.nativeElement as HTMLElement;
  const rowNames = (f: ReturnType<typeof mount>) =>
    Array.from(el(f).querySelectorAll('[data-member-row] th')).map((th) =>
      th.textContent!.replace(/\s+/g, ' ').trim(),
    );

  it('lists the Not assigned row, then the people with work alphabetically, then one folded row', () => {
    const f = mount();
    expect(rowNames(f)).toEqual([
      'Not assigned to a person',
      'Test User 21',
      'Test User 41 Out of office until Oct 26',
    ]);
    const fold = el(f).querySelector('[data-member-fold]')!;
    expect(fold.textContent).toContain('Show 3 members with no open work');
    expect(fold.textContent).toContain('1 out of office');
    expect(fold.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the folded row by keyboard-operable button: the idle members show with their availability, inactive marked', () => {
    const f = mount();
    el(f).querySelector<HTMLButtonElement>('[data-member-fold] button')!.click();
    f.detectChanges();
    expect(el(f).querySelector('[data-member-fold] button')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(el(f).querySelector('[data-member-fold] button')!.textContent).toContain(
      'Hide 3 members with no open work',
    );
    const rows = rowNames(f);
    expect(rows.slice(3)).toEqual([
      'Test User 01',
      'Test User 05 Out of office',
      'Test User 08 (inactive)',
    ]);
  });

  it('has real column headers, the sort on the headings and a caption', () => {
    const f = mount();
    const heads = Array.from(el(f).querySelectorAll('thead th'));
    expect(heads.map((h) => h.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col', 'col']);
    expect(heads.slice(0, 4).map((h) => h.textContent!.trim())).toEqual([
      'Member',
      'Open',
      'Overdue',
      'On hold',
    ]);
    expect(heads.slice(0, 4).every((h) => h.getAttribute('aria-sort') === 'none')).toBe(true);
    expect(el(f).querySelector('caption')!.textContent).toContain('not a ranking');
  });

  it('a heading sorts ascending, then descending, then back to alphabetical; aria-sort follows; the Unassigned and fold rows keep their place', () => {
    const f = mount();
    const open = () => el(f).querySelectorAll<HTMLButtonElement>('thead .pm-sort')[1];
    const sortOf = () => open().closest('th')!.getAttribute('aria-sort');
    open().click();
    f.detectChanges();
    expect(sortOf()).toBe('ascending');
    expect(rowNames(f)).toEqual([
      'Not assigned to a person',
      'Test User 21',
      'Test User 41 Out of office until Oct 26',
    ]);
    open().click();
    f.detectChanges();
    expect(sortOf()).toBe('descending');
    expect(rowNames(f)[1]).toBe('Test User 41 Out of office until Oct 26');
    expect(el(f).querySelector('tbody tr:nth-child(1)')!.getAttribute('data-member-row')).toBe(
      'unassigned',
    );
    expect(el(f).querySelector('tbody tr:last-child')!.hasAttribute('data-member-fold')).toBe(true);
    open().click();
    f.detectChanges();
    expect(sortOf()).toBe('none');
    expect(rowNames(f)[1]).toBe('Test User 21');
    // Focus stays on the heading button through all three states (the button is not re-created).
  });

  it('a neutral bar is scaled to the largest load and has no meaning of its own (the number is the text)', () => {
    const f = mount();
    const bars = Array.from(el(f).querySelectorAll<HTMLElement>('.pm-bar'));
    const widths = bars.map((b) => parseFloat(b.style.width));
    expect(widths[0]).toBeCloseTo((5 / 7) * 6, 3);
    expect(widths[1]).toBe(6);
    expect(bars.every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('every row has two controls (the name and View tasks), pressed together, and reports the person', () => {
    const f = mount();
    f.componentInstance.selected.set([2]);
    f.detectChanges();
    const row = el(f).querySelector('[data-member-row][data-user="2"]')!;
    const controls = row.querySelectorAll('button');
    expect(controls).toHaveLength(2);
    expect(Array.from(controls).map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
    ]);
    expect(controls[1].textContent!.replace(/\s+/g, ' ').trim()).toBe('View tasks of Test User 41');
    (controls[1] as HTMLButtonElement).click();
    expect(f.componentInstance.toggled).toEqual([2]);
    const other = el(f).querySelector('[data-member-row][data-user="1"] button')!;
    expect(other.getAttribute('aria-pressed')).toBe('false');
  });

  it('the Not assigned row says how many tasks nobody holds and opens the Unassigned tab', () => {
    const f = mount();
    const row = el(f).querySelector('[data-member-row="unassigned"]')!;
    expect(row.querySelectorAll('td')[0].textContent!.trim()).toBe('3');
    row.querySelector<HTMLButtonElement>('button')!.click();
    expect(f.componentInstance.unassignedShown).toBe(1);
  });
});
