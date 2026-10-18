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
import { Router } from '@angular/router';
import { Button } from 'primeng/button';
import { DynamicForm, FormDefinition, ServerFieldError, errorSummary } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import {
  AssetResponse,
  AssetTypeResponse,
  AssetTypesClient,
  AssetsClient,
  FormsClient,
  MatterResponse,
  MattersClient,
} from '../../../api/generated/api-client';
import { NotificationService } from '../../../core/notify/notification.service';
import { serverFormErrors } from '../../../shared/forms/api-errors';
import { toFormDefinition } from '../../../shared/forms/form-schema';
import { HasUnsavedChanges } from '../../../shared/guards/unsaved-changes.guard';
import { AssetPickerContext } from '../../../shared/ui/asset-picker';
import { EntityPicker, PickerOption } from '../../../shared/ui/entity-picker';
import { TextField } from '../../../shared/ui/text-field';
import { ErrorReference } from '../../../shared/ui/error-reference';
import { PageHeader } from '../../../shared/ui/page-header';

type LoadState = 'loading' | 'ready' | 'error';

function matterOption(m: MatterResponse): PickerOption {
  return { id: m.matterId, label: `${m.matterRef} ${m.name}`, inactive: !m.isActive };
}

/** Text that looks like a URL must be an http(s) URL (UX S08: "URL validated if looks like URL"); anything else is a free reference. */
export function externalReferenceError(text: string): string | null {
  const value = text.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^www\./i.test(value)) return null;
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(value)
    ? null
    : 'Enter a valid URL (starting with http:// or https://).';
}

/**
 * Create and edit an Asset (UX S08). The Matter is chosen once (prefilled and locked when launched from a Matter) and so is the
 * type; both are locked on edit because an Asset belongs to exactly one Matter and its type drives its fields. The type-specific
 * fields are the type's PUBLISHED form rendered by the form engine; the server re-validates and drops hidden values. Editing sends
 * only a patch (changed values, `null` for cleared ones).
 */
