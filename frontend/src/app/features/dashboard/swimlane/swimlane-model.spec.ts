import { convertToParamMap } from '@angular/router';
import { SwimlaneBoard, SwimlaneGroup, SwimlaneLane } from '../../../api/generated/api-client';
import {
  DEFAULT_VIEW,
  GroupNode,
  LaneModel,
  SwimlaneView,
  ageInDays,
  allGroupKeys,
  applyRow,
  buildLane,
  cardToRow,
  clearedViewParams,
  filterCount,
  hasViewParams,
  laneOf,
  laneQueueParams,
  sameView,
  viewFromParams,
  viewToParams,
  withCard,
} from './swimlane-model';
import { aCard, aLane, counts } from './swimlane-testing';

const tree: SwimlaneGroup[] = [
  {
    key: 'client:10',
    kind: 'client',
    id: 10,
    label: 'Acme Corp',
    clientNumber: '00010',
    matterRef: undefined,
    color: undefined,
    rank: undefined,
    count: 3,
    counts: counts(3),
    children: [
      {
        key: 'matter:100',
        kind: 'matter',
        id: 100,
        label: 'Merger',
        clientNumber: '00010',
        matterRef: '00010-00001',
        color: undefined,
        rank: undefined,
        count: 2,
        counts: counts(2),
        children: [],
      },
      {
        key: 'matter:101',
        kind: 'matter',
        id: 101,
        label: 'Audit',
        clientNumber: '00010',
        matterRef: '00010-00002',
        color: undefined,
        rank: undefined,
        count: 1,
        counts: counts(1),
        children: [],
      },
    ],
  },
  {
    key: 'client:11',
    kind: 'client',
    id: 11,
    label: 'Zed Ltd',
    clientNumber: '00011',
    matterRef: undefined,
    color: undefined,
    rank: undefined,
    count: 1,
    counts: counts(1),
    children: [
      {
        key: 'matter:110',
        kind: 'matter',
        id: 110,
        label: 'Lease',
        clientNumber: '00011',
        matterRef: '00011-00001',
        color: undefined,
        rank: undefined,
        count: 1,
        counts: counts(1),
        children: [],
      },
    ],
  },
];

const NOW = new Date('2026-10-15T15:00:00Z');
const build = (
  lane: SwimlaneLane,
  by: Parameters<typeof buildLane>[1],
  groups: SwimlaneGroup[],
  collapsed: string[] = [],
): LaneModel => buildLane(lane, by, groups, new Set(collapsed), NOW, 'UTC');
const shape = (m: LaneModel) =>
  m.rows.map((r) =>
    r.type === 'group' ? `G${r.node.level}:${r.node.key}` : `C${r.level}:${r.card.taskId}`,
  );

describe('swimlane view and address', () => {
  it('reads the view from the address with the remembered choices as the fallback for the display choices only', () => {
    const fallback = { groupBy: 'priority', sort: 'due', days: 14 } as const;
    expect(viewFromParams(convertToParamMap({}), fallback)).toEqual({
      ...DEFAULT_VIEW,
      groupBy: 'priority',
      sort: 'due',
      days: 14,
    });
    const v = viewFromParams(
      convertToParamMap({
        group: 'clientMatter',
        sort: 'created',
        days: '30',
        q: ' acme ',
        pod: '4', // the page-wide scope now, not a filter of the board
        assignee: 'unassigned',
        type: '7',
        priority: '2',
        overdue: 'true',
        mine: 'true',
      }),
      fallback,
    );
    expect(v).toEqual({
      groupBy: 'clientMatter',
      sort: 'created',
      days: 30,
      q: 'acme',
      assignee: 'unassigned',
      type: 7,
      priority: 2,
      overdue: true,
      mine: true,
    });
  });

  it('ignores invalid values instead of passing them on to the server', () => {
    const v = viewFromParams(
      convertToParamMap({
        group: 'bogus',
        sort: 'x',
        days: '99',
        pod: 'abc',
        assignee: '1;drop',
        type: '-3',
        priority: '0',
        overdue: 'yes',
      }),
      { groupBy: 'none', sort: 'priority', days: 7 },
    );
    expect(v).toEqual(DEFAULT_VIEW);
  });

  it('writes the display choices always and a data filter only when it is set', () => {
    expect(viewToParams(DEFAULT_VIEW)).toEqual({
      group: 'none',
      sort: 'priority',
      days: '7',
      q: null,
      assignee: null,
      type: null,
      priority: null,
      overdue: null,
      mine: null,
    });
    const full: SwimlaneView = {
      groupBy: 'assignee',
      sort: 'due',
      days: 14,
      q: 'x',
      assignee: '5',
      type: 2,
      priority: 3,
      overdue: true,
      mine: true,
    };
    expect(viewToParams(full)).toEqual({
      group: 'assignee',
      sort: 'due',
      days: '14',
      q: 'x',
      assignee: '5',
      type: '2',
      priority: '3',
      overdue: 'true',
      mine: 'true',
    });
    expect(
      viewFromParams(convertToParamMap(viewToParams(full) as Record<string, string>), DEFAULT_VIEW),
    ).toEqual(full);
  });

  it('clears every board parameter when another tab is chosen, and counts the filters on', () => {
    expect(Object.values(clearedViewParams()).every((v) => v === null)).toBe(true);
    expect(Object.keys(clearedViewParams())).toEqual(Object.keys(viewToParams(DEFAULT_VIEW)));
    expect(hasViewParams(convertToParamMap({ tab: 'swimlane' }))).toBe(false);
    expect(hasViewParams(convertToParamMap({ tab: 'swimlane', group: 'none' }))).toBe(true);
    expect(filterCount(DEFAULT_VIEW)).toBe(0);
    expect(filterCount({ ...DEFAULT_VIEW, priority: 2, overdue: true, mine: true, q: 'abc' })).toBe(
      2,
    );
    expect(sameView(DEFAULT_VIEW, { ...DEFAULT_VIEW })).toBe(true);
    expect(sameView(DEFAULT_VIEW, { ...DEFAULT_VIEW, q: 'x' })).toBe(false);
  });
});

