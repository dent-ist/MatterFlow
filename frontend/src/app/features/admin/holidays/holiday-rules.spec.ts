import { Holiday } from './holiday-contract';
import { easter, expandYear, nthWeekday, observed, ruleText } from './holiday-rules';

const base: Holiday = {
  holidayId: 1,
  name: 'x',
  ruleKind: 'FIXED',
  month: null,
  day: null,
  nth: null,
  weekday: null,
  easterOffset: null,
  onceDate: null,
  endMonth: null,
  endDay: null,
  onceEnd: null,
  yearly: true,
  weekendRule: 'NONE',
  regionNote: null,
  plusDays: null,
  rowVersion: 'v',
};
const h = (over: Partial<Holiday>): Holiday => ({ ...base, ...over });

describe('holiday rules (checked against the approved mockup)', () => {
  it('computes Easter Sunday', () => {
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
  });
  it('finds the nth and the last weekday of a month', () => {
    expect(nthWeekday(2026, 11, 4, 4)).toBe('2026-11-26'); // Thanksgiving: 4th Thursday of November
    expect(nthWeekday(2026, 5, 1, -1)).toBe('2026-05-25'); // Memorial Day: last Monday of May
    expect(nthWeekday(2027, 1, 1, 3)).toBe('2027-01-18'); // MLK Day
    expect(nthWeekday(2026, 12, 5, -1)).toBe('2026-12-25'); // a last Friday that is the 25th
  });
  it('moves a weekend holiday by the US rule (Saturday to Friday, Sunday to Monday)', () => {
    expect(observed('2026-07-04', 'US', new Set())).toBe('2026-07-03');
    expect(observed('2027-07-04', 'US', new Set())).toBe('2027-07-05');
    expect(observed('2026-07-03', 'US', new Set())).toBeNull();
    expect(observed('2026-07-04', 'NONE', new Set())).toBeNull();
  });
  it('moves a weekend holiday by the UK rule to the next free Monday', () => {
    expect(observed('2027-12-25', 'UK', new Set())).toBe('2027-12-27');
    // Boxing Day 2027 is a Sunday: Monday 12/27 is taken by Christmas, so it moves to Tuesday.
    expect(observed('2027-12-26', 'UK', new Set(['2027-12-27']))).toBe('2027-12-28');
  });
  it('expands a calendar for a year in date order, with the observed day and where it fell', () => {
    const rows = expandYear(
      [
        h({ holidayId: 1, name: 'Independence Day', month: 7, day: 4, weekendRule: 'US' }),
        h({
          holidayId: 2,
          name: 'Thanksgiving',
          ruleKind: 'NTH_WEEKDAY',
          month: 11,
          nth: 4,
          weekday: 4,
        }),
        h({
          holidayId: 3,
          name: 'Day after Thanksgiving',
          ruleKind: 'NTH_WEEKDAY',
          month: 11,
          nth: 4,
          weekday: 4,
          plusDays: 1,
        }),
        h({ holidayId: 4, name: 'Good Friday', ruleKind: 'EASTER_OFFSET', easterOffset: -2 }),
        h({
          holidayId: 5,
          name: 'Move day',
          ruleKind: 'ONCE',
          onceDate: '2027-02-12',
          yearly: false,
        }),
      ],
      2026,
    );
    expect(rows.map((r) => [r.date, r.name, r.observedFrom])).toEqual([
      ['2026-04-03', 'Good Friday', null],
      ['2026-07-03', 'Independence Day', '2026-07-04'],
      ['2026-11-26', 'Thanksgiving', null],
      ['2026-11-27', 'Day after Thanksgiving', null],
    ]);
  });
  it('gives a yearly range its first and last day and a one-off range only in its year', () => {
    const closure = h({
      name: 'Year-end closure',
      ruleKind: 'RANGE',
      month: 12,
      day: 28,
      endMonth: 12,
      endDay: 31,
    });
    expect(expandYear([closure], 2026)[0]).toMatchObject({
      date: '2026-12-28',
      endDate: '2026-12-31',
    });
    const once = h({
      name: 'Office move',
      ruleKind: 'RANGE',
      yearly: false,
      onceDate: '2027-03-12',
      onceEnd: '2027-03-13',
    });
    expect(expandYear([once], 2026)).toEqual([]);
    expect(expandYear([once], 2027)[0]).toMatchObject({
      date: '2027-03-12',
      endDate: '2027-03-13',
    });
  });
  it('says the rule in words', () => {
    expect(ruleText(h({ month: 6, day: 19 }))).toBe('Every year, 06/19');
    expect(ruleText(h({ ruleKind: 'NTH_WEEKDAY', month: 11, nth: 4, weekday: 4 }))).toBe(
      'Every year, 4th Thursday of November',
    );
    expect(ruleText(h({ ruleKind: 'NTH_WEEKDAY', month: 5, nth: -1, weekday: 1 }))).toBe(
      'Every year, last Monday of May',
    );
    expect(ruleText(h({ ruleKind: 'EASTER_OFFSET', easterOffset: -2 }))).toBe(
      'Every year, 2 days before Easter',
    );
    expect(ruleText(h({ ruleKind: 'ONCE', onceDate: '2027-02-12', yearly: false }))).toBe(
      'One time',
    );
  });
});
