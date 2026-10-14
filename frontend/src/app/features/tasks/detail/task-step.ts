import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DynamicForm, FormDefinition, ServerFieldError } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { FormsClient, TaskStepInstance } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { LocalTimePipe } from '../../../shared/pipes/local-time.pipe';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { splitFormErrors } from '../../../shared/ui/custom-fields';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { TaskDetailStore } from './task-detail.store';

const STATUS_TEXT: Readonly<Record<string, { text: string; icon: string }>> = {
  PENDING: { text: 'Pending', icon: 'pi-circle' },
  IN_PROGRESS: { text: 'In progress', icon: 'pi-play-circle' },
  COMPLETED: { text: 'Completed', icon: 'pi-check-circle' },
  SKIPPED: { text: 'Skipped', icon: 'pi-minus-circle' },
};

/** Patch of `current` against `original`: changed values, and `null` for values the user cleared. */
export function valuesPatch(
  original: Record<string, unknown>,
  current: Record<string, unknown>,
  known: ReadonlySet<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...current };
  for (const key of Object.keys(original)) {
    if (known.has(key) && !(key in current)) patch[key] = null;
  }
  return patch;
}

/**
 * One step of the stepper (UX S10): state, tags, instructions, documentation link, the step's input form and the
 * Save / Complete / Skip / Reopen actions. Ordered workflows lock steps that are not yet current; actions are disabled with
 * a visible reason while the Task is On Hold or closed.
 */
