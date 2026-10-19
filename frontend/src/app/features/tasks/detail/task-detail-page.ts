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
import { detailsOpenKey, readOpen, saveOpen, sectionOpenKey } from '../panels/section-state';
import { TaskComments } from '../panels/task-comments';
import { TaskActionDialogs } from './task-action-dialogs';
import { detailsSummary } from './details-summary';
import { TaskDetailStore, TaskSection } from './task-detail.store';
import { TaskDetailsTab } from './task-details-tab';
import { TaskHeader } from './task-header';
import { TaskStatusNote } from './task-status-note';
import { TaskWorkflowTab } from './task-workflow-tab';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { DetailLayout } from '../../../shared/ui/detail-layout';
import { RecordSkeleton } from '../../../shared/ui/record-skeleton';
import { SectionNav, SectionNavItem } from '../../../shared/ui/section-nav';
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
 * Workflow, Assets, Comments (each full width, owner request), then Details as a closed disclosure with a one-line summary (#307). A section nav with counts
 * (`mf-section-nav`, #308) sits above the Workflow at every width and sticks from 640 px. The old `?tab=` links scroll to the section
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
    SectionNav,
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

          <mf-detail-layout
            [split]="true"
            [splitKey]="splitKey()"
            [summary]="summary()"
            [(narrowOpen)]="detailsOpen"
            (narrowOpenChange)="rememberDetails($event)"
          >
            <mf-section-nav
              mfTop
              class="topnav"
              label="Sections"
              [items]="navItems()"
              (navigate)="jump($event)"
            />
            <div mfMain>
              <div class="sec" id="task-workflow" data-section="workflow">
                <mf-task-workflow-tab />
              </div>
            </div>

            <div mfBelow class="below">
              <div class="bottom">
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
                    (countChange)="assetCount.set($event)"
                  />
                </div>

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
                    (countChange)="commentCount.set($event)"
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
     * Under the Workflow: Assets, then Comments, each the full width of the main column at every width (owner request: stacked, never
     * side by side). Each panel's list is its own scroll area, capped at 60vh (--mf-panel-max); on phones everything flows.
     */
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
    /*
     * The section nav (#308): above the Workflow at every width, sticky from 640 px inside the left column (the layout puts it first
     * there). A section link scrolls to the section's box under the app header and the sticky row, so the section starts in view.
     */
    .topnav {
      margin-bottom: var(--mf-s2);
    }
    .sec {
      scroll-margin-top: calc(var(--mf-header-h, 3.75rem) + var(--mf-s2));
    }
    @media (min-width: 640px) {
      .topnav {
        margin-bottom: var(--mf-s2);
      }
      .sec {
        scroll-margin-top: calc(var(--mf-header-h, 3.75rem) + 3rem);
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
  /** The counts the section nav shows after Comments and Assets: what the sections' own headers report (null until they have loaded). */
  protected readonly commentCount = linkedSignal<string, number | null>({
    source: () => this.id(),
    computation: () => null,
  });
  protected readonly assetCount = linkedSignal<string, number | null>({
    source: () => this.id(),
    computation: () => null,
  });
  protected readonly navItems = computed<SectionNavItem[]>(() => {
    const p = this.store.task()?.workflow.progress;
    const steps = p && p.total > 0 ? p : null;
    const canSeeAssets = this.auth.has('Asset.View');
    return [
      {
        key: 'workflow',
        label: 'Workflow',
        target: 'task-workflow',
        count: steps ? `${steps.resolved}/${steps.total}` : null,
        hint: steps ? `${steps.resolved} of ${steps.total} steps resolved` : null,
      },
      {
        key: 'assets',
        label: 'Assets',
        target: 'task-assets',
        count: canSeeAssets && this.assetCount() !== null ? String(this.assetCount()) : null,
      },
      {
        key: 'comments',
        label: 'Comments',
        target: 'task-comments',
        count: this.commentCount() === null ? null : String(this.commentCount()),
      },
    ];
  });
  /** What a closed Details holds, in one line (#307). */
  protected readonly summary = computed(() => detailsSummary(this.store.task()));
  /** Details below 1100 px: closed until the person opens it; the choice is remembered for them. */
  protected readonly detailsOpen = linkedSignal<number | undefined, boolean | null>({
    source: () => this.auth.profile()?.userId,
    computation: (user) => readOpen(detailsOpenKey(user)),
  });
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
        // ?tab=details: the Details are on the page; below 1100 px they sit in a closed disclosure, so show them (not remembered).
        else if (tab === 'details') this.detailsOpen.set(true);
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

  protected jump(section: string): void {
    if (isSection(section)) this.store.showSection(section);
  }

  protected rememberDetails(open: boolean | null): void {
    if (open !== null) saveOpen(detailsOpenKey(this.auth.profile()?.userId), open);
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
    const box = root.querySelector<HTMLElement>(`[data-section="${section}"]`);
    const heading = box?.querySelector<HTMLElement>('[data-section-heading]');
    if (!box || !heading) return;
    // The section's box is scrolled to (its scroll margin clears the app header and the sticky nav), then the heading takes the focus.
    box.scrollIntoView?.({ block: 'start' });
    heading.focus({ preventScroll: true });
  }
}
