import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  WorkflowDetail,
  TaskTypesClient,
  WorkflowVersionSummary,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { HttpWorkflowLookup, WorkflowLookup } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import { TextField } from '../../../shared/ui/text-field';
import { workflowErrors } from './workflow-errors';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { ActiveBadge, Badge } from '../../../shared/ui/badge';
import { DIALOG_COPY, impactLine, retireCopy } from '../shared/dialog-copy';
import { PageTitle, recordTitle, shortTitleText } from '../../../core/title/page-title';
import { PageHeader } from '../../../shared/ui/page-header';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';
import { Tabs } from '../../../shared/ui/tabs';
import { WorkStrip } from '../../../shared/work-queue/work-strip';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { ADMIN_LIST, ListReturn } from '../list-return';
import {
  WORKFLOW_TAB_LABEL,
  WorkflowTab,
  activeTaskTypes,
  openTasksOnWorkflow,
  workflowStateBadges,
  workflowStripItems,
  workflowTabOf,
  workflowTabs,
} from './workflow-record';
import { dependentTaskTypes } from './workflow-impact';
import { WorkflowVersionsTab } from './workflow-versions-tab';
import { WorkflowTaskTypesTab } from './workflow-task-types-tab';

/** How many task type names the Deactivate dialog lists before "and n more". */
const NAMES_SHOWN = 8;

/**
 * Admin: create or edit a workflow (UX S16). Creating is the small form (name, description, Ordered or Unordered). An existing workflow is a
 * record page (WP-TY5, #387 to #392): `mf-record-header` with the state badges, Edit, Activity, the one primary action (Open draft vN, else
 * Create new draft) and an overflow with Deactivate; a summary strip; and the tabs Overview (name, description, status and mode) | Versions (n)
 * | Task types (n). Each tab saves on its own; leaving a tab with edits asks first. The steps are edited in a draft version. Needs
 * `Workflow.Manage` (route guard).
 */
