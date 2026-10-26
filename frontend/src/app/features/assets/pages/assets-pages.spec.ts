import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  ActivatedRoute,
  ParamMap,
  Router,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';
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
import { SkipTarget } from '../../../shared/layout/skip-target';
import { provideLookups } from '../../../shared/work-queue/work-queue-testing';
import { ASSETS_ROUTES } from '../assets.routes';
import { AssetFormPage, externalReferenceError } from './asset-form-page';
import { AssetsListPage } from './assets-list-page';

type Mock = ReturnType<typeof vi.fn>;

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

describe('Assets routes', () => {
  it('opens the record page at /assets/:id', () => {
    const route = ASSETS_ROUTES[0].children!.find((r) => r.path === ':assetId')!;
    expect(route.redirectTo).toBeUndefined();
    expect(route.loadComponent).toBeDefined();
    expect(route.title).toBe('Asset');
  });

  it('sends an older /assets?selected=<id> link once to /assets/<id>, and leaves other list addresses alone', async () => {
    const list = ASSETS_ROUTES[0].children!.find((r) => r.path === '')!;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'assets',
            children: [
              { path: '', canActivate: list.canActivate, component: Blank },
              { path: ':assetId', component: Blank },
            ],
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/assets?selected=42&status=all');
    expect(TestBed.inject(Router).url).toBe('/assets/42');
    await harness.navigateByUrl('/assets?selected=abc');
    expect(TestBed.inject(Router).url).toBe('/assets?selected=abc');
    await harness.navigateByUrl('/assets?name=x');
    expect(TestBed.inject(Router).url).toBe('/assets?name=x');
  });

  it('guards New with Asset.Create and Edit with Asset.Edit (the 403 page), and unsaved changes on both (#515)', () => {
    const children = ASSETS_ROUTES[0].children!;
    const route = (path: string) => children.find((r) => r.path === path)!;
    expect(route('new').canActivate).toHaveLength(1);
    expect(route(':assetId/edit').canActivate).toHaveLength(1);
    expect(route('new').canDeactivate).toHaveLength(1);
    expect(route(':assetId/edit').canDeactivate).toHaveLength(1);
    // The record page needs no permission of its own: the parent route of the area needs Asset.View.
    expect(route(':assetId').canActivate).toBeUndefined();
  });

  it('keeps the create and edit addresses', () => {
    const paths = ASSETS_ROUTES[0].children!.map((r) => r.path);
    expect(paths).toEqual(['', 'reports', 'new', ':assetId/edit', ':assetId']);
  });
});

