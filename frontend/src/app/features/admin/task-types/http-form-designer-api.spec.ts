import { TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of } from 'rxjs';
import {
  FormDefinitionModel,
  FormOwnerKind,
  FormVersionDetail,
  FormVersionStatus as ApiStatus,
  FormVersionSummary as ApiSummary,
  FormsClient,
  SaveFormDraftRequest,
  TaskTypesClient,
} from '../../../api/generated/api-client';
import { HttpFormDesignerApi } from './http-form-designer-api';

const summary = (id: number, no: number, status: ApiStatus): ApiSummary => ({
  formVersionId: id,
  formDefinitionId: 9,
  versionNo: no,
  status,
  clonedFromVersionId: undefined,
  createdAtUtc: '2026-10-01T00:00:00Z',
  publishedAtUtc: status === ApiStatus.Draft ? undefined : '2026-10-02T00:00:00Z',
  publishedByUserId: undefined,
  notes: undefined,
  fieldCount: 1,
  rowVersion: `rv-${id}`,
});

const detail = (id: number, no: number, status: ApiStatus): FormVersionDetail => ({
  version: summary(id, no, status),
  ownerKind: FormOwnerKind.TaskType,
  ownerId: 5,
  fields: [{ key: 'a', label: 'A', control: 'TEXT' }],
});

class FakeForms {
  definition: FormDefinitionModel = {
    formDefinitionId: 9,
    ownerKind: FormOwnerKind.TaskType,
    ownerId: 5,
    isActive: true,
    publishedVersionId: 1,
    draftVersionId: undefined,
    versions: [summary(1, 1, ApiStatus.Published)],
  };
  calls: string[] = [];
  saved: SaveFormDraftRequest[] = [];
  publishedWith: (string | undefined)[] = [];

  ensureFormDefinition(body: {
    ownerKind: FormOwnerKind;
    ownerId?: number;
  }): Observable<FormDefinitionModel> {
    this.calls.push(`ensure:${body.ownerKind}:${body.ownerId}`);
    return of(this.definition);
  }
  getFormVersionSchema(id: number): Observable<FormVersionDetail> {
    this.calls.push(`schema:${id}`);
    return of(detail(id, id, id === 2 ? ApiStatus.Draft : ApiStatus.Published));
  }
  createFormDraft(definitionId: number): Observable<FormVersionDetail> {
    this.calls.push(`draft:${definitionId}`);
    return of(detail(2, 2, ApiStatus.Draft));
  }
  saveFormDraft(_d: number, id: number, body: SaveFormDraftRequest): Observable<FormVersionDetail> {
    this.calls.push(`save:${id}`);
    this.saved.push(body);
    return of({
      ...detail(id, 2, ApiStatus.Draft),
      version: { ...summary(id, 2, ApiStatus.Draft), rowVersion: 'rv-new' },
    });
  }
  publishFormVersion(_d: number, id: number, rowVersion?: string): Observable<FormVersionDetail> {
    this.calls.push(`publish:${id}`);
    this.publishedWith.push(rowVersion);
    return of(detail(id, 2, ApiStatus.Published));
  }
  retireFormVersion(_d: number, id: number): Observable<FormVersionDetail> {
    this.calls.push(`retire:${id}`);
    return of(detail(id, 1, ApiStatus.Retired));
  }
}

describe('HttpFormDesignerApi', () => {
  let forms: FakeForms;
  let api: HttpFormDesignerApi;

  beforeEach(() => {
    forms = new FakeForms();
    TestBed.configureTestingModule({
      providers: [
        HttpFormDesignerApi,
        { provide: FormsClient, useValue: forms },
        {
          provide: TaskTypesClient,
          useValue: { getTaskType: (id: number) => of({ id, name: 'Data Processing' }) },
        },
      ],
    });
    api = TestBed.inject(HttpFormDesignerApi);
  });

  it('names the owner from the Task Type and lists versions through the ensured definition', async () => {
    expect(await firstValueFrom(api.getOwner('5'))).toEqual({ id: '5', name: 'Data Processing' });
    const versions = await firstValueFrom(api.listVersions('5'));
    expect(versions).toEqual([
      {
        id: '1',
        versionNo: 1,
        status: 'PUBLISHED',
        note: undefined,
        updatedAtUtc: '2026-10-02T00:00:00Z',
        fieldCount: 1,
        publishedAtUtc: '2026-10-02T00:00:00Z',
        rowVersion: 'rv-1',
      },
    ]);
    expect(forms.calls).toEqual(['ensure:TaskType:5']);
  });

  it('creates a draft from the published version, or returns the open draft', async () => {
    const created = await firstValueFrom(api.createDraft('5'));
    expect(created).toMatchObject({ id: '2', status: 'DRAFT' });
    expect(forms.calls).toContain('draft:9');

    forms.calls.length = 0;
    forms.definition = { ...forms.definition, draftVersionId: 2 };
    expect((await firstValueFrom(api.createDraft('5'))).id).toBe('2');
    expect(forms.calls).toEqual(['ensure:TaskType:5', 'schema:2']);
  });

  it('saves the draft with the row version the caller read', async () => {
    const saved = await firstValueFrom(
      api.saveDraft('5', '2', { fields: [{ key: 'a', control: 'TEXT', label: 'A' }] }, 'rv-2'),
    );
    expect(forms.saved[0]).toEqual({
      fields: [{ key: 'a', label: 'A', control: 'TEXT', required: false }],
      rowVersion: 'rv-2',
    });
    expect(saved.rowVersion).toBe('rv-new');
  });

  it('publishes with the row version, storing a version note first when given', async () => {
    await firstValueFrom(api.publish('5', '2', '', 'rv-2'));
    expect(forms.publishedWith).toEqual(['rv-2']);
    expect(forms.saved).toHaveLength(0);

    forms.publishedWith.length = 0;
    const published = await firstValueFrom(api.publish('5', '2', ' Added OCR ', 'rv-2'));
    expect(forms.saved[0].notes).toBe('Added OCR');
    expect(forms.saved[0].rowVersion).toBe('rv-2');
    expect(forms.publishedWith).toEqual(['rv-new']);
    expect(published.status).toBe('PUBLISHED');
  });

  it('retires a published version', async () => {
    expect((await firstValueFrom(api.retire('5', '1'))).status).toBe('RETIRED');
  });
});
