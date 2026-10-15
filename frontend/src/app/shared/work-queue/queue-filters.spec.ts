import { convertToParamMap } from '@angular/router';
import {
  BUILT_IN_VIEWS,
  ChipNames,
  OPEN_STATUSES,
  activeBuiltIn,
  buildChips,
  builtInFilters,
  dateDaysAgo,
  emptyFilters,
  emptyState,
  filterCount,
  hasFilters,
  parseQueueState,
  queueArgs,
  toQueryParams,
} from './queue-filters';

const names: ChipNames = {
  statusLabel: (c) => c,
  priorityLabel: (id) => `P${id}`,
  podName: (id) => `Pod ${id}`,
  userName: (id) => `User ${id}`,
  clientName: (id) => `Client ${id}`,
  matterName: (id) => `Matter ${id}`,
  projectName: (id) => `Project ${id}`,
  typeName: (id) => `Type ${id}`,
  workflowName: (id) => `Workflow ${id}`,
};

const parse = (params: Record<string, string | string[]>) =>
  parseQueueState(convertToParamMap(params));

describe('queue filter state', () => {
  it('reads a dashboard deep link: repeated status values and overdue', () => {
    const s = parse({ overdue: 'true', status: ['NEW', 'IN_PROGRESS'] });
    expect(s.filters.overdue).toBe(true);
    expect(s.filters.status).toEqual(['NEW', 'IN_PROGRESS']);
    expect(hasFilters(s.filters)).toBe(true);
    expect(s.page).toBe(1);
    expect(s.pageSize).toBe(50);
  });

  it('reads every parameter name of the Task Queue API', () => {
    const s = parse({
      q: ' dedup ',
      status: 'on_hold,COMPLETED',
      priority: ['1', '2'],
      pod: '4',
      noPod: 'true',
      assignee: '7',
      unassigned: 'true',
      creator: '8',
      client: '10',
      matter: '11',
      project: '12',
      type: '13',
      workflow: '14',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
      dueFrom: '2026-02-01',
      dueTo: '2026-02-28',
      asap: 'false',
      overdue: 'false',
      requestor: 'zed',
      completedFrom: '2026-03-01',
      completedTo: '2026-03-31',
      sort: 'due',
      dir: 'desc',
      page: '3',
      pageSize: '100',
    });
    expect(s.filters).toEqual({
      q: 'dedup',
      status: ['ON_HOLD', 'COMPLETED'],
      priority: [1, 2],
      pod: [4],
      noPod: true,
      assignee: [7],
      unassigned: true,
      creator: [8],
      client: 10,
      matter: 11,
      project: 12,
      type: [13],
      workflow: [14],
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
      dueFrom: '2026-02-01',
      dueTo: '2026-02-28',
      asap: false,
      overdue: false,
      requestor: 'zed',
      completedFrom: '2026-03-01',
      completedTo: '2026-03-31',
    });
    expect([s.sort, s.dir, s.page, s.pageSize]).toEqual(['due', 'desc', 3, 100]);
  });

  it('ignores malformed values instead of failing', () => {
    const s = parse({
      status: ['NOPE', 'NEW'],
      priority: ['x', '-1', '2'],
      dueFrom: '12/31/2026',
      asap: 'maybe',
      sort: 'title',
      dir: 'sideways',
      page: '-4',
      pageSize: '7',
    });
    expect(s.filters.status).toEqual(['NEW']);
    expect(s.filters.priority).toEqual([2]);
    expect(s.filters.dueFrom).toBeNull();
    expect(s.filters.asap).toBeNull();
    expect([s.sort, s.dir, s.page, s.pageSize]).toEqual([null, null, 1, 50]);
  });

  it('round-trips through the query string without losing anything', () => {
    const original = parse({
      status: ['NEW', 'ON_HOLD'],
      priority: ['2'],
      overdue: 'true',
      q: 'x',
      sort: 'created',
      dir: 'asc',
      page: '2',
      pageSize: '25',
      view: 'dueSoon',
      podId: '5',
    });
    const params = toQueryParams(original);
    const again = parseQueueState(
      convertToParamMap(
        Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null)) as Record<
          string,
          string | string[]
        >,
      ),
    );
    expect(again).toEqual(original);
  });

  it('drops defaults from the URL: page 1, the default page size and a direction without a sort', () => {
    const params = toQueryParams({ ...emptyState(), dir: 'desc' });
    expect(params['page']).toBeNull();
    expect(params['pageSize']).toBeNull();
    expect(params['dir']).toBeNull();
    expect(params['status']).toBeNull();
  });

  it('counts a repeated parameter or a date range as one filter', () => {
    const f = {
      ...emptyFilters(),
      status: ['NEW', 'ON_HOLD'],
      dueFrom: '2026-01-01',
      dueTo: '2026-02-01',
    };
    expect(filterCount(f)).toBe(2);
    expect(filterCount({ ...emptyFilters(), unassigned: true, assignee: [3] })).toBe(1);
    expect(filterCount({ ...emptyFilters(), noPod: true, pod: [3] })).toBe(1);
  });

  it('round-trips the No pod filter through the URL, the chips and the API arguments', () => {
    const state = parse({ noPod: 'true', status: 'NEW' });
    expect(state.filters.noPod).toBe(true);
    expect(toQueryParams(state)['noPod']).toBe('true');
    expect(
      toQueryParams({ ...state, filters: { ...state.filters, noPod: false } })['noPod'],
    ).toBeNull();
    expect(parse({ noPod: 'maybe' }).filters.noPod).toBe(false);

    expect(queueArgs(state)[4]).toBe(true);
    expect(queueArgs({ ...state, filters: { ...state.filters, noPod: false } })[4]).toBeUndefined();
    expect(queueArgs(state, { omitPod: true })[4]).toBeUndefined();

    const chips = buildChips(state.filters, names);
    expect(chips.map((c) => c.label)).toEqual(['Status: NEW', 'Pod: No pod']);
    expect(chips[1].remove(state.filters).noPod).toBe(false);
  });

  it('accepts the priorityAge sort used by the Dashboard', () => {
    expect(parse({ sort: 'priorityAge', dir: 'asc' }).sort).toBe('priorityAge');
  });
});

