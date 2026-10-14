import { Injectable, inject } from '@angular/core';
import { DesignerField } from 'form-engine';
import { Observable, catchError, from, map, switchMap, throwError } from 'rxjs';
import {
  FormFieldModel,
  FormVersionDetail,
  FormVersionStatus as WireStatus,
  FormVersionSummary as WireSummary,
  FormsClient,
  StepDefinitionsClient,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import {
  FormDesignerApi,
  FormOwner,
  FormVersion,
  FormVersionStatus,
  FormVersionSummary,
} from '../task-types/form-designer-api';

const STATUS: Record<WireStatus, FormVersionStatus> = {
  [WireStatus.Draft]: 'DRAFT',
  [WireStatus.Published]: 'PUBLISHED',
  [WireStatus.Retired]: 'RETIRED',
};

function toSummary(v: WireSummary): FormVersionSummary {
  return {
    id: String(v.formVersionId),
    versionNo: v.versionNo,
    status: STATUS[v.status],
    note: v.notes,
    updatedAtUtc: v.publishedAtUtc ?? v.createdAtUtc,
  };
}

/** The designer's field shape is the wire shape of the form contract, so fields pass through unchanged. */
const toDesigner = (f: FormFieldModel): DesignerField => f as unknown as DesignerField;
const toWire = (f: DesignerField): FormFieldModel => f as unknown as FormFieldModel;

/**
 * `FormDesignerApi` for the input form of a library step (UX S15): the owner id is the Step Definition id and the form
 * definition is the one provisioned with the step. Backed by the Forms endpoints, so versions, publish and retire are the server's.
 */
@Injectable()
export class StepFormDesignerApi extends FormDesignerApi {
  private readonly steps = inject(StepDefinitionsClient);
  private readonly forms = inject(FormsClient);

  /** Row versions of the versions loaded so far, sent back on save and publish for concurrency. */
  private readonly rowVersions = new Map<string, string>();

  override getOwner(ownerId: string): Observable<FormOwner> {
    return this.steps
      .getStepDefinition(Number(ownerId))
      .pipe(map((s) => ({ id: String(s.stepDefinitionId), name: s.title })));
  }

  override listVersions(ownerId: string): Observable<FormVersionSummary[]> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) => this.forms.listFormVersions(id)),
      map((list) => {
        list.forEach((v) => this.rowVersions.set(String(v.formVersionId), v.rowVersion));
        return list.map(toSummary).sort((a, b) => b.versionNo - a.versionNo);
      }),
    );
  }

  override getVersion(_ownerId: string, versionId: string): Observable<FormVersion> {
    return this.forms.getFormVersionSchema(Number(versionId)).pipe(map((d) => this.toVersion(d)));
  }

  override createDraft(ownerId: string): Observable<FormVersion> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) => this.forms.createFormDraft(id, {})),
      map((d) => this.toVersion(d)),
      catchError((e: unknown) =>
        e instanceof ApiError && e.code === 'FORM_DRAFT_EXISTS'
          ? from(this.existingDraft(ownerId))
          : throwError(() => e),
      ),
    );
  }

  override saveDraft(
    ownerId: string,
    versionId: string,
    definition: { fields: DesignerField[] },
  ): Observable<FormVersion> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) =>
        this.forms.saveFormDraft(id, Number(versionId), {
          fields: definition.fields.map(toWire),
          rowVersion: this.rowVersions.get(versionId),
        }),
      ),
      map((d) => this.toVersion(d)),
    );
  }

  override publish(ownerId: string, versionId: string): Observable<FormVersion> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) =>
        this.forms.publishFormVersion(id, Number(versionId), this.rowVersions.get(versionId)),
      ),
      map((d) => this.toVersion(d)),
    );
  }

  override retire(ownerId: string, versionId: string): Observable<FormVersion> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) => this.forms.retireFormVersion(id, Number(versionId))),
      map((d) => this.toVersion(d)),
    );
  }

  private definitionId(ownerId: string): Observable<number> {
    return this.steps.getStepDefinition(Number(ownerId)).pipe(
      map((s) => {
        if (s.formDefinitionId === undefined) throw new Error('This step has no input form.');
        return s.formDefinitionId;
      }),
    );
  }

  private async existingDraft(ownerId: string): Promise<FormVersion> {
    const versions = await new Promise<FormVersionSummary[]>((resolve, reject) =>
      this.listVersions(ownerId).subscribe({ next: resolve, error: reject }),
    );
    const draft = versions.find((v) => v.status === 'DRAFT');
    if (!draft) throw new Error('The draft could not be found.');
    return new Promise<FormVersion>((resolve, reject) =>
      this.getVersion(ownerId, draft.id).subscribe({ next: resolve, error: reject }),
    );
  }

  private toVersion(d: FormVersionDetail): FormVersion {
    this.rowVersions.set(String(d.version.formVersionId), d.version.rowVersion);
    return { ...toSummary(d.version), definition: { fields: d.fields.map(toDesigner) } };
  }
}