describe('buildLane', () => {
  const cards = [
    aCard({ taskId: 1, createdAtUtc: '2026-10-05T12:00:00Z' }),
    aCard({
      taskId: 2,
      matterId: 101,
      matterRef: '00010-00002',
      matterName: 'Audit',
      priority: { priorityId: 1, label: 'Critical', color: 'critical', rank: 1 },
    }),
    aCard({
      taskId: 3,
      clientId: 11,
      clientName: 'Zed Ltd',
      matterId: 110,
      matterRef: '00011-00001',
      matterName: 'Lease',
      assignee: {
        userId: 9,
        displayName: 'Tariq Malik',
        isActive: true,
        availability: { state: 'OUT_OF_OFFICE', outUntil: undefined, note: undefined },
      },
    }),
    aCard({ taskId: 4, matterId: 100 }),
  ];

  it('keeps the server order without grouping and reports the oldest card age', () => {
    const m = build(aLane('NEW', cards), 'none', []);
    expect(shape(m)).toEqual(['C0:1', 'C0:2', 'C0:3', 'C0:4']);
    expect(m.oldestDays).toBe(10);
    expect(m.count).toBe(4);
    expect(build(aLane('NEW', []), 'none', []).oldestDays).toBeNull();
  });

  it('builds the client > matter tree: client (level 1), matter (level 2), cards (level 3), in the order of the groups, with exact counts', () => {
    const m = build(aLane('NEW', cards), 'clientMatter', tree);
    expect(shape(m)).toEqual([
      'G1:client:10',
      'G2:matter:100',
      'C3:1',
      'C3:4',
      'G2:matter:101',
      'C3:2',
      'G1:client:11',
      'G2:matter:110',
      'C3:3',
    ]);
    const groups = m.rows
      .filter((r) => r.type === 'group')
      .map((r) => (r as { node: GroupNode }).node);
    expect(groups.map((g) => g.count)).toEqual([3, 2, 1, 1, 1]);
    expect(groups[0]).toMatchObject({ kind: 'client', clientNumber: '00010', label: 'Acme Corp' });
    expect(groups[1]).toMatchObject({ kind: 'matter', matterRef: '00010-00001' });
  });

  it('leaves out a client or matter that has no card in the lane, and a collapsed node hides everything below it', () => {
    const lane = aLane('NEW', [cards[2]]);
    expect(shape(build(lane, 'clientMatter', tree))).toEqual([
      'G1:client:11',
      'G2:matter:110',
      'C3:3',
    ]);
    expect(shape(build(aLane('NEW', cards), 'clientMatter', tree, ['client:10']))).toEqual([
      'G1:client:10',
      'G1:client:11',
      'G2:matter:110',
      'C3:3',
    ]);
    expect(shape(build(aLane('NEW', cards), 'clientMatter', tree, ['matter:100']))).toContain(
      'G2:matter:100',
    );
    expect(shape(build(aLane('NEW', cards), 'clientMatter', tree, ['matter:100']))).not.toContain(
      'C3:1',
    );
    const collapsed = build(aLane('NEW', cards), 'clientMatter', tree, ['client:10']).rows[0];
    expect(collapsed).toMatchObject({ type: 'group', expanded: false });
  });

  it('groups by priority in the order the API gives (rank) and by assignee with the Unassigned group last', () => {
    const priorityGroups = [
      {
        key: 'priority:1',
        kind: 'priority',
        id: 1,
        label: 'Critical',
        color: 'critical',
        rank: 1,
        count: 1,
        counts: counts(1),
        children: [],
        clientNumber: undefined,
        matterRef: undefined,
      },
      {
        key: 'priority:2',
        kind: 'priority',
        id: 2,
        label: 'High',
        color: 'high',
        rank: 2,
        count: 3,
        counts: counts(3),
        children: [],
        clientNumber: undefined,
        matterRef: undefined,
      },
    ] as SwimlaneGroup[];
    expect(shape(build(aLane('NEW', cards), 'priority', priorityGroups))).toEqual([
      'G1:priority:1',
      'C1:2',
      'G1:priority:2',
      'C1:1',
      'C1:3',
      'C1:4',
    ]);

    const assigneeGroups = [
      {
        key: 'assignee:9',
        kind: 'assignee',
        id: 9,
        label: 'Tariq Malik',
        counts: counts(1),
        count: 1,
        children: [],
        color: undefined,
        rank: undefined,
        clientNumber: undefined,
        matterRef: undefined,
      },
      {
        key: 'assignee:unassigned',
        kind: 'assignee',
        id: undefined,
        label: 'Unassigned',
        counts: counts(3),
        count: 3,
        children: [],
        color: undefined,
        rank: undefined,
        clientNumber: undefined,
        matterRef: undefined,
      },
    ] as SwimlaneGroup[];
    const m = build(aLane('NEW', cards), 'assignee', assigneeGroups);
    expect(shape(m)).toEqual([
      'G1:assignee:9',
      'C1:3',
      'G1:assignee:unassigned',
      'C1:1',
      'C1:2',
      'C1:4',
    ]);
    const first = m.rows[0] as { node: GroupNode };
    expect(first.node.assignee?.availability.state).toBe('OUT_OF_OFFICE');
  });

  it('uses the lane of the right column for the count of a group, and lists every key for Collapse all', () => {
    const inProgress = build(aLane('IN_PROGRESS', [cards[0]]), 'clientMatter', [
      { ...tree[0], counts: counts(0, 5) },
    ]);
    expect((inProgress.rows[0] as { node: GroupNode }).node.count).toBe(5);
    expect(allGroupKeys(tree)).toEqual([
      'client:10',
      'matter:100',
      'matter:101',
      'client:11',
      'matter:110',
    ]);
  });

  it('marks a capped lane as truncated with the loaded and exact numbers', () => {
    const m = build(aLane('NEW', cards, { count: 230, total: 230, truncated: true }), 'none', []);
    expect(m).toMatchObject({ truncated: true, count: 230, loaded: 4 });
  });

  it('measures age in whole calendar days in the viewer zone', () => {
    expect(ageInDays('2026-10-15T01:00:00Z', NOW, 'UTC')).toBe(0);
    expect(ageInDays('2026-10-14T23:00:00Z', NOW, 'UTC')).toBe(1);
    expect(
      ageInDays('2026-10-15T01:00:00Z', new Date('2026-10-15T15:00:00Z'), 'America/New_York'),
    ).toBe(1);
    expect(ageInDays('2026-10-20T00:00:00Z', NOW, 'UTC')).toBe(0);
  });
});

