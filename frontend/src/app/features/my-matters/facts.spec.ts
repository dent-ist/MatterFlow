import { activityTime, dayHeading, factText, groupByDay, statusWords } from './facts';
import { activityText } from './panels/activity-panel';
import { reasonText } from './panels/health-panel';

describe('My Matters words', () => {
  it('states the one fact of an attention row in plain words', () => {
    expect(factText({ factCode: 'OVERDUE', factDays: 3 })).toBe('3 d overdue');
    expect(factText({ factCode: 'DUE_TODAY', factDays: undefined })).toBe('due today');
    expect(factText({ factCode: 'DUE_IN_DAYS', factDays: 1 })).toBe('due tomorrow');
    expect(factText({ factCode: 'DUE_IN_DAYS', factDays: 4 })).toBe('due in 4 d');
    expect(factText({ factCode: 'NO_ASSIGNEE', factDays: undefined })).toBe('no assignee');
    expect(factText({ factCode: 'ON_HOLD_DAYS', factDays: 12 })).toBe('on hold 12 d');
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

  it('spells out the flag reasons with the thresholds the API echoes', () => {
    expect(reasonText('DUE_SOON', 3, 7)).toBe('a task is due within 3 days');
    expect(reasonText('LONG_HOLD', 3, 7)).toBe('a task has been on hold for more than 7 days');
    expect(reasonText('NO_OPEN_TASKS', 3, 7)).toBe('no open tasks');
  });
});
