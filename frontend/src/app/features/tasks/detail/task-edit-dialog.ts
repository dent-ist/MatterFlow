import {
  ChangeDetectionStrategy,
  Component,
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
import {
  DateInput,
  DynamicForm,
  FormDefinition,
  ServerFieldError,
  errorSummary,
} from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
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
import { outOfOfficeText } from '../../../core/availability/availability';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
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
import { Dialog } from 'primeng/dialog';
import { DialogFocus } from '../../../shared/ui/dialog-focus';
import { TitleArea } from '../../../shared/ui/title-area';
import { RichTextEditor } from '../panels/rich-text-editor';
import {
  DESCRIPTION_MAX_TEXT,
  descriptionToHtml,
  htmlToText,
  isBlankHtml,
} from '../panels/rich-text';
import { TaskDetailStore } from './task-detail.store';
import { valuesPatch } from './task-step';
import { MatterRef } from '../../../shared/ui/matter-ref';

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

export const TITLE_MAX = 200;

const LOCK_TEXT =
  "Can't be changed after creation. To correct it, cancel this task and create a new one.";

const toNumber = (v: string): number | null => (v === '' ? null : Number(v));

/**
 * The Edit dialog of the Task page (UX S10, E1 #319 to #321). 720 px wide (the full width of a phone), a header and a footer that stay in
 * place (Save changes, Cancel) while the body scrolls, and three sections like the page: Task (title as a growing textarea with a
 * counter, description, requestor, project, priority, due date and time), Request details (the request form; collapsed, and opened on
 * an error) and Assignment (Pod and assignee). Matter, Task Type and Workflow are shown read-only. A failed Save shows the summary,
 * opens the section of the first error and puts the cursor in that field; server field errors are mapped back onto the fields. Esc is
 * ignored with unsaved changes; focus returns to the control that opened the dialog.
 */
@Component({
  selector: 'mf-task-edit-dialog',
  imports: [
    DynamicForm,
    DateInput,
    Dialog,
    DialogFocus,
    EntityPicker,
    MatterRef,
    RichTextEditor,
    TitleArea,
  ],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/ui/page.scss', '../../../shared/ui/form-field.scss'],
  template: `
    @if (store.task(); as t) {
      <p-dialog
        header="Edit task details"
        appendTo="body"
        [modal]="true"
        [closable]="true"
        closeAriaLabel="Close without saving"
        [closeOnEscape]="!store.dirty()"
        [mfDialogFocus]="editing()"
        [focusOnShow]="false"
        (onShow)="focusTitle()"
        [draggable]="false"
        [resizable]="false"
        [visible]="editing()"
        (visibleChange)="onDialogVisible($event)"
        [style]="{ width: 'min(720px, 100vw)', maxWidth: '100vw' }"
      >
        <form id="td-edit-form" class="dt__form" novalidate (submit)="save($event)" data-edit-form>
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

          <section class="dt__sec" aria-labelledby="td-sec-task" data-section="task">
            <h3 id="td-sec-task" class="dt__sech">Task</h3>

            <mf-title-area
              inputId="td-title"
              label="Title"
              [required]="true"
              [maxLength]="titleMax"
              [error]="err('title')"
              [value]="model().title"
              (valueChange)="set('title', $event)"
            />

            <div class="mf-field dt__rich">
              <span class="mf-field__label" id="td-description-label">Description</span>
              <mf-rich-text-editor
                label="Description"
                placeholder="Describe the work. You can paste a table from an email."
                data-description-editor
                [maxLength]="descriptionMax"
                [value]="model().description"
                (valueChange)="set('description', $event)"
              />
              @if (err('description'); as e) {
                <p class="mf-field__error" id="td-description-error" role="alert">{{ e }}</p>
              }
            </div>

            <div class="dt__row">
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
            </div>

            <div class="dt__row">
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

              @if (
                t.allowedActions.canSetPriority || t.priority.priorityId !== model().priorityId
              ) {
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
            </div>

            <fieldset class="dt__due">
              <legend class="dt__sr">Due date and time</legend>
              <div class="dt__row">
                <div class="mf-field">
                  <label class="mf-field__label" for="td-due-date">Due date</label>
                  <mf-date-input
                    inputId="td-due-date"
                    label="due date"
                    [isoValue]="model().dueDate || null"
                    [invalid]="!!err('dueDate')"
                    [showError]="false"
                    (isoChange)="set('dueDate', $event ?? '')"
                    (textInvalid)="dueDateBad.set($event)"
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
          </section>

          @if (definition(); as def) {
            <section class="dt__sec" data-section="request">
              <h3 class="dt__sech">
                <button
                  type="button"
                  class="dt__toggle"
                  aria-controls="td-request-body"
                  data-request-toggle
                  [attr.aria-expanded]="requestOpen()"
                  (click)="requestOpen.set(!requestOpen())"
                >
                  <i
                    class="pi"
                    [class.pi-chevron-down]="requestOpen()"
                    [class.pi-chevron-right]="!requestOpen()"
                    aria-hidden="true"
                  ></i>
                  <span class="dt__toggle-text"
                    >Request details (form version {{ t.formVersionNo }})</span
                  >
                  <span class="dt__toggle-count">{{ fieldCount(def) }}</span>
                </button>
              </h3>
              <!-- Hidden, not removed: the form keeps its values and still validates while it is collapsed. -->
              <div
                id="td-request-body"
                class="dt__body"
                data-request-body
                [hidden]="!requestOpen()"
              >
                <mf-dynamic-form
                  [definition]="def"
                  [values]="formValues()"
                  [serverErrors]="formErrors()"
                  (valuesChange)="onFormValues()"
                />
              </div>
            </section>
          }

          @if (t.allowedActions.canAssign) {
            <section class="dt__sec" aria-labelledby="td-sec-assign" data-section="assignment">
              <h3 id="td-sec-assign" class="dt__sech">Assignment</h3>
              <div class="mf-field">
                <label class="mf-field__label" for="td-pod">Pod</label>
                <select
                  id="td-pod"
                  class="mf-field__input"
                  [attr.aria-invalid]="err('assignedPodId') ? 'true' : null"
                  (change)="set('podId', toNumber($any($event.target).value))"
                >
                  <option value="" [selected]="model().podId === null">No pod</option>
                  @for (p of podOptions(); track p.id) {
                    <option [value]="p.id" [selected]="model().podId === p.id">
                      {{ p.label }}
                    </option>
                  }
                </select>
                @if (err('assignedPodId'); as e) {
                  <p class="mf-field__error" role="alert">{{ e }}</p>
                }
              </div>
              <mf-entity-picker
                inputId="td-assignee"
                label="Assignee"
                placeholder="Search users"
                help="Any active user can be assigned, not only members of the Pod. Clear the choice to leave the task unassigned."
                [error]="err('assignedUserId')"
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
            </section>
          }

          <section class="dt__locked" aria-labelledby="td-locked-h" data-locked-fields>
            <h3 id="td-locked-h" class="dt__sech dt__sech--plain">
              <i class="pi pi-lock" aria-hidden="true"></i> Task type, workflow and matter
            </h3>
            <dl class="pg-dl">
              <dt>Matter</dt>
              <dd>
                <mf-matter-ref
                  [value]="t.matter.matterRef"
                  [link]="auth.canLink('matter') ? ['/matters', t.matter.matterId] : null"
                />
                {{ t.matter.name }}
              </dd>
              <dt>Task type</dt>
              <dd>{{ t.taskType.name }}</dd>
              <dt>Workflow</dt>
              <dd>{{ t.workflow.workflowName }} v{{ t.workflow.versionNo }}</dd>
            </dl>
            <p class="pg-muted" data-lock-text>{{ lockText }}</p>
          </section>
        </form>

        <ng-template #footer>
          <div class="dt__actions" data-edit-footer>
            <button
              type="submit"
              form="td-edit-form"
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
        </ng-template>
      </p-dialog>
    }
  `,
  styles: `
    /* Every grid has one flexible column that may shrink to nothing (min-width: 0), so nothing inside can make the dialog scroll sideways (BUG-3). */
    .dt__form {
      --mf-field-max: none;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s5);
      min-width: 0;
    }
    .dt__sec {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: var(--mf-s4);
      min-width: 0;
    }
    .dt__sec > *,
    .dt__form .mf-field {
      min-width: 0;
    }
    .dt__sech {
      margin: 0;
      font-size: var(--mf-fs-md);
    }
    .dt__sech--plain {
      margin-bottom: var(--mf-s2);
    }
    .dt__row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
      align-items: start;
      gap: var(--mf-s4);
      min-width: 0;
    }
    .dt__row > * {
      min-width: 0;
    }
    /* The description editor holds tables: it uses the whole width and scrolls them inside itself. */
    .dt__rich {
      min-width: 0;
    }
    .dt__toggle {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: 2.75rem;
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      color: var(--mf-text);
      font: inherit;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .dt__toggle:hover {
      background: var(--mf-selected-bg);
    }
    .dt__toggle-text {
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .dt__toggle-count {
      flex: none;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 400;
    }
    .dt__body {
      min-width: 0;
    }
    .dt__body[hidden] {
      display: none;
    }
    .dt__due {
      display: grid;
      gap: var(--mf-s2);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .dt__sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .dt__locked {
      min-width: 0;
    }
    .dt__locked .pg-dl {
      grid-template-columns: max-content minmax(0, 1fr);
    }
    .dt__locked dd {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .dt__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
    }
    .warn {
      color: var(--mf-warning);
    }
  `,
})
export class TaskEditDialog {
  /** The request form's definition for the Task's form version (the Details panel loads it for its own read view too). */
  readonly definition = input<FormDefinition | null>(null);

  protected readonly store = inject(TaskDetailStore);
  private readonly tasks = inject(TasksClient);
  private readonly projectsApi = inject(ProjectsClient);
  private readonly podsApi = inject(PodsClient);
  private readonly usersApi = inject(UsersLookupClient);
  protected readonly auth = inject(AuthStore);
  private readonly lookups = inject(LookupStore);
  private readonly notify = inject(NotificationService);
  private readonly zone = inject(USER_TIME_ZONE);
  private readonly clock = inject(Clock);
  private readonly injector = inject(Injector);
  private readonly dynamicForm = viewChild(DynamicForm);
  private readonly dialog = viewChild(Dialog);

  protected readonly lockText = LOCK_TEXT;
  protected readonly toNumber = toNumber;
  protected readonly titleMax = TITLE_MAX;
  protected readonly editing = this.store.editing;

  protected readonly model = signal<EditModel>(this.emptyModel());
  private original: EditModel = this.emptyModel();
  protected readonly fieldErrors = signal<Record<string, string>>({});
  /** The due date field holds text that is not a date: kept visible, reported and blocks saving. */
  protected readonly dueDateBad = signal(false);
  protected readonly formErrors = signal<ServerFieldError[]>([]);
  protected readonly summary = signal<string[]>([]);
  /** The Request details section is collapsed when the dialog opens and opens itself on an error. */
  protected readonly requestOpen = signal(false);

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

  protected readonly descriptionMax = DESCRIPTION_MAX_TEXT;

  /** What the editor started with (a description saved as text is converted to paragraphs), to tell whether the person changed it. */
  private startDescription = '';

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
      if (this.store.editing()) untracked(() => this.beginEdit());
    });
    // PrimeNG binds its Escape listener once, when the dialog opens, and never looks at `closeOnEscape` again; with unsaved changes the
    // listener is taken off (it is bound afresh the next time the dialog opens), so Esc is ignored as it should be.
    effect(() => {
      const dialog = this.dialog();
      if (dialog && this.store.dirty()) untracked(() => dialog.unbindDocumentEscapeListener());
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

  protected fieldCount(def: FormDefinition): string {
    const n = def.fields.length;
    return `${n} ${n === 1 ? 'field' : 'fields'}`;
  }

  private beginEdit(): void {
    const t = this.store.task();
    if (!t) return;
    const m: EditModel = {
      title: t.title,
      description: descriptionToHtml(t.description, t.descriptionFormat),
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
    this.startDescription = m.description;
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
    this.requestOpen.set(false);
    this.store.dirty.set(false);
    void this.loadOptions(t.matter.matterId);
  }

  /**
   * Puts the cursor in the Title once the dialog has finished opening, unless the person (or a test) has already moved on to
   * another field of the form. PrimeNG's own focus-on-show runs after the enter animation and would take focus back from a field
   * the user already started typing in, which blurred the Assignee picker and closed its list.
   */
  protected focusTitle(): void {
    const active = document.activeElement;
    if (active && active !== document.body && active.closest('[data-edit-form]')) return;
    document.getElementById('td-title')?.focus();
  }

  private async loadOptions(matterId: number): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.auth.has('Project.View')) {
      tasks.push(
        firstValueFrom(
          this.projectsApi.listProjects(
            undefined,
            matterId,
            undefined,
            undefined,
            undefined,
            1,
            100,
            'name',
          ),
        )
          .then((r) => this.projects.set(r.items ?? []))
          .catch(() => undefined),
      );
    }
    if (this.store.task()?.allowedActions.canAssign) {
      if (this.auth.has('Pod.View')) {
        tasks.push(
          firstValueFrom(this.podsApi.listPods(undefined, undefined, true, 1, 100, 'name'))
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
    // The title is one line: the textarea already strips line breaks, the model never holds them either.
    const next =
      key === 'title' ? ((value as string).replace(/[\r\n]+/g, ' ') as EditModel[K]) : value;
    this.model.update((m) => ({ ...m, [key]: next }));
    this.store.dirty.set(true);
    this.fieldErrors.update((e) => {
      const copy = { ...e };
      delete copy[key];
      return copy;
    });
  }

  /** Any active user, as in Create Task (`GET /users/lookup`, needs Task.Assign), not just the Pod's members. */
  protected readonly searchUsers = async (query: string): Promise<PickerOption[]> => {
    const found = await firstValueFrom(this.usersApi.lookupUsers(query || undefined, 8));
    return found.map((u) => ({
      id: u.userId,
      label: u.displayName,
      flag: outOfOfficeText(u.availability, this.zone) ?? undefined,
    }));
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

  protected onDialogVisible(visible: boolean): void {
    if (!visible && this.store.editing()) this.cancelEdit();
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
    if (htmlToText(m.description).trim().length > DESCRIPTION_MAX_TEXT) {
      errors['description'] = `Description must be ${DESCRIPTION_MAX_TEXT} characters or fewer.`;
    }
    if (!m.requestorName.trim()) errors['requestorName'] = 'Enter the requestor name.';
    if (m.requestorEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.requestorEmail.trim())) {
      errors['requestorEmail'] = 'Enter a valid email address.';
    }
    if (this.dueDateBad()) {
      errors['dueDate'] = 'Enter a valid date, for example Oct 12, 2026 or 10/12/2026.';
    } else if (m.dueTime && !m.dueDate) {
      errors['dueDate'] = 'Choose a date for the due time.';
    }
    return errors;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const task = this.store.task();
    if (!task) return;
    const errors = this.validate();
    const form = this.dynamicForm();
    const def = this.definition();
    let formPatch: Record<string, unknown> | undefined;
    let formInvalid = false;
    let formLines: string[] = [];
    if (form && def) {
      const evaluation = form.validate();
      if (evaluation.errors.length > 0) {
        formInvalid = true;
        formLines = errorSummary(def.fields ?? [], evaluation.errors);
      } else {
        formPatch = valuesPatch(
          this.formValues(),
          evaluation.normalized ?? {},
          new Set((def.fields ?? []).map((f) => f.key)),
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
      if (formInvalid) this.requestOpen.set(true);
      this.focusFirstInvalid();
      return;
    }
    this.summary.set([]);

    const m = this.model();
    const result = await this.store.act((t) =>
      this.tasks.updateTask(t.taskId, {
        rowVersion: t.rowVersion,
        projectId: m.projectId ?? undefined,
        title: m.title.trim(),
        description: this.descriptionToSend(t.description, t.descriptionFormat, m.description),
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

  /**
   * The description to send. A description saved as text that the person did not touch is sent back as it is (the server then keeps it as
   * text and records no change); anything edited is sent as the editor's HTML, which the server sanitizes again.
   */
  private descriptionToSend(
    saved: string | undefined,
    format: string,
    html: string,
  ): string | undefined {
    if (format !== 'HTML' && saved && html === this.startDescription) return saved;
    return isBlankHtml(html) ? undefined : html;
  }

  /**
   * After a failed Save: the cursor goes to the first invalid field (in page order), so the person lands on the problem and the footer
   * with Save stays in view; with no field to point at, the summary takes the focus. Runs after the next render, once an opened
   * Request details section and the error markers are in the page.
   */
  private focusFirstInvalid(): void {
    afterNextRender(
      () => {
        const root = document.querySelector<HTMLElement>('[data-edit-form]');
        const field = root?.querySelector<HTMLElement>(
          '[aria-invalid="true"], .rte--invalid [contenteditable="true"]',
        );
        const target = field ?? root?.querySelector<HTMLElement>('[data-error-summary]');
        target?.focus();
        target?.scrollIntoView?.({ block: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  private showServerErrors(error: unknown): void {
    const mapped = serverFormErrors(error);
    const { base, form } = splitFormErrors(mapped.fields);
    this.fieldErrors.set(base);
    this.formErrors.set(form);
    this.summary.set([...Object.values(base), ...form.map((f) => f.message)].filter(Boolean));
    if (mapped.conflict) this.summary.set([]);
    // The section of an error is the one that opens: the request form for a form error. Task and Assignment are always open.
    if (form.length > 0) this.requestOpen.set(true);
    this.focusFirstInvalid();
  }
}
