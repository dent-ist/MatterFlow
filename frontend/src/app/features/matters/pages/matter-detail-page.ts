import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
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
import { StateBlock } from '../../../shared/ui/state-block';
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
import {
  MATTER_ACTIVITIES_PERMISSION,
  MATTER_SECTION_TEXT,
  MatterTabKey,
  isActivitiesParam,
  matterTabFromParam,
  visibleMatterTabs,
} from '../ui/matter-tabs';
import { JumpLink, JumpStrip } from '../../../shared/ui/jump-strip';
import { SECTION_ROWS, SectionCard, SectionStats } from '../../../shared/ui/section-card';
import { MatterTasksSection } from '../ui/matter-tasks-section';
import { MatterNotesSection } from '../ui/matter-notes-section';
import { ProjectPanel } from '../../projects/ui/project-panel';
import { ProjectTasksPanel } from '../../projects/ui/project-tasks-panel';
import { MatterActivitiesDialog } from '../ui/matter-activities-dialog';
import { MatterSummary } from '../ui/matter-summary';
import { MatterEventPanel } from '../ui/matter-event-panel';
import { AddCommentDialog } from '../../../shared/matter-actions/add-comment-dialog';
import { ManagerTarget, MatterManagersDialog } from '../ui/matter-managers-dialog';
import { MatterProjects } from './matter-projects';
import { ProductionsTab } from '../../productions/productions-tab';
import { NotesTab } from '../../notes/notes-tab';
import { NotesHeightPref } from '../../notes/notes-height-pref';
import { IntPipe } from '../../../shared/ui/number-format';
import { BusinessNumberPipe } from '../../../shared/pipes/matter-ref.pipe';

/** The API's largest page (`PageRequest.MaxPageSize`). */
const PROJECTS_PAGE_MAX = 100;

type Tab = MatterTabKey;

/**
 * Matter detail (UX S06; ONE continuous page since #1396, epic #1389): reference with copy button, the inactive banners, activation with the open-task rule, then the Summary
 * (the details and the Team and Vendors side column) and one compact card for each of Tasks, Projects, Assets, Productions and Notes, in that order (D-03a to D-03e).
 * A sticky jump strip (`mf-jump-strip`, a nav of links) replaces the tab strip: it highlights the section in view, a click scrolls there smoothly and moves focus to the heading, the
 * address does not change. A section the viewer may not see is not drawn and has no link. The sections load when they come within 300 px of the window; a jump loads only its target.
 * Every section card ends with "Open Full View": `?tab=tasks|projects|assets|productions|notes` opens that tab's page as it was (the full view, with its tab strip, the
 * Summary tab leading back to the one page); `?tab=summary`, no `tab` and unknown values show the one page, `details` means Summary. Activities is an entry of the More Actions menu that opens a dialog (#1404);
 * `?tab=activities` and the old `?tab=activity` show the one page with that dialog open (closing it removes the parameter).
 */
