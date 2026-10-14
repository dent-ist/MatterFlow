import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
  TasksClient,
  UsersLookupClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { ApiError } from '../../core/http/api-error';
import { LookupStore } from '../../core/lookups/lookup-store';
import { NotificationService } from '../../core/notify/notification.service';
import { ACTION_LABELS } from '../../features/tasks/detail/task-detail.store';
import { PriorityBadge } from '../ui/priority-badge';
import { StatusBadge } from '../ui/status-badge';
import { InlineField, StatusAction, rowFromTask, statusChoices } from './inline-edit';
import { InlineMenu, MenuOption } from './inline-menu';
import { InlineStatusFlow } from './inline-status-flow';

interface Person {
  id: number;
  name: string;
}

const UNASSIGNED = 'none';
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

  readonly field = input.required<InlineField>();
  readonly row = input.required<TaskQueueRow>();
  readonly rowChange = output<TaskQueueRow>();

  protected readonly busy = signal(false);
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
      case 'status':
        return statusChoices(r, (p) => this.auth.has(p)).map((c) => ({
          id: c.action,
          label: ACTION_LABELS[c.action] ?? c.action,
          hint: this.lookups.statusLabel(c.target),
          disabled: !!c.blockedReason,
          reason: c.blockedReason,
        }));
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
                  ? ` Task moved to ${t.statusLabel}.`
                  : ''),
        );
        return;
      }
      case 'status': {
        const action = option.id as StatusAction;
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
  ): Promise<void> {
    const before = this.row();
    this.busy.set(true);
    this.rowChange.emit({ ...before, ...optimistic });
    try {
      const task = await firstValueFrom(call(before.rowVersion));
      this.rowChange.emit(rowFromTask(before, task));
      this.notify.success(success(task));
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
      this.rowChange.emit(
        rowFromTask(basis, await firstValueFrom(this.tasks.getTask(basis.taskId))),
      );
    } catch {
      /* the row stays as it was; the next list load shows the truth */
    }
  }

  protected flowDone(): void {
    this.flow.set(null);
    setTimeout(() => this.menu()?.focusTrigger());
  }
}
