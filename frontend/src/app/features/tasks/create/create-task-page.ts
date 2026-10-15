import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DateInput, DynamicForm, errorSummary } from 'form-engine';
import type { FormDefinition, ServerFieldError } from 'form-engine';
import { Button } from 'primeng/button';
import { firstValueFrom } from 'rxjs';
import {
  CreateTaskRequest,
  FormsClient,
  MatterResponse,
  MattersClient,
  PodSummary,
  PodsClient,
  ProjectResponse,
  ProjectsClient,
  PublishedWorkflowSummary,
  TaskTypeView,
  TaskTypesClient,
  TasksClient,
  UsersLookupClient,
  WorkflowsClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import {
  calendarDayInZone,
  dayIndex,
  parseDateOnly,
  zoneAbbreviation,
  zonedLocalToUtc,
} from '../../../core/time/time';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { MfDatePipe } from '../../../shared/pipes/mf-date.pipe';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { TaskTypeIcon } from '../../../shared/icons/task-type-icon';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { GridNav } from '../../../shared/ui/grid-nav';
import { splitFormErrors } from '../../../shared/ui/custom-fields';
import { EmailIntake, EmailPrefill } from '../../../shared/ui/email-intake';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { PageHeader } from '../../../shared/ui/page-header';
import { PriorityBadge } from '../../../shared/ui/priority-badge';
import { TextField } from '../../../shared/ui/text-field';
import { ErrorReference } from '../../../shared/ui/error-reference';

type LoadState = 'loading' | 'ready' | 'error';
type SchemaState = 'none' | 'loading' | 'ready' | 'error';

export const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20000;
const REQUESTOR_NAME_MAX = 200;
const REQUESTOR_EMAIL_MAX = 254;
/** More types than this and the chooser shows a search box. */
export const TYPE_SEARCH_THRESHOLD = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface WorkflowChoice {
  id: number;
  name: string;
  versionNo: number;
  stepCount: number;
  isOrdered: boolean;
  isDefault: boolean;
}

interface TypeChoice {
  type: TaskTypeView;
  workflows: WorkflowChoice[];
  usable: boolean;
}

const matterOption = (m: MatterResponse): PickerOption => ({
  id: m.matterId,
  label: `${m.matterRef} ${m.name}`,
  inactive: !m.isActive,
});

/**
 * Create Task (UX S09): one page, one call, type first. The page opens on a grid of Task Type cards (icon, name, short description);
 * choosing one reveals the form with the type as a header chip and a "Change type" action. `?taskType=<id>` skips the chooser.
 * The form holds Matter and Project, the request (Title, Description, Task Type, the type's request form,
 * eligible Workflow), who is asking, and priority, due date and assignment (each gated by its own permission). The optional
 * "Quick fill from email" panel only prefills; manual entry always works. Matter, Task Type and Workflow cannot change later, so a
 * summary repeats them before submit.
 */
@Component({
  selector: 'mf-create-task-page',
  imports: [
    ErrorReference,
    Button,
    PageHeader,
    DynamicForm,
    DateInput,
    EmailIntake,
    EntityPicker,
    TextField,
    ConfirmDialog,
    GridNav,
    TaskTypeIcon,
    PriorityBadge,
    MfDatePipe,
  ],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-task-page.html',
  styleUrls: [
    '../../../shared/ui/page.scss',
    '../../../shared/ui/form-field.scss',
    './create-task-page.scss',
  ],
})
export class CreateTaskPage implements HasUnsavedChanges {
  /** Query parameters: prefill the Matter (and Project) when launched from their pages. */
  readonly matterId = input<string>();
  readonly projectId = input<string>();
  /** Query parameter `taskType=<id>`: deep link that skips the type chooser (ignored when it is not a type the user may use). */
  readonly taskType = input<string>();

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly clock = inject(Clock);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly lookups = inject(LookupStore);
  private readonly typesApi = inject(TaskTypesClient);
  private readonly workflowsApi = inject(WorkflowsClient);
  private readonly podsApi = inject(PodsClient);
  private readonly mattersApi = inject(MattersClient);
  private readonly projectsApi = inject(ProjectsClient);
  private readonly formsApi = inject(FormsClient);
  private readonly usersApi = inject(UsersLookupClient);
  private readonly tasksApi = inject(TasksClient);
  private readonly assetContext = inject(AssetPickerContext);

  private readonly summaryBox = viewChild<ElementRef<HTMLElement>>('summaryBox');
  private readonly requestForm = viewChild(DynamicForm);
  private readonly dueDateInput = viewChild(DateInput);

  // --- permissions ------------------------------------------------------------------------------
  protected readonly canCreate = computed(() => this.auth.has('Task.Create'));
  protected readonly canSetPriority = computed(() => this.auth.has('Task.SetPriority'));
  protected readonly canAssign = computed(() => this.auth.has('Task.Assign'));
  protected readonly canListPods = computed(() => this.canAssign() && this.auth.has('Pod.View'));

  // --- reference data ----------------------------------------------------------------------------
  protected readonly state = signal<LoadState>('loading');
  private readonly types = signal<TaskTypeView[]>([]);
  private readonly published = signal<PublishedWorkflowSummary[]>([]);
  protected readonly pods = signal<PodSummary[]>([]);
  protected readonly activePriorities = this.lookups.activePriorities;
  protected readonly defaultPriority = this.lookups.defaultPriority;

  protected readonly typeChoices = computed<TypeChoice[]>(() => {
    const published = this.published();
    return this.types()
      .filter((t) => t.isActive)
      .map((type) => {
        const workflows = published
          .filter((w) => type.eligibleWorkflowIds.includes(w.workflowDefinitionId))
          .map<WorkflowChoice>((w) => ({
            id: w.workflowDefinitionId,
            name: w.name,
            versionNo: w.versionNo,
            stepCount: w.stepCount,
            isOrdered: w.isOrdered,
            isDefault: type.defaultWorkflowDefinitionId === w.workflowDefinitionId,
          }));
        return { type, workflows, usable: type.isUsable && workflows.length > 0 };
      })
      .sort((a, b) => a.type.name.localeCompare(b.type.name));
  });
  /** What the chooser offers: active types the user can actually create Tasks of (published form and at least one eligible workflow). */
  protected readonly usableChoices = computed(() => this.typeChoices().filter((c) => c.usable));
  /** Above this many types the chooser gets a search box. */
  protected readonly searchableAbove = TYPE_SEARCH_THRESHOLD;
  protected readonly showTypeSearch = computed(
    () => this.usableChoices().length > TYPE_SEARCH_THRESHOLD,
  );
  protected readonly typeQuery = signal('');
  /**
   * The types matching every typed word in name or description, best first: matches in the name before description-only ones, word starts
   * before the middle of a word. Hyphens and punctuation are ignored ("dedup" finds "De-duplication"). Ties keep the list order.
   */
  protected readonly shownChoices = computed(() => {
    const words = this.typeQuery().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.usableChoices();
    const squash = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, '');
    const rank = (name: string, description: string): number | null => {
      const nameSquashed = squash(name);
      const nameWords = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const text = `${name} ${description}`;
      const textSquashed = squash(text);
      let total = 0;
      for (const w of words) {
        const ws = squash(w);
        if (nameWords.some((n) => n.startsWith(w)) || nameSquashed.startsWith(ws)) total += 0;
        else if (name.includes(w) || nameSquashed.includes(ws)) total += 1;
        else if (text.includes(w) || textSquashed.includes(ws)) total += 2;
        else return null;
      }
      return total;
    };
    return this.usableChoices()
      .map((c, index) => ({
        c,
        index,
        r: rank(c.type.name.toLowerCase(), (c.type.description ?? '').toLowerCase()),
      }))
      .filter((x) => x.r !== null)
      .sort((x, y) => (x.r as number) - (y.r as number) || x.index - y.index)
      .map((x) => x.c);
  });
  /** Roving tab stop of the card grid: the focused card, else the first shown. */
  protected readonly focusedType = signal<number | null>(null);
  protected readonly cardTabStop = computed(() => {
    const shown = this.shownChoices();
    const focused = this.focusedType();
    return shown.some((c) => c.type.id === focused) ? focused : (shown[0]?.type.id ?? null);
  });

  // --- form state --------------------------------------------------------------------------------
  protected readonly matter = signal<PickerOption | null>(null);
  private readonly matterRecords = new Map<number, MatterResponse>();
  protected readonly projects = signal<ProjectResponse[]>([]);
  protected readonly projectId$ = signal<number | null>(null);
  protected readonly projectCleared = signal(false);
  protected readonly title = signal('');
  protected readonly description = signal('');
  protected readonly typeId = signal<number | null>(null);
  protected readonly workflowId = signal<number | null>(null);
  protected readonly requestorName = signal('');
  protected readonly requestorEmail = signal('');
  protected readonly requestedAt = signal<string | null>(null);
  protected readonly priorityId = signal<number | null>(null);
  protected readonly dueDate = signal('');
  /** The due date field holds text that is not a date (kept visible, reported, and blocks creating the task). */
  protected readonly dueDateBad = signal(false);
  protected readonly dueTime = signal('');
  protected readonly podId = signal<number | null>(null);
  protected readonly assignee = signal<PickerOption | null>(null);
  protected readonly podMembers = signal<ReadonlySet<number> | null>(null);

  // --- request form --------------------------------------------------------------------------------
  protected readonly schemaState = signal<SchemaState>('none');
  protected readonly definition = signal<FormDefinition | null>(null);
  /** Re-seeds the form engine only when replaced (a reset); user edits flow out through `onFormValues`, never back in. */
  protected readonly seed = signal<Record<string, unknown>>({});
  protected readonly formValues = signal<Record<string, unknown>>({});
  protected readonly formErrors = signal<ServerFieldError[]>([]);
  protected readonly confirmTypeOpen = signal(false);

  // --- submit state --------------------------------------------------------------------------------
  protected readonly submitted = signal(false);
  protected readonly busy = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly serverMessage = signal('');
  protected readonly summary = signal<string[]>([]);
  /** True while the summary lists validation problems, which then follow the fields as they are fixed (UAT2-17). */
  private readonly summaryIsLive = signal(false);
  protected readonly emailFilled = signal(false);
  private saved = false;
  private schemaTurn = 0;
  private deepLinkApplied = false;

  // --- derived -------------------------------------------------------------------------------------
  protected readonly selectedChoice = computed(
    () => this.typeChoices().find((c) => c.type.id === this.typeId()) ?? null,
  );
  protected readonly workflows = computed(() => this.selectedChoice()?.workflows ?? []);
  protected readonly selectedWorkflow = computed(
    () => this.workflows().find((w) => w.id === this.workflowId()) ?? null,
  );
  protected readonly matterRecord = computed(() => {
    const m = this.matter();
    return m ? (this.matterRecords.get(m.id) ?? null) : null;
  });
  protected readonly isSensitive = computed(() => this.matterRecord()?.isSensitive === true);
  protected readonly existing = computed(() => ({
    title: this.title(),
    description: this.description(),
    requestorName: this.requestorName(),
    requestorEmail: this.requestorEmail(),
  }));

  protected readonly priorityLabelId = computed(
    () => this.priorityId() ?? this.defaultPriority()?.id ?? null,
  );
  protected readonly zoneLabel = computed(() => {
    const day = parseDateOnly(this.dueDate());
    const time = /^(\d{2}):(\d{2})$/.exec(this.dueTime());
    const at =
      day && time
        ? zonedLocalToUtc({ ...day, hour: +time[1], minute: +time[2] }, this.zone)
        : this.clock.now();
    return zoneAbbreviation(at, this.zone);
  });

  protected readonly pastDue = computed(() => {
    const day = parseDateOnly(this.dueDate());
    if (!day) return false;
    const now = this.clock.now();
    const time = /^(\d{2}):(\d{2})$/.exec(this.dueTime());
    if (time) {
      return zonedLocalToUtc({ ...day, hour: +time[1], minute: +time[2] }, this.zone) < now;
    }
    return dayIndex(day) < dayIndex(calendarDayInZone(now, this.zone));
  });

  protected readonly userNotInPod = computed(() => {
    const user = this.assignee();
    const members = this.podMembers();
    return !!user && this.podId() !== null && members !== null && !members.has(user.id);
  });
  protected readonly podName = computed(
    () => this.pods().find((p) => p.podId === this.podId())?.name ?? 'the selected Pod',
  );

  /** Field errors: required/format problems appear after the first submit attempt, then follow the inputs live. */
  protected readonly clientErrors = computed<Record<string, string>>(() => {
    if (!this.submitted()) return {};
    const errors: Record<string, string> = {};
    if (!this.matter()) errors['matterId'] = 'Select a matter.';
    const title = this.title().trim();
    if (!title) errors['title'] = 'Enter a title.';
    else if (title.length > TITLE_MAX)
      errors['title'] = `Title must be ${TITLE_MAX} characters or fewer.`;
    if (this.description().length > DESCRIPTION_MAX) {
      errors['description'] = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
    }
    if (this.typeId() === null) errors['taskTypeId'] = 'Select a task type.';
    else if (this.workflowId() === null) errors['workflowDefinitionId'] = 'Select a workflow.';
    if (!this.requestorName().trim()) errors['requestorName'] = "Enter the requestor's name.";
    else if (this.requestorName().trim().length > REQUESTOR_NAME_MAX) {
      errors['requestorName'] = `Name must be ${REQUESTOR_NAME_MAX} characters or fewer.`;
    }
    const email = this.requestorEmail().trim();
    if (email && (!EMAIL_PATTERN.test(email) || email.length > REQUESTOR_EMAIL_MAX)) {
      errors['requestorEmail'] = 'Enter a valid email address.';
    }
    if (this.canSetPriority() && this.priorityLabelId() === null) {
      errors['priorityId'] = 'Select a priority.';
    }
    if (this.dueDateBad()) {
      errors['dueDate'] = 'Enter a valid date, for example Oct 12, 2026 or 10/12/2026.';
    } else if (this.dueTime() && !this.dueDate()) {
      errors['dueDate'] = 'Enter a date before adding a time.';
    }
    return errors;
  });

  protected fieldError(key: string): string | null {
    return this.clientErrors()[key] || this.serverErrors()[key] || null;
  }

  constructor() {
    void this.load();

    // `?taskType=<id>` skips the chooser, once the types are known.
    effect(() => {
      const wanted = Number(this.taskType());
      const ready = this.state() === 'ready';
      untracked(() => {
        if (!ready || this.deepLinkApplied || !Number.isInteger(wanted) || wanted <= 0) return;
        this.deepLinkApplied = true;
        if (this.typeId() === null && this.usableChoices().some((c) => c.type.id === wanted)) {
          this.applyType(wanted);
        }
      });
    });

    // Prefill from the Matter / Project the user came from.
    effect(() => {
      const matterId = Number(this.matterId());
      const projectId = Number(this.projectId());
      untracked(() => void this.prefillContext(matterId, projectId));
    });

    // After a failed submit the summary drops each problem as the person fixes it, and disappears when none is left.
    effect(() => {
      const errors = Object.values(this.clientErrors());
      const evaluation = this.requestForm()?.evaluation();
      const fields = this.definition()?.fields ?? [];
      untracked(() => {
        if (!this.summaryIsLive()) return;
        const lines = [...errors, ...(evaluation ? errorSummary(fields, evaluation.errors) : [])];
        if (this.schemaState() === 'loading' || this.schemaState() === 'error') {
          lines.push(...this.summary().filter((m) => m.startsWith('The request details have not')));
        }
        this.summary.set(lines);
        if (lines.length === 0) this.summaryIsLive.set(false);
      });
    });

    // The Asset picker of ASSET_REF request fields offers the assets of the chosen Matter only.
    effect(() => {
      const picked = this.matter();
      untracked(() => this.assetContext.matterId.set(picked?.id ?? null));
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    return (
      this.title().trim() !== '' ||
      this.description().trim() !== '' ||
      this.requestorName().trim() !== '' ||
      this.requestorEmail().trim() !== '' ||
      Object.keys(this.formValues()).length > 0 ||
      this.dueDate() !== '' ||
      this.podId() !== null ||
      this.assignee() !== null ||
      this.emailFilled()
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  // --- loading ---------------------------------------------------------------------------------------

  protected async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [types, workflows, pods] = await Promise.all([
        firstValueFrom(this.typesApi.listTaskTypes()),
        firstValueFrom(this.workflowsApi.listPublishedWorkflows()),
        this.canListPods()
          ? firstValueFrom(this.podsApi.listPods(undefined, true, 1, 100, 'name')).catch(() => null)
          : Promise.resolve(null),
        this.lookups.ensureLoaded(),
      ]);
      this.types.set(types);
      this.published.set(workflows);
      this.pods.set(pods?.items ?? []);
      if (this.lookups.state() === 'error') throw new Error('priorities');
      if (this.priorityId() === null) this.priorityId.set(this.defaultPriority()?.id ?? null);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private async prefillContext(matterId: number, projectId: number): Promise<void> {
    const validMatter = Number.isInteger(matterId) && matterId > 0;
    const validProject = Number.isInteger(projectId) && projectId > 0;
    if (!validMatter && !validProject) return;
    try {
      let project: ProjectResponse | null = null;
      if (validProject) project = await firstValueFrom(this.projectsApi.getProject(projectId));
      const id = project ? project.matterId : matterId;
      const record = await firstValueFrom(this.mattersApi.getMatter(id));
      this.matterRecords.set(record.matterId, record);
      if (!record.isActive) {
        this.serverErrors.update((e) => ({
          ...e,
          matterId: 'This matter is inactive. Choose an active matter.',
        }));
        return;
      }
      this.matter.set(matterOption(record));
      await this.loadProjects(record.matterId);
      if (project && project.isActive) this.projectId$.set(project.projectId);
    } catch {
      // The pickers simply stay empty; the user can search.
    }
  }

  private async loadProjects(matterId: number): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.projectsApi.listProjects(undefined, matterId, true, 1, 100, undefined),
      );
      if (this.matter()?.id === matterId) this.projects.set(page.items);
    } catch {
      this.projects.set([]);
    }
  }

  // --- pickers ---------------------------------------------------------------------------------------

  protected readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.mattersApi.listMatters(query || undefined, undefined, true, undefined, 1, 8, undefined),
    );
    for (const m of page.items) this.matterRecords.set(m.matterId, m);
    return page.items.map(matterOption);
  };

  protected readonly searchUsers = async (query: string): Promise<PickerOption[]> => {
    const found = await firstValueFrom(this.usersApi.lookupUsers(query || undefined, 8));
    return found.map((u) => ({ id: u.userId, label: u.displayName }));
  };

  protected onMatterPicked(option: PickerOption | null): void {
    const previous = this.matter();
    this.matter.set(option);
    if (previous?.id === option?.id) return;
    this.serverErrors.update((e) => ({ ...e, matterId: '' }));
    const hadProject = this.projectId$() !== null;
    this.projectId$.set(null);
    this.projects.set([]);
    this.projectCleared.set(hadProject);
    this.clearAssetValues();
    if (option) void this.loadProjects(option.id);
  }

  /** ASSET_REF values belong to the previous Matter's assets; drop them when the Matter changes. */
  private clearAssetValues(): void {
    const definition = this.definition();
    if (!definition) return;
    const assetKeys = definition.fields.filter((f) => f.control === 'ASSET_REF').map((f) => f.key);
    const values = this.formValues();
    if (!assetKeys.some((k) => k in values)) return;
    const rest = Object.fromEntries(Object.entries(values).filter(([k]) => !assetKeys.includes(k)));
    this.formValues.set(rest);
    this.seed.set({ ...rest });
  }

  protected onProjectChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.projectId$.set(value ? Number(value) : null);
    this.projectCleared.set(false);
  }

  // --- task type, workflow, request form -------------------------------------------------------------------

  /** A card was chosen: the form appears, with the type as its header chip. */
  protected chooseType(id: number): void {
    if (id === this.typeId()) return;
    this.applyType(id);
    this.typeQuery.set('');
    setTimeout(() => document.getElementById('ct-matter')?.focus());
  }

  /** "Change type": back to the chooser. Values entered in the type's request form are lost, so ask first when there are any. */
  protected changeType(): void {
    if (Object.keys(this.formValues()).length > 0) {
      this.confirmTypeOpen.set(true);
      return;
    }
    this.backToChooser();
  }

  protected confirmTypeChange(): void {
    this.confirmTypeOpen.set(false);
    this.backToChooser();
  }

  private backToChooser(): void {
    this.applyType(null);
    this.focusedType.set(null);
    setTimeout(() =>
      document.querySelector<HTMLElement>('[data-type-card][tabindex="0"]')?.focus(),
    );
  }

  private applyType(id: number | null): void {
    this.typeId.set(id);
    this.formValues.set({});
    this.seed.set({});
    this.formErrors.set([]);
    this.serverErrors.update((e) => ({
      ...e,
      taskTypeId: '',
      workflowDefinitionId: '',
      formValues: '',
    }));
    const choice = this.typeChoices().find((c) => c.type.id === id) ?? null;
    const workflows = choice?.workflows ?? [];
    const preferred =
      workflows.find((w) => w.isDefault) ?? (workflows.length === 1 ? workflows[0] : null);
    this.workflowId.set(preferred?.id ?? null);
    void this.loadSchema(choice?.type ?? null);
  }

  protected async loadSchema(
    type: TaskTypeView | null = this.selectedChoice()?.type ?? null,
  ): Promise<void> {
    const turn = ++this.schemaTurn;
    this.definition.set(null);
    const versionId = type?.hasFormFields ? type.publishedFormVersionId : undefined;
    if (versionId === undefined || versionId === null) {
      this.schemaState.set('none');
      return;
    }
    this.schemaState.set('loading');
    try {
      const detail = await firstValueFrom(this.formsApi.getFormVersionSchema(versionId));
      if (turn !== this.schemaTurn) return;
      const definition = toFormDefinition(detail);
      this.definition.set(definition.fields.length > 0 ? definition : null);
      this.schemaState.set(definition.fields.length > 0 ? 'ready' : 'none');
    } catch {
      if (turn === this.schemaTurn) this.schemaState.set('error');
    }
  }

  protected onFormValues(values: Record<string, unknown>): void {
    this.formValues.set(values);
  }

  protected onWorkflowPicked(id: number): void {
    this.workflowId.set(id);
    this.serverErrors.update((e) => ({ ...e, workflowDefinitionId: '' }));
  }

  // --- other inputs --------------------------------------------------------------------------------------

  protected onPriorityChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.priorityId.set(value ? Number(value) : null);
  }

  protected onDueTime(event: Event): void {
    this.dueTime.set((event.target as HTMLInputElement).value);
  }

  protected clearDue(): void {
    this.dueDate.set('');
    this.dueTime.set('');
  }

  protected onPodChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const id = value ? Number(value) : null;
    this.podId.set(id);
    this.podMembers.set(null);
    if (id !== null) void this.loadPodMembers(id);
  }

  private async loadPodMembers(podId: number): Promise<void> {
    try {
      const detail = await firstValueFrom(this.podsApi.getPod(podId));
      if (this.podId() === podId) this.podMembers.set(new Set(detail.members.map((m) => m.userId)));
    } catch {
      // No membership information: no warning.
    }
  }

  protected applyPrefill(prefill: EmailPrefill): void {
    if (prefill.title !== undefined) this.title.set(prefill.title);
    if (prefill.description !== undefined) this.description.set(prefill.description);
    if (prefill.requestorName !== undefined) this.requestorName.set(prefill.requestorName);
    if (prefill.requestorEmail !== undefined) this.requestorEmail.set(prefill.requestorEmail);
    if (prefill.requestedAt !== undefined) this.requestedAt.set(prefill.requestedAt);
    this.emailFilled.set(true);
  }

  // --- submit ----------------------------------------------------------------------------------------------

  protected async submit(addAnother = false): Promise<void> {
    if (this.busy()) return;
    this.submitted.set(true);
    this.serverErrors.set({});
    this.serverMessage.set('');
    this.formErrors.set([]);
    this.summary.set([]);

    const problems = Object.values(this.clientErrors());
    let formInvalid = false;
    const form = this.requestForm();
    if (form && this.definition()) {
      const evaluation = form.validate();
      formInvalid = evaluation.errors.length > 0;
      if (formInvalid) {
        const lines = errorSummary(this.definition()?.fields ?? [], evaluation.errors);
        problems.push(
          ...(lines.length > 0 ? lines : ['Complete the highlighted request details.']),
        );
      }
    }
    if (this.schemaState() === 'loading' || this.schemaState() === 'error') {
      problems.push('The request details have not loaded. Retry them before creating the task.');
    }
    if (problems.length > 0) {
      this.summaryIsLive.set(true);
      this.summary.set(problems);
      this.focusSummary();
      return;
    }

    this.busy.set(true);
    try {
      const created = await firstValueFrom(this.tasksApi.createTask(this.buildRequest()));
      this.saved = true;
      this.notify.success(`Task ${created.taskNumber} created`);
      if (addAnother) {
        this.resetForAnother();
        return;
      }
      await this.router.navigateByUrl(`/tasks/${created.taskId}`);
    } catch (err) {
      this.showServerError(err);
    } finally {
      this.busy.set(false);
    }
  }

  private buildRequest(): CreateTaskRequest {
    const evaluation = this.definition() ? this.requestForm()?.evaluation() : undefined;
    const email = this.requestorEmail().trim();
    const description = this.description().trim();
    const date = this.dueDate();
    const user = this.canAssign() ? this.assignee() : null;
    return {
      matterId: this.matter()!.id,
      projectId: this.projectId$() ?? undefined,
      taskTypeId: this.typeId()!,
      workflowDefinitionId: this.workflowId()!,
      title: this.title().trim(),
      description: description || undefined,
      requestorName: this.requestorName().trim(),
      requestorEmail: email || undefined,
      requestedAtUtc: this.requestedAt() ?? undefined,
      priorityId: this.canSetPriority() ? (this.priorityLabelId() ?? undefined) : undefined,
      dueDate: date || undefined,
      dueTime: date && this.dueTime() ? this.dueTime() : undefined,
      assignedPodId: this.canAssign() ? (this.podId() ?? undefined) : undefined,
      assignedUserId: user?.id,
      formValues: evaluation ? evaluation.normalized : undefined,
    };
  }

  private showServerError(err: unknown): void {
    const errors = serverFormErrors(err);
    const split = splitFormErrors(errors.fields);
    this.serverErrors.set(split.base);
    this.formErrors.set(split.form);

    const messages = [...errors.summary];
    if (messages.length === 0) {
      messages.push(
        err instanceof ApiError && err.status !== 0
          ? err.message
          : "We couldn't create the task. Check your connection and try again.",
      );
    }
    if (err instanceof ApiError && err.status === 409) this.serverMessage.set(err.message);
    this.summaryIsLive.set(false);
    this.summary.set(messages);
    this.focusSummary();
  }

  private focusSummary(): void {
    setTimeout(() => this.summaryBox()?.nativeElement.focus());
  }

  /** "Create and add another": keeps Matter, Project, Priority and Pod (UAT-S09-15). */
  private resetForAnother(): void {
    this.saved = false;
    this.submitted.set(false);
    this.title.set('');
    this.description.set('');
    this.requestorName.set('');
    this.requestorEmail.set('');
    this.requestedAt.set(null);
    this.emailFilled.set(false);
    this.dueDate.set('');
    this.dueDateInput()?.clear();
    this.dueTime.set('');
    this.assignee.set(null);
    this.applyType(this.typeId()); // the same type again, with an empty request form
    this.summary.set([]);
    setTimeout(() => document.getElementById('ct-title')?.focus());
  }

  protected cancel(): void {
    void this.router.navigateByUrl('/tasks');
  }
}
