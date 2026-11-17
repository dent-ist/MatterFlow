import {
  ChangeDetectionStrategy,
  Component,
  computed,
  afterNextRender,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { WorkflowLookup, WorkflowOption } from '../../../core/lookups/workflow-lookup';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import {
  TaskTypeAccessPreview,
  AccessRoleChoice,
  TaskTypeView,
  TaskTypesApi,
} from './task-types-api';
import {
  AccessConfirm,
  AccessModel,
  OPEN_ACCESS,
  mergeRoles,
  accessOf,
  confirmOf,
  isRestricted,
  needsConfirm,
  normalised,
  sameAccess,
} from './task-type-access';
import { AccessDialogKind, TaskTypeAccessConfirm } from './task-type-access-confirm';
import { TaskTypeAccessTab } from './task-type-access-tab';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { CharCounter } from '../../../shared/ui/char-counter';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { DIALOG_COPY, impactLine } from '../shared/dialog-copy';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { Crumb } from '../../../shared/ui/page-header';
import { ADMIN_LIST, ListReturn } from '../list-return';
import { focusStatusAfterAction } from '../after-action';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { RecordSkeleton } from '../../../shared/ui/record-skeleton';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { tabIcon } from '../../../shared/ui/tab-icons';
import { WorkStrip } from '../../../shared/work-queue/work-strip';
import { DEFAULT_TASK_TYPE_ICON } from '../../../shared/icons/task-type-icon';
import { TaskTypeIconPicker } from '../../../shared/icons/task-type-icon-picker';
import { TaskTypeChip } from '../../../shared/ui/task-type-chip';
import {
  TASK_TYPE_COLOURS,
  TASK_TYPE_COLOUR_DEFAULT_LABEL,
  TASK_TYPE_TARGET_DAYS_MAX,
  TASK_TYPE_TARGET_DAYS_MIN,
} from '../../../shared/task-type/task-type-colours';
import { FormDesignerApi, FormVersionSummary } from './form-designer-api';
import {
  FORM_TAB_REASON,
  TASK_TYPE_TAB_LABEL,
  TaskTypeTab,
  activeWorkflowCount,
  formTabFacts,
  noteReasonsOf,
  statusBadgeOf,
  tabOf,
  taskTypeStripItems,
} from './task-type-record';
import { TaskTypeStatusNote } from './task-type-status-note';
import { TaskTypeWorkflowsTab, WorkflowsChange } from './task-type-workflows-tab';
import { NumericDatePipe } from '../../../shared/ui/numeric-date';

/** The typed target turnaround: empty is none, otherwise a whole number of days from 1 to 365 (calendar days). */
export function parseTarget(text: string): { value?: number; error?: string } {
  const t = text.trim();
  if (!t) return {};
  const n = Number(t);
  if (!/^\d+$/.test(t) || n < TASK_TYPE_TARGET_DAYS_MIN || n > TASK_TYPE_TARGET_DAYS_MAX) {
    return {
      error: `Enter a whole number of days from ${TASK_TYPE_TARGET_DAYS_MIN} to ${TASK_TYPE_TARGET_DAYS_MAX}, or leave it empty.`,
    };
  }
  return { value: n };
}

interface Model {
  name: string;
  description: string;
  iconKey: string;
  /** A palette name; empty = the neutral default. */
  colourKey: string;
  /** Calendar days as typed; empty = no target. */
  targetDays: string;
  isActive: boolean;
  eligible: number[];
  defaultWorkflow: number | null;
}

const EMPTY: Model = {
  name: '',
  description: '',
  iconKey: DEFAULT_TASK_TYPE_ICON,
  colourKey: '',
  targetDays: '',
  isActive: true,
  eligible: [],
  defaultWorkflow: null,
};

/** What the Overview tab edits; for a new type the initial Active state counts too. */
const overviewKey = (m: Model, isNew: boolean): string =>
  JSON.stringify({
    name: m.name.trim(),
    description: m.description.trim(),
    iconKey: m.iconKey,
    colourKey: m.colourKey,
    targetDays: m.targetDays.trim(),
    ...(isNew ? { isActive: m.isActive } : {}),
  });

/** What the Workflows tab edits. */
const workflowsKey = (m: Model): string =>
  JSON.stringify({ eligible: [...m.eligible].sort((x, y) => x - y), d: m.defaultWorkflow });

/**
 * Admin: the Task Type record page (UX S14, TE1 to TE9, #380 to #386). Option A of the review: inline editing under a record header
 * (`mf-record-header`: icon and name, Active / Inactive / Not usable, Activity, the primary Edit form and an overflow with Deactivate or
 * Activate), a summary strip, one neutral status note naming why a type is not usable, and tabs Overview | Workflows (n) | Request form
 * (`?tab=`, replaced not added). Each tab saves on its own (the footer shows only for a tab with edits); switching tabs or leaving with
 * edits asks first and offers Save and Leave. A new type is saved first (name, icon, description and the workflows together) and then
 * opens on its Workflows tab; its Request form tab is disabled until then. Needs `TaskType.Manage`.
 */
@Component({
  selector: 'mf-task-type-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Dropdown,
    NumericDatePipe,
    ActivityDrawer,
    CharCounter,
    ConfirmDialog,
    FormsModule,
    RecordHeader,
    RecordSkeleton,
    RecordState,
    Tabs,
    TaskTypeIconPicker,
    TaskTypeChip,
    TaskTypeStatusNote,
    TaskTypeWorkflowsTab,
    TaskTypeAccessTab,
    TaskTypeAccessConfirm,
    WorkStrip,
  ],
  templateUrl: './task-type-edit-page.html',
  styleUrls: ['../admin-lookup.scss', './task-type-edit-page.scss'],
})
export class TaskTypeEditPage implements HasUnsavedChanges {
  /** Route parameter `id`; absent on `/admin/task-types/new`. */
  readonly id = input<string | undefined>(undefined);
  /** `?tab=`: `workflows`, `form` or `access`; absent (or anything else) is Overview. */
  readonly tab = input<string | undefined>(undefined);

