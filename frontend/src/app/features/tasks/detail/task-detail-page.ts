import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { TaskActivity } from '../panels/task-activity';
import { TaskAssetLinks } from '../panels/task-asset-links';
import { detailsOpenKey, readOpen, saveOpen } from '../panels/section-state';
import { TaskComments } from '../panels/task-comments';
import { TaskActionDialogs } from './task-action-dialogs';
import { detailsSummary } from './details-summary';
import { TaskDetailStore, TaskPageTab } from './task-detail.store';
import { TaskDetailsTab } from './task-details-tab';
import { TaskHeader } from './task-header';
import { TaskStatusNote } from './task-status-note';
import { registerTaskShortcuts } from './task-shortcuts';
import { TaskWorkflowTab } from './task-workflow-tab';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { DetailLayout } from '../../../shared/ui/detail-layout';
import { RecordSkeleton } from '../../../shared/ui/record-skeleton';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
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

const TABS: readonly string[] = ['workflow', 'assets', 'comments'];
const isTab = (v: unknown): v is TaskPageTab => TABS.includes(v as string);

/**
 * Task detail (UX S10, `/tasks/:id`): one page in the layout of the Client, Matter and Project pages. The header (the shared record header
 * and the facts strip) carries Edit, Activity, Complete task or Reopen task and the overflow; then the one status note (Completed, Cancelled or
 * On Hold: who, when, why; T3) and the banners (conflict, warnings); then, in the left column, the tabs Workflow (the default), Assets and
 * Comments (#347, shared `mf-tabs` with counts), and Details in the side panel. Below 1100 px Details is a closed disclosure with a one-line
 * summary after the tab's content (#307). All three tab panes stay on the page (the inactive ones hidden), so counts are live, a step being
 * filled in or a comment being written survives a change of tab, and a link into a comment finds its thread. The tab is kept in `?tab=`
 * (`assets`, `comments`; the default Workflow is not written); `?tab=activity` opens the drawer, `?tab=details` shows Details, and
 * `?step=<id>` opens that step on the Workflow tab.
 */