describe('cards and the inline menus', () => {
  it('maps a card to a queue row and an edited row back onto the card', () => {
    const card = aCard({
      assignee: {
        userId: 9,
        displayName: 'Tariq Malik',
        isActive: true,
        availability: { state: 'OUT_OF_OFFICE', outUntil: undefined, note: 'Leave' },
      },
    });
    const row = cardToRow(card);
    expect(row).toMatchObject({
      taskId: 1,
      taskNumber: 'TSK-1',
      status: 'NEW',
      rowVersion: 'AAAA',
    });
    expect(row.priority).toEqual({ priorityId: 2, label: 'High', color: 'high', sortOrder: 2 });
    expect(row.assignedUser?.displayName).toBe('Tariq Malik');

    const edited = applyRow(card, {
      ...row,
      status: 'IN_PROGRESS',
      statusLabel: 'In Progress',
      priority: { priorityId: 1, label: 'Critical', color: 'critical', sortOrder: 1 },
      rowVersion: 'BBBB',
      isAsap: false,
    });
    expect(edited).toMatchObject({
      status: 'IN_PROGRESS',
      statusLabel: 'In Progress',
      rowVersion: 'BBBB',
      isAsap: false,
    });
    expect(edited.priority).toEqual({
      priorityId: 1,
      label: 'Critical',
      color: 'critical',
      rank: 1,
    });
    // The same person keeps the availability the server sent; a new person's is unknown until the board is read again.
    expect(edited.assignee?.availability.state).toBe('OUT_OF_OFFICE');
    const other = applyRow(card, {
      ...row,
      assignedUser: { userId: 4, displayName: 'Ana', isActive: true },
    });
    expect(other.assignee).toMatchObject({ userId: 4, availability: { state: 'UNKNOWN' } });
    expect(applyRow(card, { ...row, assignedUser: undefined }).assignee).toBeUndefined();
  });

  it('files cancelled tasks in the Completed lane', () => {
    expect(['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map(laneOf)).toEqual([
      'NEW',
      'IN_PROGRESS',
      'ON_HOLD',
      'COMPLETED',
      'COMPLETED',
    ]);
  });

  const board = (): SwimlaneBoard =>
    ({
      timeZone: 'UTC',
      generatedAtUtc: '2026-10-15T15:00:00Z',
      completedDays: 7,
      completedFrom: '2026-10-09',
      groupBy: 'none',
      sort: 'priority',
      laneCap: 200,
      groups: [],
      lanes: [
        aLane('NEW', [aCard({ taskId: 1 }), aCard({ taskId: 2 })]),
        aLane('IN_PROGRESS', [aCard({ taskId: 3, status: 'IN_PROGRESS' })]),
        aLane('ON_HOLD', []),
        aLane('COMPLETED', []),
      ],
    }) as SwimlaneBoard;

  it('replaces a card in place while an edit is only optimistic, and moves it with the counts once the server accepted it', () => {
    const b = board();
    const changed = aCard({
      taskId: 2,
      status: 'IN_PROGRESS',
      statusLabel: 'In Progress',
      rowVersion: 'BBBB',
    });
    const inPlace = withCard(b, changed, false);
    expect(inPlace.lanes[0].cards.map((c) => c.status)).toEqual(['NEW', 'IN_PROGRESS']);
    expect(inPlace.lanes[0].count).toBe(2);

    const moved = withCard(b, changed, true);
    expect(moved.lanes[0].cards.map((c) => c.taskId)).toEqual([1]);
    expect(moved.lanes[0].count).toBe(1);
    expect(moved.lanes[1].cards.map((c) => c.taskId)).toEqual([2, 3]);
    expect(moved.lanes[1].count).toBe(2);
    expect(withCard(b, aCard({ taskId: 99 }))).toBe(b);

    const done = withCard(b, aCard({ taskId: 3, status: 'CANCELLED', statusLabel: 'Cancelled' }));
    expect(done.lanes[3].cards.map((c) => c.taskId)).toEqual([3]);
    expect(done.lanes[3].count).toBe(1);
  });
});

