import { SwimlaneCard, SwimlaneLane } from '../../../api/generated/api-client';

/** Builders for the Swimlane specs. */
export function aCard(overrides: Partial<SwimlaneCard> = {}): SwimlaneCard {
  return {
    taskId: 1,
    ref: 'TSK-1',
    title: 'Process custodians',
    status: 'NEW',
    statusLabel: 'New',
    priority: { priorityId: 2, label: 'High', color: 'high', rank: 2 },
    assignee: undefined,
    pod: undefined,
    clientId: 10,
    clientNumber: '00010',
    clientName: 'Acme Corp',
    matterId: 100,
    matterRef: '00010-00001',
    matterName: 'Merger',
    matterIsSensitive: false,
    matterCanOpen: true,
    taskTypeId: 3,
    taskTypeName: 'Data Processing',
    taskTypeIconKey: 'cpu-2',
    dueDate: undefined,
    dueAtUtc: undefined,
    isOverdue: false,
    isAsap: true,
    stepsResolved: 1,
    stepsTotal: 4,
    createdAtUtc: '2026-10-10T12:00:00Z',
    completedAtUtc: undefined,
    rowVersion: 'AAAA',
    ...overrides,
  };
}

export const counts = (n: number, i = 0, h = 0, c = 0) => ({
  new: n,
  inProgress: i,
  onHold: h,
  completed: c,
});

export function aLane(
  status: string,
  cards: SwimlaneCard[],
  extra: Partial<SwimlaneLane> = {},
): SwimlaneLane {
  return {
    status,
    label: { NEW: 'New', IN_PROGRESS: 'In Progress', ON_HOLD: 'On Hold', COMPLETED: 'Completed' }[
      status
    ] as string,
    count: cards.length,
    total: cards.length,
    truncated: false,
    cards,
    ...extra,
  };
}