  private readonly api = inject(TaskTypesApi);
  private readonly lookup = inject(WorkflowLookup);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly leave = inject(LeaveConfirmService);
  private readonly forms = inject(FormDesignerApi, { optional: true });
  /** The exact list view this page was opened from (#354): the crumb, Cancel and the links on to the record's other pages return to it. */
  protected readonly back = new ListReturn(ADMIN_LIST.taskTypes, this.router);
  protected readonly listCrumb = this.back.crumb('Task Types');
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);

  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('taskType');
  protected readonly state = this.flow.state;
  protected readonly taskType = signal<TaskTypeView | null>(null);
  protected readonly workflows = signal<WorkflowOption[]>([]);
  /** The workflow list answered 403 (no `Workflow.Manage`): names are unknown and Add workflow is not offered. */
  protected readonly workflowsDenied = signal(false);
  protected readonly model = signal<Model>({ ...EMPTY });
  private readonly saved = signal<Model>({ ...EMPTY });
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly conflict = signal(false);
  protected readonly fieldErrors = signal<Record<string, string>>({});
  /** The messages of the summary at the top, in field order (the same rule as the Workflow and Step pages). */
  protected readonly summary = computed(() => Object.values(this.fieldErrors()));
  protected readonly announcement = signal('');
  protected readonly activityOpen = signal(false);
  /** The versions of the request form, read when the Request form tab opens (field count and last published date). */
  private readonly formVersions = signal<readonly FormVersionSummary[] | null>(null);

  // ---- Access (epic #1397, #1402) ----
  /** The three role lists being edited and the saved ones. */
  protected readonly accessModel = signal<AccessModel>({ ...OPEN_ACCESS });
  protected readonly savedAccess = signal<AccessModel>({ ...OPEN_ACCESS });
  protected readonly accessRoles = signal<AccessRoleChoice[]>([]);
  /** Whether the server enforces the rules; null until it is known (never for a type that is not saved yet). */
  protected readonly accessEnforced = signal<boolean | null>(null);
  protected readonly accessState = signal<'loading' | 'error' | 'ready'>('loading');
  /** Server refusals by list (a role that is inactive or gone). */
  protected readonly accessErrors = signal<Record<string, string>>({});
  protected readonly accessDialog = signal<AccessDialogKind>('closed');
  protected readonly accessConfirm = signal<AccessConfirm | null>(null);
  protected readonly accessDialogError = signal('');
  private accessLoaded = false;
  private accessResolve: ((saved: boolean) => void) | null = null;
  /** Lists typed on the New page whose save failed after the type was created: the Access tab opens with them still to save. */
  private readonly accessDraft: AccessModel | null = (() => {
    const draft = inject(Router).currentNavigation()?.extras.state?.['accessDraft'];
    return draft ? accessOf(draft as AccessModel) : null;
  })();

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly current = computed<TaskTypeTab>(() => tabOf(this.tab(), this.isNew()));
  protected readonly overviewDirty = computed(
    () => overviewKey(this.model(), this.isNew()) !== overviewKey(this.saved(), this.isNew()),
  );
  protected readonly workflowsDirty = computed(
    () => workflowsKey(this.model()) !== workflowsKey(this.saved()),
  );
  protected readonly accessDirty = computed(
    () => !sameAccess(this.accessModel(), this.savedAccess()),
  );
  protected readonly dirty = computed(
    () => this.overviewDirty() || this.workflowsDirty() || this.accessDirty(),
  );
  /** The footer (Save, Cancel) is there only while there is something to save: always on a new type, else when a tab has edits. */
  protected readonly showFooter = computed(
    () => this.current() !== 'form' && (this.isNew() || this.dirty()),
  );
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));
  protected readonly canLinkWorkflows = computed(() => this.auth.has('Workflow.Manage'));

  /** The name the header shows: the saved one (edits in the field do not retitle the page until they are saved). */
  protected readonly headerName = computed(() =>
    this.isNew() ? 'New task type' : (this.taskType()?.name ?? 'Task type'),
  );
  protected readonly parents = computed<Crumb[]>(() => [
    { label: 'Administration', plain: true },
    this.listCrumb,
  ]);
  protected readonly backTo = computed(() => ({
    label: 'Task Types',
    link: this.back.tree,
    state: this.listCrumb.state,
  }));
  /** The chips after the status in the header: a restricted type says so on every tab. */
  protected readonly extraBadges = computed(() =>
    this.taskType()?.access?.isRestricted
      ? [{ label: 'Restricted', tone: 'neutral' as const, icon: 'pi-lock' }]
      : [],
  );
  protected readonly badge = computed(() => {
    const t = this.taskType();
    return t ? statusBadgeOf(t) : null;
  });
  protected readonly strip = computed(() => {
    const t = this.taskType();
    return t ? taskTypeStripItems(t, this.workflows()) : [];
  });
  protected readonly reasons = computed(() => {
    const t = this.taskType();
    return t ? noteReasonsOf(t) : [];
  });
  protected readonly formFacts = computed(() => {
    const t = this.taskType();
    return t ? formTabFacts(t, this.formVersions()) : null;
  });
  protected readonly hasForm = computed(() => {
    const f = this.formFacts();
    return !!f && (f.published !== null || f.draftVersionNo !== null || f.retired);
  });
  protected readonly colours = TASK_TYPE_COLOURS;
  protected readonly colourItems: DropdownItem[] = [
    { value: '', label: TASK_TYPE_COLOUR_DEFAULT_LABEL },
    ...TASK_TYPE_COLOURS.map((c) => ({ value: c.key, label: c.label })),
  ];
  protected readonly defaultColourLabel = TASK_TYPE_COLOUR_DEFAULT_LABEL;
  protected readonly targetMin = TASK_TYPE_TARGET_DAYS_MIN;
  protected readonly targetMax = TASK_TYPE_TARGET_DAYS_MAX;

  protected readonly tabs = computed<MfTab[]>(() => {
    const new_ = this.isNew();
    const count = activeWorkflowCount(this.model().eligible, this.workflows());
    return [
      { key: 'overview', label: TASK_TYPE_TAB_LABEL.overview, icon: tabIcon('overview') },
      { key: 'workflows', label: TASK_TYPE_TAB_LABEL.workflows, icon: tabIcon('workflows'), count },
      {
        key: 'form',
        icon: tabIcon('form'),
        label: TASK_TYPE_TAB_LABEL.form,
        ...(new_ ? { disabledReason: FORM_TAB_REASON } : {}),
      },
      { key: 'access', label: TASK_TYPE_TAB_LABEL.access, icon: tabIcon('access') },
    ];
  });

  /** The actions of the header (C3, D-44n): Activity, the primary Edit form and, in the overflow, Deactivate or Activate. None on a new type. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const t = this.taskType();
    if (!t) return [];
    const list: RecordAction[] = [];
    if (this.canSeeActivity()) {
      list.push({
        id: 'activity',
        role: 'activity',
        label: 'Activity',
        icon: 'pi-history',
        run: () => this.activityOpen.set(true),
      });
    }
    list.push({
      id: 'edit-form',
      role: 'primary',
      label: 'Edit Form',
      icon: 'pi-pencil',
      run: () => void this.openForm(),
    });
    list.push({
      id: t.isActive ? 'deactivate' : 'activate',
      role: 'state',
      label: t.isActive ? 'Deactivate' : 'Activate',
      run: () => (t.isActive ? this.askDeactivate() : void this.toggleActive(true)),
    });
    return list;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
    // The tab title names the record, like the detail pages do (UXR2-17), or the state ("Task type not found", #353).
    effect(() => {
      const state = this.state();
      const name = this.taskType()?.name;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('taskType', state));
      } else if (name) this.pageTitle.set(shortTitleText(name));
    });
    // The Access tab reads the lists and the roles when it opens (once; Reload Latest reads them again).
    effect(() => {
      const open = this.current() === 'access';
      const t = this.taskType();
      const ready = this.state() === 'ready';
      if (open && ready && !this.accessLoaded) untracked(() => void this.loadAccess(t));
    });
    // The Request form tab reads the versions of the form (field count, last published) when it opens.
    effect(() => {
      const t = this.taskType();
      if (this.current() === 'form' && t && this.forms) untracked(() => void this.loadVersions(t));
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  readonly saveForLeaveLabel = 'Save and Leave';

  /** "Save and Leave" of the leave question: saves what has edits; false (the person stays) when it did not save. */
  async saveForLeave(): Promise<boolean> {
    return this.save();
  }

  protected async load(id: string | undefined): Promise<void> {
    this.failure.set('');
    this.conflict.set(false);
    this.accessLoaded = false;
    await this.flow.run(
      () =>
        Promise.all([
          // Without Workflow.Manage the workflow list answers 403: the page still opens (the workflows show as "Workflow n").
          firstValueFrom(this.lookup.list())
            .then((list) => ({ list, denied: false }))
            .catch((e: unknown): { list: WorkflowOption[]; denied: boolean } => {
              if (e instanceof ApiError && e.status === 403) return { list: [], denied: true };
              throw e;
            }),
          id === undefined ? Promise.resolve(null) : firstValueFrom(this.api.get(Number(id))),
        ]),
      ([workflows, t]) => {
        this.workflows.set(workflows.list);
        this.workflowsDenied.set(workflows.denied);
        this.taskType.set(t);
        this.apply(t ? this.modelOf(t) : { ...EMPTY });
        // The lists the type came with (a manager's GET carries them): a reload drops edits of the Access tab like those of the other tabs.
        const lists = accessOf(t?.access);
        this.savedAccess.set(lists);
        this.accessModel.set(accessOf(lists));
        this.accessErrors.set({});
      },
    );
  }

  /** The Access tab's data: the saved lists and the roles of a saved type (with whether the server enforces them), or just the roles of a new one. */
  protected async loadAccess(t: TaskTypeView | null): Promise<void> {
    this.accessLoaded = true;
    this.accessState.set('loading');
    try {
      if (t) {
        const [view, choices] = await Promise.all([
          firstValueFrom(this.api.getAccess(t.id)),
          firstValueFrom(this.api.accessRoles()),
        ]);
        this.accessRoles.set(mergeRoles(choices, view.roles));
        this.accessEnforced.set(view.enforced);
        const saved = accessOf(view);
        this.savedAccess.set(saved);
        if (!this.accessDirty() || !this.accessLoadedOnce) {
          this.accessModel.set(this.accessDraft ?? saved);
        }
        this.accessLoadedOnce = true;
      } else {
        this.accessRoles.set(await firstValueFrom(this.api.accessRoles()));
      }
      this.accessState.set('ready');
    } catch {
      this.accessLoaded = false;
      this.accessState.set('error');
    }
  }
  private accessLoadedOnce = false;

  protected retryAccess(): void {
    void this.loadAccess(this.taskType());
  }

  protected changeAccess(next: AccessModel): void {
    this.accessModel.set(next);
    this.accessErrors.set({});
  }

  private async loadVersions(t: TaskTypeView): Promise<void> {
    try {
      this.formVersions.set(await firstValueFrom(this.forms!.listVersions(String(t.id))));
    } catch {
      this.formVersions.set(null); // the summary then shows the version numbers only
    }
  }

  protected readonly copy = DIALOG_COPY.deactivateTaskType;
  protected readonly deactivateOpen = signal(false);

  /** The sentence of the deactivate dialog: how many open tasks keep the type and which workflows are left without an active type. */
  protected readonly impact = computed(() => {
    const t = this.taskType();
    if (!t) return { text: '', names: [] as string[] };
    const byId = new Map(this.workflows().map((w) => [w.id, w]));
    const names = t.eligibleWorkflowIds
      .map((id) => byId.get(id))
      .filter((w): w is WorkflowOption => !!w && w.isActive !== false && w.taskTypeCount === 1)
      .map((w) => w.name);
    return impactLine('deactivateTaskType', { openTasks: t.openTaskCount ?? null, names });
  });

  protected askDeactivate(): void {
    this.deactivateOpen.set(true);
  }

  protected async confirmDeactivate(): Promise<void> {
    await this.toggleActive(false);
  }

  /** Deactivate or Activate from the header overflow. It changes only the state: edits in the tabs stay as they are. */
  protected async toggleActive(active: boolean): Promise<void> {
    const current = this.taskType();
    if (!current || this.busy()) return;
    this.busy.set(true);
    this.failure.set('');
    this.conflict.set(false);
    let done = false;
    try {
      const s = this.saved();
      const updated = await firstValueFrom(
        this.api.update(current.id, {
          name: s.name.trim(),
          description: s.description.trim() || undefined,
          iconKey: s.iconKey,
          colourKey: s.colourKey || undefined,
          targetDays: parseTarget(s.targetDays).value,
          isActive: active,
          eligibleWorkflowIds: s.eligible,
          defaultWorkflowDefinitionId: s.defaultWorkflow ?? undefined,
          rowVersion: current.rowVersion,
        }),
      );
      this.taskType.set(updated);
      this.rebase(updated, this.overviewDirty(), this.workflowsDirty());
      this.announcement.set(`${updated.name} ${active ? 'activated' : 'deactivated'}.`);
      this.notify.success(active ? 'Task type activated' : 'Task type deactivated');
      done = true;
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
    // A failure keeps the dialog open with its message and focus on its button (#414); a conflict means the question is stale.
    if (done || this.conflict()) this.deactivateOpen.set(false);
    if (done) focusStatusAfterAction(this.injector);
  }

  /** Shows the problems (summary at the top plus the message under each field) and puts focus on the first field to fix. */
  private showErrors(errors: Record<string, string>): void {
    this.fieldErrors.set(errors);
    // The fields of the Overview tab are on screen only there: a failed save from another tab brings the person to them.
    if (
      (errors['name'] || errors['iconKey'] || errors['colourKey'] || errors['targetDays']) &&
      this.current() !== 'overview'
    ) {
      void this.go('overview');
    }
    focusFirstInvalid(this.injector);
  }

  protected cancel(): void {
    if (this.isNew()) {
      void this.router.navigateByUrl(this.back.tree, { state: this.listCrumb.state });
      return;
    }
    // The edits of the open tab are dropped (a saved tab has none): the record goes back to what was saved.
    const tab = this.current();
    this.revert(tab === 'workflows' || tab === 'access' ? tab : 'overview');
    this.announcement.set('Changes discarded.');
  }

  protected retry(): void {
    void this.load(this.id());
  }

  private modelOf(t: TaskTypeView): Model {
    return {
      name: t.name,
      description: t.description ?? '',
      iconKey: t.iconKey,
      colourKey: t.colourKey ?? '',
      targetDays: t.targetDays == null ? '' : String(t.targetDays),
      isActive: t.isActive,
      eligible: [...t.eligibleWorkflowIds],
      defaultWorkflow: t.defaultWorkflowDefinitionId ?? null,
    };
  }

  private apply(m: Model): void {
    this.model.set(m);
    this.saved.set({ ...m, eligible: [...m.eligible] });
    this.fieldErrors.set({});
  }

  /**
   * The record changed on the server (a save, Deactivate, Activate): `saved` follows it; a tab that still has edits keeps them in the
   * model, a clean tab shows what the server has.
   */
  private rebase(updated: TaskTypeView, keepOverview: boolean, keepWorkflows: boolean): void {
    const fresh = this.modelOf(updated);
    const now = this.model();
    this.saved.set({ ...fresh, eligible: [...fresh.eligible] });
    this.model.set({
      ...fresh,
      ...(keepOverview
        ? {
            name: now.name,
            description: now.description,
            iconKey: now.iconKey,
            colourKey: now.colourKey,
            targetDays: now.targetDays,
          }
        : {}),
      ...(keepWorkflows
        ? { eligible: [...now.eligible], defaultWorkflow: now.defaultWorkflow }
        : {}),
    });
    this.fieldErrors.set({});
  }

  private revert(tab: 'overview' | 'workflows' | 'access'): void {
    if (tab === 'access') {
      this.accessModel.set(accessOf(this.savedAccess()));
      this.accessErrors.set({});
      return;
    }
    const s = this.saved();
    const m = this.model();
    this.model.set(
      tab === 'overview'
        ? {
            ...m,
            name: s.name,
            description: s.description,
            iconKey: s.iconKey,
            colourKey: s.colourKey,
            targetDays: s.targetDays,
            isActive: s.isActive,
          }
        : { ...m, eligible: [...s.eligible], defaultWorkflow: s.defaultWorkflow },
    );
    this.fieldErrors.set({});
  }

  protected patch(change: Partial<Model>): void {
    this.model.set({ ...this.model(), ...change });
    this.fieldErrors.set({});
  }

  /** A change of the Workflows tab: the eligible ids and the default, and the sentence to say aloud. */
  protected changeWorkflows(change: WorkflowsChange): void {
    this.patch({ eligible: change.eligible, defaultWorkflow: change.defaultId });
    this.announcement.set(change.message);
  }

  /** The fix of a status-note reason that is an action of this page. */
  protected fix(fix: 'activate' | 'workflows'): void {
    if (fix === 'activate') void this.toggleActive(true);
    else {
      void this.select('workflows', true);
    }
  }

  /** Edit form (header and Request form tab): the form designer of the type; a dirty page asks first (the route's leave guard). */
  protected async openForm(): Promise<void> {
    const t = this.taskType();
    if (t) await this.router.navigate(['/admin/task-types', t.id, 'form'], this.back.extras);
  }

  /**
   * Opens a tab. A tab with edits asks first (Stay, Leave, or Save and Leave) because each tab saves on its own; leaving drops its edits.
   * Resolves true when the tab was opened. The address is replaced, not added, so Back leaves the page.
   */
  protected async select(key: string, focusAdd = false): Promise<boolean> {
    const to = tabOf(key, this.isNew());
    if (to === this.current()) return true;
    if (!this.isNew()) {
      const from = this.current();
      const edits =
        (from === 'overview' && this.overviewDirty()) ||
        (from === 'workflows' && this.workflowsDirty()) ||
        (from === 'access' && this.accessDirty());
      if (edits) {
        const leave = await this.leave.ask({
          label: this.saveForLeaveLabel,
          run: () => this.saveForLeave(),
        });
        if (!leave) return false;
        if (this.dirty()) {
          this.revert(from === 'workflows' || from === 'access' ? from : 'overview');
        }
      }
    }
    await this.go(to);
    if (focusAdd) {
      afterNextRender(() => document.querySelector<HTMLElement>('[data-add-input]')?.focus(), {
        injector: this.injector,
      });
    }
    return true;
  }

  private go(tab: TaskTypeTab): Promise<boolean> {
    return this.router.navigate([], {
      queryParams: { tab: tab === 'overview' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Saves the tabs that have edits in one request (normally the open tab: a tab with edits is never left without asking), taking the other
   * fields from what is saved. A new type is created with everything and opens on its Workflows tab. Resolves true when it was saved.
   */
  protected async save(): Promise<boolean> {
    if (this.current() === 'access' && !this.isNew()) return this.saveAccess();
    const m = this.model();
    const name = m.name.trim();
    if (!name) {
      this.showErrors({ name: 'Enter a name.' });
      return false;
    }
    if (!m.iconKey) {
      this.showErrors({ iconKey: 'Choose an icon.' });
      return false;
    }
    const target = parseTarget(m.targetDays);
    if (target.error) {
      this.showErrors({ targetDays: target.error });
      return false;
    }
    this.busy.set(true);
    this.failure.set('');
    this.conflict.set(false);
    try {
      const current = this.taskType();
      if (!current) {
        const created = await firstValueFrom(
          this.api.create({
            name,
            description: m.description.trim() || undefined,
            iconKey: m.iconKey,
            colourKey: m.colourKey || undefined,
            targetDays: target.value,
            isActive: m.isActive,
            eligibleWorkflowIds: m.eligible,
            defaultWorkflowDefinitionId: m.defaultWorkflow ?? undefined,
          }),
        );
        this.apply(this.modelOf(created));
        const draft = normalised(this.accessModel());
        const outcome = await this.createAccess(created, draft);
        // Lands on the Workflows tab (the next thing to set up), or on the Access tab when its rules could not be saved; the address is replaced so Back
        // returns to where Create was opened.
        await this.router.navigate(['/admin/task-types', created.id], {
          queryParams: { tab: outcome === 'failed' ? 'access' : 'workflows' },
          replaceUrl: true,
          ...(outcome === 'failed' ? { state: { accessDraft: draft } } : {}),
        });
        return true;
      }
      const overview = this.overviewDirty() ? m : this.saved();
      const flow = this.workflowsDirty() ? m : this.saved();
      const updated = await firstValueFrom(
        this.api.update(current.id, {
          name: overview.name.trim(),
          description: overview.description.trim() || undefined,
          iconKey: overview.iconKey,
          colourKey: overview.colourKey || undefined,
          targetDays: parseTarget(overview.targetDays).value,
          isActive: current.isActive,
          eligibleWorkflowIds: flow.eligible,
          defaultWorkflowDefinitionId: flow.defaultWorkflow ?? undefined,
          rowVersion: current.rowVersion,
        }),
      );
      this.taskType.set(updated);
      this.rebase(updated, false, false);
      this.announcement.set(`${updated.name} saved.`);
      this.notify.success('Task type saved');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * A new type is created first and its access rules saved right after (two requests, one click). The type exists even when the second fails: the person lands on its
   * Access tab with the lists still to save, and a toast says so.
   */
  private async createAccess(
    created: TaskTypeView,
    draft: AccessModel,
  ): Promise<'open' | 'saved' | 'failed'> {
    if (!isRestricted(draft)) {
      this.accessModel.set({ ...OPEN_ACCESS });
      this.savedAccess.set({ ...OPEN_ACCESS });
      this.notify.success('Task type created');
      return 'open';
    }
    try {
      const view = await firstValueFrom(
        this.api.replaceAccess(created.id, { ...draft, rowVersion: created.rowVersion }),
      );
      this.savedAccess.set(draft);
      this.notify.success('Task type created');
      if (view.enforced === false) this.notify.info('Access rules saved', 'Not enforced yet.');
      return 'saved';
    } catch {
      // The guard must not ask about lists that travel on to the Access tab.
      this.accessModel.set({ ...OPEN_ACCESS });
      this.savedAccess.set({ ...OPEN_ACCESS });
      this.notify.error(
        'Task type created, but its access rules were not saved.',
        'Open the Access tab and save them again.',
      );
      return 'failed';
    }
  }

  /**
   * Saves the Access tab of a saved type: asks the server who would be affected (`POST .../access/preview`), opens the confirmation only when people lose view or
   * edit, the type becomes open to everyone or the caller loses access, then replaces the lists (`PUT .../access`). A failed preview blocks the save (Cancel and
   * Retry). Resolves true when the rules were saved, false when the person cancelled or it failed.
   */
  protected saveAccess(): Promise<boolean> {
    if (this.busy() || !this.taskType()) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.accessResolve = resolve;
      void this.checkAccess();
    });
  }

  private finishAccess(saved: boolean): void {
    const resolve = this.accessResolve;
    this.accessResolve = null;
    resolve?.(saved);
  }

  protected async checkAccess(): Promise<void> {
    const t = this.taskType();
    if (!t) return;
    this.busy.set(true);
    this.failure.set('');
    this.conflict.set(false);
    this.accessDialogError.set('');
    // The question appears only when there is something to say; a slow check shows quiet lines meanwhile.
    const slow = setTimeout(() => this.accessDialog.set('checking'), 400);
    let preview: TaskTypeAccessPreview;
    try {
      const { canView, canEdit, canAssign } = normalised(this.accessModel());
      preview = await firstValueFrom(this.api.previewAccess(t.id, { canView, canEdit, canAssign }));
    } catch (e) {
      clearTimeout(slow);
      this.busy.set(false);
      if (serverFormErrors(e).conflict) {
        this.accessDialog.set('closed');
        this.conflict.set(true);
        this.finishAccess(false);
        return;
      }
      this.accessDialog.set('error');
      return;
    }
    clearTimeout(slow);
    this.busy.set(false);
    if (needsConfirm(preview)) {
      this.accessConfirm.set(
        confirmOf(preview, this.accessEnforced() !== false, t.name, t.openTaskCount),
      );
      this.accessDialog.set('confirm');
      return;
    }
    this.accessDialog.set('closed');
    await this.commitAccess();
  }

  protected cancelAccessDialog(): void {
    if (this.busy()) return;
    this.accessDialog.set('closed');
    this.accessDialogError.set('');
    this.finishAccess(false);
  }

  protected async commitAccess(): Promise<void> {
    const t = this.taskType();
    if (!t || this.busy()) return;
    this.busy.set(true);
    this.accessDialogError.set('');
    try {
      const view = await firstValueFrom(
        this.api.replaceAccess(t.id, {
          ...normalised(this.accessModel()),
          rowVersion: t.rowVersion,
        }),
      );
      const saved = accessOf(view);
      this.taskType.set({
        ...t,
        rowVersion: view.rowVersion,
        access: { isRestricted: view.isRestricted, ...saved },
      });
      this.accessRoles.set(mergeRoles(this.accessRoles(), view.roles));
      this.accessEnforced.set(view.enforced);
      this.savedAccess.set(saved);
      this.accessModel.set(accessOf(saved));
      this.accessErrors.set({});
      this.accessDialog.set('closed');
      this.announcement.set(`Access rules saved for ${t.name}.`);
      if (view.enforced === false) this.notify.info('Access rules saved', 'Not enforced yet.');
      else this.notify.success('Access rules saved');
      this.finishAccess(true);
    } catch (e) {
      const errors = serverFormErrors(e);
      if (errors.conflict) {
        this.accessDialog.set('closed');
        this.conflict.set(true);
      } else if (Object.keys(errors.fields).length > 0) {
        this.accessDialog.set('closed');
        this.accessErrors.set(errors.fields);
      } else if (this.accessDialog() === 'confirm') {
        // The question stays open with the reason, focus on its button (#414).
        this.accessDialogError.set(
          e instanceof Error && e.message
            ? e.message
            : "Couldn't save the access rules. Try again.",
        );
        this.busy.set(false);
        return;
      } else {
        // The page's failure line (as for the other tabs); the shared error toast says the request failed.
        this.failure.set(
          `Couldn't save the access rules.${e instanceof Error && e.message ? ` ${e.message}` : ''}`,
        );
      }
      this.finishAccess(false);
    } finally {
      this.busy.set(false);
    }
  }

  private fail(e: unknown): void {
    const errors = serverFormErrors(e);
    if (errors.conflict) this.conflict.set(true);
    else if (Object.keys(errors.fields).length > 0) this.showErrors(errors.fields);
    else this.failure.set(e instanceof Error ? e.message : 'Couldn’t save. Try again.');
  }

  /** After a conflict: take the latest saved version (dropping local edits). */
  protected async reload(): Promise<void> {
    this.accessLoadedOnce = false;
    await this.load(this.id());
  }
}
