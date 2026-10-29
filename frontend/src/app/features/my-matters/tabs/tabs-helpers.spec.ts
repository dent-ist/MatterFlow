import { MyMattersDeadlineDay } from '../../../api/generated/api-client';
import { figureLink } from '../panels/since-panel';
import { monthWeeks } from '../panels/calendar-panel';

const day = (date: string, count = 0, extra: Partial<MyMattersDeadlineDay> = {}) =>
  ({
    date,
    isWeekend: false,
    isToday: false,
    count,
    query: `managedByMe=true&dueFrom=${date}&dueTo=${date}`,
    items: [],
    ...extra,
  }) as MyMattersDeadlineDay;

const item = (taskId: number, factCode = 'DUE_IN_DAYS') =>
  ({ taskId, taskNumber: `TSK-${taskId}`, title: `Task ${taskId}`, factCode }) as never;

describe('monthWeeks (Calendar, #944)', () => {
  it('pads the first week with blanks so a Wednesday starts under Wed, and ends on a Sunday', () => {
    // 2026-10-28 is a Wednesday.
    const days = ['28', '29', '30', '31'].map((d) => day(`2026-10-${d}`, 1));
    const weeks = monthWeeks(days);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].map((c) => c.date)).toEqual([
      null,
      null,
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      null,
    ]);
  });

  it('labels every cell with its day number and names the day in full', () => {
    const days = Array.from({ length: 31 }, (_, i) =>
      day(`2026-10-${String(i + 1).padStart(2, '0')}`),
    );
    const weeks = monthWeeks(days);
    // October 2026 starts on a Thursday: five week rows of Monday to Sunday.
    expect(weeks).toHaveLength(5);
    expect(weeks[0].map((c) => c.label)).toEqual(['', '', '', '1', '2', '3', '4']);
    expect(weeks[0][3].full).toBe('Thu Oct 1');
    expect(weeks[4].map((c) => c.label)).toEqual(['26', '27', '28', '29', '30', '31', '']);
  });

  it('keeps the count, the weekend and today flags, the overdue tasks and the Task Queue query of a day', () => {
    const weeks = monthWeeks([
      day('2026-10-24', 3, {
        isWeekend: true,
        isToday: true,
        items: [item(1, 'OVERDUE'), item(2)],
      }),
    ]);
    const cell = weeks[0].find((c) => c.date)!;
    expect(cell).toMatchObject({
      count: 3,
      weekend: true,
      today: true,
      overdue: 1,
      full: 'Sat Oct 24',
    });
    expect(cell.params).toEqual({
      managedByMe: 'true',
      dueFrom: '2026-10-24',
      dueTo: '2026-10-24',
    });
  });

  it('is empty without days', () => {
    expect(monthWeeks([])).toEqual([]);
  });
});

describe('Since your last visit links', () => {
  it('opens the Task Queue for tasks and the Activity tab for events, without the event period', () => {
    expect(
      figureLink({
        count: 2,
        query: 'managedByMe=true&overdue=true&sort=due',
        target: 'taskQueue',
      }),
    ).toEqual({
      commands: ['/tasks'],
      params: { managedByMe: 'true', overdue: 'true', sort: 'due' },
    });
    expect(
      figureLink({ count: 3, query: 'kind=REASSIGNED&unread=true', target: 'activity' }),
    ).toEqual({
      commands: ['/my-matters'],
      params: { kind: 'REASSIGNED', unread: 'true', tab: 'activity' },
    });
    expect(
      figureLink({ count: 3, query: 'kind=COMMENTED&from=2026-10-17', target: 'activity' }).params,
    ).toEqual({ kind: 'COMMENTED', tab: 'activity' });
  });
});
