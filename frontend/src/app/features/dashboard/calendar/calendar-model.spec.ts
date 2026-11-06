import { CalDay } from './calendar-contract';
import {
  DAY_COUNT_TIPS,
  addDays,
  cellTooltip,
  dayAriaLabel,
  expectedShort,
  expectedText,
  longDay,
  monthGrid,
  offHoursCount,
  parseCalAddress,
  shiftMonth,
  viewRange,
  weekGrid,
  weekPods,
  weekTitle,
} from './calendar-model';

const day = (over: Partial<CalDay> = {}): CalDay => ({
  date: '2026-11-26',
  total: 36,
  expected: 6,
  available: 6,
  outOfOffice: 0,
  onHoliday: 30,
  offHours: 0,
  coveragePercent: 100,
  level: 'GOOD',
  holidays: [{ name: 'Thanksgiving', category: 'US Holiday', colourKey: 'indigo' }],
  pods: [],
  ...over,
});

describe('month and week grids (Sunday first)', () => {
  it('November 2026 starts on Sunday 11/01 and has five whole weeks', () => {
    const g = monthGrid('2026-11');
    expect(g.length).toBe(35);
    expect(g[0]).toBe('2026-11-01');
    expect(g[34]).toBe('2026-12-05');
  });
  it('a month that starts mid-week begins on the Sunday before it', () => {
    const g = monthGrid('2026-10');
    expect(g[0]).toBe('2026-09-27');
    expect(g.length % 7).toBe(0);
  });
  it('a week starts on Sunday', () => {
    expect(weekGrid('2026-11-25')).toEqual([
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
    ]);
  });
  it('shifts months across the year end and days across month ends', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
  it('the range of a view is its first and last grid date', () => {
    expect(viewRange('month', '2026-11-25')).toMatchObject({
      from: '2026-11-01',
      to: '2026-12-05',
    });
    expect(viewRange('week', '2026-11-25')).toMatchObject({ from: '2026-11-22', to: '2026-11-28' });
  });
});

describe('cell text', () => {
  it('says "available of expected": Thanksgiving is 6 of 6 expected, not 6 of 36', () => {
    expect(expectedText(day())).toBe('6 of 6 expected');
    expect(expectedShort(day())).toBe('6/6');
    expect(cellTooltip(day())).toContain('6 of 6 expected people available');
    expect(cellTooltip(day())).toContain('30 on holiday');
    expect(cellTooltip(day())).toContain('36 in view');
  });
  it('the accessible name carries the level word, the numbers and the holiday', () => {
    const label = dayAriaLabel(day({ outOfOffice: 2 }), '2026-11-03');
    expect(label).toBe(
      'Thursday, November 26, 2026, coverage Good, 6 of 6 expected, 2 out of office, holiday: Thanksgiving',
    );
    expect(dayAriaLabel(day({ date: '2026-11-03' }), '2026-11-03')).toContain('today');
    expect(dayAriaLabel(day({ level: 'NON_WORKING', date: '2026-11-28' }), '2026-11-03')).toBe(
      'Saturday, November 28, 2026, coverage Non-working, holiday: Thanksgiving',
    );
  });
  it('writes dates in words and the week title in the numeric style', () => {
    expect(longDay('2026-11-25')).toBe('Wednesday, November 25, 2026');
    expect(weekTitle(weekGrid('2026-11-25'), 2026)).toBe('11/22 to 11/28');
    expect(weekTitle(weekGrid('2027-01-05'), 2026)).toBe('01/03/2027 to 01/09/2027');
  });
});

describe('week pods and address', () => {
  it('lists each pod once, in order of appearance', () => {
    const pod = (podId: number, name: string) => ({
      podId,
      name,
      expected: 1,
      available: 1,
      minimum: 1,
      level: 'GOOD' as const,
    });
    expect(
      weekPods([
        day({ pods: [pod(2, 'B'), pod(1, 'A')] }),
        day({ pods: [pod(1, 'A'), pod(3, 'C')] }),
      ]),
    ).toEqual([
      { podId: 2, name: 'B' },
      { podId: 1, name: 'A' },
      { podId: 3, name: 'C' },
    ]);
  });
  it('reads only valid parameters', () => {
    const get = (m: Record<string, string>) => (k: string) => m[k] ?? null;
    expect(
      parseCalAddress(get({ cal: 'week', week: '2026-11-25', day: '2026-11-25', role: '2' })),
    ).toEqual({
      view: 'week',
      month: null,
      week: '2026-11-25',
      day: '2026-11-25',
      role: 2,
    });
    expect(
      parseCalAddress(get({ cal: 'timeline', month: '2026-13', day: '2026-02-31x', role: 'x' })),
    ).toEqual({
      view: 'month',
      month: null,
      week: null,
      day: null,
      role: null,
    });
  });
});

describe('the day panel count tiles (#1234)', () => {
  it('Off Hours adds the holiday people, so Available, Out of Office and Off Hours add up to the people in view', () => {
    const d = day({ total: 46, available: 43, outOfOffice: 1, onHoliday: 2, offHours: 0 });
    expect(offHoursCount(d)).toBe(2);
    expect(d.available + d.outOfOffice + offHoursCount(d)).toBe(d.total);
    expect(offHoursCount(day({ onHoliday: 30, offHours: 4 }))).toBe(34);
    expect(offHoursCount(day({ onHoliday: 0, offHours: 0 }))).toBe(0);
  });

  it('each tile has a one-sentence tooltip; the holiday wording is part of Off Hours', () => {
    expect(DAY_COUNT_TIPS.available).toBe('People who are working and can take work on this day.');
    expect(DAY_COUNT_TIPS.out).toBe('People with an Out of Office entry that covers this day.');
    expect(DAY_COUNT_TIPS.off).toBe(
      'People who are not working on this day: outside their work hours (for example a weekend), or off for a holiday. A holiday takes priority over Out of Office.',
    );
  });
});
