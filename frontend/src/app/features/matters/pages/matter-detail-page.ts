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
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  MatterResponse,
  MattersClient,
  NotesClient,
  ProductionsClient,
  ProjectResponse,
  ProjectsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { MenuAction } from '../../../shared/ui/action-menu';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { MatterAssets } from '../../../shared/ui/matter-assets';
import { SCOPED_TASK_PARAMS, ScopedTasks } from '../../../shared/work-queue/scoped-tasks';
import { PageTitle, recordTitle } from '../../../core/title/page-title';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { RecordSkeleton, recordTabLabel } from '../../../shared/ui/record-skeleton';
import { FixedPage } from '../../../shared/ui/fixed-page';
import { restoreTabFocus } from '../../../shared/ui/row-nav';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { MatterHeader } from '../ui/matter-header';
import { MatterTabKey, matterTabFromParam, visibleMatterTabs } from '../ui/matter-tabs';
import { ProjectPanel } from '../../projects/ui/project-panel';
import { ProjectTasksPanel } from '../../projects/ui/project-tasks-panel';
import { MatterFormDialog } from '../ui/matter-form-dialog';
import { MatterActivities } from '../ui/matter-activities';
import { MatterSummary } from '../ui/matter-summary';
import { MatterEventPanel } from '../ui/matter-event-panel';
import { AddCommentDialog } from '../../../shared/matter-actions/add-comment-dialog';
import { ManagerTarget, MatterManagersDialog } from '../ui/matter-managers-dialog';
import { MatterProjects } from './matter-projects';
import { ProductionsTab } from '../../productions/productions-tab';
import { NotesTab } from '../../notes/notes-tab';

/** The API's largest page (`PageRequest.MaxPageSize`). */
const PROJECTS_PAGE_MAX = 100;

type Tab = MatterTabKey;

/**
 * Matter detail (UX S06): reference with copy button, the inactive banners, activation with the open-task rule,
 * and Overview / Tasks / Projects / Assets tabs across the full page width (Overview first and the default, key `details`: the task summary
 * strip, whose items open the Tasks tab on the matching view, then Client, Status, Sensitive, dates and custom fields; Tasks is the shared
 * work-queue table filtered to the Matter). Activity opens in a right-side drawer. The tab is kept in `?tab=`
 * (absent for Details); `?tab=activity` opens the drawer.
 */
