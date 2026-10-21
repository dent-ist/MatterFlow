import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, from, throwError } from 'rxjs';
import type { DesignerDefinition, DesignerField, FormOption } from 'form-engine';
import {
  AssetTypesClient,
  FormFieldModel,
  FormOptionModel,
  FormOwnerKind,
  FormVersionDetail,
  FormVersionStatus as ServerStatus,
  FormVersionSummary as ServerSummary,
  FormsClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import {
  FormDesignerApi,
  FormOwner,
  FormVersion,
  FormVersionStatus,
  FormVersionSummary,
} from '../task-types/form-designer-api';

const STATUS: Record<ServerStatus, FormVersionStatus> = {
  [ServerStatus.Draft]: 'DRAFT',
  [ServerStatus.Published]: 'PUBLISHED',
  [ServerStatus.Retired]: 'RETIRED',
};

/** The answer for an address that names no record: the designer shows its "We couldn't find that ..." state (#541). */
export function notFoundError(message: string): ApiError {
  const response = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
  return new ApiError(404, 'NOT_FOUND', message, undefined, response);
}

const present = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/** A server field as the designer edits it (`null` and absent are the same thing). */
export function toDesignerField(f: FormFieldModel): DesignerField {
  const out: DesignerField = { key: f.key, control: f.control as DesignerField['control'] };
  // A HELP_TEXT field has no label of its own (the text is the help text); the server stores a placeholder label.
  if (f.control !== 'HELP_TEXT') out.label = f.label;
  if (f.helpText) out.helpText = f.helpText;
  if (f.required) out.required = true;
  if (f.section) out.section = f.section;
  if (present(f.validation)) out.validation = f.validation as DesignerField['validation'];
  if (present(f.showWhen)) out.showWhen = f.showWhen as DesignerField['showWhen'];
  if (present(f.requiredWhen)) out.requiredWhen = f.requiredWhen as DesignerField['requiredWhen'];
  if (present(f.defaultValue)) out.defaultValue = f.defaultValue as DesignerField['defaultValue'];
  if (f.options?.length) {
    out.options = f.options.map((o): FormOption => ({
      key: o.key,
      label: o.label,
      ...(present(o.availableWhen)
        ? { availableWhen: o.availableWhen as FormOption['availableWhen'] }
        : {}),
    }));
  }
  return out;
}

/** A designer field as the server stores it; `filterable` keeps the filter flag the designer does not edit. */
export function toServerField(f: DesignerField, filterable: ReadonlySet<string>): FormFieldModel {
  return {
    key: f.key,
    label: f.label?.trim() || (f.control === 'HELP_TEXT' ? 'Help text' : f.key),
    control: f.control,
    helpText: f.helpText || undefined,
    section: f.section || undefined,
    required: f.required === true,
    defaultValue: f.defaultValue as FormFieldModel['defaultValue'],
    validation: (f.validation ?? undefined) as FormFieldModel['validation'],
    showWhen: (f.showWhen ?? undefined) as FormFieldModel['showWhen'],
    requiredWhen: (f.requiredWhen ?? undefined) as FormFieldModel['requiredWhen'],
    isFilterable: filterable.has(f.key),
    options: f.options?.map((o) => ({
      key: o.key,
      label: o.label?.trim() || o.key,
      availableWhen: (o.availableWhen ?? undefined) as FormOptionModel['availableWhen'],
    })),
  };
}

/**
 * `FormDesignerApi` over the forms endpoints for the form of one Asset Type (owner id = the Asset Type id). Remembers the row
 * version of each draft it has loaded so saves carry the concurrency token, and the filterable flags the designer does not show.
 */
@Injectable()
export class AssetTypeFormDesignerApi extends FormDesignerApi {
  protected readonly forms = inject(FormsClient);
  private readonly types = inject(AssetTypesClient);
  private readonly definitions = new Map<string, number>();
  private readonly rowVersions = new Map<number, string>();

  /** The row version the designer last saw; the server requires one on every save and publish, so read it when it was never loaded. */
  private async rowVersionOf(versionId: number): Promise<string> {
    return (
      this.rowVersions.get(versionId) ??
      (await firstValueFrom(this.forms.getFormVersionSchema(versionId))).version.rowVersion
    );
  }
  private readonly filterable = new Map<number, Set<string>>();

  override getOwner(ownerId: string): Observable<FormOwner> {
    // `/admin/asset-types/abc/form` names no asset type: the same 404 as an id that does not exist.
    if (!/^\d+$/.test(ownerId)) {
      return throwError(() => notFoundError(`There is no asset type '${ownerId}'.`));
    }
    return from(
      firstValueFrom(this.types.getAssetType(Number(ownerId))).then((t) => ({
        id: ownerId,
        name: t.name,
      })),
    );
  }

  override listVersions(ownerId: string): Observable<FormVersionSummary[]> {
    return from(
      this.definitionOf(ownerId).then(async (definitionId) => {
        const versions = await firstValueFrom(this.forms.listFormVersions(definitionId));
        return versions.map((v) => this.summary(v));
      }),
    );
  }

  override getVersion(ownerId: string, versionId: string): Observable<FormVersion> {
    return from(
      firstValueFrom(this.forms.getFormVersionSchema(Number(versionId))).then((d) =>
        this.version(d),
      ),
    );
  }

  override createDraft(ownerId: string): Observable<FormVersion> {
    return from(
      this.definitionOf(ownerId).then(async (definitionId) => {
        const existing = (await firstValueFrom(this.forms.listFormVersions(definitionId))).find(
          (v) => v.status === ServerStatus.Draft,
        );
        const detail = existing
          ? await firstValueFrom(this.forms.getFormVersionSchema(existing.formVersionId))
          : await firstValueFrom(this.forms.createFormDraft(definitionId, {}));
        return this.version(detail);
      }),
    );
  }

  override saveDraft(
    ownerId: string,
    versionId: string,
    definition: DesignerDefinition,
  ): Observable<FormVersion> {
    return from(this.save(ownerId, Number(versionId), definition, undefined));
  }

  override publish(ownerId: string, versionId: string, note?: string): Observable<FormVersion> {
    return from(
      (async () => {
        const id = Number(versionId);
        const definitionId = await this.definitionOf(ownerId);
        if (note?.trim()) {
          // The publish call carries no note; notes are saved with the draft.
          const draft = await firstValueFrom(this.forms.getFormVersionSchema(id));
          await this.save(ownerId, id, { fields: draft.fields.map(toDesignerField) }, note.trim());
        }
        const detail = await firstValueFrom(
          this.forms.publishFormVersion(definitionId, id, await this.rowVersionOf(id)),
        );
        return this.version(detail);
      })(),
    );
  }

  override retire(ownerId: string, versionId: string): Observable<FormVersion> {
    return from(
      this.definitionOf(ownerId).then(async (definitionId) =>
        this.version(
          await firstValueFrom(this.forms.retireFormVersion(definitionId, Number(versionId))),
        ),
      ),
    );
  }

  private async save(
    ownerId: string,
    versionId: number,
    definition: DesignerDefinition,
    notes: string | undefined,
  ): Promise<FormVersion> {
    const definitionId = await this.definitionOf(ownerId);
    const filterable = this.filterable.get(versionId) ?? new Set<string>();
    const detail = await firstValueFrom(
      this.forms.saveFormDraft(definitionId, versionId, {
        fields: definition.fields.map((f) => toServerField(f, filterable)),
        notes,
        rowVersion: await this.rowVersionOf(versionId),
      }),
    );
    return this.version(detail);
  }

  private async definitionOf(ownerId: string): Promise<number> {
    const known = this.definitions.get(ownerId);
    if (known !== undefined) return known;
    const definitionId = await this.findDefinitionId(ownerId);
    this.definitions.set(ownerId, definitionId);
    return definitionId;
  }

  /** The form definition of the owner; subclasses for other owner kinds override it. */
  protected async findDefinitionId(ownerId: string): Promise<number> {
    const definition = await firstValueFrom(
      this.forms.findFormDefinition(FormOwnerKind.AssetType, Number(ownerId)),
    );
    return definition.formDefinitionId;
  }

  private summary(v: ServerSummary): FormVersionSummary {
    return {
      id: String(v.formVersionId),
      versionNo: v.versionNo,
      status: STATUS[v.status],
      note: v.notes ?? undefined,
      updatedAtUtc: v.publishedAtUtc ?? v.createdAtUtc,
    };
  }

  private version(detail: FormVersionDetail): FormVersion {
    const id = detail.version.formVersionId;
    this.rowVersions.set(id, detail.version.rowVersion);
    this.filterable.set(id, new Set(detail.fields.filter((f) => f.isFilterable).map((f) => f.key)));
    return {
      ...this.summary(detail.version),
      definition: { fields: detail.fields.map(toDesignerField) },
    };
  }
}
