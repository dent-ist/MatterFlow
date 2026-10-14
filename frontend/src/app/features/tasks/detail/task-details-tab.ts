import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DynamicForm, FormDefinition, ServerFieldError, errorSummary } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  FormsClient,
  PodMemberDto,
  PodSummary,
  PodsClient,
  ProjectResponse,
  ProjectsClient,
  TasksClient,
  UsersLookupClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { LookupStore } from '../../../core/lookups/lookup-store';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { DueLabelPipe } from '../../../shared/pipes/due-label.pipe';
import { LocalTimePipe } from '../../../shared/pipes/local-time.pipe';
import { Clock, USER_TIME_ZONE } from '../../../core/time/clock';
import {
  calendarDayInZone,
  dayIndex,
  parseDateOnly,
  zoneAbbreviation,
  zonedLocalToUtc,
} from '../../../core/time/time';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { splitFormErrors } from '../../../shared/ui/custom-fields';
import { TaskDetailStore } from './task-detail.store';
import { valuesPatch } from './task-step';

interface EditModel {
  title: string;
  description: string;
  requestorName: string;
  requestorEmail: string;
  projectId: number | null;
  priorityId: number;
  dueDate: string;
  dueTime: string;
  podId: number | null;
  userId: number | null;
}

interface Option {
  id: number;
  label: string;
}

const LOCK_TEXT =
  "Can't be changed after creation. To correct it, cancel this task and create a new one.";

const toNumber = (v: string): number | null => (v === '' ? null : Number(v));

/**
 * Details tab (UX S10): read view with the request-form values, and an edit mode for title, description, requestor, project,
 * priority, due date and time (local time zone), Pod and assignee, and the request form under the version the Task was
 * created with. Matter, Task Type and Workflow are shown read-only. Server field errors are mapped back onto the fields.
 */
