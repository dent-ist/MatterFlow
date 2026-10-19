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
  WorkloadThresholds,
  WorkloadUser,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { availabilityDisplay } from '../../../core/availability/availability';
import { QuietRequests } from '../../../core/http/interceptors';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import { describeDueCell } from '../../../core/time/time';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { StatusBadge } from '../../../shared/ui/status-badge';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { emptyState, taskQueueArgs } from '../../../shared/work-queue/queue-filters';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { backOnText } from './users-card';
import {
  LOAD_ICONS,
  LOAD_LABELS,
  cardState,
  loadLevelOf,
  plural,
  userQueueParams,
} from './users-model';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';

type LoadState = 'loading' | 'ready' | 'error';

/** How many open tasks the drawer lists (most urgent first); "Open in Task Queue" has all of them. */
export const DRAWER_PAGE = 100;

/** Overdue first, then priority (the list's own order), then the earliest due date; tasks without one last. Stable for equal keys. */
export function drawerOrder(
  rows: readonly TaskQueueRow[],
  now: Date,
  zone: string,
): TaskQueueRow[] {
  const key = (r: TaskQueueRow) => {
    const d = describeDueCell(r, now, zone, r.status);
    return {
      overdue: d.overdue ? 0 : 1,
      prio: r.priority.sortOrder,
      due: r.isAsap ? 0 : Date.parse(r.dueAtUtc ?? r.dueDate ?? '') || Number.MAX_SAFE_INTEGER,
    };
  };
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort(
      (a, b) => a.k.overdue - b.k.overdue || a.k.prio - b.k.prio || a.k.due - b.k.due || a.i - b.i,
    )
    .map((x) => x.r);
}

const OPEN = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];

/**
 * The side drawer of a person: their open tasks, most urgent first, as rows with the same inline Status, Priority and Assignee menus
 * (and Undo) as the work lists, "Open in Task Queue" filtered to this person and "Assign work". It is an accessible modal dialog like the
 * Swimlane drawer: focus is trapped inside, Esc or the close button closes it and focus returns to the card that opened it. The tasks are
 * read from the Task Queue when the drawer opens, and again when `version` changes (work was assigned from the picker).
 */
