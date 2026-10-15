import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { TaskActivity } from '../panels/task-activity';
import { TaskAssetLinks } from '../panels/task-asset-links';
import { TaskComments } from '../panels/task-comments';
import { TaskActionDialogs } from './task-action-dialogs';
import { InView } from './in-view';
import { TaskDetailStore, TaskSection } from './task-detail.store';
import { TaskDetailsTab } from './task-details-tab';
import { TaskHeader } from './task-header';
import { TaskWorkflowTab } from './task-workflow-tab';
import { PageTitle } from '../../../core/title/page-title';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { DetailLayout } from '../../../shared/ui/detail-layout';

const WARNING_TEXT: Readonly<Record<string, string>> = {
  USER_NOT_IN_POD: "The assignee isn't a member of the assigned Pod. The change was saved.",
};

const SECTIONS: readonly string[] = ['workflow', 'comments', 'assets'];
const isSection = (v: unknown): v is TaskSection => SECTIONS.includes(v as string);

/**
 * Task detail (UX S10, `/tasks/:id`): one page in the layout of the Client, Matter and Project pages. The header carries the status
 * actions, Edit and Activity (a right-side drawer); then the banners (conflict, closed, sensitive, hold or cancel reason); then the
 * Workflow and Comments sections in the main column and the Details and Assets sections in the side panel. Below 1100 px the order is
 * Details (collapsible), Workflow, Comments, Assets, with a "Jump to" row. The old `?tab=` links scroll to the section
 * (`workflow`, `comments`, `assets`), open the drawer (`activity`) or just show the page (`details`); `?step=<id>` opens that step.
 */