@Component({
  selector: 'mf-asset-form-page',
  imports: [PageHeader, ErrorReference, Button, TextField, EntityPicker, DynamicForm],
  providers: [AssetPickerContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../../../shared/ui/page.scss',
  template: `
    <mf-page-header
      [crumbs]="[
        { label: 'Assets', link: '/assets' },
        { label: isEdit() ? original()?.displayName || 'Edit' : 'New' },
      ]"
      [heading]="isEdit() ? 'Edit asset' : 'New asset'"
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
      @if (original() && !original()!.isActive) {
        <div class="pg-banner" role="note" data-inactive-banner>
          This asset is inactive. Reactivate it on its detail page before editing.
        </div>
      }
      @if (conflict()) {
        <div class="pg-alert" role="alert" data-conflict>
          This asset was changed by someone else.
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
        </div>
      }

      <form class="pg-form" novalidate (submit)="$event.preventDefault(); save()">
        <mf-entity-picker
          inputId="asset-matter"
          label="Matter"
          placeholder="343-12 or matter name"
          help="An asset belongs to one matter and can't be moved later."
          [required]="true"
          [locked]="matterLocked()"
          [search]="searchMatters"
          [error]="matterError()"
          [(selected)]="matter"
        />

        <div class="pg-filter">
          <label for="asset-type">
            Asset type
            @if (!isEdit()) {
              <span class="mf-field__req">(required)</span>
            }
          </label>
          @if (isEdit()) {
            <span id="asset-type" data-type-locked>{{ original()?.assetTypeName }}</span>
          } @else {
            <select
              id="asset-type"
              class="mf-control pg-input"
              [attr.aria-invalid]="typeError() ? 'true' : null"
              [value]="typeId() ?? ''"
              (change)="chooseType($any($event.target).value)"
            >
              <option value="">Select a type...</option>
              @for (t of types(); track t.assetTypeId) {
                <option [value]="t.assetTypeId">{{ t.name }}</option>
              }
            </select>
            @if (typeError(); as e) {
              <p class="mf-field__error" role="alert">{{ e }}</p>
            }
          }
        </div>

        <mf-text-field
          inputId="asset-name"
          label="Display name"
          [required]="true"
          [maxLength]="300"
          [error]="nameError()"
          [(value)]="displayName"
        />

        <mf-text-field
          inputId="asset-reference"
          label="External reference / URL"
          help="A URL, workspace id or media label that identifies the asset elsewhere."
          [maxLength]="1000"
          [error]="referenceError()"
          [(value)]="externalReference"
        />

        <mf-text-field
          inputId="asset-description"
          label="Description"
          [multiline]="true"
          [maxLength]="2000"
          [error]="fieldError('description')"
          [(value)]="description"
        />

        @if (schema(); as definition) {
          <fieldset class="pg-fields" data-type-fields>
            <legend>{{ typeName() }} fields</legend>
            <mf-dynamic-form
              [definition]="definition"
              [values]="initialValues()"
              [serverErrors]="fieldErrors()"
              (valuesChange)="onValues($event)"
            />
          </fieldset>
        } @else if (typeId() && !isEdit()) {
          <p class="pg-muted" data-no-fields>This asset type has no extra fields.</p>
        }

        <div class="pg-actions mf-form-actions--sticky">
          <p-button
            type="submit"
            [label]="busy() ? 'Saving...' : isEdit() ? 'Save changes' : 'Create asset'"
            [disabled]="busy() || (isEdit() && original() && !original()!.isActive)"
          />
          <p-button label="Cancel" severity="secondary" (onClick)="cancel()" />
        </div>
      </form>
    }
  `,
  styles: `
    .pg-fields {
      display: grid;
      gap: var(--mf-s3);
      margin: 0;
      padding: var(--mf-s3) 0 0;
      border: 0;
      border-top: 1px solid var(--mf-border);
    }
    .pg-fields legend {
      padding: 0 var(--mf-s2) 0 0;
      font-weight: 600;
    }
  `,
})
export class AssetFormPage implements HasUnsavedChanges {
  /** Route parameter; absent when creating. */
  readonly assetId = input<string>();
  /** Query parameter: the Matter to create the Asset in. */
  readonly matterId = input<string>();

  private readonly api = inject(AssetsClient);
  private readonly typesApi = inject(AssetTypesClient);
  private readonly forms = inject(FormsClient);
  private readonly matters = inject(MattersClient);
  private readonly router = inject(Router);
  private readonly notify = inject(NotificationService);
  private readonly pickerContext = inject(AssetPickerContext);
  private readonly dynamicForm = viewChild(DynamicForm);

  protected readonly isEdit = computed(() => this.assetId() !== undefined);
  protected readonly matterLocked = computed(() => this.isEdit() || !!this.matterId());
  protected readonly state = signal<LoadState>('ready');
  protected readonly original = signal<AssetResponse | null>(null);
  protected readonly matter = signal<PickerOption | null>(null);
  protected readonly types = signal<AssetTypeResponse[]>([]);
  protected readonly typeId = signal<number | null>(null);
  protected readonly displayName = signal('');
  protected readonly externalReference = signal('');
  protected readonly description = signal('');
  protected readonly schema = signal<FormDefinition | null>(null);
  protected readonly initialValues = signal<Record<string, unknown>>({});
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverErrors = signal<Record<string, string>>({});
  protected readonly summary = signal<string[]>([]);
  protected readonly conflict = signal(false);
  protected readonly formTouched = signal(false);
  protected readonly fieldErrors = signal<ServerFieldError[]>([]);
  private values: Record<string, unknown> = {};
  private saved = false;

  protected readonly typeName = computed(
    () =>
      this.original()?.assetTypeName ??
      this.types().find((t) => t.assetTypeId === this.typeId())?.name ??
      'Type',
  );

  protected readonly searchMatters = async (query: string): Promise<PickerOption[]> => {
    const page = await firstValueFrom(
      this.matters.listMatters(
        query,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        8,
        undefined,
      ),
    );
    return page.items.map(matterOption);
  };

  protected readonly matterError = computed(() => {
    if (this.submitted() && !this.matter()) return 'Select a matter.';
    return this.fieldError('matterId');
  });

  protected readonly typeError = computed(() => {
    if (this.submitted() && !this.typeId()) return 'Select an asset type.';
    return this.fieldError('assetTypeId');
  });

  protected readonly nameError = computed(() => {
    if (this.submitted() && this.displayName().trim() === '') return 'Enter a display name.';
    return this.fieldError('displayName');
  });

  protected readonly referenceError = computed(
    () => externalReferenceError(this.externalReference()) ?? this.fieldError('externalReference'),
  );

  constructor() {
    effect(() => {
      const id = this.assetId();
      const preselected = this.matterId();
      untracked(() => {
        if (id !== undefined) {
          void this.load();
        } else {
          void this.loadTypes();
          if (preselected) void this.preselectMatter(Number(preselected));
        }
      });
    });
    // The picker offers Assets of the Matter being edited (ASSET_REF fields of the type's form).
    effect(() => this.pickerContext.matterId.set(this.matter()?.id ?? null));
  }

  hasUnsavedChanges(): boolean {
    if (this.saved) return false;
    const o = this.original();
    if (this.isEdit()) {
      return (
        !!o &&
        (this.displayName() !== o.displayName ||
          this.externalReference() !== (o.externalReference ?? '') ||
          this.description() !== (o.description ?? '') ||
          this.formTouched())
      );
    }
    return (
      this.displayName().trim() !== '' ||
      this.externalReference().trim() !== '' ||
      this.description().trim() !== '' ||
      this.formTouched()
    );
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
    this.formTouched.set(false);
    try {
      const asset = await firstValueFrom(this.api.getAsset(Number(this.assetId())));
      this.original.set(asset);
      this.displayName.set(asset.displayName);
      this.externalReference.set(asset.externalReference ?? '');
      this.description.set(asset.description ?? '');
      this.typeId.set(asset.assetTypeId);
      this.matter.set({
        id: asset.matterId,
        label: `${asset.matterRef} ${asset.matterName}`,
      });
      this.initialValues.set({ ...asset.formValues });
      this.values = { ...asset.formValues };
      await this.loadSchema(asset.publishedFormVersionId);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private async loadTypes(): Promise<void> {
    try {
      const page = await firstValueFrom(
        this.typesApi.listAssetTypes(undefined, undefined, true, 1, 100, undefined),
      );
      this.types.set(page.items);
    } catch {
      this.types.set([]);
    }
  }

  private async loadSchema(versionId: number | undefined): Promise<void> {
    if (versionId === undefined || versionId === null) {
      this.schema.set(null);
      return;
    }
    const detail = await firstValueFrom(this.forms.getFormVersionSchema(versionId));
    const definition = toFormDefinition(detail);
    this.schema.set(definition.fields.length > 0 ? definition : null);
  }

  private async preselectMatter(id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) return;
    try {
      this.matter.set(matterOption(await firstValueFrom(this.matters.getMatter(id))));
    } catch {
      // The picker simply stays empty; the user can search.
    }
  }

  protected async chooseType(value: string): Promise<void> {
    const id = value ? Number(value) : null;
    this.typeId.set(id);
    this.values = {};
    this.initialValues.set({});
    this.formTouched.set(false);
    const type = this.types().find((t) => t.assetTypeId === id);
    try {
      await this.loadSchema(type?.publishedFormVersionId);
    } catch {
      this.schema.set(null);
      this.summary.set(["We couldn't load the fields of that asset type."]);
    }
  }

  protected onValues(values: Record<string, unknown>): void {
    this.values = values;
    this.formTouched.set(true);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    this.serverErrors.set({});
    this.fieldErrors.set([]);
    this.summary.set([]);
    this.conflict.set(false);

    const problems: string[] = [];
    if (!this.matter()) problems.push('Select a matter.');
    if (!this.typeId()) problems.push('Select an asset type.');
    if (this.displayName().trim() === '') problems.push('Enter a display name.');
    const referenceProblem = externalReferenceError(this.externalReference());
    if (referenceProblem) problems.push(referenceProblem);

    // Reveals the type-specific errors inline and gives the values to send.
    // An existing asset whose type fields the user did not touch is saved without them, so a newly required field never blocks it.
    const untouchedEdit = this.isEdit() && !this.formTouched();
    const evaluation = untouchedEdit ? undefined : this.dynamicForm()?.validate();
    if (evaluation && evaluation.errors.length > 0) {
      const lines = errorSummary(this.schema()?.fields ?? [], evaluation.errors);
      problems.push(...(lines.length > 0 ? lines : ['Complete the highlighted fields.']));
    }
    if (problems.length > 0) {
      this.summary.set(problems);
      return;
    }

    const normalized = evaluation?.normalized ?? {};
    this.busy.set(true);
    try {
      const reference = this.externalReference().trim() || undefined;
      const description = this.description().trim() || undefined;
      const result = this.isEdit()
        ? await firstValueFrom(
            this.api.updateAsset(Number(this.assetId()), {
              displayName: this.displayName().trim(),
              externalReference: reference,
              description,
              formValues: this.schema() && !untouchedEdit ? this.patchOf(normalized) : undefined,
              rowVersion: this.original()!.rowVersion,
            }),
          )
        : await firstValueFrom(
            this.api.createAsset({
              matterId: this.matter()!.id,
              assetTypeId: this.typeId()!,
              displayName: this.displayName().trim(),
              externalReference: reference,
              description,
              formValues: this.schema() ? normalized : undefined,
            }),
          );
      this.saved = true;
      this.notify.success(`Asset ${result.displayName} saved`);
      if (result.droppedFields.length > 0) {
        this.notify.info(`Hidden values were not saved: ${result.droppedFields.join(', ')}.`);
      }
      await this.router.navigate(['/assets'], { queryParams: { selected: result.assetId } });
    } catch (err) {
      const errors = serverFormErrors(err);
      const base: Record<string, string> = {};
      const form: ServerFieldError[] = [];
      for (const [key, message] of Object.entries(errors.fields)) {
        if (key.startsWith('form:')) form.push({ fieldKey: key.slice(5), message });
        else base[key] = message;
      }
      this.serverErrors.set(base);
      this.fieldErrors.set(form);
      this.conflict.set(errors.conflict);
      const summary = [...Object.values(base), ...form.map((f) => f.message)];
      if (summary.length === 0 && errors.code && errors.code !== 'CONCURRENCY_CONFLICT') {
        summary.push(this.messageFor(errors.code));
      }
      this.summary.set(summary);
    } finally {
      this.busy.set(false);
    }
  }

  /** Changed values only: the submitted values plus `null` for known fields that were stored and are now empty or hidden. */
  private patchOf(normalized: Record<string, unknown>): Record<string, unknown> {
    const known = new Set(this.schema()?.fields.map((f) => f.key));
    const patch: Record<string, unknown> = { ...normalized };
    for (const key of Object.keys(this.original()?.formValues ?? {})) {
      if (known.has(key) && !(key in normalized)) patch[key] = null;
    }
    return patch;
  }

  private messageFor(code: string): string {
    switch (code) {
      case 'MATTER_INACTIVE':
        return "That matter is inactive, so assets can't be added to it.";
      case 'ASSET_TYPE_INACTIVE':
        return 'That asset type is inactive. Choose another type.';
      case 'ASSET_INACTIVE':
        return 'This asset is inactive. Reactivate it before editing.';
      case 'FORM_NOT_PUBLISHED':
        return "This asset type's fields are not published yet.";
      default:
        return 'Something went wrong. Try again.';
    }
  }

  protected cancel(): void {
    const id = this.assetId();
    const matter = this.matterId();
    void this.router.navigateByUrl(
      id ? `/assets?selected=${id}` : matter ? `/matters/${matter}?tab=assets` : '/assets',
    );
  }
}
