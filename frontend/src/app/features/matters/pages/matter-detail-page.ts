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
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  MatterResponse,
  MattersClient,
  ProjectResponse,
  ProjectsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { ActiveBadge, SensitiveBadge } from '../../../shared/ui/badge';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { CustomFieldsView } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { MatterAssets } from '../../../shared/ui/matter-assets';
import { SCOPED_TASK_PARAMS, ScopedTasks } from '../../../shared/work-queue/scoped-tasks';
import { SummaryStrip } from '../../../shared/work-queue/summary-strip';
import { PageTitle, recordTitle } from '../../../core/title/page-title';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { RecordSkeleton, recordTabLabel, recordTabs } from '../../../shared/ui/record-skeleton';
import { FixedPage, ScrollArea } from '../../../shared/ui/fixed-page';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';
import { restoreTabFocus } from '../../../shared/ui/row-nav';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { MatterHealthStrip } from '../ui/matter-health-strip';
import { ManagerTarget, MatterManagersDialog } from '../ui/matter-managers-dialog';
import { MatterProjects } from './matter-projects';

/** The API's largest page (`PageRequest.MaxPageSize`). */
const PROJECTS_PAGE_MAX = 100;

type Tab = 'details' | 'tasks' | 'projects' | 'assets';

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
    ScrollArea,
    RecordHeader,
    ActiveBadge,
    RecordState,
    RecordSkeleton,
    RouterLink,
    Button,
    HasPermissionDirective,
    ConfirmDialog,
    MatterAssets,
    ActivityDrawer,
    SensitiveBadge,
    Tabs,
    MfDatePipe,
    CustomFieldsView,
    ScopedTasks,
    SummaryStrip,
    MatterProjects,
    MatterHealthStrip,
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
            <mf-record-header
              kind="matter"
              [parents]="[{ label: 'Matters', link: '/matters' }]"
              [current]="m.matterRef + ' ' + m.name"
              [ref]="m.matterRef"
              [name]="m.name"
              [active]="m.isActive"
              [sensitive]="m.isSensitive"
              [actions]="headerActions()"
            >
              <span mfContext data-client
                >Client
                @if (canLinkClient()) {
                  <a class="pg-link" [routerLink]="['/clients', m.clientId]"
                    ><span class="pg-mono">{{ m.clientNumber }}</span> {{ m.clientName }}</a
                  >
                } @else {
                  <span class="pg-mono">{{ m.clientNumber }}</span> {{ m.clientName }}
                }
              </span>
            </mf-record-header>
            @if (m.primaryManager || m.secondaryManager || canAssign()) {
              <p data-managers class="md-managers">
                @if (m.primaryManager || m.secondaryManager) {
                  Project manager:
                  @if (m.primaryManager; as p) {
                    <span data-primary-manager>{{ p.displayName }}</span>
                    <span class="pg-muted">(primary)</span>
                  }
                  @if (m.primaryManager && m.secondaryManager) {
                    ,
                  }
                  @if (m.secondaryManager; as sc) {
                    <span data-secondary-manager>{{ sc.displayName }}</span>
                    <span class="pg-muted">(secondary)</span>
                  }
                  @if (canAssign()) {
                    <button
                      type="button"
                      class="mf-btn mf-btn--text md-link"
                      data-change-managers
                      (click)="managersOpen.set(true)"
                    >
                      Change
                    </button>
                  }
                } @else {
                  <button
                    type="button"
                    class="mf-btn mf-btn--text md-link"
                    data-add-managers
                    (click)="managersOpen.set(true)"
                  >
                    Add project manager
                  </button>
                }
              </p>
            }

            <mf-matter-health-strip [matterId]="m.matterId" [reload]="healthReload()" />

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
                @case ('details') {
                  <div class="mf-scroll-area" mfScrollArea="Matter overview" data-details-tab>
                    <div class="pg-details" data-matter-overview>
                      <h2 class="pg-sr">Overview</h2>
                      <mf-summary-strip
                        kind="matter"
                        [id]="m.matterId"
                        [path]="'/matters/' + m.matterId"
                      />
                      <dl class="pg-dl">
                        <dt>Client</dt>
                        <dd data-client-value>
                          @if (canLinkClient()) {
                            <a class="pg-link" [routerLink]="['/clients', m.clientId]"
                              ><span class="pg-mono">{{ m.clientNumber }}</span>
                              {{ m.clientName }}</a
                            >
                          } @else {
                            <span class="pg-mono">{{ m.clientNumber }}</span> {{ m.clientName }}
                          }
                        </dd>
                        <dt>Status</dt>
                        <dd><mf-active-badge [active]="m.isActive" /></dd>
                        <dt>Sensitive</dt>
                        <dd data-sensitive-value>
                          @if (m.isSensitive) {
                            <mf-sensitive-badge /> <span class="pg-muted">Warning only</span>
                          } @else {
                            No
                          }
                        </dd>
                        <dt>Created</dt>
                        <dd>{{ m.createdAtUtc | mfDate }}</dd>
                        @if (m.modifiedAtUtc) {
                          <dt>Last changed</dt>
                          <dd>{{ m.modifiedAtUtc | mfDate }}</dd>
                        }
                      </dl>
                      <mf-custom-fields-view
                        [versionId]="m.formVersionId"
                        [values]="m.formValues ?? {}"
                      />
                    </div>
                  </div>
                }
                @case ('tasks') {
                  <mf-scoped-tasks
                    [matterId]="m.matterId"
                    [canCreate]="m.isActive"
                    [showCreate]="false"
                    [projectOptions]="projectOptions()"
                    [projectCount]="m.projectCount"
                  />
                }
                @case ('projects') {
                  <mf-matter-projects
                    [matterId]="m.matterId"
                    [matterRef]="m.matterRef"
                    [projects]="projects()"
                    [total]="projectsTotal()"
                  />
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

            @if (canSeeActivity()) {
              <mf-activity-drawer
                objectType="Matter"
                [objectId]="m.matterId"
                [name]="m.name"
                [visible]="activityOpen()"
                (visibleChange)="setActivityOpen($event)"
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
              [title]="m.isActive ? 'Set matter inactive' : 'Reactivate matter'"
              [confirmLabel]="m.isActive ? 'Set inactive' : 'Set active'"
              [danger]="m.isActive"
              [busy]="busy()"
              [(visible)]="toggleOpen"
              (confirmed)="toggleActive()"
            >
              @if (m.isActive) {
                <p data-toggle-body>
                  Set {{ m.matterRef }} inactive? New tasks can't be created and completed or
                  cancelled tasks can't be reopened until it's active again.
                </p>
              } @else {
                <p data-toggle-body>
                  Reactivate {{ m.matterRef }}? New tasks can be created for it again.
                </p>
              }
            </mf-confirm-dialog>

            <mf-confirm-dialog
              title="Can't set this matter inactive"
              cancelLabel="Close"
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
  protected readonly activityOpen = signal(false);
  /** How many assets the matter has (the summary's `assetCount`, retired ones included); null when unknown or not for this viewer. */
  protected readonly assetCount = signal<number | null>(null);
  /**
   * The tab strip. Projects and Assets are offered only with their View permission (a person who may not see them has no tab to open),
   * and a count is shown only when the viewer may see what it counts (no fake zero without Task.View).
   */
  protected readonly tabs = computed<MfTab[]>(() => {
    const m = this.matter();
    return recordTabs('matter', {
      tasks: this.auth.has('Task.View') ? (m?.openTaskCount ?? 0) : null,
      projects: m?.projectCount ?? 0,
      assets: this.assetCount(),
    }).filter(
      (t) =>
        (t.key !== 'projects' || this.auth.has('Project.View')) &&
        (t.key !== 'assets' || this.auth.has('Asset.View')),
    );
  });
  protected readonly current = computed<Tab>(() => {
    const t = this.tab();
    return (t === 'tasks' || t === 'projects' || t === 'assets') &&
      this.tabs().some((x) => x.key === t)
      ? t
      : 'details';
  });
  protected readonly projectOptions = computed(() =>
    this.projects().map((p) => ({
      value: String(p.projectId),
      label: p.isActive ? p.name : `${p.name} (archived)`,
    })),
  );
  protected readonly toggleOpen = signal(false);
  protected readonly managersOpen = signal(false);
  protected readonly healthReload = signal(0);
  protected readonly canAssign = computed(() => this.auth.has('Matter.AssignManagers'));
  protected readonly blockedOpen = signal(false);
  protected readonly blockedCount = signal(0);
  protected readonly busy = signal(false);
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  protected readonly canLinkClient = computed(() => this.auth.canLink('client'));
  protected readonly canSeeAssets = computed(() => this.auth.has('Asset.View'));
  /** Deactivation is disabled with a visible reason while Tasks are open (UX 5.7). */
  protected readonly deactivateBlocked = computed(() => {
    const m = this.matter();
    return !!m && m.isActive && (m.openTaskCount ?? 0) > 0;
  });
  /**
   * The header's actions (C3, #255): Edit, Activity, the primary Create task and, in the overflow, New project, New asset and
   * Set inactive / Set active (disabled with its reason while tasks are open).
   */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const m = this.matter();
    if (!m) return [];
    const list: RecordAction[] = [];
    if (this.auth.has('Matter.Edit')) {
      list.push({
        id: 'edit',
        role: 'edit',
        label: 'Edit',
        run: () => this.go('/matters/' + m.matterId + '/edit'),
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
        disabled: !m.isActive,
        reason: "This matter is inactive. New tasks can't be created.",
        run: () => this.go('/tasks/new?matterId=' + m.matterId),
      });
    }
    if (this.auth.has('Project.Create')) {
      list.push({
        id: 'new-project',
        role: 'secondary',
        label: 'New project',
        icon: 'pi-plus',
        run: () => this.go('/projects/new?matterId=' + m.matterId),
      });
    }
    if (this.auth.has('Asset.Create')) {
      list.push({
        id: 'new-asset',
        role: 'secondary',
        label: 'New asset',
        icon: 'pi-plus',
        run: () => this.go('/assets/new?matterId=' + m.matterId),
      });
    }
    if (this.auth.has('Matter.SetActive')) {
      list.push({
        id: 'toggle-active',
        role: 'state',
        label: m.isActive ? 'Set inactive' : 'Set active',
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
      if (this.tab() === 'activity' && this.canSeeActivity()) {
        untracked(() => this.activityOpen.set(true));
      }
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
        tab: key === 'details' ? null : key,
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
    const id = Number(this.matterId());
    await this.flow.run(
      () =>
        Promise.all([
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
                  1,
                  PROJECTS_PAGE_MAX,
                  'name',
                ),
              )
            : Promise.resolve(null),
        ]),
      ([matter, summary, projects]) => {
        this.matter.set(matter);
        this.assetCount.set(summary?.assetCount ?? null);
        this.projects.set(projects?.items ?? []);
        this.projectsTotal.set(projects?.total ?? 0);
      },
    );
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
}
