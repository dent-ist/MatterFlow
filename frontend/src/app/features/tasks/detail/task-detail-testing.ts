import { vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { Observable, of } from 'rxjs';
import {
  FormsClient,
  PodsClient,
  PrioritiesClient,
  ProjectsClient,
  StatusLabelsClient,
  TaskAllowedActions,
  TaskCompletionCheck,
  TaskResponse,
  TaskStepInstance,
  TaskTransitionOption,
  TaskWorkflowClient,
  TasksClient,
  UsersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { SEEDED_PRIORITIES, SEEDED_STATUS_LABELS } from '../../../core/lookups/lookups-testing';
import {
  FakeMeApi,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { TaskDetailPage } from './task-detail-page';

export function aStep(overrides: Partial<TaskStepInstance> = {}): TaskStepInstance {
  return {
    stepInstanceId: 101,
    sequenceNo: 1,
    title: 'Intake QC',
    description: undefined,
    instructions: undefined,
    documentationUrl: undefined,
    inputFormVersionId: undefined,
    isSkippable: false,
    skipCommentRequired: false,
    status: 'PENDING',
    hasBeenResolved: false,
    isCurrent: false,
    isReopenedPrerequisite: false,
    requiredInputsSatisfied: true,
    skipComment: undefined,
    firstResolvedAtUtc: undefined,
    resolvedAtUtc: undefined,
    resolvedByUserId: undefined,
    values: {},
    ...overrides,
  };
}

export function transition(
  action: string,
  overrides: Partial<TaskTransitionOption> = {},
): TaskTransitionOption {
  const target: Record<string, string> = {
    START: 'IN_PROGRESS',
    RESUME: 'IN_PROGRESS',
    REOPEN: 'IN_PROGRESS',
    HOLD: 'ON_HOLD',
    COMPLETE: 'COMPLETED',
    CANCEL: 'CANCELLED',
  };
  return {
    action,
    targetStatus: target[action],
    requiresComment: action === 'HOLD' || action === 'CANCEL',
    requiredPermission: 'Task.ChangeStatus',
    permitted: true,
    blockedReason: undefined,
    ...overrides,
  };
}

export function allowed(overrides: Partial<TaskAllowedActions> = {}): TaskAllowedActions {
  return {
    canEdit: true,
    canAssign: true,
    canSetPriority: true,
    canComment: true,
    canExecuteSteps: true,
    canReopenSteps: true,
    transitions: [transition('HOLD'), transition('COMPLETE'), transition('CANCEL')],
    ...overrides,
  };
}

export function aTask(all: Partial<TaskResponse> = {}): TaskResponse {
  const { workflow: wf, ...overrides } = all;
  const steps = wf?.steps ?? [
    aStep({
      stepInstanceId: 101,
      sequenceNo: 1,
      title: 'Intake QC',
      status: 'COMPLETED',
      hasBeenResolved: true,
    }),
    aStep({
      stepInstanceId: 102,
      sequenceNo: 2,
      title: 'Deduplicate',
      status: 'IN_PROGRESS',
      isCurrent: true,
      isSkippable: true,
    }),
    aStep({ stepInstanceId: 103, sequenceNo: 3, title: 'OCR' }),
  ];
  return {
    taskId: 1042,
    taskNumber: 'TSK-1042',
    matter: {
      matterId: 7,
      clientId: 1,
      clientNumber: '00343',
      matterNumber: '00012',
      matterRef: '00343-00012',
      name: 'Merger Review',
      isActive: true,
      isSensitive: false,
    },
    project: undefined,
    taskType: { taskTypeId: 5, name: 'Data Processing' },
    title: 'Process Smith custodians',
    description: 'Process the custodians.',
    requestorName: 'Jane Roe',
    requestorEmail: 'jane.roe@client.com',
    requestedAtUtc: undefined,
    priority: { priorityId: 1, label: 'Critical', color: 'critical', sortOrder: 1 },
    status: 'IN_PROGRESS',
    statusLabel: 'In Progress',
    assignedPod: { podId: 2, name: 'Pod A', isActive: true },
    assignedUser: { userId: 9, displayName: 'Tariq M.', isActive: true },
    dueDate: undefined,
    dueTime: undefined,
    dueAtUtc: undefined,
    isAsap: true,
    isOverdue: false,
    timeZone: 'America/New_York',
    createdBy: { userId: 3, displayName: 'Dana P.', isActive: true },
    createdAtUtc: '2026-10-13T13:20:00Z',
    modifiedAtUtc: undefined,
    statusChangedAtUtc: '2026-10-13T13:20:00Z',
    completedAtUtc: undefined,
    formVersionId: undefined,
    formVersionNo: undefined,
    formValues: {},
    workflow: {
      workflowInstanceId: 11,
      workflowDefinitionId: 4,
      workflowName: 'Standard Processing',
      workflowVersionId: 8,
      versionNo: 2,
      isOrdered: true,
      rowVersion: 'WF1',
      progress: {
        total: steps.length,
        pending: steps.filter((s) => s.status === 'PENDING').length,
        inProgress: steps.filter((s) => s.status === 'IN_PROGRESS').length,
        completed: steps.filter((s) => s.status === 'COMPLETED').length,
        skipped: steps.filter((s) => s.status === 'SKIPPED').length,
        resolved: steps.filter((s) => s.status === 'COMPLETED' || s.status === 'SKIPPED').length,
        currentStepInstanceId: steps.find((s) => s.isCurrent)?.stepInstanceId,
        reopenedPrerequisiteStepInstanceIds: [],
      },
      steps,
      ...wf,
    },
    allowedActions: allowed(),
    statusReason: undefined,
    rowVersion: 'RV1',
    warnings: [],
    droppedFields: [],
    bulkCompletedStepInstanceIds: [],
    ...overrides,
  };
}

export const aCheck = (overrides: Partial<TaskCompletionCheck> = {}): TaskCompletionCheck => ({
  isReady: false,
  canBulkComplete: true,
  unresolved: [
    { stepInstanceId: 102, sequenceNo: 2, title: 'Deduplicate' },
    { stepInstanceId: 103, sequenceNo: 3, title: 'OCR' },
  ],
  bulkCompletable: [
    { stepInstanceId: 102, sequenceNo: 2, title: 'Deduplicate' },
    { stepInstanceId: 103, sequenceNo: 3, title: 'OCR' },
  ],
  blocked: [],
  ...overrides,
});

export interface TaskFakes {
  tasks: Record<string, ReturnType<typeof vi.fn>>;
  workflow: Record<string, ReturnType<typeof vi.fn>>;
  forms: { getFormVersionSchema: ReturnType<typeof vi.fn> };
}

/** Mounts the page against fake clients and waits for the first render. */
export async function mountTaskPage(
  task: TaskResponse,
  permissions: Permission[] = ['Task.View', 'Task.Edit', 'Workflow.Execute'],
  extra: Partial<TaskFakes> = {},
  tab?: string,
): Promise<{ fixture: ComponentFixture<TaskDetailPage>; fakes: TaskFakes; el: HTMLElement }> {
  const ok = <T>(v: T): Observable<T> => of(v);
  const fakes: TaskFakes = {
    tasks: {
      getTask: vi.fn().mockReturnValue(ok(task)),
      getTaskCompletionCheck: vi.fn().mockReturnValue(ok(aCheck())),
      updateTask: vi.fn().mockReturnValue(ok(task)),
      assignTask: vi.fn().mockReturnValue(ok(task)),
      changeTaskStatus: vi.fn().mockReturnValue(ok(task)),
      completeTask: vi.fn().mockReturnValue(ok(task)),
      cancelTask: vi.fn().mockReturnValue(ok(task)),
      reopenTask: vi.fn().mockReturnValue(ok(task)),
      ...extra.tasks,
    },
    workflow: {
      startTaskStep: vi.fn(),
      saveTaskStepValues: vi.fn(),
      completeTaskStep: vi.fn(),
      skipTaskStep: vi.fn(),
      reopenTaskStep: vi.fn(),
      ...extra.workflow,
    },
    forms: {
      getFormVersionSchema: vi.fn().mockReturnValue(ok({ fields: [] })),
      ...extra.forms,
    },
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      MessageService,
      provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
      { provide: TasksClient, useValue: fakes.tasks },
      { provide: TaskWorkflowClient, useValue: fakes.workflow },
      { provide: FormsClient, useValue: fakes.forms },
      {
        provide: PrioritiesClient,
        useValue: { listPriorities: () => ok(SEEDED_PRIORITIES()) },
      },
      {
        provide: StatusLabelsClient,
        useValue: { listStatusLabels: () => ok(SEEDED_STATUS_LABELS()) },
      },
      {
        provide: ProjectsClient,
        useValue: { listProjects: () => ok({ items: [], total: 0, page: 1, pageSize: 100 }) },
      },
      {
        provide: PodsClient,
        useValue: {
          listPods: () => ok({ items: [{ podId: 2, name: 'Pod A', isActive: true }] }),
          getPod: () => ok({ members: [{ userId: 9, displayName: 'Tariq M.', isActive: true }] }),
        },
      },
      { provide: UsersClient, useValue: { listUsers: () => ok({ items: [] }) } },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  await TestBed.inject(AuthStore).ensureLoaded();
  const fixture = TestBed.createComponent(TaskDetailPage);
  fixture.componentRef.setInput('id', String(task.taskId));
  if (tab) fixture.componentRef.setInput('tab', tab);
  await settle(fixture);
  return { fixture, fakes, el: fixture.nativeElement as HTMLElement };
}

export const click = async (
  fixture: ComponentFixture<unknown>,
  el: Element | null,
): Promise<void> => {
  (el as HTMLElement).click();
  await settle(fixture);
};

export const q = (el: ParentNode, selector: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(selector);

export const byText = (el: ParentNode, selector: string, text: string): HTMLElement | undefined =>
  Array.from(el.querySelectorAll<HTMLElement>(selector)).find((e) =>
    e.textContent?.trim().startsWith(text),
  );

/** A button in the footer of the open dialog (the page also has buttons with the same labels). */
export const dialogButton = (label: string): HTMLButtonElement | undefined =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button')).find(
    (b) => b.textContent?.trim() === label,
  );
