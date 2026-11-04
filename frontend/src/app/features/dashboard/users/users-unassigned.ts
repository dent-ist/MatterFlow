import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { firstValueFrom } from 'rxjs';
import { TaskQueueClient, TaskQueueRow } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PriorityFlag } from '../../../shared/ui/priority-flag';
import { DueCell } from '../../../shared/work-queue/due-cell';
import { ageText } from '../../../shared/work-queue/due-suffix';
import { canEditField } from '../../../shared/work-queue/inline-edit';
import { emptyState, taskQueueArgs } from '../../../shared/work-queue/queue-filters';
import { RowEdit } from '../../../shared/work-queue/row-edit';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';
import { plural, unassignedQueueParams } from './users-model';

type LoadState = 'loading' | 'ready' | 'error';

/** How many unassigned tasks the panel lists (longest waiting first); "Open in Task Queue" has all of them. */
export const UNASSIGNED_PAGE = 50;

/**
 * The right side panel of "N unassigned tasks" (US-13, #1105): the open tasks nobody has, the same set as the Summary's Unassigned card (the page scope's pods, the visibility rule is the
 * server's), longest waiting first. Each row is the task (reference and title open it), its type icon, priority, due date and how long it has waited, with the inline Assign control
 * (the searchable people picker with the Execute-only, least-loaded ranking; a conflict is handled by the shared control). After an assignment the row leaves the list and the board's
 * counts are told to refresh. Loading, empty and error states, an "Open in Task Queue" link for the full list. It is the same drawer look as the person drawer: Esc or the close button
 * closes it and focus returns to the button that opened it; full width on a phone.
 */
