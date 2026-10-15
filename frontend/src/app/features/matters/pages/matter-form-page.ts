import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button } from 'primeng/button';
import type { ServerFieldError } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  ClientResponse,
  ClientsClient,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { metaNumber, serverFormErrors } from '../../../shared/forms/api-errors';
import {
  CustomFieldsEditor,
  customFieldsProblems,
  splitFormErrors,
} from '../../../shared/ui/custom-fields';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { normalizeNumber } from '../../../shared/pipes/matter-ref.pipe';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { MatterRef } from '../../../shared/ui/matter-ref';
import { NumberInput, numberProblem } from '../../../shared/ui/number-input';
import { TextField } from '../../../shared/ui/text-field';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

function clientOption(c: ClientResponse): PickerOption {
  return { id: c.clientId, label: `${c.clientNumber} ${c.name}`, inactive: !c.isActive };
}

/** Create and edit a Matter (UX S06). The Client is locked after creation; the number is locked with an audited "Change number" action. */
@Component({
  selector: 'mf-matter-form-page',
  imports: [
    PageHeader,
    ErrorReference,
    RouterLink,
    CustomFieldsEditor,
    Button,
    NumberInput,
    TextField,
    EntityPicker,
    ConfirmDialog,
    HasPermissionDirective,
    MatterRef,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      [crumbs]="[
        { label: 'Matters', link: '/matters' },
        { label: isEdit() ? original()?.name || 'Edit' : 'New' },
      ]"
      [heading]="isEdit() ? 'Edit matter' : 'New matter'"
    />

    @if (state() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true">Loading...</div>
    } @else if (state() === 'error') {
      <div class="pg-alert" role="alert">
        We couldn't load that.
        <mf-error-reference />
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else {
      @if (conflict()) {
        <div class="pg-alert" role="alert" data-conflict>
          This matter was changed by someone else.
          <p-button label="Reload latest" severity="secondary" (onClick)="load()" />
        </div>
      }
      @if (summary().length > 0) {
        <div class="pg-summary" role="alert" data-summary>
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

      <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
        @if (isEdit()) {
          <div class="pg-filter">
            <span class="pg-label">Client</span>
            <span data-locked-client>
              <span class="pg-mono">{{ original()?.clientNumber }}</span>
              {{ original()?.clientName }}
            </span>
            <span class="pg-reason">The client can't change after creation.</span>
          </div>
          <div class="pg-filter">
            <span class="pg-label">Matter number</span>
            <span class="pg-mono" data-locked-number>{{ original()?.matterNumber }}</span>
            <span class="pg-reason"
              >Combined reference: <mf-matter-ref [value]="original()?.matterRef" [copy]="false"
            /></span>
            <p-button
              *mfHasPermission="'Matter.EditNumber'"
              label="Change number"
              severity="secondary"
              size="small"
              (onClick)="openChangeNumber()"
            />
          </div>
        } @else {
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
        }

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
            (change)="isSensitive.set($any($event.target).checked)"
          />
          <span>
            Sensitive matter
            <span class="pg-reason" style="display: block"
              >Shows a warning banner on this matter's tasks, assets and search results. It does not
              restrict who can see them.</span
            >
          </span>
        </label>

        <mf-custom-fields-editor
          [versionId]="customVersionId()"
          [values]="customValues()"
          [serverErrors]="customErrors()"
          (touched)="customTouched.set(true)"
        />

        <div class="pg-actions">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : isEdit() ? 'Save changes' : 'Create matter'"
            [disabled]="busy()"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
        </div>
      </form>
    }

    <mf-confirm-dialog
      title="Change matter number"
      confirmLabel="Change number"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="changeNumberOpen"
      (confirmed)="changeNumber()"
    >
      <p data-number-warning>
        Changing this number changes how this matter is named in emails, workspaces and folders.
        This change is recorded.
      </p>
      <mf-number-input
        inputId="new-matter-number"
        label="New matter number"
        noun="matter number"
        [showErrors]="numberSubmitted()"
        [serverError]="fieldError('number')"
        [(value)]="newNumber"
      />
    </mf-confirm-dialog>
  `,
})
export class MatterFormPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly matterId = input<string>();
  /** Query parameter: preselects the Client when creating from a Client page. */
  readonly clientId = input<string>();

  private readonly api = inject(MattersClient);
  private readonly clients = inject(ClientsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  protected readonly isEdit = computed(() => this.matterId() !== undefined);
  protected readonly state = signal<LoadState>('ready');
  protected readonly original = signal<MatterResponse | null>(null);
  protected readonly client = signal<PickerOption | null>(null);
  protected readonly number = signal('');
  protected readonly name = signal('');
  protected readonly isSensitive = signal(false);
  protected readonly busy = signal(false);
  private readonly customEditor = viewChild(CustomFieldsEditor);
  protected readonly customVersionId = signal<number | null>(null);
  protected readonly customValues = signal<Record<string, unknown>>({});
  protected readonly customErrors = signal<ServerFieldError[]>([]);
  protected readonly customTouched = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly existingId = signal<number | null>(null);
  protected readonly changeNumberOpen = signal(false);
  protected readonly newNumber = signal('');
  protected readonly numberSubmitted = signal(false);
  private saved = false;

  protected readonly searchClients = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(this.clients.listClients(query, undefined, 1, 8, undefined));
    return page.items.map(clientOption);
  };

  /** "Combined reference: 00343-00012", updated live once both numbers are valid. */
  protected readonly combinedPreview = computed(() => {
    const pick = this.client();
    const clientNo = pick?.label.split(' ')[0];
    const matterNo = normalizeNumber(this.number());
    return clientNo && matterNo ? `Combined reference: ${clientNo}-${matterNo}` : '';
  });

  protected readonly clientError = computed(() => {
    if (this.submitted() && !this.client()) return 'Select a client.';
    return this.fieldError('clientId');
  });

  protected readonly nameError = computed(() => {
    if (this.submitted() && this.name().trim() === '') return 'Enter a matter name.';
    return this.fieldError('name');
  });

  constructor() {
    effect(() => {
      const id = this.matterId();
      const preselected = this.clientId();
      untracked(() => {
        if (id !== undefined) void this.load();
        else {
          void this.loadCustomForm();
          if (preselected) void this.preselectClient(Number(preselected));
        }
      });
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const o = this.original();
    if (this.isEdit()) {
      return (
        !!o &&
        (this.name() !== o.name || this.isSensitive() !== o.isSensitive || this.customTouched())
      );
    }
    return this.number().trim() !== '' || this.name().trim() !== '' || this.customTouched();
  }

  /** The published custom-field form to render when creating (editing uses the one on the record). */
  private async loadCustomForm(): Promise<void> {
    try {
      const form = await firstValueFrom(this.api.getMatterCustomFieldForm());
      this.customVersionId.set(form.publishedFormVersionId ?? null);
    } catch {
      this.customVersionId.set(null); // no custom fields section
    }
  }

  private applyCustom(record: {
    publishedFormVersionId?: number;
    formValues?: Record<string, unknown>;
  }): void {
    this.customVersionId.set(record.publishedFormVersionId ?? null);
    this.customValues.set({ ...(record.formValues ?? {}) });
    this.customTouched.set(false);
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) event.preventDefault();
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  async load(): Promise<void> {
    this.state.set('loading');
    this.conflict.set(false);
    this.summary.set([]);
    try {
      const matter = await firstValueFrom(this.api.getMatter(Number(this.matterId())));
      this.original.set(matter);
      this.applyCustom(matter);
      this.name.set(matter.name);
      this.isSensitive.set(matter.isSensitive);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private async preselectClient(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      this.client.set(clientOption(await firstValueFrom(this.clients.getClient(id))));
    } catch {
      // The picker simply stays empty; the user can search.
    }
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.summary.set([]);
    this.conflict.set(false);
    this.existingId.set(null);

    const problems: string[] = [];
    if (!this.isEdit()) {
      if (!this.client()) problems.push('Select a client.');
      const problem = numberProblem(this.number(), 'matter number');
      if (problem) problems.push(problem);
    }
    if (this.name().trim() === '') problems.push('Enter a matter name.');
    this.customErrors.set([]);
    const custom = this.customEditor()?.collect(this.isEdit() ? this.customValues() : undefined);
    problems.push(...customFieldsProblems(custom));
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

    this.busy.set(true);
    try {
      const saved = this.isEdit()
        ? await firstValueFrom(
            this.api.updateMatter(Number(this.matterId()), {
              name: this.name().trim(),
              isSensitive: this.isSensitive(),
              formValues: custom?.values,
              rowVersion: this.original()!.rowVersion,
            }),
          )
        : await firstValueFrom(
            this.api.createMatter({
              clientId: this.client()!.id,
              matterNumber: this.number().trim(),
              name: this.name().trim(),
              isSensitive: this.isSensitive(),
              formValues: custom?.values,
            }),
          );
      this.saved = true;
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.notify.success(`Matter ${saved.matterRef} saved`);
      await this.router.navigate(['/matters', saved.matterId]);
    } catch (err) {
      const errors = serverFormErrors(err);
      const split = splitFormErrors(errors.fields);
      this.serverErrors.set(split.base);
      this.customErrors.set(split.form);
      this.summary.set(errors.summary);
      this.conflict.set(errors.conflict);
      this.existingId.set(metaNumber(err, 'existingId'));
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    const id = this.matterId();
    void this.router.navigateByUrl(id ? `/matters/${id}` : '/matters');
  }

  protected openChangeNumber(): void {
    this.newNumber.set('');
    this.numberSubmitted.set(false);
    this.serverErrors.set({});
    this.changeNumberOpen.set(true);
  }

  protected async changeNumber(): Promise<void> {
    this.numberSubmitted.set(true);
    this.serverErrors.set({});
    if (numberProblem(this.newNumber(), 'matter number')) return;

    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.changeMatterNumber(Number(this.matterId()), {
          number: this.newNumber().trim(),
          rowVersion: this.original()!.rowVersion,
        }),
      );
      const o = this.original()!;
      this.original.set({ ...updated, name: o.name, isSensitive: o.isSensitive });
      this.changeNumberOpen.set(false);
      this.notify.success(`Matter number changed to ${updated.matterRef}`);
    } catch (err) {
      const errors = serverFormErrors(err);
      this.serverErrors.set(errors.fields);
      this.conflict.set(errors.conflict);
      if (errors.conflict) this.changeNumberOpen.set(false);
    } finally {
      this.busy.set(false);
    }
  }
}
