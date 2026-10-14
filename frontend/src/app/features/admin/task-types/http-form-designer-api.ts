import { Injectable, inject } from '@angular/core';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import {
  FormDefinitionModel,
  FormOwnerKind,
  FormsClient,
  TaskTypesClient,
} from '../../../api/generated/api-client';
import { FormDesignerApi, FormOwner, FormVersion, FormVersionSummary } from './form-designer-api';
import { toFieldModels, toSummary, toVersion } from './form-mapping';
import type { DesignerDefinition } from 'form-engine';

/**
 * Real provider over the generated client: the owner is a Task Type, its form is the `/api/v1/forms` definition of that owner.
 * Ids are exposed as strings (the abstraction is owner-agnostic) and converted here.
 */
@Injectable()
export class HttpFormDesignerApi extends FormDesignerApi {
  private readonly forms = inject(FormsClient);
  private readonly taskTypes = inject(TaskTypesClient);
  private readonly definitions = new Map<string, number>();

  getOwner(ownerId: string): Observable<FormOwner> {
    return this.taskTypes
      .getTaskType(Number(ownerId))
      .pipe(map((t) => ({ id: ownerId, name: t.name })));
  }

  listVersions(ownerId: string): Observable<FormVersionSummary[]> {
    return this.definition(ownerId).pipe(map((d) => d.versions.map(toSummary)));
  }

  getVersion(_ownerId: string, versionId: string): Observable<FormVersion> {
    return this.forms.getFormVersionSchema(Number(versionId)).pipe(map(toVersion));
  }

  createDraft(ownerId: string): Observable<FormVersion> {
    return this.definition(ownerId).pipe(
      switchMap((d) =>
        d.draftVersionId !== undefined && d.draftVersionId !== null
          ? this.forms.getFormVersionSchema(d.draftVersionId)
          : this.forms.createFormDraft(d.formDefinitionId, {}),
      ),
      map(toVersion),
    );
  }

  saveDraft(
    ownerId: string,
    versionId: string,
    definition: DesignerDefinition,
    rowVersion?: string,
  ): Observable<FormVersion> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) =>
        this.forms.saveFormDraft(id, Number(versionId), {
          fields: toFieldModels(definition),
          rowVersion,
        }),
      ),
      map(toVersion),
    );
  }

  publish(
    ownerId: string,
    versionId: string,
    note?: string,
    rowVersion?: string,
  ): Observable<FormVersion> {
    const trimmed = note?.trim();
    return this.definitionId(ownerId).pipe(
      switchMap((id) => {
        // The version note lives on the draft: store it first (this also yields the fresh row version).
        const prepared: Observable<string | undefined> = trimmed
          ? this.forms.getFormVersionSchema(Number(versionId)).pipe(
              switchMap((detail) =>
                this.forms.saveFormDraft(id, Number(versionId), {
                  fields: detail.fields,
                  notes: trimmed,
                  rowVersion,
                }),
              ),
              map((saved) => saved.version.rowVersion),
            )
          : of(rowVersion);
        return prepared.pipe(
          switchMap((rv) => this.forms.publishFormVersion(id, Number(versionId), rv)),
        );
      }),
      map(toVersion),
    );
  }

  retire(ownerId: string, versionId: string): Observable<FormVersion> {
    return this.definitionId(ownerId).pipe(
      switchMap((id) => this.forms.retireFormVersion(id, Number(versionId))),
      map(toVersion),
    );
  }

  /** Finds or provisions the owner's form definition (idempotent) with its versions. */
  private definition(ownerId: string): Observable<FormDefinitionModel> {
    return this.forms
      .ensureFormDefinition({ ownerKind: FormOwnerKind.TaskType, ownerId: Number(ownerId) })
      .pipe(tap((d) => this.definitions.set(ownerId, d.formDefinitionId)));
  }

  private definitionId(ownerId: string): Observable<number> {
    const known = this.definitions.get(ownerId);
    return known !== undefined
      ? of(known)
      : this.definition(ownerId).pipe(map((d) => d.formDefinitionId));
  }
}