describe('filter chips', () => {
  it('has one removable chip per value, and removing it clears only that value', () => {
    const f = { ...emptyFilters(), priority: [1, 2], pod: [4], overdue: true as boolean | null };
    const chips = buildChips(f, names);
    expect(chips.map((c) => c.label)).toEqual([
      'Priority: P1',
      'Priority: P2',
      'Pod: Pod 4',
      'Overdue only',
    ]);

    const removed = chips[0].remove(f);
    expect(removed.priority).toEqual([2]);
    expect(removed.pod).toEqual([4]);
    expect(chips[3].remove(f).overdue).toBeNull();
  });

  it('shows the three open statuses as a single "Status: Open" chip', () => {
    const chips = buildChips({ ...emptyFilters(), status: [...OPEN_STATUSES] }, names);
    expect(chips.map((c) => c.label)).toEqual(['Status: Open']);
    expect(chips[0].remove({ ...emptyFilters(), status: [...OPEN_STATUSES] }).status).toEqual([]);
  });

  it('describes search, assignee, date ranges, asap and ids from a deep link', () => {
    const f = {
      ...emptyFilters(),
      q: 'dedup',
      unassigned: true,
      assignee: [7],
      client: 10,
      matter: 11,
      project: 12,
      type: [13],
      workflow: [14],
      createdFrom: '2026-01-01',
      dueTo: '2026-02-28',
      asap: false as boolean | null,
    };
    expect(buildChips(f, names).map((c) => c.label)).toEqual([
      'Search: dedup',
      'Assignee: User 7',
      'Assignee: Unassigned',
      'Client: Client 10',
      'Matter: Matter 11',
      'Project: Project 12',
      'Type: Type 13',
      'Workflow: Workflow 14',
      'Created: from Jan 1, 2026',
      'Due: until Feb 28, 2026',
      'Has a due date',
    ]);
  });
});

describe('built-in views', () => {
  const ctx = { userId: 9, primaryPodId: 5, recentFrom: '2026-09-14' };

  it('defines the six views of the baseline', () => {
    expect(BUILT_IN_VIEWS.map((v) => v.label)).toEqual([
      'All open',
      'Unassigned',
      'My pod',
      'Created by me',
      'Overdue',
      'Recently completed',
    ]);
  });

  it('maps each view to filters', () => {
    expect(builtInFilters('allOpen', ctx).status).toEqual(OPEN_STATUSES);
    expect(builtInFilters('unassigned', ctx)).toMatchObject({
      unassigned: true,
      status: OPEN_STATUSES,
    });
    expect(builtInFilters('myPod', ctx).pod).toEqual([5]);
    expect(builtInFilters('createdByMe', ctx).creator).toEqual([9]);
    expect(builtInFilters('overdue', ctx)).toMatchObject({ overdue: true, status: OPEN_STATUSES });
    expect(builtInFilters('recentlyCompleted', ctx)).toMatchObject({
      status: ['COMPLETED'],
      completedFrom: '2026-09-14',
    });
  });

  it('recognizes the active view whatever the order of the values', () => {
    expect(
      activeBuiltIn({ ...emptyFilters(), status: ['ON_HOLD', 'NEW', 'IN_PROGRESS'] }, ctx),
    ).toBe('allOpen');
    expect(activeBuiltIn(builtInFilters('overdue', ctx), ctx)).toBe('overdue');
    expect(activeBuiltIn({ ...builtInFilters('overdue', ctx), q: 'x' }, ctx)).toBeNull();
    expect(activeBuiltIn(emptyFilters(), ctx)).toBeNull();
  });
});

describe('API arguments', () => {
  it('passes only what is set, with the sort direction only when sorting', () => {
    const state = { ...emptyState(), page: 2, pageSize: 25 };
    const args = queueArgs(state);
    expect(args.slice(0, 22).every((a) => a === undefined)).toBe(true);
    expect(args.slice(22)).toEqual([undefined, undefined, 2, 25]);

    const sorted = queueArgs({
      ...state,
      sort: 'due',
      dir: 'desc',
      filters: { ...emptyFilters(), q: 'x', status: ['NEW'], overdue: true, asap: false },
    });
    expect(sorted[0]).toBe('x');
    expect(sorted[1]).toEqual(['NEW']);
    expect(sorted[17]).toBe(false); // asap
    expect(sorted[18]).toBe(true); // overdue
    expect(sorted.slice(22)).toEqual(['due', 'desc', 2, 25]);
  });

  it('can leave the pod filter out (Pod Work has its own Pod)', () => {
    const state = { ...emptyState(), filters: { ...emptyFilters(), pod: [4] } };
    expect(queueArgs(state)[3]).toEqual([4]);
    expect(queueArgs(state, { omitPod: true })[3]).toBeUndefined();
  });
});

describe('dateDaysAgo', () => {
  it('uses the viewer zone calendar', () => {
    const now = new Date('2026-10-14T03:00:00Z'); // still Oct 13 in Chicago
    expect(dateDaysAgo(now, 30, 'America/Chicago')).toBe('2026-09-13');
    expect(dateDaysAgo(now, 30, 'UTC')).toBe('2026-09-14');
  });
});
