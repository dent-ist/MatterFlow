import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  FormDefinitionModel,
  FormOwnerKind,
  FormVersionStatus,
  FormsClient,
} from '../../../api/generated/api-client';
import { aFormVersion } from '../../../shared/testing/asset-testing';
import { ok, settle } from '../../../shared/testing/org-testing';
import { CustomFieldFormDesignerApi } from './custom-field-form-designer-api';
import { CustomFieldsPage } from './custom-fields-page';

const definition = (
  kind: FormOwnerKind,
  versions: { id: number; no: number; status: FormVersionStatus }[],
  draftVersionId?: number,
): FormDefinitionModel => ({
  formDefinitionId: 100 + kind.length,
  ownerKind: kind,
  ownerId: undefined,
  isActive: true,
  publishedVersionId: versions.find((v) => v.status === FormVersionStatus.Published)?.id,
  draftVersionId,
  versions: versions.map((v) => ({
    ...aFormVersion().version,
    formVersionId: v.id,
    versionNo: v.no,
    status: v.status,
  })),
});

describe('CustomFieldsPage', () => {
  it('lists Client, Matter and Project with the status of each form and links to the designer', async () => {
    const ensure = vi.fn().mockImplementation((body: { ownerKind: FormOwnerKind }) => {
      switch (body.ownerKind) {
        case FormOwnerKind.Matter:
          return ok(
            definition(
              FormOwnerKind.Matter,
              [{ id: 3, no: 2, status: FormVersionStatus.Published }],
              4,
            ),
          );
        case FormOwnerKind.Project:
          return ok(
            definition(
              FormOwnerKind.Project,
              [{ id: 5, no: 1, status: FormVersionStatus.Draft }],
              5,
            ),
          );
        default:
          return ok(definition(body.ownerKind, []));
      }
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FormsClient, useValue: { ensureFormDefinition: ensure } },
      ],
    });
    const fixture = TestBed.createComponent(CustomFieldsPage);
    await settle(fixture);

    const row = (name: string) =>
      fixture.nativeElement.querySelector(`[data-row="${name}"]`) as HTMLElement;
    expect(row('Client').textContent).toContain('No custom fields');
    expect(row('Matter').textContent).toContain('Published v2');
    expect(row('Matter').textContent).toContain('draft in progress');
    expect(row('Project').textContent).toContain('Draft, not published');
    expect(row('Matter').querySelector('a')!.getAttribute('href')).toBe(
      '/admin/custom-fields/matter/form',
    );
  });
});

describe('CustomFieldFormDesignerApi', () => {
  it('provisions the singleton definition and uses it for the object key', async () => {
    const forms = {
      ensureFormDefinition: vi.fn().mockReturnValue(ok(definition(FormOwnerKind.Matter, []))),
      listFormVersions: vi.fn().mockReturnValue(ok([])),
    };
    TestBed.configureTestingModule({
      providers: [CustomFieldFormDesignerApi, { provide: FormsClient, useValue: forms }],
    });
    const api = TestBed.inject(CustomFieldFormDesignerApi);

    expect(await firstValueFrom(api.getOwner('matter'))).toEqual({
      id: 'matter',
      name: 'Matter custom fields',
    });
    await firstValueFrom(api.listVersions('matter'));

    expect(forms.ensureFormDefinition).toHaveBeenCalledWith({ ownerKind: FormOwnerKind.Matter });
    expect(forms.listFormVersions).toHaveBeenCalledWith(100 + FormOwnerKind.Matter.length);
  });
});