@Component({
  selector: 'mf-task-detail-page',
  imports: [
    ErrorReference,
    RouterLink,
    TaskHeader,
    DetailLayout,
    ActivityDrawer,
    InView,
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
          <mf-error-reference />
          <button type="button" class="link-btn" (click)="store.load()">Retry</button>
        </div>
      }
      @case ('ready') {
        @if (store.task(); as t) {
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
                  Reopen it to edit.
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

          <mf-detail-layout asideWidth="clamp(380px, 34vw, 480px)">
            <div mfMain>
              <nav class="jump" aria-label="Jump to" data-jump>
                <span class="jump__label">Jump to</span>
                <a href="#task-workflow" data-jump-to="workflow" (click)="jump($event, 'workflow')"
                  >Workflow</a
                >
                <a href="#task-comments" data-jump-to="comments" (click)="jump($event, 'comments')"
                  >Comments</a
                >
                <a href="#task-assets" data-jump-to="assets" (click)="jump($event, 'assets')"
                  >Assets</a
                >
              </nav>

              <div class="sec" id="task-workflow" data-section="workflow">
                <mf-task-workflow-tab />
              </div>

              <div
                class="sec"
                id="task-comments"
                data-section="comments"
                mfInView
                (inView)="commentsOn.set(true)"
              >
                @if (commentsOn()) {
                  <mf-task-comments [taskId]="t.taskId" [refresh]="t.rowVersion" />
                } @else {
                  <section aria-label="Comments">
                    <h2 class="sec__h" tabindex="-1" data-section-heading>Comments</h2>
                    <p class="sec__muted" role="status" aria-busy="true">Loading comments...</p>
                  </section>
                }
              </div>
            </div>

            <div mfAside data-section="details">
              <mf-task-details-tab />
            </div>

            <div mfAfter id="task-assets" data-section="assets">
              <mf-task-asset-links
                [taskId]="t.taskId"
                [matterId]="t.matter.matterId"
                [readOnly]="store.closed()"
                [taskStatus]="t.status"
              />
            </div>
          </mf-detail-layout>

          <mf-activity-drawer
            [name]="t.taskNumber + ' ' + t.title"
            [visible]="store.activityOpen()"
            (visibleChange)="setActivityOpen($event)"
          >
            @if (store.activityOpen()) {
              <mf-task-activity [taskId]="t.taskId" [compact]="true" />
            }
          </mf-activity-drawer>

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
    .sec + .sec {
      margin-top: var(--mf-s5);
    }
    .sec__h {
      margin: 0 0 var(--mf-s3);
      font-size: var(--mf-fs-h3);
      scroll-margin-top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s4));
    }
    .sec__h:focus {
      outline: none;
    }
    .sec__h:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 2px;
    }
    .sec__muted {
      margin: 0;
      color: var(--mf-text-muted);
    }
    /* "Jump to" is for the single-column layout only; from 1100 px everything is in view. */
    .jump {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s4);
      margin-bottom: var(--mf-s4);
      font-size: var(--mf-fs-sm);
    }
    .jump__label {
      color: var(--mf-text-muted);
      font-weight: 600;
    }
    .jump a {
      display: inline-flex;
      align-items: center;
      min-height: var(--mf-target-min, 2rem);
      color: var(--mf-link);
    }
    @media (min-width: 1100px) {
      .jump {
        display: none;
      }
    }
  `,
})
export class TaskDetailPage implements HasUnsavedChanges {
  /** Route parameter `:id`. */
  readonly id = input.required<string>();
  /** Query parameter `?tab=` (old links): a section to scroll to, `activity` for the drawer. */
  readonly tab = input<string | undefined>();
  /** Query parameter `?step=<stepInstanceId>`: opens that step and moves focus to it. */
  readonly step = input<string | undefined>();

  protected readonly store = inject(TaskDetailStore);
  private readonly pageTitle = inject(PageTitle);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** True once the Comments are near the visible area (or were asked for): they load then, not with the first paint. */
  protected readonly commentsOn = signal(false);
  /** The `?tab=` / `?step=` pair already acted on for the loaded Task, so a reload does not scroll again. */
  private handledLink: string | null = null;

  protected readonly reopen = computed(
    () => this.store.task()?.allowedActions.transitions.find((o) => o.action === 'REOPEN') ?? null,
  );

  protected readonly warnings = computed(() =>
    this.store.warnings().map((w) => WARNING_TEXT[w] ?? w),
  );

  constructor() {
    effect(() => {
      const t = this.store.task();
      if (t) this.pageTitle.set(t.taskNumber + ' ' + t.title);
    });
    effect(() => {
      const id = Number(this.id());
      untracked(() => {
        this.handledLink = null;
        this.commentsOn.set(false);
        void this.store.load(id);
      });
    });
    // Old links: act on them once the page is showing.
    effect(() => {
      const ready = this.store.state() === 'ready';
      const tab = this.tab();
      const step = this.step();
      untracked(() => {
        if (!ready) return;
        const key = `${tab ?? ''}|${step ?? ''}`;
        if (this.handledLink === key) return;
        this.handledLink = key;
        if (tab === 'activity') this.store.activityOpen.set(true);
        else if (isSection(tab)) this.store.showSection(tab);
        const stepId = Number(step);
        if (step && Number.isInteger(stepId)) this.store.focusStepId.set(stepId);
      });
    });
    // A request to show a section (Jump to, ?tab=): scroll there and put focus on the section's heading.
    effect(() => {
      const request = this.store.sectionRequest();
      untracked(() => {
        if (!request) return;
        if (request.section === 'comments') this.commentsOn.set(true);
        setTimeout(() => this.focusSection(request.section));
      });
    });
  }

  hasUnsavedChanges(): boolean {
    return this.store.editing() && this.store.dirty();
  }

  protected jump(event: Event, section: TaskSection): void {
    event.preventDefault();
    this.store.showSection(section);
  }

  protected setActivityOpen(open: boolean): void {
    this.store.activityOpen.set(open);
    if (!open && this.tab() === 'activity') {
      void this.router.navigate([], {
        queryParams: { tab: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  private focusSection(section: TaskSection): void {
    const root = this.host.nativeElement;
    const heading = root.querySelector<HTMLElement>(
      `[data-section="${section}"] [data-section-heading]`,
    );
    if (!heading) return;
    heading.scrollIntoView?.({ block: 'start' });
    heading.focus({ preventScroll: true });
  }
}
