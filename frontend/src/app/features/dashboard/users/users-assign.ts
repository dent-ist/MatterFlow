import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { firstValueFrom } from 'rxjs';
import {
  TaskQueueClient,
  TaskQueueRow,
  TaskResponse,
  TasksClient,
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { outOfOfficeText } from '../../../core/availability/availability';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { UndoService } from '../../../core/notify/undo.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { SearchBox } from '../../../shared/ui/search-box';
import { emptyState, queueArgs } from '../../../shared/work-queue/queue-filters';
import { ageInDays } from '../ui/task-list-panel';
import { loadLevelOf, plural } from './users-model';

type LoadState = 'loading' | 'ready' | 'error';

/** How many unassigned tasks the picker lists (the most urgent first; the rest are in the Task Queue). */
export const ASSIGN_PAGE = 50;

/** The hint shown above the picker when the person is out of office or heavily loaded (assigning is still allowed), or null. */
export function assignHint(
  u: Pick<WorkloadUser, 'displayName' | 'openTotal' | 'availability' | 'loadLevel'>,
  thresholds: WorkloadThresholds | null | undefined,
  zone: string,
  now: Date,
): string | null {
  const ooo = outOfOfficeText(u.availability, zone, now);
  if (ooo) {
    return `${u.displayName} is not available (${ooo.charAt(0).toLowerCase()}${ooo.slice(1)}). You can still assign work.`;
  }
  if (loadLevelOf(u) === 'HEAVY') {
    return `${u.displayName} already has a heavy load (${plural(u.openTotal, 'open task')}, more than ${thresholds?.normalMax ?? 8}). You can still assign work.`;
  }
  return null;
}

/**
 * "Assign work to <name>": a modal picker of the open tasks nobody has, the most urgent first (the Task Queue's priority-and-age order).
 * Choosing one assigns it with the same Assign call and rules as the inline Assignee menu (a New task starts when it gets an assignee) and
 * offers Undo. When the person is out of office or heavily loaded a visible hint says so; assigning is still allowed. Operational only.
 */
@Component({
  selector: 'mf-users-assign',
  imports: [Dialog, DialogFocus, RouterLink, PriorityBadge, MatterRef, ErrorReference, SearchBox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="user() ? 'Assign work to ' + user()!.displayName : 'Assign work'"
      styleClass="mf-users-assign"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close assign work"
      [mfDialogFocus]="visible()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [style]="{ width: '40rem', maxWidth: '100vw' }"
    >
      @if (user(); as u) {
        <div class="assign" data-assign-dialog>
          @if (hint(); as h) {
            <p class="hint" role="note" data-assign-hint>
              <i class="pi pi-info-circle" aria-hidden="true"></i>
              <span>{{ h }}</span>
            </p>
          }
          <mf-search-box
            inputId="wl-assign-q"
            label="Search unassigned tasks"
            placeholder="Search title or number"
            [value]="query()"
            (searchChange)="search($event)"
          />
          <p class="order" data-assign-order>
            Unassigned open tasks, highest priority first, then oldest.
          </p>

          @switch (state()) {
            @case ('loading') {
              <div class="bones" role="status" aria-busy="true">
                <span class="sr-only">Loading unassigned tasks...</span>
                @for (n of bones; track n) {
                  <span class="bone" aria-hidden="true"></span>
                }
              </div>
            }
            @case ('error') {
              <div class="alert" role="alert" data-assign-error>
                <span>The unassigned tasks could not be loaded.</span>
                <mf-error-reference />
                <button type="button" class="mf-btn" data-assign-retry (click)="load()">
                  Retry
                </button>
              </div>
            }
            @default {
              @if (rows().length === 0) {
                <p class="empty" data-assign-empty>
                  <i class="pi pi-check-circle" aria-hidden="true"></i>
                  {{
                    query()
                      ? 'No unassigned task matches this search.'
                      : 'There are no unassigned tasks.'
                  }}
                </p>
              } @else {
                <ul class="rows" data-assign-list>
                  @for (r of rows(); track r.taskId) {
                    <li class="row" [attr.data-assign-row]="r.taskNumber">
                      <div class="main">
                        <a class="ref mf-ref" [routerLink]="['/tasks', r.taskId]" target="_blank">{{
                          r.taskNumber
                        }}</a>
                        <span class="title">{{ r.title }}</span>
                      </div>
                      <div class="meta">
                        <mf-priority-badge
                          [priorityId]="r.priority.priorityId"
                          [label]="r.priority.label"
                          [color]="r.priority.color"
                        />
                        <mf-matter-ref [value]="r.matterRef" [copy]="false" />
                        <span class="age">{{ ageText(r) }}</span>
                      </div>
                      <button
                        type="button"
                        class="mf-btn mf-btn--primary pick"
                        data-assign-pick
                        [disabled]="busy()"
                        [attr.aria-label]="'Assign ' + r.taskNumber + ' to ' + u.displayName"
                        (click)="pick(r)"
                      >
                        Assign
                      </button>
                    </li>
                  }
                </ul>
                @if (total() > rows().length) {
                  <p class="more" data-assign-more>
                    Showing {{ rows().length }} of {{ total() }}. The rest are in the Task Queue.
                  </p>
                }
              }
            }
          }
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .assign {
      display: grid;
      gap: var(--mf-s3);
    }
    .hint {
      display: flex;
      align-items: flex-start;
      gap: var(--mf-s2);
      margin: 0;
      padding: var(--mf-s2) var(--mf-s3);
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
      border: 1px solid var(--mf-warning);
      border-radius: var(--mf-radius);
    }
    .order,
    .more {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .rows {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mf-s1) var(--mf-s3);
      align-items: center;
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .main {
      display: flex;
      align-items: baseline;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ref {
      flex: none;
      color: var(--mf-link);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .pick {
      grid-row: 1 / span 2;
      grid-column: 2;
    }
    .empty {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      color: var(--mf-text-muted);
    }
    .bones {
      display: grid;
      gap: var(--mf-s2);
    }
    .bone {
      display: block;
      height: 3.5rem;
      background: var(--mf-surface-alt);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.55;
      }
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .alert {
      display: grid;
      gap: var(--mf-s2);
      justify-items: start;
      padding: var(--mf-s3);
      color: var(--mf-danger);
      background: var(--mf-danger-bg);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
    }
    @media (max-width: 560px) {
      .row {
        grid-template-columns: 1fr;
      }
      .pick {
        grid-row: auto;
        grid-column: auto;
      }
    }
  `,
})
export class UsersAssign {
  private readonly queue = inject(TaskQueueClient);
  private readonly tasks = inject(TasksClient);
  private readonly notify = inject(NotificationService);
  private readonly undo = inject(UndoService);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly injector = inject(Injector);
  private seq = 0;
  private destroyed = false;
  private openedFor: number | null = null;

  /** The person work is assigned to; null while the dialog is closed. */
  readonly user = input<WorkloadUser | null>(null);
  readonly thresholds = input<WorkloadThresholds | null>(null);
  readonly closed = output<void>();
  /** A task was assigned (or the assignment was undone): the board and the drawer read again. */
  readonly changed = output<void>();

  protected readonly bones = [1, 2, 3, 4];
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  protected readonly visible = computed(() => this.user() !== null);
  protected readonly hint = computed(() => {
    const u = this.user();
    return u ? assignHint(u, this.thresholds(), this.zone, this.clock.now()) : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const id = this.user()?.userId ?? null;
      untracked(() => {
        if (id === this.openedFor) return;
        this.openedFor = id;
        this.query.set('');
        this.rows.set([]);
        if (id !== null) this.load();
      });
    });
  }

  protected load(): void {
    const seq = ++this.seq;
    this.state.set('loading');
    const state = emptyState();
    state.filters.status = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];
    state.filters.unassigned = true;
    state.filters.q = this.query();
    state.sort = 'priorityAge';
    state.dir = 'asc';
    state.pageSize = ASSIGN_PAGE;
    void (async () => {
      try {
        const page = await firstValueFrom(this.queue.getTaskQueue(...queueArgs(state)));
        if (this.destroyed || seq !== this.seq) return;
        this.rows.set(page.items);
        this.total.set(page.total);
        this.state.set('ready');
      } catch {
        if (this.destroyed || seq !== this.seq) return;
        this.state.set('error');
      }
    })();
  }

  protected search(text: string): void {
    if (text === this.query()) return;
    this.query.set(text);
    this.load();
  }

  protected ageText(r: TaskQueueRow): string {
    const days = ageInDays(r.createdAtUtc, this.clock.now(), this.zone);
    return days === 0 ? 'Created today' : `${plural(days, 'day')} old`;
  }

  protected async pick(row: TaskQueueRow): Promise<void> {
    const u = this.user();
    if (!u || this.busy()) return;
    this.busy.set(true);
    const index = this.rows().findIndex((r) => r.taskId === row.taskId);
    try {
      const task = await firstValueFrom(
        this.tasks.assignTask(row.taskId, {
          rowVersion: row.rowVersion,
          podId: row.assignedPod?.podId,
          userId: u.userId,
        }),
      );
      this.rows.update((list) => list.filter((r) => r.taskId !== row.taskId));
      this.total.update((n) => Math.max(0, n - 1));
      const started = row.status === 'NEW' && task.status !== 'NEW';
      this.undo.offer(
        `${row.taskNumber} assigned to ${u.displayName}.` +
          (started
            ? ` Task moved to ${task.statusLabel}. Undo puts the assignee back; the status stays.`
            : ''),
        () => this.undoAssign(task, u),
      );
      this.changed.emit();
      this.focusAfter(index);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT') {
        this.notify.error('Someone else changed this task. The list was refreshed.');
        this.load();
      } else if (!(error instanceof ApiError) || error.hasFieldErrors) {
        // The HTTP layer already toasts other API failures.
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't assign that task. Try again.",
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Undo: only if the task still has the assignee this assignment gave it; nothing else is overwritten. */
  private async undoAssign(task: TaskResponse, u: WorkloadUser): Promise<void> {
    try {
      const fresh = await firstValueFrom(this.tasks.getTask(task.taskId));
      if (fresh.assignedUser?.userId !== u.userId) {
        this.notify.info(`Not undone: the assignee of ${fresh.taskNumber} was changed since.`);
        return;
      }
      const updated = await firstValueFrom(
        this.tasks.assignTask(task.taskId, {
          rowVersion: fresh.rowVersion,
          podId: fresh.assignedPod?.podId,
          userId: undefined,
        }),
      );
      this.notify.success(`${updated.taskNumber} assignee back to Unassigned.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONCURRENCY_CONFLICT') {
        this.notify.error(`Couldn't undo: someone else changed this task. Check it and try again.`);
      } else if (!(error instanceof ApiError) || error.hasFieldErrors) {
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't undo that change. Try again.",
        );
      } else {
        this.notify.error(`Couldn't undo the assignee change.`);
      }
    } finally {
      if (!this.destroyed) this.load();
      this.changed.emit();
    }
  }

  /** The assigned row left the list: focus goes to the next Assign button, else the one before it, else the close button. */
  private focusAfter(index: number): void {
    afterNextRender(
      () => {
        const buttons = [
          ...document.querySelectorAll<HTMLElement>('.mf-users-assign [data-assign-pick]'),
        ];
        const target =
          buttons[Math.min(index, buttons.length - 1)] ??
          document.querySelector<HTMLElement>(
            '.mf-users-assign button[aria-label="Close assign work"]',
          );
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onVisible(open: boolean): void {
    if (!open) this.closed.emit();
  }
}
