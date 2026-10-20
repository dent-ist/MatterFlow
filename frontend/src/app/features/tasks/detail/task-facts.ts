import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  TaskQueueRow,
  TaskResponse,
  TaskTransitionOption,
} from '../../../api/generated/api-client';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { DueEdit } from './task-due-edit';
import { TaskDetailStore } from './task-detail.store';

/** The fields of a queue row that the inline editors read, taken from the Task. */
function rowOfTask(t: TaskResponse): TaskQueueRow {
  return {
    taskId: t.taskId,
    taskNumber: t.taskNumber,
    title: t.title,
    matterId: t.matter.matterId,
    matterIsActive: t.matter.isActive,
    priority: t.priority,
    status: t.status,
    statusLabel: t.statusLabel,
    assignedPod: t.assignedPod,
    assignedUser: t.assignedUser,
    isAsap: t.isAsap,
    isOverdue: t.isOverdue,
    updatedAtUtc: t.modifiedAtUtc,
    completedAtUtc: t.completedAtUtc,
    statusChangedAtUtc: t.statusChangedAtUtc,
    rowVersion: t.rowVersion,
  } as TaskQueueRow;
}

/**
 * Runs `then` once no dialog is on screen. A dialog that has just closed stays in the page until its leave animation ends and its focus trap
 * pulls focus back into it meanwhile, so focus put elsewhere before then is lost (K3, #328). Gives up after 2 seconds and runs anyway.
 */
function whenNoDialog(then: () => void): void {
  if (!document.querySelector('.p-dialog-mask')) {
    then();
    return;
  }
  const watcher = new MutationObserver(() => {
    if (document.querySelector('.p-dialog-mask')) return;
    done();
  });
  const giveUp = setTimeout(() => done(), 2000);
  function done(): void {
    watcher.disconnect();
    clearTimeout(giveUp);
    then();
  }
  watcher.observe(document.body, { childList: true, subtree: true });
}

/**
 * The facts strip of the Task page (H2, #297): exactly six tiles, each fact once: Status, Priority, Due, Assignee, Pod and the workflow
 * progress. Status, Priority and Assignee are the same inline menus as in the work tables (`mf-row-edit`) for people who may change them and
 * plain text or badges for the others; the other tiles are read-only. The Task type, the Matter, the Client and the workflow name are in the
 * header's context line, not here. The look is `.mf-facts` (styles/_facts-strip.scss), the tile look of the work strip.
 */
