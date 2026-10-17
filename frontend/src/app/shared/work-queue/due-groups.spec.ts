import { groupRows } from './due-groups';

const COUNTS = { asap: 14, overdue: 9, today: 3, tomorrow: 0, thisWeek: 2, later: 5 };

describe('groupRows', () => {
  it('puts a header at the start of every bucket on the page and skips empty buckets', () => {
    const groups = groupRows(33, 0, COUNTS);
    expect(groups.map((g) => [g.key, g.start, g.length, g.count, g.continued])).toEqual([
      ['asap', 0, 14, 14, false],
      ['overdue', 14, 9, 9, false],
      ['today', 23, 3, 3, false],
      ['thisWeek', 26, 2, 2, false],
      ['later', 28, 5, 5, false],
    ]);
  });

  it('continues a bucket that began on an earlier page, with the whole count', () => {
    // Page 2 of 10: global rows 10 to 19 = 4 ASAP (continued), 6 Overdue.
    const groups = groupRows(10, 10, COUNTS);
    expect(groups.map((g) => [g.key, g.start, g.length, g.count, g.continued])).toEqual([
      ['asap', 0, 4, 14, true],
      ['overdue', 4, 6, 9, false],
    ]);
  });

  it('starts a page exactly on a bucket boundary without "continued"', () => {
    const groups = groupRows(5, 14, COUNTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'overdue', start: 0, length: 5, continued: false });
  });

  it('has no headers without counts or rows', () => {
    expect(groupRows(5, 0, null)).toEqual([]);
    expect(groupRows(0, 0, COUNTS)).toEqual([]);
  });
});
