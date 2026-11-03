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
import { RouterLink } from '@angular/router';
import type { ServerFieldError } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  ClientResponse,
  ClientsClient,
  MatterAiAllowed,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApiError } from '../../../core/http/api-error';
import { NotificationService } from '../../../core/notify/notification.service';
import { metaNumber, serverFormErrors } from '../../../shared/forms/api-errors';
import { normalizeNumber } from '../../../shared/pipes/matter-ref.pipe';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import {
  CustomFieldsEditor,
  customFieldsProblems,
  splitFormErrors,
} from '../../../shared/ui/custom-fields';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { FormDialog } from '../../../shared/ui/form-dialog';
import { NumberInput, numberProblem } from '../../../shared/ui/number-input';
import { TextField } from '../../../shared/ui/text-field';
import { AI_OPTIONS } from './matter-ai';

function clientOption(c: ClientResponse): PickerOption {
  return { id: c.clientId, label: `${c.clientNumber} ${c.name}`, inactive: !c.isActive };
}

/**
 * THE matter form (MD-43, #1061; owner decision 2026-11-03): one pop-up for "+ New Matter" and for Edit on the Summary, so the same information is entered the same way.
 * Fields, in this order: Client, Matter number, CM Number (a read-only preview of client number plus matter number, never typed), Matter name, Sensitive matter, AI allowed
 * and the custom fields. Labels, help texts, validation messages, the unsaved-changes question and the footer (Cancel left, primary right) are the same in both modes.
 *
 * New (`matter` null): Client and Matter number are editable (`clientId` preselects the client, from a Client page). Edit (`matter` given): Client and Matter number sit in the
 * same places but are locked. The Matter number can be unlocked (needs `Matter.EditNumber`, the existing rule of `PUT /matters/{id}/number`) after a short confirmation, and a
 * changed number is confirmed once more on Save with the exact result ("The CM Number changes from A to B"); then the number is changed first and the rest saved with the new
 * row version. The Client cannot change: the API has no way to move a matter to another client, so it stays locked with its reason.
 * Marking a matter sensitive can end the editor's own access: the server answers 409 `SENSITIVE_CONFIRMATION_REQUIRED` and the next Save confirms. After a confirmed loss of
 * access `lostAccess` fires instead of `saved` (the page would answer "not found").
 */
