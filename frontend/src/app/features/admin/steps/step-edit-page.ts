import {
  ChangeDetectionStrategy,
  Component,
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
import { firstValueFrom } from 'rxjs';
import {
  FormVersionStatus,
  FormVersionSummary,
  FormsClient,
  StepDefinitionDetail,
  StepDefinitionsClient,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { QuietRequests } from '../../../core/http/interceptors';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { focusFirstInvalid } from '../../../shared/forms/focus-invalid';
import {
  HasUnsavedChanges,
  LeaveConfirmService,
} from '../../../shared/guards/unsaved-changes.guard';
import { ActivityDrawer } from '../../../shared/ui/activity-drawer';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TagInput } from '../../../shared/ui/tag-input';
import { TextField } from '../../../shared/ui/text-field';
import { RecordLoadFlow, RecordState, recordStateTitle } from '../../../shared/ui/record-state';
import { RecordSkeleton } from '../../../shared/ui/record-skeleton';
import { RecordAction, RecordHeader } from '../../../shared/ui/record-header';
import { Crumb } from '../../../shared/ui/page-header';
import { MfTab, Tabs } from '../../../shared/ui/tabs';
import { WorkStrip } from '../../../shared/work-queue/work-strip';
import { DIALOG_COPY, impactLine } from '../shared/dialog-copy';
import { PageTitle, shortTitleText } from '../../../core/title/page-title';
import { ADMIN_LIST, ListReturn } from '../list-return';
import { StepInputsTab } from './step-inputs-tab';
import {
  STEP_TAB_LABEL,
  STEP_TAB_REASON,
  StepTab,
  inputsFacts,
  stepStripItems,
  stepTabOf,
  usageCounts,
  usedByWorkflows,
  usedWorkflowCount,
} from './step-record';
import { StepUsedByTab } from './step-used-by-tab';

/** True for an empty value or a full http(s) address (mirrors the server rule). */
export function isValidDocumentationUrl(value: string): boolean {
  const text = value.trim();
  if (text === '') return true;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** True when both lists hold the same tags in the same order (ignoring case). */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t.toLowerCase() === b[i].toLowerCase());
}

/**
 * Admin: the Step record page (UX S15, SE1 to SE5, #403 to #406). Option A of the review: inline editing under a record header
 * (`mf-record-header`: the step title as the H1 with Active / Inactive, Edit, Activity, the primary Edit inputs and an overflow with Deactivate
 * or Activate), a summary strip (Status, Used in n workflows, Inputs, Tags) and tabs Details | Inputs | Used by (n) (`?tab=`, replaced not
 * added). Details is the only tab with edits and saves on its own; switching tabs or leaving with edits asks first and offers Save and leave.
 * Inputs lists the step's form read-only (the designer is `/admin/steps/:id/form`); Used by links to every workflow version that contains the
 * step. A new step opens on Inputs after it is saved; until then those two tabs are disabled. Needs `Workflow.Manage` (route guard); the
 * list of inputs also needs `Task.View` (a server rule of the form endpoints), without it the tab says so.
 */
