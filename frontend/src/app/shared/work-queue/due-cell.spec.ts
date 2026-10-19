import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { DueInput } from '../../core/time/time';
import { DueCell } from './due-cell';

@Component({
  imports: [DueCell],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-due-cell
    [due]="due()"
    [status]="status()"
    [layout]="layout()"
    [wasDue]="wasDue()"
  />`,
})
class Host {
  readonly due = signal<DueInput>({});
  readonly status = signal<string | null>('NEW');
  readonly layout = signal<'two-line' | 'inline'>('two-line');
  readonly wasDue = signal(false);
}

describe('DueCell (#209)', () => {
  function render(
    due: DueInput,
    status = 'NEW',
    layout: 'two-line' | 'inline' = 'two-line',
    wasDue = false,
  ) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: USER_TIME_ZONE, useValue: 'America/New_York' },
        { provide: Clock, useValue: { now: () => new Date('2026-10-14T16:00:00Z') } },
      ],
    });
    const f = TestBed.createComponent(Host);
    f.componentInstance.due.set(due);
    f.componentInstance.status.set(status);
    f.componentInstance.layout.set(layout);
    f.componentInstance.wasDue.set(wasDue);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const q = (s: string) => el.querySelector(s);
    return {
      el,
      root: q('.dc')!,
      l1: q('.dc-l1')?.textContent?.trim(),
      l2: q('.dc-l2')?.textContent?.replace(/\s+/g, ' ').trim(),
      spoken: q('.dc-sr')?.textContent,
    };
  }

  it('overdue timed: date with time, bold red line 2 with the alert icon, one spoken sentence', () => {
    const r = render({ dueAtUtc: '2026-10-14T10:00:00Z' });
    expect(r.l1).toBe('Oct 14, 6:00 AM');
    expect(r.l2).toBe('Overdue 6h');
    expect(r.el.querySelector('.dc-l2 .pi-exclamation-circle')).not.toBeNull();
    expect(r.spoken).toBe('Due Oct 14 at 6:00 AM, overdue 6 hours');
    expect(r.root.getAttribute('title')).toBe('Oct 14, 2026, 6:00 AM EDT');
    expect(r.el.querySelector('time')!.getAttribute('datetime')).toBe('2026-10-14T10:00:00Z');
    // the visible lines are hidden from assistive technology; only the sentence is spoken
    expect(r.el.querySelector('.dc-l1')!.getAttribute('aria-hidden')).toBe('true');
    expect(r.el.querySelector('.dc-l2')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('overdue date-only, today with a clock, tomorrow, in 2 days, later without line 2', () => {
    expect(render({ dueDate: '2026-10-10' })).toMatchObject({ l1: 'Oct 10', l2: 'Overdue 4d' });
    const today = render({ dueDate: '2026-10-14' });
    expect(today.l2).toBe('Due today');
    expect(today.el.querySelector('.pi-clock')).not.toBeNull();
    expect(render({ dueDate: '2026-10-15' }).l2).toBe('Tomorrow');
    expect(render({ dueDate: '2026-10-16' }).l2).toBe('In 2 days');
    const later = render({ dueDate: '2027-01-05' });
    expect(later.l1).toBe('Jan 5, 2027');
    expect(later.l2).toBeUndefined();
  });

  it('ASAP is one line with the bolt; a closed task is plain (no bolt, no red, no line 2)', () => {
    const asap = render({});
    expect(asap.el.querySelector('.pi-bolt')).not.toBeNull();
    expect(asap.l2).toBeUndefined();
    expect(asap.spoken).toBe('No due date, ASAP');
    const closedNoDate = render({}, 'COMPLETED');
    expect(closedNoDate.el.querySelector('.pi-bolt')).toBeNull();
    expect(closedNoDate.l1).toBe('-');
    const closed = render({ dueDate: '2026-10-01' }, 'COMPLETED');
    expect(closed.l1).toBe('Oct 1');
    expect(closed.l2).toBeUndefined();
    expect(closed.el.querySelector('.pi-exclamation-circle')).toBeNull();
    expect(closed.spoken).toBe('Was due Oct 1');
  });

  it('wasDue (the Task page): a closed task with a due date says "Was due Oct 1"; no due date keeps the dash; an open task is unchanged (#302)', () => {
    expect(render({ dueDate: '2026-10-01' }, 'COMPLETED', 'inline', true).l1).toBe('Was due Oct 1');
    expect(render({ dueDate: '2026-10-01' }, 'CANCELLED', 'inline', true).l1).toBe('Was due Oct 1');
    expect(render({}, 'COMPLETED', 'inline', true).l1).toBe('-');
    expect(render({ dueDate: '2026-10-20' }, 'NEW', 'inline', true).l1).toBe('Oct 20');
    // The work lists do not ask for it.
    expect(render({ dueDate: '2026-10-01' }, 'COMPLETED', 'inline').l1).toBe('Oct 1');
  });

  it('inline layout: the date without time, then the relative text on the same line, no icon', () => {
    const r = render({ dueAtUtc: '2026-10-14T10:00:00Z' }, 'NEW', 'inline');
    expect(r.root.classList).toContain('dc--inline');
    expect(r.l1).toBe('Oct 14');
    expect(r.l2).toBe('Overdue 6h');
  });
});
