import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StepDefinitionsClient, WorkflowsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { AdminTab, AdminTabCounts } from '../admin-tabs';
import { TaskTypesApi } from './task-types-api';

export type AdminTabKey = 'task-types' | 'workflows' | 'steps';

/** The three tabs of the Task Types page as kit tab data (#545): who may open them and which count each one shows. */
export const TASK_TYPES_TABS: readonly AdminTab[] = [
  {
    id: 'task-types',
    label: 'Task Types',
    route: '/admin/task-types',
    permission: ['TaskType.Manage'],
    countKey: 'task-types',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    route: '/admin/workflows',
    permission: ['Workflow.Manage'],
    countKey: 'workflows',
  },
  {
    id: 'steps',
    label: 'Workflow Steps',
    route: '/admin/steps',
    permission: ['Workflow.Manage'],
    countKey: 'steps',
  },
];

/**
 * The number of ACTIVE records of each tab of the Task Types page (#364), shown in the tab as "Task Types (61)": the Task Types instance of
 * the kit's `AdminTabCounts` (#545), which holds the behaviour (one quiet request per allowed tab when the page opens, the open tab then
 * reports its own number after every load, a count that could not be read stays unknown, counts never reflect a filter). Here are only the
 * three loaders: the Task Types list as it is (it loads whole), the Workflows and Steps lists for one row each, whose answer carries the
 * library-wide summary (#366).
 */
@Injectable()
export class AdminCounts extends AdminTabCounts {
  private readonly auth = inject(AuthStore);
  private readonly taskTypes = inject(TaskTypesApi, { optional: true });
  private readonly workflows = inject(WorkflowsClient, { optional: true });
  private readonly steps = inject(StepDefinitionsClient, { optional: true });

  constructor() {
    super();
    this.counts.set({ 'task-types': null, workflows: null, steps: null });
  }

  /** Reads the counts of the tabs the person may use (called once by the page). */
  load(): Promise<void> {
    return this.start(
      TASK_TYPES_TABS,
      {
        'task-types': () => this.taskTypeCount(),
        workflows: () => this.workflowCount(),
        steps: () => this.stepCount(),
      },
      (permission) => this.auth.has(permission),
    );
  }

  private async taskTypeCount(): Promise<number | undefined> {
    if (!this.taskTypes) return undefined;
    return (await firstValueFrom(this.taskTypes.list())).filter((t) => t.isActive).length;
  }

  private async workflowCount(): Promise<number | undefined> {
    if (!this.workflows) return undefined;
    const page = await firstValueFrom(
      this.workflows.listWorkflows(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        1,
      ),
    );
    return page.summary?.active;
  }

  private async stepCount(): Promise<number | undefined> {
    if (!this.steps) return undefined;
    const page = await firstValueFrom(
      this.steps.listStepDefinitions(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        1,
      ),
    );
    return page.summary?.active;
  }
}