@Component({
  selector: 'mf-matter-detail-page',
  imports: [
    FixedPage,
    MatterHeader,
    ProjectPanel,
    ProjectTasksPanel,
    MatterActivities,
    RecordState,
    RecordSkeleton,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterAssets,
    Tabs,
    ScopedTasks,
    MatterProjects,
    MatterSummary,
    MatterEventPanel,
    MatterFormDialog,
    ProductionsTab,
    NotesTab,
    AddCommentDialog,
    MatterManagersDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    /* Under the header, wrapping: a phone shows the line under the name instead of cutting it. */
    .md-managers {
      margin: 0;
      padding: var(--mf-s1) 0;
      color: var(--mf-text-muted);
      overflow-wrap: anywhere;
    }
    .md-link {
      min-height: 0;
      padding: 0 var(--mf-s2);
    }
    /* The compact summary above the overview (PM v2, #882): state, flag and creation date on one line, the rest behind "Details". */
    .md-summary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .md-details {
      max-width: 70ch;
      margin-bottom: var(--mf-s3);
    }
    /* The Overview's sections use the width of the page (the column of 70 characters is for the details list and the custom fields). */
    .pg-details[data-matter-overview] {
      max-width: none;
    }
  `,
  template: `
    <mf-fixed-page>
      <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
      @switch (state()) {
        @case ('loading') {
          <mf-record-skeleton kind="matter" [activeTab]="current()" (retry)="load()" />
        }
        @case ('ready') {
          @if (matter(); as m) {
            <mf-matter-header
              [matter]="m"
              [newItems]="newItems()"
              [moreItems]="moreItems()"
              [canEdit]="canEdit()"
              (edit)="openEdit()"
            />

            @if (!m.isActive) {
              <div class="pg-banner" role="note" data-inactive-banner>
                This matter is inactive. New tasks can't be created and completed or cancelled tasks
                can't be reopened.
              </div>
            }
            @if (!m.clientIsActive) {
              <div class="pg-banner" role="note" data-client-inactive-banner>
                The client {{ m.clientNumber }} is inactive.
              </div>
            }

            <mf-tabs
              label="Matter sections"
              idPrefix="matter"
              [tabs]="tabs()"
              [selected]="current()"
              (tabChange)="select($event)"
            />
            <div
              class="mf-fill"
              role="tabpanel"
              id="matter-panel"
              [attr.aria-labelledby]="'matter-tab-' + current()"
            >
              @switch (current()) {
                @case ('summary') {
                  <mf-matter-summary
                    [matter]="m"
                    [reload]="reloadTick()"
                    [canAssign]="canAssign()"
                    [canLinkClient]="canLinkClient()"
                    data-details-tab
                    (changeManagers)="managersOpen.set(true)"
                    (newAsset)="go('/assets/new?matterId=' + m.matterId)"
                  />
                }
                @case ('tasks') {
                  <mf-scoped-tasks
                    [matterId]="m.matterId"
                    [canCreate]="m.isActive"
                    [projectOptions]="projectOptions()"
                    [projectCount]="m.projectCount"
                    [startSelecting]="selectTick()"
                  />
                }
                @case ('projects') {
                  <mf-matter-projects
                    [matterId]="m.matterId"
                    [matterRef]="m.matterRef"
                    [projects]="projects()"
                    [total]="projectsTotal()"
                    (newProject)="openProjectPanel()"
                    (openProject)="openProjectTasks($event)"
                  />
                }
                @case ('productions') {
                  <mf-productions-tab [matterId]="m.matterId" (changed)="refreshTabCounts()" />
                }
                @case ('notes') {
                  <mf-notes-tab
                    [matterId]="m.matterId"
                    [matterLabel]="m.matterRef + ' ' + m.name"
                    [clientId]="m.clientId"
                    [clientName]="m.clientName"
                    [sensitive]="m.isSensitive"
                    [aiAllowed]="m.aiAllowed"
                    (changed)="refreshTabCounts()"
                  />
                }
                @case ('activities') {
                  <mf-matter-activities [matterId]="m.matterId" data-activities-tab />
                }
                @case ('assets') {
                  @if (canSeeAssets()) {
                    <mf-matter-assets
                      [matterId]="m.matterId"
                      [status]="status()"
                      [page]="page()"
                      [size]="size()"
                      [sort]="sort()"
                    />
                  } @else {
                    <div class="pg-state" data-no-access="assets">
                      You don't have permission to view assets.
                    </div>
                  }
                }
              }
            </div>

            @if (commentUsed()) {
              <mf-add-comment-dialog
                [matterId]="m.matterId"
                [matterLabel]="m.matterRef + ' ' + m.name"
                [(visible)]="commentOpen"
              />
            }

            @if (projectTasksUsed()) {
              <mf-project-tasks-panel
                [matterId]="m.matterId"
                [matterLabel]="m.matterRef + ' ' + m.name"
                [project]="projectShown()"
                [(visible)]="projectTasksOpen"
                (changed)="projectSaved()"
                (edit)="editProject($event)"
              />
            }

            @if (projectPanelUsed()) {
              <mf-project-panel
                [matterId]="m.matterId"
                [matterLabel]="m.matterRef + ' ' + m.name"
                [project]="projectEdited()"
                [(visible)]="projectPanelOpen"
                (saved)="projectSaved()"
              />
            }

            @if (eventUsed()) {
              <mf-matter-event-panel
                [matterId]="m.matterId"
                [matterLabel]="m.matterRef + ' ' + m.name"
                [(visible)]="eventOpen"
              />
            }

            @if (editUsed()) {
              <mf-matter-form-dialog
                [matter]="m"
                [(visible)]="editOpen"
                (saved)="edited($event)"
                (lostAccess)="go('/matters')"
              />
            }

            @if (canAssign()) {
              <mf-matter-managers-dialog
                [targets]="[managerTarget(m)]"
                [(visible)]="managersOpen"
                (saved)="managersSaved($event.updated[0], m.openTaskCount)"
              />
            }

            <mf-confirm-dialog
              [title]="m.isActive ? 'Set Matter Inactive' : 'Reactivate Matter'"
              [confirmLabel]="m.isActive ? 'Set Matter Inactive' : 'Reactivate Matter'"
              [danger]="m.isActive"
              [busy]="busy()"
              [(visible)]="toggleOpen"
              (confirmed)="toggleActive()"
            >
              @if (m.isActive) {
                <p data-toggle-body>
                  {{ m.matterRef }} becomes inactive: new tasks can't be created and completed or
                  cancelled tasks can't be reopened until you reactivate it.
                </p>
              } @else {
                <p data-toggle-body>
                  {{ m.matterRef }} becomes active and new tasks can be created for it again.
                </p>
              }
            </mf-confirm-dialog>

            <mf-confirm-dialog
              title="Can't Set Matter Inactive"
              [showConfirm]="false"
              [(visible)]="blockedOpen"
            >
              <p data-blocked-body>
                This matter has {{ blockedCount() }} tasks that aren't Completed or Cancelled.
                Finish or cancel them first.
              </p>
              <p-button
                *mfHasPermission="'Task.View'"
                label="View open tasks"
                severity="secondary"
                (onClick)="go('/tasks?matterId=' + m.matterId)"
              />
            </mf-confirm-dialog>
          }
        }
        @default {
          <mf-record-state
            kind="matter"
            [recordId]="matterId()"
            [state]="state()"
            [busy]="flow.retrying()"
            (retried)="load()"
          />
        }
      }
    </mf-fixed-page>
  `,
})
export class MatterDetailPage {
  readonly matterId = input.required<string>();
  /** `?tab=`: `details` (default, also when absent), `tasks`, `projects`, `assets`; `activity` opens the drawer and shows Details. */
  readonly tab = input<string>();
  /** The Assets tab's list state (its filters `name`, `typeId`, `extref` are read from the address by the tab itself). */
  readonly status = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();

  private readonly api = inject(MattersClient);
  private readonly productionsApi = inject(ProductionsClient);
  private readonly notesApi = inject(NotesClient);
  private readonly pageTitle = inject(PageTitle);
  private readonly projectsApi = inject(ProjectsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);

  protected readonly flow = new RecordLoadFlow('matter');
  protected readonly state = this.flow.state;
  protected readonly matter = signal<MatterResponse | null>(null);
  protected readonly projects = signal<ProjectResponse[]>([]);
  /** How many projects the matter has, so a list cut at the page maximum says so instead of looking complete. */
  protected readonly projectsTotal = signal(0);
  protected readonly eventOpen = signal(false);
  protected readonly eventUsed = signal(false);
  /** The Calendar event entry of the New menu exists only for project managers who can open My Matters, where the events show (Matter.BeManager; the Summary's Next events panel is gone, MD-23). */
  protected readonly canCalendar = computed(() => this.auth.has('Matter.BeManager'));
  /** Add event: a manager of this matter or a holder of Matter.Edit, on an active matter. */
  protected readonly canAddEvent = computed(() => {
    const m = this.matter();
    if (!m || !m.isActive || !this.canCalendar()) return false;
    const me = this.auth.profile()?.userId;
    return (
      this.auth.has('Matter.Edit') ||
      (me !== undefined && (m.primaryManager?.userId === me || m.secondaryManager?.userId === me))
    );
  });
  protected readonly editOpen = signal(false);
  protected readonly editUsed = signal(false);
  protected readonly canEdit = computed(() => this.auth.has('Matter.Edit'));
  protected readonly projectTasksOpen = signal(false);
  protected readonly projectTasksUsed = signal(false);
  /** The project whose linked tasks the side panel shows. */
  protected readonly projectShown = signal<ProjectResponse | null>(null);
  /** The project the create/edit panel edits; null creates a new one. */
  protected readonly projectEdited = signal<ProjectResponse | null>(null);
  protected readonly projectPanelOpen = signal(false);
  /** The project panel exists from the first use on (a closed panel is no markup on the page). */
  protected readonly projectPanelUsed = signal(false);
  /** How many assets the matter has (the summary's `assetCount`, retired ones included); null when unknown or not for this viewer. */
  protected readonly assetCount = signal<number | null>(null);
  /** The Productions and Notes tab numbers (their own summary endpoints); null until known or when the viewer may not see them. */
  protected readonly productionCount = signal<number | null>(null);
  protected readonly noteCount = signal<number | null>(null);
  /**
   * The tab strip. Projects and Assets are offered only with their View permission (a person who may not see them has no tab to open),
   * and a count is shown only when the viewer may see what it counts (no fake zero without Task.View).
   */
  protected readonly tabs = computed<MfTab[]>(() => {
    const m = this.matter();
    const counts: Partial<Record<string, number | null>> = {
      tasks: this.auth.has('Task.View') ? (m?.openTaskCount ?? 0) : null,
      projects: m?.projectCount ?? 0,
      assets: this.assetCount(),
      productions: this.productionCount(),
      notes: this.noteCount(),
    };
    return visibleMatterTabs((code) => this.auth.has(code)).map((t) => {
      const tab: MfTab = { key: t.key, label: t.label, icon: t.icon };
      if (t.counted) tab.count = counts[t.key];
      return tab;
    });
  });
  protected readonly current = computed<Tab>(() =>
    matterTabFromParam(
      this.tab(),
      this.tabs().map((t) => t.key),
    ),
  );
  protected readonly projectOptions = computed(() =>
    this.projects().map((p) => ({
      value: String(p.projectId),
      label: p.isActive ? p.name : `${p.name} (archived)`,
    })),
  );
  protected readonly toggleOpen = signal(false);
  protected readonly managersOpen = signal(false);
  /** Counts the changes that make the Summary's overview reload. */
  protected readonly reloadTick = signal(0);
  protected readonly commentOpen = signal(false);
  /** The dialog exists from the first use on (a closed dialog is no markup on the page). */
  protected readonly commentUsed = signal(false);
  /** Counts the requests for selection mode on the Tasks tab ("Bulk re-assign / re-prioritise"). */
  protected readonly selectTick = signal(0);
  protected readonly canAssign = computed(() => this.auth.has('Matter.AssignManagers'));
  protected readonly blockedOpen = signal(false);
  protected readonly blockedCount = signal(0);
  protected readonly busy = signal(false);
  protected readonly canLinkClient = computed(() => this.auth.canLink('client'));
  protected readonly canSeeAssets = computed(() => this.auth.has('Asset.View'));
  /** Deactivation is disabled with a visible reason while Tasks are open (UX 5.7). */
  protected readonly deactivateBlocked = computed(() => {
    const m = this.matter();
    return !!m && m.isActive && (m.openTaskCount ?? 0) > 0;
  });
  /**
   * The New menu (MD-01): Task, Project and Asset with their Create permission. Production, Spec, Note and Event are added by the
   * tabs that build them (MD-08, MD-11, MD-13); an entry for a feature that does not exist yet is not drawn.
   */
  protected readonly newItems = computed<MenuAction[]>(() => {
    const m = this.matter();
    if (!m) return [];
    const list: MenuAction[] = [];
    if (this.auth.has('Task.Create')) {
      list.push({
        id: 'create-task',
        label: 'Task',
        icon: 'pi-check-square',
        disabled: !m.isActive,
        reason: "This matter is inactive. New tasks can't be created.",
        run: () => this.go('/tasks/new?matterId=' + m.matterId),
      });
    }
    if (this.auth.has('Project.Create')) {
      list.push({
        id: 'new-project',
        label: 'Project',
        icon: 'pi-folder',
        run: () => this.openProjectPanel(),
      });
    }
    if (this.auth.has('Asset.Create')) {
      list.push({
        id: 'new-asset',
        label: 'Asset',
        icon: 'pi-database',
        run: () => this.go('/assets/new?matterId=' + m.matterId),
      });
    }
    if (this.canAddEvent()) {
      list.push({
        id: 'new-event',
        label: 'Calendar Event',
        icon: 'pi-calendar-plus',
        run: () => this.openEventPanel(),
      });
    }
    return list;
  });

  /** More actions (MD-01): bulk re-assign / re-prioritise, Add comment, Open the matter's tasks, Set inactive / Set active (with the open-task block). */
  protected readonly moreItems = computed<MenuAction[]>(() => {
    const m = this.matter();
    if (!m) return [];
    const list: MenuAction[] = [];
    if (this.auth.has('Task.View')) {
      if (this.auth.has('Task.Assign') || this.auth.has('Task.SetPriority')) {
        list.push({
          id: 'bulk-tasks',
          label: 'Bulk Update',
          icon: 'pi-check-square',
          run: () => this.bulk(m.matterId),
        });
      }
      if (this.auth.has('Task.Comment')) {
        list.push({
          id: 'add-comment',
          label: 'Add Comment',
          icon: 'pi-comment',
          run: () => {
            this.commentUsed.set(true);
            this.commentOpen.set(true);
          },
        });
      }
      list.push({
        id: 'open-tasks',
        label: 'Open Task List',
        icon: 'pi-list',
        run: () => this.select('tasks'),
      });
    }
    if (this.auth.has('Matter.SetActive')) {
      list.push({
        id: 'toggle-active',
        label: m.isActive ? 'Set Inactive' : 'Set Active',
        separated: true,
        disabled: this.deactivateBlocked(),
        reason: `This matter has ${m.openTaskCount} tasks that aren't Completed or Cancelled. Finish or cancel them first.`,
        run: () => this.toggleOpen.set(true),
      });
    }
    return list;
  });

  constructor() {
    // Back from a project or a task: the Projects or Tasks tab focuses the row left, every other return focuses the selected tab.
    restoreTabFocus(() => this.state() === 'ready', ['matter-projects', 'matter-tasks']);
    // `00107-00001 Name: Tasks` once the record is known, `Matter` until then (#248); kept through tab changes.
    effect(() => {
      const m = this.state() === 'ready' ? this.matter() : null;
      this.pageTitle.pin(
        m
          ? recordTitle(m.matterRef + ' ' + m.name, recordTabLabel('matter', this.current()))
          : recordStateTitle('matter', this.state()),
      );
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    effect(() => {
      this.matterId();
      untracked(() => void this.load());
    });
    effect(() => {
      void this.matter()?.matterId;
      untracked(() => this.refreshTabCounts());
    });
  }

  protected managerTarget(m: MatterResponse): ManagerTarget {
    return {
      matterId: m.matterId,
      label: `${m.matterRef} ${m.name}`,
      rowVersion: m.rowVersion,
      primary: m.primaryManager ?? null,
      secondary: m.secondaryManager ?? null,
    };
  }

  /** The managers were saved: show them (the open count is not part of that answer, keep ours). */
  protected managersSaved(
    updated: MatterResponse | undefined,
    openTaskCount: number | undefined,
  ): void {
    if (updated) this.matter.set({ ...updated, openTaskCount });
  }

  protected select(key: string): void {
    void this.router.navigate([], {
      // The filters of the Tasks and Assets tabs, and the Assets paging and sort, belong to their tab only.
      queryParams: {
        tab: key === 'summary' ? null : key,
        name: null,
        typeId: null,
        extref: null,
        ...Object.fromEntries(SCOPED_TASK_PARAMS.map((p) => [p, null])),
        page: null,
        size: null,
        sort: null,
      },
      queryParamsHandling: 'merge',
    });
  }

  protected openEventPanel(): void {
    this.eventUsed.set(true);
    this.eventOpen.set(true);
  }

  protected openEdit(): void {
    this.editUsed.set(true);
    this.editOpen.set(true);
  }

  /** The matter was saved in the panel: show the saved state (the open-task count is not part of the answer, keep ours). */
  protected edited(updated: MatterResponse): void {
    this.matter.update((m) => ({ ...updated, openTaskCount: m?.openTaskCount }));
    this.reloadTick.update((n) => n + 1);
  }

  protected openProjectTasks(p: ProjectResponse): void {
    this.projectShown.set(p);
    this.projectTasksUsed.set(true);
    this.projectTasksOpen.set(true);
  }

  protected editProject(p: ProjectResponse): void {
    this.projectTasksOpen.set(false);
    this.projectEdited.set(p);
    this.projectPanelUsed.set(true);
    this.projectPanelOpen.set(true);
  }

  protected openProjectPanel(): void {
    this.projectEdited.set(null);
    this.projectPanelUsed.set(true);
    this.projectPanelOpen.set(true);
  }

  /** A project was created in the panel: the list and the count come from a fresh load; the page stays where it is. */
  protected projectSaved(): void {
    void this.refresh();
    this.reloadTick.update((n) => n + 1);
  }

  /** Loads (or refreshes) the Productions and Notes tab numbers; a failure only leaves the tab without one. */
  protected refreshTabCounts(): void {
    const id = this.matter()?.matterId;
    if (id === undefined) return;
    if (this.auth.has('Production.View')) {
      firstValueFrom(this.productionsApi.getMatterProductionsSummary(id))
        .then((s) => this.productionCount.set(s.productionCount))
        .catch(() => undefined);
    }
    if (this.auth.has('MatterNote.View')) {
      firstValueFrom(this.notesApi.getMatterNotesSummary(id))
        .then((s) => this.noteCount.set(s.noteCount))
        .catch(() => undefined);
    }
  }

  private fetchAll(id: number) {
    return Promise.all([
      firstValueFrom(this.api.getMatter(id)),
      // The Assets tab's number; a failure only leaves the tab without one.
      this.auth.has('Asset.View')
        ? firstValueFrom(this.api.getMatterSummary(id)).catch(() => null)
        : Promise.resolve(null),
      this.auth.has('Project.View')
        ? // One request at the API's page maximum; the Projects tab sorts them itself (natural order).
          firstValueFrom(
            this.projectsApi.listProjects(
              undefined,
              id,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              1,
              PROJECTS_PAGE_MAX,
              'name',
            ),
          )
        : Promise.resolve(null),
    ]);
  }

  private apply([matter, summary, projects]: Awaited<
    ReturnType<MatterDetailPage['fetchAll']>
  >): void {
    this.matter.set(matter);
    this.assetCount.set(summary?.assetCount ?? null);
    this.projects.set(projects?.items ?? []);
    this.projectsTotal.set(projects?.total ?? 0);
  }

  async load(): Promise<void> {
    const id = Number(this.matterId());
    await this.flow.run(
      () => this.fetchAll(id),
      (all) => this.apply(all),
    );
  }

  /** Loads the same data without the page's loading state, so an open side panel stays where it is (after a change made inside a panel). */
  protected async refresh(): Promise<void> {
    try {
      this.apply(await this.fetchAll(Number(this.matterId())));
    } catch {
      // The numbers stay as they were; the panel that made the change already told the person what happened.
    }
  }

  protected async toggleActive(): Promise<void> {
    const m = this.matter();
    if (!m) return;
    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.setMatterActive(m.matterId, { isActive: !m.isActive, rowVersion: m.rowVersion }),
      );
      this.matter.set({ ...updated, openTaskCount: m.openTaskCount });
      this.toggleOpen.set(false);
      this.notify.success(updated.isActive ? 'Matter reactivated' : 'Matter set inactive');
    } catch (err) {
      this.toggleOpen.set(false);
      if (err instanceof ApiError && err.code === 'MATTER_HAS_OPEN_TASKS') {
        const count = err.problem?.meta?.['openTaskCount'];
        this.blockedCount.set(typeof count === 'number' ? count : 0);
        this.blockedOpen.set(true);
      } else {
        await this.load(); // conflicts and failures are toasted by the HTTP layer; show the latest state
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected go(path: string): void {
    void this.router.navigateByUrl(path);
  }

  /** The Tasks tab in selection mode: asked of the open tab, or carried in the router state to the tab about to open. */
  private bulk(matterId: number): void {
    if (this.current() === 'tasks') {
      this.selectTick.update((n) => n + 1);
      return;
    }
    void this.router.navigate(['/matters', matterId], {
      queryParams: { tab: 'tasks' },
      state: { selectTasks: true },
    });
  }
}
