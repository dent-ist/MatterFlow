import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, ProjectsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { NotificationService } from '../../../core/notify/notification.service';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { ScopedTasks } from '../../../shared/work-queue/scoped-tasks';
import { PageTitle, recordTitle } from '../../../core/title/page-title';
import { RecordLoadFlow, RecordState } from '../../../shared/ui/record-state';
import { RecordSkeleton, recordTabLabel, recordTabs } from '../../../shared/ui/record-skeleton';
import { ActiveBadge } from '../../../shared/ui/badge';
import { restoreTabFocus } from '../../../shared/ui/row-nav';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';

/**
 * Project detail (UX S07, #257): Tasks (n) / Details tabs across the full page width, as on Client and Matter. Tasks is the default and absent
 * from the address; `?tab=details` shows Details (Matter, Description when set, Status, dates, custom fields). The header holds Edit, Activity,
 * Create task and the overflow (Archive / Restore). Activity opens in a right-side drawer; an old `?tab=activity` link opens it too.
 */
@Component({
  selector: 'mf-project-detail-page',
  imports: [
    FixedPage,
    RecordHeader,
    ActiveBadge,
    RecordState,
    RecordSkeleton,
    ConfirmDialog,
    MatterRef,
    ActivityDrawer,
    Tabs,
    ScrollArea,
    MfDatePipe,
    CustomFieldsView,
    ScopedTasks,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-fixed-page>
      <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
      @switch (state()) {
        @case ('loading') {
          <mf-record-skeleton kind="project" [activeTab]="current()" />
        }
        @case ('ready') {
          @if (project(); as p) {
            <mf-record-header
              kind="project"
              [parents]="[
                { label: 'Matters', link: '/matters', plain: !canLinkMatter() },
                { label: p.matterRef, link: ['/matters', p.matterId], plain: !canLinkMatter() },
              ]"
              [current]="p.name"
              [name]="p.name"
              [active]="p.isActive"
              inactiveLabel="Archived"
              [actions]="headerActions()"
            >
              <span mfContext data-matter
                >Matter
                <mf-matter-ref
                  [value]="p.matterRef"
                  [link]="canLinkMatter() ? ['/matters', p.matterId] : null"
                  [copy]="false"
                />
                {{ p.matterName }}
              </span>
            </mf-record-header>

            @if (!p.isActive) {
              <div class="pg-banner" role="note" data-archived-banner>
                This project is archived. Existing tasks keep it, but new tasks can't select it.
              </div>
            }

            <mf-tabs
              class="pd-tabs"
              label="Project sections"
              idPrefix="project"
              [tabs]="tabs()"
              [selected]="current()"
              (tabChange)="select($event)"
            />
            <div
              class="mf-fill"
              role="tabpanel"
              id="project-panel"
              [attr.aria-labelledby]="'project-tab-' + current()"
            >
              <!-- The grid stays mounted while Details is open, so its filters and page survive a visit and the tab always has its count. -->
              <div class="mf-fill" [style.display]="current() === 'tasks' ? null : 'none'">
                <h2 class="pg-sr">Tasks</h2>
                <mf-scoped-tasks
                  [matterId]="p.matterId"
                  [projectId]="p.projectId"
                  [canCreate]="p.isActive"
                  [showCreate]="false"
                  [skipLink]="current() === 'tasks'"
                  (loaded)="onTasksLoaded($event)"
                  (opened)="taskCount.set($event)"
                />
              </div>
              @if (current() === 'details') {
                <div class="mf-scroll-area" mfScrollArea="Project details" data-details-tab>
                  <div class="pg-details">
                    <h2 class="pg-sr">Details</h2>
                    <dl class="pg-dl">
                      <dt>Matter</dt>
                      <dd data-matter-value>
                        <mf-matter-ref
                          [value]="p.matterRef"
                          [link]="canLinkMatter() ? ['/matters', p.matterId] : null"
                        />
                        {{ p.matterName }}
                      </dd>
                      @if (p.description) {
                        <dt>Description</dt>
                        <dd data-description class="pg-pre">{{ p.description }}</dd>
                      }
                      <dt>Status</dt>
                      <dd><mf-active-badge [active]="p.isActive" inactiveLabel="Archived" /></dd>
                      <dt>Created</dt>
                      <dd>{{ p.createdAtUtc | mfDate }}</dd>
                      @if (p.modifiedAtUtc) {
                        <dt>Last changed</dt>
                        <dd>{{ p.modifiedAtUtc | mfDate }}</dd>
                      }
                    </dl>
                    <mf-custom-fields-view
                      [versionId]="p.formVersionId"
                      [values]="p.formValues ?? {}"
                    />
                  </div>
                </div>
              }
            </div>

            @if (canSeeActivity()) {
              <mf-activity-drawer
                objectType="Project"
                [objectId]="p.projectId"
                [name]="p.name"
                [visible]="activityOpen()"
                (visibleChange)="setActivityOpen($event)"
              />
            }

            <mf-confirm-dialog
              [title]="p.isActive ? 'Archive project' : 'Restore project'"
              [confirmLabel]="p.isActive ? 'Archive' : 'Restore'"
              [danger]="p.isActive"
              [busy]="busy()"
              [(visible)]="toggleOpen"
              (confirmed)="toggleActive()"
            >
              @if (p.isActive) {
                <p data-toggle-body>
                  Archive {{ p.name }}? Existing tasks keep this project, but new tasks can't select
                  it.
                </p>
              } @else {
                <p data-toggle-body>Restore {{ p.name }}? New tasks can select it again.</p>
              }
            </mf-confirm-dialog>
          }
        }
        @default {
          <mf-record-state
            kind="project"
            [recordId]="projectId()"
            [state]="state()"
            [busy]="flow.retrying()"
            (retried)="load()"
          />
        }
      }
    </mf-fixed-page>
  `,
})
export class ProjectDetailPage {
  readonly projectId = input.required<string>();
  /** `?tab=`: `details`, or Tasks (default, also when absent). An old `activity` link opens the drawer and shows Tasks. */
  readonly tab = input<string>();

  private readonly api = inject(ProjectsClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly flow = new RecordLoadFlow('project');
  protected readonly state = this.flow.state;
  protected readonly project = signal<ProjectResponse | null>(null);
  protected readonly activityOpen = signal(false);
  /** How many tasks the project has (the Tasks grid's total while the person has not narrowed it); null until the grid has answered. */
  protected readonly taskCount = signal<number | null>(null);
  private readonly tasksAnswered = signal(false);
  protected readonly tabs = computed<MfTab[]>(() =>
    recordTabs('project', {
      // Without Task.View the grid does not load: no count rather than a permanent `--`.
      // A grid first opened with the person's own filters (a link) cannot tell the whole count: no number then, not a permanent `--`.
      tasks: this.auth.has('Task.View')
        ? (this.taskCount() ?? (this.tasksAnswered() ? null : '--'))
        : null,
    }),
  );
  protected readonly current = computed<'tasks' | 'details'>(() =>
    this.tab() === 'details' ? 'details' : 'tasks',
  );
  protected readonly toggleOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  protected readonly canLinkMatter = computed(() => this.auth.canLink('matter'));
  /** The header's actions (C3, #255): Edit, Activity, the primary Create task and, in the overflow, Archive / Restore. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const p = this.project();
    if (!p) return [];
    const list: RecordAction[] = [];
    if (this.auth.has('Project.Edit')) {
      list.push({
        id: 'edit',
        role: 'edit',
        label: 'Edit',
        run: () => this.go('/projects/' + p.projectId + '/edit'),
      });
    }
    if (this.canSeeActivity()) {
      list.push({
        id: 'activity',
        role: 'activity',
        label: 'Activity',
        icon: 'pi-history',
        run: () => this.setActivityOpen(true),
      });
    }
    if (this.auth.has('Task.Create')) {
      list.push({
        id: 'create-task',
        role: 'primary',
        label: 'Create task',
        icon: 'pi-plus',
        disabled: !p.isActive,
        reason: "This project is archived. New tasks can't select it.",
        run: () => this.go('/tasks/new?matterId=' + p.matterId + '&projectId=' + p.projectId),
      });
    }
    if (this.auth.has('Project.Archive')) {
      list.push({
        id: 'toggle-active',
        role: 'state',
        label: p.isActive ? 'Archive' : 'Restore',
        run: () => this.toggleOpen.set(true),
      });
    }
    return list;
  });

  constructor() {
    restoreTabFocus(() => this.state() === 'ready', []);
    // `Name: Tasks` once the record is known, `Project` until then (#248); kept through tab changes.
    effect(() => {
      const p = this.state() === 'ready' ? this.project() : null;
      this.pageTitle.pin(
        p ? recordTitle(p.name, recordTabLabel('project', this.current())) : 'Project',
      );
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    effect(() => {
      this.projectId();
      untracked(() => void this.load());
    });
    effect(() => {
      if (this.tab() === 'activity' && this.canSeeActivity()) {
        untracked(() => this.activityOpen.set(true));
      }
    });
  }

  protected select(key: string): void {
    // The Tasks grid keeps its filters in the address and stays mounted, so only `tab` changes.
    void this.router.navigate([], {
      queryParams: { tab: key === 'tasks' ? null : key },
      queryParamsHandling: 'merge',
    });
  }

  protected onTasksLoaded(e: { total: number; filtered: boolean }): void {
    this.tasksAnswered.set(true);
    if (!e.filtered) this.taskCount.set(e.total);
  }

  protected setActivityOpen(open: boolean): void {
    this.activityOpen.set(open);
    if (!open && this.tab() === 'activity') {
      void this.router.navigate([], {
        queryParams: { tab: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  async load(): Promise<void> {
    await this.flow.run(
      () => firstValueFrom(this.api.getProject(Number(this.projectId()))),
      (project) => this.project.set(project),
    );
  }

  protected async toggleActive(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.setProjectActive(p.projectId, { isActive: !p.isActive, rowVersion: p.rowVersion }),
      );
      this.project.set(updated);
      this.toggleOpen.set(false);
      this.notify.success(updated.isActive ? 'Project restored' : 'Project archived');
    } catch {
      this.toggleOpen.set(false);
      await this.load(); // conflicts and failures are toasted by the HTTP layer; show the latest state
    } finally {
      this.busy.set(false);
    }
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }
}
