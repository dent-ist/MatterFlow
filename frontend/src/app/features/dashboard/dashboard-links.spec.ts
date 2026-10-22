import { convertToParamMap } from '@angular/router';
import { buildChips, parseFilters } from '../../shared/filters/filter-def';
import { queueFilterDefs } from '../../shared/filters/queue-defs';
import { parseQueueState } from '../../shared/work-queue/queue-filters';
import {
  DUE_SOON_CAPTION,
  dueSoonThrough,
  queueArgsFor,
  queueParams,
  queueParamsSorted,
} from './dashboard-links';

describe('queueParams', () => {
  it('turns repeated keys into arrays and single keys into strings', () => {
    expect(queueParams('status=NEW&status=IN_PROGRESS&unassigned=true')).toEqual({
      status: ['NEW', 'IN_PROGRESS'],
      unassigned: 'true',
    });
  });

  it('keeps three or more repeats in order and decodes values', () => {
    expect(queueParams('status=NEW&status=IN_PROGRESS&status=ON_HOLD&dueTo=2026-10-16')).toEqual({
      status: ['NEW', 'IN_PROGRESS', 'ON_HOLD'],
      dueTo: '2026-10-16',
    });
    expect(queueParams('q=a%20b')).toEqual({ q: 'a b' });
  });

  it('returns no parameters for an empty query', () => {
    expect(queueParams('')).toEqual({});
    expect(queueParams(undefined)).toEqual({});
  });

  it('adds the sort of a list to its "View all" link', () => {
    expect(queueParamsSorted('status=NEW&unassigned=true', 'created', 'asc')).toEqual({
      status: 'NEW',
      unassigned: 'true',
      sort: 'created',
      dir: 'asc',
    });
  });
});

describe('queueArgsFor', () => {
  it('builds the Task Queue client arguments of a dashboard query, sorted and limited', () => {
    const args = queueArgsFor(
      'status=NEW&status=IN_PROGRESS&status=ON_HOLD&unassigned=true',
      'priorityAge',
      'asc',
      8,
    );
    expect(args[0]).toBeUndefined(); // group (only the Task Queue page asks for due buckets)
    expect(args[2]).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']); // status
    expect(args[7]).toBe(true); // unassigned
    expect(args.slice(32)).toEqual(['priorityAge', 'asc', 1, 8]);
  });

  it('carries overdue and the due-soon window', () => {
    const overdue = queueArgsFor('status=NEW&overdue=true', 'due', 'asc', 6);
    expect(overdue[19]).toBe(true);
    const soon = queueArgsFor(
      'status=NEW&asap=false&overdue=false&dueTo=2026-10-16',
      'due',
      'asc',
      6,
    );
    expect([soon[17], soon[18], soon[19]]).toEqual(['2026-10-16', false, false]);
  });
});

/**
 * Every query string the API puts behind a number, bar or segment must open the Task Queue with exactly those filters, and the queue must
 * show them as chips on arrival. The strings below are what DashboardRules produces (checked against the real Task Queue by the API tests).
 */
