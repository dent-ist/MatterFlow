import {
  activityText,
  activityTime,
  activityWhat,
  activityWhen,
  activityWho,
  dayHeading,
  shortDate,
} from './facts';

describe('My Matters words', () => {
  it('writes a day heading as the weekday and the date', () => {
    expect(dayHeading({ year: 2026, month: 10, day: 30 })).toBe('Fri Oct 30');
  });

  it('shows the time today, then Yesterday, then the date', () => {
    const now = new Date('2026-10-23T18:00:00Z');
    expect(activityTime('2026-10-23T13:42:00Z', now, 'America/New_York')).toMatch(/9:42/);
    expect(activityTime('2026-10-22T13:42:00Z', now, 'America/New_York')).toBe('Yesterday');
    expect(activityTime('2026-10-20T13:42:00Z', now, 'America/New_York')).toBe('Oct 20');
  });

  it('writes the When cell with the date and the time on one line', () => {
    const now = new Date('2026-10-23T18:00:00Z');
    expect(activityWhen('2026-10-23T13:42:00Z', now, 'America/New_York')).toBe('Today, 9:42 AM');
    expect(activityWhen('2026-10-22T13:10:00Z', now, 'America/New_York')).toBe(
      'Yesterday, 9:10 AM',
    );
    expect(activityWhen('2026-10-20T18:05:00Z', now, 'America/New_York')).toBe('Oct 20, 2:05 PM');
  });

  it('writes the Who and What cells as short phrases, never from comment text', () => {
    const e = (o: object) => ({ kind: 'X', actorName: 'Dana Rao', ...o }) as never;
    expect(activityWho(e({}))).toBe('Dana Rao');
    expect(activityWho({ actorName: undefined })).toBe('System');
    expect(activityWhat(e({ kind: 'TASK_CREATED' }))).toBe('Created');
    expect(activityWhat(e({ kind: 'STATUS_CHANGED', to: 'ON_HOLD' }))).toBe('Put on hold');
    expect(activityWhat(e({ kind: 'STATUS_CHANGED', to: 'COMPLETED' }))).toBe('Completed');
    expect(activityWhat(e({ kind: 'STATUS_CHANGED', to: 'IN_PROGRESS' }))).toBe(
      'Moved to In Progress',
    );
    expect(activityWhat(e({ kind: 'REASSIGNED', to: 'Sam' }))).toBe('Assigned to Sam');
    expect(activityWhat(e({ kind: 'REASSIGNED', from: 'Lee', to: 'Sam' }))).toBe(
      'Reassigned from Lee to Sam',
    );
    expect(activityWhat(e({ kind: 'COMMENTED', from: 'secret', to: 'secret' }))).toBe('Commented');
    expect(
      activityWhat(e({ kind: 'MANAGER_CHANGED', to: 'Alex Kim', managerPlace: 'secondary' })),
    ).toBe('Alex Kim became secondary project manager');
  });

  it('composes activity sentences from structured fields and never from comment text', () => {
    const e = (o: object) =>
      ({ kind: 'X', actorName: 'Dana', taskTitle: 'Privilege log', ...o }) as never;
    expect(activityText(e({ kind: 'STATUS_CHANGED', to: 'ON_HOLD' }))).toBe(
      'Dana moved "Privilege log" to On Hold',
    );
    expect(activityText(e({ kind: 'TASK_CREATED' }))).toBe('Dana created "Privilege log"');
    expect(activityText(e({ kind: 'COMMENTED', from: 'secret', to: 'secret' }))).toBe(
      'Dana commented on "Privilege log"',
    );
    expect(activityText(e({ kind: 'REASSIGNED', from: 'Lee', to: 'Sam' }))).toBe(
      '"Privilege log" reassigned from Lee to Sam',
    );
    expect(
      activityText(e({ kind: 'MANAGER_CHANGED', to: 'Alex Kim', managerPlace: 'primary' })),
    ).toBe('Alex Kim became primary project manager');
  });

  it('writes a next deadline short in the current year and in full in another', () => {
    expect(shortDate('2026-10-26', 2026, 'none')).toBe('Oct 26');
    expect(shortDate('2027-01-05', 2026, 'none')).toBe('Jan 5, 2027');
    expect(shortDate(undefined, 2026, 'none')).toBe('none');
  });
});
