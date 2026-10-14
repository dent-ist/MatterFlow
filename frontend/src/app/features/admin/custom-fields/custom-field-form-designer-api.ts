import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { FormOwnerKind } from '../../../api/generated/api-client';
import { AssetTypeFormDesignerApi } from '../asset-types/asset-type-form-designer-api';
import { FormOwner } from '../task-types/form-designer-api';

/** The three objects that carry admin-defined custom fields, with the route key used as the designer's owner id. */
export const CUSTOM_FIELD_OBJECTS = [
  { key: 'client', label: 'Client', kind: FormOwnerKind.Client },
  { key: 'matter', label: 'Matter', kind: FormOwnerKind.Matter },
  { key: 'project', label: 'Project', kind: FormOwnerKind.Project },
] as const;

export type CustomFieldObjectKey = (typeof CUSTOM_FIELD_OBJECTS)[number]['key'];

export const customFieldObject = (key: string) => CUSTOM_FIELD_OBJECTS.find((o) => o.key === key);

/**
 * `FormDesignerApi` over the forms endpoints for the singleton custom-field form of Client, Matter or Project. The owner id is
 * the object key (`client`, `matter`, `project`); the definition is provisioned on first use (idempotent), so an object that has
 * never had custom fields opens an empty form instead of a 404.
 */
@Injectable()
export class CustomFieldFormDesignerApi extends AssetTypeFormDesignerApi {
  override getOwner(ownerId: string): Observable<FormOwner> {
    const object = customFieldObject(ownerId);
    return of({ id: ownerId, name: object ? `${object.label} custom fields` : ownerId });
  }

  protected override async findDefinitionId(ownerId: string): Promise<number> {
    const object = customFieldObject(ownerId);
    if (!object) throw new Error(`Unknown custom-field object '${ownerId}'.`);
    const definition = await firstValueFrom(
      this.forms.ensureFormDefinition({ ownerKind: object.kind }),
    );
    return definition.formDefinitionId;
  }
}
