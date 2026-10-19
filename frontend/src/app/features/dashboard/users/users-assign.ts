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
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { SearchBox } from '../../../shared/ui/search-box';
import { emptyState, taskQueueArgs } from '../../../shared/work-queue/queue-filters';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { ageInDays } from '../ui/task-list-panel';
import { loadLevelOf, plural } from './users-model';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';

type LoadState = 'loading' | 'ready' | 'error';

/** How many unassigned tasks the picker lists (the most urgent first; the rest are in the Task Queue). */
export const ASSIGN_PAGE = 50;
/** "Assign the next N": fixed at 3 (PM decision, #132). */
export const ASSIGN_NEXT = 3;
/** The server accepts at most this many tasks in one batch. */
export const ASSIGN_MAX = 10;

const ALL_PODS_KEY = 'mf.users.assign.allPods';
function readAllPods(): boolean {
  try {
    return sessionStorage.getItem(ALL_PODS_KEY) === '1';
  } catch {
    return false;
  }
}
function writeAllPods(on: boolean): void {
  try {
    sessionStorage.setItem(ALL_PODS_KEY, on ? '1' : '0');
  } catch {
    // The choice is only remembered for the session; without storage it applies to this dialog only.
  }
}

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
  imports: [
    Dialog,
    DialogFocus,
    RouterLink,
    PriorityBadge,
    MatterRef,
    ErrorReference,
    SearchBox,
    TaskTypeIcon,
    DueCell,
  ],
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
          @if (!confirming() && hint(); as h) {
            <p class="hint" role="note" data-assign-hint>
              <i class="pi pi-info-circle" aria-hidden="true"></i>
              <span>{{ h }}</span>
            </p>
          }
          <p class="sr-only" role="status" aria-live="polite" data-assign-live>{{ live() }}</p>

          @if (confirming(); as picked) {
            <section class="confirm" data-assign-confirm aria-labelledby="wl-assign-confirm-h">
              <h3 id="wl-assign-confirm-h" class="h">
                Assign
                {{ picked.length === 1 ? 'this task' : 'these ' + picked.length + ' tasks' }} to
                {{ u.displayName }}?
              </h3>
              @if (hint(); as h) {
                <p class="hint" role="note" data-assign-confirm-hint>
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  <span>{{ h }}</span>
                </p>
              }
              <ul class="rows" data-assign-confirm-list>
                @for (r of picked; track r.taskId) {
                  <li class="row row--plain" [attr.data-confirm-row]="r.taskNumber">
                    <div class="main">
                      <span class="ref mf-ref">{{ r.taskNumber }}</span>
                      <span class="title" [attr.title]="r.title">{{ r.title }}</span>
                    </div>
                    <div class="meta">
                      <mf-priority-badge
                        [priorityId]="r.priority.priorityId"
                        [label]="r.priority.label"
                        [color]="r.priority.color"
                      />
                      <span>{{ r.clientName }}</span>
                    </div>
                  </li>
                }
              </ul>
              @if (batchError()) {
                <div class="alert" role="alert" data-assign-batch-error>
                  <span>The tasks could not be assigned.</span>
                  <mf-error-reference />
                </div>
              }
              <div class="bar">
                <button
                  type="button"
                  class="mf-btn mf-btn--primary"
                  data-assign-confirm-ok
                  [disabled]="busy()"
                  (click)="confirmBatch()"
                >
                  Assign {{ picked.length === 1 ? 'task' : picked.length + ' tasks' }}
                </button>
                <button
                  type="button"
                  class="mf-btn"
                  data-assign-confirm-back
                  [disabled]="busy()"
                  (click)="cancelConfirm()"
                >
                  Back
                </button>
              </div>
            </section>
          } @else {
            @if (inPods()) {
              <label class="allpods">
                <input
                  type="checkbox"
                  role="switch"
                  data-assign-allpods
                  [checked]="allPods()"
                  (change)="setAllPods($any($event.target).checked)"
                />
                All pods
              </label>
            } @else {
              <p class="note" data-assign-nopod>{{ u.displayName }} is not in a pod.</p>
            }
            <mf-search-box
              inputId="wl-assign-q"
              label="Search unassigned tasks"
              placeholder="Search title or number"
              [value]="query()"
              (searchChange)="search($event)"
            />
            <p class="order" data-assign-order>
              {{ orderText() }}
            </p>

            @if (failures().length > 0) {
              <div class="alert" role="alert" data-assign-failures>
                <strong>Not assigned:</strong>
                <ul>
                  @for (f of failures(); track f.taskNumber) {
                    <li>{{ f.taskNumber }}: {{ f.message }}</li>
                  }
                </ul>
              </div>
            }

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
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    data-assign-retry
                    aria-label="Retry"
                    title="Retry"
                    (click)="load()"
                  >
                    <i class="pi pi-refresh" aria-hidden="true"></i>
                  </button>
                </div>
              }
              @default {
                @if (rows().length === 0) {
                  <p class="empty" data-assign-empty>
                    <i class="pi pi-check-circle" aria-hidden="true"></i>
                    @if (query()) {
                      No unassigned task matches this search.
                    } @else if (podScoped()) {
                      No unassigned tasks in {{ firstName() }}'s pods.
                      <button
                        type="button"
                        class="linkbtn"
                        data-assign-show-all
                        (click)="setAllPods(true)"
                      >
                        Show all pods
                      </button>
                    } @else {
                      There are no unassigned tasks.
                    }
                  </p>
                } @else {
                  <div class="bar" data-assign-bar>
                    <button
                      type="button"
                      class="mf-btn mf-btn--primary"
                      data-assign-next
                      [disabled]="busy()"
                      (click)="startNext()"
                    >
                      Assign the next {{ nextCount() }}
                    </button>
                    <button
                      type="button"
                      class="mf-btn"
                      data-assign-selected
                      [disabled]="busy() || selectedRows().length === 0"
                      (click)="startSelected()"
                    >
                      Assign {{ selectedRows().length }} selected
                    </button>
                    <span class="muted">Up to {{ max }} at a time.</span>
                  </div>
                  <ul class="rows" data-assign-list>
                    @for (r of rows(); track r.taskId) {
                      <li class="row" [attr.data-assign-row]="r.taskNumber">
                        <input
                          type="checkbox"
                          class="chk"
                          data-assign-check
                          [checked]="selected().has(r.taskId)"
                          [disabled]="
                            busy() || (!selected().has(r.taskId) && selected().size >= max)
                          "
                          [attr.aria-label]="'Select ' + r.taskNumber"
                          (change)="toggle(r, $any($event.target).checked)"
                        />
                        <div class="main">
                          <a
                            class="ref mf-ref"
                            [routerLink]="['/tasks', r.taskId]"
                            [queryParams]="origin.params('dashboard')"
                            [state]="origin.state()"
                            target="_blank"
                            >{{ r.taskNumber }}</a
                          >
                          <span
                            class="type"
                            role="img"
                            data-type
                            [attr.aria-label]="r.taskTypeName"
                            [attr.title]="r.taskTypeName"
                          >
                            <mf-task-type-icon [iconKey]="r.taskTypeIconKey" size="sm" />
                          </span>
                          <span class="title" [attr.title]="r.title">{{ r.title }}</span>
                        </div>
                        <div class="meta">
                          <mf-priority-badge
                            [priorityId]="r.priority.priorityId"
                            [label]="r.priority.label"
                            [color]="r.priority.color"
                          />
                          <span class="client" data-client>{{ r.clientName }}</span>
                          <mf-matter-ref [value]="r.matterRef" [copy]="false" />
                          @if (r.dueDate || r.dueAtUtc) {
                            <mf-due-cell layout="inline" [due]="r" [status]="r.status" />
                          }
                          <span class="age">{{ ageText(r) }}</span>
                        </div>
                        <button
                          type="button"
                          class="mf-btn mf-btn--icon mf-btn--primary pick"
                          data-assign-pick
                          [disabled]="busy()"
                          [attr.aria-label]="'Assign ' + r.taskNumber + ' to ' + u.displayName"
                          [attr.title]="'Assign ' + r.taskNumber + ' to ' + u.displayName"
                          (click)="pick(r)"
                        >
                          <i class="pi pi-user-plus" aria-hidden="true"></i>
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
      grid-template-columns: auto minmax(0, 1fr) auto;
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
    .row--plain {
      grid-template-columns: minmax(0, 1fr);
    }
    .chk {
      grid-row: 1 / span 2;
      width: 1.25rem;
      height: 1.25rem;
    }
    .main {
      grid-column: 2;
    }
    .meta {
      grid-column: 2;
    }
    .row--plain .main,
    .row--plain .meta {
      grid-column: 1;
    }
    .pick {
      grid-row: 1 / span 2;
      grid-column: 3;
    }
    .type {
      flex: none;
      display: inline-flex;
      align-self: center;
      color: var(--mf-text-muted);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .muted,
    .note {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .allpods {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: 24px;
      cursor: pointer;
    }
    .h {
      margin: 0;
      font-size: var(--mf-fs-md);
    }
    .confirm {
      display: grid;
      gap: var(--mf-s3);
    }
    .linkbtn {
      padding: 0;
      border: 0;
      background: none;
      color: var(--mf-link);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
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
        grid-template-columns: auto minmax(0, 1fr);
      }
      .pick {
        grid-row: auto;
        grid-column: 2;
        justify-self: start;
      }
    }
  `,
})
export class UsersAssign {
  /** Task links carry `?from=dashboard` and this view's address, so the Task page can bring the person back (T9, #324). */
  protected readonly origin = inject(TaskOriginLinks);
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

  protected readonly max = ASSIGN_MAX;
  protected readonly bones = [1, 2, 3, 4];
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly busy = signal(false);
  protected readonly query = signal('');
  /** The "All pods" switch; remembered for the session. Only meaningful when the person is in a pod. */
  protected readonly allPods = signal(readAllPods());
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  /** The tasks waiting for the confirmation step, or null. */
  protected readonly confirming = signal<TaskQueueRow[] | null>(null);
  protected readonly batchError = signal(false);
  protected readonly failures = signal<{ taskNumber: string; message: string }[]>([]);
  protected readonly live = signal('');
  protected readonly inPods = computed(() => (this.user()?.pods.length ?? 0) > 0);
  protected readonly podScoped = computed(() => this.inPods() && !this.allPods());
  protected readonly podNames = computed(
    () =>
      this.user()
        ?.pods.map((p) => p.name)
        .join(', ') ?? '',
  );
  protected readonly orderText = computed(
    () =>
      `Unassigned open tasks${this.podScoped() ? ' in ' + this.podNames() : ''}, highest priority first, then oldest.`,
  );
  protected readonly firstName = computed(() => this.user()?.displayName.split(' ')[0] ?? '');
  protected readonly nextCount = computed(() => Math.min(ASSIGN_NEXT, this.rows().length));
  protected readonly selectedRows = computed(() => {
    const ids = this.selected();
    return this.rows().filter((r) => ids.has(r.taskId));
  });
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
        this.selected.set(new Set());
        this.confirming.set(null);
        this.failures.set([]);
        this.batchError.set(false);
        this.live.set('');
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
    if (this.podScoped()) state.filters.pod = this.user()!.pods.map((p) => p.podId);
    state.filters.q = this.query();
    state.sort = 'priorityAge';
    state.dir = 'asc';
    state.pageSize = ASSIGN_PAGE;
    void (async () => {
      try {
        const page = await firstValueFrom(this.queue.getTaskQueue(...taskQueueArgs(state)));
        if (this.destroyed || seq !== this.seq) return;
        this.rows.set(page.items);
        this.total.set(page.total);
        // A task that left the list (assigned by someone else) is no longer selected.
        const ids = new Set(page.items.map((r) => r.taskId));
        this.selected.update((sel) => new Set([...sel].filter((id) => ids.has(id))));
        this.state.set('ready');
      } catch {
        if (this.destroyed || seq !== this.seq) return;
        this.state.set('error');
      }
    })();
  }

  protected setAllPods(on: boolean): void {
    this.allPods.set(on);
    writeAllPods(on);
    this.selected.set(new Set());
    this.load();
  }

  protected toggle(row: TaskQueueRow, on: boolean): void {
    this.selected.update((sel) => {
      const next = new Set(sel);
      if (on && next.size < ASSIGN_MAX) next.add(row.taskId);
      else next.delete(row.taskId);
      return next;
    });
  }

  protected startNext(): void {
    this.askConfirm(this.rows().slice(0, ASSIGN_NEXT));
  }

  protected startSelected(): void {
    this.askConfirm(this.selectedRows());
  }

  private askConfirm(picked: TaskQueueRow[]): void {
    if (picked.length === 0) return;
    this.batchError.set(false);
    this.confirming.set(picked);
    this.focusConfirm();
  }

  protected cancelConfirm(): void {
    this.confirming.set(null);
    afterNextRender(
      () => document.querySelector<HTMLElement>('.mf-users-assign [data-assign-next]')?.focus(),
      { injector: this.injector },
    );
  }

  private focusConfirm(): void {
    afterNextRender(
      () =>
        document.querySelector<HTMLElement>('.mf-users-assign [data-assign-confirm-ok]')?.focus(),
      { injector: this.injector },
    );
  }

  /** One request for the confirmed tasks; the answer lists each task, successes are kept and failures shown. */
  protected async confirmBatch(): Promise<void> {
    const u = this.user();
    const picked = this.confirming();
    if (!u || !picked || this.busy()) return;
    this.busy.set(true);
    this.batchError.set(false);
    try {
      const response = await firstValueFrom(
        this.tasks.assignTasksBatch({
          userId: u.userId,
          items: picked.map((r) => ({
            taskId: r.taskId,
            rowVersion: r.rowVersion,
            podId: r.assignedPod?.podId,
          })),
        }),
      );
      if (this.destroyed) return;
      const done = response.results.filter((r) => r.succeeded && r.task);
      const failed = response.results.filter((r) => !r.succeeded);
      const numberOf = (id: number) => picked.find((r) => r.taskId === id)?.taskNumber ?? `#${id}`;
      this.failures.set(
        failed.map((f) => ({
          taskNumber: numberOf(f.taskId),
          message:
            f.errorCode === 'CONCURRENCY_CONFLICT'
              ? 'Someone else changed this task. It was not assigned.'
              : (f.message ?? 'It could not be assigned.'),
        })),
      );
      this.confirming.set(null);
      this.selected.set(new Set());
      if (done.length > 0) {
        const text = `${plural(done.length, 'task')} assigned to ${u.displayName}.`;
        this.live.set(text);
        const tasks = done.map((r) => r.task!);
        this.undo.offer(
          failed.length > 0 ? `${text} ${failed.length} could not be assigned.` : text,
          () => this.undoMany(tasks, u),
        );
        this.changed.emit();
      }
      this.load();
      if (failed.length > 0) {
        this.notify.error(
          `${plural(failed.length, 'task')} could not be assigned: ${failed.map((f) => numberOf(f.taskId)).join(', ')}.`,
        );
      }
      afterNextRender(
        () =>
          document
            .querySelector<HTMLElement>(
              '.mf-users-assign [data-assign-next], [aria-label="Close assign work"]',
            )
            ?.focus(),
        { injector: this.injector },
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.hasFieldErrors) {
        this.notify.error(
          error instanceof ApiError ? error.message : "We couldn't assign those tasks. Try again.",
        );
      }
      this.batchError.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  /** Undo of a batch: each task goes back to Unassigned only if it still has the assignee this batch gave it. */
  private async undoMany(tasks: TaskResponse[], u: WorkloadUser): Promise<void> {
    let undone = 0;
    let skipped = 0;
    for (const task of tasks) {
      try {
        const fresh = await firstValueFrom(this.tasks.getTask(task.taskId));
        if (fresh.assignedUser?.userId !== u.userId) {
          skipped++;
          continue;
        }
        await firstValueFrom(
          this.tasks.assignTask(task.taskId, {
            rowVersion: fresh.rowVersion,
            podId: fresh.assignedPod?.podId,
            userId: undefined,
          }),
        );
        undone++;
      } catch {
        skipped++;
      }
    }
    if (undone > 0) this.notify.success(`${plural(undone, 'task')} back to Unassigned.`);
    if (skipped > 0) this.notify.info(`${plural(skipped, 'task')} not undone: changed since.`);
    if (!this.destroyed) this.load();
    this.changed.emit();
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
