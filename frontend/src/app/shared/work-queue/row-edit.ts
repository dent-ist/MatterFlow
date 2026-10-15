import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import {
  PodsClient,
  TaskQueueRow,
  TaskResponse,
  TaskTransitionOption,
  TasksClient,
  UsersLookupClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { LookupStore } from '../../core/lookups/lookup-store';
import { NotificationService } from '../../core/notify/notification.service';
import { UndoService } from '../../core/notify/undo.service';
import { ACTION_LABELS } from '../../features/tasks/detail/task-detail.store';
import { PriorityBadge } from '../ui/priority-badge';
import { StatusBadge } from '../ui/status-badge';
import {
  InlineField,
  MATTER_INACTIVE_TEXT,
  StatusAction,
  rowFromTask,
  statusChoices,
} from './inline-edit';
import { InlineMenu, MenuOption } from './inline-menu';
import { InlineStatusFlow } from './inline-status-flow';

interface Person {
  id: number;
  name: string;
}

const UNASSIGNED = 'none';

/** What an Undo needs to put a Priority or Assignee change back. */
interface UndoSpec {
  field: 'priority' | 'assignee';
  /** The value this edit set (priority id or user id), to notice when someone changed it again. */
  applied: number | undefined;
  /** The value to put back. */
  previous: number | undefined;
  previousLabel: string;
}
/** Changes that need a dialog (reason, confirmation or the unresolved-steps check). */
const DIALOG_ACTIONS: readonly string[] = ['HOLD', 'CANCEL', 'COMPLETE', 'REOPEN'];

/**
 * One editable cell of the work tables: shows the Status, Priority or Assignee with a chevron, opens a menu, and applies the
 * choice at once (optimistic) through the same Task API calls as the detail page. A failure puts the old value back and
 * toasts; a rowVersion conflict refreshes the row. Reports every row state through `rowChange`.
 */
@Component({
  selector: 'mf-row-edit',
  imports: [InlineMenu, InlineStatusFlow, PriorityBadge, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .re-me {
      margin-left: var(--mf-s2);
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      font-size: var(--mf-fs-sm);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    .re-me:disabled {
      color: var(--mf-text-disabled);
      cursor: default;
    }
  `,
  template: `
    @let r = row();
    <mf-inline-menu
      [label]="triggerLabel()"
      [menuLabel]="menuLabel()"
      [options]="options()"
      [searchable]="field() === 'assignee'"
      [searchLabel]="'Search people'"
      [emptyText]="field() === 'assignee' ? 'No people found.' : 'No options.'"
      [loading]="loading()"
      [busy]="busy()"
      (opened)="onOpened()"
      (searched)="onSearch($event)"
      (picked)="onPick($event)"
    >
      @switch (field()) {
        @case ('status') {
          <mf-status-badge [code]="r.status" [label]="r.statusLabel" />
        }
        @case ('priority') {
          <mf-priority-badge
            [priorityId]="r.priority.priorityId"
            [label]="r.priority.label"
            [color]="r.priority.color"
          />
        }
        @case ('assignee') {
          @if (r.assignedUser; as user) {
            {{ user.displayName }}
            @if (!user.isActive) {
              (inactive)
            }
          } @else {
            Unassigned
          }
        }
      }
    </mf-inline-menu>
    @if (field() === 'assignee' && assignMe() && !r.assignedUser && myId() > 0) {
      <button
        type="button"
        class="re-me"
        data-assign-me
        [disabled]="busy()"
        [attr.aria-label]="'Assign ' + r.taskNumber + ' to me'"
        (click)="assignToMe()"
      >
        Assign to me
      </button>
    }
    @if (flow(); as action) {
      <mf-inline-status-flow
        [row]="r"
        [action]="action"
        (rowChange)="rowChange.emit($event)"
        (conflict)="onConflict()"
        (finished)="flowDone()"
      />
    }
  `,
})
export class RowEdit {
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly tasks = inject(TasksClient);
  private readonly pods = inject(PodsClient);
  private readonly users = inject(UsersLookupClient);
  private readonly notify = inject(NotificationService);
  private readonly undoService = inject(UndoService);
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  readonly field = input.required<InlineField>();
  readonly row = input.required<TaskQueueRow>();
  /** True where the page runs the status changes itself (the Task header), so a status pick is only reported. */
  readonly statusDelegated = input(false);
  /**
   * The server's list of allowed transitions, where the page has it (the Task header). It then decides the status choices
   * instead of the lifecycle matrix and the caller's permissions.
   */
  readonly transitions = input<TaskTransitionOption[] | null>(null);
  /** Assignee cell only: adds an "Assign to me" button next to the menu for a Task nobody is assigned to (the Dashboard's unassigned queue). */
  readonly assignMe = input(false);
  readonly rowChange = output<TaskQueueRow>();
  /** The Task as the server returned it after a change (or after a conflict refresh), for screens that show the whole Task. */
  readonly taskChange = output<TaskResponse>();
  /** The picked status action when `statusDelegated` is set. */
  readonly statusAction = output<StatusAction>();

  protected readonly busy = signal(false);
  protected readonly myId = computed(() => this.auth.profile()?.userId ?? 0);
  protected readonly loading = signal(false);
  protected readonly flow = signal<StatusAction | null>(null);
  private readonly people = signal<Person[]>([]);
  private readonly podMode = signal(false);
  private readonly query = signal('');
  private searchSeq = 0;
  private readonly menu = viewChild(InlineMenu);

  protected readonly triggerLabel = computed(() => {
    const r = this.row();
    switch (this.field()) {
      case 'status':
        return `Change status of ${r.taskNumber}, currently ${r.statusLabel}`;
      case 'priority':
        return `Change priority of ${r.taskNumber}, currently ${r.priority.label}`;
      case 'assignee':
        return `Change assignee of ${r.taskNumber}, currently ${r.assignedUser?.displayName ?? 'unassigned'}`;
    }
  });

  protected readonly menuLabel = computed(
    () =>
      ({ status: 'Change status', priority: 'Set priority', assignee: 'Assign to' })[this.field()],
  );

  protected readonly options = computed<MenuOption[]>(() => {
    const r = this.row();
    switch (this.field()) {
      case 'status': {
        const server = this.transitions();
        if (server) {
          return server
            .filter((o) => o.permitted || o.blockedReason !== 'PERMISSION_DENIED')
            .map((o) => ({
              id: o.action,
              label: ACTION_LABELS[o.action] ?? o.action,
              hint: this.lookups.statusLabel(o.targetStatus),
              disabled: !o.permitted,
              reason: o.permitted
                ? undefined
                : o.blockedReason === 'MATTER_INACTIVE'
                  ? MATTER_INACTIVE_TEXT
                  : "This action isn't available right now.",
            }));
        }
        return statusChoices(r, (p) => this.auth.has(p)).map((c) => ({
          id: c.action,
          label: ACTION_LABELS[c.action] ?? c.action,
          hint: this.lookups.statusLabel(c.target),
          disabled: !!c.blockedReason,
          reason: c.blockedReason,
        }));
      }
      case 'priority': {
        const list = this.lookups
          .activePriorities()
          .map((p) => ({ id: String(p.id), label: p.label }));
        if (!list.some((o) => o.id === String(r.priority.priorityId))) {
          list.push({ id: String(r.priority.priorityId), label: r.priority.label });
        }
        return list.map((o) => ({ ...o, selected: o.id === String(r.priority.priorityId) }));
      }
      case 'assignee': {
        const q = this.query().trim().toLowerCase();
        const shown = this.podMode()
          ? this.people().filter((p) => !q || p.name.toLowerCase().includes(q))
          : this.people();
        const list: MenuOption[] = shown.map((p) => ({
          id: String(p.id),
          label: p.name,
          selected: p.id === r.assignedUser?.userId,
        }));
        return r.assignedUser
          ? [{ id: UNASSIGNED, label: 'Unassigned', hint: 'Remove the assignee' }, ...list]
          : list;
      }
    }
  });

  /** Assigns the Task to the signed-in user, exactly as picking them in the menu would (a New Task starts, Undo is offered). */
  protected async assignToMe(): Promise<void> {
    const me = this.auth.profile();
    if (!me || this.busy()) return;
    await this.onPick({ id: String(me.userId), label: me.displayName });
  }

  // ---- opening and searching (assignee)

  protected async onOpened(): Promise<void> {
    if (this.field() !== 'assignee') return;
    const podId = this.row().assignedPod?.podId;
    this.query.set('');
    this.people.set([]);
    this.loading.set(true);
    try {
      if (podId !== undefined && this.auth.has('Pod.View')) {
        try {
          const pod = await firstValueFrom(this.pods.getPod(podId));
          this.people.set(
            pod.members
              .filter((m) => m.isActive)
              .map((m) => ({ id: m.userId, name: m.displayName })),
          );
          this.podMode.set(true);
          return;
        } catch {
          /* fall through to the general lookup */
        }
      }
      this.podMode.set(false);
      await this.lookup('');
    } finally {
      this.loading.set(false);
    }
  }

  protected async onSearch(text: string): Promise<void> {
    this.query.set(text);
    if (!this.podMode()) await this.lookup(text);
  }

  private async lookup(text: string): Promise<void> {
    const seq = ++this.searchSeq;
    try {
      const found = await firstValueFrom(this.users.lookupUsers(text || undefined, 8));
      if (seq === this.searchSeq) {
        this.people.set(found.map((u) => ({ id: u.userId, name: u.displayName })));
      }
    } catch {
      if (seq === this.searchSeq) this.people.set([]);
    }
  }

  // ---- applying a choice

  protected async onPick(option: MenuOption): Promise<void> {
    const r = this.row();
    switch (this.field()) {
      case 'priority': {
        const id = +option.id;
        if (id === r.priority.priorityId) return;
        const p = this.lookups.priority(id);
        await this.apply(
          {
            priority: {
              priorityId: id,
              label: option.label,
              color: p?.color ?? r.priority.color,
              sortOrder: p?.sortOrder ?? r.priority.sortOrder,
            },
          },
          (rowVersion) => this.tasks.setTaskPriority(r.taskId, { rowVersion, priorityId: id }),
          () => `${r.taskNumber} priority set to ${option.label}.`,
          {
            field: 'priority',
            applied: id,
            previous: r.priority.priorityId,
            previousLabel: r.priority.label,
          },
        );
        return;
      }
      case 'assignee': {
        const userId = option.id === UNASSIGNED ? undefined : +option.id;
        if (userId === r.assignedUser?.userId) return;
        // A user on a New task starts it (addendum A); the server's answer decides what the row finally shows.
        const starts = userId !== undefined && r.status === 'NEW';
        await this.apply(
          {
            assignedUser:
              userId === undefined
                ? undefined
                : { userId, displayName: option.label, isActive: true },
            ...(starts
              ? { status: 'IN_PROGRESS', statusLabel: this.lookups.statusLabel('IN_PROGRESS') }
              : {}),
          },
          (rowVersion) =>
            this.tasks.assignTask(r.taskId, {
              rowVersion,
              podId: r.assignedPod?.podId,
              userId,
            }),
          (t) =>
            userId === undefined
              ? `${r.taskNumber} is unassigned.`
              : `${r.taskNumber} assigned to ${option.label}.` +
                (r.status === 'NEW' && t.status !== 'NEW'
                  ? ` Task moved to ${t.statusLabel}. Undo puts the assignee back; the status stays.`
                  : ''),
          {
            field: 'assignee',
            applied: userId,
            previous: r.assignedUser?.userId,
            previousLabel: r.assignedUser?.displayName ?? 'Unassigned',
          },
        );
        return;
      }
      case 'status': {
        const action = option.id as StatusAction;
        if (this.statusDelegated()) {
          this.statusAction.emit(action);
          return;
        }
        if (DIALOG_ACTIONS.includes(action)) {
          this.flow.set(action);
          return;
        }
        // Start and Resume: straight to In Progress.
        await this.apply(
          { status: 'IN_PROGRESS', statusLabel: this.lookups.statusLabel('IN_PROGRESS') },
          (rowVersion) =>
            this.tasks.changeTaskStatus(r.taskId, { rowVersion, status: 'IN_PROGRESS' }),
          (t) => `${r.taskNumber} is ${t.statusLabel}.`,
        );
      }
    }
  }

  /** Optimistic write: show the choice now, replace it with the server's row, or put the old row back and say why. */
  private async apply(
    optimistic: Partial<TaskQueueRow>,
    call: (rowVersion: string) => Observable<TaskResponse>,
    success: (task: TaskResponse) => string,
    undo?: UndoSpec,
  ): Promise<void> {
    const before = this.row();
    this.busy.set(true);
    this.rowChange.emit({ ...before, ...optimistic });
    try {
      const task = await firstValueFrom(call(before.rowVersion));
      this.rowChange.emit(rowFromTask(before, task));
      this.taskChange.emit(task);
      if (undo) this.undoService.offer(success(task), () => this.undoChange(task.taskId, undo));
      else this.notify.success(success(task));
    } catch (error) {
      this.rowChange.emit(before);
      if (error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT') {
        await this.onConflict(before);
      } else if (!(error instanceof ApiError) || error.hasFieldErrors) {
        // The HTTP layer already toasts other API failures.
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't save that change. Try again.",
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async onConflict(basis: TaskQueueRow = this.row()): Promise<void> {
    this.notify.error('Someone else changed this task. The row was refreshed.');
    try {
      const fresh = await firstValueFrom(this.tasks.getTask(basis.taskId));
      this.rowChange.emit(rowFromTask(basis, fresh));
      this.taskChange.emit(fresh);
    } catch {
      /* the row stays as it was; the next list load shows the truth */
    }
  }

  /**
   * Undo of a Priority or Assignee edit: reads the Task again for its current rowVersion and puts the previous value back,
   * unless someone has changed that field since (then nothing is overwritten and the user is told). Reports its own outcome.
   */
  private async undoChange(taskId: number, spec: UndoSpec): Promise<void> {
    const name = spec.field === 'priority' ? 'priority' : 'assignee';
    try {
      const fresh = await firstValueFrom(this.tasks.getTask(taskId));
      const current =
        spec.field === 'priority' ? fresh.priority.priorityId : fresh.assignedUser?.userId;
      if (current !== spec.applied) {
        this.showTask(fresh);
        this.notify.info(`Not undone: the ${name} of ${fresh.taskNumber} was changed since.`);
        return;
      }
      const updated = await firstValueFrom(
        spec.field === 'priority'
          ? this.tasks.setTaskPriority(taskId, {
              rowVersion: fresh.rowVersion,
              priorityId: spec.previous as number,
            })
          : this.tasks.assignTask(taskId, {
              rowVersion: fresh.rowVersion,
              podId: fresh.assignedPod?.podId,
              userId: spec.previous,
            }),
      );
      this.showTask(updated);
      this.notify.success(`${updated.taskNumber} ${name} back to ${spec.previousLabel}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT') {
        this.notify.error(`Couldn't undo: someone else changed this task. Check it and try again.`);
        try {
          this.showTask(await firstValueFrom(this.tasks.getTask(taskId)));
        } catch {
          /* the next list load shows the truth */
        }
      } else if (!(error instanceof ApiError) || error.hasFieldErrors) {
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't undo that change. Try again.",
        );
      } else {
        // The HTTP layer toasts the failure; add what it means for the Undo.
        this.notify.error(`Couldn't undo the ${name} change.`);
      }
    }
  }

  private showTask(task: TaskResponse): void {
    if (this.destroyed) return;
    this.rowChange.emit(rowFromTask(this.row(), task));
    this.taskChange.emit(task);
  }

  protected flowDone(): void {
    this.flow.set(null);
    setTimeout(() => this.menu()?.focusTrigger());
  }
}
