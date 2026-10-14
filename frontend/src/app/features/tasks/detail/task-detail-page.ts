import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { TaskActivity } from '../panels/task-activity';
import { TaskAssetLinks } from '../panels/task-asset-links';
import { TaskComments } from '../panels/task-comments';
import { TaskActionDialogs } from './task-action-dialogs';
import { TASK_TABS, TaskDetailStore, TaskTab } from './task-detail.store';
import { TaskDetailsTab } from './task-details-tab';
import { TaskHeader } from './task-header';
import { TaskWorkflowTab } from './task-workflow-tab';

const WARNING_TEXT: Readonly<Record<string, string>> = {
  USER_NOT_IN_POD: "The assignee isn't a member of the assigned Pod. The change was saved.",
};

const isTab = (v: unknown): v is TaskTab => TASK_TABS.includes(v as TaskTab);

/**
 * Task detail (UX S10, `/tasks/:id`): header with the status actions, banners (conflict, closed, sensitive, hold or cancel
 * reason), and the Details / Workflow / Comments / Assets / Activity tabs.
 */
@Component({
  selector: 'mf-task-detail-page',
  imports: [
    RouterLink,
    TaskHeader,
    TaskDetailsTab,
    TaskWorkflowTab,
    TaskActionDialogs,
    TaskComments,
    TaskAssetLinks,
    TaskActivity,
  ],
  providers: [TaskDetailStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    @switch (store.state()) {
      @case ('loading') {
        <div class="pg-state" role="status" aria-busy="true" data-loading>Loading the task...</div>
      }
      @case ('notFound') {
        <div class="pg-state" data-not-found>
          <h1>We couldn't find that task.</h1>
          <p>It may have been removed, or the link may be wrong.</p>
          <a class="pg-link" routerLink="/tasks">Go to the task queue</a>
        </div>
      }
      @case ('forbidden') {
        <div class="pg-state" data-forbidden>
          <h1>You don't have permission to view this task.</h1>
          <a class="pg-link" routerLink="/tasks">Go to the task queue</a>
        </div>
      }
      @case ('error') {
        <div class="pg-alert" role="alert" data-error>
          We couldn't load this task.
          <button type="button" class="link-btn" (click)="store.load()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (store.task(); as t) {
          <p class="pg-crumbs">
            <a routerLink="/tasks">Tasks</a> &gt; {{ t.matter.matterRef }} {{ t.matter.name }} &gt;
            {{ t.taskNumber }}
          </p>

          @if (store.conflict()) {
            <div class="pg-alert" role="alert" data-conflict-banner>
              This task was changed by someone else, so your change wasn't saved. Reload to see the
              latest version.
              <button type="button" class="link-btn" data-reload (click)="store.load()">
                Reload
              </button>
            </div>
          }

          <mf-task-header />

          @if (t.matter.isSensitive) {
            <div class="pg-banner" role="note" data-sensitive-banner>
              <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
              <strong> Sensitive matter.</strong> Handle this task with extra care. The flag is a
              warning only and does not restrict who can see it.
            </div>
          }

          @if (store.closed()) {
            <div class="pg-banner" role="note" data-closed-banner>
              This task is {{ t.statusLabel }}.
              @if (reopen(); as r) {
                @if (r.permitted) {
                  Move it back to In Progress to edit.
                  <button
                    type="button"
                    class="link-btn"
                    data-reopen-task
                    (click)="store.requestAction('REOPEN')"
                  >
                    Reopen task
                  </button>
                } @else if (r.blockedReason === 'MATTER_INACTIVE') {
                  <span data-matter-inactive>Matter is inactive. This task can't be reopened.</span>
                }
              }
            </div>
          }

          @if ((t.status === 'ON_HOLD' || t.status === 'CANCELLED') && t.statusReason; as reason) {
            <div class="pg-banner" role="note" data-status-reason>
              <strong
                >{{ t.status === 'ON_HOLD' ? 'On hold' : 'Cancelled' }} by
                {{ reason.authorName }}:</strong
              >
              <span [innerHTML]="reason.bodyHtml"></span>
            </div>
          }

          @for (w of warnings(); track w) {
            <div class="pg-banner" role="status" data-warning>{{ w }}</div>
          }

          <div class="pg-tabs" role="tablist" aria-label="Task sections">
            @for (tab of tabs(); track tab.id) {
              <button
                type="button"
                role="tab"
                [id]="'task-tab-' + tab.id"
                [attr.aria-selected]="store.tab() === tab.id"
                [attr.aria-controls]="store.tab() === tab.id ? 'task-panel-' + tab.id : null"
                [attr.tabindex]="store.tab() === tab.id ? 0 : -1"
                (click)="select(tab.id)"
                (keydown)="onTabKey($event)"
              >
                {{ tab.label }}
              </button>
            }
          </div>

          <div
            role="tabpanel"
            [id]="'task-panel-' + store.tab()"
            [attr.aria-labelledby]="'task-tab-' + store.tab()"
            tabindex="0"
          >
            @switch (store.tab()) {
              @case ('details') {
                <mf-task-details-tab />
              }
              @case ('workflow') {
                <mf-task-workflow-tab />
              }
              @case ('comments') {
                <mf-task-comments [taskId]="t.taskId" />
              }
              @case ('assets') {
                <mf-task-asset-links
                  [taskId]="t.taskId"
                  [matterId]="t.matter.matterId"
                  [readOnly]="store.closed()"
                  [taskStatus]="t.status"
                />
              }
              @case ('activity') {
                <mf-task-activity [taskId]="t.taskId" />
              }
            }
          </div>

          <mf-task-action-dialogs />
        }
      }
    }
  `,
  styles: `
    .link-btn {
      margin-left: var(--mf-s2);
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }
    [role='tabpanel']:focus-visible {
      outline: 2px solid var(--mf-focus);
    }
  `,
})
export class TaskDetailPage implements HasUnsavedChanges {
  /** Route parameter `:id`. */
  readonly id = input.required<string>();
  /** Query parameter `?tab=`. */
  readonly tab = input<string | undefined>();

  protected readonly store = inject(TaskDetailStore);
  private readonly router = inject(Router);

  protected readonly tabs = computed(() => {
    const w = this.store.task()?.workflow.progress;
    return [
      { id: 'details' as TaskTab, label: 'Details' },
      {
        id: 'workflow' as TaskTab,
        label: w ? `Workflow (${w.resolved}/${w.total})` : 'Workflow',
      },
      { id: 'comments' as TaskTab, label: 'Comments' },
      { id: 'assets' as TaskTab, label: 'Assets' },
      { id: 'activity' as TaskTab, label: 'Activity' },
    ];
  });

  protected readonly reopen = computed(
    () => this.store.task()?.allowedActions.transitions.find((o) => o.action === 'REOPEN') ?? null,
  );

  protected readonly warnings = computed(() =>
    this.store.warnings().map((w) => WARNING_TEXT[w] ?? w),
  );

  constructor() {
    effect(() => {
      const id = Number(this.id());
      untracked(() => void this.store.load(id));
    });
    effect(() => {
      const t = this.tab();
      if (isTab(t)) untracked(() => this.store.tab.set(t));
    });
    effect(() => {
      const current = this.store.tab();
      untracked(() => {
        if ((this.tab() ?? 'details') !== current && this.store.state() === 'ready') {
          void this.router.navigate([], {
            queryParams: { tab: current },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        }
      });
    });
  }

  hasUnsavedChanges(): boolean {
    return this.store.editing() && this.store.dirty();
  }

  protected select(tab: TaskTab): void {
    this.store.tab.set(tab);
  }

  /** WAI-ARIA tabs: arrows move and activate, Home and End jump. */
  protected onTabKey(event: KeyboardEvent): void {
    const index = TASK_TABS.indexOf(this.store.tab());
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % TASK_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TASK_TABS.length) % TASK_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TASK_TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    this.store.tab.set(TASK_TABS[next]);
    const id = `task-tab-${TASK_TABS[next]}`;
    queueMicrotask(() => document.getElementById(id)?.focus());
  }
}
