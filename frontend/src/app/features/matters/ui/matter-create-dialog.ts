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
import { NotificationService } from '../../../core/notify/notification.service';
import { metaNumber, serverFormErrors } from '../../../shared/forms/api-errors';
import { normalizeNumber } from '../../../shared/pipes/matter-ref.pipe';
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
 * Create a Matter in the shared pop-up dialog (MD-22, #1026; owner decision 2026-11-02): the client, the matter number (1 to 5 digits), the name, the
 * sensitive flag, AI allowed and the custom fields. Opened by "+ New matter" on the Matters list and by `/matters/new` (which the list turns into this
 * dialog). `clientId` preselects the client (a link from a Client page). After a save the dialog closes and `saved` carries the matter.
 */
@Component({
  selector: 'mf-matter-create-dialog',
  imports: [FormDialog, EntityPicker, NumberInput, TextField, CustomFieldsEditor, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  styles: `
    .mcd__form {
      display: flex;
      flex-direction: column;
      gap: var(--mf-s3);
    }
    .mcd__form .pg-field {
      display: grid;
      gap: var(--mf-s1);
    }
    .mcd__summary {
      margin-bottom: var(--mf-s3);
      padding: var(--mf-s2) var(--mf-s3);
      border: 1px solid var(--mf-sem-overdue-solid);
      border-radius: var(--mf-radius-md);
      background: var(--mf-sem-overdue-bg);
      color: var(--mf-sem-overdue-fg);
    }
  `,
  template: `
    <mf-form-dialog
      title="New matter"
      size="large"
      primaryLabel="Create matter"
      [busy]="busy()"
      [error]="error()"
      [dirty]="dirty()"
      [(visible)]="visible"
      (submitted)="save()"
    >
      @if (summary().length > 0) {
        <div class="mcd__summary" role="alert" data-summary>
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
      <form class="mcd__form" novalidate (submit)="$event.preventDefault(); save()">
        <mf-entity-picker
          inputId="matter-client"
          label="Client"
          placeholder="343 or Acme"
          [required]="true"
          [search]="searchClients"
          [error]="clientError()"
          [(selected)]="client"
        />
        <mf-number-input
          inputId="matter-number"
          label="Matter number"
          noun="matter number"
          help="Enter 1 to 5 digits, as issued by the firm's main system."
          [extraPreview]="combinedPreview()"
          [showErrors]="submitted()"
          [serverError]="fieldError('matterNumber')"
          [(value)]="number"
        />
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
          [serverErrors]="customErrors()"
          (touched)="customTouched.set(true)"
        />
      </form>
    </mf-form-dialog>
  `,
})
export class MatterCreateDialog {
  readonly visible = model(false);
  /** Preselects the client (a link from a Client page); null for none. */
  readonly clientId = input<number | null>(null);
  readonly saved = output<MatterResponse>();

  private readonly api = inject(MattersClient);
  private readonly clients = inject(ClientsClient);
  private readonly notify = inject(NotificationService);
  private readonly customEditor = viewChild(CustomFieldsEditor);

  protected readonly aiOptions = AI_OPTIONS;
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
  protected readonly customErrors = signal<ServerFieldError[]>([]);
  protected readonly customTouched = signal(false);

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

  /** "Combined reference: 00343-00012", updated live once both numbers are valid. */
  protected readonly combinedPreview = computed(() => {
    const clientNo = this.client()?.label.split(' ')[0];
    const matterNo = normalizeNumber(this.number());
    return clientNo && matterNo ? `Combined reference: ${clientNo}-${matterNo}` : '';
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
  protected readonly dirty = computed(
    () =>
      this.number().trim() !== '' ||
      this.name().trim() !== '' ||
      this.isSensitive() ||
      this.customTouched(),
  );

  constructor() {
    // Each opening starts empty, so a cancelled form never shows in the next one.
    effect(() => {
      if (!this.visible()) return;
      const preselect = this.clientId();
      untracked(() => {
        this.client.set(null);
        this.number.set('');
        this.name.set('');
        this.isSensitive.set(false);
        this.aiAllowed.set(MatterAiAllowed.No);
        this.customTouched.set(false);
        this.customErrors.set([]);
        this.serverErrors.set({});
        this.summary.set([]);
        this.existingId.set(null);
        this.submitted.set(false);
        this.error.set('');
        void this.loadCustomForm();
        if (preselect) void this.preselectClient(preselect);
      });
    });
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
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

  protected async save(): Promise<void> {
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
    const custom = this.customEditor()?.collect();
    problems.push(...customFieldsProblems(custom));
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

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
          formValues: custom?.values,
        }),
      );
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      this.visible.set(false);
      this.saved.emit(saved);
    } catch (err) {
      const errors = serverFormErrors(err);
      const split = splitFormErrors(errors.fields);
      this.serverErrors.set(split.base);
      this.customErrors.set(split.form);
      this.summary.set(errors.summary);
      this.existingId.set(metaNumber(err, 'existingId'));
      if (errors.conflict) this.error.set('This matter was changed by someone else.');
    } finally {
      this.busy.set(false);
    }
  }
}
