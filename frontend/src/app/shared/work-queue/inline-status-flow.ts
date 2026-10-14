import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { TaskQueueRow } from '../../api/generated/api-client';
import { TaskActionDialogs } from '../../features/tasks/detail/task-action-dialogs';
import { TaskDetailStore } from '../../features/tasks/detail/task-detail.store';
import { StatusAction, rowFromTask } from './inline-edit';

/**
 * The status changes that need a dialog (On hold and Cancel with a mandatory comment, Reopen confirmation, Complete with
 * unresolved steps) reuse the Task detail page's store and dialogs, so the rules and wording are the same ones. The store loads
 * the Task, but keeps the `rowVersion` of the row on screen, so a Task changed since the list loaded ends in a conflict.
 * Emits the new row when the change is made, `conflict` on a rowVersion conflict, and `finished` when there is nothing left to show.
 */
@Component({
  selector: 'mf-inline-status-flow',
  imports: [TaskActionDialogs],
  providers: [TaskDetailStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-task-action-dialogs />`,
})
export class InlineStatusFlow implements OnInit {
  private readonly store = inject(TaskDetailStore);

  readonly row = input.required<TaskQueueRow>();
  readonly action = input.required<StatusAction>();

  readonly rowChange = output<TaskQueueRow>();
  readonly conflict = output<void>();
  readonly finished = output<void>();

  private ready = false;
  private requested = false;
  private sawDialog = false;
  private done = false;
  private startVersion = '';

  constructor() {
    effect(() => {
      this.store.task();
      this.store.dialog();
      this.store.conflict();
      this.store.busy();
      untracked(() => this.evaluate());
    });
  }

  async ngOnInit(): Promise<void> {
    const row = this.row();
    this.startVersion = row.rowVersion;
    await this.store.load(row.taskId);
    const loaded = this.store.task();
    if (!loaded || this.store.state() !== 'ready') {
      this.finish();
      return;
    }
    this.store.task.set({ ...loaded, rowVersion: row.rowVersion });
    this.ready = true;
    await this.store.requestAction(this.action());
    this.requested = true;
    this.evaluate();
  }

  private evaluate(): void {
    if (!this.ready || this.done) return;
    if (this.store.dialog()) this.sawDialog = true;
    if (this.store.conflict()) {
      this.conflict.emit();
      this.finish();
      return;
    }
    const task = this.store.task();
    if (task && task.rowVersion !== this.startVersion) {
      this.rowChange.emit(rowFromTask(this.row(), task));
      this.finish();
      return;
    }
    if (!this.store.dialog() && !this.store.busy() && (this.requested || this.sawDialog)) {
      this.finish();
    }
  }

  private finish(): void {
    this.done = true;
    this.finished.emit();
  }
}
