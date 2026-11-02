import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ServerFieldError } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { MatterAiAllowed, MatterResponse, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import {
  CustomFieldsEditor,
  customFieldsProblems,
  splitFormErrors,
} from '../../../shared/ui/custom-fields';
import { SlidePanel } from '../../../shared/ui/slide-panel';
import { numberProblem } from '../../../shared/ui/number-input';
import { TextField } from '../../../shared/ui/text-field';
import { AI_OPTIONS } from './matter-ai';

/**
 * Edit a Matter in the shared side panel (MD-03, #1004; owner decision AQ.2): the name, the sensitive flag, the AI allowed setting and the custom fields.
 * Status is read-only here (Set inactive / Set active is in More actions, with the open-task rule) and so are the client and the numbers. Marking a matter
 * sensitive can end the editor's own access: the server answers 409 `SENSITIVE_CONFIRMATION_REQUIRED`, the panel says so and the next Save confirms.
 * After a save the panel closes and `saved` carries the matter; after a confirmed loss of access `lostAccess` fires instead (the page would answer "not found").
 */
@Component({
  selector: 'mf-matter-edit-panel',
  imports: [SlidePanel, TextField, CustomFieldsEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-slide-panel
      title="Edit matter"
      [subtitle]="matter().matterRef"
      size="large"
      primaryLabel="Save changes"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [(visible)]="visible"
      (submitted)="save()"
    >
      @if (summary().length > 0) {
        <div class="mep__summary" role="alert" data-summary>
          Fix the following to save:
          <ul>
            @for (message of summary(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
        </div>
      }
      <form class="mep__form" novalidate (submit)="$event.preventDefault(); save()">
        <mf-text-field
          inputId="matter-name"
          label="Matter name"
          [required]="true"
          [maxLength]="300"
          [error]="nameError()"
          [(value)]="name"
        />

        <p class="mep__ro" data-status-note>
          Status: <strong>{{ matter().isActive ? 'Active' : 'Inactive' }}</strong
          >. Use
          <em>More actions &gt; {{ matter().isActive ? 'Set inactive' : 'Set active' }}</em> to
          change it.
        </p>

        <label class="pg-radio">
          <input
            type="checkbox"
            name="matter-sensitive"
            [checked]="isSensitive()"
            (change)="isSensitive.set($any($event.target).checked)"
          />
          <span>
            Sensitive matter
            <span class="pg-reason" style="display: block"
              >Restricts this matter, with its tasks and assets, to its project managers, people
              assigned one of its tasks and people who may see all sensitive matters. Also shows a
              warning banner.</span
            >
            @if (serverErrors()['isSensitive']; as problem) {
              <span
                class="pg-reason pg-reason--error"
                style="display: block"
                data-sensitive-error
                >{{ problem }}</span
              >
            }
          </span>
        </label>

        <div class="pg-field">
          <label class="mf-label" for="matter-ai">AI allowed</label>
          <select
            id="matter-ai"
            class="mf-control"
            data-ai-allowed
            (change)="aiAllowed.set($any($event.target).value)"
          >
            @for (o of aiOptions; track o.value) {
              <option [value]="o.value" [selected]="aiAllowed() === o.value">{{ o.label }}</option>
            }
          </select>
          <span class="pg-reason" style="display: block"
            >Which AI tools may be used on this matter's content.</span
          >
        </div>

        <mf-custom-fields-editor
          [versionId]="customVersionId()"
          [values]="customValues()"
          [serverErrors]="customErrors()"
          (touched)="customTouched.set(true)"
        />

        @if (canChangeNumber()) {
          @if (changingNumber()) {
            <div class="mep__number" data-number-section>
              <mf-text-field
                inputId="matter-new-number"
                label="New matter number (1 to 5 digits)"
                [maxLength]="16"
                [error]="numberError()"
                [(value)]="newNumber"
              />
              <p class="mep__ro">
                Changing the number changes the combined reference {{ matter().matterRef }}
                everywhere.
              </p>
              <span class="mep__row">
                <button
                  type="button"
                  class="mf-btn"
                  data-number-cancel
                  (click)="changingNumber.set(false)"
                >
                  Keep the number
                </button>
                <button
                  type="button"
                  class="mf-btn mf-btn--primary"
                  data-number-apply
                  (click)="applyNumber()"
                >
                  Change number
                </button>
              </span>
            </div>
          } @else {
            <p class="mep__ro">
              <button
                type="button"
                class="mf-btn mf-btn--text"
                data-change-number
                (click)="changingNumber.set(true)"
              >
                Change matter number
              </button>
            </p>
          }
        }
      </form>
    </mf-slide-panel>
  `,
  styles: `
    .mep__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .mep__ro {
      margin: 0;
      color: var(--mf-text-muted);
    }
    .mep__number {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s2);
    }
    .mep__row {
      display: flex;
      justify-content: space-between;
    }
    .mep__summary {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-overdue-solid);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
  `,
})
export class MatterEditPanel {
  readonly matter = input.required<MatterResponse>();
  readonly visible = model(false);
  readonly saved = output<MatterResponse>();
  readonly lostAccess = output<void>();

  private readonly api = inject(MattersClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly customEditor = viewChild(CustomFieldsEditor);

  protected readonly aiOptions = AI_OPTIONS;
  protected readonly name = signal('');
  protected readonly isSensitive = signal(false);
  protected readonly aiAllowed = signal<MatterAiAllowed>(MatterAiAllowed.No);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly summary = signal<string[]>([]);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly customVersionId = signal<number | null>(null);
  protected readonly customValues = signal<Record<string, unknown>>({});
  protected readonly customErrors = signal<ServerFieldError[]>([]);
  protected readonly customTouched = signal(false);
  /** The server said that this save ends the editor's access: the next Save confirms. */
  private lossAsked = false;

  protected readonly canChangeNumber = computed(() => this.auth.has('Matter.EditNumber'));
  protected readonly nameError = computed(() =>
    this.submitted() && this.name().trim() === ''
      ? 'Enter a matter name.'
      : (this.serverErrors()['name'] ?? null),
  );
  protected readonly dirty = computed(() => {
    const m = this.matter();
    return (
      this.name() !== m.name ||
      this.isSensitive() !== m.isSensitive ||
      this.aiAllowed() !== (m.aiAllowed ?? MatterAiAllowed.No) ||
      this.customTouched()
    );
  });

  constructor() {
    // Each opening starts from the matter as it is now, so a cancelled edit never shows in the next one.
    effect(() => {
      if (!this.visible()) return;
      const m = this.matter();
      untracked(() => {
        this.name.set(m.name);
        this.isSensitive.set(m.isSensitive);
        this.aiAllowed.set(m.aiAllowed ?? MatterAiAllowed.No);
        this.customVersionId.set(m.publishedFormVersionId ?? null);
        this.customValues.set({ ...(m.formValues ?? {}) });
        this.customTouched.set(false);
        this.customErrors.set([]);
        this.serverErrors.set({});
        this.summary.set([]);
        this.submitted.set(false);
        this.error.set('');
        this.lossAsked = false;
        this.changingNumber.set(false);
        this.newNumber.set('');
        this.numberError.set(null);
      });
    });
  }

  protected readonly changingNumber = signal(false);
  protected readonly newNumber = signal('');
  protected readonly numberError = signal<string | null>(null);

  /** Changes the matter number (Matter.EditNumber) from the panel; the answer replaces the matter on the page and the panel closes. */
  protected async applyNumber(): Promise<void> {
    const problem = numberProblem(this.newNumber(), 'matter number');
    this.numberError.set(problem);
    if (problem) return;
    this.busy.set(true);
    try {
      const m = this.matter();
      const updated = await firstValueFrom(
        this.api.changeMatterNumber(m.matterId, {
          number: this.newNumber().trim(),
          rowVersion: m.rowVersion,
        }),
      );
      this.notify.success(`Matter number changed to ${updated.matterRef}`);
      this.visible.set(false);
      this.saved.emit(updated);
    } catch (err) {
      const e = serverFormErrors(err);
      this.numberError.set(e.fields['number'] ?? e.summary[0] ?? "The number couldn't be changed.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    const problems: string[] = [];
    if (this.name().trim() === '') problems.push('Enter a matter name.');
    this.customErrors.set([]);
    const custom = this.customEditor()?.collect(this.customValues());
    problems.push(...customFieldsProblems(custom));
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

    const original = this.matter();
    const confirm = this.lossAsked;
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(
        this.api.updateMatter(original.matterId, {
          name: this.name().trim(),
          isSensitive: this.isSensitive(),
          aiAllowed: this.aiAllowed(),
          confirmLossOfAccess: confirm || undefined,
          formValues: custom?.values,
          rowVersion: original.rowVersion,
        }),
      );
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.visible.set(false);
      if (confirm) {
        this.notify.success(
          `Matter ${saved.matterRef} saved. It is sensitive now and you no longer see it.`,
        );
        this.lostAccess.emit();
        return;
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      this.saved.emit(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SENSITIVE_CONFIRMATION_REQUIRED') {
        this.lossAsked = true;
        this.error.set(
          'You will no longer see this matter after it is marked sensitive. Press Save changes again to confirm.',
        );
        return;
      }
      const errors = serverFormErrors(err);
      const split = splitFormErrors(errors.fields);
      this.serverErrors.set(split.base);
      this.customErrors.set(split.form);
      this.summary.set(errors.summary);
      if (errors.conflict) {
        this.error.set('This matter was changed by someone else. Close the panel and reopen it.');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
