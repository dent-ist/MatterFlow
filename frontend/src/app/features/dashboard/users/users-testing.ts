import {
  SkillsMatrix,
  CoverageBoard,
  CoverageUser,
  WorkloadBoard,
  WorkloadPriority,
  WorkloadUser,
} from '../../../api/generated/api-client';

/** Builders for the Users tab specs. */
export const LEGEND: WorkloadPriority[] = [
  { priorityId: 1, label: 'Critical', color: 'critical', rank: 1 },
  { priorityId: 2, label: 'High', color: 'high', rank: 2 },
  { priorityId: 3, label: 'Normal', color: 'normal', rank: 3 },
  { priorityId: 4, label: 'Low', color: 'low', rank: 4 },
];

/** A user from the open task counts per legend priority (critical, high, normal, low); everything else is derived. */
export function aUser(
  id: number,
  name: string,
  counts: [number, number, number, number] = [0, 0, 0, 0],
  overrides: Partial<WorkloadUser> = {},
): WorkloadUser {
  const total = counts.reduce((a, b) => a + b, 0);
  const top = counts.findIndex((c) => c > 0);
  const words = name.split(' ');
  return {
    userId: id,
    displayName: name,
    initials: (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase(),
    pods: [{ podId: 1, name: 'Pod A', isPrimary: true }],
    availability: { state: 'AVAILABLE', outUntil: undefined, note: undefined },
    byPriority: LEGEND.map((p, i) => ({ priorityId: p.priorityId, count: counts[i] })),
    openTotal: total,
    overdue: 0,
    dueSoon: 0,
    onHold: 0,
    topPriority: top >= 0 ? { ...LEGEND[top], count: counts[top] } : undefined,
    nextDue: undefined,
    loadLevel: total === 0 ? 'IDLE' : total <= 3 ? 'LIGHT' : total <= 8 ? 'NORMAL' : 'HEAVY',
    ...overrides,
  };
}

export function aBoard(
  users: WorkloadUser[],
  overrides: Partial<WorkloadBoard> = {},
): WorkloadBoard {
  const out = users.filter((u) => u.availability.state === 'OUT_OF_OFFICE').length;
  const free = users.filter((u) => u.availability.state !== 'OUT_OF_OFFICE' && u.openTotal === 0);
  return {
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-15T15:00:00Z',
    priorities: LEGEND,
    users,
    summary: {
      available: free.length,
      busy: users.length - out - free.length,
      outOfOffice: out,
      unassignedTasks: 4,
      total: users.length,
    },
    thresholds: { lightMax: 3, normalMax: 8 },
    hiddenCount: 0,
    ...overrides,
  };
}

export const OUT_UNTIL = '2026-10-21T00:00:00Z';
export const outOfOffice = { state: 'OUT_OF_OFFICE', outUntil: OUT_UNTIL, note: 'Annual leave' };

// ---- coverage

export function aCoverageUser(
  id: number,
  name: string,
  total: number,
  overrides: Partial<CoverageUser> = {},
): CoverageUser {
  const words = name.split(' ');
  return {
    userId: id,
    displayName: name,
    initials: (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase(),
    pods: [{ podId: 1, name: 'Pod A', isPrimary: true }],
    isActive: true,
    availability: { state: 'AVAILABLE', outUntil: undefined, note: undefined },
    total,
    ...overrides,
  };
}

/** Priya 7 Production + 3 Review, Sam 2 Production, Tess nothing of Review/Archive but 11 Production; Uma inactive with 1 Archive. */
export function aCoverageBoard(overrides: Partial<CoverageBoard> = {}): CoverageBoard {
  return {
    timeZone: 'UTC',
    generatedAtUtc: '2026-10-15T15:00:00Z',
    from: '2026-07-18',
    to: '2026-10-15',
    days: 90,
    taskTypes: [
      {
        taskTypeId: 10,
        name: 'Production',
        iconKey: 'file-text',
        isActive: true,
        total: 20,
        peopleWhoHandledIt: 3,
      },
      {
        taskTypeId: 11,
        name: 'Review',
        iconKey: 'file-text',
        isActive: true,
        total: 3,
        peopleWhoHandledIt: 1,
      },
      {
        taskTypeId: 12,
        name: 'Archive',
        iconKey: 'file-text',
        isActive: true,
        total: 1,
        peopleWhoHandledIt: 1,
      },
    ],
    users: [
      aCoverageUser(1, 'Priya Shah', 10),
      aCoverageUser(2, 'Sam Ortiz', 2, {
        availability: { state: 'OUT_OF_OFFICE', outUntil: '2026-10-21T00:00:00Z', note: 'Leave' },
      }),
      aCoverageUser(3, 'Tess Wu', 11),
      aCoverageUser(4, 'Uma Vee', 1, { isActive: false }),
      aCoverageUser(5, 'Vic Idle', 0),
    ],
    cells: [
      { userId: 1, taskTypeId: 10, completed: 7 },
      { userId: 1, taskTypeId: 11, completed: 3 },
      { userId: 2, taskTypeId: 10, completed: 2 },
      { userId: 3, taskTypeId: 10, completed: 11 },
      { userId: 4, taskTypeId: 12, completed: 1 },
    ],
    summary: { taskTypes: 3, users: 5, typesWithFewerThanTwoPeople: 2, totalCompleted: 24 },
    ...overrides,
  };
}

/** The `groupBy=type` answer for `aCoverageBoard()`: the same counts per type, the people alphabetical, no users or cells. */
export function aCoverageTypeBoard(overrides: Partial<CoverageBoard> = {}): CoverageBoard {
  const board = aCoverageBoard();
  const byId = new Map(board.users.map((u) => [u.userId, u]));
  return {
    ...board,
    users: [],
    cells: [],
    byType: board.taskTypes.map((t) => ({
      taskTypeId: t.taskTypeId,
      people: board.cells
        .filter((c) => c.taskTypeId === t.taskTypeId)
        .map((c) => ({
          userId: c.userId,
          displayName: byId.get(c.userId)!.displayName,
          isActive: byId.get(c.userId)!.isActive,
          completed: c.completed,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    })),
    scopePeople: undefined,
    ...overrides,
  };
}

/** A small skills matrix: four people, two task types (QC is thin), three non-zero cells. */
export function aMatrix(): SkillsMatrix {
  const person = (userId: number, displayName: string, state: string, load: number) => ({
    userId,
    displayName,
    initials: displayName.slice(0, 2).toUpperCase(),
    pods: [],
    state,
    load,
    completed3Months: 0,
    completed12Months: 0,
  });
  return {
    asOfUtc: '2026-11-03T12:00:00Z',
    since3MonthsUtc: '2026-08-03T00:00:00Z',
    since12MonthsUtc: '2025-11-03T00:00:00Z',
    experiencedMin: 5,
    thinMax: 2,
    types: [
      {
        taskTypeId: 1,
        name: 'Review',
        iconKey: 'eye',
        isActive: true,
        completed3Months: 30,
        completed12Months: 90,
        experiencedPeople: 4,
        isThin: false,
      },
      {
        taskTypeId: 2,
        name: 'QC',
        iconKey: 'check',
        isActive: true,
        completed3Months: 3,
        completed12Months: 8,
        experiencedPeople: 1,
        isThin: true,
      },
    ],
    people: [
      person(1, 'Ana Bell', 'AVAILABLE', 3),
      person(2, 'Ben Carter', 'AVAILABLE', 0),
      person(3, 'Cy Dunn', 'OUT_OF_OFFICE', 0),
      person(4, 'Di Eng', 'AVAILABLE', 1),
    ],
    cells: [
      { userId: 1, taskTypeId: 1, completed3Months: 12, completed12Months: 40 },
      { userId: 1, taskTypeId: 2, completed3Months: 3, completed12Months: 8 },
      { userId: 4, taskTypeId: 2, completed3Months: 1, completed12Months: 2 },
    ],
  };
}
