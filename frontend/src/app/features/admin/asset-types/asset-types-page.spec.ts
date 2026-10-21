import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { Permission } from '../../../core/auth/permissions';
import { anAssetType, pageOfAssetTypes } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  apiError,
  buttonByLabel,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AssetTypesPage } from './asset-types-page';

type Mock = ReturnType<typeof vi.fn>;

describe('AssetTypesPage', () => {
  let api: Record<'listAssetTypes' | 'createAssetType' | 'updateAssetType', Mock>;
  let fixture: ComponentFixture<AssetTypesPage>;
  let query: ReturnType<typeof fakeQuery>;
  let navigate: Mock;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(
    permissions: Permission[],
    params: Record<string, string> = {},
  ): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    api = {
      listAssetTypes: vi.fn().mockReturnValue(
        ok(
          pageOfAssetTypes(
            anAssetType(),
            anAssetType({
              assetTypeId: 5,
              name: 'Source System',
              description: undefined,
              isActive: false,
              publishedFormVersionId: undefined,
              publishedFormVersionNo: undefined,
              assetCount: 0,
              sortOrder: 20,
              rowVersion: 'SSSS',
            }),
          ),
        ),
      ),
      createAssetType: vi
        .fn()
        .mockReturnValue(ok(anAssetType({ assetTypeId: 6, name: 'Data Room' }))),
      updateAssetType: vi.fn().mockReturnValue(ok(anAssetType({ name: 'Document Bundle' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: AssetTypesClient, useValue: api },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    fixture = TestBed.createComponent(AssetTypesPage);
    await settle(fixture);
  }

  function type(selector: string, value: string): void {
    const input = el().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  async function submit(): Promise<void> {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  it('has Name and Status column filters instead of a search box and a status select; Active is the default', async () => {
    await create(['AssetType.Manage', 'Asset.View']);
    expect(el().querySelector('#asset-type-search, #asset-type-status, mf-search-box')).toBeNull();
    expect(el().querySelector('[data-filter-row]')).toBeNull();
    expect(api.listAssetTypes).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      true,
      1,
      100,
      'sortOrder',
    );

    el().querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    expect(el().querySelector<HTMLSelectElement>('[aria-label="Filter by Status"]')!.value).toBe(
      'active',
    );
    expect(el().querySelector('[data-filter-count]')).toBeNull();
  });

  it('sends the filters of the address to the API and writes changes back to it', async () => {
    await create(['AssetType.Manage', 'Asset.View'], { name: ' doc ', status: 'inactive' });
    expect(api.listAssetTypes).toHaveBeenLastCalledWith(
      undefined,
      'doc',
      false,
      1,
      100,
      'sortOrder',
    );
    // A link with filters opens the row with the values in it.
    const name = el().querySelector<HTMLInputElement>('[aria-label="Filter by Name"]')!;
    expect(name.value).toBe('doc');
    expect(el().querySelector('[data-filter-count]')?.textContent).toBe('(2)');

    const status = el().querySelector<HTMLSelectElement>('[aria-label="Filter by Status"]')!;
    status.value = 'all';
    status.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'all', page: null },
      queryParamsHandling: 'merge',
    });
    query.set({ status: 'all' });
    await settle(fixture);
    expect(api.listAssetTypes).toHaveBeenLastCalledWith(
      undefined,
      'doc',
      undefined,
      1,
      100,
      'sortOrder',
    );
  });

  it('shows the filtered empty state inside the table, keeping the headers and the filter row', async () => {
    await create(['AssetType.Manage'], { name: 'zzz' });
    api.listAssetTypes.mockReturnValue(ok(pageOfAssetTypes()));
    query.set({ name: 'zzzz' });
    await settle(fixture);

    expect(el().querySelector('td[data-empty="filtered"]')?.textContent).toContain(
      'No asset types match these filters',
    );
    expect(el().querySelector('thead th')).not.toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();
  });

  it('lists the types with their field status, asset count and a link to the form designer', async () => {
    await create(['AssetType.Manage', 'Asset.View']);

    const rows = el().querySelectorAll('[data-types] tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Document Set');
    expect(rows[0].textContent).toContain('Published v2');
    expect(rows[0].textContent).toContain('3');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/admin/asset-types/4/form');
    expect(rows[1].textContent).toContain('No published fields');
    expect(rows[1].textContent).toContain('Inactive');
    expect(api.listAssetTypes).toHaveBeenCalledWith(
      undefined,
      undefined,
      true,
      1,
      100,
      'sortOrder',
    );
  });

  it('creates a type and reloads the list', async () => {
    await create(['AssetType.Manage']);

    buttonByLabel(el(), 'New asset type')!.click();
    await settle(fixture);
    expect((el().querySelector('#type-order') as HTMLInputElement).value).toBe('30');
    await submit();
    expect(el().querySelector('[data-summary]')?.textContent).toContain('Enter a name.');

    type('#type-name', ' Data Room ');
    type('#type-description', 'Virtual rooms');
    await submit();

    expect(api.createAssetType).toHaveBeenCalledWith({
      name: 'Data Room',
      description: 'Virtual rooms',
      sortOrder: 30,
    });
    expect(api.listAssetTypes).toHaveBeenCalledTimes(2);
    expect(el().querySelector('[data-editor]')).toBeNull();
    expect(el().querySelector('[data-announce]')?.textContent).toContain('Data Room created');
  });

  it('puts focus on Name after a failed submit and keeps the form unboxed, with its buttons in the page flow (#530)', async () => {
    await create(['AssetType.Manage']);
    buttonByLabel(el(), 'New asset type')!.click();
    await settle(fixture);
    await submit();

    const summary = el().querySelector('[data-summary]')!;
    expect(summary.textContent!.match(/Enter a name\./g)).toHaveLength(1);
    expect(summary.compareDocumentPosition(el().querySelector('#type-name')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(document.activeElement).toBe(el().querySelector('#type-name'));
    expect(el().querySelector('.mf-form-actions--sticky')).toBeNull();
  });

  it('knows a half-typed form from an untouched one, and asks before another form replaces it (#530)', async () => {
    await create(['AssetType.Manage']);
    const page = fixture.componentInstance;
    expect(page.hasUnsavedChanges()).toBe(false);

    buttonByLabel(el(), 'New asset type')!.click();
    await settle(fixture);
    expect(page.hasUnsavedChanges()).toBe(false);
    type('#type-name', 'Half typed');
    await settle(fixture);
    expect(page.hasUnsavedChanges()).toBe(true);

    // Stay keeps the text and the form.
    const ask = vi.spyOn(TestBed.inject(LeaveConfirmService), 'ask').mockResolvedValue(false);
    el().querySelector<HTMLElement>('button[aria-label="Edit Document Set"]')!.click();
    await settle(fixture);
    expect(ask).toHaveBeenCalledTimes(1);
    expect((el().querySelector('#type-name') as HTMLInputElement).value).toBe('Half typed');

    // Leave opens the other form.
    ask.mockResolvedValue(true);
    el().querySelector<HTMLElement>('button[aria-label="Edit Document Set"]')!.click();
    await settle(fixture);
    expect((el().querySelector('#type-name') as HTMLInputElement).value).toBe('Document Set');
    expect(page.hasUnsavedChanges()).toBe(false);

    // Cancelling is not "unsaved".
    type('#type-name', 'Changed again');
    buttonByLabel(el(), 'Cancel')!.click();
    await settle(fixture);
    expect(page.hasUnsavedChanges()).toBe(false);
  });

  it('shows a duplicate name as a field error', async () => {
    await create(['AssetType.Manage']);
    buttonByLabel(el(), 'New asset type')!.click();
    await settle(fixture);
    type('#type-name', 'Document Set');
    api.createAssetType.mockReturnValue(
      apiError(409, {
        title: 'Conflict',
        status: 409,
        code: 'DUPLICATE_NAME',
        errors: {
          name: [
            {
              code: 'DUPLICATE_NAME',
              message: "An asset type named 'Document Set' already exists.",
            },
          ],
        },
      }),
    );

    await submit();

    expect(el().querySelector('[data-editor]')?.textContent).toContain('already exists');
    expect(el().querySelector('[data-editor]')).not.toBeNull();
  });

  it('edits a type with its row version and active flag', async () => {
    await create(['AssetType.Manage']);

    el().querySelector<HTMLElement>('button[aria-label="Edit Document Set"]')!.click();
    await settle(fixture);
    expect((el().querySelector('#type-name') as HTMLInputElement).value).toBe('Document Set');
    type('#type-name', 'Document Bundle');
    const active = el().querySelector<HTMLInputElement>('[data-editor] input[type=checkbox]')!;
    active.checked = false;
    active.dispatchEvent(new Event('change'));
    await submit();
    expect(api.updateAssetType).not.toHaveBeenCalled();
    confirmDeactivation();
    await settle(fixture);

    expect(api.updateAssetType).toHaveBeenCalledWith(4, {
      name: 'Document Bundle',
      description: 'Sets of documents',
      sortOrder: 10,
      isActive: false,
      rowVersion: 'TTTT',
    });
  });

  const confirmDeactivation = (): void => {
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate asset type' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
  };

  it('asks before deactivating from the row and names the assets that keep the type', async () => {
    await create(['AssetType.Manage']);

    buttonByLabel(el(), 'Deactivate')!.click();
    await settle(fixture);
    expect(api.updateAssetType).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Deactivate asset type?');
    expect(document.body.textContent).toContain('Keep active');
    confirmDeactivation();
    await settle(fixture);

    expect(api.updateAssetType).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ isActive: false, rowVersion: 'TTTT' }),
    );
  });

  it('activates and deactivates from the row without deleting anything', async () => {
    await create(['AssetType.Manage']);
    expect(buttonByLabel(el(), 'Delete')).toBeUndefined();

    buttonByLabel(el(), 'Activate')!.click();
    await settle(fixture);

    expect(api.updateAssetType).toHaveBeenCalledWith(5, {
      name: 'Source System',
      description: undefined,
      sortOrder: 20,
      isActive: true,
      rowVersion: 'SSSS',
    });
  });

  it('is read-only without AssetType.Manage', async () => {
    await create(['Asset.View']);

    expect(buttonByLabel(el(), 'New asset type')).toBeUndefined();
    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(el().querySelectorAll('[data-types] tbody tr')).toHaveLength(2);
  });
});