@Component({
  selector: 'mf-matter-detail-page',
  imports: [
    BusinessNumberPipe,
    StateBlock,
    IntPipe,
    FixedPage,
    MatterHeader,
    ProjectPanel,
    ProjectTasksPanel,
    MatterActivitiesDialog,
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
    ProductionsTab,
    NotesTab,
    AddCommentDialog,
    MatterManagersDialog,
    NgTemplateOutlet,
    JumpStrip,
    SectionCard,
    MatterTasksSection,
    MatterNotesSection,
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
    /* The one page (#1396, D-03a): the page scrolls; the sections are 12 px apart under the sticky jump strip. */
    /* The page scrolls inside the shell's 24 px padding; the title sits where every record page puts it (12 px below the top bar). */
    .mp {
      margin-top: calc(-1 * (var(--mf-s5) - var(--mf-s3)));
    }
    .mp__sections {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
      padding-top: var(--mf-s3);
    }
    .mp__summary {
      scroll-margin-top: calc(var(--mf-header-h, 53px) + var(--mf-tab-h) + var(--mf-s3));
    }
    /* The Overview's sections use the width of the page (the column of 70 characters is for the details list and the custom fields). */
    .pg-details[data-matter-overview] {
      max-width: none;
    }
  `,
  template: `
    <span class="pg-sr" role="status" data-record-live>{{ flow.live() }}</span>
    @switch (state()) {
      @case ('loading') {
        @if (onePage()) {
          <!-- The one page scrolls (D-03a), so its placeholder is not a fixed page: the header and the strip stay where the loaded page puts them. -->
          <div class="mp">
            <mf-record-skeleton
              kind="matter"
              [flow]="true"
              [activeTab]="current()"
              [foldHeader]="false"
              [assetStrip]="canSeeAssets()"
              (retry)="load()"
            />
          </div>
        } @else {
          <mf-fixed-page>
            <mf-record-skeleton
              kind="matter"
              [activeTab]="current()"
              [foldHeader]="headerFolded()"
              [assetStrip]="canSeeAssets()"
              (retry)="load()"
            />
          </mf-fixed-page>
        }
      }
      @case ('ready') {
        @if (matter(); as m) {
          <ng-template #head>
            <mf-matter-header
              [matter]="m"
              [newItems]="newItems()"
              [moreItems]="moreItems()"
              [canEdit]="canEdit()"
              [folded]="headerFolded()"
              (edit)="openEdit()"
            />

            @if (!m.isActive) {
              <div class="pg-banner" role="note" data-inactive-banner>
                <i class="pi pi-info-circle" aria-hidden="true"></i>
                <span
                  >This matter is inactive. New tasks can't be created and completed or cancelled
                  tasks can't be reopened.</span
                >
              </div>
            }
            @if (!m.clientIsActive) {
              <div class="pg-banner" role="note" data-client-inactive-banner>
                <i class="pi pi-info-circle" aria-hidden="true"></i>
                <span>The client {{ m.clientNumber | businessNumber }} is inactive.</span>
              </div>
            }
          </ng-template>

          <ng-template #overlays>
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

            @if (canSeeActivities() && activitiesUsed()) {
              <mf-matter-activities-dialog
                [matterId]="m.matterId"
                [matterRef]="m.matterRef"
                [visible]="activitiesOpen()"
                (visibleChange)="setActivitiesOpen($event)"
              />
            }

            @if (eventUsed()) {
              <mf-matter-event-panel
                [matterId]="m.matterId"
                [matterLabel]="m.matterRef + ' ' + m.name"
                [(visible)]="eventOpen"
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
                This matter has {{ blockedCount() | mfInt }} tasks that aren't Completed or
                Cancelled. Finish or cancel them first.
              </p>
              <p-button
                *mfHasPermission="'Task.View'"
                label="View Open Tasks"
                severity="secondary"
                (onClick)="go('/tasks?matterId=' + m.matterId)"
              />
            </mf-confirm-dialog>
          </ng-template>

          @if (onePage()) {
            <!-- The one continuous Matter page (#1396, D-03b): the page scrolls, the jump strip sticks under the top bar, every section is a card. -->
            <div class="mp" data-matter-one-page>
              <ng-container [ngTemplateOutlet]="head" />
              <mf-jump-strip
                label="Matter sections"
                [links]="jumpLinks()"
                [current]="spyKey()"
                [stuck]="stuck()"
                [meta]="m.matterRef"
                (jump)="jumpTo($event)"
              />
              <div class="mp__sections">
                <section
                  class="mp__summary"
                  id="section-summary"
                  data-section="summary"
                  aria-labelledby="section-summary-h"
                >
                  <h2 class="mf-sr-only" tabindex="-1" id="section-summary-h" data-section-heading>
                    Summary
                  </h2>
                  <mf-matter-summary
                    [matter]="m"
                    [flow]="true"
                    [reload]="reloadTick()"
                    [canAssign]="canAssign()"
                    [canEdit]="canEdit()"
                    [canLinkClient]="canLinkClient()"
                    data-details-tab
                    (changeManagers)="managersOpen.set(true)"
                    (editMatter)="openEdit()"
                    (newAsset)="go('/assets/new?matterId=' + m.matterId)"
                  />
                </section>

                @if (sectionOn('tasks')) {
                  <mf-section-card
                    key="tasks"
                    heading="Tasks"
                    icon="pi-check-square"
                    [count]="m.openTaskCount ?? 0"
                    [hint]="text('tasks').hint"
                    [noun]="text('tasks').noun"
                    [shown]="shown('tasks')"
                    [total]="totalOf('tasks')"
                    [state]="cardState('tasks')"
                    [fullView]="['/matters', m.matterId]"
                    [fullViewParams]="{ tab: 'tasks' }"
                  >
                    @if (auth.has('Task.Create')) {
                      <p-button
                        scAction
                        label="New Task"
                        icon="pi pi-plus"
                        severity="secondary"
                        data-section-action="new-task"
                        [disabled]="!m.isActive"
                        (onClick)="go('/tasks/new?matterId=' + m.matterId)"
                      />
                    }
                    <mf-matter-tasks-section
                      [matterId]="m.matterId"
                      [active]="isActive('tasks')"
                      [reloadTick]="reloadTick()"
                      (stats)="setStats('tasks', $event)"
                    />
                  </mf-section-card>
                }

                @if (sectionOn('projects')) {
                  <mf-section-card
                    key="projects"
                    heading="Projects"
                    icon="pi-folder"
                    [count]="m.projectCount ?? 0"
                    [hint]="text('projects').hint"
                    [noun]="text('projects').noun"
                    [shown]="shown('projects')"
                    [total]="totalOf('projects')"
                    state="ready"
                    [fullView]="['/matters', m.matterId]"
                    [fullViewParams]="{ tab: 'projects' }"
                  >
                    @if (auth.has('Project.Create') && !isEmpty('projects')) {
                      <p-button
                        scAction
                        label="New Project"
                        icon="pi pi-plus"
                        severity="secondary"
                        data-section-action="new-project"
                        (onClick)="openProjectPanel()"
                      />
                    }
                    <mf-matter-projects
                      [compact]="true"
                      [matterId]="m.matterId"
                      [matterRef]="m.matterRef"
                      [projects]="projects()"
                      [total]="projectsTotal()"
                      (newProject)="openProjectPanel()"
                      (openProject)="openProjectTasks($event)"
                    />
                  </mf-section-card>
                }

                @if (sectionOn('assets')) {
                  <mf-section-card
                    key="assets"
                    heading="Assets"
                    icon="pi-database"
                    [count]="assetCount()"
                    [hint]="text('assets').hint"
                    [noun]="text('assets').noun"
                    [shown]="shown('assets')"
                    [total]="totalOf('assets')"
                    [state]="cardState('assets')"
                    [fullView]="['/matters', m.matterId]"
                    [fullViewParams]="{ tab: 'assets' }"
                  >
                    @if (auth.has('Asset.Create') && !isEmpty('assets')) {
                      <p-button
                        scAction
                        label="New Asset"
                        icon="pi pi-plus"
                        severity="secondary"
                        data-section-action="new-asset"
                        (onClick)="go('/assets/new?matterId=' + m.matterId)"
                      />
                    }
                    <mf-matter-assets
                      [compact]="true"
                      [hold]="!isActive('assets')"
                      [rowLimit]="rowLimit"
                      [matterId]="m.matterId"
                      (stats)="setStats('assets', $event)"
                    />
                  </mf-section-card>
                }

                @if (sectionOn('productions')) {
                  <mf-section-card
                    key="productions"
                    heading="Productions"
                    icon="pi-send"
                    [count]="productionCount()"
                    [hint]="text('productions').hint"
                    [noun]="text('productions').noun"
                    [shown]="shown('productions')"
                    [total]="totalOf('productions')"
                    [state]="cardState('productions')"
                    [fullView]="['/matters', m.matterId]"
                    [fullViewParams]="{ tab: 'productions' }"
                  >
                    @if (auth.has('Production.Edit') && !isEmpty('productions')) {
                      <p-button
                        scAction
                        label="New Production"
                        icon="pi pi-plus"
                        severity="secondary"
                        data-section-action="new-production"
                        (onClick)="productions()?.newProduction()"
                      />
                    }
                    <mf-productions-tab
                      [compact]="true"
                      [hold]="!isActive('productions')"
                      [matterId]="m.matterId"
                      (changed)="refreshTabCounts()"
                      (stats)="setStats('productions', $event)"
                    />
                  </mf-section-card>
                }

                @if (sectionOn('notes')) {
                  <mf-section-card
                    key="notes"
                    heading="Notes"
                    icon="pi-file-edit"
                    [count]="noteCount()"
                    [hint]="text('notes').hint"
                    [noun]="text('notes').noun"
                    [shown]="shown('notes')"
                    [total]="totalOf('notes')"
                    [state]="cardState('notes')"
                    [fullView]="['/matters', m.matterId]"
                    [fullViewParams]="{ tab: 'notes' }"
                  >
                    @if (auth.has('MatterNote.Edit')) {
                      <p-button
                        scAction
                        label="Add Note"
                        icon="pi pi-plus"
                        severity="secondary"
                        data-section-action="add-note"
                        (onClick)="addNote()"
                      />
                    }
                    <mf-matter-notes-section
                      [matterId]="m.matterId"
                      [active]="isActive('notes')"
                      [reloadTick]="reloadTick()"
                      (stats)="setStats('notes', $event)"
                    />
                  </mf-section-card>
                }
              </div>
              <ng-container [ngTemplateOutlet]="overlays" />
            </div>
          } @else {
            <!-- A section's full view: today's tab page (?tab=tasks and the others), its tab strip with the Summary leading back to the one page. -->
            <mf-fixed-page>
              <ng-container [ngTemplateOutlet]="head" />

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
                      <div data-no-access="assets">
                        <mf-state-block icon="pi-lock"
                          >You don't have access to assets.</mf-state-block
                        >
                      </div>
                    }
                  }
                }
              </div>
              <ng-container [ngTemplateOutlet]="overlays" />
            </mf-fixed-page>
          }
        }
      }
      @default {
        <mf-fixed-page>
          <mf-record-state
            kind="matter"
            [recordId]="matterId()"
            [state]="state()"
            [busy]="flow.retrying()"
            (retried)="load()"
          />
        </mf-fixed-page>
      }
    }
  `,
})
export class MatterDetailPage {
  readonly matterId = input.required<string>();
  /** `?tab=`: absent, `summary`, `details` and an unknown or forbidden value show the one page; `tasks`, `projects`, `assets`, `productions`, `notes` open that section's full view; `activities` and the old `activity` show the one page with the Activities dialog open. */
  readonly tab = input<string>();
  /** The Assets full view's list state (its filters `name`, `typeId`, `extref` are read from the address by the tab itself). */
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
  protected readonly auth = inject(AuthStore);
  private readonly injector = inject(Injector);

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
  /** The numbers beside the tabs and the jump links; a count is shown only when the viewer may see what it counts (no fake zero without Task.View). */
  private readonly tabCounts = computed<Partial<Record<string, number | string | null>>>(() => {
    const m = this.matter();
    return {
      tasks: this.auth.has('Task.View') ? (m?.openTaskCount ?? 0) : null,
      projects: m?.projectCount ?? 0,
      assets: this.assetCount(),
      productions: this.productionCount(),
      notes: this.noteCount(),
    };
  });
  /**
   * The tab strip of a section's full view. Projects and Assets are offered only with their View permission (a person who may not see them has no tab to open),
   * and a count is shown only when the viewer may see what it counts.
   */
  protected readonly tabs = computed<MfTab[]>(() => {
    const counts = this.tabCounts();
    return visibleMatterTabs((code) => this.auth.has(code)).map((t) => {
      const tab: MfTab = { key: t.key, label: t.label, icon: t.icon };
      if (t.counted) tab.count = counts[t.key];
      return tab;
    });
  });
  /** The Matter page is one continuous page (#1396): `/matters/:id` and `?tab=summary`; every other `?tab=` value is that section's full view. */
  protected readonly onePage = computed(() => this.current() === 'summary');
  /** The sections of the one page this viewer may see, in tab order (Summary first). A section without its permission is not drawn and has no jump link; Tasks needs Task.View. */
  private readonly pageSections = computed(() =>
    visibleMatterTabs((code) => this.auth.has(code)).filter(
      (t) => t.key !== 'tasks' || this.auth.has('Task.View'),
    ),
  );
  protected readonly jumpLinks = computed<JumpLink[]>(() => {
    const counts = this.tabCounts();
    return this.pageSections().map((t) => ({
      key: t.key,
      label: t.label,
      icon: t.icon,
      ...(t.counted ? { count: counts[t.key] } : {}),
    }));
  });
  protected sectionOn(key: string): boolean {
    return this.pageSections().some((t) => t.key === key);
  }
  protected text(key: string): { hint: string; noun: string } {
    return MATTER_SECTION_TEXT[key];
  }
  protected readonly rowLimit = SECTION_ROWS;
  /** The Productions section (its New Production button opens the tab's own dialog). */
  protected readonly productions = viewChild(ProductionsTab);
  /** The sections that have been asked to load: one is added when it is about 300 px from the window or when its jump link is chosen. */
  protected readonly activated = signal<ReadonlySet<string>>(new Set());
  private readonly sectionStats = signal<Readonly<Record<string, SectionStats>>>({});
  /** The section in view (the highlighted jump link) and whether the strip is stuck under the top bar. */
  protected readonly spyKey = signal('summary');
  protected readonly stuck = signal(false);
  private io: IntersectionObserver | null = null;
  /** True while a jump scrolls: the sections it passes are not loaded. */
  private jumping = false;
  private frame = 0;
  private readonly onScroll = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.updateSpy();
    });
  };
  private readonly heightPref = inject(NotesHeightPref);
  /** The Notes tab is showing and the person folded the header (#1342); any other tab shows it in full. */
  protected readonly headerFolded = computed(
    () => this.current() === 'notes' && this.heightPref.folded(),
  );
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
  /** The Activities entry of More Actions and its dialog (#1404): Audit.View, as the Activities tab and section needed. */
  protected readonly canSeeActivities = computed(() => this.auth.has(MATTER_ACTIVITIES_PERMISSION));
  protected readonly activitiesOpen = signal(false);
  /** The dialog exists from the first use on (a closed dialog is no markup on the page). */
  protected readonly activitiesUsed = signal(false);
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
    // Activities (#1404): after the entries that act on the tasks, before the set-apart Set Inactive; Audit.View, the permission the Activities section needed.
    if (this.canSeeActivities()) {
      list.push({
        id: 'activities',
        label: 'Activities',
        icon: 'pi-history',
        run: () => this.openActivities(),
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
    // The one page watches its sections (lazy loading, the highlighted jump link) while it is on screen.
    const watched = computed(() =>
      this.onePage() && this.state() === 'ready' ? (this.matter()?.matterId ?? null) : null,
    );
    effect((onCleanup) => {
      if (watched() === null) return;
      this.pageSections();
      untracked(() => {
        const ref = afterNextRender(() => this.startWatching(), { injector: this.injector });
        onCleanup(() => {
          ref.destroy();
          this.stopWatching();
        });
      });
    });
    inject(DestroyRef).onDestroy(() => this.stopWatching());
    // A `?tab=activities` or `?tab=activity` link (an old tab address, a bookmark) shows the page with the Activities dialog open; without Audit.View it is just the page.
    effect(() => {
      if (this.state() !== 'ready' || !isActivitiesParam(this.tab()) || !this.canSeeActivities())
        return;
      untracked(() => this.openActivities());
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

  protected isActive(key: string): boolean {
    return this.activated().has(key);
  }

  protected openActivities(): void {
    this.activitiesUsed.set(true);
    this.activitiesOpen.set(true);
  }

  /**
   * The dialog opened or closed. Closing a dialog that a `?tab=activities` (or the old `?tab=activity`) link opened removes the parameter and keeps the page: the address is replaced, so Back
   * leaves the matter and does not come back to the link (#1404).
   */
  protected setActivitiesOpen(open: boolean): void {
    this.activitiesOpen.set(open);
    if (open || !isActivitiesParam(this.tab())) return;
    void this.router.navigate([], {
      queryParams: { tab: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected setStats(key: string, stats: SectionStats): void {
    this.sectionStats.update((all) => ({ ...all, [key]: stats }));
  }

  protected shown(key: string): number {
    return key === 'projects'
      ? Math.min(this.projects().length, SECTION_ROWS)
      : (this.sectionStats()[key]?.shown ?? 0);
  }

  protected totalOf(key: string): number | null {
    if (key === 'projects') return this.projectsTotal();
    const stats = this.sectionStats()[key];
    return stats ? stats.total : 0;
  }

  protected moreOf(key: string): boolean {
    return this.sectionStats()[key]?.more ?? false;
  }

  /** The section has loaded and has no rows: its empty state offers the section's action, so the header does not repeat it. */
  protected isEmpty(key: string): boolean {
    return this.cardState(key) === 'ready' && this.totalOf(key) === 0;
  }

  /** What a section card shows in its footer: not asked yet (idle), loading, ready or failed. Projects arrive with the matter. */
  protected cardState(key: string): 'idle' | 'loading' | 'ready' | 'error' {
    if (key === 'projects') return 'ready';
    if (!this.isActive(key)) return 'idle';
    return this.sectionStats()[key]?.state ?? 'loading';
  }

  private activate(key: string): void {
    if (!this.activated().has(key)) this.activated.update((all) => new Set(all).add(key));
  }

  /** The sections that load their rows when they come near the window (Projects arrive with the matter). */
  private lazyKeys(): string[] {
    return ['tasks', 'assets', 'productions', 'notes'].filter((k) => this.sectionOn(k));
  }

  private startWatching(): void {
    this.stopWatching();
    this.activated.set(new Set());
    this.sectionStats.set({});
    this.spyKey.set('summary');
    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('resize', this.onScroll);
    this.observe();
    if (typeof ResizeObserver !== 'undefined') {
      this.heights.clear();
      this.sizeWatch = new ResizeObserver(this.resized);
      document
        .querySelectorAll('[data-matter-one-page] [data-section]')
        .forEach((el) => this.sizeWatch?.observe(el));
    }
    this.updateSpy();
  }

  private stopWatching(): void {
    this.sizeWatch?.disconnect();
    this.sizeWatch = null;
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('resize', this.onScroll);
    this.io?.disconnect();
    this.io = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.jumping = false;
  }

  /** A section loads when it is within about 300 px below the window (the rows it will have are already drawn as a placeholder, so nothing moves when they arrive). */
  private observe(): void {
    this.io?.disconnect();
    this.io = null;
    const pending = this.lazyKeys().filter((k) => !this.isActive(k));
    if (pending.length === 0 || typeof IntersectionObserver === 'undefined') {
      pending.forEach((k) => this.activate(k));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (this.jumping) return;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const key = (e.target as HTMLElement).getAttribute('data-section');
          if (key) this.activate(key);
          io.unobserve(e.target);
        }
      },
      // The window starts under the top bar and the sticky strip (what hides behind them is not in view) and reaches 300 px below the bottom edge.
      { rootMargin: `-${this.coveredTop()}px 0px 300px 0px` },
    );
    this.io = io;
    for (const key of pending) {
      const el = document.querySelector(`[data-section="${key}"]`);
      if (el) io.observe(el);
    }
  }

  /** The height the top bar and the jump strip cover at the top of the window. */
  private coveredTop(): number {
    const strip = document.querySelector<HTMLElement>('[data-jump-strip]');
    if (!strip) return 0;
    return Math.round((parseFloat(getComputedStyle(strip).top) || 0) + strip.offsetHeight + 2);
  }

  /**
   * A section above the one in view changed height (its rows arrived, or it turned out empty): the page moves by the same amount, so what the person looks at stays
   * where it is and a jump target does not drift. Sections below the one in view need nothing.
   */
  private readonly resized = (entries: ResizeObserverEntry[]): void => {
    for (const entry of entries) {
      const height = entry.contentRect.height;
      const before = this.heights.get(entry.target);
      this.heights.set(entry.target, height);
      if (before === undefined || before === height || this.jumping) continue;
      const key = (entry.target as HTMLElement).getAttribute('data-section');
      const keys: string[] = this.pageSections().map((t) => t.key);
      if (key && keys.indexOf(key) < keys.indexOf(this.spyKey())) {
        window.scrollBy(0, height - before);
      }
    }
  };
  private readonly heights = new Map<Element, number>();
  private sizeWatch: ResizeObserver | null = null;

  /** Which section is in view, and whether the strip sticks. The last section is current at the bottom of the page. */
  private updateSpy(): void {
    const strip = document.querySelector<HTMLElement>('[data-jump-strip]');
    if (!strip) return;
    const box = strip.getBoundingClientRect();
    const top = parseFloat(getComputedStyle(strip).top) || 0;
    this.stuck.set(window.scrollY > 0 && box.top <= top + 1);
    if (this.jumping) return;
    const keys = this.pageSections().map((t) => t.key);
    let current = keys[0] ?? 'summary';
    // At the very top the first section is the one in view, whatever the sections below measure.
    for (const key of window.scrollY > 0 ? keys : []) {
      const el = document.getElementById('section-' + key);
      if (el && el.getBoundingClientRect().top <= box.bottom + 24) current = key;
    }
    if (
      window.scrollY > 0 &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    ) {
      current = keys[keys.length - 1] ?? current;
    }
    this.spyKey.set(current);
  }

  /**
   * A jump link was chosen: scroll to the section (smooth, instant with reduced motion), load ONLY that section (the ones the scroll passes are not loaded; the ones that are
   * near the window when it stops load as usual), then focus the section heading. The address does not change.
   */
  protected jumpTo(key: string): void {
    const el = document.getElementById('section-' + key);
    if (!el) return;
    this.jumping = true;
    this.spyKey.set(key);
    if (key !== 'summary') this.activate(key);
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    let last = -1;
    let still = 0;
    const started = performance.now();
    const tick = (): void => {
      still = Math.abs(window.scrollY - last) < 1 ? still + 1 : 0;
      last = window.scrollY;
      if (still < 6 && performance.now() - started < 2500) {
        requestAnimationFrame(tick);
        return;
      }
      this.jumping = false;
      document.getElementById(`section-${key}-h`)?.focus({ preventScroll: true });
      this.updateSpy();
      this.observe();
    };
    requestAnimationFrame(tick);
  }

  /** "Add Note" of the Notes section: the Notes full view with a new note ready. */
  protected addNote(): void {
    void this.router.navigate(['/matters', this.matterId()], {
      queryParams: { tab: 'notes', compose: 1 },
    });
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

  /** Edit Matter is a full page (epic #1368, #1381); its Cancel and Save come back here. */
  protected openEdit(): void {
    void this.router.navigate(['/matters', this.matter()!.matterId, 'edit']);
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
      // The Assets tab number; a failure only leaves the tab without one.
      firstValueFrom(this.api.getMatterSummary(id)).catch(() => null),
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
    this.assetCount.set(this.auth.has('Asset.View') ? (summary?.assetCount ?? null) : null);
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
