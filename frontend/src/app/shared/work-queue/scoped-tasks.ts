import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import { TaskQueueClient, TaskQueueRow } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { HasPermissionDirective } from '../directives/has-permission.directive';
import { Pager } from '../ui/pager';
import { OPEN_STATUSES } from './queue-filters';
import { TaskTable } from './task-table';
import { ErrorReference } from '../ui/error-reference';

type LoadState = 'loading' | 'ready' | 'error';
type StatusScope = 'open' | 'all';

const PAGE_SIZE = 25;
const MATTER_COLUMNS = ['ref', 'title', 'project', 'priority', 'assignee', 'due', 'status'];
const PROJECT_COLUMNS = ['ref', 'title', 'priority', 'assignee', 'due', 'status'];

/**
 * The Tasks tab of a Matter (UX S06) and the task list of a Project: the shared work-queue table over the Task Queue endpoint filtered by
 * `matter` (and `project`), an Open/All status filter, paging, and a Create Task button that prefills the Matter (and Project).
 * Rendered only while its tab is open, so nothing loads before then. Needs `Task.View`; without it a short notice replaces the table.
 */
@Component({
  selector: 'mf-scoped-tasks',
  imports: [ErrorReference, Button, HasPermissionDirective, Pager, TaskTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
    }
    .st-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .st-filter {
      display: grid;
      gap: var(--mf-s1);
    }
    .st-filter label {
      font-weight: 600;
      font-size: var(--mf-fs-sm);
    }
    .st-filter select {
      min-height: var(--mf-row-h);
      padding: 0 var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    .st-state {
      padding: var(--mf-s5) var(--mf-s4);
      text-align: center;
      color: var(--mf-text-muted);
      background: var(--mf-surface);
      border: 1px dashed var(--mf-border-strong);
      border-radius: var(--mf-radius);
    }
    .st-alert {
      display: flex;
      align-items: center;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-danger);
      border-radius: var(--mf-radius);
      color: var(--mf-danger);
    }
    .st-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
  template: `
    @if (!canView()) {
      <div class="st-state" data-no-access="tasks">You don't have permission to view tasks.</div>
    } @else {
      <div class="st-bar">
        <div class="st-filter">
          <label [for]="id + '-status'">Show</label>
          <select
            [id]="id + '-status'"
            data-status-filter
            [value]="scope()"
            (change)="setScope($any($event.target).value)"
          >
            <option value="open" [selected]="scope() === 'open'">Open tasks</option>
            <option value="all" [selected]="scope() === 'all'">All tasks</option>
          </select>
        </div>
        @if (showCreate()) {
          <p-button
            *mfHasPermission="'Task.Create'"
            label="Create task"
            icon="pi pi-plus"
            severity="secondary"
            data-create-task
            [disabled]="!canCreate()"
            (onClick)="create()"
          />
        }
      </div>

      <div class="st-sr" role="status" aria-live="polite">{{ announcement() }}</div>

      @if (state() === 'error') {
        <div class="st-alert" role="alert" data-error>
          We couldn't load the tasks.
          <mf-error-reference />
          <p-button label="Retry" severity="secondary" (onClick)="load()" />
        </div>
      }

      @if (state() === 'loading' || rows().length > 0) {
        <mf-task-table
          [rows]="rows()"
          [columns]="columns()"
          [caption]="caption()"
          [loading]="state() === 'loading'"
          [sort]="sort()"
          [dir]="dir()"
          (sortChange)="sortBy($event)"
        />
        @if (rows().length > 0) {
          <mf-pager
            [page]="page()"
            [pageSize]="pageSize"
            [total]="total()"
            (pageChange)="goTo($event)"
          />
        }
      } @else if (state() === 'ready') {
        <div class="st-state" data-empty="tasks">
          {{ scope() === 'open' ? 'No open tasks.' : 'No tasks yet.' }}
        </div>
      }
    }
  `,
})
export class ScopedTasks {
  readonly matterId = input.required<number>();
  /** Show only the Tasks of this Project. */
  readonly projectId = input<number | null>(null);
  /** False disables Create Task (an inactive Matter takes no new Tasks). */
  readonly canCreate = input(true);
  /** False where the page header already offers the one Create Task button (Matter detail, UXR-40). */
  readonly showCreate = input(true);

  private static nextId = 0;
  protected readonly id = `st-${ScopedTasks.nextId++}`;

  private readonly api = inject(TaskQueueClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);

  protected readonly pageSize = PAGE_SIZE;
  protected readonly canView = computed(() => this.auth.has('Task.View'));
  protected readonly state = signal<LoadState>('loading');
  protected readonly scope = signal<StatusScope>('open');
  protected readonly page = signal(1);
  protected readonly sort = signal<string | null>(null);
  protected readonly dir = signal<'asc' | 'desc' | null>(null);
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly columns = computed(() =>
    this.projectId() === null ? MATTER_COLUMNS : PROJECT_COLUMNS,
  );
  protected readonly caption = computed(() =>
    this.projectId() === null ? 'Tasks of this matter' : 'Tasks of this project',
  );
  protected readonly announcement = computed(() => {
    if (this.state() === 'loading') return 'Loading tasks';
    if (this.state() === 'error') return 'Could not load tasks';
    return this.total() === 0 ? 'No tasks' : `${this.total()} tasks`;
  });

  private requestId = 0;

  constructor() {
    effect(() => {
      this.matterId();
      this.projectId();
      untracked(() => {
        if (this.canView()) void this.load();
      });
    });
  }

  protected setScope(value: string): void {
    this.scope.set(value === 'all' ? 'all' : 'open');
    this.page.set(1);
    void this.load();
  }

  protected goTo(page: number): void {
    this.page.set(page);
    void this.load();
  }

  protected sortBy(field: string): void {
    const defaultDesc = field === 'created';
    if (this.sort() === field) {
      this.dir.set(this.dir() === 'desc' ? 'asc' : 'desc');
    } else {
      this.sort.set(field);
      this.dir.set(defaultDesc ? 'desc' : 'asc');
    }
    this.page.set(1);
    void this.load();
  }

  protected create(): void {
    const project = this.projectId();
    const query = `matterId=${this.matterId()}${project === null ? '' : `&projectId=${project}`}`;
    void this.router.navigateByUrl(`/tasks/new?${query}`);
  }

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.state.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.getTaskQueue(
          undefined,
          this.scope() === 'open' ? [...OPEN_STATUSES] : undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          this.matterId(),
          this.projectId() ?? undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          this.sort() ?? undefined,
          this.dir() ?? undefined,
          this.page(),
          PAGE_SIZE,
        ),
      );
      if (id !== this.requestId) return;
      this.rows.set(page.items);
      this.total.set(page.total);
      this.state.set('ready');
    } catch {
      if (id === this.requestId) this.state.set('error');
    }
  }
}