describe('Task Queue link of a truncated lane', () => {
  it('carries the lane statuses and the board filters', () => {
    const v: SwimlaneView = {
      ...DEFAULT_VIEW,
      q: 'acme',
      assignee: '9',
      type: 2,
      priority: 3,
      overdue: true,
    };
    expect(laneQueueParams(v, 'NEW', '2026-10-09', 1)).toEqual({
      status: ['NEW'],
      q: 'acme',
      assignee: '9',
      type: '2',
      priority: '3',
      overdue: 'true',
    });
    // Under a Pod scope the link carries the scope's Pods (the lane count is about them).
    expect(laneQueueParams(DEFAULT_VIEW, 'NEW', '', 1, ['4', '7'])).toEqual({
      status: ['NEW'],
      pod: ['4', '7'],
    });
    expect(laneQueueParams(DEFAULT_VIEW, 'COMPLETED', '2026-10-09', 1)).toEqual({
      status: ['COMPLETED', 'CANCELLED'],
      completedFrom: '2026-10-09',
    });
    expect(laneQueueParams({ ...DEFAULT_VIEW, mine: true }, 'ON_HOLD', '', 17)).toEqual({
      status: ['ON_HOLD'],
      assignee: '17',
    });
    expect(laneQueueParams({ ...DEFAULT_VIEW, assignee: 'unassigned' }, 'NEW', '', 17)).toEqual({
      status: ['NEW'],
      unassigned: 'true',
    });
  });
});
