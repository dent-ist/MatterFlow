import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DueChip } from './due-chip';

@Component({
  imports: [DueChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-due-chip [due]="due()" [status]="'NEW'" />`,
})
class Host {
  readonly due = signal<{ dueDate?: string | null; dueAtUtc?: string | null }>({});
}

describe('DueChip', () => {
  function render(due: { dueDate?: string | null; dueAtUtc?: string | null }) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: USER_TIME_ZONE, useValue: 'UTC' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-14T12:00:00Z') } },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.due.set(due);
    fixture.detectChanges();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.chip')!;
    return {
      kind: chip.getAttribute('data-due-kind'),
      text: chip.textContent!.trim(),
      title: chip.getAttribute('title'),
    };
  }

  it('says ASAP without a due date', () => {
    expect(render({})).toMatchObject({ kind: 'asap', text: 'ASAP' });
  });

  it('says how long a task is overdue, with the date as the tooltip', () => {
    expect(render({ dueDate: '2026-10-10' })).toEqual({
      kind: 'overdue',
      text: 'Overdue 4d',
      title: 'Oct 10, 2026',
    });
  });

  it('says Due today and Tomorrow instead of the date', () => {
    expect(render({ dueDate: '2026-10-14' }).text).toBe('Due today');
    expect(render({ dueDate: '2026-10-15' }).text).toBe('Tomorrow');
  });

  it('shows a later date without the year of the current year, and with any other year', () => {
    expect(render({ dueDate: '2026-11-04' }).text).toBe('Nov 4');
    expect(render({ dueDate: '2027-11-04' }).text).toBe('Nov 4, 2027');
  });
});
