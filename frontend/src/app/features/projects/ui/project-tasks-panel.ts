import {
  ChangeDetectionStrategy,
  Component,
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
import { convertToParamMap } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  MatterBulkTasksClient,
  ProjectResponse,
  TaskQueueClient,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { SlidePanel } from '../../../shared/ui/slide-panel';
import {
  OPEN_STATUSES,
  parseQueueState,
  queueArgs,
} from '../../../shared/work-queue/queue-filters';

const PAGE = 100;

/**
 * A project's linked tasks in the shared side panel (MD-05, #1006; owner decision AQ.6): the tasks of the project with an Unlink button each, and Add task, which
 * lists the matter's open tasks that are not in this project (a task belongs to at most one project: one that is in another project says where it moves from).
 * Needs Task.View to list; Add and Unlink need Task.Edit. A change closes nothing: the panel refreshes its list and tells the page (`changed`) so the project counts update.
 */
@Component({
  selector: 'mf-project-tasks-panel',
  imports: [SlidePanel, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-slide-panel
      [title]="project()?.name ?? 'Project'"
      [subtitle]="matterLabel()"
      size="large"
      [showFooter]="false"
      [(visible)]="visible"
    >
      @if (project(); as p) {
        @if (p.description) {
          <p class="ptp__desc" data-project-description>{{ p.description }}</p>
        }
        <p class="ptp__links">
          @if (canEditProject()) {
            <button type="button" class="mf-btn" data-edit-project (click)="edit.emit(p)">
              <i class="pi pi-pencil" aria-hidden="true"></i> Edit Project
            </button>
          }
          <a class="mf-link" data-open-project [routerLink]="['/projects', p.projectId]"
            >Open the project page</a
          >
        </p>
        <div class="ptp__bar">
          <h3 class="ptp__h">Linked tasks ({{ linked().length }})</h3>
          @if (canEdit() && !adding()) {
            <button type="button" class="mf-btn" data-add-task (click)="startAdd()">
              <i class="pi pi-plus" aria-hidden="true"></i> Add Task
            </button>
          }
        </div>

        @if (!canView()) {
          <p class="ptp__note" data-no-access="tasks">You don't have permission to view tasks.</p>
        } @else {
          @if (adding()) {
            <section class="ptp__add" aria-label="Add tasks to this project" data-add-section>
              @if (candidates().length === 0) {
                <p class="ptp__note" data-no-candidates>
                  Every open task of this matter is already in this project.
                </p>
              } @else {
                <ul class="ptp__list" data-candidates>
                  @for (t of candidates(); track t.taskId) {
                    <li>
                      <label class="ptp__row">
                        <input
                          type="checkbox"
                          [checked]="picked().has(t.taskId)"
                          (change)="toggle(t.taskId, $any($event.target).checked)"
                        />
                        <span class="ptp__title"
                          ><span class="pg-mono">{{ t.taskNumber }}</span> {{ t.title }}
                          @if (t.projectName) {
                            <span class="pg-muted" data-moves-from>
                              (moves from {{ t.projectName }})</span
                            >
                          }
                        </span>
                      </label>
                    </li>
                  }
                </ul>
              }
              <div class="ptp__actions">
                <button type="button" class="mf-btn" data-add-cancel (click)="adding.set(false)">
                  Cancel
                </button>
                <button
                  type="button"
                  class="mf-btn mf-btn--primary"
                  data-add-confirm
                  [attr.aria-disabled]="picked().size === 0 || busy() ? 'true' : null"
                  (click)="link()"
                >
                  {{ busy() ? 'Linking...' : 'Link ' + picked().size + ' selected' }}
                </button>
              </div>
            </section>
          }

          @if (state() === 'loading') {
            <p class="ptp__note" role="status">Loading...</p>
          } @else if (state() === 'error') {
            <p class="ptp__note" role="alert" data-error>Couldn't load the tasks.</p>
          } @else if (linked().length === 0) {
            <p class="ptp__note" data-empty>No tasks are linked to this project yet.</p>
          } @else {
            <ul class="ptp__list" data-linked-tasks>
              @for (t of linked(); track t.taskId) {
                <li class="ptp__row" data-linked-row>
                  <span class="ptp__title">
                    <a class="mf-link" [routerLink]="['/tasks', t.taskId]"
                      ><span class="pg-mono">{{ t.taskNumber }}</span> {{ t.title }}</a
                    >
                    <span class="pg-muted"> {{ t.statusLabel }}</span>
                  </span>
                  @if (canEdit()) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      data-unlink
                      [attr.aria-label]="'Unlink ' + t.taskNumber"
                      (click)="unlink(t)"
                    >
                      Unlink
                    </button>
                  }
                </li>
              }
            </ul>
          }
        }
      }
    </mf-slide-panel>
  `,
  styles: `
    .ptp__desc {
      margin: 0 0 var(--mf-s3);
      color: var(--mf-text-muted);
      overflow-wrap: anywhere;
    }
    .ptp__links {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s3);
    }
    .ptp__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      margin-bottom: var(--mf-s2);
    }
    .ptp__h {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }
    .ptp__note {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .ptp__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ptp__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s2);
      min-height: 44px;
      padding: var(--mf-s1) 0;
      border-top: 1px solid var(--mf-border-soft);
    }
    .ptp__title {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .ptp__add {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
      background: var(--mf-surface);
    }
    .ptp__actions {
      display: flex;
      justify-content: space-between;
      margin-top: var(--mf-s2);
    }
  `,
})
export class ProjectTasksPanel {
  readonly matterId = input.required<number>();
  readonly matterLabel = input('');
  readonly project = input<ProjectResponse | null>(null);
  readonly visible = model(false);
  /** Tasks were linked or unlinked: the page refreshes its project counts. */
  readonly changed = output<void>();
  /** Edit project was pressed: the page opens the project panel. */
  readonly edit = output<ProjectResponse>();

  private readonly queue = inject(TaskQueueClient);
  private readonly bulk = inject(MatterBulkTasksClient);
  private readonly auth = inject(AuthStore);
  private readonly notify = inject(NotificationService);

  protected readonly canEditProject = computed(() => this.auth.has('Project.Edit'));
  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly canEdit = computed(
    () => this.auth.has('Task.Edit') && this.auth.has('Task.View'),
  );
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly linked = signal<TaskQueueRow[]>([]);
  protected readonly matterTasks = signal<TaskQueueRow[]>([]);
  protected readonly adding = signal(false);
  protected readonly picked = signal<ReadonlySet<number>>(new Set());
  protected readonly busy = signal(false);
  protected readonly candidates = computed(() => {
    const id = this.project()?.projectId;
    return this.matterTasks().filter((t) => t.projectId !== id);
  });

  constructor() {
    effect(() => {
      if (!this.visible() || !this.project()) return;
      untracked(() => {
        this.adding.set(false);
        this.picked.set(new Set());
        void this.load();
      });
    });
  }

  private async fetch(
    matter: number,
    project: number | undefined,
    open: boolean,
  ): Promise<TaskQueueRow[]> {
    const state = parseQueueState(convertToParamMap({}));
    const args = queueArgs({
      ...state,
      filters: {
        ...state.filters,
        matter,
        project: project ?? null,
        status: open ? [...OPEN_STATUSES] : [],
      },
      page: 1,
      pageSize: PAGE,
    });
    const page = await firstValueFrom(this.queue.getTaskQueue(undefined, ...args));
    return page.items;
  }

  protected async load(): Promise<void> {
    const p = this.project();
    if (!p || !this.canView()) return;
    this.state.set('loading');
    try {
      this.linked.set(await this.fetch(this.matterId(), p.projectId, false));
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  protected async startAdd(): Promise<void> {
    this.picked.set(new Set());
    this.adding.set(true);
    try {
      this.matterTasks.set(await this.fetch(this.matterId(), undefined, true));
    } catch {
      this.matterTasks.set([]);
    }
  }

  protected toggle(id: number, on: boolean): void {
    const next = new Set(this.picked());
    if (on) next.add(id);
    else next.delete(id);
    this.picked.set(next);
  }

  protected async link(): Promise<void> {
    const p = this.project();
    if (!p || this.picked().size === 0 || this.busy()) return;
    await this.apply([...this.picked()], p.projectId, 'linked');
    this.adding.set(false);
  }

  protected async unlink(t: TaskQueueRow): Promise<void> {
    await this.apply([t.taskId], null, 'unlinked');
  }

  private async apply(taskIds: number[], projectId: number | null, word: string): Promise<void> {
    this.busy.set(true);
    try {
      const done = await firstValueFrom(
        this.bulk.setMatterTasksProject(this.matterId(), {
          taskIds,
          projectId: projectId ?? undefined,
        }),
      );
      if (done.failed > 0) {
        this.notify.warn(`${done.changed} tasks ${word}`, `${done.failed} could not be changed.`);
      } else {
        this.notify.success(`${done.changed} ${done.changed === 1 ? 'task' : 'tasks'} ${word}`);
      }
      await this.load();
      this.changed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