@Component({
  selector: 'mf-task-facts',
  imports: [RowEdit, StatusBadge, PriorityBadge, DueCell, DueEdit],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.task(); as t) {
      <ul class="mf-facts" aria-label="Task facts" data-facts>
        <li class="mf-facts__tile" data-status>
          <span class="mf-facts__label">Status</span>
          <span class="mf-facts__value mf-facts__value--chip">
            @if (statusEditable()) {
              <mf-row-edit
                field="status"
                [row]="row()"
                [transitions]="items()"
                [statusDelegated]="true"
                [completeNote]="store.completeHint()"
                (statusAction)="store.requestAction($event)"
              />
            } @else {
              <mf-status-badge [code]="t.status" [label]="t.statusLabel" />
            }
          </span>
        </li>
        <li class="mf-facts__tile" data-priority>
          <span class="mf-facts__label">Priority</span>
          <span class="mf-facts__value mf-facts__value--chip">
            @if (priorityEditable()) {
              <mf-row-edit
                field="priority"
                [row]="row()"
                (rowChange)="override.set({ basis: t, row: $event })"
                (taskChange)="saved($event)"
              />
            } @else {
              <mf-priority-badge
                [priorityId]="t.priority.priorityId"
                [label]="t.priority.label"
                [color]="t.priority.color"
              />
            }
          </span>
        </li>
        <li class="mf-facts__tile" data-due>
          <span class="mf-facts__label">Due</span>
          <span class="mf-facts__value" [class.mf-facts__value--chip]="dueEditable()">
            @if (dueEditable()) {
              <mf-due-edit (announce)="say($event)" />
            } @else {
              <mf-due-cell
                layout="inline"
                [due]="{ dueDate: t.dueDate, dueAtUtc: t.dueAtUtc }"
                [status]="t.status"
                [wasDue]="true"
              />
            }
          </span>
          <span class="mf-sr-only" role="status" data-due-live>{{ dueLive() }}</span>
        </li>
        <li class="mf-facts__tile" data-assignee>
          <span class="mf-facts__label">Assignee</span>
          <span
            class="mf-facts__value mf-facts__value--chip"
            [attr.title]="assigneeEditable() ? null : (t.assignedUser?.displayName ?? null)"
          >
            @if (assigneeEditable()) {
              <mf-row-edit
                field="assignee"
                [selfAssign]="true"
                [row]="row()"
                (rowChange)="override.set({ basis: t, row: $event })"
                (taskChange)="saved($event)"
              />
            } @else {
              {{ t.assignedUser?.displayName ?? 'Unassigned' }}
            }
          </span>
        </li>
        <li class="mf-facts__tile" data-pod>
          <span class="mf-facts__label">Pod</span>
          <span class="mf-facts__value" [attr.title]="t.assignedPod?.name ?? null">
            @if (t.assignedPod; as pod) {
              {{ pod.name }}
            } @else {
              <span aria-hidden="true">&ndash;</span><span class="mf-sr-only">No pod</span>
            }
          </span>
        </li>
        <li class="mf-facts__tile" data-workflow-progress>
          <span class="mf-facts__label">Workflow</span>
          <span class="mf-facts__value" data-progress>
            @if (t.workflow.progress.total > 0) {
              {{ t.workflow.progress.resolved }} of {{ t.workflow.progress.total }} resolved
            } @else {
              No steps
            }
          </span>
        </li>
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      margin-top: var(--mf-s2);
    }
    /* A menu chip sits in the value line; its own padding stays, so the tile is as tall as the others. */
    .mf-facts__value--chip {
      overflow: visible;
    }
    mf-due-cell {
      font-size: var(--mf-fs-md);
    }
  `,
})
export class TaskFacts {
  protected readonly store = inject(TaskDetailStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // After Complete, Hold, Resume, Reopen or Cancel (from the header, its overflow or a dialog) focus goes to the Status menu button, never to
    // <body>: the button that was used is gone or replaced by then (K3, #328). Without a Status menu (a person who may not change it) the
    // page heading takes it.
    let seen = this.store.statusFocus();
    effect(() => {
      const count = this.store.statusFocus();
      if (count === seen) return;
      seen = count;
      untracked(() =>
        afterNextRender(() => whenNoDialog(() => this.focusStatus()), { injector: this.injector }),
      );
    });
  }

  /** The Status menu button, else the page heading (a person who may not change the status has no menu). */
  private focusStatus(): void {
    const trigger = this.host.nativeElement.querySelector<HTMLElement>(
      '[data-status] [data-inline-trigger]',
    );
    if (trigger) {
      trigger.focus();
      return;
    }
    const heading = this.host.nativeElement
      .closest('[data-task-header]')
      ?.querySelector<HTMLElement>('[data-page-title]');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }

  /** A change made from a chip, shown at once; it only counts while the Task it was made on is still the one on screen. */
  protected readonly override = signal<{ basis: TaskResponse; row: TaskQueueRow } | null>(null);

  protected readonly row = computed<TaskQueueRow>(() => {
    const t = this.store.task()!;
    const o = this.override();
    return o && o.basis === t ? o.row : rowOfTask(t);
  });

  /** Transitions shown in the menu: not the ones the caller lacks permission for. */
  protected readonly items = computed<TaskTransitionOption[]>(() =>
    (this.store.task()?.allowedActions.transitions ?? []).filter(
      (o) => o.permitted || o.blockedReason !== 'PERMISSION_DENIED',
    ),
  );

  // While the Details form is open the chips are plain: a change from here would make the form's version stale.
  protected readonly statusEditable = computed(
    () => !this.store.editing() && this.items().length > 0,
  );
  protected readonly priorityEditable = computed(
    () => !this.store.editing() && !!this.store.task()?.allowedActions.canSetPriority,
  );
  protected readonly assigneeEditable = computed(
    () => !this.store.editing() && !!this.store.task()?.allowedActions.canAssign,
  );

  /** Due is editable for a person who may edit the task (not Completed or Cancelled: the server says so in `canEdit`). */
  protected readonly dueEditable = computed(
    () => !this.store.editing() && !!this.store.task()?.allowedActions.canEdit,
  );

  /** The polite announcement of a Due change; cleared first so the same words twice are read twice. */
  protected readonly dueLive = signal('');
  protected say(text: string): void {
    this.dueLive.set('');
    setTimeout(() => this.dueLive.set(text), 50);
  }

  /** The server's answer to a Priority or Assignee change (or the refreshed Task after a conflict). */
  protected saved(task: TaskResponse): void {
    this.store.task.set(task);
    this.store.warnings.set(task.warnings ?? []);
    this.store.conflict.set(false);
  }
}