@Component({
  selector: 'mf-workflow-edit-page',
  imports: [
    PageHeader,
    RecordHeader,
    Tabs,
    WorkStrip,
    ActivityDrawer,
    Badge,
    ActiveBadge,
    ConfirmDialog,
    RecordState,
    Button,
    TextField,
    WorkflowVersionsTab,
    WorkflowTaskTypesTab,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: WorkflowLookup, useClass: HttpWorkflowLookup }],
  styleUrls: ['../../../shared/ui/page.scss', './workflows.scss'],
  template: `
    @if (flow.failed()) {
      <mf-record-state
        kind="workflow"
        [state]="state()"
        [busy]="flow.retrying()"
        [focusHeading]="true"
        (retried)="load()"
      />
    } @else if (!isEdit()) {
      <mf-page-header
        [crumbs]="[
          { label: 'Administration' },
          { label: 'Task Types', link: '/admin/task-types' },
          listCrumb,
          { label: 'New' },
        ]"
        heading="New workflow"
      />
      <div class="wf-stack">
        @if (messages().length > 0) {
          <div class="pg-summary" role="alert" data-summary>
            Fix the following to save:
            <ul>
              @for (message of messages(); track message) {
                <li>{{ message }}</li>
              }
            </ul>
          </div>
        }
        <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
          <mf-text-field
            inputId="wf-name"
            label="Name"
            [required]="true"
            [maxLength]="200"
            [error]="nameError()"
            [(value)]="name"
          />
          <mf-text-field
            inputId="wf-description"
            label="Description"
            [multiline]="true"
            [maxLength]="1000"
            [error]="fieldError('description')"
            [(value)]="description"
          />
          <fieldset>
            <legend>Execution mode</legend>
            <label class="pg-radio">
              <input
                type="radio"
                name="wf-mode"
                data-mode="ordered"
                [checked]="isOrdered()"
                (change)="isOrdered.set(true)"
              />
              Ordered - steps must be resolved in sequence
            </label>
            <label class="pg-radio">
              <input
                type="radio"
                name="wf-mode"
                data-mode="unordered"
                [checked]="!isOrdered()"
                (change)="isOrdered.set(false)"
              />
              Unordered - steps can be done in any order
            </label>
            <p class="pg-reason">You can change this later while the version is a draft.</p>
          </fieldset>
          <div class="pg-actions mf-form-actions--sticky">
            <p-button
              type="submit"
              [label]="busy() ? 'Saving...' : 'Create workflow'"
              [disabled]="busy()"
            />
            <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
          </div>
        </form>
      </div>
    } @else {
      <mf-record-header
        kind="workflow"
        [parents]="parents()"
        [current]="detail()?.workflow?.name ?? ''"
        [name]="detail()?.workflow?.name ?? ''"
        [active]="detail()?.workflow?.isActive ?? true"
        [backTo]="backTo()"
        [skeleton]="state() === 'loading'"
        [actions]="headerActions()"
      >
        @if (badges().length > 0) {
          <ng-container mfBadges>
            @for (b of badges(); track b.label) {
              <mf-badge [tone]="b.tone" [icon]="b.icon ?? null" data-state-badge>{{
                b.label
              }}</mf-badge>
            }
          </ng-container>
        }
        @if (detail()?.workflow?.description; as d) {
          <span mfContext [attr.title]="d" data-context>{{ d }}</span>
        }
      </mf-record-header>

      <span class="pg-sr" role="status" data-record-live>{{ announcement() || flow.live() }}</span>
      @if (state() === 'loading') {
        <mf-tabs label="Workflow sections" idPrefix="wf" [tabs]="tabs()" [selected]="current()" />
        <div
          role="tabpanel"
          id="wf-panel"
          [attr.aria-labelledby]="'wf-tab-' + current()"
          class="wf-panel-wrap"
        >
          <div class="pg-state" role="status" aria-busy="true">Loading the workflow...</div>
        </div>
      } @else {
        <div class="wf-stack">
          @if (strip().length > 0) {
            <mf-work-strip label="Workflow summary" [items]="strip()" />
          }
          @if (conflict()) {
            <div class="pg-alert" role="alert" data-conflict>
              This workflow was changed by someone else.
              <p-button label="Reload latest" severity="secondary" (onClick)="load()" />
            </div>
          }
          @if (messages().length > 0) {
            <div class="pg-summary" role="alert" data-summary>
              Fix the following to save:
              <ul>
                @for (message of messages(); track message) {
                  <li>{{ message }}</li>
                }
              </ul>
            </div>
          }

          <mf-tabs
            label="Workflow sections"
            idPrefix="wf"
            [tabs]="tabs()"
            [selected]="current()"
            (tabChange)="select($event)"
          />
          <div
            class="wf-panel-wrap"
            role="tabpanel"
            id="wf-panel"
            [attr.aria-labelledby]="'wf-tab-' + current()"
          >
            @switch (current()) {
              @case ('overview') {
                <form
                  class="pg-form wf-overview"
                  novalidate
                  data-overview-tab
                  (submit)="$event.preventDefault(); save()"
                >
                  <mf-text-field
                    inputId="wf-name"
                    label="Name"
                    [required]="true"
                    [maxLength]="200"
                    [error]="nameError()"
                    [(value)]="name"
                  />
                  <mf-text-field
                    inputId="wf-description"
                    label="Description"
                    [multiline]="true"
                    [maxLength]="1000"
                    [error]="fieldError('description')"
                    [(value)]="description"
                  />
                  <dl class="wf-facts" data-facts>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        <mf-active-badge [active]="detail()!.workflow.isActive" />
                        <span class="pg-reason">
                          {{
                            detail()!.workflow.isActive
                              ? 'Offered when people create tasks. Deactivate it from the menu in the header.'
                              : 'Not offered when people create tasks. Activate it from the menu in the header.'
                          }}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Execution mode</dt>
                      <dd data-mode-read>
                        {{ modeText() }}
                        <span class="pg-reason"
                          >Set per version; change it while a version is a draft.</span
                        >
                      </dd>
                    </div>
                  </dl>
                  <div class="pg-actions mf-form-actions--sticky">
                    <p-button
                      type="submit"
                      [label]="busy() ? 'Saving...' : 'Save changes'"
                      [disabled]="busy()"
                    />
                    <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
                  </div>
                </form>
              }
              @case ('versions') {
                <mf-workflow-versions-tab
                  [detail]="detail()!"
                  [busy]="busy()"
                  [carry]="back.carry"
                  (newDraft)="newDraft($event)"
                  (retire)="askRetire($event)"
                />
              }
              @case ('task-types') {
                <mf-workflow-task-types-tab
                  [taskTypes]="detail()!.workflow.taskTypes"
                  [canOpen]="auth.has('TaskType.Manage')"
                />
              }
            }
          </div>
        </div>

        @if (canSeeActivity() && detail(); as d) {
          <mf-activity-drawer
            objectType="WorkflowDefinition"
            [objectId]="d.workflow.workflowDefinitionId"
            [name]="d.workflow.name"
            [visible]="activityOpen()"
            (visibleChange)="activityOpen.set($event)"
          />
        }
      }
    }

    <mf-confirm-dialog
      [title]="copy.title"
      [confirmLabel]="copy.confirm"
      [cancelLabel]="copy.cancel"
      [danger]="copy.danger"
      [busy]="busy()"
      [(visible)]="deactivateOpen"
      (confirmed)="toggleActive(false)"
    >
      @if (impact().text) {
        <p data-impact>{{ impact().text }}</p>
      }
      @if (impactNames().length > 0) {
        <ul class="wf-names" data-impact-names>
          @for (n of impactNames(); track n) {
            <li>{{ n }}</li>
          }
          @if (impactMore() > 0) {
            <li>and {{ impactMore() }} more</li>
          }
        </ul>
      }
      <p>
        This workflow will no longer be offered when people create tasks. Tasks already running on
        it are not changed, and you can activate it again later.
      </p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      [title]="retireDialog().title"
      [confirmLabel]="retireDialog().confirm"
      [cancelLabel]="retireDialog().cancel"
      [danger]="retireDialog().danger"
      [busy]="busy()"
      [(visible)]="retireOpen"
      (confirmed)="retire()"
    >
      @if (retireImpact().text) {
        <p data-retire-impact>{{ retireImpact().text }}</p>
      }
      <p>Tasks already running on it are not changed.</p>
    </mf-confirm-dialog>
  `,
})
export class WorkflowEditPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly workflowId = input<string>();
  /** `?tab=`: `versions` or `task-types`; Overview (the default) is not written to the address. */
  readonly tab = input<string>();

  private readonly api = inject(WorkflowsClient);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthStore);
  private readonly leave = inject(LeaveConfirmService);
  /** The exact list view this page was opened from (#354): the crumb, Cancel and the links on to the record's other pages return to it. */
  protected readonly back = new ListReturn(ADMIN_LIST.workflows, this.router);
  protected readonly listCrumb = this.back.crumb('Workflows');
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);

  protected readonly isEdit = computed(() => this.workflowId() !== undefined);
  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('workflow');
  protected readonly state = this.flow.state;
  protected readonly detail = signal<WorkflowDetail | null>(null);

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly isOrdered = signal(true);
  protected readonly busy = signal(false);
  protected readonly copy = DIALOG_COPY.deactivateWorkflow;
  protected readonly deactivateOpen = signal(false);
  protected readonly retireOpen = signal(false);
  private readonly retireTarget = signal<WorkflowVersionSummary | null>(null);
  /** The task types for which the workflow is the only published one, read when the Retire dialog opens (`Task.View`); null when unknown. */
  private readonly dependents = signal<string[] | null>(null);
  protected readonly activityOpen = signal(false);
  protected readonly announcement = signal('');
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly messages = signal<string[]>([]);
  protected readonly conflict = signal(false);
  private saved = false;

  protected readonly current = computed<WorkflowTab>(() =>
    this.isEdit() ? workflowTabOf(this.tab()) : 'overview',
  );
  protected readonly tabs = computed(() => workflowTabs(this.detail()));
  protected readonly badges = computed(() => {
    const w = this.detail()?.workflow;
    return w ? workflowStateBadges(w) : [];
  });
  protected readonly strip = computed(() => {
    const d = this.detail();
    return d ? workflowStripItems(d, this.auth.has('Task.View')) : [];
  });
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  protected readonly parents = computed(() => [
    { label: 'Administration', plain: true },
    { label: 'Task Types', link: '/admin/task-types' },
    this.listCrumb,
  ]);
  protected readonly backTo = computed(() => ({
    label: 'Workflows',
    link: this.back.tree,
    state: this.listCrumb.state,
  }));

  /** The mode of the version being worked on: the draft, else the published one, else the newest. */
  protected readonly modeText = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const w = d.workflow;
    const v =
      d.versions.find((x) => x.workflowVersionId === w.draftVersionId) ??
      d.versions.find((x) => x.workflowVersionId === w.publishedVersionId) ??
      [...d.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
    if (!v) return '';
    return `${v.isOrdered ? 'Ordered' : 'Unordered'} (v${v.versionNo})`;
  });

  protected readonly impactSource = computed(() => {
    const d = this.detail();
    if (!d) return { names: [] as string[], open: null as number | null };
    return {
      names: activeTaskTypes(d).map((t) => t.name),
      open: openTasksOnWorkflow(d),
    };
  });
  protected readonly impact = computed(() => {
    const s = this.impactSource();
    return impactLine('deactivateWorkflow', { names: s.names, openTasks: s.open });
  });
  protected readonly impactNames = computed(() => this.impact().names.slice(0, NAMES_SHOWN));
  protected readonly impactMore = computed(() =>
    Math.max(0, this.impact().names.length - NAMES_SHOWN),
  );

  protected readonly retireDialog = computed(() =>
    retireCopy(this.retireTarget()?.versionNo ?? ''),
  );
  protected readonly retireImpact = computed(() => {
    const v = this.retireTarget();
    return impactLine('retireVersion', {
      openTasks: v?.openTaskCount,
      versionNo: v?.versionNo,
      names: this.dependents(),
    });
  });

  protected readonly headerActions = computed<RecordAction[]>(() => {
    const d = this.detail();
    if (!d || !this.isEdit()) return [];
    const w = d.workflow;
    const list: RecordAction[] = [
      { id: 'edit', role: 'edit', label: 'Edit', run: () => void this.editHere() },
    ];
    if (this.canSeeActivity()) {
      list.push({
        id: 'activity',
        role: 'activity',
        label: 'Activity',
        icon: 'pi-history',
        run: () => this.activityOpen.set(true),
      });
    }
    if (w.draftVersionId) {
      list.push({
        id: 'open-draft',
        role: 'primary',
        label: `Open draft v${w.draftVersionNo}`,
        icon: 'pi-pencil',
        run: () => void this.openDraft(),
      });
    } else {
      const from = this.baseVersion(d);
      if (from) {
        list.push({
          id: 'new-draft',
          role: 'primary',
          label: 'Create new draft',
          icon: 'pi-plus',
          disabled: this.busy(),
          run: () => void this.newDraft(from),
        });
      }
    }
    list.push({
      id: w.isActive ? 'deactivate' : 'activate',
      role: 'state',
      label: w.isActive ? 'Deactivate' : 'Activate',
      disabled: this.busy(),
      run: () => (w.isActive ? this.deactivateOpen.set(true) : void this.toggleActive(true)),
    });
    return list;
  });

  protected readonly nameError = computed(() => {
    if (this.submitted() && this.name().trim() === '') return 'Enter a name.';
    return this.fieldError('name');
  });

  readonly saveForLeaveLabel = 'Save and leave';

  constructor() {
    effect(() => {
      if (this.workflowId() !== undefined) untracked(() => void this.load());
      else untracked(() => this.flow.state.set('ready'));
    });
    effect(() => {
      const state = this.state();
      const name = this.detail()?.workflow?.name;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('workflow', state));
      } else if (name && this.isEdit()) {
        // `Billing request: Versions`; kept through tab changes, like the other record pages.
        this.pageTitle.pin(recordTitle(name, WORKFLOW_TAB_LABEL[this.current()]));
      } else if (name) this.pageTitle.set(shortTitleText(name));
    });
    inject(DestroyRef).onDestroy(() => this.pageTitle.unpin());
    effect(() => {
      if (this.tab() === 'activity' && this.canSeeActivity()) {
        untracked(() => this.activityOpen.set(true));
      }
    });
  }

  /** Leaving with edits asks first; in create mode saving would create the workflow, so only an existing one offers it. */
  get saveForLeave(): (() => Promise<boolean>) | undefined {
    return this.isEdit() ? () => this.save() : undefined;
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const w = this.detail()?.workflow;
    if (this.isEdit()) {
      return !!w && (this.name() !== w.name || this.description() !== (w.description ?? ''));
    }
    return this.name().trim() !== '' || this.description().trim() !== '';
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  async load(): Promise<void> {
    this.resetErrors();
    await this.flow.run(
      () => firstValueFrom(this.api.getWorkflow(Number(this.workflowId()))),
      (detail) => this.apply(detail),
    );
  }

  /** Reads the workflow again without the loading state (after an action on a version), keeping the person's edits. */
  private async refresh(): Promise<void> {
    try {
      this.apply(await firstValueFrom(this.api.getWorkflow(Number(this.workflowId()))), true);
    } catch {
      await this.load();
    }
  }

  /** The version a new draft starts from: the published one, else the newest. */
  private baseVersion(d: WorkflowDetail): WorkflowVersionSummary | undefined {
    return (
      d.versions.find((v) => v.workflowVersionId === d.workflow.publishedVersionId) ??
      [...d.versions].sort((a, b) => b.versionNo - a.versionNo)[0]
    );
  }

  /**
   * Opens a tab. A tab with edits asks first (Stay, Leave, or Save and leave) because each tab saves on its own; leaving drops its edits.
   * Resolves true when the tab was opened. The address is replaced, not added, so Back leaves the page.
   */
  protected async select(key: string): Promise<boolean> {
    const to = workflowTabOf(key);
    if (to === this.current()) return true;
    if (this.hasUnsavedChanges()) {
      const leave = await this.leave.ask({ label: this.saveForLeaveLabel, run: () => this.save() });
      if (!leave) return false;
      this.revert();
    }
    await this.router.navigate([], {
      queryParams: { tab: to === 'overview' ? null : to },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    return true;
  }

  /** Edit in the header: the fields are always editable, so it takes the person to the name. */
  protected async editHere(): Promise<void> {
    if (this.current() !== 'overview' && !(await this.select('overview'))) return;
    afterNextRender(() => document.getElementById('wf-name')?.focus(), {
      injector: this.injector,
    });
  }

  protected async openDraft(): Promise<void> {
    const w = this.detail()?.workflow;
    if (!w?.draftVersionId) return;
    await this.router.navigate(
      ['/admin/workflows', w.workflowDefinitionId, 'versions', w.draftVersionId],
      this.back.extras,
    );
  }

  private revert(): void {
    const w = this.detail()?.workflow;
    if (!w) return;
    this.name.set(w.name);
    this.description.set(w.description ?? '');
    this.resetErrors();
  }

  /** Deactivate (after the dialog) or Activate: only the status changes; edits in the form stay as they are, unsaved. */
  protected async toggleActive(active: boolean): Promise<void> {
    const w = this.detail()?.workflow;
    if (!w) return;
    this.deactivateOpen.set(false);
    this.resetErrors();
    const result = await this.run(() =>
      firstValueFrom(
        this.api.updateWorkflow(w.workflowDefinitionId, {
          name: w.name,
          description: w.description || undefined,
          isActive: active,
          rowVersion: w.rowVersion,
        }),
      ),
    );
    if (!result) return;
    this.apply(result, true);
    this.notify.success(`Workflow ${result.workflow.name} ${active ? 'activated' : 'deactivated'}`);
    this.announcement.set(`Workflow ${active ? 'activated' : 'deactivated'}`);
  }

  protected async save(): Promise<boolean> {
    this.submitted.set(true);
    this.resetErrors();
    if (this.name().trim() === '') {
      this.messages.set(['Enter a name.']);
      focusFirstInvalid(this.injector);
      return false;
    }
    const body = {
      name: this.name().trim(),
      description: this.description().trim() || undefined,
    };
    const result = await this.run(() =>
      this.isEdit()
        ? firstValueFrom(
            this.api.updateWorkflow(Number(this.workflowId()), {
              ...body,
              isActive: this.detail()!.workflow.isActive,
              rowVersion: this.detail()!.workflow.rowVersion,
            }),
          )
        : firstValueFrom(this.api.createWorkflow({ ...body, isOrdered: this.isOrdered() })),
    );
    if (!result) return false;
    this.notify.success(`Workflow ${result.workflow.name} saved`);
    if (this.isEdit()) {
      this.apply(result);
      this.announcement.set('Saved');
    } else {
      this.saved = true;
      const draft = result.workflow.draftVersionId;
      await this.router.navigate(
        draft
          ? ['/admin/workflows', result.workflow.workflowDefinitionId, 'versions', draft]
          : ['/admin/workflows', result.workflow.workflowDefinitionId],
      );
    }
    return true;
  }

  protected async newDraft(from: WorkflowVersionSummary): Promise<void> {
    const w = this.detail()?.workflow;
    if (!w) return;
    this.resetErrors();
    const draft = await this.run(() =>
      firstValueFrom(
        this.api.createWorkflowDraft(w.workflowDefinitionId, {
          fromVersionId: from.workflowVersionId,
        }),
      ),
    );
    if (!draft) return;
    this.notify.success(`Draft v${draft.version.versionNo} created`);
    await this.router.navigate(
      ['/admin/workflows', w.workflowDefinitionId, 'versions', draft.version.workflowVersionId],
      this.back.extras,
    );
  }

  protected async askRetire(v: WorkflowVersionSummary): Promise<void> {
    this.retireTarget.set(v);
    this.dependents.set(
      this.auth.has('Task.View')
        ? await dependentTaskTypes(
            this.injector.get(TaskTypesClient),
            this.injector.get(WorkflowLookup),
            Number(this.workflowId()),
          )
        : null,
    );
    this.retireOpen.set(true);
  }

  protected async retire(): Promise<void> {
    const v = this.retireTarget();
    const w = this.detail()?.workflow;
    if (!v || !w) return;
    this.resetErrors();
    const result = await this.run(() =>
      firstValueFrom(
        this.api.retireWorkflowVersion(w.workflowDefinitionId, v.workflowVersionId, {
          rowVersion: v.rowVersion,
        }),
      ),
    );
    this.retireOpen.set(false);
    if (!result) return;
    this.notify.success(`v${result.version.versionNo} retired`);
    this.announcement.set(`v${result.version.versionNo} retired`);
    await this.refresh();
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  protected cancel(): void {
    void this.router.navigateByUrl(this.back.tree, { state: this.listCrumb.state });
  }

  private resetErrors(): void {
    this.serverErrors.set({});
    this.messages.set([]);
    this.conflict.set(false);
  }

  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await work();
    } catch (err) {
      const errors = workflowErrors(err, 'We could not save the workflow. Try again.');
      this.serverErrors.set(errors.fields);
      this.messages.set(errors.messages);
      focusFirstInvalid(this.injector);
      this.conflict.set(errors.conflict);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  /** Takes the server's workflow. With `keepEdits` the name and description the person typed stay (they are still unsaved). */
  private apply(detail: WorkflowDetail, keepEdits = false): void {
    const dirty = keepEdits && this.hasUnsavedChanges();
    this.detail.set(detail);
    if (!dirty) {
      this.name.set(detail.workflow.name);
      this.description.set(detail.workflow.description ?? '');
    }
  }
}
