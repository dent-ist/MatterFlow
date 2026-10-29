import { MyMattersActivityItem, MyMattersDeadlineDay } from '../../../api/generated/api-client';
import { figureLink } from '../panels/since-panel';
import { activityRows } from './activity-tab';
import { calendarWeeks } from '../panels/calendar-panel';

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

describe('calendarWeeks (Calendar)', () => {
  it('pads the first week with blanks so a Wednesday starts under Wed, and ends on a Sunday', () => {
    // 2026-10-28 is a Wednesday.
    const days = ['28', '29', '30', '31'].map((d) => day(`2026-10-${d}`, 1));
    days.push(day('2026-11-01', 0, { isWeekend: true }));
    const weeks = calendarWeeks(days);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].map((c) => c.date)).toEqual([
      null,
      null,
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('labels the first cell and the first of a month with the month, the others with the day number', () => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 26 + i)); // Monday Oct 26
      return day(d.toISOString().slice(0, 10));
    });
    const weeks = calendarWeeks(days);
    expect(weeks).toHaveLength(2);
    const labels = weeks.flat().map((c) => c.label);
    expect(labels[0]).toBe('Oct 26');
    expect(labels[1]).toBe('27');
    expect(labels).toContain('Nov 1');
    expect(labels).toContain('8');
  });

  it('keeps the count, the weekend and today flags and the Task Queue query of a day', () => {
    const weeks = calendarWeeks([day('2026-10-24', 3, { isWeekend: true, isToday: true })]);
    const cell = weeks[0].find((c) => c.date)!;
    expect(cell).toMatchObject({ count: 3, weekend: true, today: true, full: 'Sat Oct 24' });
    expect(cell.params).toEqual({
      managedByMe: 'true',
      dueFrom: '2026-10-24',
      dueTo: '2026-10-24',
    });
  });

  it('is empty without days', () => {
    expect(calendarWeeks([])).toEqual([]);
  });
});

describe('Activity tab rows', () => {
  const item = (eventId: number, isUnread: boolean) =>
    ({ eventId, isUnread }) as MyMattersActivityItem;

  it('puts "Since your last visit" before the unread ones and "Earlier" before the read ones', () => {
    const rows = activityRows([item(5, true), item(4, true), item(3, false), item(2, false)]);
    expect(rows.map((r) => ('divider' in r ? r.divider : r.item.eventId))).toEqual([
      'Since your last visit',
      5,
      4,
      'Earlier',
      3,
      2,
    ]);
  });

  it('draws no divider when nothing is unread', () => {
    const rows = activityRows([item(3, false), item(2, false)]);
    expect(rows.every((r) => 'item' in r)).toBe(true);
  });

  it('draws only the first divider when everything is unread', () => {
    const rows = activityRows([item(3, true), item(2, true)]);
    expect(rows.filter((r) => 'divider' in r)).toHaveLength(1);
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
