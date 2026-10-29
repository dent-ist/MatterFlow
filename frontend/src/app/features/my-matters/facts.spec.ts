import {
  OLDEST_FIRST,
  activityText,
  activityTime,
  activityWhat,
  activityWhen,
  activityWho,
  dayHeading,
  factText,
  groupByDay,
  holdHint,
  shortDate,
  statusWords,
} from './facts';

describe('My Matters words', () => {
  it('states the one fact of an attention row in plain words', () => {
    expect(factText({ factCode: 'OVERDUE', factDays: 3 })).toBe('3 d overdue');
    expect(factText({ factCode: 'DUE_TODAY', factDays: undefined })).toBe('due today');
    expect(factText({ factCode: 'AT_RISK', factDays: undefined })).toBe('at risk');
    expect(factText({ factCode: 'DUE_IN_DAYS', factDays: 1 })).toBe('due tomorrow');
    expect(factText({ factCode: 'DUE_IN_DAYS', factDays: 4 })).toBe('due in 4 d');
    expect(factText({ factCode: 'NO_ASSIGNEE', factDays: undefined })).toBe('no assignee');
    expect(factText({ factCode: 'ON_HOLD_DAYS', factDays: 12 })).toBe('on hold 12 d');
  });

  it('words the age of the oldest hold apart from the count (#821)', () => {
    expect(holdHint(0, 10)).toBe('oldest 0 days');
    expect(holdHint(1, 3)).toBe('oldest 1 day');
    expect(holdHint(12, 3)).toBe('oldest 12 days');
    expect(holdHint(12, 0)).toBe('');
    expect(holdHint(null, 4)).toBe('');
    expect(holdHint(undefined, undefined)).toBe('');
  });

  it('opens overdue links oldest first (#817)', () => {
    expect(OLDEST_FIRST).toEqual({ sort: 'due', dir: 'asc' });
  });

  it('writes status codes as people read them', () => {
    expect(statusWords('ON_HOLD')).toBe('On Hold');
    expect(statusWords('IN_PROGRESS')).toBe('In Progress');
    expect(statusWords(undefined)).toBe('');
  });

  it('groups deadlines by day in the order given', () => {
    const t = (taskId: number, dueDate: string) =>
      ({ taskId, dueDate, taskNumber: 'T', title: 'x' }) as never;
    const groups = groupByDay(
      [t(1, '2026-10-26'), t(2, '2026-10-26'), t(3, '2026-10-27')],
      'America/New_York',
    );
    expect(groups.map((g) => [g.heading, g.items.length])).toEqual([
      ['Mon Oct 26', 2],
      ['Tue Oct 27', 1],
    ]);
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
