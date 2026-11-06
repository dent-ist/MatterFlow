import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Dropdown, DropdownItem } from '../ui/dropdown';
import { FormDialog } from '../ui/form-dialog';

/** The task the dialog moves: its number and title name it, `projectId` is where it is now (null: no project). */
export interface MoveTarget {
  readonly taskId: number;
  readonly taskNumber: string;
  readonly title: string;
  readonly projectId: number | null;
}

/**
 * "Move to Project..." of a task row in a Matter's Tasks grid (#1273): a small 416 px dialog with one white Project dropdown ("No Project" first, then
 * the matter's projects) and `[Cancel] [Move Task]`. The page makes the existing move call and closes the dialog (`(moved)` carries the chosen
 * project id, or null for "No Project"); `busy` and `error` come from it. The primary button is off until another project is chosen.
 */
@Component({
  selector: 'mf-move-task-dialog',
  imports: [FormDialog, Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .mt__field {
      display: grid;
      gap: var(--mf-s1);
    }
    .mt__label {
      font-weight: 600;
    }
    .mt__task {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      overflow-wrap: anywhere;
    }
  `,
  template: `
    <mf-form-dialog
      title="Move to Project"
      size="small"
      primaryLabel="Move Task"
      busyLabel="Moving..."
      [busy]="busy()"
      [error]="error()"
      [canSubmit]="changed()"
      [(visible)]="visible"
      (submitted)="submit()"
    >
      @if (task(); as t) {
        <p class="mt__task" data-move-task>{{ t.taskNumber }} {{ t.title }}</p>
      }
      <div class="mt__field">
        <label class="mt__label" for="move-project">Project</label>
        <mf-dropdown
          field
          buttonId="move-project"
          label="Project"
          data-move-project
          [items]="projects()"
          [value]="choice()"
          (valueChange)="choice.set($event)"
        />
      </div>
    </mf-form-dialog>
  `,
})
export class MoveTaskDialog {
  readonly task = input<MoveTarget | null>(null);
  /** "No Project" (value '') first, then the matter's projects. */
  readonly projects = input<readonly DropdownItem[]>([]);
  readonly visible = model(false);
  readonly busy = input(false);
  readonly error = input('');
  /** The person pressed Move Task: the project id, or null for "No Project". */
  readonly moved = output<number | null>();

  /** The dropdown's value: '' for no project, else the project id as text. */
  protected readonly choice = signal('');
  private readonly current = computed(() => {
    const id = this.task()?.projectId;
    return id === null || id === undefined ? '' : String(id);
  });
  protected readonly changed = computed(() => this.choice() !== this.current());

  constructor() {
    // Each time the dialog opens it starts on the task's present project.
    effect(() => {
      if (this.visible()) untracked(() => this.choice.set(this.current()));
    });
  }

  protected submit(): void {
    if (!this.changed()) return;
    this.moved.emit(this.choice() === '' ? null : Number(this.choice()));
  }
}
