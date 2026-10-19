import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  linkedSignal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { TaskActivity } from '../panels/task-activity';
import { TaskAssetLinks } from '../panels/task-asset-links';
import { readOpen, sectionOpenKey } from '../panels/section-state';
import { TaskComments } from '../panels/task-comments';
import { TaskActionDialogs } from './task-action-dialogs';
import { TaskDetailStore, TaskSection } from './task-detail.store';
import { TaskDetailsTab } from './task-details-tab';
import { TaskHeader } from './task-header';
import { TaskStatusNote } from './task-status-note';
import { TaskWorkflowTab } from './task-workflow-tab';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { DetailLayout } from '../../../shared/ui/detail-layout';
import { RecordSkeleton } from '../../../shared/ui/record-skeleton';
import { RecordState } from '../../../shared/ui/record-state';
import { AuthStore } from '../../../core/auth/auth.store';

const WARNING_TEXT: Readonly<Record<string, string>> = {
  USER_NOT_IN_POD: "The assignee isn't a member of the assigned Pod. The change was saved.",
};

/** The tab title of a task that could not be shown. */
const STATE_TITLE: Readonly<Record<string, string>> = {
  notFound: 'Task not found',
  forbidden: 'No access to this task',
  error: 'Task could not be loaded',
};

const SECTIONS: readonly string[] = ['workflow', 'comments', 'assets'];
const isSection = (v: unknown): v is TaskSection => SECTIONS.includes(v as string);

/**
 * Task detail (UX S10, `/tasks/:id`): one page in the layout of the Client, Matter and Project pages. The header (the shared record header
 * and the facts strip) carries Edit, Activity, Complete task or Reopen task and the overflow; then the one status note (Completed, Cancelled or
 * On Hold: who, when, why; T3) and the banners (conflict, warnings); then the
 * Workflow and Comments sections in the main column and the Details and Assets sections in the side panel. Below 1100 px the order is
 * Details (collapsible), Workflow, Comments, Assets, with a "Jump to" row. The old `?tab=` links scroll to the section
 * (`workflow`, `comments`, `assets`), open the drawer (`activity`) or just show the page (`details`); `?step=<id>` opens that step.
 */