@Component({
  selector: 'mf-step-edit-page',
  imports: [
    ActivityDrawer,
    ConfirmDialog,
    RecordHeader,
    RecordSkeleton,
    RecordState,
    StepInputsTab,
    StepUsedByTab,
    Tabs,
    TagInput,
    TextField,
    WorkStrip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './step-edit-page.html',
  styleUrls: ['../../../shared/ui/page.scss', './step-edit-page.scss'],
})
export class StepEditPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly stepId = input<string>();
  /** `?tab=`: `inputs` or `used-by`; absent (or anything else) is Details. */
  readonly tab = input<string | undefined>(undefined);

  private readonly api = inject(StepDefinitionsClient);
  private readonly forms = inject(FormsClient);
  private readonly workflowsApi = inject(WorkflowsClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStore);
  private readonly leave = inject(LeaveConfirmService);
  private readonly quiet = inject(QuietRequests);
  /** The exact list view this page was opened from (#354): the crumb, Cancel and the links on to the record's other pages return to it. */
  protected readonly back = new ListReturn(ADMIN_LIST.steps, this.router);
  protected readonly listCrumb = this.back.crumb('Workflow Steps');
  private readonly notify = inject(NotificationService);
  private readonly pageTitle = inject(PageTitle);
  private readonly injector = inject(Injector);

  protected readonly isEdit = computed(() => this.stepId() !== undefined);
  /** The shared load flow of the record pages (#353): 404, 403 and failures show `mf-record-state`; the request is quiet (no toast). */
  protected readonly flow = new RecordLoadFlow('step');
  protected readonly state = this.flow.state;
  protected readonly original = signal<StepDefinitionDetail | null>(null);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly instructions = signal('');
  protected readonly documentationUrl = signal('');
  protected readonly tags = signal<string[]>([]);
  protected readonly tagSuggestions = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly copy = DIALOG_COPY.deactivateStep;
  protected readonly deactivateOpen = signal(false);
  protected readonly activityOpen = signal(false);
  protected readonly announcement = signal('');
  /** The versions of the step's form (published and draft ids, field counts); null until read, and when they cannot be read. */
  private readonly versions = signal<readonly FormVersionSummary[] | null>(null);
  /** The version list answered 403: reading forms needs `Task.View`. */
  private readonly versionsDenied = signal(false);
  /** Which workflows that use the step are active, by id; null while unknown (then every workflow counts). */
  private readonly workflowActive = signal<ReadonlyMap<number, boolean> | null>(null);
  private saved = false;
  private suggestRequest = 0;

  protected readonly current = computed<StepTab>(() => stepTabOf(this.tab(), !this.isEdit()));
  protected readonly canSeeActivity = computed(() => this.auth.has('Audit.View'));

  protected readonly titleError = computed(() => {
    if (this.submitted() && this.title().trim() === '') return 'Enter a title.';
    return this.fieldError('title');
  });

  protected readonly urlError = computed(() => {
    if (this.submitted() && !isValidDocumentationUrl(this.documentationUrl())) {
      return 'Enter a full web address starting with http:// or https://.';
    }
    return this.fieldError('documentationUrl');
  });

  /** The Details tab has edits (a new step: anything typed). */
  protected readonly dirty = computed(() => {
    const o = this.original();
    if (this.isEdit()) {
      return (
        !!o &&
        (this.title() !== o.title ||
          this.description() !== (o.description ?? '') ||
          this.instructions() !== (o.instructions ?? '') ||
          this.documentationUrl() !== (o.documentationUrl ?? '') ||
          !sameTags(this.tags(), o.tags))
      );
    }
    return (
      this.title().trim() !== '' ||
      this.description().trim() !== '' ||
      this.instructions().trim() !== '' ||
      this.documentationUrl().trim() !== '' ||
      this.tags().length > 0
    );
  });
  /** Save and Cancel show on a new step, and on Details while it has edits. */
  protected readonly showFooter = computed(
    () => this.current() === 'details' && (!this.isEdit() || this.dirty()),
  );

  /** The title the header shows: the saved one (edits in the field do not retitle the page until they are saved). */
  protected readonly headerName = computed(() =>
    this.isEdit() ? (this.original()?.title ?? 'Step') : 'New step',
  );
  /** Administration > Task Types > Workflow Steps > the step: the Workflow Steps list is the third tab of the Task Types page. */
  protected readonly parents = computed<Crumb[]>(() => [
    { label: 'Administration', plain: true },
    { label: 'Task Types', link: '/admin/task-types' },
    this.listCrumb,
  ]);
  protected readonly backTo = computed(() => ({
    label: 'Workflow Steps',
    link: this.back.tree,
    state: this.listCrumb.state,
  }));

  protected readonly usedBy = computed(() => {
    const o = this.original();
    return o ? usedByWorkflows(o.usage, this.workflowActive()) : [];
  });
  protected readonly usedCount = computed(() => usedWorkflowCount(this.usedBy()));
  protected readonly facts = computed(() => {
    const o = this.original();
    return inputsFacts(
      o ?? { publishedFormVersionId: undefined, draftFormFieldCount: 0 },
      this.versions(),
    );
  });
  protected readonly strip = computed(() => {
    const o = this.original();
    return o ? stepStripItems(o, this.usedCount(), this.facts()) : [];
  });
  /** The version the Inputs tab lists: the published one, else the open draft. */
  protected readonly shownVersionId = computed(() => {
    const o = this.original();
    if (!o) return null;
    if (o.publishedFormVersionId !== undefined && o.publishedFormVersionId !== null) {
      return o.publishedFormVersionId;
    }
    return (
      this.versions()?.find((v) => v.status === FormVersionStatus.Draft)?.formVersionId ?? null
    );
  });
  /** The draft is the only version and the version list cannot be read, so there is nothing to list. */
  protected readonly inputsUnreadable = computed(
    () =>
      this.versionsDenied() &&
      this.facts().state === 'draft' &&
      this.original()?.publishedFormVersionId == null,
  );

  /** Reading forms was refused (no `Task.View`), and the form designer reads them too, so Edit inputs is not offered. */
  protected readonly canEditInputs = computed(() => !this.versionsDenied());

  protected readonly tabs = computed<MfTab[]>(() => {
    const isNew = !this.isEdit();
    const reason = isNew ? { disabledReason: STEP_TAB_REASON } : {};
    return [
      { key: 'details', label: STEP_TAB_LABEL.details },
      { key: 'inputs', label: STEP_TAB_LABEL.inputs, ...reason },
      {
        key: 'used-by',
        label: STEP_TAB_LABEL['used-by'],
        ...(isNew ? reason : { count: this.usedCount() }),
      },
    ];
  });

  /** The actions of the header: Edit, Activity, the primary Edit inputs and, in the overflow, Deactivate or Activate. None on a new step. */
  protected readonly headerActions = computed<RecordAction[]>(() => {
    const o = this.original();
    if (!this.isEdit() || !o) return [];
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
    // The designer reads the form, which needs Task.View: without it the page would answer "no access", so the button is not offered.
    if (this.canEditInputs()) {
      list.push({
        id: 'edit-inputs',
        role: 'primary',
        label: 'Edit inputs',
        icon: 'pi-pencil',
        run: () => void this.openInputs(),
      });
    }
    list.push({
      id: o.isActive ? 'deactivate' : 'activate',
      role: 'state',
      label: o.isActive ? 'Deactivate' : 'Activate',
      run: () => (o.isActive ? this.deactivateOpen.set(true) : void this.activate()),
    });
    return list;
  });

  /** The sentence of the deactivate dialog: how many workflow drafts keep the step and how many published versions use it (both from the step). */
  protected readonly impact = computed(() => {
    const o = this.original();
    if (!o) return { text: '', names: [] as string[] };
    const { drafts, published } = usageCounts(o.usage);
    return impactLine('deactivateStep', { drafts, publishedVersions: published });
  });

  constructor() {
    effect(() => {
      if (this.stepId() !== undefined) untracked(() => void this.load());
      else untracked(() => this.flow.state.set('ready'));
    });
    effect(() => {
      const state = this.state();
      const title = this.original()?.title;
      if (state === 'notFound' || state === 'forbidden' || state === 'error') {
        this.pageTitle.set(recordStateTitle('step', state));
      } else if (title) this.pageTitle.set(shortTitleText(title));
    });
    // Which workflows that use the step are active (the Used by count and the badge on an inactive one) and the versions of its form (the
    // strip and the Inputs tab): read once per step, quietly; what cannot be read is left out, never shown as a made-up number.
    const stepKey = computed(() => this.original()?.stepDefinitionId ?? null);
    const formKey = computed(() => this.original()?.formDefinitionId ?? null);
    effect(() => {
      const id = stepKey();
      if (id !== null) untracked(() => void this.loadWorkflowStates(id));
    });
    effect(() => {
      const id = formKey();
      if (id !== null) untracked(() => void this.loadVersions(id));
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    return this.dirty();
  }

  readonly saveForLeaveLabel = 'Save and leave';

  /** "Save and leave" of the leave question: saves the Details edits; false (the person stays) when it did not save. */
  async saveForLeave(): Promise<boolean> {
    return this.save();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  async load(): Promise<void> {
    this.conflict.set(false);
    this.summary.set([]);
    await this.flow.run(
      () => firstValueFrom(this.api.getStepDefinition(Number(this.stepId()))),
      (step) => this.apply(step),
    );
  }

  private async loadWorkflowStates(stepId: number): Promise<void> {
    try {
      const page = await this.quiet.run(() =>
        firstValueFrom(
          this.workflowsApi.listWorkflows(
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            stepId,
            1,
            100,
          ),
        ),
      );
      if (page.total > page.items.length) return; // more than one page: leave the count as the API's usage shows it
      this.workflowActive.set(new Map(page.items.map((w) => [w.workflowDefinitionId, w.isActive])));
    } catch {
      this.workflowActive.set(null);
    }
  }

  private async loadVersions(formDefinitionId: number): Promise<void> {
    this.versionsDenied.set(false);
    try {
      this.versions.set(
        await this.quiet.run(() => firstValueFrom(this.forms.listFormVersions(formDefinitionId))),
      );
    } catch (e) {
      this.versions.set(null);
      this.versionsDenied.set(e instanceof ApiError && e.status === 403);
    }
  }

  protected async save(): Promise<boolean> {
    this.submitted.set(true);
    this.resetErrors();

    const problems: string[] = [];
    if (this.title().trim() === '') problems.push('Enter a title.');
    if (!isValidDocumentationUrl(this.documentationUrl())) {
      problems.push('Enter a full web address starting with http:// or https://.');
    }
    if (problems.length > 0) {
      this.summary.set(problems);
      focusFirstInvalid(this.injector);
      return false;
    }

    const body = {
      title: this.title().trim(),
      description: this.description().trim() || undefined,
      instructions: this.instructions().trim() || undefined,
      documentationUrl: this.documentationUrl().trim() || undefined,
      tags: this.tags(),
    };
    const result = await this.run(() =>
      this.isEdit()
        ? firstValueFrom(
            this.api.updateStepDefinition(Number(this.stepId()), {
              ...body,
              isActive: this.original()!.isActive,
              rowVersion: this.original()!.rowVersion,
            }),
          )
        : firstValueFrom(this.api.createStepDefinition(body)),
    );
    if (!result) return false;
    this.notify.success(`Step ${result.title} saved`);
    if (this.isEdit()) {
      this.apply(result);
      this.submitted.set(false);
      this.announcement.set(`${result.title} saved.`);
    } else {
      this.saved = true;
      // Lands on Inputs (the next thing to set up); the address is replaced so Back returns to where Create was opened.
      await this.router.navigate(['/admin/steps', result.stepDefinitionId], {
        queryParams: { tab: 'inputs' },
        replaceUrl: true,
      });
    }
    return true;
  }

  protected async deactivate(): Promise<void> {
    const o = this.original();
    this.deactivateOpen.set(false);
    if (!o) return;
    const result = await this.run(() =>
      firstValueFrom(
        this.api.deactivateStepDefinition(o.stepDefinitionId, { rowVersion: o.rowVersion }),
      ),
    );
    if (result) {
      this.apply(result, true);
      this.announcement.set(`${result.title} deactivated.`);
      this.notify.success('Step deactivated');
    }
  }

  protected async activate(): Promise<void> {
    const o = this.original();
    if (!o) return;
    this.resetErrors();
    const result = await this.run(() =>
      firstValueFrom(
        this.api.activateStepDefinition(o.stepDefinitionId, { rowVersion: o.rowVersion }),
      ),
    );
    if (result) {
      this.apply(result, true);
      this.announcement.set(`${result.title} activated.`);
      this.notify.success('Step activated');
    }
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  /** Cancel: a new step goes back to the list; an existing one drops the edits and shows what is saved. */
  protected cancel(): void {
    if (!this.isEdit()) {
      void this.router.navigateByUrl(this.back.tree, { state: this.listCrumb.state });
      return;
    }
    this.revert();
    this.announcement.set('Changes discarded.');
  }

  /** Edit in the header: the fields are always editable, so it takes the person to the title. */
  protected async editHere(): Promise<void> {
    if (this.current() !== 'details' && !(await this.select('details'))) return;
    afterNextRender(() => document.getElementById('step-title')?.focus(), {
      injector: this.injector,
    });
  }

  /** Edit inputs (header and Inputs tab): the form designer of the step; a page with edits asks first (the route's leave guard). */
  protected async openInputs(): Promise<void> {
    const o = this.original();
    if (o)
      await this.router.navigate(['/admin/steps', o.stepDefinitionId, 'form'], this.back.extras);
  }

  /**
   * Opens a tab. Details with edits asks first (Stay, Leave, or Save and leave); leaving drops its edits. Resolves true when the tab was
   * opened. The address is replaced, not added, so Back leaves the page.
   */
  protected async select(key: string): Promise<boolean> {
    const to = stepTabOf(key, !this.isEdit());
    if (to === this.current()) return true;
    if (this.isEdit() && this.current() === 'details' && this.dirty()) {
      const ok = await this.leave.ask({
        label: this.saveForLeaveLabel,
        run: () => this.saveForLeave(),
      });
      if (!ok) return false;
      if (this.dirty()) this.revert();
    }
    await this.router.navigate([], {
      queryParams: { tab: to === 'details' ? null : to },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    return true;
  }

  private revert(): void {
    const o = this.original();
    if (o) this.fill(o);
    this.resetErrors();
    this.submitted.set(false);
  }

  private resetErrors(): void {
    this.serverErrors.set({});
    this.summary.set([]);
    this.conflict.set(false);
  }

  private async run<T>(work: () => Promise<T>): Promise<T | undefined> {
    this.busy.set(true);
    try {
      return await work();
    } catch (err) {
      const errors = serverFormErrors(err);
      this.serverErrors.set(errors.fields);
      this.summary.set(
        errors.summary.length > 0 || errors.conflict
          ? errors.summary
          : ['We could not save the step. Try again.'],
      );
      this.conflict.set(errors.conflict);
      focusFirstInvalid(this.injector);
      return undefined;
    } finally {
      this.busy.set(false);
    }
  }

  private fill(step: StepDefinitionDetail): void {
    this.title.set(step.title);
    this.description.set(step.description ?? '');
    this.instructions.set(step.instructions ?? '');
    this.documentationUrl.set(step.documentationUrl ?? '');
    this.tags.set([...step.tags]);
  }

  /** The record as the server has it. With `keepEdits` (Deactivate, Activate) the fields of Details keep what the person typed. */
  private apply(step: StepDefinitionDetail, keepEdits = false): void {
    this.original.set(step);
    if (!keepEdits) this.fill(step);
  }

  /** Existing tags that match what was typed, for the tag box (the latest answer wins; failures just offer nothing). */
  protected async suggestTags(text: string): Promise<void> {
    const request = ++this.suggestRequest;
    try {
      const found = await firstValueFrom(
        this.api.listStepTags(text.trim() || undefined, undefined, 12),
      );
      if (request === this.suggestRequest) this.tagSuggestions.set(found.map((t) => t.name));
    } catch {
      if (request === this.suggestRequest) this.tagSuggestions.set([]);
    }
  }
}
