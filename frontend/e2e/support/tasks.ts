import { Api, Json, RawResponse } from './api';

/**
 * API-level task operations for setup and for negative checks that the UI makes impossible (for example completing a locked
 * step). Each call re-reads the task first, because every write needs the current `rowVersion`.
 */
export class TaskApi {
  constructor(
    readonly api: Api,
    readonly taskId: number,
  ) {}

  get(): Promise<Json> {
    return this.api.get(`/api/v1/tasks/${this.taskId}`);
  }

  async steps(): Promise<Json[]> {
    return (await this.get()).workflow.steps;
  }

  /** Step by its 1-based position in the workflow. */
  async step(sequenceNo: number): Promise<Json> {
    const steps = await this.steps();
    const found = steps.find((s) => s.sequenceNo === sequenceNo);
    if (!found) throw new Error(`Task ${this.taskId} has no step ${sequenceNo}`);
    return found;
  }

  async stepStatuses(): Promise<string[]> {
    return (await this.steps()).map((s) => s.status);
  }

  /** Posts a step action and returns the raw response (status and body). */
  async stepAction(
    sequenceNo: number,
    action: 'start' | 'complete' | 'skip' | 'reopen',
    body: Json = {},
  ): Promise<RawResponse> {
    const task = await this.get();
    const step = task.workflow.steps.find((s: Json) => s.sequenceNo === sequenceNo);
    return this.api.raw(
      'POST',
      `/api/v1/tasks/${this.taskId}/workflow/steps/${step.stepInstanceId}/${action}`,
      { rowVersion: task.workflow.rowVersion, ...body },
    );
  }

  /** Like `stepAction` but throws unless the call succeeds. */
  async doStep(
    sequenceNo: number,
    action: 'start' | 'complete' | 'skip' | 'reopen',
    body: Json = {},
  ): Promise<Json> {
    const result = await this.stepAction(sequenceNo, action, body);
    if (result.status >= 300) {
      throw new Error(
        `step ${sequenceNo} ${action} -> ${result.status} ${JSON.stringify(result.body)}`,
      );
    }
    return result.body;
  }

  async completeSteps(...sequenceNos: number[]): Promise<void> {
    for (const n of sequenceNos) await this.doStep(n, 'complete');
  }

  /** Task-level action on the status endpoint family. */
  async changeStatus(status: string, comment?: string): Promise<RawResponse> {
    const task = await this.get();
    return this.api.raw('POST', `/api/v1/tasks/${this.taskId}/status`, {
      rowVersion: task.rowVersion,
      status,
      comment,
    });
  }

  /** NEW -> IN_PROGRESS (the Start action). */
  async start(): Promise<void> {
    const result = await this.changeStatus('IN_PROGRESS');
    if (result.status >= 300)
      throw new Error(`start -> ${result.status} ${JSON.stringify(result.body)}`);
  }

  async assign(userId: number | null, podId: number | null = null): Promise<RawResponse> {
    const task = await this.get();
    return this.api.raw('POST', `/api/v1/tasks/${this.taskId}/assignment`, {
      rowVersion: task.rowVersion,
      userId,
      podId,
    });
  }

  async cancel(comment: string): Promise<RawResponse> {
    const task = await this.get();
    return this.api.raw('POST', `/api/v1/tasks/${this.taskId}/cancel`, {
      rowVersion: task.rowVersion,
      comment,
    });
  }

  async complete(completeUnresolvedSteps = false): Promise<RawResponse> {
    const task = await this.get();
    return this.api.raw('POST', `/api/v1/tasks/${this.taskId}/complete`, {
      rowVersion: task.rowVersion,
      completeUnresolvedSteps,
    });
  }
}