@Component({
  selector: 'mf-task-detail-page',
  imports: [
    RecordSkeleton,
    RecordState,
    TaskHeader,
    TaskStatusNote,
    DetailLayout,
    Tabs,
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
            <mf-tabs
              mfTop
              label="Task sections"
              idPrefix="task"
              [dense]="true"
              [tabs]="tabs()"
              [selected]="current()"
              (tabChange)="select($event)"
            />
            <div mfMain>
              <div
                class="tp"
                role="tabpanel"
                id="task-panel"
                [attr.aria-labelledby]="'task-tab-' + current()"
              >
                <div class="tp__pane" [hidden]="current() !== 'workflow'" data-section="workflow">
                  <mf-task-workflow-tab />
                </div>
                <div
                  class="tp__pane tp__pane--assets"
                  [hidden]="current() !== 'assets'"
                  data-section="assets"
                >
                  <mf-task-asset-links
                    [taskId]="t.taskId"
                    [matterId]="t.matter.matterId"
                    [readOnly]="store.closed()"
                    [taskStatus]="t.status"
                    (countChange)="assetCount.set($event)"
                  />
                </div>
                <div
                  class="tp__pane tp__pane--comments"
                  [hidden]="current() !== 'comments'"
                  data-section="comments"
                >
                  <mf-task-comments
                    [taskId]="t.taskId"
                    [refresh]="t.rowVersion"
                    [focusRequest]="store.commentFocus()"
                    [active]="current() === 'comments'"
                    [composerRequest]="store.composerRequest()"
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
     * The three tab panes fill the left column. Each list is its own scroll area, capped at 60vh (--mf-panel-max); on phones everything flows.
     */
    .tp {
      min-width: 0;
    }
    .tp__pane[hidden] {
      display: none;
    }
    @media (min-width: 600px) {
      .tp__pane--assets {
        --mf-panel-max: 60vh;
      }
    }
    @media (min-width: 1100px) {
      .tp__pane--comments {
        --mf-panel-max: 60vh;
      }
    }
  `,
})
export class TaskDetailPage implements HasUnsavedChanges {
  /** Route parameter `:id`. */
  readonly id = input.required<string>();
  /** Query parameter `?tab=`: the tab to show (`assets`, `comments`; `workflow` is the default), `activity` for the drawer, `details` for Details. */
  readonly tab = input<string | undefined>();
  /** Query parameter `?step=<stepInstanceId>`: opens that step and moves focus to it. */
  readonly step = input<string | undefined>();

  protected readonly store = inject(TaskDetailStore);
  private readonly pageTitle = inject(PageTitle);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);

  /** Where this person's Details width is remembered (the splitter of the two-column layout). */
  protected readonly splitKey = computed(
    () => `mf.task-detail.split.${this.auth.profile()?.userId ?? 'anon'}`,
  );

  /** The tab showing: the address's `?tab=` (Workflow when absent or not a tab), or what the person chose since. */
  protected readonly current = linkedSignal<string | undefined, TaskPageTab>({
    source: () => this.tab(),
    computation: (t) => (isTab(t) ? t : 'workflow'),
  });
  /** The counts the tabs show after Comments and Assets: what the panes themselves report (null until they have loaded). */
  protected readonly commentCount = linkedSignal<string, number | null>({
    source: () => this.id(),
    computation: () => null,
  });
  protected readonly assetCount = linkedSignal<string, number | null>({
    source: () => this.id(),
    computation: () => null,
  });
  protected readonly tabs = computed<MfTab[]>(() => {
    const p = this.store.task()?.workflow.progress;
    const steps = p && p.total > 0 ? p : null;
    const canSeeAssets = this.auth.has('Asset.View');
    const known = (n: number | null): number | string => (n === null ? '--' : n);
    return [
      {
        key: 'workflow',
        label: 'Workflow',
        count: steps ? `${steps.resolved}/${steps.total}` : null,
        name: steps ? `Workflow, ${steps.resolved} of ${steps.total} steps resolved` : undefined,
      },
      { key: 'assets', label: 'Assets', count: canSeeAssets ? known(this.assetCount()) : null },
      { key: 'comments', label: 'Comments', count: known(this.commentCount()) },
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
    // C, A and S (comment, Assignee menu, Status menu) while "Keyboard shortcuts" is on (K2, #327).
    registerTaskShortcuts();
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
        if (hasStep && this.current() === 'workflow') this.store.focusStepId.set(stepId);
      });
    });
    // Something other than the tab strip asks for a tab: a shortcut, a link into a comment, a link to a step.
    effect(() => {
      const request = this.store.tabRequest();
      untracked(() => {
        if (request) this.show(request.tab);
      });
    });
    effect(() => {
      const step = this.store.focusStepId();
      untracked(() => {
        if (step !== null) this.show('workflow', false);
      });
    });
    effect(() => {
      const comment = this.store.commentFocus();
      untracked(() => {
        if (comment) this.show('comments');
      });
    });
  }

  hasUnsavedChanges(): boolean {
    return this.store.editing() && this.store.dirty();
  }

  /** The person chose a tab (click or key). */
  protected select(key: string): void {
    if (isTab(key)) this.show(key);
  }

  /**
   * Shows a tab and keeps `?tab=` in step with it. The address is replaced, not added to, so Back still leaves the task for the page it was
   * opened from (T9) however many tabs were visited. `clearStep` drops a `?step=` link, which belongs to the Workflow as it was opened.
   */
  private show(tab: TaskPageTab, clearStep = true): void {
    this.current.set(tab);
    const now = this.tab();
    const inAddress = tab === 'workflow' ? now === 'assets' || now === 'comments' : now !== tab;
    if (!inAddress && !(clearStep && this.step())) return;
    void this.router.navigate([], {
      queryParams: {
        ...(inAddress ? { tab: tab === 'workflow' ? null : tab } : {}),
        ...(clearStep ? { step: null } : {}),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
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

  /** A comment chosen in the Activity: close the drawer and let the Comments tab show it. */
  protected showComment(commentId: number): void {
    this.store.activityOpen.set(false);
    this.store.commentFocus.set({
      commentId,
      seq: (this.store.commentFocus()?.seq ?? 0) + 1,
    });
  }
}
