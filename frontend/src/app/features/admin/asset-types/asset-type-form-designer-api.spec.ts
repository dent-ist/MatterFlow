import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  AssetTypesClient,
  FormFieldModel,
  FormOwnerKind,
  FormVersionStatus,
  FormsClient,
} from '../../../api/generated/api-client';
import { aFormVersion, anAssetType } from '../../../shared/testing/asset-testing';
import { ok } from '../../../shared/testing/org-testing';
import {
  AssetTypeFormDesignerApi,
  toDesignerField,
  toServerField,
} from './asset-type-form-designer-api';

describe('AssetTypeFormDesignerApi', () => {
  let forms: Record<string, ReturnType<typeof vi.fn>>;
  let api: AssetTypeFormDesignerApi;

  const draftDetail = (fields: FormFieldModel[] = [], versionId = 30) => {
    const detail = aFormVersion(fields, versionId);
    detail.version.status = FormVersionStatus.Draft;
    detail.version.versionNo = 3;
    detail.version.rowVersion = 'DRAFTRV';
    return detail;
  };

  beforeEach(() => {
    forms = {
      findFormDefinition: vi.fn().mockReturnValue(ok({ formDefinitionId: 5, versions: [] })),
      listFormVersions: vi
        .fn()
        .mockReturnValue(ok([draftDetail().version, aFormVersion().version])),
      getFormVersionSchema: vi.fn().mockReturnValue(ok(draftDetail())),
      createFormDraft: vi.fn().mockReturnValue(ok(draftDetail())),
      saveFormDraft: vi.fn().mockReturnValue(ok(draftDetail())),
      publishFormVersion: vi.fn().mockReturnValue(ok(aFormVersion())),
      retireFormVersion: vi.fn().mockReturnValue(ok(aFormVersion())),
    };
    TestBed.configureTestingModule({
      providers: [
        AssetTypeFormDesignerApi,
        { provide: FormsClient, useValue: forms },
        {
          provide: AssetTypesClient,
          useValue: { getAssetType: vi.fn().mockReturnValue(ok(anAssetType())) },
        },
      ],
    });
    api = TestBed.inject(AssetTypeFormDesignerApi);
  });

  it('names the owner after the asset type and lists the versions of its form definition', async () => {
    expect(await firstValueFrom(api.getOwner('4'))).toEqual({ id: '4', name: 'Document Set' });

    const versions = await firstValueFrom(api.listVersions('4'));

    expect(forms['findFormDefinition']).toHaveBeenCalledWith(FormOwnerKind.AssetType, 4);
    expect(versions.map((v) => [v.id, v.versionNo, v.status])).toEqual([
      ['30', 3, 'DRAFT'],
      ['21', 2, 'PUBLISHED'],
    ]);
  });

  it('maps server fields to designer fields and back, keeping the filter flag', () => {
    const server: FormFieldModel = {
      key: 'format',
      label: 'Format',
      control: 'SELECT',
      required: true,
      isFilterable: true,
      showWhen: { op: 'isTrue', field: 'scanned' },
      options: [{ key: 'pdf', label: 'PDF' }],
    };

    const designer = toDesignerField(server);
    expect(designer).toEqual({
      key: 'format',
      label: 'Format',
      control: 'SELECT',
      required: true,
      showWhen: { op: 'isTrue', field: 'scanned' },
      options: [{ key: 'pdf', label: 'PDF' }],
    });
    expect(toServerField(designer, new Set(['format']))).toMatchObject({
      key: 'format',
      label: 'Format',
      control: 'SELECT',
      required: true,
      isFilterable: true,
      options: [{ key: 'pdf', label: 'PDF' }],
    });
    expect(toServerField(designer, new Set())).toMatchObject({ isFilterable: false });
  });

  it('gives a label-less help text field the placeholder label the server requires', () => {
    const designer = toDesignerField({
      key: 'tip',
      label: 'Help text',
      control: 'HELP_TEXT',
      helpText: 'Use WS ids.',
    });

    expect(designer.label).toBeUndefined();
    expect(toServerField(designer, new Set())).toMatchObject({
      label: 'Help text',
      helpText: 'Use WS ids.',
    });
  });

  it('saves a draft with the row version it loaded and the filter flags it was sent', async () => {
    const withFilter = draftDetail([
      { key: 'pages', label: 'Pages', control: 'NUMBER', isFilterable: true },
    ]);
    forms['getFormVersionSchema'].mockReturnValue(ok(withFilter));
    const version = await firstValueFrom(api.getVersion('4', '30'));

    await firstValueFrom(api.saveDraft('4', '30', version.definition));

    expect(forms['saveFormDraft']).toHaveBeenCalledWith(5, 30, {
      fields: [expect.objectContaining({ key: 'pages', isFilterable: true })],
      notes: undefined,
      rowVersion: 'DRAFTRV',
    });
  });

  it('returns the open draft instead of creating a second one, and creates one otherwise', async () => {
    const existing = await firstValueFrom(api.createDraft('4'));
    expect(existing.id).toBe('30');
    expect(forms['createFormDraft']).not.toHaveBeenCalled();

    forms['listFormVersions'].mockReturnValue(ok([aFormVersion().version]));
    await firstValueFrom(api.createDraft('4'));
    expect(forms['createFormDraft']).toHaveBeenCalledWith(5, {});
  });

  it('publishes with the draft row version, saving the note with the draft first', async () => {
    forms['getFormVersionSchema'].mockReturnValue(
      ok(draftDetail([{ key: 'a', label: 'A', control: 'TEXT' }])),
    );

    const published = await firstValueFrom(api.publish('4', '30', 'Added workspace id'));

    expect(forms['saveFormDraft']).toHaveBeenCalledWith(
      5,
      30,
      expect.objectContaining({ notes: 'Added workspace id' }),
    );
    expect(forms['publishFormVersion']).toHaveBeenCalledWith(5, 30, 'DRAFTRV');
    expect(published.status).toBe('PUBLISHED');
  });

  it('publishes without a note directly and retires through the retire endpoint', async () => {
    await firstValueFrom(api.listVersions('4'));
    await firstValueFrom(api.publish('4', '30'));
    expect(forms['saveFormDraft']).not.toHaveBeenCalled();
    expect(forms['publishFormVersion']).toHaveBeenCalledWith(5, 30, undefined);

    await firstValueFrom(api.retire('4', '21'));
    expect(forms['retireFormVersion']).toHaveBeenCalledWith(5, 21);
  });
});