describe('Assets pages', { timeout: 20_000 }, () => {
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
  /** The query string the page reads its filters from (ListFilters reads the route; the router itself is mocked). */
  let query$: BehaviorSubject<ParamMap>;
  const FILTER_PARAMS = ['name', 'typeId', 'matter', 'extref', 'matterId', 'status'];

  function setQuery(inputs: Record<string, string>): void {
    const next: Record<string, string> = {};
    for (const k of query$.value.keys) next[k] = query$.value.get(k)!;
    for (const [k, v] of Object.entries(inputs)) if (FILTER_PARAMS.includes(k)) next[k] = v;
    query$.next(convertToParamMap(next));
  }

  async function configure(permissions: Permission[]): Promise<void> {
    assets = {
      listAssets: vi.fn().mockReturnValue(
        ok(
          pageOfAssets(
            anAssetListItem(),
            anAssetListItem({
              assetId: 10,
              displayName: 'Old room',
              isActive: false,
              dispositionCode: 'INACTIVE',
            }),
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
    query$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useFactory: () => {
            const root = inject(Router).routerState.root;
            return Object.create(root, {
              queryParamMap: { value: query$.asObservable() },
              snapshot: {
                value: Object.create(root.snapshot, { queryParamMap: { value: query$.value } }),
              },
            });
          },
        },
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
    let fixture: ComponentFixture<AssetsListPage>;
    const el = (): HTMLElement => fixture.nativeElement;
    const filterRow = (): HTMLElement | null => el().querySelector('[data-filter-row]');
    const control = <T extends HTMLElement>(name: string): T =>
      el().querySelector<T>(
        `[aria-label="Filter by ${name}"], [aria-label^="Filter by ${name},"]`,
      )!;
    const toggle = (): HTMLButtonElement =>
      el().querySelector<HTMLButtonElement>('[data-filters-toggle]')!;
    const rowOf = (id: number): HTMLElement | null =>
      el().querySelector(`tbody tr[data-asset-id="${id}"]`);

    const width = window.innerWidth;
    beforeEach(() => {
      localStorage.clear();
      // The External reference column is on screen from 1280 px.
      Object.defineProperty(window, 'innerWidth', { value: 1366, configurable: true });
    });
    afterEach(() =>
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true }),
    );

    async function create(permissions: Permission[], inputs: Record<string, string> = {}) {
      await configure(permissions);
      setQuery(inputs);
      fixture = TestBed.createComponent(AssetsListPage);
      for (const [k, v] of Object.entries(inputs))
        if (!FILTER_PARAMS.includes(k) || k === 'status') fixture.componentRef.setInput(k, v);
      await settle(fixture);
      return fixture;
    }

    async function setInputs(inputs: Record<string, string>): Promise<void> {
      setQuery(inputs);
      for (const [k, v] of Object.entries(inputs))
        if (!FILTER_PARAMS.includes(k) || k === 'status') fixture.componentRef.setInput(k, v);
      await settle(fixture);
    }

    function typeAndEnter(name: string, text: string): void {
      const box = control<HTMLInputElement>(name);
      box.value = text;
      box.dispatchEvent(new Event('input'));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }

    it('My matters / All: scoped for a project manager, plain otherwise, the address wins (epic #758)', async () => {
      const calls = () =>
        (assets.listAssets as ReturnType<typeof vi.fn>).mock.calls
          .filter((c) => c[12] !== 1)
          .map((c) => c[7]);
      await create(['Asset.View']);
      expect(el().querySelector('[data-scope-switch]')).toBeNull();
      expect(calls()).toEqual([undefined]);
      TestBed.resetTestingModule();
      await create(['Asset.View', 'Matter.BeManager', 'Matter.AssignManagers']);
      expect(calls()).toEqual([true]);
      expect(el().querySelector('[data-scope-line]')?.textContent).toContain(
        'Assets of matters you manage',
      );
      TestBed.resetTestingModule();
      await create(['Asset.View', 'Matter.BeManager', 'Matter.AssignManagers'], { matterId: '7' });
      expect(calls()).toEqual([undefined]);
    });

    it('lists assets with type, matter reference, external reference and status; the name is a link', async () => {
      await create(['Asset.View', 'Asset.Create', 'Matter.View']);
      const rows = el().querySelectorAll('tbody tr');

      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('td:first-child a')?.textContent?.trim()).toBe(
        'Contract bundle',
      );
      expect(rows[0].textContent).toContain('Document Set');
      expect(rows[0].querySelector('.mf-ref')?.textContent).toBe('00343-00012');
      expect(rows[0].querySelector('.mf-ref')?.closest('a')?.getAttribute('href')).toBe(
        '/matters/7',
      );
      expect(rows[0].textContent).toContain('https://dms.example/folders/42');
      expect(rows[1].textContent).toContain('Inactive');
      expect(
        Array.from(el().querySelectorAll('thead tr:first-child th')).map((t) =>
          t.textContent!.trim(),
        ),
      ).toEqual(['Name', 'Type', 'Matter number', 'Size', 'External reference', 'Disposition']);
      expect(assets.listAssets).toHaveBeenCalledWith(
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        25,
        undefined,
      );
      // The three standalone filter boxes are gone.
      expect(el().querySelector('#asset-search, #asset-type-filter, mf-status-filter')).toBeNull();
    });

    it('shows the external reference on one line with the full value as tooltip and a copy button that is not a Tab stop (BUG-5)', async () => {
      const long = 'https://dms.example/' + 'very-long-folder/'.repeat(60);
      await create(['Asset.View']);
      assets.listAssets.mockReturnValue(
        ok(
          pageOfAssets(
            anAssetListItem({ assetId: 9, externalReference: long }),
            anAssetListItem({ assetId: 10, externalReference: undefined }),
          ),
        ),
      );
      await setInputs({ sort: 'assetType' });

      const cell = rowOf(9)!.querySelector('td[data-reference]')!;
      const text = cell.querySelector('.as-ref__text')!;
      expect(text.textContent?.trim()).toBe(long);
      expect(text.getAttribute('title')).toBe(long);
      const copy = cell.querySelector<HTMLButtonElement>('button.mf-copy')!;
      expect(copy.getAttribute('aria-label')).toBe('Copy external reference');
      expect(copy.getAttribute('tabindex')).toBe('-1');
      expect(copy.hasAttribute('data-row-stop')).toBe(true);

      const empty = rowOf(10)!.querySelector('td[data-reference]')!;
      expect(empty.textContent).toContain('\u2013');
      expect(empty.querySelector('button')).toBeNull();
      expect(empty.textContent).toContain('No external reference');
    });

    it('draws 44 px rows: one link and no copy button in a row but the reference, matter name only as a tooltip, only Inactive has a badge (A2)', async () => {
      await create(['Asset.View', 'Matter.View']);
      const row = rowOf(9)!;
      expect(row.querySelectorAll('a')).toHaveLength(2); // the name and the matter number
      expect(row.querySelectorAll('mf-matter-ref mf-copy-button')).toHaveLength(0);
      expect(row.querySelector('.as-sub')).toBeNull();
      expect(row.querySelector('td[data-matter]')?.getAttribute('title')).toBe('Merger Review');
      expect(row.querySelector('[data-status] mf-badge')).toBeNull();
      expect(row.querySelector('[data-status]')?.textContent).toContain('Active');
      expect(rowOf(10)!.querySelector('[data-status] mf-badge')?.textContent).toContain('Inactive');
      expect(el().querySelector('table.mf-grid')).not.toBeNull();
    });

    describe('disposition, size and the bulk change (epic #851, issue #866)', () => {
      const rows = () =>
        ok(
          pageOfAssets(
            anAssetListItem({
              assetId: 9,
              sizeValue: 412,
              sizeUnit: 'GB',
              sizeBytes: 442381631488,
            }),
            anAssetListItem({
              assetId: 10,
              displayName: 'Harvey Vault 2',
              isActive: false,
              dispositionCode: 'PENDING_DISPOSITION',
              inactiveLinked: true,
              linkedTaskCount: 2,
              openLinkedTaskCount: 1,
            }),
            anAssetListItem({
              assetId: 11,
              displayName: 'Prod set 7',
              isActive: false,
              dispositionCode: 'DISPOSED',
              sizeValue: 26400,
              sizeUnit: 'Items',
            }),
          ),
        );

      it('shows the size, a badge for every state but Active, and a warning for a not-active asset that is still linked', async () => {
        await create(['Asset.View', 'Task.View']);
        assets.listAssets.mockReturnValue(rows());
        await setInputs({ sort: 'assetType' });

        expect(rowOf(9)!.querySelector('[data-size]')?.textContent?.trim()).toBe('412 GB');
        expect(rowOf(10)!.querySelector('[data-size]')?.textContent).toContain('No size');
        expect(rowOf(11)!.querySelector('[data-size]')?.textContent?.trim()).toBe('26,400 Items');
        expect(rowOf(9)!.querySelector('[data-status] mf-badge')).toBeNull();
        expect(rowOf(10)!.querySelector('[data-disposition-badge]')?.textContent).toContain(
          'Pending disposition',
        );
        expect(rowOf(11)!.querySelector('[data-disposition-badge]')?.textContent).toContain(
          'Disposed',
        );
        expect(rowOf(10)!.querySelector('[data-inactive-linked]')?.textContent).toContain(
          'Still linked to open tasks',
        );
        expect(rowOf(11)!.querySelector('[data-inactive-linked]')).toBeNull();
      });

      it('sorts by size and by disposition through the header', async () => {
        await create(['Asset.View']);
        const heads = Array.from(el().querySelectorAll<HTMLElement>('thead tr:first-child th'));
        expect(heads.find((h) => h.textContent!.trim() === 'Size')?.getAttribute('aria-sort')).toBe(
          'none',
        );
        heads
          .find((h) => h.textContent!.trim() === 'Size')!
          .querySelector('button')!
          .click();
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: expect.objectContaining({ sort: '-size' }) }),
        );
        heads
          .find((h) => h.textContent!.trim() === 'Disposition')!
          .querySelector('button')!
          .click();
        expect(navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({
            queryParams: expect.objectContaining({ sort: 'disposition' }),
          }),
        );
      });

      it('asks the server for the chosen disposition: Pending disposition as a disposition filter, Not active as isActive=false', async () => {
        await create(['Asset.View'], { status: 'pending' });
        let call = assets.listAssets.mock.calls.find((c) => c[12] !== 1)!;
        expect(call[2]).toBeUndefined(); // no isActive
        expect(call[9]).toEqual(['PENDING_DISPOSITION']);

        TestBed.resetTestingModule();
        await create(['Asset.View'], { status: 'notactive' });
        call = assets.listAssets.mock.calls.find((c) => c[12] !== 1)!;
        expect(call[2]).toBe(false);
        expect(call[9]).toBeUndefined();

        TestBed.resetTestingModule();
        await create(['Asset.View'], { status: 'disposed' });
        call = assets.listAssets.mock.calls.find((c) => c[12] !== 1)!;
        expect(call[9]).toEqual(['DISPOSED']);
      });

      it('has no selection column without Asset.Edit or Asset.Dispose', async () => {
        await create(['Asset.View']);
        expect(el().querySelector('[data-select-all], [data-select-row]')).toBeNull();
        TestBed.resetTestingModule();
        await create(['Asset.View', 'Asset.Dispose']);
        expect(el().querySelector('[data-select-all]')).not.toBeNull();
      });

      it('selects rows, shows the bulk bar with the count, opens the dialog for the selection and clears', async () => {
        await create(['Asset.View', 'Asset.Edit', 'Task.View']);
        assets.listAssets.mockReturnValue(rows());
        await setInputs({ sort: 'assetType' });
        expect(el().querySelector('[data-bulk-bar]')).toBeNull();

        rowOf(9)!.querySelector<HTMLInputElement>('[data-select-row]')!.click();
        await settle(fixture);
        expect(el().querySelector('[data-bulk-count]')?.textContent).toContain('1 asset selected');
        expect(
          rowOf(9)!
            .querySelector<HTMLInputElement>('[data-select-row]')!
            .getAttribute('aria-label'),
        ).toBe('Select Contract bundle');

        el().querySelector<HTMLInputElement>('[data-select-all]')!.click();
        await settle(fixture);
        expect(el().querySelector('[data-bulk-count]')?.textContent).toContain('3 assets selected');

        el().querySelector<HTMLButtonElement>('[data-bulk-disposition]')!.click();
        await settle(fixture);
        expect(document.body.querySelector('[data-disposition-subject]')?.textContent).toContain(
          '3 selected assets',
        );
        document.body.querySelector<HTMLButtonElement>('.p-dialog-footer button')!.click(); // Cancel
        await settle(fixture);

        el().querySelector<HTMLButtonElement>('[data-bulk-clear]')!.click();
        await settle(fixture);
        expect(el().querySelector('[data-bulk-bar]')).toBeNull();
      });
    });

    it('shows the open linked tasks as a number with the total as tooltip, sorted by it, only with Task.View (A2, #498)', async () => {
      await create(['Asset.View', 'Task.View']);
      assets.listAssets.mockReturnValue(
        ok(
          pageOfAssets(
            anAssetListItem({ assetId: 9, linkedTaskCount: 19, openLinkedTaskCount: 4 }),
            anAssetListItem({ assetId: 10, linkedTaskCount: 0, openLinkedTaskCount: 0 }),
          ),
        ),
      );
      await setInputs({ sort: 'assetType' });
      expect(
        Array.from(el().querySelectorAll('thead tr:first-child th')).map((t) =>
          t.textContent!.trim(),
        ),
      ).toEqual([
        'Name',
        'Type',
        'Matter number',
        'Size',
        'Linked tasks',
        'External reference',
        'Disposition',
      ]);
      const cell = rowOf(9)!.querySelector('td[data-linked]')!;
      expect(cell.querySelector('[aria-hidden="true"]')?.textContent).toBe('4');
      expect(cell.querySelector('[title]')?.getAttribute('title')).toBe('19 linked in total');
      expect(cell.querySelector('.mf-sr-only')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        '4 open of 19 linked tasks',
      );
      // Plain text, also at 0: no link to an empty list (the Task Queue cannot filter by asset).
      expect(rowOf(9)!.querySelector('td[data-linked] a')).toBeNull();
      expect(rowOf(10)!.querySelector('td[data-linked] [aria-hidden="true"]')?.textContent).toBe(
        '0',
      );
      // The first click on a count sorts the busiest asset first.
      const header = Array.from(el().querySelectorAll('thead th')).find((t) =>
        t.textContent?.includes('Linked tasks'),
      )!;
      header.querySelector('button')!.click();
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { sort: '-linkedTaskCount', page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('sorts by Matter number, then Name, and keeps Name and Type sortable (A11)', async () => {
      await create(['Asset.View']);
      const header = (text: string) =>
        Array.from(el().querySelectorAll<HTMLElement>('thead tr:first-child th')).find((t) =>
          t.textContent?.includes(text),
        )!;
      header('Matter number').querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { sort: 'matter', page: null },
        queryParamsHandling: 'merge',
      });
      await setInputs({ sort: 'matter' });
      expect(header('Matter number').getAttribute('aria-sort')).toBe('ascending');
      expect(header('Name').getAttribute('aria-sort')).toBe('none');
      header('Matter number').querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { sort: '-matter', page: null },
        queryParamsHandling: 'merge',
      });
      expect(header('Type').querySelector('button')).not.toBeNull();
      expect(assets.listAssets.mock.calls.some((c) => c[13] === 'matter')).toBe(true);
    });

    it('offers Skip to table as the first stop of the page and it lands on the first name link (A9, #503)', async () => {
      await create(['Asset.View']);
      const target = TestBed.inject(SkipTarget).target()!;
      expect(target.label).toBe('Skip to table');
      document.body.appendChild(el());
      target.focus();
      expect(document.activeElement).toBe(rowOf(9)!.querySelector('a.mf-name'));
      el().remove();
      // One Tab stop in a row without Matter.View: the name link and nothing else (the reference copy button is not a stop).
      expect(
        rowOf(9)!.querySelectorAll('a[href], button:not([tabindex="-1"]), [tabindex="0"]'),
      ).toHaveLength(1);
    });

    describe('on a phone', () => {
      const original = window.matchMedia;
      afterEach(() => {
        window.matchMedia = original;
      });
      function phone(): void {
        window.matchMedia = ((query: string) => ({
          matches: /max-width/.test(query),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        })) as never;
      }

      it('shows one card per asset instead of the table: the name is the link, type, matter number, open tasks and an Inactive badge (A4, #502)', async () => {
        phone();
        await create(['Asset.View', 'Task.View']);
        assets.listAssets.mockReturnValue(
          ok(
            pageOfAssets(
              anAssetListItem({ assetId: 9, linkedTaskCount: 19, openLinkedTaskCount: 4 }),
              anAssetListItem({
                assetId: 10,
                displayName: 'Old room',
                isActive: false,
                dispositionCode: 'INACTIVE',
                linkedTaskCount: 1,
                openLinkedTaskCount: 1,
              }),
            ),
          ),
        );
        await setInputs({ sort: 'assetType' });

        expect(el().querySelector('table')).toBeNull();
        const cards = el().querySelectorAll('li.rc');
        expect(cards).toHaveLength(2);
        const first = cards[0];
        expect(first.querySelector('a')?.getAttribute('href')).toBe('/assets/9');
        expect(first.textContent).toContain('Contract bundle');
        expect(first.textContent).toContain('Document Set');
        expect(first.textContent).toContain('Matter 00343-00012');
        expect(first.textContent).toContain('4 open tasks');
        expect(first.textContent).not.toContain('Inactive');
        expect(cards[1].textContent).toContain('Inactive');
        expect(cards[1].textContent).toContain('1 open task');
        // The matter number is text on a card, whatever the permissions (the card is the link).
        expect(el().querySelectorAll('a[href^="/matters"]')).toHaveLength(0);
        // The filter row lives in the sheet below 640 px: no filter row in the page.
        expect(filterRow()).toBeNull();
      });

      it('leaves the tasks line out without Task.View', async () => {
        phone();
        await create(['Asset.View']);
        expect(el().querySelectorAll('li.rc')).toHaveLength(2);
        expect(el().textContent).not.toContain('open task');
      });
    });

    it('leaves the Linked tasks column out without Task.View', async () => {
      await create(['Asset.View']);
      expect(el().querySelector('td[data-linked]')).toBeNull();
      expect(el().textContent).not.toContain('Linked tasks');
    });

    it('shows the matter number as plain text, not a link, without Matter.View (BUG-1)', async () => {
      await create(['Asset.View']);
      const rows = el().querySelectorAll('tbody tr');
      expect(rows).toHaveLength(2);
      expect(el().querySelectorAll('a[href^="/matters"]')).toHaveLength(0);
      for (const row of Array.from(rows)) {
        const ref = row.querySelector('.mf-ref')!;
        expect(ref.textContent).toBe('00343-00012');
        expect(ref.tagName).toBe('SPAN');
        expect(ref.closest('a')).toBeNull();
      }
    });

    it('has the Filters button in the page header; the filter row is open from the start and the button hides and shows it (A3)', async () => {
      await create(['Asset.View']);
      const header = el().querySelector('mf-page-header')!;
      const table = el().querySelector('table')!;
      expect(header.contains(toggle())).toBe(true);
      expect(header.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(toggle().textContent).toContain('Filters');
      expect(toggle().querySelector('.pi-filter')).not.toBeNull();
      expect(toggle().getAttribute('aria-pressed')).toBe('true');
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().getAttribute('aria-controls')).toBe('asset-filter-row');
      const row = filterRow()!;
      // The second row of the table head, one cell under each column header.
      expect(row.parentElement?.tagName).toBe('THEAD');
      expect(row.previousElementSibling?.querySelector('th')).not.toBeNull();
      expect(row.querySelectorAll('td')).toHaveLength(
        el().querySelectorAll('thead tr:first-child th').length,
      );
      for (const name of ['Name', 'Type', 'Matter', 'External reference', 'Disposition'])
        expect(control(name), name).not.toBeNull();
      // Type is a multi-select: a button that says "All types", the choices are in its panel.
      expect(control<HTMLButtonElement>('Type').textContent).toContain('All types');
      control<HTMLButtonElement>('Type').click();
      await settle(fixture);
      expect(
        Array.from(el().querySelectorAll('mf-filter-popover .ms-label')).map((o) =>
          o.textContent!.trim(),
        ),
      ).toEqual(['Document Set', 'Source System']);
      control<HTMLButtonElement>('Type').click();
      await settle(fixture);
      expect(
        Array.from(control<HTMLSelectElement>('Disposition').options).map((o) =>
          o.textContent!.trim(),
        ),
      ).toEqual(['Active', 'Inactive', 'Pending', 'Disposed', 'All']);
      expect(control<HTMLSelectElement>('Disposition').value).toBe('active');

      toggle().click();
      await settle(fixture);
      expect(filterRow()).toBeNull();
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
    });

    it('remembers whether the filter row is open, per user, and copes with blocked storage', async () => {
      await create(['Asset.View']);
      expect(filterRow()).not.toBeNull();
      toggle().click();
      await settle(fixture);
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('mf.assets.filters.open'));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/\.\d+$/); // per user
      expect(localStorage.getItem(keys[0])).toBe('0');

      fixture.destroy();
      fixture = TestBed.createComponent(AssetsListPage);
      await settle(fixture);
      expect(filterRow()).toBeNull();
      toggle().click();
      await settle(fixture);
      expect(localStorage.getItem(keys[0])).toBe('1');

      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      fixture.destroy();
      fixture = TestBed.createComponent(AssetsListPage);
      await settle(fixture);
      expect(filterRow()).not.toBeNull(); // open by default
      toggle().click();
      await settle(fixture);
      expect(filterRow()).toBeNull(); // still works for this visit
      vi.restoreAllMocks();
    });

    it('opens the filter row by itself when the address carries filters, shows their count and the filter values', async () => {
      await create(['Asset.View'], {
        name: 'bundle',
        matter: '343-12',
        extref: 'WS',
        typeId: '4',
        status: 'inactive',
      });
      expect(filterRow()).not.toBeNull();
      expect(toggle().querySelector('[data-filter-count]')?.textContent).toBe('(5)');
      expect(control<HTMLInputElement>('Name').value).toBe('bundle');
      expect(control<HTMLInputElement>('Matter').value).toBe('343-12');
      expect(control<HTMLInputElement>('External reference').value).toBe('WS');
      expect(control<HTMLButtonElement>('Type').textContent).toContain('Document Set');
      expect(control<HTMLSelectElement>('Disposition').value).toBe('inactive');
      expect(el().querySelector('[data-clear-filters]')).not.toBeNull();
    });

    it('sends the filters of the URL to the server and keeps the matter when creating', async () => {
      await create(['Asset.View', 'Asset.Create'], {
        matterId: '7',
        typeId: '4',
        name: 'dms',
        extref: 'WS-1',
        matter: '00343',
        status: 'all',
        page: '2',
        sort: '-displayName',
      });

      expect(assets.listAssets).toHaveBeenLastCalledWith(
        7,
        [4],
        undefined,
        undefined,
        'dms',
        'WS-1',
        '00343',
        undefined,
        undefined,
        undefined,
        undefined,
        2,
        25,
        '-displayName',
      );
      expect(el().querySelector('[data-chip="matterId"]')?.textContent).toContain(
        'Matter: 00343-00012 Merger Review',
      );
      buttonByLabel(el(), 'New asset')!.click();
      expect(navigateByUrl).toHaveBeenCalledWith('/assets/new?matterId=7');
      const remove = el().querySelector<HTMLButtonElement>('[data-chip="matterId"] button')!;
      expect(remove.getAttribute('aria-label')).toBe(
        'Remove filter Matter: 00343-00012 Merger Review',
      );
      remove.click();
      expect(navigate).toHaveBeenCalledWith([], {
        queryParams: { matterId: null, page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('puts every column filter into the URL and resets the page', async () => {
      await create(['Asset.View'], { page: '3' });
      await settle(fixture);

      typeAndEnter('Name', ' relativity ');
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { name: 'relativity', page: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      typeAndEnter('Matter', '343-12');
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { matter: '343-12', page: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      typeAndEnter('External reference', 'ds-room');
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { extref: 'ds-room', page: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });

      // Type is a multi-select: tick a choice, Done applies it (several types go to the URL as a list).
      control<HTMLButtonElement>('Type').click();
      await settle(fixture);
      el().querySelector<HTMLInputElement>('mf-filter-popover [data-option="4"]')!.click();
      el().querySelector<HTMLInputElement>('mf-filter-popover [data-option="5"]')!.click();
      Array.from(el().querySelectorAll<HTMLButtonElement>('mf-filter-popover button'))
        .find((b) => b.textContent?.trim() === 'Done')!
        .click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { typeId: ['4', '5'], page: null },
        queryParamsHandling: 'merge',
      });

      const status = control<HTMLSelectElement>('Disposition');
      status.value = 'all';
      status.dispatchEvent(new Event('change'));
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { status: 'all', page: null },
        queryParamsHandling: 'merge',
      });
      status.value = 'active';
      status.dispatchEvent(new Event('change'));
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { status: null, page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('clears a text filter with its x button', async () => {
      await create(['Asset.View'], { name: 'bundle' });
      el().querySelector<HTMLButtonElement>('[aria-label="Clear Name filter"]')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { name: null, page: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    it('offers Clear filters in the bar only while a filter is active and resets all of them', async () => {
      await create(['Asset.View']);
      expect(el().querySelector('[data-clear-filters]')).toBeNull();
      expect(toggle().querySelector('[data-filter-count]')).toBeNull();

      await setInputs({ name: 'a', status: 'all' });
      expect(toggle().querySelector('[data-filter-count]')?.textContent).toBe('(2)');
      el().querySelector<HTMLButtonElement>('[data-clear-filters]')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: {
          q: null,
          status: null,
          matterId: null,
          inactiveLinked: null,
          role: null,
          typeId: null,
          name: null,
          matter: null,
          extref: null,
          page: null,
        },
        queryParamsHandling: 'merge',
      });
    });

    it('hides New asset without Asset.Create', async () => {
      await create(['Asset.View']);
      expect(buttonByLabel(el(), 'New asset')).toBeUndefined();
    });

    it('keeps the headers and the filter row when nothing matches and offers Clear filters', async () => {
      await create(['Asset.View'], { name: 'zzz' });
      assets.listAssets.mockReturnValue(ok(pageOfAssets()));
      await setInputs({ name: 'zzzz' });

      expect(el().querySelector('thead tr:first-child th')).not.toBeNull();
      expect(filterRow()).not.toBeNull();
      const empty = el().querySelector('[data-empty=filtered]')!;
      expect(empty.textContent).toContain('No assets match these filters');
      empty.querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ name: null, status: null, page: null }),
        }),
      );
      expect(el().querySelector('mf-pager')).toBeNull();
    });

    it('says how many inactive assets the default Disposition hides when nothing active matches, and Show all reaches them', async () => {
      await create(['Asset.View'], { name: 'zzz' });
      assets.listAssets.mockImplementation((_m: unknown, _t: unknown, isActive?: boolean) =>
        ok(
          isActive === false
            ? pageOfAssets(
                anAssetListItem({ assetId: 10, isActive: false, dispositionCode: 'INACTIVE' }),
              )
            : pageOfAssets(),
        ),
      );
      await setInputs({ name: 'zzzz' });

      const empty = el().querySelector('[data-empty=filtered]')!;
      expect(empty.querySelector('[data-hidden-hint]')?.textContent).toContain('1 inactive hidden');
      empty.querySelector<HTMLButtonElement>('[data-show-all]')!.click();
      expect(navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({
          queryParams: expect.objectContaining({ status: 'all', page: null }),
        }),
      );
    });

    it('says so when there are no assets at all and keeps the headers on an error', async () => {
      await create(['Asset.View']);
      assets.listAssets.mockReturnValue(ok(pageOfAssets()));
      await setInputs({ sort: 'assetType' });
      expect(el().querySelector('[data-empty=none]')?.textContent).toContain('No assets yet.');

      assets.listAssets.mockReturnValue(
        apiError(500, { title: 'x', status: 500, code: 'INTERNAL_ERROR' }),
      );
      await setInputs({ sort: 'displayName' });
      expect(el().querySelector('[role=alert]')?.textContent).toContain("Couldn't load assets");
      expect(el().querySelector('[data-error] button')?.textContent).toContain('Retry');
      expect(el().querySelector('thead th')).not.toBeNull();
    });

    it('has no details panel: the name is a real link to the record page (BUG-3, #510)', async () => {
      await create(['Asset.View']);
      expect(el().querySelector('[data-asset-panel], #asset-panel, mf-asset-details')).toBeNull();
      expect(rowOf(9)!.hasAttribute('aria-current')).toBe(false);

      const name = rowOf(9)!.querySelector<HTMLAnchorElement>('a.mf-name[data-asset-name="9"]')!;
      expect(name.tagName).toBe('A');
      expect(name.getAttribute('href')).toBe('/assets/9');
      expect(name.textContent?.trim()).toBe('Contract bundle');
      expect(rowOf(9)!.querySelector('button:not(.mf-copy)')).toBeNull(); // the name was a button before
      expect(assets.getAsset).not.toHaveBeenCalled(); // the list loads no details
    });

    it('does nothing on Escape: there is no panel to close any more', async () => {
      await create(['Asset.View']);
      el().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(navigate).not.toHaveBeenCalled();
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

    it("Cancel from a matter goes back to that matter's Assets tab", async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);
      el()
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((b) => b.textContent?.trim() === 'Cancel' && b.click());
      expect(navigateByUrl).toHaveBeenCalledWith('/matters/7?tab=assets');
    });

    it('creates in the launching matter with the matter locked and the type fields from the published form', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);

      expect(matters.getMatter).toHaveBeenCalledWith(7);
      expect(el().querySelector('[data-chosen]')?.textContent).toContain(
        '00343-00012 Merger Review',
      );
      expect(el().querySelector('.mf-picker__change')).toBeNull();
      // Only active types are offered.
      expect(types.listAssetTypes).toHaveBeenCalledWith(
        undefined,
        undefined,
        true,
        1,
        100,
        undefined,
      );
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
      await create({}, ['Asset.View', 'Asset.Create', 'Task.View']);
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
        'Workspace ID: Enter workspace ID.',
      );
      expect(assets.createAsset).not.toHaveBeenCalled();
    });

    it('shows a type without published fields as having none and sends no form values', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);
      await chooseType('5');
      expect(el().querySelector('[data-no-fields]')).not.toBeNull();

      type('#asset-name', 'Relativity');
      await submit();

      expect(assets.createAsset).toHaveBeenCalledWith(
        expect.objectContaining({ assetTypeId: 5, formValues: undefined }),
      );
    });

    it('shows the server field errors of the type-specific fields inline', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);
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
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);
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
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit', 'Task.View']);

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

    it('New asset: the record header, the Asset and type-fields sections, the real matter format and the way back (A10)', async () => {
      await create({}, ['Asset.View', 'Asset.Create', 'Task.View']);

      expect(el().querySelector('h1')?.textContent).toContain('New asset');
      expect(el().querySelector('[data-record-header] [data-back-link]')?.textContent).toContain(
        'Assets',
      );
      expect(el().querySelector('[data-record-header] mf-active-badge')).toBeNull(); // nothing exists yet
      expect(el().querySelector('input#asset-matter')?.getAttribute('placeholder')).toBe(
        'e.g. 90001-80011 or matter name',
      );
      expect(el().querySelector('[data-section="asset"] h2')?.textContent).toBe('Asset');
      // The second section is there from the start (no layout jump), with a sentence until a type is chosen.
      expect(el().querySelector('[data-section="fields"] h2')?.textContent).toContain(
        'Type fields',
      );
      expect(el().querySelector('[data-fields-pending]')?.textContent).toContain(
        'Choose an asset type',
      );

      await chooseType('4');
      const fields = aFormVersion().fields.length;
      expect(
        el().querySelector('[data-fields-title]')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe(`Document Set fields (${fields})`);
      expect(el().querySelector('[data-fields-pending]')).toBeNull();
    });

    it('moves focus to the first field with an error when blocking validation stops the save', async () => {
      await create({}, ['Asset.View', 'Asset.Create', 'Task.View']);
      await submit();
      await settle(fixture);

      expect(el().querySelector('[data-summary]')?.textContent).toContain('Select a matter.');
      const first = el().querySelector<HTMLElement>('form [aria-invalid="true"]')!;
      expect(first).not.toBeNull();
      expect(document.activeElement).toBe(first);
    });

    it('requests no schema that is certain to fail without Task.View: one muted sentence, on New and on Edit', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create']);
      await chooseType('4');
      expect(forms.getFormVersionSchema).not.toHaveBeenCalled();
      expect(el().querySelector('[data-fields-unavailable]')?.textContent).toContain(
        'Type fields are not available with your access.',
      );

      TestBed.resetTestingModule();
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit']);
      expect(forms.getFormVersionSchema).not.toHaveBeenCalled();
      expect(el().querySelector('[data-fields-unavailable]')).not.toBeNull();
      type('#asset-name', 'Renamed bundle');
      await settle(fixture);
      await submit();
      // The save sends no type values it never showed.
      expect(assets.updateAsset).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ displayName: 'Renamed bundle', formValues: undefined }),
      );
    });

    it('Edit asset: the header shows name, status, type and matter, locks matter and type with the reason, and saves only when something changed', async () => {
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit', 'Task.View', 'Matter.View']);

      expect(el().querySelector('h1')?.textContent).toContain('Contract bundle');
      expect(el().querySelector('[data-record-header] mf-active-badge')?.textContent).toContain(
        'Active',
      );
      expect(el().querySelector('[data-type-badge]')?.textContent).toContain('Document Set');
      expect(el().querySelector('[data-form-context] a.mf-ref')?.getAttribute('href')).toBe(
        '/matters/7',
      );
      const crumbs = el().querySelectorAll('[data-record-header] ol a');
      expect(Array.from(crumbs).map((a) => a.getAttribute('href'))).toEqual(
        expect.arrayContaining(['/assets', '/assets/9']),
      );
      expect(el().querySelector('[data-type-reason]')?.textContent).toContain(
        "can't be changed after the asset is created",
      );
      expect(el().textContent).toContain("The matter can't be changed after the asset is created.");
      expect(buttonByLabel(el(), 'Save changes')!.disabled).toBe(true);

      type('#asset-name', 'Contract bundle v2');
      await settle(fixture);
      expect(buttonByLabel(el(), 'Save changes')!.disabled).toBe(false);
      buttonByLabel(el(), 'Cancel')!.click();
      expect(navigateByUrl).toHaveBeenCalledWith('/assets/9');
    });

    it('Edit asset without Matter.View shows the matter as plain text', async () => {
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit', 'Task.View']);
      expect(el().querySelector('[data-form-context] .mf-ref')?.textContent).toBe('00343-00012');
      expect(el().querySelector('[data-form-context] a')).toBeNull();
    });

    it('shows the 409 sentence of the server for a lost race on create, keeps the typed values and offers no reload (BUG-6)', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);
      assets.createAsset.mockReturnValue(
        apiError(409, {
          title: 'Conflict',
          status: 409,
          code: 'CONCURRENCY_CONFLICT',
          detail: 'Another change was saved at the same time. Try again.',
        }),
      );
      await chooseType('5');
      type('#asset-name', 'Typed name');
      type('#asset-reference', 'REF-1');
      await settle(fixture);
      await submit();

      const conflict = el().querySelector('[data-conflict]') as HTMLElement;
      expect(conflict.textContent).toContain(
        'Another change was saved at the same time. Try again.',
      );
      expect(buttonByLabel(conflict, 'Reload latest')).toBeUndefined();
      expect(el().querySelector<HTMLInputElement>('#asset-name')!.value).toBe('Typed name');
      expect(el().querySelector<HTMLInputElement>('#asset-reference')!.value).toBe('REF-1');
      expect(navigate).not.toHaveBeenCalledWith(['/assets', expect.anything()]);
    });

    it('warns that an inactive asset cannot be edited and offers a reload on conflict', async () => {
      await create({ assetId: '9' }, ['Asset.View', 'Asset.Edit', 'Task.View']);
      assets.updateAsset.mockReturnValue(
        apiError(409, { title: 'x', status: 409, code: 'CONCURRENCY_CONFLICT' }),
      );
      type('#asset-name', 'Renamed bundle');
      await settle(fixture);
      await submit();
      expect(el().querySelector('[data-conflict]')?.textContent).toContain(
        'This asset was changed by someone else.',
      );
      expect(
        buttonByLabel(el().querySelector('[data-conflict]') as HTMLElement, 'Reload latest'),
      ).toBeDefined();

      TestBed.resetTestingModule();
      await configure(['Asset.View', 'Asset.Edit', 'Task.View']);
      assets.getAsset.mockReturnValue(ok(anAsset({ isActive: false })));
      fixture = TestBed.createComponent(AssetFormPage);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
      expect(el().querySelector('[data-inactive-banner]')?.textContent).toContain(
        "can't be edited",
      );
      expect(el().querySelector('[data-record-link]')?.getAttribute('href')).toBe('/assets/9');
      expect(el().querySelector('form')).toBeNull(); // read-only: no fields to change
      expect(buttonByLabel(el(), 'Save changes')).toBeUndefined();
    });

    it('reports unsaved changes and none after a save', async () => {
      await create({ matterId: '7' }, ['Asset.View', 'Asset.Create', 'Task.View']);
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      type('#asset-name', 'Bundle');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });

    it('has a schema-less edit when the type has no published form', async () => {
      await configure(['Asset.View', 'Asset.Edit', 'Task.View']);
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
});
