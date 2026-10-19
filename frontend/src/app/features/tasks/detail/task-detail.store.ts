import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  StepActionResponse,
  TaskCompletionCheck,
  TaskResponse,
  TaskStepInstance,
  TaskWorkflowClient,
  TasksClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { RecordLoadFlow, RecordLoadState } from '../../../shared/ui/record-state';
import { completeHint, completeStateOf } from './complete-state';

export type DetailState = RecordLoadState;
/** The old `?tab=` values: the sections of the single page, plus `activity` (the drawer) and `details` (just the page). */
export type TaskTab = 'details' | 'workflow' | 'comments' | 'assets' | 'activity';
export const TASK_TABS: readonly TaskTab[] = [
  'details',
  'workflow',
  'comments',
  'assets',
  'activity',
];
/** The sections of the page that links, the "Jump to" row and `?tab=` can scroll to. */
export type TaskSection = 'workflow' | 'comments' | 'assets';

/** The dialog currently asking the user to confirm or explain a status change. */
export type ActionDialog =
  | { kind: 'reason'; action: 'HOLD' | 'CANCEL' }
  | { kind: 'reopen' }
  | { kind: 'complete'; check: TaskCompletionCheck };

export type ActResult = { ok: true; task: TaskResponse } | { ok: false; error: unknown };

/** Menu label per transition action (UX: Start / Resume / On hold / Cancel / Reopen / Complete). */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  START: 'Start',
  RESUME: 'Resume',
  HOLD: 'Put on hold',
  COMPLETE: 'Complete',
  CANCEL: 'Cancel task',
  REOPEN: 'Reopen',
};

const isStepResponse = (r: TaskResponse | StepActionResponse): r is StepActionResponse =>
  'affectedStepInstanceIds' in r;

/**
 * State of one Task detail screen (provided by the page, so every child shares it): the loaded Task, the concurrency
 * banner, and every write. Each write sends the `rowVersion` last read and replaces the Task with the server's answer;
 * a failed write refreshes the data unless the user must fix their input or must decide about a conflict.
 */