@Component({
  selector: 'mf-matter-form-dialog',
  imports: [
    FormDialog,
    ConfirmDialog,
    EntityPicker,
    NumberInput,
    TextField,
    CustomFieldsEditor,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .mfd__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .mfd__form .pg-field {
      display: grid;
      gap: var(--mf-s1);
    }
    .mfd__summary {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-overdue-solid);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
    .mfd__cm {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      min-height: var(--mf-chip-h);
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-info-bg);
      font-weight: 700;
    }
    .mfd__cm--empty {
      background: transparent;
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    .mfd__lock {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
  `,
  template: `
    <mf-form-dialog
      [title]="isEdit() ? 'Edit matter' : 'New matter'"
      [subtitle]="matter()?.matterRef ?? ''"
      size="large"
      [primaryLabel]="isEdit() ? 'Save changes' : 'Create matter'"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [(visible)]="visible"
      (submitted)="save()"
    >
      @if (summary().length > 0) {
        <div class="mfd__summary" role="alert" data-summary>
          Fix the following to save:
          <ul>
            @for (message of summary(); track message) {
              <li>{{ message }}</li>
            }
          </ul>
          @if (existingId(); as existing) {
            <a class="pg-link" [routerLink]="['/matters', existing]">View the existing matter</a>
          }
        </div>
      }
      <form class="mfd__form" novalidate (submit)="$event.preventDefault(); save()">
        <div>
          <mf-entity-picker
            inputId="matter-client"
            label="Client"
            placeholder="343 or Acme"
            [required]="true"
            [locked]="isEdit()"
            [search]="searchClients"
            [error]="clientError()"
            [(selected)]="client"
          />
          @if (isEdit()) {
            <p class="mfd__lock" data-client-lock>
              A matter stays with its client; it cannot be moved to another client.
            </p>
          }
        </div>

        <div>
          <mf-number-input
            inputId="matter-number"
            label="Matter number"
            noun="matter number"
            help="Enter 1 to 5 digits, as issued by the firm's main system. It must not be used by another matter of the same client."
            [disabled]="numberLocked()"
            [showErrors]="submitted()"
            [serverError]="fieldError('matterNumber')"
            [(value)]="number"
          />
          @if (isEdit() && canChangeNumber()) {
            <p class="mfd__lock" data-number-lock>
              @if (numberLocked()) {
                <span>The matter number is locked.</span>
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-change-number
                  (click)="askUnlock.set(true)"
                >
                  Change
                </button>
              } @else {
                <span>The matter number can be changed now.</span>
                <button
                  type="button"
                  class="mf-btn mf-btn--text"
                  data-keep-number
                  (click)="keepNumber()"
                >
                  Keep the current number
                </button>
              }
            </p>
          } @else if (isEdit()) {
            <p class="mfd__lock" data-number-lock>
              Changing a matter number needs the permission to edit numbers.
            </p>
          }
        </div>

        <div class="pg-field" data-cm-number>
          <span class="mf-label" id="matter-cm-label">CM Number</span>
          <output
            class="mfd__cm pg-mono"
            [class.mfd__cm--empty]="!cm()"
            aria-labelledby="matter-cm-label"
            aria-live="polite"
            data-cm-value
            >{{ cm() || 'Choose a client and enter a matter number' }}</output
          >
          <span class="pg-reason" style="display: block"
            >The client number and the matter number together. It is shown here for reference and is
            never typed.</span
          >
        </div>

        <mf-text-field
          inputId="matter-name"
          label="Matter name"
          [required]="true"
          [maxLength]="300"
          [error]="nameError()"
          [(value)]="name"
        />

        <label class="pg-radio">
          <input
            type="checkbox"
            name="matter-sensitive"
            [checked]="isSensitive()"
            [attr.aria-invalid]="fieldError('isSensitive') ? 'true' : null"
            [attr.aria-describedby]="fieldError('isSensitive') ? 'matter-sensitive-error' : null"
            (change)="isSensitive.set($any($event.target).checked)"
          />
          <span>
            Sensitive matter
            <span class="pg-reason" style="display: block"
              >Restricts this matter, with its tasks and assets, to its project managers, people
              assigned one of its tasks and people who may see all sensitive matters. Everyone else
              does not see it at all. Also shows a warning banner.</span
            >
            @if (fieldError('isSensitive'); as problem) {
              <span
                class="pg-reason pg-reason--error"
                style="display: block"
                id="matter-sensitive-error"
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
            >Which AI tools may be used on this matter's content. Notes check this setting before AI
            is offered.</span
          >
        </div>

        <mf-custom-fields-editor
          [versionId]="customVersionId()"
          [values]="customValues()"
          [serverErrors]="customErrors()"
          (touched)="customTouched.set(true)"
        />
      </form>
    </mf-form-dialog>

    <mf-confirm-dialog
      title="Change the matter number?"
      confirmLabel="Unlock the matter number"
      [(visible)]="askUnlock"
      (confirmed)="unlockNumber()"
    >
      <p data-unlock-body>
        The matter number is part of the CM Number {{ matter()?.matterRef }}, which is used in
        references everywhere (tasks, assets, reports). Change it only to correct a mistake.
        Continue?
      </p>
    </mf-confirm-dialog>

    <mf-confirm-dialog
      title="Change the CM Number?"
      confirmLabel="Change CM Number"
      [busy]="busy()"
      [(visible)]="askNumberChange"
      (confirmed)="confirmNumberChange()"
    >
      <p data-number-change-body>
        The CM Number changes from {{ matter()?.matterRef }} to {{ newCm() }}. It is used in
        references everywhere. Continue?
      </p>
    </mf-confirm-dialog>
  `,
})
export class MatterFormDialog {
  /** The matter to edit; null makes the form "New matter". */
  readonly matter = input<MatterResponse | null>(null);
  readonly visible = model(false);
  /** New mode: preselects the client (a link from a Client page); null for none. */
  readonly clientId = input<number | null>(null);
  readonly saved = output<MatterResponse>();
  readonly lostAccess = output<void>();

  private readonly api = inject(MattersClient);
  private readonly clients = inject(ClientsClient);
  private readonly notify = inject(NotificationService);
  private readonly auth = inject(AuthStore);
  private readonly customEditor = viewChild(CustomFieldsEditor);

  protected readonly aiOptions = AI_OPTIONS;
  protected readonly isEdit = computed(() => this.matter() !== null);
  protected readonly client = signal<PickerOption | null>(null);
  protected readonly number = signal('');
  protected readonly name = signal('');
  protected readonly isSensitive = signal(false);
  protected readonly aiAllowed = signal<MatterAiAllowed>(MatterAiAllowed.No);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly summary = signal<string[]>([]);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly existingId = signal<number | null>(null);
  protected readonly customVersionId = signal<number | null>(null);
  protected readonly customValues = signal<Record<string, unknown>>({});
  protected readonly customErrors = signal<ServerFieldError[]>([]);
  protected readonly customTouched = signal(false);
  /** Edit: the matter number is locked until the person confirms the unlock. */
  protected readonly numberLocked = signal(true);
  protected readonly askUnlock = signal(false);
  protected readonly askNumberChange = signal(false);
  /** The server said that this save ends the editor's access: the next Save confirms. */
  private lossAsked = false;

  protected readonly canChangeNumber = computed(() => this.auth.has('Matter.EditNumber'));

  protected readonly searchClients = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.clients.listClients(
        query,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        8,
        undefined,
      ),
    );
    return page.items.map(clientOption);
  };

  /** The CM Number (client number, a dash, matter number), live from the two inputs; empty until both are known. */
  protected readonly cm = computed(() => {
    const clientNo = this.client()?.label.split(' ')[0];
    const matterNo = normalizeNumber(this.number());
    return clientNo && matterNo ? `${clientNo}-${matterNo}` : '';
  });
  protected readonly newCm = this.cm;
  protected readonly numberChanged = computed(() => {
    const m = this.matter();
    const n = normalizeNumber(this.number());
    return !!m && !!n && n !== m.matterNumber;
  });
  protected readonly clientError = computed(() =>
    this.submitted() && !this.client() ? 'Select a client.' : this.fieldError('clientId'),
  );
  protected readonly nameError = computed(() =>
    this.submitted() && this.name().trim() === ''
      ? 'Enter a matter name.'
      : this.fieldError('name'),
  );
  /** Typed into the form, so closing asks first. A preselected client alone is not a change. */
  protected readonly dirty = computed(() => {
    const m = this.matter();
    if (!m) {
      return (
        this.number().trim() !== '' ||
        this.name().trim() !== '' ||
        this.isSensitive() ||
        this.customTouched()
      );
    }
    return (
      this.name() !== m.name ||
      this.isSensitive() !== m.isSensitive ||
      this.aiAllowed() !== (m.aiAllowed ?? MatterAiAllowed.No) ||
      this.numberChanged() ||
      this.customTouched()
    );
  });

  constructor() {
    // Each opening starts from the matter (or empty), so a cancelled form never shows in the next one.
    effect(() => {
      if (!this.visible()) return;
      const m = this.matter();
      const preselect = this.clientId();
      untracked(() => {
        this.client.set(
          m
            ? {
                id: m.clientId,
                label: `${m.clientNumber} ${m.clientName}`,
                inactive: !m.clientIsActive,
              }
            : null,
        );
        this.number.set(m?.matterNumber ?? '');
        this.name.set(m?.name ?? '');
        this.isSensitive.set(m?.isSensitive ?? false);
        this.aiAllowed.set(m?.aiAllowed ?? MatterAiAllowed.No);
        this.customValues.set({ ...(m?.formValues ?? {}) });
        this.customVersionId.set(m?.publishedFormVersionId ?? null);
        this.customTouched.set(false);
        this.customErrors.set([]);
        this.serverErrors.set({});
        this.summary.set([]);
        this.existingId.set(null);
        this.submitted.set(false);
        this.error.set('');
        this.lossAsked = false;
        this.numberLocked.set(true);
        this.askUnlock.set(false);
        this.askNumberChange.set(false);
        if (!m) {
          void this.loadCustomForm();
          if (preselect) void this.preselectClient(preselect);
        }
      });
    });
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  protected unlockNumber(): void {
    this.numberLocked.set(false);
    this.askUnlock.set(false);
  }

  protected keepNumber(): void {
    this.number.set(this.matter()?.matterNumber ?? '');
    this.serverErrors.update((e) => ({ ...e, matterNumber: '' }));
    this.numberLocked.set(true);
  }

  private async loadCustomForm(): Promise<void> {
    try {
      const form = await firstValueFrom(this.api.getMatterCustomFieldForm());
      this.customVersionId.set(form.publishedFormVersionId ?? null);
    } catch {
      this.customVersionId.set(null); // no custom fields section
    }
  }

  private async preselectClient(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      this.client.set(clientOption(await firstValueFrom(this.clients.getClient(id))));
    } catch {
      // The picker stays empty; the person can search.
    }
  }

  /** Validates the form; the problems go to the summary. Returns the custom values to send (undefined: none, or untouched on edit). */
  private validate(): { ok: boolean; custom?: Record<string, unknown> } {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    this.existingId.set(null);
    const problems: string[] = [];
    if (!this.client()) problems.push('Select a client.');
    const problem = numberProblem(this.number(), 'matter number');
    if (problem) problems.push(problem);
    if (this.name().trim() === '') problems.push('Enter a matter name.');
    this.customErrors.set([]);
    const custom = this.customEditor()?.collect(this.isEdit() ? this.customValues() : undefined);
    problems.push(...customFieldsProblems(custom));
    if (problems.length > 0) {
      this.summary.set(problems);
      return { ok: false };
    }
    return { ok: true, custom: custom?.values };
  }

  protected async save(): Promise<void> {
    const v = this.validate();
    if (!v.ok) return;
    if (!this.isEdit()) {
      await this.create(v.custom);
      return;
    }
    // A changed matter number is confirmed with its exact result before anything is saved.
    if (this.numberChanged() && !this.askNumberChange()) {
      this.askNumberChange.set(true);
      return;
    }
    await this.update(v.custom);
  }

  protected async confirmNumberChange(): Promise<void> {
    const v = this.validate();
    if (!v.ok) {
      this.askNumberChange.set(false);
      return;
    }
    await this.update(v.custom);
  }

  private async create(custom: Record<string, unknown> | undefined): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = await firstValueFrom(
        this.api.createMatter({
          clientId: this.client()!.id,
          matterNumber: this.number().trim(),
          name: this.name().trim(),
          isSensitive: this.isSensitive(),
          aiAllowed: this.aiAllowed(),
          formValues: custom,
        }),
      );
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      this.visible.set(false);
      this.saved.emit(saved);
    } catch (err) {
      this.showFailure(err);
    } finally {
      this.busy.set(false);
    }
  }

  private async update(custom: Record<string, unknown> | undefined): Promise<void> {
    let current = this.matter()!;
    const confirmLoss = this.lossAsked;
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.numberChanged()) {
        current = await firstValueFrom(
          this.api.changeMatterNumber(current.matterId, {
            number: this.number().trim(),
            rowVersion: current.rowVersion,
          }),
        );
        this.notify.success(`CM Number changed to ${current.matterRef}`);
      }
      const saved = await firstValueFrom(
        this.api.updateMatter(current.matterId, {
          name: this.name().trim(),
          isSensitive: this.isSensitive(),
          aiAllowed: this.aiAllowed(),
          confirmLossOfAccess: confirmLoss || undefined,
          formValues: custom,
          rowVersion: current.rowVersion,
        }),
      );
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.askNumberChange.set(false);
      this.visible.set(false);
      if (confirmLoss) {
        this.notify.success(
          `Matter ${saved.matterRef} saved. It is sensitive now and you no longer see it.`,
        );
        this.lostAccess.emit();
        return;
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      this.saved.emit(saved);
    } catch (err) {
      this.askNumberChange.set(false);
      if (err instanceof ApiError && err.code === 'SENSITIVE_CONFIRMATION_REQUIRED') {
        this.lossAsked = true;
        this.error.set(
          'You will no longer see this matter after it is marked sensitive. Press Save changes again to confirm.',
        );
        return;
      }
      this.showFailure(err);
    } finally {
      this.busy.set(false);
    }
  }

  private showFailure(err: unknown): void {
    const errors = serverFormErrors(err);
    const split = splitFormErrors(errors.fields);
    // The number endpoint names its field `number`; the form calls it `matterNumber`.
    const base = { ...split.base };
    if (base['number'] && !base['matterNumber']) base['matterNumber'] = base['number'];
    this.serverErrors.set(base);
    this.customErrors.set(split.form);
    this.summary.set(errors.summary);
    this.existingId.set(metaNumber(err, 'existingId'));
    if (errors.conflict) {
      this.error.set(
        this.isEdit()
          ? 'This matter was changed by someone else. Close the dialog and reopen it.'
          : 'This matter was changed by someone else.',
      );
    }
  }
}