@Component({
  selector: 'mf-task-details-tab',
  imports: [DynamicForm, LocalTimePipe, DueLabelPipe, EntityPicker],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', '../../../shared/ui/form-field.scss'],
  template: `
    @if (store.task(); as t) {
      <section aria-labelledby="details-h" data-details-tab>
        <div class="dt__head">
          <h2 id="details-h" class="dt__title">Details</h2>
          @if (!editing() && t.allowedActions.canEdit) {
            <button type="button" class="mf-btn" data-edit-details (click)="startEdit()">
              Edit details
            </button>
          }
        </div>

        @if (store.closed()) {
          <p class="pg-muted" data-readonly-note>
            This task is {{ t.statusLabel }}. Reopen it to edit.
          </p>
        }

        @if (editing()) {
          <form class="dt__form" novalidate (submit)="save($event)" data-edit-form>
            @if (summary().length > 0) {
              <div class="pg-summary" role="alert" tabindex="-1" data-error-summary>
                <strong>Fix these before saving:</strong>
                <ul>
                  @for (m of summary(); track m) {
                    <li>{{ m }}</li>
                  }
                </ul>
              </div>
            }

            <div class="mf-field">
              <label class="mf-field__label" for="td-title"
                >Title <span class="mf-field__req">(required)</span></label
              >
              <input
                id="td-title"
                class="mf-field__input"
                type="text"
                maxlength="200"
                [value]="model().title"
                [attr.aria-invalid]="err('title') ? 'true' : null"
                [attr.aria-describedby]="err('title') ? 'td-title-error' : null"
                (input)="set('title', $any($event.target).value)"
              />
              @if (err('title'); as e) {
                <p class="mf-field__error" id="td-title-error" role="alert">{{ e }}</p>
              }
            </div>

            <div class="mf-field">
              <label class="mf-field__label" for="td-description">Description</label>
              <textarea
                id="td-description"
                class="mf-field__input"
                rows="5"
                maxlength="20000"
                [value]="model().description"
                [attr.aria-invalid]="err('description') ? 'true' : null"
                [attr.aria-describedby]="err('description') ? 'td-description-error' : null"
                (input)="set('description', $any($event.target).value)"
              ></textarea>
              @if (err('description'); as e) {
                <p class="mf-field__error" id="td-description-error" role="alert">{{ e }}</p>
              }
            </div>

            <div class="mf-field">
              <label class="mf-field__label" for="td-req-name"
                >Requestor name <span class="mf-field__req">(required)</span></label
              >
              <input
                id="td-req-name"
                class="mf-field__input"
                type="text"
                maxlength="200"
                [value]="model().requestorName"
                [attr.aria-invalid]="err('requestorName') ? 'true' : null"
                [attr.aria-describedby]="err('requestorName') ? 'td-req-name-error' : null"
                (input)="set('requestorName', $any($event.target).value)"
              />
              @if (err('requestorName'); as e) {
                <p class="mf-field__error" id="td-req-name-error" role="alert">{{ e }}</p>
              }
            </div>

            <div class="mf-field">
              <label class="mf-field__label" for="td-req-email">Requestor email</label>
              <input
                id="td-req-email"
                class="mf-field__input"
                type="email"
                maxlength="254"
                [value]="model().requestorEmail"
                [attr.aria-invalid]="err('requestorEmail') ? 'true' : null"
                [attr.aria-describedby]="err('requestorEmail') ? 'td-req-email-error' : null"
                (input)="set('requestorEmail', $any($event.target).value)"
              />
              @if (err('requestorEmail'); as e) {
                <p class="mf-field__error" id="td-req-email-error" role="alert">{{ e }}</p>
              }
            </div>

            <div class="mf-field">
              <label class="mf-field__label" for="td-project">Project</label>
              <select
                id="td-project"
                class="mf-field__input"
                [value]="model().projectId ?? ''"
                [attr.aria-invalid]="err('projectId') ? 'true' : null"
                (change)="set('projectId', toNumber($any($event.target).value))"
              >
                <option value="" [selected]="model().projectId === null">No project</option>
                @for (p of projectOptions(); track p.id) {
                  <option [value]="p.id" [selected]="model().projectId === p.id">
                    {{ p.label }}
                  </option>
                }
              </select>
              <p class="mf-field__help">Only projects of the same matter.</p>
              @if (err('projectId'); as e) {
                <p class="mf-field__error" role="alert">{{ e }}</p>
              }
            </div>

            @if (t.allowedActions.canSetPriority || t.priority.priorityId !== model().priorityId) {
              <div class="mf-field">
                <label class="mf-field__label" for="td-priority">Priority</label>
                <select
                  id="td-priority"
                  class="mf-field__input"
                  [disabled]="!t.allowedActions.canSetPriority"
                  (change)="set('priorityId', +$any($event.target).value)"
                >
                  @for (p of priorityOptions(); track p.id) {
                    <option [value]="p.id" [selected]="model().priorityId === p.id">
                      {{ p.label }}
                    </option>
                  }
                </select>
              </div>
            }

            <fieldset class="dt__due">
              <legend class="mf-field__label">Due</legend>
              <div class="dt__due-row">
                <div class="mf-field">
                  <label class="mf-field__label" for="td-due-date">Date</label>
                  <input
                    id="td-due-date"
                    class="mf-field__input"
                    type="date"
                    [value]="model().dueDate"
                    [attr.aria-invalid]="err('dueDate') ? 'true' : null"
                    (input)="set('dueDate', $any($event.target).value)"
                  />
                  @if (err('dueDate'); as e) {
                    <p class="mf-field__error" role="alert">{{ e }}</p>
                  }
                </div>
                <div class="mf-field">
                  <label class="mf-field__label" for="td-due-time">Time ({{ zoneName() }})</label>
                  <input
                    id="td-due-time"
                    class="mf-field__input"
                    type="time"
                    [value]="model().dueTime"
                    [attr.aria-invalid]="err('dueTime') ? 'true' : null"
                    (input)="set('dueTime', $any($event.target).value)"
                  />
                  @if (err('dueTime'); as e) {
                    <p class="mf-field__error" role="alert">{{ e }}</p>
                  }
                </div>
              </div>
              <p class="mf-field__help">
                Leave the date empty for ASAP. The time is optional and is in your local time zone.
              </p>
              @if (pastDue()) {
                <p class="warn" role="status" data-past-due>
                  <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                  This date has already passed. The task will be overdue. You can still save.
                </p>
              }
            </fieldset>

            @if (t.allowedActions.canAssign) {
              <div class="mf-field">
                <label class="mf-field__label" for="td-pod">Pod</label>
                <select
                  id="td-pod"
                  class="mf-field__input"
                  (change)="set('podId', toNumber($any($event.target).value))"
                >
                  <option value="" [selected]="model().podId === null">No pod</option>
                  @for (p of podOptions(); track p.id) {
                    <option [value]="p.id" [selected]="model().podId === p.id">
                      {{ p.label }}
                    </option>
                  }
                </select>
              </div>
              <mf-entity-picker
                inputId="td-assignee"
                label="Assignee"
                placeholder="Search users"
                help="Any active user can be assigned, not only members of the Pod. Clear the choice to leave the task unassigned."
                [search]="searchUsers"
                [selected]="assignee()"
                (selectedChange)="onAssignee($event)"
              />
              @if (notInPod()) {
                <p class="mf-field__help warn" id="td-assignee-warning" data-pod-warning>
                  <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                  This person isn't a member of the selected Pod. You can still save.
                </p>
              }
            }

            @if (schema(); as definition) {
              <fieldset class="dt__request">
                <legend class="mf-field__label">
                  Request details ({{ t.taskType.name }}, form version {{ t.formVersionNo }})
                </legend>
                <mf-dynamic-form
                  [definition]="definition"
                  [values]="formValues()"
                  [serverErrors]="formErrors()"
                  (valuesChange)="onFormValues()"
                />
              </fieldset>
            }

            <div class="dt__actions">
              <button
                type="submit"
                class="mf-btn mf-btn--primary"
                data-save
                [disabled]="store.busy()"
              >
                Save changes
              </button>
              <button
                type="button"
                class="mf-btn"
                data-cancel
                [disabled]="store.busy()"
                (click)="cancelEdit()"
              >
                Cancel
              </button>
            </div>
          </form>
        } @else {
          <dl class="pg-dl" data-view>
            <dt>Title</dt>
            <dd>{{ t.title }}</dd>
            <dt>Description</dt>
            <dd class="pre">{{ t.description || 'Not provided' }}</dd>
            <dt>Requestor</dt>
            <dd>
              {{ t.requestorName }}
              @if (t.requestorEmail) {
                &lt;<a class="pg-link" [href]="'mailto:' + t.requestorEmail">{{
                  t.requestorEmail
                }}</a
                >&gt;
              }
            </dd>
            @if (t.requestedAtUtc) {
              <dt>Request sent</dt>
              <dd>{{ t.requestedAtUtc | localTime }}</dd>
            }
            <dt>Project</dt>
            <dd>{{ t.project?.name ?? 'No project' }}</dd>
            <dt>Priority</dt>
            <dd>{{ t.priority.label }}</dd>
            <dt>Due</dt>
            <dd>{{ { dueDate: t.dueDate, dueAtUtc: t.dueAtUtc } | dueLabel: t.status }}</dd>
            <dt>Pod</dt>
            <dd>{{ t.assignedPod?.name ?? 'No pod' }}</dd>
            <dt>Assignee</dt>
            <dd>{{ t.assignedUser?.displayName ?? 'Unassigned' }}</dd>
            <dt>Created</dt>
            <dd>{{ t.createdBy?.displayName ?? 'Unknown' }}, {{ t.createdAtUtc | localTime }}</dd>
            @if (t.modifiedAtUtc) {
              <dt>Last updated</dt>
              <dd>{{ t.modifiedAtUtc | localTime }}</dd>
            }
          </dl>

          @if (schema(); as definition) {
            <section class="dt__request" aria-labelledby="td-request-h" data-request-form>
              <h3 id="td-request-h" class="dt__sub">
                Request details ({{ t.taskType.name }}, form version {{ t.formVersionNo }})
              </h3>
              <mf-dynamic-form
                [definition]="definition"
                [values]="formValues()"
                [readOnly]="true"
              />
            </section>
          }
        }

        <section class="dt__locked" aria-labelledby="td-locked-h" data-locked-fields>
          <h3 id="td-locked-h" class="dt__sub">
            <i class="pi pi-lock" aria-hidden="true"></i> Task type, workflow and matter
          </h3>
          <dl class="pg-dl">
            <dt>Matter</dt>
            <dd>{{ t.matter.matterRef }} {{ t.matter.name }}</dd>
            <dt>Task type</dt>
            <dd>{{ t.taskType.name }}</dd>
            <dt>Workflow</dt>
            <dd>{{ t.workflow.workflowName }} v{{ t.workflow.versionNo }}</dd>
          </dl>
          <p class="pg-muted" data-lock-text>{{ lockText }}</p>
        </section>
      </section>
    }
  `,
  styles: `
    .dt__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--mf-s3);
      margin-bottom: var(--mf-s3);
    }
    .dt__title {
      margin: 0;
      font-size: var(--mf-fs-h3);
    }
    .dt__sub {
      margin: var(--mf-s4) 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .dt__form {
      display: grid;
      gap: var(--mf-s4);
      max-width: 640px;
    }
    .dt__due,
    .dt__request {
      margin: 0;
      padding: 0;
      border: 0;
    }
    .dt__due-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s4);
    }
    .dt__actions {
      display: flex;
      gap: var(--mf-s2);
    }
    .pre {
      white-space: pre-wrap;
    }
    .warn {
      color: var(--mf-warning);
    }
  `,
})
export class TaskDetailsTab {
  protected readonly store = inject(TaskDetailStore);
  private readonly tasks = inject(TasksClient);
  private readonly forms = inject(FormsClient);
  private readonly projectsApi = inject(ProjectsClient);
  private readonly podsApi = inject(PodsClient);
  private readonly usersApi = inject(UsersLookupClient);
  private readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly notify = inject(NotificationService);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);
  private readonly dynamicForm = viewChild(DynamicForm);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly lockText = LOCK_TEXT;
  protected readonly toNumber = toNumber;
  protected readonly editing = this.store.editing;

  protected readonly schema = signal<FormDefinition | null>(null);
  protected readonly model = signal<EditModel>(this.emptyModel());
  private original: EditModel = this.emptyModel();
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly formErrors = signal<ServerFieldError[]>([]);
  protected readonly summary = signal<string[]>([]);

  protected readonly projects = signal<ProjectResponse[]>([]);
  protected readonly pods = signal<PodSummary[]>([]);
  protected readonly podMembers = signal<PodMemberDto[] | null>(null);
  protected readonly assignee = signal<PickerOption | null>(null);

  protected readonly formValues = computed(
    () => (this.store.task()?.formValues ?? {}) as Record<string, unknown>,
  );
  protected readonly zoneName = computed(() => zoneAbbreviation(new Date(), this.zone));

  protected readonly projectOptions = computed<Option[]>(() => {
    const current = this.store.task()?.project;
    const list = this.projects()
      .filter((p) => p.isActive || p.projectId === current?.projectId)
      .map((p) => ({ id: p.projectId, label: p.name }));
    if (current && !list.some((o) => o.id === current.projectId)) {
      list.unshift({ id: current.projectId, label: current.name });
    }
    return list;
  });

  protected readonly priorityOptions = computed<Option[]>(() => {
    const current = this.store.task()?.priority;
    const list = this.lookups.activePriorities().map((p) => ({ id: p.id, label: p.label }));
    if (current && !list.some((o) => o.id === current.priorityId)) {
      list.push({ id: current.priorityId, label: current.label });
    }
    return list;
  });

  protected readonly podOptions = computed<Option[]>(() => {
    const current = this.store.task()?.assignedPod;
    const list = this.pods()
      .filter((p) => p.isActive || p.podId === current?.podId)
      .map((p) => ({ id: p.podId, label: p.name }));
    if (current && !list.some((o) => o.id === current.podId)) {
      list.push({ id: current.podId, label: current.name });
    }
    return list;
  });

  /** Non-blocking (UAT2-16): the chosen due date or time is already in the past. */
  protected readonly pastDue = computed(() => {
    const m = this.model();
    const day = parseDateOnly(m.dueDate);
    if (!day) return false;
    // Only when the person set it: an already overdue task is not nagged about its unchanged date.
    if (m.dueDate === this.original.dueDate && m.dueTime === this.original.dueTime) return false;
    const now = this.clock.now();
    const time = /^(\d{2}):(\d{2})$/.exec(m.dueTime);
    if (time) {
      return zonedLocalToUtc({ ...day, hour: +time[1], minute: +time[2] }, this.zone) < now;
    }
    return dayIndex(day) < dayIndex(calendarDayInZone(now, this.zone));
  });

  private readonly selectedPodId = computed(() => this.model().podId);

  /** Non-blocking: the chosen user is not a member of the chosen Pod. */
  protected readonly notInPod = computed(() => {
    const m = this.model();
    const members = this.podMembers();
    return (
      m.podId !== null &&
      m.userId !== null &&
      members !== null &&
      !members.some((x) => x.userId === m.userId)
    );
  });

  constructor() {
    // The request form's asset picker offers the assets of the task's own matter.
    const pickerContext = inject(AssetPickerContext);
    effect(() => pickerContext.matterId.set(this.store.task()?.matter.matterId ?? null));
    effect(() => {
      const id = this.store.task()?.formVersionId;
      untracked(() => void this.loadSchema(id));
    });
    effect(() => {
      if (this.store.editing()) untracked(() => this.beginEdit());
    });
    effect(() => {
      const podId = this.selectedPodId();
      untracked(() => {
        if (this.store.editing()) void this.loadMembers(podId);
      });
    });
  }

  private emptyModel(): EditModel {
    return {
      title: '',
      description: '',
      requestorName: '',
      requestorEmail: '',
      projectId: null,
      priorityId: 0,
      dueDate: '',
      dueTime: '',
      podId: null,
      userId: null,
    };
  }

  private async loadSchema(id: number | undefined): Promise<void> {
    if (id == null) {
      this.schema.set(null);
      return;
    }
    try {
      const detail = await firstValueFrom(this.forms.getFormVersionSchema(id));
      const definition = toFormDefinition(detail);
      this.schema.set(definition.fields.length > 0 ? definition : null);
    } catch {
      this.schema.set(null);
    }
  }

  protected startEdit(): void {
    this.store.editing.set(true);
  }

  private beginEdit(): void {
    const t = this.store.task();
    if (!t) return;
    const m: EditModel = {
      title: t.title,
      description: t.description ?? '',
      requestorName: t.requestorName,
      requestorEmail: t.requestorEmail ?? '',
      projectId: t.project?.projectId ?? null,
      priorityId: t.priority.priorityId,
      dueDate: t.dueDate ?? '',
      dueTime: t.dueTime ?? '',
      podId: t.assignedPod?.podId ?? null,
      userId: t.assignedUser?.userId ?? null,
    };
    this.original = m;
    this.model.set(m);
    this.assignee.set(
      t.assignedUser
        ? {
            id: t.assignedUser.userId,
            label: t.assignedUser.isActive
              ? t.assignedUser.displayName
              : `${t.assignedUser.displayName} (inactive)`,
          }
        : null,
    );
    void this.loadMembers(m.podId);
    this.fieldErrors.set({});
    this.formErrors.set([]);
    this.summary.set([]);
    this.store.dirty.set(false);
    void this.loadOptions(t.matter.matterId);
  }

  private async loadOptions(matterId: number): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.auth.has('Project.View')) {
      tasks.push(
        firstValueFrom(
          this.projectsApi.listProjects(undefined, matterId, undefined, 1, 100, 'name'),
        )
          .then((r) => this.projects.set(r.items ?? []))
          .catch(() => undefined),
      );
    }
    if (this.store.task()?.allowedActions.canAssign) {
      if (this.auth.has('Pod.View')) {
        tasks.push(
          firstValueFrom(this.podsApi.listPods(undefined, true, 1, 100, 'name'))
            .then((r) => this.pods.set(r.items ?? []))
            .catch(() => undefined),
        );
      }
    }
    await Promise.all(tasks);
  }

  private async loadMembers(podId: number | null): Promise<void> {
    if (podId === null || !this.auth.has('Pod.View')) {
      this.podMembers.set(null);
      return;
    }
    try {
      this.podMembers.set((await firstValueFrom(this.podsApi.getPod(podId))).members);
    } catch {
      this.podMembers.set(null);
    }
  }

  protected set<K extends keyof EditModel>(key: K, value: EditModel[K]): void {
    this.model.update((m) => ({ ...m, [key]: value }));
    this.store.dirty.set(true);
    this.fieldErrors.update((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  /** Any active user, as in Create Task (`GET /users/lookup`, needs Task.Assign), not just the Pod's members. */
  protected readonly searchUsers = async (query: string): Promise<PickerOption[]> => {
    const found = await firstValueFrom(this.usersApi.lookupUsers(query || undefined, 8));
    return found.map((u) => ({ id: u.userId, label: u.displayName }));
  };

  protected onAssignee(option: PickerOption | null): void {
    this.assignee.set(option);
    this.set('userId', option?.id ?? null);
  }

  protected onFormValues(): void {
    this.store.dirty.set(true);
  }

  protected err(key: string): string | null {
    return this.fieldErrors()[key] ?? null;
  }

  protected cancelEdit(): void {
    this.store.editing.set(false);
    this.store.dirty.set(false);
    this.fieldErrors.set({});
    this.summary.set([]);
  }

  private validate(): Record<string, string> {
    const m = this.model();
    const errors: Record<string, string> = {};
    if (!m.title.trim()) errors['title'] = 'Enter a title.';
    if (!m.requestorName.trim()) errors['requestorName'] = 'Enter the requestor name.';
    if (m.requestorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.requestorEmail.trim())) {
      errors['requestorEmail'] = 'Enter a valid email address.';
    }
    if (m.dueTime && !m.dueDate) errors['dueDate'] = 'Choose a date for the due time.';
    return errors;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const task = this.store.task();
    if (!task) return;
    const errors = this.validate();
    const form = this.dynamicForm();
    let formPatch: Record<string, unknown> | undefined;
    let formInvalid = false;
    let formLines: string[] = [];
    if (form && this.schema()) {
      const evaluation = form.validate();
      if (evaluation.errors.length > 0) {
        formInvalid = true;
        formLines = errorSummary(this.schema()?.fields ?? [], evaluation.errors);
      } else {
        formPatch = valuesPatch(
          this.formValues(),
          evaluation.normalized ?? {},
          new Set((this.schema()?.fields ?? []).map((f) => f.key)),
        );
      }
    }
    this.fieldErrors.set(errors);
    if (Object.keys(errors).length > 0 || formInvalid) {
      this.summary.set(
        Object.values(errors).concat(
          formInvalid ? (formLines.length > 0 ? formLines : ['Fix the request details.']) : [],
        ),
      );
      this.focusSummary();
      return;
    }
    this.summary.set([]);

    const m = this.model();
    const result = await this.store.act((t) =>
      this.tasks.updateTask(t.taskId, {
        rowVersion: t.rowVersion,
        projectId: m.projectId ?? undefined,
        title: m.title.trim(),
        description: m.description.trim() || undefined,
        requestorName: m.requestorName.trim(),
        requestorEmail: m.requestorEmail.trim() || undefined,
        requestedAtUtc: t.requestedAtUtc,
        priorityId: m.priorityId !== t.priority.priorityId ? m.priorityId : undefined,
        dueDate: m.dueDate || undefined,
        dueTime: m.dueDate && m.dueTime ? m.dueTime : undefined,
        formValues: formPatch,
      }),
    );
    if (!result.ok) {
      this.showServerErrors(result.error);
      return;
    }

    const o = this.original;
    if (
      result.task.allowedActions.canAssign !== false &&
      (m.podId !== o.podId || m.userId !== o.userId)
    ) {
      const assigned = await this.store.act((t) =>
        this.tasks.assignTask(t.taskId, {
          rowVersion: t.rowVersion,
          podId: m.podId ?? undefined,
          userId: m.userId ?? undefined,
        }),
      );
      if (!assigned.ok) {
        this.showServerErrors(assigned.error);
        return;
      }
    }

    const dropped = this.store.task()?.droppedFields ?? [];
    this.store.editing.set(false);
    this.store.dirty.set(false);
    this.notify.success('Task saved.');
    if (dropped.length > 0) {
      this.notify.info(
        'Some answers were removed',
        `Hidden fields were cleared: ${dropped.join(', ')}.`,
      );
    }
  }

  private focusSummary(): void {
    queueMicrotask(() =>
      this.host.nativeElement.querySelector<HTMLElement>('[data-error-summary]')?.focus(),
    );
  }

  private showServerErrors(error: unknown): void {
    const mapped = serverFormErrors(error);
    const { base, form } = splitFormErrors(mapped.fields);
    this.fieldErrors.set(base);
    this.formErrors.set(form);
    this.summary.set([...Object.values(base), ...form.map((f) => f.message)].filter(Boolean));
    if (mapped.conflict) this.summary.set([]);
    this.focusSummary();
  }
}
