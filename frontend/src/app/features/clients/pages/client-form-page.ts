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
import { ClientResponse, ClientsClient } from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { metaNumber, serverFormErrors } from '../../../shared/forms/api-errors';
import {
  CustomFieldsEditor,
  customFieldsProblem,
  splitFormErrors,
} from '../../../shared/ui/custom-fields';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog';
import { NumberInput, numberProblem } from '../../../shared/ui/number-input';
import { TextField } from '../../../shared/ui/text-field';

type LoadState = 'loading' | 'ready' | 'error';

/** Create and edit a Client (UX S05). The number is locked on edit; "Change number" is a restricted, audited action. */
@Component({
  selector: 'mf-client-form-page',
  imports: [
    RouterLink,
    CustomFieldsEditor,
    Button,
    NumberInput,
    TextField,
    ConfirmDialog,
    HasPermissionDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <header class="pg-head">
      <div>
        <p class="pg-crumbs">
          <a routerLink="/clients">Clients</a> &gt; {{ isEdit() ? 'Edit' : 'New' }}
        </p>
        <h1 class="pg-title">{{ isEdit() ? 'Edit Client' : 'New Client' }}</h1>
      </div>
    </header>

    @if (state() === 'loading') {
      <div class="pg-state" role="status" aria-busy="true">Loading the client...</div>
    } @else if (state() === 'error') {
      <div class="pg-alert" role="alert">
        We couldn't load that client.
        <p-button label="Retry" severity="secondary" (onClick)="load()" />
      </div>
    } @else {
      @if (conflict()) {
        <div class="pg-alert" role="alert" data-conflict>
          This client was changed by someone else.
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
            <a class="pg-link" [routerLink]="['/clients', existing]">View the existing client</a>
          }
        </div>
      }

      <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
        @if (isEdit()) {
          <div class="pg-filter">
            <span class="pg-label"><strong>Client number</strong></span>
            <span class="pg-mono" data-locked-number>{{ original()?.clientNumber }}</span>
            <span class="pg-reason">Locked after creation.</span>
            <p-button
              *mfHasPermission="'Client.EditNumber'"
              label="Change number"
              severity="secondary"
              size="small"
              (onClick)="openChangeNumber()"
            />
          </div>
        } @else {
          <mf-number-input
            inputId="client-number"
            label="Client number"
            noun="client number"
            help="Enter 1 to 5 digits, as issued by the firm's main system."
            [showErrors]="submitted()"
            [serverError]="fieldError('clientNumber')"
            [(value)]="number"
          />
        }

        <mf-text-field
          inputId="client-name"
          label="Client name"
          [required]="true"
          [maxLength]="200"
          [error]="nameError()"
          [(value)]="name"
        />

        @if (isEdit()) {
          <fieldset>
            <legend>Status</legend>
            <label class="pg-radio">
              <input
                type="radio"
                name="client-status"
                [checked]="isActive()"
                (change)="isActive.set(true)"
              />
              Active
            </label>
            <label class="pg-radio">
              <input
                type="radio"
                name="client-status"
                [checked]="!isActive()"
                (change)="isActive.set(false)"
              />
              Inactive
            </label>
            @if (!isActive()) {
              <p class="pg-reason">
                An inactive client can't receive new matters. Its existing matters and tasks keep
                working.
              </p>
            }
          </fieldset>
        }

        <mf-custom-fields-editor
          [versionId]="customVersionId()"
          [values]="customValues()"
          [serverErrors]="customErrors()"
          (touched)="customTouched.set(true)"
        />

        <div class="pg-actions">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : 'Save client'"
            [disabled]="busy()"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
        </div>
      </form>
    }

    <mf-confirm-dialog
      title="Change client number"
      confirmLabel="Change number"
      [danger]="true"
      [busy]="busy()"
      [(visible)]="changeNumberOpen"
      (confirmed)="changeNumber()"
    >
      <p data-number-warning>
        Changing this number changes how matters are named in emails, workspaces and folders. This
        change is recorded.
      </p>
      <mf-number-input
        inputId="new-client-number"
        label="New client number"
        noun="client number"
        [showErrors]="numberSubmitted()"
        [serverError]="fieldError('number')"
        [(value)]="newNumber"
      />
    </mf-confirm-dialog>
  `,
})
export class ClientFormPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly clientId = input<string>();

  private readonly api = inject(ClientsClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);

  protected readonly isEdit = computed(() => this.clientId() !== undefined);
  protected readonly state = signal<LoadState>('ready');
  protected readonly original = signal<ClientResponse | null>(null);
  protected readonly number = signal('');
  protected readonly name = signal('');
  protected readonly isActive = signal(true);
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

  protected readonly nameError = computed(() => {
    if (this.submitted() && this.name().trim() === '') return 'Enter a client name.';
    return this.fieldError('name');
  });

  constructor() {
    effect(() => {
      const id = this.clientId();
      untracked(() => {
        if (id !== undefined) void this.load();
        else void this.loadCustomForm();
      });
    });
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const o = this.original();
    if (this.isEdit()) {
      return (
        !!o && (this.name() !== o.name || this.isActive() !== o.isActive || this.customTouched())
      );
    }
    return this.number().trim() !== '' || this.name().trim() !== '' || this.customTouched();
  }

  /** The published custom-field form to render when creating (editing uses the one on the record). */
  private async loadCustomForm(): Promise<void> {
    try {
      const form = await firstValueFrom(this.api.getClientCustomFieldForm());
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

  async load(): Promise<void> {
    const id = Number(this.clientId());
    this.state.set('loading');
    this.conflict.set(false);
    this.summary.set([]);
    try {
      const client = await firstValueFrom(this.api.getClient(id));
      this.apply(client);
      this.state.set('ready');
    } catch {
      this.state.set('error');
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
      const problem = numberProblem(this.number(), 'client number');
      if (problem) problems.push(problem);
    }
    if (this.name().trim() === '') problems.push('Enter a client name.');
    this.customErrors.set([]);
    const custom = this.customEditor()?.collect(this.isEdit() ? this.customValues() : undefined);
    const customProblem = customFieldsProblem(custom);
    if (customProblem) problems.push(customProblem);
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

    this.busy.set(true);
    try {
      const saved = this.isEdit()
        ? await firstValueFrom(
            this.api.updateClient(Number(this.clientId()), {
              name: this.name().trim(),
              isActive: this.isActive(),
              formValues: custom?.values,
              rowVersion: this.original()!.rowVersion,
            }),
          )
        : await firstValueFrom(
            this.api.createClient({
              clientNumber: this.number().trim(),
              name: this.name().trim(),
              formValues: custom?.values,
            }),
          );
      this.saved = true;
      if (saved.droppedFields.length > 0) {
        this.notify.info(`Hidden custom values were not saved: ${saved.droppedFields.join(', ')}.`);
      }
      this.notify.success(`Client ${saved.clientNumber} saved`);
      await this.router.navigate(['/clients', saved.clientId]);
    } catch (err) {
      this.showServerError(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected fieldError(key: string): string | null {
    return this.serverErrors()[key] ?? null;
  }

  protected cancel(): void {
    const id = this.clientId();
    void this.router.navigateByUrl(id ? `/clients/${id}` : '/clients');
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
    if (numberProblem(this.newNumber(), 'client number')) return;

    this.busy.set(true);
    try {
      const updated = await firstValueFrom(
        this.api.changeClientNumber(Number(this.clientId()), {
          number: this.newNumber().trim(),
          rowVersion: this.original()!.rowVersion,
        }),
      );
      // Keep any edits to name/status the user already made; only the number and token change.
      this.original.set({
        ...this.original()!,
        ...updated,
        name: this.original()!.name,
        isActive: this.original()!.isActive,
      });
      this.changeNumberOpen.set(false);
      this.notify.success(`Client number changed to ${updated.clientNumber}`);
    } catch (err) {
      const errors = serverFormErrors(err);
      this.serverErrors.set(errors.fields);
      this.conflict.set(errors.conflict);
      if (errors.conflict) this.changeNumberOpen.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  private apply(client: ClientResponse): void {
    this.original.set(client);
    this.applyCustom(client);
    this.name.set(client.name);
    this.isActive.set(client.isActive);
  }

  private showServerError(err: unknown): void {
    const errors = serverFormErrors(err);
    const split = splitFormErrors(errors.fields);
    this.serverErrors.set(split.base);
    this.customErrors.set(split.form);
    this.summary.set(errors.summary);
    this.conflict.set(errors.conflict);
    this.existingId.set(metaNumber(err, 'existingId'));
  }
}
