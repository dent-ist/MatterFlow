import { bucketOrder, groupRows } from './due-groups';

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

  describe('Task Queue sorted by Due (#232)', () => {
    const QUEUE = { ...COUNTS, closed: 4 };

    it('lists Closed after Later, with the whole count', () => {
      const groups = groupRows(37, 0, QUEUE);
      expect(groups.map((g) => [g.key, g.start, g.count])).toEqual([
        ['asap', 0, 14],
        ['overdue', 14, 9],
        ['today', 23, 3],
        ['thisWeek', 26, 2],
        ['later', 28, 5],
        ['closed', 33, 4],
      ]);
    });

    it('mirrors the open buckets when descending and keeps Closed last', () => {
      expect(bucketOrder('desc').map((b) => b.key)).toEqual([
        'later',
        'thisWeek',
        'tomorrow',
        'today',
        'overdue',
        'asap',
        'closed',
      ]);
      const groups = groupRows(37, 0, QUEUE, 'desc');
      expect(groups.map((g) => [g.key, g.start])).toEqual([
        ['later', 0],
        ['thisWeek', 5],
        ['today', 7],
        ['overdue', 10],
        ['asap', 19],
        ['closed', 33],
      ]);
    });

    it('continues a bucket across pages the same way (page 2 of 10, 51 ASAP)', () => {
      const asap = { asap: 51, overdue: 101, today: 0, tomorrow: 0, thisWeek: 0, later: 0 };
      const page1 = groupRows(50, 0, asap);
      expect(page1.map((g) => [g.key, g.count, g.length, g.continued])).toEqual([
        ['asap', 51, 50, false],
      ]);
      const page2 = groupRows(50, 50, asap);
      expect(page2.map((g) => [g.key, g.count, g.length, g.continued])).toEqual([
        ['asap', 51, 1, true],
        ['overdue', 101, 49, false],
      ]);
    });
  });
});
