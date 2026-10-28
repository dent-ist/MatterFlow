import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { PrintLine } from './print-line';

@Component({
  imports: [PrintLine],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-print-line
    name="Task Queue: Overdue"
    [sort]="sort()"
    [dir]="dir()"
    [total]="total()"
    [page]="page()"
    [pageSize]="50"
  />`,
})
class Host {
  readonly sort = signal<string | null>('due');
  readonly dir = signal<'asc' | 'desc' | null>('asc');
  readonly total = signal(442);
  readonly page = signal(1);
}

describe('PrintLine (#215)', () => {
  function render(setup: (h: Host) => void = () => undefined) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-14T16:05:00Z') } },
      ],
    });
    const f = TestBed.createComponent(Host);
    setup(f.componentInstance);
    f.detectChanges();
    const t = (s: string) => f.nativeElement.querySelector(s)?.textContent?.trim();
    return {
      page: t('[data-print-page]'),
      sort: t('[data-print-sort]'),
      count: t('[data-print-count]'),
      when: t('[data-print-when]'),
    };
  }

  it('names the page, the sort, the place in the list and the time in the viewer zone', () => {
    const r = render();
    expect(r.page).toBe('Task Queue: Overdue');
    expect(r.sort).toBe('Sorted by Due date, soonest first');
    expect(r.count).toBe('Page 1 of 9, 442 tasks, showing 1-50');
    expect(r.when).toBe('Printed Oct 14, 2026, 12:05 PM EDT');
  });

  it('says the last page, a single page, one task and no tasks', () => {
    expect(render((h) => h.page.set(9)).count).toBe('Page 9 of 9, 442 tasks, showing 401-442');
    expect(render((h) => h.total.set(12)).count).toBe('12 tasks');
    expect(render((h) => h.total.set(1)).count).toBe('1 task');
    expect(render((h) => h.total.set(0)).count).toBe('No tasks');
  });

  it('says descending, and default order when no column sorts', () => {
    expect(render((h) => h.dir.set('desc')).sort).toBe('Sorted by Due date, latest first');
    expect(render((h) => h.sort.set(null)).sort).toBe('Sorted by default order');
  });
});
