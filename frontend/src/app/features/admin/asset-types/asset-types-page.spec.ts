import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetTypesClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { anAssetType, pageOfAssetTypes } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  apiError,
  fakeQuery,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AdminTabCounts } from '../admin-tabs';
import { AssetTypesPage } from './asset-types-page';

type Mock = ReturnType<typeof vi.fn>;

describe('AssetTypesPage (#634, #637)', () => {
  let api: Record<'listAssetTypes' | 'updateAssetType', Mock>;
  let fixture: ComponentFixture<AssetTypesPage>;
  let query: ReturnType<typeof fakeQuery>;
  let navigate: Mock;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));

  const docs = () =>
    anAssetType({
      assetTypeId: 4,
      name: 'Document Set',
      sortOrder: 10,
      assetCount: 12,
      fieldCount: 8,
      publishedAtUtc: '2026-10-12T15:00:00Z',
    });
  const rooms = () =>
    anAssetType({
      assetTypeId: 6,
      name: 'Data Room',
      sortOrder: 20,
      assetCount: 0,
      publishedFormVersionId: undefined,
      publishedFormVersionNo: undefined,
      draftVersionNo: 1,
    });
  const source = () =>
    anAssetType({
      assetTypeId: 5,
      name: 'Source System',
      sortOrder: 30,
      isActive: false,
      assetCount: 2,
      publishedFormVersionId: undefined,
      publishedFormVersionNo: undefined,
    });

  async function create(
    permissions: Permission[],
    params: Record<string, string> = {},
    rows = [docs(), rooms(), source()],
  ): Promise<void> {
    localStorage.clear();
    query = fakeQuery();
    api = {
      listAssetTypes: vi.fn().mockReturnValue(ok(pageOfAssetTypes(...rows))),
      updateAssetType: vi
        .fn()
        .mockImplementation((id: number, body: { sortOrder: number; isActive: boolean }) => {
          const base = [...rows].find((r) => r.assetTypeId === id)!;
          return ok({ ...base, ...body, rowVersion: `NEW${id}` });
        }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        AdminTabCounts,
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

  /** The address as the list sees it: the filters read the query, the Status is an input of the route (the page above passes it down). */
  async function show(params: Record<string, string>): Promise<void> {
    query.reset();
    query.set(params);
    fixture.componentRef.setInput('status', params['status']);
    await settle(fixture);
  }

  const rowNames = (): string[] =>
    all('[data-types] tbody tr[data-row]').map((r) => r.getAttribute('data-row')!);

  async function menuOf(name: string): Promise<HTMLElement[]> {
    q<HTMLButtonElement>(`tr[data-row="${name}"] button[data-overflow]`).click();
    await settle(fixture);
    return all('[role=menuitem]');
  }

  const confirmDeactivation = (): void => {
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Deactivate asset type' && b.closest('p-dialog, .p-dialog'),
    );
    expect(confirm).toBeDefined();
    confirm!.click();
  };

  describe('the list as a person who manages types and may see assets', () => {
    beforeEach(() => create(['AssetType.Manage', 'Asset.View', 'Audit.View']));

    it('loads every type once, with no inactive rows by default, in the order they are offered', () => {
      expect(api.listAssetTypes).toHaveBeenCalledTimes(1);
      expect(api.listAssetTypes).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        1,
        100,
        'sortOrder',
      );
      expect(rowNames()).toEqual(['Document Set', 'Data Room']);
    });

    it('has the name as the one link, the form status, the asset count, the status and one menu', () => {
      const row = q('tr[data-row="Document Set"]');
      expect(row.querySelectorAll('a')).toHaveLength(1);
      expect(row.querySelector('a')!.getAttribute('href')).toBe('/admin/asset-types/4');
      const fields = row.querySelector('[data-fields]')!.textContent!.replace(/\s+/g, ' ');
      expect(fields).toContain('Published v2');
      expect(fields).toContain('8 fields');
      expect(fields).toContain('Updated Oct 12');
      expect(row.querySelector('[data-assets]')!.textContent!.trim()).toBe('12');
      expect(row.textContent).toContain('Active');
      expect(row.querySelectorAll('button[data-overflow]')).toHaveLength(1);
      const draft = q('tr[data-row="Data Room"] [data-fields]').textContent!.replace(/\s+/g, ' ');
      expect(draft).toContain('No published fields');
      expect(draft).toContain('Draft v1');
    });

    it('has columns Name, Fields, Assets, Status and a menu, and the description is not in the list', () => {
      expect(all('[data-types] thead tr:first-child th').map((t) => t.textContent!.trim())).toEqual(
        ['Name', 'Fields', 'Assets', 'Status', 'Actions'],
      );
      expect(el().textContent).not.toContain('Sets of documents');
    });

    it('counts the strip over the whole list: Active 2, No published fields 1, Inactive 1', () => {
      const strip = all('[data-strip-item]').map((i) => i.textContent!.replace(/\s+/g, ' ').trim());
      expect(strip).toEqual(['Active 2', 'No published fields 1', 'Inactive 1']);
    });

    it('says how many inactive types are hidden and Show all puts Status = All in the address', () => {
      expect(q('[data-hidden-hint]').textContent).toContain('1 inactive hidden');
      q<HTMLButtonElement>('[data-show-all]').click();
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { status: 'all', page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('filters by name and by the strip chip, here in the browser, without asking the API again', async () => {
      await show({ name: 'room' });
      expect(rowNames()).toEqual(['Data Room']);
      await show({ fields: 'none' });
      expect(rowNames()).toEqual(['Data Room']);
      await show({ status: 'all' });
      expect(rowNames()).toEqual(['Document Set', 'Data Room', 'Source System']);
      await show({ status: 'inactive' });
      expect(rowNames()).toEqual(['Source System']);
      await show({ status: 'all', fields: 'none' });
      expect(rowNames()).toEqual(['Data Room', 'Source System']);
      expect(api.listAssetTypes).toHaveBeenCalledTimes(1);
    });

    it('puts the matching filters in the address when a strip chip is pressed', async () => {
      q('[data-strip-item="noFields"]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { status: null, fields: 'none', page: null },
        queryParamsHandling: 'merge',
      });
      q('[data-strip-item="inactive"]').click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { status: 'inactive', fields: null, page: null },
        queryParamsHandling: 'merge',
      });
      await settle(fixture);
      expect(q('[data-announce]').textContent).toContain('Inactive: 1 asset types.');
    });

    it('has the row menu in order: Edit, Edit fields, History, Move up, Move down, Deactivate', async () => {
      const items = await menuOf('Data Room');
      expect(items.map((i) => i.getAttribute('data-action'))).toEqual([
        'edit',
        'fields',
        'history',
        'up',
        'down',
        'deactivate',
      ]);
    });

    it('disables Move up on the first row and Move down on the last, and says why on screen', async () => {
      const first = await menuOf('Document Set');
      const up = first.find((i) => i.getAttribute('data-action') === 'up')!;
      expect(up.getAttribute('aria-disabled')).toBe('true');
      expect(up.textContent).toContain('Already first.');
    });

    it('asks before Deactivate with the number of assets that keep the type, then saves it', async () => {
      const items = await menuOf('Document Set');
      items.find((i) => i.getAttribute('data-action') === 'deactivate')!.click();
      await settle(fixture);
      expect(document.body.textContent).toContain('Deactivate asset type?');
      expect(document.body.textContent).toContain('12 assets keep this type.');
      expect(api.updateAssetType).not.toHaveBeenCalled();
      confirmDeactivation();
      await settle(fixture);
      expect(api.updateAssetType).toHaveBeenCalledWith(4, {
        name: 'Document Set',
        description: 'Sets of documents',
        sortOrder: 10,
        isActive: false,
        rowVersion: 'TTTT',
      });
      expect(q('[data-announce]').textContent).toContain('Document Set deactivated.');
    });

    it('moves a type down by swapping the order with its neighbour in two saves, and announces it', async () => {
      const items = await menuOf('Document Set');
      items.find((i) => i.getAttribute('data-action') === 'down')!.click();
      await settle(fixture);
      expect(api.updateAssetType).toHaveBeenCalledTimes(2);
      expect(api.updateAssetType).toHaveBeenNthCalledWith(
        1,
        4,
        expect.objectContaining({ sortOrder: 20 }),
      );
      expect(api.updateAssetType).toHaveBeenNthCalledWith(
        2,
        6,
        expect.objectContaining({ sortOrder: 10 }),
      );
      expect(rowNames()).toEqual(['Data Room', 'Document Set']);
      expect(q('[data-announce]').textContent).toContain('Document Set moved to position 2 of 2.');
    });

    it('moves among the rows that are shown: with Show all the inactive neighbour counts', async () => {
      await show({ status: 'all' });
      const items = await menuOf('Data Room');
      items.find((i) => i.getAttribute('data-action') === 'down')!.click();
      await settle(fixture);
      expect(api.updateAssetType).toHaveBeenNthCalledWith(
        1,
        6,
        expect.objectContaining({ sortOrder: 30 }),
      );
      expect(api.updateAssetType).toHaveBeenNthCalledWith(
        2,
        5,
        expect.objectContaining({ sortOrder: 20 }),
      );
    });

    it('gives two types with the same position distinct ones so the move changes the order', async () => {
      fixture.destroy();
      TestBed.resetTestingModule();
      await create(['AssetType.Manage'], {}, [
        anAssetType({ assetTypeId: 1, name: 'A', sortOrder: 10 }),
        anAssetType({ assetTypeId: 2, name: 'B', sortOrder: 10 }),
      ]);
      const items = await menuOf('A');
      items.find((i) => i.getAttribute('data-action') === 'down')!.click();
      await settle(fixture);
      expect(api.updateAssetType).toHaveBeenNthCalledWith(
        1,
        1,
        expect.objectContaining({ sortOrder: 11 }),
      );
      expect(api.updateAssetType).toHaveBeenNthCalledWith(
        2,
        2,
        expect.objectContaining({ sortOrder: 10 }),
      );
    });

    it('activates an inactive type straight away, without a question', async () => {
      await show({ status: 'inactive' });
      const items = await menuOf('Source System');
      items.find((i) => i.getAttribute('data-action') === 'activate')!.click();
      await settle(fixture);
      expect(api.updateAssetType).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ isActive: true, rowVersion: 'TTTT' }),
      );
    });
  });

  describe('permissions', () => {
    it('has no Assets column and no History entry without Asset.View and Audit.View, and shows no count', async () => {
      const noCount = [docs(), rooms()].map((t) => ({ ...t, assetCount: undefined }));
      await create(['AssetType.Manage'], {}, noCount);
      expect(all('[data-types] thead tr:first-child th').map((t) => t.textContent!.trim())).toEqual(
        ['Name', 'Fields', 'Status', 'Actions'],
      );
      const items = await menuOf('Document Set');
      expect(items.map((i) => i.getAttribute('data-action'))).not.toContain('history');
    });
  });

  describe('states', () => {
    it('says there are no asset types yet, with no second New button', async () => {
      await create(['AssetType.Manage'], {}, []);
      expect(q('td[data-empty]').textContent).toContain('No asset types yet.');
      expect(el().querySelector('[data-new]')).toBeNull();
    });

    it('shows one error with Retry that loads again', async () => {
      await create(['AssetType.Manage']);
      api.listAssetTypes.mockReturnValue(apiError(500, { title: 'Error', status: 500 }));
      await fixture.componentInstance['load']();
      await settle(fixture);
      expect(q('[data-error]')).not.toBeNull();
      api.listAssetTypes.mockReturnValue(ok(pageOfAssetTypes(docs())));
      q<HTMLButtonElement>('[data-error] button').click();
      await settle(fixture);
      expect(rowNames()).toEqual(['Document Set']);
    });

    it('loads page after page when there are more than 100 types', async () => {
      await create(['AssetType.Manage']);
      const many = Array.from({ length: 101 }, (_, i) =>
        anAssetType({ assetTypeId: 100 + i, name: `Type ${i}`, sortOrder: i }),
      );
      api.listAssetTypes.mockReset();
      api.listAssetTypes
        .mockReturnValueOnce(ok({ ...pageOfAssetTypes(...many.slice(0, 100)), total: 101 }))
        .mockReturnValueOnce(ok({ ...pageOfAssetTypes(many[100]), total: 101 }));
      await fixture.componentInstance['load']();
      await settle(fixture);
      expect(api.listAssetTypes).toHaveBeenCalledTimes(2);
      expect(api.listAssetTypes).toHaveBeenLastCalledWith(
        undefined,
        undefined,
        undefined,
        2,
        100,
        'sortOrder',
      );
    });
  });
});
