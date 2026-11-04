import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { UsersTable } from './users-table';
import { LEGEND, aUser } from './users-testing';

describe('UsersTable', () => {
  function render(sort: 'load' | 'name' | 'priority' | 'open', reversed = false) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-14T12:00:00Z') } },
      ],
    });
    const fixture = TestBed.createComponent(UsersTable);
    fixture.componentRef.setInput('users', [aUser(1, 'Ana Bell', [2, 5, 3, 0])]);
    fixture.componentRef.setInput('legend', LEGEND);
    fixture.componentRef.setInput('canAssign', true);
    fixture.componentRef.setInput('sort', sort);
    fixture.componentRef.setInput('reversed', reversed);
    fixture.detectChanges();
    return fixture;
  }
  const root = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;

  it('has one Load element next to the person: the count, a bar split by priority, a tooltip and a full accessible text', () => {
    const el = root(render('load'));
    expect(el.querySelectorAll('thead th').length).toBe(6);
    const heads = [...el.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    expect(heads.slice(0, 5)).toEqual([
      'Person',
      'Workload',
      'Highest priority',
      'Overdue',
      'Next due',
    ]);
    // No Availability column and no avatar (US-10).
    expect(heads).not.toContain('Availability');
    expect(el.querySelector('.avatar')).toBeNull();
    const cell = el.querySelector('[data-priority-counts]')!;
    expect(cell.querySelector('.cnt')!.textContent!.trim()).toBe('10');
    expect(cell.querySelector('.sr-only')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Heavy load, 10 open tasks: 2 Critical, 5 High, 3 Normal, 0 Low',
    );
    expect(cell.querySelector('.track')!.getAttribute('title')).toBe(
      'Heavy: 10 open (2 Critical, 5 High, 3 Normal)',
    );
    // No separate Open tasks column and no signal icons with digits.
    expect(heads).not.toContain('Open tasks');
    expect(heads).not.toContain('Due soon');
    expect(heads).not.toContain('On hold');
    expect(heads).not.toContain('Open by priority');
  });

  it('is quiet: no Availability chip for an available person, a muted dash for zeros, red when overdue', () => {
    const f = render('load');
    const el = root(f);
    expect(el.querySelector('tbody .chip')).toBeNull();
    const cells = [...el.querySelectorAll('tbody tr td')].map((c) => c.textContent?.trim());
    expect(cells).toContain('-');
    f.componentRef.setInput('users', [
      aUser(1, 'Ana Bell', [1, 0, 0, 0], {
        overdue: 2,
        availability: { state: 'OUT_OF_OFFICE', outUntil: undefined, note: undefined },
      }),
    ]);
    f.detectChanges();
    expect(el.querySelector('tbody .chip')!.textContent).toContain('Out of office');
    // The chip sits beside the name, in the Person cell.
    expect(el.querySelector('tbody th.person .chip')).not.toBeNull();
    expect(el.querySelector('tbody td.warn')!.textContent!.trim()).toBe('2');
    expect(el.querySelector('[data-assign-work]')!.textContent!.trim()).toBe('');
    expect(el.querySelector('[data-assign-work]')!.getAttribute('aria-label')).toBe(
      'Assign work to Ana Bell',
    );
  });

  it('marks the sorted column with aria-sort and the others none', () => {
    const el = root(render('open'));
    const sorts = [...el.querySelectorAll('thead th')].map((th) => th.getAttribute('aria-sort'));
    expect(sorts.filter((s) => s === 'descending').length).toBe(1);
    expect(
      el.querySelector('[data-sort-key="open"]')!.closest('th')!.getAttribute('aria-sort'),
    ).toBe('descending');
    expect(
      el.querySelector('[data-sort-key="name"]')!.closest('th')!.getAttribute('aria-sort'),
    ).toBe('none');
  });

  it('flips the direction when reversed', () => {
    const el = root(render('open', true));
    expect(
      el.querySelector('[data-sort-key="open"]')!.closest('th')!.getAttribute('aria-sort'),
    ).toBe('ascending');
  });

  it('asks to reverse on the active header and to sort on another one', () => {
    const f = render('open');
    const seen: unknown[] = [];
    f.componentInstance.sortRequest.subscribe((r) => seen.push(r));
    root(f).querySelector<HTMLButtonElement>('[data-sort-key="open"]')!.click();
    root(f).querySelector<HTMLButtonElement>('[data-sort-key="name"]')!.click();
    expect(seen).toEqual([
      { sort: 'open', reversed: true },
      { sort: 'name', reversed: false },
    ]);
  });
});