@Component({
  selector: 'mf-users-drawer',
  imports: [
    Dialog,
    DialogFocus,
    RouterLink,
    RowEdit,
    PriorityBadge,
    StatusBadge,
    TaskTypeIcon,
    DueCell,
    ErrorReference,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="user() ? user()!.displayName : 'Team member'"
      position="right"
      styleClass="mf-drawer mf-users-drawer"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close person details"
      [mfDialogFocus]="visible()"
      [focusOnShow]="false"
      (onShow)="focusClose()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [style]="{
        width: '36rem',
        maxWidth: '100vw',
        height: '100vh',
        maxHeight: '100vh',
        margin: '0',
        borderRadius: '0',
      }"
    >
      @if (visible() && user(); as u) {
        <div class="peek" data-users-drawer [attr.data-drawer-user]="u.userId">
          <div class="facts">
            <span class="avatar" aria-hidden="true">{{ u.initials }}</span>
            <div class="who">
              <span class="chip" [class]="'chip chip--' + avail().tone" data-drawer-avail>
                <i class="pi" [class]="avail().icon" aria-hidden="true"></i>{{ avail().label }}
              </span>
              @if (back(); as b) {
                <strong data-drawer-back>{{ b }}</strong>
              }
              @if (u.availability.note) {
                <span class="note">{{ u.availability.note }}</span>
              }
              <span class="load" data-drawer-load>
                <i class="pi" [class]="loadIcon()" aria-hidden="true"></i>
                {{ loadLabel() }} load, {{ plural(u.openTotal, 'open task') }}
              </span>
            </div>
          </div>

          <p class="actions">
            <a
              class="mf-btn mf-btn--icon mf-btn--primary"
              data-open-queue
              routerLink="/tasks"
              aria-label="Open in Task Queue"
              title="Open in Task Queue"
              [queryParams]="queueParams()"
            >
              <i class="pi pi-external-link" aria-hidden="true"></i>
            </a>
            @if (canAssign()) {
              <button
                type="button"
                class="mf-btn mf-btn--icon"
                data-drawer-assign
                [attr.aria-label]="'Assign work to ' + u.displayName"
                [attr.title]="'Assign work to ' + u.displayName"
                (click)="assign.emit(u)"
              >
                <i class="pi pi-user-plus" aria-hidden="true"></i>
              </button>
            }
          </p>

          <section aria-labelledby="ud-tasks">
            <h3 id="ud-tasks" class="h">
              Open tasks
              @if (state() === 'ready') {
                <span class="muted">({{ total() }})</span>
              }
            </h3>
            @if (state() === 'ready' && rows().length > 1) {
              <p class="muted order" data-drawer-order>Overdue first, then priority.</p>
            }
            <p class="sr-only" role="status" aria-live="polite" data-drawer-live>{{ live() }}</p>
            @switch (state()) {
              @case ('loading') {
                <div class="bones" role="status" aria-busy="true">
                  <span class="sr-only">Loading open tasks...</span>
                  @for (n of bones; track n) {
                    <span class="bone" aria-hidden="true"></span>
                  }
                </div>
              }
              @case ('error') {
                <div class="alert" role="alert" data-drawer-error>
                  <span>The open tasks could not be loaded.</span>
                  <mf-error-reference />
                  <button
                    type="button"
                    class="mf-btn mf-btn--icon"
                    data-drawer-retry
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
                  <p class="empty" data-drawer-empty>
                    <i class="pi pi-check-circle" aria-hidden="true"></i>
                    {{ u.displayName }} has no open tasks.
                  </p>
                } @else {
                  <ul class="rows" data-drawer-tasks>
                    @for (r of rows(); track r.taskId) {
                      <li
                        class="row"
                        [attr.data-task]="r.taskNumber"
                        [attr.data-task-id]="r.taskId"
                      >
                        <div class="main">
                          <a
                            class="ref mf-ref"
                            [routerLink]="['/tasks', r.taskId]"
                            [queryParams]="origin.params('dashboard')"
                            [state]="origin.state()"
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
                          <span class="field" data-field="status">
                            @if (editable('status', r)) {
                              <mf-row-edit field="status" [row]="r" (rowChange)="onRow($event)" />
                            } @else {
                              <mf-status-badge [code]="r.status" [label]="r.statusLabel" />
                            }
                          </span>
                          <span class="field" data-field="priority">
                            @if (editable('priority', r)) {
                              <mf-row-edit field="priority" [row]="r" (rowChange)="onRow($event)" />
                            } @else {
                              <mf-priority-badge
                                [priorityId]="r.priority.priorityId"
                                [label]="r.priority.label"
                                [color]="r.priority.color"
                              />
                            }
                          </span>
                          @if (r.dueDate || r.dueAtUtc || r.isAsap) {
                            <mf-due-cell data-due layout="inline" [due]="r" [status]="r.status" />
                          }
                        </div>
                        @if (editable('assignee', r)) {
                          <div class="reassign" data-field="assignee" data-reassign>
                            <mf-row-edit
                              field="assignee"
                              triggerIcon="pi-user-edit"
                              [row]="r"
                              (rowChange)="onRow($event)"
                            />
                          </div>
                        }
                      </li>
                    }
                  </ul>
                  @if (total() > rows().length) {
                    <p class="muted" data-drawer-more>
                      Showing {{ rows().length }} of {{ total() }}. The rest are in the Task Queue.
                    </p>
                  }
                }
              }
            }
          </section>
        </div>
      }
    </p-dialog>
  `,
  styles: `
    .peek {
      display: grid;
      gap: var(--mf-s4);
    }
    .facts {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
    }
    .avatar {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      color: var(--mf-primary);
      background: var(--mf-selected-bg);
      border: 1px solid var(--mf-primary);
      border-radius: 50%;
      font-weight: 700;
    }
    .who {
      display: grid;
      gap: 2px;
      justify-items: start;
      min-width: 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: 999px;
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .chip--success {
      color: var(--mf-success);
      background: var(--mf-success-bg);
    }
    .chip--warning {
      color: var(--mf-warning);
      background: var(--mf-warning-bg);
    }
    .chip--neutral {
      color: var(--mf-text-muted);
      background: var(--mf-surface-alt);
      border-style: dashed;
    }
    .note {
      font-style: italic;
      overflow-wrap: anywhere;
    }
    .load {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      font-size: var(--mf-fs-sm);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      margin: 0;
    }
    .actions a {
      text-decoration: none;
    }
    .h {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .muted {
      color: var(--mf-text-muted);
      font-weight: 400;
      font-size: var(--mf-fs-sm);
    }
    .rows {
      display: grid;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
      padding: 0;
      list-style: none;
    }
    .order {
      margin: 0 0 var(--mf-s2);
    }
    .type {
      flex: none;
      display: inline-flex;
      align-self: center;
      color: var(--mf-text-muted);
    }
    .reassign {
      grid-row: 1 / span 2;
      grid-column: 2;
      align-self: center;
    }
    .row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--mf-s1);
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
    .ref {
      flex: none;
      color: var(--mf-link);
    }
    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    .due {
      color: var(--mf-text-muted);
    }
    .due--overdue {
      color: var(--mf-danger);
      font-weight: 600;
    }
    .empty {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      color: var(--mf-text-muted);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
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
  `,
})
export class UsersDrawer {
  /** Task links carry `?from=dashboard` and this view's address, so the Task page can bring the person back (T9, #324). */
  protected readonly origin = inject(TaskOriginLinks);
  private readonly queue = inject(TaskQueueClient);
  private readonly auth = inject(AuthStore);
  private readonly quiet = inject(QuietRequests);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly injector = inject(Injector);
  private seq = 0;
  private destroyed = false;
  private openedId: number | null = null;
  private seenVersion = 0;

  /** The person shown (the board's current copy); null while the drawer is closed. */
  readonly user = input<WorkloadUser | null>(null);
  readonly thresholds = input<WorkloadThresholds | null>(null);
  /** Changes when work was assigned elsewhere (the picker): the tasks are read again. */
  readonly version = input(0);
  readonly closed = output<void>();
  readonly assign = output<WorkloadUser>();
  /** A task of this person changed on the server (a row version moved): the board's counts are stale. */
  readonly tasksChanged = output<void>();

  protected readonly plural = plural;
  protected readonly bones = [1, 2, 3];
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly live = signal('');
  protected readonly visible = computed(() => this.user() !== null);
  protected readonly canAssign = computed(() => this.auth.has('Task.Assign'));
  protected readonly avail = computed(() =>
    availabilityDisplay(this.user()?.availability, this.zone, this.clock.now()),
  );
  protected readonly back = computed(() => {
    const u = this.user();
    return u && cardState(u) === 'ooo'
      ? (backOnText(u.availability.outUntil, this.zone, this.clock.now()) ?? 'No return date set')
      : null;
  });
  protected readonly loadLabel = computed(() => {
    const u = this.user();
    return LOAD_LABELS[u ? loadLevelOf(u) : 'IDLE'];
  });
  protected readonly loadIcon = computed(() => {
    const u = this.user();
    return LOAD_ICONS[u ? loadLevelOf(u) : 'IDLE'];
  });
  protected readonly queueParams = computed(() => userQueueParams(this.user()?.userId ?? 0));

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const id = this.user()?.userId ?? null;
      untracked(() => {
        if (id === this.openedId) return;
        this.openedId = id;
        this.rows.set([]);
        if (id !== null) this.load();
      });
    });
    effect(() => {
      const v = this.version();
      untracked(() => {
        if (v === this.seenVersion) return;
        this.seenVersion = v;
        if (this.openedId !== null) this.load(true);
      });
    });
  }

  protected load(quiet = false): void {
    const id = this.user()?.userId;
    if (id === undefined) return;
    const seq = ++this.seq;
    if (!quiet || this.rows().length === 0) this.state.set('loading');
    const state = emptyState();
    state.filters.status = OPEN;
    state.filters.assignee = [id];
    state.sort = 'priority';
    state.dir = 'asc';
    state.pageSize = DRAWER_PAGE;
    void (async () => {
      try {
        const run = () => firstValueFrom(this.queue.getTaskQueue(...taskQueueArgs(state)));
        const page = await (quiet ? this.quiet.run(run) : run());
        if (this.destroyed || seq !== this.seq) return;
        this.rows.set(drawerOrder(page.items, this.clock.now(), this.zone));
        this.total.set(page.total);
        this.state.set('ready');
      } catch {
        if (this.destroyed || seq !== this.seq) return;
        if (!quiet) this.state.set('error');
      }
    })();
  }

  protected editable(field: 'status' | 'priority' | 'assignee', row: TaskQueueRow): boolean {
    return canEditField(field, row, (p) => this.auth.has(p));
  }

  /**
   * An inline edit changed a row. While it is only the optimistic or rolled-back copy the row is replaced where it stands. Once the server
   * has accepted a change (a new row version) a row that no longer belongs here (another assignee, or no longer open) leaves the list, the
   * focus moves on, and the board is told its counts are stale.
   */
  protected onRow(next: TaskQueueRow): void {
    const list = this.rows();
    const at = list.findIndex((r) => r.taskId === next.taskId);
    if (at < 0) return;
    const committed = next.rowVersion !== list[at].rowVersion;
    const id = this.user()?.userId;
    const stays = next.assignedUser?.userId === id && OPEN.includes(next.status);
    if (committed && !stays) {
      this.rows.set(list.filter((r) => r.taskId !== next.taskId));
      this.total.update((n) => Math.max(0, n - 1));
      if (next.assignedUser && next.assignedUser.userId !== id) {
        this.live.set(`${next.taskNumber} reassigned to ${next.assignedUser.displayName}`);
      }
      this.focusAfter(at);
    } else {
      this.rows.set(list.map((r) => (r.taskId === next.taskId ? next : r)));
    }
    if (committed) this.tasksChanged.emit();
  }

  private focusAfter(index: number): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        // Focus the user already moved elsewhere inside the drawer stays; a removed row, the body or a closing menu hands it on.
        if (active?.isConnected && active.closest('.mf-users-drawer [data-task-id]')) return;
        const rows = [...document.querySelectorAll<HTMLElement>('.mf-users-drawer [data-task-id]')];
        const row = rows[Math.min(index, rows.length - 1)];
        // Reassign first, then any inline control, then the number link (a comma selector would pick the first in document order).
        const target =
          row?.querySelector<HTMLElement>('[data-reassign] [data-inline-trigger]') ??
          row?.querySelector<HTMLElement>('[data-inline-trigger]') ??
          row?.querySelector<HTMLElement>('a') ??
          document.querySelector<HTMLElement>(
            '.mf-users-drawer button[aria-label="Close person details"]',
          );
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onVisible(open: boolean): void {
    if (!open) this.closed.emit();
  }

  protected focusClose(): void {
    document
      .querySelector<HTMLElement>('.mf-users-drawer button[aria-label="Close person details"]')
      ?.focus();
  }
}
