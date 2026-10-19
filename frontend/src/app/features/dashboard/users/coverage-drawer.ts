import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  CoverageTaskType,
  CoverageUser,
  TaskQueueClient,
  TaskQueueRow,
} from '../../../api/generated/api-client';
import { formatDateOnly, mfDate } from '../../../core/time/time';
import { USER_TIME_ZONE } from '../../../core/time/clock';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { emptyState, taskQueueArgs } from '../../../shared/work-queue/queue-filters';
import { plural } from './coverage-model';
import { TaskOriginLinks } from '../../../shared/work-queue/task-origin';

/** The cell a person opened: who, which task type and the period (local days). */
export interface CoverageTarget {
  user: Pick<CoverageUser, 'userId' | 'displayName'>;
  type: Pick<CoverageTaskType, 'taskTypeId' | 'name'>;
  from: string;
  to: string;
  count: number;
}

type LoadState = 'loading' | 'ready' | 'error';

/** How many completed tasks the drawer lists (newest first); "Open in Task Queue" has all of them. */
export const COVERAGE_PAGE = 50;

/** The Task Queue query of a cell: completed, this person, this task type, completed inside the period. */
export function targetQueueParams(t: CoverageTarget): Record<string, string | string[]> {
  return {
    status: ['COMPLETED'],
    assignee: [String(t.user.userId)],
    type: [String(t.type.taskTypeId)],
    completedFrom: t.from,
    completedTo: t.to,
    sort: 'completed',
    dir: 'desc',
  };
}

/**
 * The side drawer of a coverage cell: the tasks of one type a person completed in the period, newest first, read from the Task Queue (so they
 * are the tasks the count was made from), with "Open in Task Queue". A modal dialog like the other drawers: focus is trapped, Esc or Close
 * closes it and focus returns to the cell.
 */
@Component({
  selector: 'mf-coverage-drawer',
  imports: [Dialog, DialogFocus, RouterLink, MatterRef, ErrorReference],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [header]="
        target() ? target()!.type.name + ': ' + target()!.user.displayName : 'Completed tasks'
      "
      position="right"
      styleClass="mf-drawer mf-coverage-drawer"
      [modal]="true"
      [closable]="true"
      [dismissableMask]="true"
      closeAriaLabel="Close completed tasks"
      [mfDialogFocus]="visible()"
      [focusOnShow]="false"
      (onShow)="focusClose()"
      [draggable]="false"
      [resizable]="false"
      [visible]="visible()"
      (visibleChange)="onVisible($event)"
      [style]="{
        width: '34rem',
        maxWidth: '100vw',
        height: '100vh',
        maxHeight: '100vh',
        margin: '0',
        borderRadius: '0',
      }"
    >
      @if (target(); as t) {
        <div class="peek" data-coverage-drawer>
          <p class="lead" data-coverage-lead>
            {{ plural(t.count, 'task') }} of this type completed from {{ fromText() }} to
            {{ toText() }}.
          </p>
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
          </p>
          @switch (state()) {
            @case ('loading') {
              <div class="bones" role="status" aria-busy="true">
                <span class="sr-only">Loading completed tasks...</span>
                @for (n of bones; track n) {
                  <span class="bone" aria-hidden="true"></span>
                }
              </div>
            }
            @case ('error') {
              <div class="alert" role="alert" data-coverage-error>
                <span>The completed tasks could not be loaded.</span>
                <mf-error-reference />
                <button type="button" class="mf-btn" data-coverage-retry (click)="load()">
                  Retry
                </button>
              </div>
            }
            @default {
              @if (rows().length === 0) {
                <p class="empty" data-coverage-empty>
                  No {{ t.type.name }} tasks completed by {{ t.user.displayName }} in this period.
                </p>
              } @else {
                <ul class="rows" data-coverage-tasks>
                  @for (r of rows(); track r.taskId) {
                    <li class="row" [attr.data-task]="r.taskNumber">
                      <a
                        class="ref mf-ref"
                        [routerLink]="['/tasks', r.taskId]"
                        [queryParams]="origin.params('dashboard')"
                        [state]="origin.state()"
                        >{{ r.taskNumber }}</a
                      >
                      <span class="title" [attr.title]="r.title">{{ r.title }}</span>
                      <span class="meta">
                        <mf-matter-ref [value]="r.matterRef" [copy]="false" />
                        <span>Completed {{ completedOn(r) }}</span>
                      </span>
                    </li>
                  }
                </ul>
                @if (total() > rows().length) {
                  <p class="muted" data-coverage-more>
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
    .lead,
    .actions {
      margin: 0;
    }
    .actions a {
      text-decoration: none;
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
      grid-template-columns: auto minmax(0, 1fr);
      gap: 0 var(--mf-s2);
      padding: var(--mf-s2) var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .ref {
      color: var(--mf-link);
    }
    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .empty,
    .muted {
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
export class CoverageDrawer {
  /** Task links carry `?from=dashboard` and this view's address, so the Task page can bring the person back (T9, #324). */
  protected readonly origin = inject(TaskOriginLinks);
  private readonly queue = inject(TaskQueueClient);
  private readonly zone = inject(USER_TIME_ZONE);
  private seq = 0;
  private destroyed = false;
  private openedKey = '';

  readonly target = input<CoverageTarget | null>(null);
  readonly closed = output<void>();

  protected readonly plural = plural;
  protected readonly bones = [1, 2, 3];
  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<TaskQueueRow[]>([]);
  protected readonly total = signal(0);
  protected readonly visible = computed(() => this.target() !== null);
  protected readonly queueParams = computed(() => {
    const t = this.target();
    return t ? targetQueueParams(t) : {};
  });
  protected readonly fromText = computed(() => formatDateOnly(this.target()?.from ?? ''));
  protected readonly toText = computed(() => formatDateOnly(this.target()?.to ?? ''));

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const t = this.target();
      const key = t ? `${t.user.userId}:${t.type.taskTypeId}:${t.from}:${t.to}` : '';
      untracked(() => {
        if (key === this.openedKey) return;
        this.openedKey = key;
        this.rows.set([]);
        if (t) this.load();
      });
    });
  }

  protected load(): void {
    const t = this.target();
    if (!t) return;
    const seq = ++this.seq;
    this.state.set('loading');
    const state = emptyState();
    state.filters.status = ['COMPLETED'];
    state.filters.assignee = [t.user.userId];
    state.filters.type = [t.type.taskTypeId];
    state.filters.completedFrom = t.from;
    state.filters.completedTo = t.to;
    state.sort = 'completed';
    state.dir = 'desc';
    state.pageSize = COVERAGE_PAGE;
    void (async () => {
      try {
        const page = await firstValueFrom(this.queue.getTaskQueue(...taskQueueArgs(state)));
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

  protected completedOn(r: TaskQueueRow): string {
    return r.completedAtUtc ? mfDate(r.completedAtUtc, this.zone, 'date') : '';
  }

  protected onVisible(open: boolean): void {
    if (!open) this.closed.emit();
  }

  protected focusClose(): void {
    document
      .querySelector<HTMLElement>('.mf-coverage-drawer button[aria-label="Close completed tasks"]')
      ?.focus();
  }
}
