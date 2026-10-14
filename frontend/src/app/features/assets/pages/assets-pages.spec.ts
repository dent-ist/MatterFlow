import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import {
  AssetTypesClient,
  AssetsClient,
  AuditEventsClient,
  FormsClient,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  aFormVersion,
  anAsset,
  anAssetListItem,
  anAssetType,
  pageOfAssetTypes,
  pageOfAssets,
} from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  aMatter,
  apiError,
  buttonByLabel,
  ok,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { provideLookups } from '../../../shared/work-queue/work-queue-testing';
import { AssetDetailPage } from './asset-detail-page';
import { AssetFormPage, externalReferenceError } from './asset-form-page';
import { AssetsListPage } from './assets-list-page';

type Mock = ReturnType<typeof vi.fn>;

describe('Assets pages', () => {
  let assets: Record<
    | 'listAssets'
    | 'getAsset'
    | 'createAsset'
    | 'updateAsset'
    | 'setAssetActive'
    | 'lookupAssets'
    | 'listAssetLinkedTasks',
    Mock
  >;
  let types: Record<'listAssetTypes', Mock>;
  let forms: Record<'getFormVersionSchema', Mock>;
  let matters: Record<'getMatter' | 'listMatters', Mock>;
  let audit: Record<'listAuditEvents', Mock>;
  let navigate: Mock;
  let navigateByUrl: Mock;

  async function configure(permissions: Permission[]): Promise<void> {
    assets = {
      listAssets: vi
        .fn()
        .mockReturnValue(
          ok(
            pageOfAssets(
              anAssetListItem(),
              anAssetListItem({ assetId: 10, displayName: 'Old room', isActive: false }),
            ),
          ),
        ),
      getAsset: vi.fn().mockReturnValue(ok(anAsset())),
      createAsset: vi.fn().mockReturnValue(ok(anAsset({ assetId: 12 }))),
      updateAsset: vi.fn().mockReturnValue(ok(anAsset({ displayName: 'Renamed' }))),
      setAssetActive: vi.fn().mockReturnValue(ok(anAsset({ isActive: false }))),
      lookupAssets: vi.fn().mockReturnValue(ok([])),
      listAssetLinkedTasks: vi.fn().mockReturnValue(
        ok({
          items: [
            {
              taskId: 1042,
              taskNumber: 'TSK-1042',
              title: 'Process Smith custodians',
              statusCode: 'IN_PROGRESS',
              assetLinkRoleId: 2,
              assetLinkRoleName: 'Source',
              linkedAtUtc: '2026-10-01T12:00:00Z',
            },
          ],
        }),
      ),
    };
    types = {
      listAssetTypes: vi.fn().mockReturnValue(
        ok(
          pageOfAssetTypes(
            anAssetType(),
            anAssetType({
              assetTypeId: 5,
              name: 'Source System',
              publishedFormVersionId: undefined,
            }),
          ),
        ),
      ),
    };
    forms = { getFormVersionSchema: vi.fn().mockReturnValue(ok(aFormVersion())) };
    matters = {
      getMatter: vi.fn().mockReturnValue(ok(aMatter())),
      listMatters: vi.fn().mockReturnValue(ok(pageOfMatters(aMatter()))),
    };
    audit = { listAuditEvents: vi.fn().mockReturnValue(ok({ items: [] })) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AssetsClient, useValue: assets },
        { provide: AssetTypesClient, useValue: types },
        { provide: FormsClient, useValue: forms },
        { provide: MattersClient, useValue: matters },
        { provide: AuditEventsClient, useValue: audit },
        ...provideLookups(),
      ],
    });
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true) as never;
    navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
  }

  describe('list', () => {
    async function create(permissions: Permission[], inputs: Record<string, string> = {}) {
      await configure(permissions);
      const fixture = TestBed.createComponent(AssetsListPage);
      for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
      await settle(fixture);
      return fixture;
    }

    it('lists assets with type, matter reference, external reference and status', async () => {
      const fixture = await create(['Asset.View', 'Asset.Create']);
      const rows = fixture.nativeElement.querySelectorAll('tbody tr');

      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/assets/9');
      expect(rows[0].textContent).toContain('Document Set');
      expect(rows[0].querySelector('.mf-ref')?.textContent).toBe('00343-00012');
      expect(rows[0].textContent).toContain('https://dms.example/folders/42');
      expect(rows[1].textContent).toContain('Inactive');
      expect(assets.listAssets).toHaveBeenCalledWith(
        undefined,
        undefined,
        true,
        undefined,
        1,
        25,
        undefined,
      );
      // The type filter offers the existing types.
      expect(
        Array.from(fixture.nativeElement.querySelectorAll('#asset-type-filter option')).map((o) =>
          (o as HTMLElement).textContent!.trim(),
        ),
      ).toEqual(['All types', 'Document Set', 'Source System']);
    });

    it('searches on the server with the filters from the URL and keeps the matter when creating', async () => {
      const fixture = await create(['Asset.View', 'Asset.Create'], {
        matterId: '7',
        typeId: '4',
        q: 'dms',
        status: 'all',
        page: '2',
        sort: '-displayName',
      });

      expect(assets.listAssets).toHaveBeenLastCalledWith(
        7,
        4,
        undefined,
        'dms',
        2,
        25,
        '-displayName',
      );
      expect(fixture.nativeElement.querySelector('[data-matter-chip]')?.textContent).toContain(
        '00343-00012 Merger Review',
      );
      buttonByLabel(fixture.nativeElement, 'New Asset')!.click();
      expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
      fixture.nativeElement.querySelector('[data-matter-chip] button').click();
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { matterId: null, page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('puts the search text and the type into the URL', async () => {
      const fixture = await create(['Asset.View']);
      const box = fixture.nativeElement.querySelector('#asset-search') as HTMLInputElement;
      box.value = ' relativity ';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { q: 'relativity', page: null },
        queryParamsHandling: 'merge',
      });

      const select = fixture.nativeElement.querySelector('#asset-type-filter') as HTMLSelectElement;
      select.value = '4';
      select.dispatchEvent(new Event('change'));
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { typeId: '4', page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('hides New Asset without Asset.Create and shows empty and error states', async () => {
      const fixture = await create(['Asset.View']);
      expect(buttonByLabel(fixture.nativeElement, 'New Asset')).toBeUndefined();

      assets.listAssets.mockReturnValue(ok(pageOfAssets()));
      fixture.componentRef.setInput('q', 'zzz');
      await settle(fixture);
      expect(fixture.nativeElement.querySelector('[data-empty=filtered]')).not.toBeNull();

      assets.listAssets.mockReturnValue(
        apiError(500, { title: 'x', status: 500, code: 'INTERNAL_ERROR' }),
      );
      fixture.componentRef.setInput('q', 'boom');
      await settle(fixture);
      expect(fixture.nativeElement.querySelector('[role=alert]')?.textContent).toContain('Retry');
    });
  });

  describe('form', () => {
    let fixture: ComponentFixture<AssetFormPage>;
    const el = (): HTMLElement => fixture.nativeElement;

    async function create(inputs: Record<string, string>, permissions: Permission[]) {
      await configure(permissions);
      fixture = TestBed.createComponent(AssetFormPage);
      for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
      await settle(fixture);
    }

    function type(selector: string, value: string): void {
      const input = el().querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    async function chooseType(id: string): Promise<void> {
      const select = el().querySelector<HTMLSelectElement>('#asset-type')!;
      select.value = id;
      select.dispatchEvent(new Event('change'));
      await settle(fixture);
    }

    async function submit(): Promise<void> {
      el().querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);
    }

    it('validates the external reference only when it looks like a URL', () => {
      expect(externalReferenceError('WS-8841')).toBeNull();
      expect(externalReferenceError('Box 14 of 20')).toBeNull();
      expect(externalReferenceError('https://dms.example/x?y=1')).toBeNull();
      expect(externalReferenceError('http://a.b')).toBeNull();
      expect(externalReferenceError('https://')).toContain('valid URL');
      expect(externalReferenceError('ftp://files.example')).toContain('valid URL');
      expect(externalReferenceError('www.example.com')).toContain('valid URL');
    });

    it('creates in the launching matter with the matter locked and the type fields from the published form', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create']);

      expect(matters.getMatter).toHaveBeenCalledWith(7);
      expect(el().querySelector('[data-chosen]')?.textContent).toContain(
        '00343-00012 Merger Review',
      );
      expect(el().querySelector('.mf-picker__change')).toBeNull();
      // Only active types are offered.
      expect(types.listAssetTypes).toHaveBeenCalledWith(undefined, true, 1, 100, undefined);
      expect(el().querySelector('[data-type-fields]')).toBeNull();

      await chooseType('4');
      expect(forms.getFormVersionSchema).toHaveBeenCalledWith(21);
      expect(el().querySelector('[data-type-fields]')?.textContent).toContain('Workspace ID');
      expect(el().querySelector('[data-type-fields]')?.textContent).not.toContain('OCR language');

      type('#asset-name', ' Contract bundle ');
      type('#asset-reference', 'https://dms.example/folders/42');
      const workspace = el().querySelector<HTMLInputElement>(
        '[data-type-fields] input[type=text]',
      )!;
      workspace.value = 'WS-8841';
      workspace.dispatchEvent(new Event('input'));
      await settle(fixture);
      await submit();

      expect(assets.createAsset).toHaveBeenCalledWith({
        matterId: 7,
        assetTypeId: 4,
        displayName: 'Contract bundle',
        externalReference: 'https://dms.example/folders/42',
        description: undefined,
        formValues: { workspace_id: 'WS-8841' },
      });
      expect(navigate).toHaveBeenCalledWith(['/assets', 12]);
    });

    it('requires matter, type and name, and the required type-specific field, before calling the server', async () => {
      await create({}, ['Asset.View', 'Asset.Create']);
      await submit();
      const summary = el().querySelector('[data-summary]')!.textContent!;
      expect(summary).toContain('Select a matter.');
      expect(summary).toContain('Select an asset type.');
      expect(summary).toContain('Enter a display name.');

      await chooseType('4');
      type('#asset-name', 'Bundle');
      await submit();
      expect(el().querySelector('[data-summary]')!.textContent).toContain('Select a matter.');
      expect(el().querySelector('[data-summary]')!.textContent).toContain(
        'Complete the highlighted fields: Workspace ID.',
      );
      expect(assets.createAsset).not.toHaveBeenCalled();
    });

    it('shows a type without published fields as having none and sends no form values', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create']);
      await chooseType('5');
      expect(el().querySelector('[data-no-fields]')).not.toBeNull();

      type('#asset-name', 'Relativity');
      await submit();

      expect(assets.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({ assetTypeId: 5, formValues: undefined }),
      );
    });

    it('shows the server field errors of the type-specific fields inline', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create']);
      await chooseType('4');
      type('#asset-name', 'Bundle');
      const workspace = el().querySelector<HTMLInputElement>(
        '[data-type-fields] input[type=text]',
      )!;
      workspace.value = 'WS-1';
      workspace.dispatchEvent(new Event('input'));
      await settle(fixture);
      assets.createAsset.mockReturnValue(
        apiError(400, {
          title: 'Bad',
          status: 400,
          code: 'FORM_VALIDATION_FAILED',
          errors: { 'form:workspace_id': [{ code: 'PATTERN', message: 'Use the WS- format.' }] },
        }),
      );

      await submit();

      expect(el().querySelector('[data-summary]')?.textContent).toContain('Use the WS- format.');
      expect(el().querySelector('[data-type-fields]')?.textContent).toContain(
        'Use the WS- format.',
      );
      expect(navigate).not.toHaveBeenCalled();
    });

    it('maps an inactive matter to a clear message', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create']);
      await chooseType('5');
      type('#asset-name', 'Bundle');
      assets.createAsset.mockReturnValue(
        apiError(409, { title: 'x', status: 409, code: 'MATTER_INACTIVE' }),
      );

      await submit();

      expect(el().querySelector('[data-summary]')?.textContent).toContain(
        'That matter is inactive',
      );
    });

    it('edits with the matter and type locked, sends a patch and nulls for cleared values', async () => {
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit']);

      expect(assets.getAsset).toHaveBeenCalledWith(9);
      expect(forms.getFormVersionSchema).toHaveBeenCalledWith(21);
      expect(el().querySelector('[data-chosen]')?.textContent).toContain(
        '00343-00012 Merger Review',
      );
      expect(el().querySelector('.mf-picker__change')).toBeNull();
      expect(el().querySelector('[data-type-locked]')?.textContent).toContain('Document Set');
      expect(el().querySelector('select#asset-type')).toBeNull();
      expect((el().querySelector('#asset-name') as HTMLInputElement).value).toBe('Contract bundle');

      type('#asset-name', 'Renamed');
      const notes = el().querySelector<HTMLTextAreaElement>('[data-type-fields] textarea')!;
      notes.value = '';
      notes.dispatchEvent(new Event('input'));
      await settle(fixture);
      await submit();

      expect(assets.updateAsset).toHaveBeenCalledWith(9, {
        displayName: 'Renamed',
        externalReference: 'https://dms.example/folders/42',
        description: 'First batch',
        formValues: { workspace_id: 'WS-8841', notes: null },
        rowVersion: 'AAAA',
      });
      expect(navigate).toHaveBeenCalledWith(['/assets', 9]);
    });

    it('warns that an inactive asset cannot be edited and offers a reload on conflict', async () => {
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit']);
      assets.updateAsset.mockReturnValue(
        apiError(409, { title: 'x', status: 409, code: 'CONCURRENCY_CONFLICT' }),
      );
      await submit();
      expect(el().querySelector('[data-conflict]')).not.toBeNull();

      TestBed.resetTestingModule();
      await configure(['Asset.View', 'Asset.Edit']);
      assets.getAsset.mockReturnValue(ok(anAsset({ isActive: false })));
      fixture = TestBed.createComponent(AssetFormPage);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
      expect(el().querySelector('[data-inactive-banner]')).not.toBeNull();
      expect(buttonByLabel(el(), 'Save asset')!.disabled).toBe(true);
    });

    it('reports unsaved changes and none after a save', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create']);
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      type('#asset-name', 'Bundle');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });

    it('has a schema-less edit when the type has no published form', async () => {
      await configure(['Asset.View', 'Asset.Edit']);
      assets.getAsset.mockReturnValue(
        ok(
          anAsset({ publishedFormVersionId: undefined, formVersionId: undefined, formValues: {} }),
        ),
      );
      fixture = TestBed.createComponent(AssetFormPage);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
      type('#asset-name', 'Renamed');

      await submit();

      expect(forms.getFormVersionSchema).not.toHaveBeenCalled();
      expect(assets.updateAsset).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ displayName: 'Renamed', formValues: undefined }),
      );
    });
  });

  describe('detail', () => {
    let fixture: ComponentFixture<AssetDetailPage>;
    const el = (): HTMLElement => fixture.nativeElement;
    const tab = (label: string): HTMLElement | undefined =>
      Array.from(el().querySelectorAll<HTMLElement>('[role=tab]')).find(
        (t) => t.textContent!.trim() === label,
      );

    async function create(permissions: Permission[], asset = anAsset()): Promise<void> {
      await configure(permissions);
      assets.getAsset.mockReturnValue(ok(asset));
      fixture = TestBed.createComponent(AssetDetailPage);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
    }

    it('shows the type badge, the matter link, the external reference link and the stored values with their form version', async () => {
      await create(['Asset.View', 'Asset.Edit']);

      expect(el().querySelector('h1')?.textContent).toContain('Contract bundle');
      expect(el().querySelector('[data-type-badge]')?.textContent).toBe('Document Set');
      expect(el().querySelector('[data-matter] a')?.getAttribute('href')).toBe('/matters/7');
      const link = el().querySelector('[data-external-reference] a')!;
      expect(link.getAttribute('href')).toBe('https://dms.example/folders/42');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(forms.getFormVersionSchema).toHaveBeenCalledWith(21);
      const values = el().querySelector('[data-type-fields]')!.textContent!;
      expect(values).toContain('WS-8841');
      expect(values).toContain('check later');
    });

    it('shows a non-URL external reference as plain text', async () => {
      await create(['Asset.View'], anAsset({ externalReference: 'WS-8841' }));
      expect(el().querySelector('[data-external-reference] a')).toBeNull();
      expect(el().querySelector('[data-external-reference]')?.textContent).toContain('WS-8841');
    });

    it('has Details, a Linked Tasks tab and a History tab only with Audit.View', async () => {
      await create(['Asset.View', 'Task.View']);
      expect(tab('History')).toBeUndefined();
      expect(assets.listAssetLinkedTasks).not.toHaveBeenCalled(); // lazy: only once the tab opens
      tab('Linked Tasks')!.click();
      await settle(fixture);
      expect(assets.listAssetLinkedTasks).toHaveBeenCalledWith(9);

      TestBed.resetTestingModule();
      await create(['Asset.View', 'Audit.View']);
      tab('History')!.click();
      await settle(fixture);
      expect(audit.listAuditEvents).toHaveBeenCalledWith('Asset', '9', undefined, 50);
    });

    it('lists the linked tasks with number, title, status, role and a link to the task', async () => {
      await create(['Asset.View', 'Task.View']);
      tab('Linked Tasks')!.click();
      await settle(fixture);

      const row = el().querySelector('tbody tr[data-task=TSK-1042]')!;
      expect(row.querySelector('td')?.textContent).toBe('TSK-1042');
      expect(row.querySelector('a')?.getAttribute('href')).toBe('/tasks/1042');
      expect(row.querySelector('a')?.textContent).toBe('Process Smith custodians');
      expect(row.querySelector('[data-status]')?.getAttribute('data-status')).toBe('IN_PROGRESS');
      expect(row.textContent).toContain('Source');
    });

    it('shows empty, error and no-permission states for the linked tasks', async () => {
      await create(['Asset.View', 'Task.View']);
      assets.listAssetLinkedTasks.mockReturnValue(ok({ items: [] }));
      tab('Linked Tasks')!.click();
      await settle(fixture);
      expect(el().querySelector('[data-empty=linked-tasks]')).not.toBeNull();

      TestBed.resetTestingModule();
      await create(['Asset.View', 'Task.View']);
      assets.listAssetLinkedTasks.mockReturnValue(apiError(500, { title: 'x' } as never));
      tab('Linked Tasks')!.click();
      await settle(fixture);
      expect(el().querySelector('[data-error]')).not.toBeNull();

      TestBed.resetTestingModule();
      await create(['Asset.View']);
      tab('Linked Tasks')!.click();
      await settle(fixture);
      expect(el().querySelector('[data-no-access=linked-tasks]')).not.toBeNull();
      expect(assets.listAssetLinkedTasks).not.toHaveBeenCalled();
    });

    it('gates Edit and the activation button by permission and hides Edit for an inactive asset', async () => {
      await create(['Asset.View']);
      expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
      expect(buttonByLabel(el(), 'Set inactive')).toBeUndefined();

      TestBed.resetTestingModule();
      await create(['Asset.View', 'Asset.Edit']);
      buttonByLabel(el(), 'Edit')!.click();
      expect(navigateByUrl).toHaveBeenCalledWith('/assets/9/edit');

      TestBed.resetTestingModule();
      await create(['Asset.View', 'Asset.Edit'], anAsset({ isActive: false }));
      expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
      expect(buttonByLabel(el(), 'Reactivate')).toBeDefined();
      expect(el().querySelector('[data-inactive-banner]')).not.toBeNull();
    });

    it('deactivates after confirmation with the row version (assets are never deleted)', async () => {
      await create(['Asset.View', 'Asset.Edit']);
      expect(buttonByLabel(el(), 'Delete')).toBeUndefined();

      buttonByLabel(el(), 'Set inactive')!.click();
      await settle(fixture);
      expect(document.body.querySelector('[data-toggle-body]')?.textContent).toContain(
        'never deleted',
      );
      (
        Array.from(document.body.querySelectorAll<HTMLButtonElement>('p-dialog button')).find(
          (b) => b.textContent!.trim() === 'Set inactive',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);

      expect(assets.setAssetActive).toHaveBeenCalledWith(9, {
        isActive: false,
        rowVersion: 'AAAA',
      });
      expect(el().querySelector('[data-status]')?.textContent).toBe('Inactive');
    });

    it('offers a retry when the asset cannot be loaded', async () => {
      await configure(['Asset.View']);
      assets.getAsset.mockReturnValue(
        apiError(404, { title: 'x', status: 404, code: 'NOT_FOUND' }),
      );
      fixture = TestBed.createComponent(AssetDetailPage);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
      expect(el().querySelector('[role=alert]')?.textContent).toContain("couldn't find that asset");
    });
  });
});
