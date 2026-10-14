import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import {
  FormVersionDetail,
  FormVersionStatus,
  FormsClient,
  StepDefinitionsClient,
} from '../../../api/generated/api-client';
import { apiError } from '../../../core/lookups/lookups-testing';
import { StepFormDesignerApi } from './step-form-designer-api';

const version = (
  id: number,
  status: FormVersionStatus,
  rowVersion = `rv${id}`,
): FormVersionDetail => ({
  version: {
    formVersionId: id,
    formDefinitionId: 9,
    versionNo: id,
    status,
    clonedFromVersionId: undefined,
    createdAtUtc: '2026-10-01T00:00:00Z',
    publishedAtUtc: status === FormVersionStatus.Draft ? undefined : '2026-10-02T00:00:00Z',
    publishedByUserId: undefined,
    notes: undefined,
    fieldCount: 1,
    rowVersion,
  },
  ownerKind: 'Step' as never,
  ownerId: 4,
  fields: [{ key: 'items_in', label: 'Items in', control: 'NUMBER' }],
});

describe('StepFormDesignerApi', () => {
  let forms: Record<string, ReturnType<typeof vi.fn>>;
  let api: StepFormDesignerApi;

  beforeEach(() => {
    forms = {
      listFormVersions: vi.fn(),
      getFormVersionSchema: vi.fn(),
      createFormDraft: vi.fn(),
      saveFormDraft: vi.fn(),
      publishFormVersion: vi.fn(),
      retireFormVersion: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        StepFormDesignerApi,
        { provide: FormsClient, useValue: forms },
        {
          provide: StepDefinitionsClient,
          useValue: {
            getStepDefinition: vi
              .fn()
              .mockReturnValue(of({ stepDefinitionId: 4, title: 'Dedupe', formDefinitionId: 9 })),
          },
        },
      ],
    });
    api = TestBed.inject(StepFormDesignerApi);
  });

  it('names the owner after the step and maps version summaries newest first', async () => {
    forms['listFormVersions'].mockReturnValue(
      of([
        version(1, FormVersionStatus.Retired).version,
        version(2, FormVersionStatus.Draft).version,
      ]),
    );
    expect(await firstValueFrom(api.getOwner('4'))).toEqual({ id: '4', name: 'Dedupe' });
    const list = await firstValueFrom(api.listVersions('4'));
    expect(forms['listFormVersions']).toHaveBeenCalledWith(9);
    expect(list.map((v) => [v.id, v.status])).toEqual([
      ['2', 'DRAFT'],
      ['1', 'RETIRED'],
    ]);
  });

  it('loads a version as designer fields and sends the row version back on save and publish', async () => {
    forms['getFormVersionSchema'].mockReturnValue(of(version(2, FormVersionStatus.Draft)));
    const loaded = await firstValueFrom(api.getVersion('4', '2'));
    expect(loaded.definition.fields.map((f) => f.key)).toEqual(['items_in']);

    forms['saveFormDraft'].mockReturnValue(of(version(2, FormVersionStatus.Draft, 'rv2b')));
    await firstValueFrom(api.saveDraft('4', '2', loaded.definition));
    expect(forms['saveFormDraft']).toHaveBeenCalledWith(9, 2, {
      fields: loaded.definition.fields,
      rowVersion: 'rv2',
    });

    forms['publishFormVersion'].mockReturnValue(of(version(2, FormVersionStatus.Published)));
    await firstValueFrom(api.publish('4', '2'));
    expect(forms['publishFormVersion']).toHaveBeenCalledWith(9, 2, 'rv2b');
  });

  it('returns the open draft when one already exists', async () => {
    forms['createFormDraft'].mockReturnValue(
      throwError(() => apiError(409, 'FORM_DRAFT_EXISTS', 'The form already has a draft.')),
    );
    forms['listFormVersions'].mockReturnValue(of([version(3, FormVersionStatus.Draft).version]));
    forms['getFormVersionSchema'].mockReturnValue(of(version(3, FormVersionStatus.Draft)));

    const draft = await firstValueFrom(api.createDraft('4'));
    expect(draft.id).toBe('3');
    expect(draft.status).toBe('DRAFT');
  });
});