describe('every dashboard link opens the Task Queue with matching filters and chips', () => {
  const OPEN = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
  const ids = (n: number, label: (id: number) => string) =>
    Array.from({ length: n }, (_, i) => ({ value: String(i + 1), label: label(i + 1) }));
  const lookups = {
    statuses: ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((c) => ({
      value: c,
      label: c,
    })),
    priorities: ids(9, (id) => `P${id}`),
    pods: ids(9, (id) => `Pod ${id}`),
    users: ids(12, (id) => `User ${id}`),
    types: ids(12, (id) => `Type ${id}`),
  };
  /** What the shared filter bar shows as chips for a dashboard link (the bar's chips are built from these definitions). */
  const chipLabels = (query: string): string[] => {
    const defs = queueFilterDefs(lookups);
    const values = parseFilters(defs, convertToParamMap(queueParams(query)));
    return defs.flatMap((d) => buildChips(d, values[d.key], false)).map((c) => c.label);
  };

  const cases: [string, string, (s: ReturnType<typeof parseQueueState>) => void, string[]][] = [
    [
      'open',
      OPEN,
      (s) => expect(s.filters.status).toEqual(['NEW', 'IN_PROGRESS', 'ON_HOLD']),
      ['Status: Open'],
    ],
    [
      'unassigned',
      `${OPEN}&unassigned=true`,
      (s) => expect(s.filters.unassigned).toBe(true),
      ['Status: Open', 'Assignee: Unassigned'],
    ],
    [
      'overdue',
      `${OPEN}&overdue=true`,
      (s) => expect(s.filters.overdue).toBe(true),
      ['Status: Open', 'Overdue only'],
    ],
    [
      'on hold',
      'status=ON_HOLD',
      (s) => expect(s.filters.status).toEqual(['ON_HOLD']),
      ['Status: ON_HOLD'],
    ],
    [
      'ASAP open',
      `${OPEN}&asap=true`,
      (s) => expect(s.filters.asap).toBe(true),
      ['Status: Open', 'ASAP only'],
    ],
    [
      'due soon',
      `${OPEN}&asap=false&overdue=false&dueTo=2026-10-16`,
      (s) =>
        expect([s.filters.asap, s.filters.overdue, s.filters.dueTo]).toEqual([
          false,
          false,
          '2026-10-16',
        ]),
      ['Status: Open', 'Due: until Oct 16, 2026', 'Has a due date', 'Not overdue'],
    ],
    [
      'completed in the period',
      'status=COMPLETED&completedFrom=2026-09-15',
      (s) =>
        expect([s.filters.status, s.filters.completedFrom]).toEqual([['COMPLETED'], '2026-09-15']),
      ['Status: COMPLETED', 'Closed: from Sep 15, 2026'],
    ],
    [
      'created in the period',
      'createdFrom=2026-09-15',
      (s) => expect(s.filters.createdFrom).toBe('2026-09-15'),
      ['Created: from Sep 15, 2026'],
    ],
    [
      'created on one day (trend table)',
      'createdFrom=2026-10-12&createdTo=2026-10-12',
      (s) =>
        expect([s.filters.createdFrom, s.filters.createdTo]).toEqual(['2026-10-12', '2026-10-12']),
      ['Created: Oct 12, 2026'],
    ],
    [
      'completed on one day (trend table)',
      'status=COMPLETED&completedFrom=2026-10-12&completedTo=2026-10-12',
      (s) =>
        expect([s.filters.completedFrom, s.filters.completedTo]).toEqual([
          '2026-10-12',
          '2026-10-12',
        ]),
      ['Status: COMPLETED', 'Closed: Oct 12, 2026'],
    ],
    [
      'pod',
      `${OPEN}&pod=3`,
      (s) => expect(s.filters.pod).toEqual([3]),
      ['Status: Open', 'Pod: Pod 3'],
    ],
    [
      'other pods',
      `${OPEN}&pod=4&pod=5&pod=6`,
      (s) => expect(s.filters.pod).toEqual([4, 5, 6]),
      ['Status: Open', 'Pod: Pod 4', 'Pod: Pod 5', 'Pod: Pod 6'],
    ],
    [
      'priority',
      `${OPEN}&priority=2`,
      (s) => expect(s.filters.priority).toEqual([2]),
      ['Status: Open', 'Priority: P2'],
    ],
    [
      'task type',
      `${OPEN}&type=7`,
      (s) => expect(s.filters.type).toEqual([7]),
      ['Status: Open', 'Task type: Type 7'],
    ],
    [
      'other task types',
      `${OPEN}&type=8&type=9`,
      (s) => expect(s.filters.type).toEqual([8, 9]),
      ['Status: Open', 'Task type: Type 8', 'Task type: Type 9'],
    ],
    [
      'status bar',
      'status=IN_PROGRESS',
      (s) => expect(s.filters.status).toEqual(['IN_PROGRESS']),
      ['Status: IN_PROGRESS'],
    ],
    [
      'age 0-2 days',
      `${OPEN}&createdFrom=2026-10-12&createdTo=2026-10-14`,
      (s) =>
        expect([s.filters.createdFrom, s.filters.createdTo]).toEqual(['2026-10-12', '2026-10-14']),
      ['Status: Open', 'Created: Oct 12, 2026 to Oct 14, 2026'],
    ],
    [
      'age 15+ days',
      `${OPEN}&createdTo=2026-09-29`,
      (s) => expect([s.filters.createdFrom, s.filters.createdTo]).toEqual([null, '2026-09-29']),
      ['Status: Open', 'Created: until Sep 29, 2026'],
    ],
    [
      'my overdue',
      `${OPEN}&assignee=9&overdue=true`,
      (s) => expect([s.filters.assignee, s.filters.overdue]).toEqual([[9], true]),
      ['Status: Open', 'Assignee: User 9', 'Overdue only'],
    ],
    [
      'created by me',
      'creator=9&createdFrom=2026-09-15',
      (s) => expect([s.filters.creator, s.filters.createdFrom]).toEqual([[9], '2026-09-15']),
      ['Creator: User 9', 'Created: from Sep 15, 2026'],
    ],
  ];

  it.each(cases)('%s', (_name, query, check, chips) => {
    const state = parseQueueState(convertToParamMap(queueParams(query)));
    check(state);
    expect(chipLabels(query)).toEqual(chips);
  });
});

describe('Due soon wording (S4)', () => {
  it('is plain words for today and the next 2 days, and the last day comes from the query', () => {
    expect(DUE_SOON_CAPTION).toBe('Today and the next 2 days, not overdue, not ASAP');
    expect(dueSoonThrough('status=NEW&asap=false&overdue=false&dueTo=2026-10-18')).toBe(
      '2026-10-18',
    );
    expect(dueSoonThrough('status=NEW')).toBeNull();
    expect(dueSoonThrough('dueTo=soon')).toBeNull();
    expect(dueSoonThrough(null)).toBeNull();
  });
});