@Component({
  selector: 'mf-users-unassigned',
  imports: [
    Dialog,
    DialogFocus,
    RouterLink,
    RowEdit,
    PriorityFlag,
    TaskTypeIcon,
    DueCell,
    ErrorReference,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      position="right"
      styleClass="mf-drawer mf-users-drawer mf-unassigned-drawer"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close unassigned tasks"
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
      <ng-template #header let-labelId="ariaLabelledBy">
        <span class="htitle">
          <span class="hname" [id]="labelId" data-unassigned-title>{{ title() }}</span>
          <a
            class="mf-btn mf-btn--icon"
            data-unassigned-queue
            routerLink="/tasks"
            aria-label="Open in Task Queue"
            title="Open in Task Queue"
            [queryParams]="queueParams()"
          >
            <i class="pi pi-external-link" aria-hidden="true"></i>
          </a>
        </span>
      </ng-template>
      @if (visible()) {
        <div class="peek" data-unassigned-panel>
          <p class="sr-only" role="status" aria-live="polite" data-unassigned-live>{{ live() }}</p>
          @switch (state()) {
            @case ('loading') {
              <div class="bones" role="status" aria-busy="true" data-unassigned-loading>
                <span class="sr-only">Loading unassigned tasks...</span>
                @for (n of bones; track n) {
                  <span class="bone" aria-hidden="true"></span>
                }
              </div>
            }
            @case ('error') {
              <div class="alert" role="alert" data-unassigned-error>
                <span>The unassigned tasks could not be loaded.</span>
                <mf-error-reference />
                <button type="button" class="mf-btn" data-unassigned-retry (click)="load()">
                  Retry
                </button>
              </div>
            }
            @default {
              @if (rows().length === 0) {
                <p class="empty" data-unassigned-empty>
                  <i class="pi pi-check-circle" aria-hidden="true"></i>
                  No unassigned tasks.
                </p>
              } @else {
                <ul class="rows" data-unassigned-tasks>
                  @for (r of rows(); track r.taskId) {
                    <li class="row" [attr.data-task]="r.taskNumber" [attr.data-task-id]="r.taskId">
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
                        <mf-priority-flag [label]="r.priority.label" [color]="r.priority.color" />
                        @if (r.dueDate || r.dueAtUtc || r.isAsap) {
                          <mf-due-cell data-due layout="inline" [due]="r" [status]="r.status" />
                        }
                        @if (waiting(r); as w) {
                          <span class="wait" data-waiting>Waiting {{ w }}</span>
                        }
                      </div>
                      @if (editable(r)) {
                        <div class="assignee" data-field="assignee" data-assign-control>
                          <mf-row-edit field="assignee" [row]="r" (rowChange)="onRow($event)" />
                        </div>
                      }
                    </li>
                  }
                </ul>
                @if (total() > rows().length) {
                  <p class="muted" data-unassigned-more>
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
    .peek {
      display: grid;
      gap: var(--mf-s3);
    }
    .htitle {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .hname {
      min-width: 0;
      overflow: hidden;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .htitle a {
      text-decoration: none;
    }
    .htitle .pi {
      font-size: var(--mf-icon-lg);
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
      gap: var(--mf-s1) var(--mf-s2);
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
    .type {
      flex: none;
      display: inline-flex;
      align-self: center;
      color: var(--mf-text-muted);
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
    .wait {
      color: var(--mf-text-muted);
    }
    .assignee {
      grid-row: 1 / span 2;
      grid-column: 2;
      align-self: center;
    }
    .muted {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
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
export class UsersUnassigned {
  protected readonly origin = inject(TaskOriginLinks);
  private readonly queue = inject(TaskQueueClient);
  private readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);
  private seq = 0;

  /** Open or closed; the tab owns it (the button toggles it). */
  readonly open = model(false);
  /** The page scope's pods (the Task Queue's `pod` parameter), or undefined for all pods. */
  readonly pods = input<readonly string[] | undefined>(undefined);
  /** Changes when the list should be read again (the board was refreshed elsewhere). */
  readonly version = input(0);
  /** A task was assigned here: the board's counts (the button, the battery, the gauge) are stale. */
  readonly tasksChanged = output<void>();

  protected readonly bones = [1, 2, 3];
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly live = signal('');
  protected readonly visible = computed(() => this.open());
  protected readonly title = computed(() =>
    this.state() === 'ready' ? `Unassigned tasks (${this.total()})` : 'Unassigned tasks',
  );
  protected readonly queueParams = computed(() => unassignedQueueParams(this.pods() ?? []));

  constructor() {
    effect(() => {
      const on = this.open();
      this.pods();
      this.version();
      untracked(() => {
        if (on) this.load();
      });
    });
  }

  protected load(): void {
    const seq = ++this.seq;
    this.state.set('loading');
    const state = emptyState();
    state.filters.status = ['NEW', 'IN_PROGRESS', 'ON_HOLD'];
    state.filters.unassigned = true;
    const pods = this.pods();
    if (pods && pods.length > 0) state.filters.pod = pods.map(Number);
    state.sort = 'unassignedSince';
    state.dir = 'asc';
    state.pageSize = UNASSIGNED_PAGE;
    void (async () => {
      try {
        const page = await firstValueFrom(this.queue.getTaskQueue(...taskQueueArgs(state)));
        if (seq !== this.seq) return;
        this.rows.set(page.items);
        this.total.set(page.total);
        this.state.set('ready');
      } catch {
        if (seq !== this.seq) return;
        this.state.set('error');
      }
    })();
  }

  protected editable(row: TaskQueueRow): boolean {
    return canEditField('assignee', row, (p) => this.auth.has(p));
  }

  /** "3 h": how long the task has waited without a person (the server's minutes). */
  protected waiting(row: TaskQueueRow): string | null {
    const m = row['unassignedForMinutes'];
    return typeof m === 'number' && m > 0 ? ageText(m) : null;
  }

  /** An inline Assign changed a row: once the server accepted it (a new row version) the row leaves the list and the board is told. */
  protected onRow(next: TaskQueueRow): void {
    const list = this.rows();
    const at = list.findIndex((r) => r.taskId === next.taskId);
    if (at < 0) return;
    const committed = next.rowVersion !== list[at].rowVersion;
    if (committed && next.assignedUser) {
      this.rows.set(list.filter((r) => r.taskId !== next.taskId));
      this.total.update((n) => Math.max(0, n - 1));
      this.live.set(
        `${next.taskNumber} assigned to ${next.assignedUser.displayName}. ${plural(this.total(), 'unassigned task')} left.`,
      );
      this.focusAfter(at);
      this.tasksChanged.emit();
    } else {
      this.rows.set(list.map((r) => (r.taskId === next.taskId ? next : r)));
    }
  }

  private focusAfter(index: number): void {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active?.isConnected && active.closest('.mf-unassigned-drawer [data-task-id]')) return;
        const rows = [
          ...document.querySelectorAll<HTMLElement>('.mf-unassigned-drawer [data-task-id]'),
        ];
        const row = rows[Math.min(index, rows.length - 1)];
        const target =
          row?.querySelector<HTMLElement>('[data-inline-trigger]') ??
          row?.querySelector<HTMLElement>('a') ??
          document.querySelector<HTMLElement>(
            '.mf-unassigned-drawer button[aria-label="Close unassigned tasks"]',
          );
        target?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onVisible(open: boolean): void {
    this.open.set(open);
  }

  protected focusClose(): void {
    document
      .querySelector<HTMLElement>(
        '.mf-unassigned-drawer button[aria-label="Close unassigned tasks"]',
      )
      ?.focus();
  }
}