@Injectable()
export class TaskDetailStore {
  private readonly tasks = inject(TasksClient);
  private readonly workflows = inject(TaskWorkflowClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  readonly taskId = signal(0);
  /**
   * The address of the page the task was opened from (router state `returnTo`), read once when the page opens: later navigations on this
   * page (closing the Activity drawer) replace the history entry's state, and Back must still return to the same view (#324).
   */
  readonly returnTo: unknown =
    typeof history === 'undefined'
      ? null
      : (history.state as { returnTo?: unknown } | null)?.returnTo;
  /** Counts the successful status actions; the facts strip puts focus on the Status menu button after each (K3, #328). */
  readonly statusFocus = signal(0);
  /** The shared load flow of the record pages (#290): skeleton while loading, `mf-record-state` for 404, 403 and failures, quiet request. */
  readonly flow = new RecordLoadFlow('task');
  readonly state = this.flow.state;
  readonly task = signal<TaskResponse | null>(null);
  /** True after a 409 CONCURRENCY_CONFLICT: show the reload banner. */
  readonly conflict = signal(false);
  readonly busy = signal(false);
  /** Non-blocking warnings of the last write (for example USER_NOT_IN_POD). */
  readonly warnings = signal<string[]>([]);
  /** The section a link asked for; the page scrolls to it and moves focus to its heading. `seq` makes a repeated request count. */
  readonly sectionRequest = signal<{ section: TaskSection; seq: number } | null>(null);
  /** Whether the Activity drawer is open. */
  readonly activityOpen = signal(false);
  /** The comment the Activity asked to show; the Comments section scrolls to it and highlights it. `seq` makes a repeated request count. */
  readonly commentFocus = signal<{ commentId: number; seq: number } | null>(null);
  readonly editing = signal(false);
  readonly dirty = signal(false);
  readonly dialog = signal<ActionDialog | null>(null);
  /** Step the user asked to jump to (from the complete dialog); the workflow tab scrolls to it and focuses it. */
  readonly focusStepId = signal<number | null>(null);

  /**
   * True for a user who may look at tasks but change nothing in them (Read-Only Observer): the page says so once and leaves out
   * edit-oriented copy and disabled actions. Commenting alone does not count as editing.
   */
  readonly viewOnly = computed(
    () =>
      !this.auth.hasAny([
        'Task.Edit',
        'Task.Assign',
        'Task.SetPriority',
        'Task.ChangeStatus',
        'Task.Complete',
        'Task.Cancel',
        'Task.Reopen',
        'Workflow.Execute',
        'Workflow.StepReopen',
      ]),
  );

  /** Whether Complete can go straight through or some steps need information first (#304). Read by every Complete control. */
  readonly completeState = computed(() => completeStateOf(this.task()?.workflow.steps));
  /** "3 steps need information" while Complete is blocked, else null: tooltip and `aria-describedby` of the Complete controls. */
  readonly completeHint = computed(() => completeHint(this.completeState()));

  readonly closed = computed(() => {
    const s = this.task()?.status;
    return s === 'COMPLETED' || s === 'CANCELLED';
  });

  async load(id: number = this.taskId()): Promise<void> {
    if (id !== this.taskId()) {
      this.taskId.set(id);
      this.task.set(null);
      this.commentFocus.set(null);
      this.flow.state.set('loading');
    }
    // `/tasks/abc` and `/tasks/0` are an address that names no task: the same answer as an unknown number, without a request.
    if (!Number.isSafeInteger(id) || id <= 0) {
      this.flow.state.set('notFound');
      return;
    }
    this.conflict.set(false);
    this.warnings.set([]);
    this.editing.set(false);
    this.dirty.set(false);
    await this.flow.run(
      () => firstValueFrom(this.tasks.getTask(id)),
      (task) => this.task.set(task),
    );
  }

  /** Quiet refresh that keeps the current screen (used after a failed write). */
  private async refresh(): Promise<void> {
    try {
      this.task.set(await firstValueFrom(this.tasks.getTask(this.taskId())));
    } catch {
      /* the next explicit load reports it */
    }
  }

  /** Runs one write against the current Task; the call receives the Task as last read (for its rowVersion). */
  async act(
    call: (task: TaskResponse) => Observable<TaskResponse | StepActionResponse>,
  ): Promise<ActResult> {
    const current = this.task();
    if (!current) return { ok: false, error: null };
    this.busy.set(true);
    try {
      const response = await firstValueFrom(call(current));
      const task = isStepResponse(response) ? response.task : response;
      this.task.set(task);
      this.warnings.set(task.warnings ?? []);
      this.conflict.set(false);
      return { ok: true, task };
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'CONCURRENCY_CONFLICT') this.conflict.set(true);
        else if (!error.hasFieldErrors && error.status !== 400) await this.refresh();
      }
      return { ok: false, error };
    } finally {
      this.busy.set(false);
    }
  }

  // ---- status actions (header menu, banners, workflow tab)

  async requestAction(action: string): Promise<void> {
    switch (action) {
      case 'START':
      case 'RESUME': {
        const result = await this.act((t) =>
          this.tasks.changeTaskStatus(t.taskId, {
            rowVersion: t.rowVersion,
            status: 'IN_PROGRESS',
          }),
        );
        if (result.ok) {
          this.notify.success(`${result.task.taskNumber} is In Progress.`);
          this.statusDone();
        }
        break;
      }
      case 'HOLD':
      case 'CANCEL':
        this.dialog.set({ kind: 'reason', action });
        break;
      case 'REOPEN':
        this.dialog.set({ kind: 'reopen' });
        break;
      case 'COMPLETE':
        await this.beginComplete();
        break;
    }
  }

  /** Hold or cancel with the mandatory comment. Returns the failure so the dialog can show server field errors. */
  async submitReason(action: 'HOLD' | 'CANCEL', comment: string): Promise<ActResult> {
    const result = await this.act((t) =>
      action === 'HOLD'
        ? this.tasks.changeTaskStatus(t.taskId, {
            rowVersion: t.rowVersion,
            status: 'ON_HOLD',
            comment,
          })
        : this.tasks.cancelTask(t.taskId, { rowVersion: t.rowVersion, comment }),
    );
    if (result.ok) {
      this.dialog.set(null);
      this.notify.success(
        action === 'HOLD'
          ? `${result.task.taskNumber} is On Hold.`
          : `${result.task.taskNumber} cancelled.`,
      );
      this.statusDone();
    } else if (this.conflict()) {
      this.dialog.set(null);
    }
    return result;
  }

  async confirmReopen(): Promise<void> {
    const result = await this.act((t) =>
      this.tasks.reopenTask(t.taskId, { rowVersion: t.rowVersion }),
    );
    if (result.ok) this.notify.success(`${result.task.taskNumber} is back In Progress.`);
    this.dialog.set(null);
    if (result.ok) this.statusDone();
  }

  /** Complete: straight through when every step is resolved, otherwise the bulk-complete or blocked dialog (addendum K). */
  async beginComplete(): Promise<void> {
    const t = this.task();
    if (!t) return;
    let check: TaskCompletionCheck;
    try {
      check = await firstValueFrom(this.tasks.getTaskCompletionCheck(t.taskId));
    } catch {
      return;
    }
    if (check.isReady) {
      const result = await this.act((x) =>
        this.tasks.completeTask(x.taskId, {
          rowVersion: x.rowVersion,
          completeUnresolvedSteps: false,
        }),
      );
      if (result.ok) {
        this.notify.success(`${result.task.taskNumber} completed.`);
        this.statusDone();
      }
      return;
    }
    this.dialog.set({ kind: 'complete', check });
  }

  async confirmBulkComplete(): Promise<void> {
    // The server completes only the steps the user was shown: it compares the workflow version of the completion check (SEC2-08).
    const shown = this.dialog();
    const workflowRowVersion = shown?.kind === 'complete' ? shown.check.workflowRowVersion : '';
    const result = await this.act((t) =>
      this.tasks.completeTask(t.taskId, {
        rowVersion: t.rowVersion,
        completeUnresolvedSteps: true,
        workflowRowVersion,
      }),
    );
    if (result.ok) {
      this.dialog.set(null);
      this.notify.success(`${result.task.taskNumber} completed.`);
      this.statusDone();
      return;
    }
    if (
      result.error instanceof ApiError &&
      (result.error.code === 'COMPLETION_BLOCKED' || result.error.code === 'CONCURRENCY_CONFLICT')
    ) {
      // A step lost its inputs or another user changed the workflow: show the list again from a fresh check.
      try {
        const check = await firstValueFrom(this.tasks.getTaskCompletionCheck(this.taskId()));
        this.dialog.set({ kind: 'complete', check });
      } catch {
        this.dialog.set(null);
      }
    } else {
      this.dialog.set(null);
    }
  }

  /** A status action went through: the facts strip puts focus on the Status menu button (K3, #328). */
  private statusDone(): void {
    this.statusFocus.update((n) => n + 1);
  }

  closeDialog(): void {
    this.dialog.set(null);
  }

  /** Jumps to a step of the Workflow section (links in the blocked-completion dialog). */
  showStep(stepInstanceId: number): void {
    this.dialog.set(null);
    this.focusStepId.set(stepInstanceId);
  }

  /** Scrolls to a section of the page and moves focus to its heading. */
  showSection(section: TaskSection): void {
    this.sectionRequest.update((r) => ({ section, seq: (r?.seq ?? 0) + 1 }));
  }

  // ---- step actions

  stepAction(
    step: TaskStepInstance,
    action: 'start' | 'save' | 'complete' | 'skip' | 'reopen',
    payload: { values?: Record<string, unknown>; comment?: string } = {},
  ): Promise<ActResult> {
    return this.act((t) => {
      const rowVersion = t.workflow.rowVersion;
      const id = step.stepInstanceId;
      const values = payload.values as Record<string, never> | undefined;
      switch (action) {
        case 'start':
          return this.workflows.startTaskStep(t.taskId, id, { rowVersion });
        case 'save':
          return this.workflows.saveTaskStepValues(t.taskId, id, { rowVersion, values });
        case 'complete':
          return this.workflows.completeTaskStep(t.taskId, id, { rowVersion, values });
        case 'skip':
          return this.workflows.skipTaskStep(t.taskId, id, {
            rowVersion,
            comment: payload.comment,
          });
        case 'reopen':
          return this.workflows.reopenTaskStep(t.taskId, id, { rowVersion });
      }
    });
  }
}
