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
import { TaskTypeView, TaskTypesApi } from './task-types-api';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { CharCounter } from '../../../shared/ui/char-counter';
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
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { WorkStrip } from '../../../shared/work-queue/work-strip';
import { DEFAULT_TASK_TYPE_ICON, TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { TaskTypeIconPicker } from '../../../shared/icons/task-type-icon-picker';
import { TaskTypeBadge } from '../../../shared/task-type/task-type-badge';
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
 * (`mf-record-header`: icon and name, Active / Inactive / Not usable, Edit, Activity, the primary Edit form and an overflow with Deactivate or
 * Activate), a summary strip, one neutral status note naming why a type is not usable, and tabs Overview | Workflows (n) | Request form
 * (`?tab=`, replaced not added). Each tab saves on its own (the footer shows only for a tab with edits); switching tabs or leaving with
 * edits asks first and offers Save and leave. A new type is saved first (name, icon, description and the workflows together) and then
 * opens on its Workflows tab; its Request form tab is disabled until then. Needs `TaskType.Manage`.
 */
@Component({
  selector: 'mf-task-type-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ActivityDrawer,
    CharCounter,
    ConfirmDialog,
    FormsModule,
    MfDatePipe,
    RecordHeader,
    RecordSkeleton,
    RecordState,
    Tabs,
    TaskTypeIcon,
    TaskTypeIconPicker,
    TaskTypeBadge,
    TaskTypeStatusNote,
    TaskTypeWorkflowsTab,
    WorkStrip,
  ],
  templateUrl: './task-type-edit-page.html',
  styleUrls: ['../admin-lookup.scss', './task-type-edit-page.scss'],
})
export class TaskTypeEditPage implements HasUnsavedChanges {
  /** Route parameter `id`; absent on `/admin/task-types/new`. */
  readonly id = input<string | undefined>(undefined);
  /** `?tab=`: `workflows` or `form`; absent (or anything else) is Overview. */
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

  protected readonly isNew = computed(() => this.id() === undefined);
  protected readonly current = computed<TaskTypeTab>(() => tabOf(this.tab(), this.isNew()));
  protected readonly overviewDirty = computed(
    () => overviewKey(this.model(), this.isNew()) !== overviewKey(this.saved(), this.isNew()),
  );
  protected readonly workflowsDirty = computed(
    () => workflowsKey(this.model()) !== workflowsKey(this.saved()),
  );
  protected readonly dirty = computed(() => this.overviewDirty() || this.workflowsDirty());
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
  protected readonly defaultColourLabel = TASK_TYPE_COLOUR_DEFAULT_LABEL;
  protected readonly targetMin = TASK_TYPE_TARGET_DAYS_MIN;
  protected readonly targetMax = TASK_TYPE_TARGET_DAYS_MAX;

  protected readonly tabs = computed<MfTab[]>(() => {
    const new_ = this.isNew();
    const count = activeWorkflowCount(this.model().eligible, this.workflows());
    return [
      { key: 'overview', label: TASK_TYPE_TAB_LABEL.overview },
      { key: 'workflows', label: TASK_TYPE_TAB_LABEL.workflows, count },
      {
        key: 'form',
        label: TASK_TYPE_TAB_LABEL.form,
        ...(new_ ? { disabledReason: FORM_TAB_REASON } : {}),
      },
    ];
  });

  /** The actions of the header (C3): Edit, Activity, the primary Edit form and, in the overflow, Deactivate or Activate. None on a new type. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const t = this.taskType();
    if (!t) return [];
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
    list.push({
      id: 'edit-form',
      role: 'primary',
      label: 'Edit form',
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
    // The Request form tab reads the versions of the form (field count, last published) when it opens.
    effect(() => {
      const t = this.taskType();
      if (this.current() === 'form' && t && this.forms) untracked(() => void this.loadVersions(t));
    });
  }

  hasUnsavedChanges(): boolean {
    return this.dirty();
  }

  readonly saveForLeaveLabel = 'Save and leave';

  /** "Save and leave" of the leave question: saves what has edits; false (the person stays) when it did not save. */
  async saveForLeave(): Promise<boolean> {
    return this.save();
  }

  protected async load(id: string | undefined): Promise<void> {
    this.failure.set('');
    this.conflict.set(false);
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
      },
    );
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
      this.notify.success(active ? 'Task type activated.' : 'Task type deactivated.');
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
    this.revert(this.current() === 'workflows' ? 'workflows' : 'overview');
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

  private revert(tab: 'overview' | 'workflows'): void {
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

  /** Edit in the header: the fields are always editable, so it takes the person to the name. */
  protected async editHere(): Promise<void> {
    if (this.current() !== 'overview' && !(await this.select('overview'))) return;
    afterNextRender(() => document.getElementById('tt-name')?.focus(), { injector: this.injector });
  }

  /** Edit form (header and Request form tab): the form designer of the type; a dirty page asks first (the route's leave guard). */
  protected async openForm(): Promise<void> {
    const t = this.taskType();
    if (t) await this.router.navigate(['/admin/task-types', t.id, 'form'], this.back.extras);
  }

  /**
   * Opens a tab. A tab with edits asks first (Stay, Leave, or Save and leave) because each tab saves on its own; leaving drops its edits.
   * Resolves true when the tab was opened. The address is replaced, not added, so Back leaves the page.
   */
  protected async select(key: string, focusAdd = false): Promise<boolean> {
    const to = tabOf(key, this.isNew());
    if (to === this.current()) return true;
    if (!this.isNew()) {
      const from = this.current();
      const edits =
        (from === 'overview' && this.overviewDirty()) ||
        (from === 'workflows' && this.workflowsDirty());
      if (edits) {
        const leave = await this.leave.ask({
          label: this.saveForLeaveLabel,
          run: () => this.saveForLeave(),
        });
        if (!leave) return false;
        if (this.dirty()) this.revert(from === 'workflows' ? 'workflows' : 'overview');
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
        this.notify.success('Task type created.');
        // Lands on the Workflows tab (the next thing to set up); the address is replaced so Back returns to where Create was opened.
        await this.router.navigate(['/admin/task-types', created.id], {
          queryParams: { tab: 'workflows' },
          replaceUrl: true,
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
      this.notify.success('Saved.');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
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
    await this.load(this.id());
  }
}
