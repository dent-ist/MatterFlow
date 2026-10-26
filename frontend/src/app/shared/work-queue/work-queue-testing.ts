import { Provider, signal } from '@angular/core';
import { of } from 'rxjs';
import { PrioritiesClient, StatusLabelsClient, TaskQueueRow } from '../../api/generated/api-client';
import { SEEDED_PRIORITIES, SEEDED_STATUS_LABELS } from '../../core/lookups/lookups-testing';
import { Clock, USER_TIME_ZONE } from '../../core/time/clock';
import { FilterOption } from '../filters/filter-def';
import { QueueChoices } from './queue-choices';

/** Builders and fakes shared by the work-queue component tests. */
export function aRow(overrides: Partial<TaskQueueRow> = {}): TaskQueueRow {
  return {
    taskId: 1042,
    taskNumber: 'TSK-1042',
    title: 'Process Smith custodians',
    matterId: 7,
    matterRef: '00343-00012',
    matterName: 'Merger Review',
    matterIsSensitive: false,
    matterIsActive: true,
    clientId: 1,
    clientName: 'Acme Corp',
    projectId: undefined,
    projectName: undefined,
    taskTypeId: 2,
    taskTypeName: 'Data Processing',
    taskTypeIconKey: 'cpu-2',
    workflowDefinitionId: 3,
    workflowName: 'Ordered flow',
    priority: { priorityId: 1, label: 'Critical', color: 'critical', sortOrder: 1 },
    status: 'IN_PROGRESS',
    statusLabel: 'In Progress',
    assignedPod: { podId: 5, name: 'Pod A', isActive: true },
    assignedUser: { userId: 9, displayName: 'Tariq Malik', isActive: true },
    createdBy: { userId: 2, displayName: 'Pat Partner', isActive: true },
    requestorName: 'Pat Partner',
    dueDate: undefined,
    dueAtUtc: undefined,
    isAsap: true,
    isOverdue: false,
    createdAtUtc: '2026-10-01T12:00:00Z',
    assignedAtUtc: undefined,
    updatedAtUtc: undefined,
    completedAtUtc: undefined,
    statusChangedAtUtc: '2026-10-01T12:00:00Z',
    closedAtUtc: undefined,
    workflow: {
      stepsTotal: 6,
      stepsResolved: 2,
      currentStepNumber: 3,
      currentStepName: 'Dedup',
      currentStepId: 903,
    },
    rowVersion: 'AAAA',
    holdReason: undefined,
    holdReasonTruncated: false,
    matterCanOpen: true,
    taskTypeColourKey: undefined,
    onHoldReasonId: undefined,
    onHoldReasonName: undefined,
    atRisk: false,
    ...overrides,
  };
}

const ZERO_VIEWS = {
  open: 0,
  unassigned: 0,
  overdue: 0,
  dueSoon: 0,
  asap: 0,
  onHold: 0,
  recentlyCompleted: 0,
  createdByMe: 0,
};

/** A page of rows in the shape every queue response shares. */
export function pageOf(rows: TaskQueueRow[], extra: Record<string, unknown> = {}) {
  return {
    items: rows,
    total: rows.length,
    page: 1,
    pageSize: 50,
    timeZone: 'UTC',
    views: ZERO_VIEWS,
    ...extra,
  };
}

/** Priority and status label lookups (the seeded defaults), so badges and chips show real labels. */
export function provideLookups(): Provider[] {
  return [
    { provide: PrioritiesClient, useValue: { listPriorities: () => of(SEEDED_PRIORITIES()) } },
    {
      provide: StatusLabelsClient,
      useValue: { listStatusLabels: () => of(SEEDED_STATUS_LABELS()) },
    },
  ];
}

/** A fixed "now" and viewer zone. */
export function provideClock(now: string, zone = 'America/Chicago'): Provider[] {
  return [
    { provide: Clock, useValue: { now: () => new Date(now) } },
    { provide: USER_TIME_ZONE, useValue: zone },
  ];
}

/** The people, task types and workflows the column filters offer, without asking the server (tests give them directly). */
export function provideQueueChoices(
  choices: {
    people?: FilterOption[];
    types?: FilterOption[];
    workflows?: FilterOption[];
  } = {},
): Provider[] {
  return [
    {
      provide: QueueChoices,
      useValue: {
        people: signal(choices.people ?? []),
        types: signal(choices.types ?? []),
        workflows: signal(choices.workflows ?? []),
        ensure: () => undefined,
      },
    },
  ];
}
