import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StepDefinitionsClient, WorkflowsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { QuietRequests } from '../../../core/http/interceptors';
import { TaskTypesApi } from './task-types-api';

export type AdminTabKey = 'task-types' | 'workflows' | 'steps';

/**
 * The number of ACTIVE records of each tab of the Task Types page (#364), shown in the tab as "Task Types (61)". The page provides this
 * service. It asks once when the page opens, one request per tab the person may use and nothing for the others: the Task Types list as it
 * is (it loads whole), the Workflows and Steps lists for one row each, whose answer carries the library-wide summary (#366). The open tab
 * then reports its own number after every load (`report`), so a deactivate or an activate in the list moves the count without another
 * request. A count that could not be read stays unknown (`--`); counts never reflect a filter.
 */
@Injectable()
export class AdminCounts {
  private readonly auth = inject(AuthStore);
  /** The counts are background requests: a failure leaves a count unknown and must not toast on top of the list's own message. */
  private readonly quiet = inject(QuietRequests);
  private readonly taskTypes = inject(TaskTypesApi, { optional: true });
  private readonly workflows = inject(WorkflowsClient, { optional: true });
  private readonly steps = inject(StepDefinitionsClient, { optional: true });

  /** The active count per tab; null while it is not known. */
  readonly counts = signal<Record<AdminTabKey, number | null>>({
    'task-types': null,
    workflows: null,
    steps: null,
  });

  /** Reads the counts of the tabs the person may use (called once by the page). */
  async load(): Promise<void> {
    await Promise.all([
      this.auth.has('TaskType.Manage') ? this.read('task-types', () => this.taskTypeCount()) : null,
      this.auth.has('Workflow.Manage') ? this.read('workflows', () => this.workflowCount()) : null,
      this.auth.has('Workflow.Manage') ? this.read('steps', () => this.stepCount()) : null,
    ]);
  }

  /** A tab reports its own active count (after each load); the request of `load` is then not needed. */
  set(key: AdminTabKey, count: number | null | undefined): void {
    if (typeof count === 'number') this.counts.update((c) => ({ ...c, [key]: count }));
  }

  /** Reports a tab's count to the page that holds the counts, if there is one (a tab used alone has none). Call in an injection context. */
  static report(key: AdminTabKey): (count: number | null | undefined) => void {
    const counts = inject(AdminCounts, { optional: true });
    const destroyed = { value: false };
    inject(DestroyRef).onDestroy(() => (destroyed.value = true));
    return (count) => {
      if (counts && !destroyed.value) counts.set(key, count);
    };
  }

  private async read(key: AdminTabKey, fetch: () => Promise<number | undefined>): Promise<void> {
    try {
      const count = await fetch();
      // The open tab may have reported a newer number while this request was on its way.
      if (typeof count === 'number' && this.counts()[key] === null) this.set(key, count);
    } catch {
      /* the tab simply shows no count */
    }
  }

  private async taskTypeCount(): Promise<number | undefined> {
    if (!this.taskTypes) return undefined;
    const taskTypes = this.taskTypes;
    return (await this.quiet.run(() => firstValueFrom(taskTypes.list()))).filter((t) => t.isActive)
      .length;
  }

  private async workflowCount(): Promise<number | undefined> {
    if (!this.workflows) return undefined;
    const workflows = this.workflows;
    const page = await this.quiet.run(() =>
      firstValueFrom(
        workflows.listWorkflows(
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
      ),
    );
    return page.summary?.active;
  }

  private async stepCount(): Promise<number | undefined> {
    if (!this.steps) return undefined;
    const steps = this.steps;
    const page = await this.quiet.run(() =>
      firstValueFrom(
        steps.listStepDefinitions(
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
      ),
    );
    return page.summary?.active;
  }
}
