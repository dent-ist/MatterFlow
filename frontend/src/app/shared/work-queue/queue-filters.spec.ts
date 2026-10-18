import { convertToParamMap } from '@angular/router';
import { queueParams } from '../../features/dashboard/dashboard-links';
import { RECENT_WINDOW_DAYS } from './work-vocabulary';
import {
  BUILT_IN_VIEWS,
  OPEN_STATUSES,
  VIEW_OWNED,
  ViewContext,
  activeBuiltIn,
  availableViews,
  builtInFilters,
  matchBuiltIn,
  dateDaysAgo,
  emptyFilters,
  emptyState,
  filterCount,
  hasFilters,
  parseQueueState,
  queueArgs,
  toQueryParams,
} from './queue-filters';

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
      matterText: '',
      clientText: '',
      projectText: '',
      updatedFrom: null,
      updatedTo: null,
    });
    expect([s.sort, s.dir, s.page, s.pageSize]).toEqual(['due', 'desc', 3, 100]);
  });

  it('ignores malformed values instead of failing', () => {
    const s = parse({
      status: ['NOPE', 'NEW'],
      priority: ['x', '-1', '2'],
      dueFrom: '12/31/2026',
      asap: 'maybe',
      sort: 'bogus',
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

  it('reads new=1 as the New flag and writes the flag, never an instant (A5)', () => {
    const state = parse({ new: '1' });
    expect(state.newOnly).toBe(true);
    expect(toQueryParams(state)['new']).toBe('1');
    expect(toQueryParams({ ...state, newOnly: false })['new']).toBeNull();
    expect(parse({ new: '2026-10-10T00:00:00Z' }).newOnly).toBe(false);
  });

  it('reads closed=all as the explicit all-time Closed window and writes it back (C4)', () => {
    const state = parse({ view: 'completed', closed: 'all' });
    expect(state.closedAll).toBe(true);
    expect(state.filters.completedFrom).toBeNull();
    expect(toQueryParams(state)['closed']).toBe('all');
    expect(parse({ view: 'completed', closed: 'nope' }).closedAll).toBe(false);
    expect(toQueryParams(emptyState())['closed']).toBeNull();
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
  });

  it('accepts the priorityAge sort used by the Dashboard', () => {
    expect(parse({ sort: 'priorityAge', dir: 'asc' }).sort).toBe('priorityAge');
  });
});

describe('column text and updated filters', () => {
  it('round-trips the Matter, Client and Project text filters and the Updated range through the URL and the API arguments', () => {
    const state = parse({
      matterText: ' 343-12 ',
      clientText: 'Acme',
      projectText: 'Phase 1',
      updatedFrom: '2026-10-01',
      updatedTo: '2026-10-07',
    });
    expect(state.filters.matterText).toBe('343-12');
    expect(state.filters.updatedTo).toBe('2026-10-07');
    expect(filterCount(state.filters)).toBe(4);

    const params = toQueryParams(state);
    expect(params['matterText']).toBe('343-12');
    expect(params['clientText']).toBe('Acme');
    expect(params['projectText']).toBe('Phase 1');
    expect(params['updatedFrom']).toBe('2026-10-01');
    expect(params['updatedTo']).toBe('2026-10-07');

    // The positional arguments of the generated client, in order: ..., completedTo, matterText, clientText, projectText, updatedFrom, updatedTo, sort.
    const args = queueArgs(state);
    expect(args.slice(20, 27)).toEqual([
      undefined,
      undefined,
      '343-12',
      'Acme',
      'Phase 1',
      '2026-10-01',
      '2026-10-07',
    ]);
  });

  it('ignores a malformed updated date and writes nothing for empty text', () => {
    const state = parse({ updatedFrom: 'yesterday', matterText: '   ' });
    expect(state.filters.updatedFrom).toBeNull();
    expect(toQueryParams(state)['matterText']).toBeNull();
    expect(toQueryParams(state)['updatedFrom']).toBeNull();
  });
});

describe('explicit status', () => {
  it('writes an empty status as "status=" only when the page starts on a default status', () => {
    const state = emptyState();
    expect(toQueryParams(state)['status']).toBeNull();
    expect(toQueryParams(state, { explicitStatus: true })['status']).toBe('');
    expect(
      toQueryParams(
        { ...state, filters: { ...state.filters, status: ['NEW'] } },
        { explicitStatus: true },
      )['status'],
    ).toEqual(['NEW']);
  });
});

describe('built-in views', () => {
  const ctx: ViewContext = {
    userId: 9,
    primaryPodId: 5,
    recentFrom: '2026-09-18',
    dueSoonTo: '2026-10-19',
    canCreate: true,
  };

  it('defines the views in the order of the row, the Dashboard tiles first', () => {
    expect(BUILT_IN_VIEWS.map((v) => v.label)).toEqual([
      'All open',
      'Unassigned',
      'Overdue',
      'Due soon',
      'ASAP',
      'On hold',
      'My pod',
      'Created by me',
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
    // Created by me starts on Open like My Work's (#222).
    expect(builtInFilters('createdByMe', ctx)).toMatchObject({
      creator: [9],
      status: OPEN_STATUSES,
    });
    expect(builtInFilters('overdue', ctx)).toMatchObject({ overdue: true, status: OPEN_STATUSES });
    expect(builtInFilters('dueSoon', ctx)).toMatchObject({
      status: OPEN_STATUSES,
      asap: false,
      overdue: false,
      dueTo: '2026-10-19',
      dueFrom: null,
    });
    expect(builtInFilters('asap', ctx)).toMatchObject({ asap: true, status: OPEN_STATUSES });
    expect(builtInFilters('onHold', ctx)).toMatchObject({ status: ['ON_HOLD'] });
    expect(builtInFilters('recentlyCompleted', ctx)).toMatchObject({
      status: ['COMPLETED'],
      completedFrom: '2026-09-18',
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

  it('offers My pod only with a primary Pod and Created by me only with Task.Create (#223)', () => {
    const keys = (c: ViewContext) => availableViews(c).map((v) => v.key);
    expect(keys(ctx)).toContain('myPod');
    expect(keys(ctx)).toContain('createdByMe');
    expect(keys({ ...ctx, primaryPodId: null })).not.toContain('myPod');
    expect(keys({ ...ctx, canCreate: false })).not.toContain('createdByMe');
    expect(keys({ ...ctx, primaryPodId: null, canCreate: false })).toEqual([
      'allOpen',
      'unassigned',
      'overdue',
      'dueSoon',
      'asap',
      'onHold',
      'recentlyCompleted',
    ]);
    // A hidden view is never pressed: its link stays a plain filter.
    const mine = builtInFilters('createdByMe', ctx);
    expect(activeBuiltIn(mine, { ...ctx, canCreate: false })).toBeNull();
    expect(matchBuiltIn(mine, { ...ctx, canCreate: false })).toBeNull();
  });
});

describe('matching a link to a view by shape (#221)', () => {
  const ctx: ViewContext = {
    userId: 9,
    primaryPodId: 5,
    recentFrom: '2026-09-18',
    dueSoonTo: '2026-10-19',
    canCreate: true,
  };
  const link = (query: string) => parseQueueState(convertToParamMap(queueParams(query))).filters;

  it('matches the Dashboard links of the tiles', () => {
    const open = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
    const cases: [string, string][] = [
      [open, 'allOpen'],
      [`${open}&unassigned=true`, 'unassigned'],
      [`${open}&overdue=true`, 'overdue'],
      [`${open}&asap=false&overdue=false&dueTo=2026-10-19`, 'dueSoon'],
      [`${open}&asap=true`, 'asap'],
      ['status=ON_HOLD', 'onHold'],
    ];
    for (const [query, key] of cases) {
      expect(matchBuiltIn(link(query), ctx), query).toEqual({ key, extra: false });
    }
  });

  it('matches on shape, not on the date: only dueTo of today plus 2 is Due soon', () => {
    const open = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=false&overdue=false';
    expect(matchBuiltIn(link(`${open}&dueTo=2026-10-19`), ctx)?.key).toBe('dueSoon');
    // Three days out, or yesterday's window: a plain filter.
    expect(matchBuiltIn(link(`${open}&dueTo=2026-10-20`), ctx)).toBeNull();
    expect(matchBuiltIn(link(`${open}&dueTo=2026-10-18`), ctx)).toBeNull();
    // Tomorrow the same link is no longer Due soon; with tomorrow's context it is.
    expect(
      matchBuiltIn(link(`${open}&dueTo=2026-10-19`), { ...ctx, dueSoonTo: '2026-10-20' }),
    ).toBe(null);
  });

  it('keeps an extra filter on top of the view as an extra', () => {
    const query =
      'status=NEW&status=IN_PROGRESS&status=ON_HOLD&asap=false&overdue=false&dueTo=2026-10-19&priority=1';
    expect(matchBuiltIn(link(query), ctx)).toEqual({ key: 'dueSoon', extra: true });
    // A second bound of the Due range is not the view's: a plain filter.
    expect(matchBuiltIn(link(`${query}&dueFrom=2026-10-18`), ctx)).toBeNull();
  });

  it('leaves everything else alone, All open included', () => {
    expect(matchBuiltIn(link('priority=1'), ctx)).toBeNull();
    expect(matchBuiltIn(link('status=NEW&priority=1'), ctx)).toBeNull();
    // Open statuses with a priority are not "All open": it matches exactly only.
    expect(
      matchBuiltIn(link('status=NEW&status=IN_PROGRESS&status=ON_HOLD&priority=1'), ctx),
    ).toBeNull();
    expect(matchBuiltIn(link('status=COMPLETED&completedFrom=2026-09-17'), ctx)).toBeNull();
    expect(matchBuiltIn(link('status=COMPLETED&completedFrom=2026-09-18'), ctx)?.key).toBe(
      'recentlyCompleted',
    );
  });

  it('prefers the more specific view when a link fits two', () => {
    const open = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
    expect(matchBuiltIn(link(`${open}&unassigned=true&overdue=true`), ctx)?.key).toBe('unassigned');
    expect(matchBuiltIn(link(`${open}&overdue=true&asap=true`), ctx)?.key).toBe('overdue');
  });

  it('names the owned filters of every view', () => {
    expect(VIEW_OWNED.dueSoon).toEqual(['status', 'asap', 'overdue', 'due']);
    expect(VIEW_OWNED.createdByMe).toEqual(['status', 'creator']);
  });
});

describe('API arguments', () => {
  it('passes only what is set, with the sort direction only when sorting', () => {
    const state = { ...emptyState(), page: 2, pageSize: 25 };
    const args = queueArgs(state);
    expect(args.slice(0, 27).every((a) => a === undefined)).toBe(true);
    expect(args.slice(27)).toEqual([undefined, undefined, 2, 25]);

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
    expect(sorted.slice(27)).toEqual(['due', 'desc', 2, 25]);
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

  it('starts the 30 day window 29 days back, like the Dashboard Completed tile (BUG-TQ7)', () => {
    // Oct 17 minus 29 days is Sep 18 (30 days with today); Sep 17 is out.
    const now = new Date('2026-10-17T18:00:00Z');
    expect(dateDaysAgo(now, RECENT_WINDOW_DAYS - 1, 'America/New_York')).toBe('2026-09-18');
    expect(dateDaysAgo(now, RECENT_WINDOW_DAYS - 1, 'UTC')).toBe('2026-09-18');
    // Auckland is already on Oct 18 (07:00): its own 30 days start on Sep 19.
    expect(dateDaysAgo(now, RECENT_WINDOW_DAYS - 1, 'Pacific/Auckland')).toBe('2026-09-19');
  });

  it('follows the zone: the same instant is another day in Auckland', () => {
    const now = new Date('2026-10-17T18:00:00Z'); // Oct 18, 07:00 in Auckland
    expect(dateDaysAgo(now, 0, 'America/New_York')).toBe('2026-10-17');
    expect(dateDaysAgo(now, 0, 'Pacific/Auckland')).toBe('2026-10-18');
    expect(dateDaysAgo(now, 29, 'Pacific/Auckland')).toBe('2026-09-19');
    expect(dateDaysAgo(now, -2, 'Pacific/Auckland')).toBe('2026-10-20');
  });

  it('counts calendar days across a daylight saving change', () => {
    // New York leaves daylight saving on Nov 1 2026, 02:00: Nov 3 minus 29 days spans the 25 hour day.
    expect(dateDaysAgo(new Date('2026-11-03T05:30:00Z'), 29, 'America/New_York')).toBe(
      '2026-10-05',
    );
    // Just after midnight local: 23:30 the evening before, never a day off.
    expect(dateDaysAgo(new Date('2026-11-02T05:10:00Z'), 29, 'America/New_York')).toBe(
      '2026-10-04',
    );
    // Auckland starts daylight saving on Sep 27 2026 (a 23 hour day).
    expect(dateDaysAgo(new Date('2026-10-20T11:30:00Z'), 29, 'Pacific/Auckland')).toBe(
      '2026-09-22',
    );
    expect(dateDaysAgo(new Date('2026-09-27T12:30:00Z'), 1, 'Pacific/Auckland')).toBe('2026-09-27');
    // Looking ahead over the change: today plus 2 in New York on Oct 30.
    expect(dateDaysAgo(new Date('2026-10-30T12:00:00Z'), -2, 'America/New_York')).toBe(
      '2026-11-01',
    );
  });
});
