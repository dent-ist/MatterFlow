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

  it('folds the four priority counts into one cell with a full accessible text', () => {
    const el = root(render('load'));
    expect(el.querySelectorAll('thead th').length).toBe(11);
    const cell = el.querySelector('[data-priority-counts]')!;
    expect(cell.querySelector('.sr-only')!.textContent!.trim()).toBe(
      '2 Critical, 5 High, 3 Normal, 0 Low',
    );
    expect(cell.querySelectorAll('.pc').length).toBe(4);
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