@Component({
  selector: 'mf-task-detail-page',
  imports: [
    RecordSkeleton,
    RecordState,
    TaskHeader,
    TaskStatusNote,
    DetailLayout,
    ActivityDrawer,
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
    <span class="pg-sr" role="status" data-record-live>{{ store.flow.live() }}</span>
    @switch (store.state()) {
      @case ('loading') {
        <mf-record-skeleton kind="task" [splitKey]="splitKey()" />
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

          <mf-task-status-note />

          @for (w of warnings(); track w) {
            <div class="pg-banner" role="status" data-warning>{{ w }}</div>
          }

          <mf-detail-layout [split]="true" [splitKey]="splitKey()">
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
            </div>

            <div mfBelow class="below">
              <div class="bottom" [class.bottom--split]="commentsOpen() === assetsOpen()">
                <div
                  class="sec panel panel--comments"
                  [class.panel--closed]="!commentsOpen()"
                  id="task-comments"
                  data-section="comments"
                >
                  <mf-task-comments
                    [taskId]="t.taskId"
                    [refresh]="t.rowVersion"
                    [focusRequest]="store.commentFocus()"
                    [(open)]="commentsOpen"
                  />
                </div>

                <div
                  class="sec panel panel--assets"
                  [class.panel--closed]="!assetsOpen()"
                  id="task-assets"
                  data-section="assets"
                >
                  <mf-task-asset-links
                    [taskId]="t.taskId"
                    [matterId]="t.matter.matterId"
                    [readOnly]="store.closed()"
                    [taskStatus]="t.status"
                    [(open)]="assetsOpen"
                  />
                </div>
              </div>
            </div>

            <div mfAside data-section="details">
              <mf-task-details-tab />
            </div>
          </mf-detail-layout>

          <mf-activity-drawer
            [name]="t.taskNumber + ' ' + t.title"
            [visible]="store.activityOpen()"
            (visibleChange)="setActivityOpen($event)"
          >
            @if (store.activityOpen()) {
              <mf-task-activity
                [taskId]="t.taskId"
                [compact]="true"
                (showComment)="showComment($event)"
              />
            }
          </mf-activity-drawer>

          <mf-task-action-dialogs />
        }
      }
      @default {
        <mf-record-state
          kind="task"
          [recordId]="id()"
          [state]="store.state()"
          [busy]="store.flow.retrying()"
          (retried)="store.load()"
        />
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
    /*
     * Under the Workflow: Comments and Assets side by side, each half of the main column (30 / 30 of the page by default). When the
     * column is narrow (container width, so it also follows the splitter) they stack. Each panel's list is its own scroll area, capped
     * at 60vh (--mf-panel-max) so the two panels stay level; on phones everything flows.
     */
    .below {
      container-type: inline-size;
    }
    .bottom {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s4);
    }
    .panel {
      min-width: 0;
      padding: var(--mf-s3) var(--mf-s4) var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-1);
    }
    .panel.panel--closed {
      padding: var(--mf-s1) var(--mf-s3);
    }
    @media (min-width: 600px) {
      .panel--assets {
        --mf-panel-max: 60vh;
      }
    }
    @media (min-width: 1100px) {
      .panel--comments {
        --mf-panel-max: 60vh;
      }
    }
    @container (min-width: 36rem) {
      .bottom--split {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: stretch;
      }
    }
    @media (max-width: 1099.98px) {
      .bottom {
        grid-template-columns: minmax(0, 1fr);
      }
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
  private readonly auth = inject(AuthStore);

  /** Where this person's Details width is remembered (the splitter of the two-column layout). */
  protected readonly splitKey = computed(
    () => `mf.task-detail.split.${this.auth.profile()?.userId ?? 'anon'}`,
  );

  /**
   * Whether Comments and Assets are expanded: the choice remembered for this person (read before the first render), collapsed by default.
   * Links, Jump to and new comments open a section without changing what is remembered. Reset when another Task is shown.
   */
  private readonly openKeys = computed(() => {
    const user = this.auth.profile()?.userId;
    return [sectionOpenKey('comments', user), sectionOpenKey('assets', user), this.id()];
  });
  protected readonly commentsOpen = linkedSignal(() => readOpen(this.openKeys()[0]) ?? false);
  protected readonly assetsOpen = linkedSignal(() => readOpen(this.openKeys()[1]) ?? false);
  /** The `?tab=` / `?step=` pair already acted on for the loaded Task, so a reload does not scroll again. */
  private handledLink: string | null = null;

  protected readonly warnings = computed(() =>
    this.store.warnings().map((w) => WARNING_TEXT[w] ?? w),
  );

  constructor() {
    // `TSK-12 Title cut at 60 characters`, `Activity - TSK-12 ...` while the drawer is open; the error states name themselves (#290, #295).
    // Pinned, so a navigation that only changes the address (closing the drawer removes `?tab=activity`) keeps it.
    effect(() => {
      const t = this.store.state() === 'ready' ? this.store.task() : null;
      const state = this.store.state();
      const base = t ? `${t.taskNumber} ${shortTitleText(t.title)}` : null;
      this.pageTitle.pin(
        base
          ? this.store.activityOpen()
            ? `Activity - ${base}`
            : base
          : (STATE_TITLE[state] ?? 'Task'),
      );
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    effect(() => {
      const id = Number(this.id());
      untracked(() => {
        this.handledLink = null;
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
        const stepId = Number(step);
        const hasStep = !!step && Number.isInteger(stepId);
        if (tab === 'activity') this.store.activityOpen.set(true);
        // A link to a step (`?tab=workflow&step=5`, from My Work) lands on that step: the section heading must not take the focus.
        else if (isSection(tab) && !(tab === 'workflow' && hasStep)) this.store.showSection(tab);
        if (hasStep) this.store.focusStepId.set(stepId);
      });
    });
    // A request to show a section (Jump to, ?tab=): scroll there and put focus on the section's heading.
    effect(() => {
      const request = this.store.sectionRequest();
      untracked(() => {
        if (!request) return;
        if (request.section === 'comments') this.commentsOpen.set(true);
        if (request.section === 'assets') this.assetsOpen.set(true);
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

  /** A comment chosen in the Activity: close the drawer and let the Comments section show it. */
  protected showComment(commentId: number): void {
    this.setActivityOpen(false);
    this.store.commentFocus.set({
      commentId,
      seq: (this.store.commentFocus()?.seq ?? 0) + 1,
    });
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