@Component({
  selector: 'mf-task-step',
  imports: [DynamicForm, ConfirmDialog, LocalTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = step();
    <div class="step" [attr.data-step-id]="s.stepInstanceId" [attr.data-step-status]="s.status">
      <h3 class="step__head">
        <button
          type="button"
          class="step__toggle"
          [id]="'step-btn-' + s.stepInstanceId"
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="open() ? 'step-body-' + s.stepInstanceId : null"
          (click)="open.set(!open())"
        >
          <i class="pi" [class]="locked() ? 'pi-lock' : status().icon" aria-hidden="true"></i>
          <span class="step__no">{{ s.sequenceNo }}.</span>
          <span class="step__title">{{ s.title }}</span>
          <span class="tag" data-state>{{ status().text }}</span>
          @if (s.isCurrent && ordered()) {
            <span class="tag tag--current" data-current>Current step</span>
          }
          <span class="tag tag--muted">{{ s.isSkippable ? 'Skippable' : 'Required' }}</span>
          @if (s.isReopenedPrerequisite) {
            <span class="tag tag--warn" data-reopened>Reopened</span>
          }
        </button>
      </h3>
      @if (s.status === 'SKIPPED' && s.skipComment) {
        <p class="step__note" data-skip-comment>Skipped: "{{ s.skipComment }}"</p>
      }
      @if (s.resolvedAtUtc && (s.status === 'COMPLETED' || s.status === 'SKIPPED')) {
        <p class="step__note">{{ status().text }} {{ s.resolvedAtUtc | localTime }}</p>
      }
      @if (s.isReopenedPrerequisite) {
        <p class="step__note step__note--warn" data-reopened-note>
          Step {{ s.sequenceNo }} was reopened. Later steps are unchanged. Resolve step
          {{ s.sequenceNo }} before completing the task.
        </p>
      }
      @if (locked()) {
        <p class="step__note" data-locked [id]="'step-lock-' + s.stepInstanceId">
          Locked. Complete or skip step {{ blockingStepNo() }} first.
        </p>
      }

      @if (open()) {
        <div class="step__body" [id]="'step-body-' + s.stepInstanceId">
          @if (s.description) {
            <p>{{ s.description }}</p>
          }
          @if (s.instructions) {
            <div class="step__instructions" data-instructions>
              <strong>Instructions</strong>
              <p class="pre">{{ s.instructions }}</p>
            </div>
          }
          @if (safeDocUrl(); as url) {
            <p>
              <a [href]="url" target="_blank" rel="noopener noreferrer" data-doc-link
                >Documentation <span class="pg-sr">(opens in a new tab)</span></a
              >
            </p>
          }

          @if (schema(); as definition) {
            <fieldset class="step__form" [disabled]="!editable()">
              <legend>Inputs</legend>
              <mf-dynamic-form
                [definition]="definition"
                [values]="s.values ?? {}"
                [readOnly]="!editable()"
                [serverErrors]="serverErrors()"
                (valuesChange)="draft.set($event)"
              />
            </fieldset>
          }

          @if (error(); as e) {
            <p class="error" role="alert" data-step-error>{{ e }}</p>
          }

          <div class="step__actions">
            @if (canAct()) {
              @if (s.status === 'PENDING') {
                <button
                  type="button"
                  class="mf-btn"
                  data-start
                  [disabled]="busy()"
                  (click)="start()"
                >
                  Start step
                </button>
              }
              @if (schema()) {
                <button type="button" class="mf-btn" data-save [disabled]="busy()" (click)="save()">
                  Save inputs
                </button>
              }
              <button
                type="button"
                class="mf-btn mf-btn--primary"
                data-complete
                [disabled]="busy()"
                (click)="complete()"
              >
                Mark complete
              </button>
              <button
                type="button"
                class="mf-btn"
                data-skip
                [disabled]="busy() || !s.isSkippable"
                [attr.aria-describedby]="s.isSkippable ? null : 'step-noskip-' + s.stepInstanceId"
                (click)="skipOpen.set(true)"
              >
                Skip step
              </button>
              @if (!s.isSkippable) {
                <span class="step__hint" data-no-skip [id]="'step-noskip-' + s.stepInstanceId"
                  >This step is required and can't be skipped.</span
                >
              }
            }
            @if (canReopen()) {
              <button
                type="button"
                class="mf-btn"
                data-reopen
                [disabled]="busy()"
                (click)="reopenOpen.set(true)"
              >
                Reopen step
              </button>
            }
          </div>
          @if (blockedReason(); as r) {
            <p class="step__hint" data-blocked-reason>{{ r }}</p>
          }
        </div>
      }

      @if (skipOpen()) {
        <mf-confirm-dialog
          [title]="'Skip &quot;' + s.title + '&quot;?'"
          confirmLabel="Skip step"
          cancelLabel="Keep step"
          [busy]="busy()"
          [visible]="true"
          (visibleChange)="closeSkip($event)"
          (confirmed)="confirmSkip()"
        >
          <p>This step is skippable. Skipped steps count as resolved.</p>
          <div class="skip">
            <label [for]="'skip-comment-' + s.stepInstanceId">
              Comment
              <span class="req">{{ s.skipCommentRequired ? '(required)' : '(optional)' }}</span>
            </label>
            <textarea
              [id]="'skip-comment-' + s.stepInstanceId"
              rows="4"
              maxlength="2000"
              [value]="skipComment()"
              [attr.aria-invalid]="skipError() ? 'true' : null"
              [attr.aria-describedby]="'skip-help-' + s.stepInstanceId"
              (input)="onSkipComment($event)"
            ></textarea>
            <p class="step__hint" [id]="'skip-help-' + s.stepInstanceId">
              Explain why this step isn't needed.
            </p>
            @if (skipError(); as e) {
              <p class="error" role="alert" data-skip-error>{{ e }}</p>
            }
          </div>
        </mf-confirm-dialog>
      }

      @if (reopenOpen()) {
        <mf-confirm-dialog
          [title]="'Reopen &quot;' + s.title + '&quot;?'"
          confirmLabel="Reopen step"
          cancelLabel="Keep as is"
          [busy]="busy()"
          [visible]="true"
          (visibleChange)="closeReopen($event)"
          (confirmed)="confirmReopen()"
        >
          <p>Reopen this step so you can change it? Later steps keep their status.</p>
          @if (store.task()?.status === 'COMPLETED') {
            <p data-reopen-task-note>
              This task is Completed. Reopening a step will move the task back to In Progress.
            </p>
          }
        </mf-confirm-dialog>
      }
    </div>
  `,
  styles: `
    .step {
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }
    .step__head {
      margin: 0;
      font-size: inherit;
    }
    .step__toggle {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: var(--mf-target-min);
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .step__title {
      font-weight: 600;
    }
    .tag {
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .tag--muted {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .tag--current {
      color: var(--mf-link);
    }
    .tag--warn {
      background: var(--mf-warning-bg);
      color: var(--mf-warning);
    }
    .step__note {
      margin: var(--mf-s1) 0 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .step__note--warn {
      color: var(--mf-warning);
    }
    .step__body {
      display: grid;
      gap: var(--mf-s3);
      margin-top: var(--mf-s3);
    }
    .pre {
      margin: var(--mf-s1) 0 0;
      white-space: pre-wrap;
    }
    .step__form {
      margin: 0;
      padding: var(--mf-s3);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
    }
    .step__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .step__hint {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .error {
      margin: 0;
      color: var(--mf-danger);
      font-size: var(--mf-fs-sm);
    }
    .skip {
      display: grid;
      gap: var(--mf-s1);
    }
    .skip label {
      font-weight: 600;
    }
    .req {
      font-weight: 400;
      color: var(--mf-text-muted);
    }
    textarea {
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      color: var(--mf-text);
      font: inherit;
    }
    textarea[aria-invalid='true'] {
      border-color: var(--mf-danger);
    }
  `,
})
export class TaskStep {
  readonly step = input.required<TaskStepInstance>();
  readonly ordered = input(true);
  /** Sequence number of the step that must be resolved first (ordered workflows). */
  readonly currentSequenceNo = input<number | null>(null);
  /** True when the user asked to jump here: the step opens and takes focus. */
  readonly focusRequested = input(false);

  protected readonly store = inject(TaskDetailStore);
  private readonly forms = inject(FormsClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dynamicForm = viewChild(DynamicForm);

  protected readonly open = signal(false);
  protected readonly schema = signal<FormDefinition | null>(null);
  protected readonly draft = signal<Record<string, unknown> | null>(null);
  protected readonly serverErrors = signal<ServerFieldError[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly skipOpen = signal(false);
  protected readonly reopenOpen = signal(false);
  protected readonly skipComment = signal('');
  protected readonly skipError = signal<string | null>(null);
  private loadedSchemaFor: number | null | undefined = null;
  private initialised = false;

  protected readonly busy = this.store.busy;
  protected readonly status = computed(
    () => STATUS_TEXT[this.step().status] ?? { text: this.step().status, icon: 'pi-circle' },
  );
  protected readonly resolved = computed(() =>
    ['COMPLETED', 'SKIPPED'].includes(this.step().status),
  );

  /** Ordered workflows: a never-resolved step behind the current one is locked until the current one is resolved. */
  protected readonly locked = computed(() => {
    const s = this.step();
    return this.ordered() && !s.isCurrent && !s.hasBeenResolved && !this.resolved();
  });
  protected readonly blockingStepNo = computed(
    () => this.currentSequenceNo() ?? this.step().sequenceNo - 1,
  );

  protected readonly canAct = computed(() => {
    const s = this.step();
    return (
      !this.resolved() &&
      !this.locked() &&
      this.store.task()?.allowedActions.canExecuteSteps === true &&
      !!s
    );
  });
  protected readonly canReopen = computed(
    () => this.resolved() && this.store.task()?.allowedActions.canReopenSteps === true,
  );
  protected readonly editable = computed(() => this.canAct());

  /** Why actions are unavailable, when they are (hold, closed, permission). */
  protected readonly blockedReason = computed(() => {
    const task = this.store.task();
    if (!task || this.locked()) return null;
    const a = task.allowedActions;
    if (!this.resolved() && !a.canExecuteSteps) {
      if (task.status === 'ON_HOLD')
        return 'This task is On Hold. Resume it before working on its steps.';
      if (task.status === 'COMPLETED') return 'This task is Completed. Reopen a step to change it.';
      if (task.status === 'CANCELLED')
        return 'This task is Cancelled. Reopen the task to work on its steps.';
      return "You don't have permission to work on workflow steps.";
    }
    if (this.resolved() && !a.canReopenSteps) {
      if (task.status === 'ON_HOLD')
        return 'This task is On Hold. Resume it before reopening steps.';
      if (task.status === 'CANCELLED')
        return 'This task is Cancelled. Reopen the task to change its steps.';
      if (!task.matter.isActive) return "Matter is inactive. This step can't be reopened.";
      return "You don't have permission to reopen steps.";
    }
    return null;
  });

  protected readonly safeDocUrl = computed(() => {
    const url = this.step().documentationUrl;
    return url && /^https?:\/\//i.test(url) ? url : null;
  });

  constructor() {
    effect(() => {
      const s = this.step();
      const focus = this.focusRequested();
      untracked(() => {
        if (!this.initialised) {
          this.initialised = true;
          this.open.set(s.isCurrent || s.status === 'IN_PROGRESS');
        }
        if (focus) {
          this.open.set(true);
          queueMicrotask(() => {
            const el = this.host.nativeElement.querySelector<HTMLElement>(
              `#step-btn-${s.stepInstanceId}`,
            );
            el?.scrollIntoView?.({ block: 'center' });
            el?.focus();
          });
        }
      });
    });
    effect(() => {
      const id = this.step().inputFormVersionId;
      const isOpen = this.open();
      untracked(() => {
        if (isOpen && id != null && this.loadedSchemaFor !== id) {
          this.loadedSchemaFor = id;
          void this.loadSchema(id);
        }
      });
    });
    effect(() => {
      this.step(); // new data from the server resets the draft
      untracked(() => this.draft.set(null));
    });
  }

  private async loadSchema(id: number): Promise<void> {
    try {
      const detail = await firstValueFrom(this.forms.getFormVersionSchema(id));
      const definition = toFormDefinition(detail);
      this.schema.set(definition.fields.length > 0 ? definition : null);
    } catch {
      this.schema.set(null);
      this.loadedSchemaFor = null;
    }
  }

  private currentValues(): Record<string, unknown> | undefined {
    const schema = this.schema();
    if (!schema) return undefined;
    const original = (this.step().values ?? {}) as Record<string, unknown>;
    const current = this.draft() ?? original;
    return valuesPatch(original, current, new Set(schema.fields.map((f) => f.key)));
  }

  protected async start(): Promise<void> {
    await this.run('start');
  }

  protected async save(): Promise<void> {
    await this.run('save', { values: this.currentValues() });
  }

  protected async complete(): Promise<void> {
    const form = this.dynamicForm();
    let values: Record<string, unknown> | undefined;
    if (form) {
      const evaluation = form.validate();
      if (evaluation.errors.length > 0) {
        this.error.set('Fill in the required inputs to complete this step.');
        return;
      }
      const original = (this.step().values ?? {}) as Record<string, unknown>;
      values = valuesPatch(
        original,
        evaluation.normalized ?? {},
        new Set((this.schema()?.fields ?? []).map((f) => f.key)),
      );
    }
    await this.run('complete', { values });
  }

  private async run(
    action: 'start' | 'save' | 'complete' | 'skip' | 'reopen',
    payload: { values?: Record<string, unknown>; comment?: string } = {},
  ): Promise<boolean> {
    this.error.set(null);
    this.serverErrors.set([]);
    const result = await this.store.stepAction(this.step(), action, payload);
    if (result.ok) return true;
    if (result.error instanceof ApiError) {
      if (result.error.hasFieldErrors) {
        const { base, form } = splitFormErrors(
          Object.fromEntries(
            Object.entries(result.error.problem?.errors ?? {}).flatMap(([k, v]) =>
              v?.[0]?.message ? [[k, v[0].message]] : [],
            ),
          ),
        );
        this.serverErrors.set(form);
        const rest = Object.values(base);
        this.error.set(
          rest[0] ?? (form.length ? 'Some inputs need attention.' : result.error.message),
        );
      } else if (result.error.code !== 'CONCURRENCY_CONFLICT') {
        this.error.set(result.error.message);
      }
    }
    return false;
  }

  // ---- skip

  protected onSkipComment(event: Event): void {
    this.skipComment.set((event.target as HTMLTextAreaElement).value);
    this.skipError.set(null);
  }

  protected closeSkip(visible: boolean): void {
    if (visible) return;
    this.skipOpen.set(false);
    this.skipComment.set('');
    this.skipError.set(null);
  }

  protected async confirmSkip(): Promise<void> {
    const comment = this.skipComment().trim();
    if (this.step().skipCommentRequired && !comment) {
      this.skipError.set('Add a comment to skip this step.');
      return;
    }
    const ok = await this.run('skip', { comment: comment || undefined });
    if (ok) this.closeSkip(false);
    else if (this.error()) {
      this.skipError.set(this.error());
    }
  }

  // ---- reopen

  protected closeReopen(visible: boolean): void {
    if (!visible) this.reopenOpen.set(false);
  }

  protected async confirmReopen(): Promise<void> {
    await this.run('reopen');
    this.reopenOpen.set(false);
  }
}
