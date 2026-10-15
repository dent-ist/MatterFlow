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
import { BehaviorSubject, Observable } from 'rxjs';
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
import { ASSETS_ROUTES } from '../assets.routes';
import { AssetDetails } from './asset-details';
import { AssetFormPage, externalReferenceError } from './asset-form-page';
import { AssetsListPage, parseSelected } from './assets-list-page';

type Mock = ReturnType<typeof vi.fn>;

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

describe('Assets routes', () => {
  it('redirects the old asset page /assets/:id to the list with that asset selected', async () => {
    const redirect = ASSETS_ROUTES[0].children!.find((r) => r.path === ':assetId')!;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'assets',
            children: [{ path: '', component: Blank }, redirect],
          },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/assets/42');
    expect(TestBed.inject(Router).url).toBe('/assets?selected=42');
  });

  it('keeps the create and edit addresses', () => {
    const paths = ASSETS_ROUTES[0].children!.map((r) => r.path);
    expect(paths).toEqual(['', 'new', ':assetId/edit', ':assetId']);
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

    beforeEach(() => localStorage.clear());

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

    it('lists assets with type, matter reference, external reference and status; the name is a button, not a link', async () => {
      await create(['Asset.View', 'Asset.Create']);
      const rows = el().querySelectorAll('tbody tr');

      expect(rows).toHaveLength(2);
      expect(rows[0].querySelector('button.as-name')?.textContent?.trim()).toBe('Contract bundle');
      expect(rows[0].querySelector('td:first-child a')).toBeNull();
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
      ).toEqual(['Name', 'Type', 'Matter', 'External reference', 'Status']);
      expect(assets.listAssets).toHaveBeenCalledWith(
        undefined,
        undefined,
        true,
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

    it('has a Filters button above the grid that shows and hides the filter row under the headers', async () => {
      await create(['Asset.View']);
      const bar = el().querySelector('[data-grid-toolbar]')!;
      const table = el().querySelector('table')!;
      expect(bar.contains(toggle())).toBe(true);
      expect(bar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(toggle().textContent).toContain('Filters');
      expect(toggle().querySelector('.pi-filter')).not.toBeNull();
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(filterRow()).toBeNull();

      toggle().click();
      await settle(fixture);
      expect(toggle().getAttribute('aria-pressed')).toBe('true');
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      const row = filterRow()!;
      // The second row of the table head, one cell under each column header.
      expect(row.parentElement?.tagName).toBe('THEAD');
      expect(row.previousElementSibling?.querySelector('th')).not.toBeNull();
      expect(row.querySelectorAll('td')).toHaveLength(
        el().querySelectorAll('thead tr:first-child th').length,
      );
      for (const name of ['Name', 'Type', 'Matter', 'External reference', 'Status'])
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
        Array.from(control<HTMLSelectElement>('Status').options).map((o) => o.textContent!.trim()),
      ).toEqual(['Active', 'Inactive', 'All']);
      expect(control<HTMLSelectElement>('Status').value).toBe('active');

      toggle().click();
      await settle(fixture);
      expect(filterRow()).toBeNull();
      expect(toggle().getAttribute('aria-pressed')).toBe('false');
    });

    it('remembers whether the filter row is open, per user, and copes with blocked storage', async () => {
      await create(['Asset.View']);
      toggle().click();
      await settle(fixture);
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('mf.assets.filters.open'));
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(/\.\d+$/); // per user
      expect(localStorage.getItem(keys[0])).toBe('1');

      fixture.destroy();
      fixture = TestBed.createComponent(AssetsListPage);
      await settle(fixture);
      expect(filterRow()).not.toBeNull();
      toggle().click();
      await settle(fixture);
      expect(localStorage.getItem(keys[0])).toBe('0');

      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      fixture.destroy();
      fixture = TestBed.createComponent(AssetsListPage);
      await settle(fixture);
      expect(filterRow()).toBeNull();
      toggle().click();
      await settle(fixture);
      expect(filterRow()).not.toBeNull(); // still works for this visit
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
      expect(control<HTMLSelectElement>('Status').value).toBe('inactive');
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
      toggle().click();
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

      const status = control<HTMLSelectElement>('Status');
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

    describe('selection and the details panel', () => {
      it('parses the selected id', () => {
        expect(parseSelected('9')).toBe(9);
        expect(parseSelected('0')).toBeNull();
        expect(parseSelected('x')).toBeNull();
        expect(parseSelected('1.5')).toBeNull();
        expect(parseSelected(undefined)).toBeNull();
      });

      it('shows no panel without a selection, and does not leave the list when a name is clicked', async () => {
        await create(['Asset.View']);
        expect(el().querySelector('[data-asset-panel]')).toBeNull();

        rowOf(9)!.querySelector<HTMLButtonElement>('button.as-name')!.click();
        expect(navigate).toHaveBeenLastCalledWith([], {
          queryParams: { selected: 9 },
          queryParamsHandling: 'merge',
        });
        expect(navigateByUrl).not.toHaveBeenCalled();
        expect(assets.getAsset).not.toHaveBeenCalled(); // details load only once something is selected
      });

      it('highlights the selected row (aria-current, not colour alone) and shows its details below the grid', async () => {
        await create(['Asset.View', 'Asset.Edit'], { selected: '9' });

        expect(rowOf(9)!.getAttribute('aria-current')).toBe('true');
        expect(rowOf(9)!.hasAttribute('data-selected')).toBe(true);
        expect(rowOf(10)!.getAttribute('aria-current')).toBeNull();
        const name = rowOf(9)!.querySelector('button.as-name')!;
        expect(name.getAttribute('aria-controls')).toBe('asset-panel');

        const panel = el().querySelector('#asset-panel')!;
        expect(panel.getAttribute('aria-label')).toBe('Asset details');
        expect(assets.getAsset).toHaveBeenCalledWith(9);
        expect(panel.querySelector('h2')?.textContent).toContain('Contract bundle');
        expect(panel.querySelector('[data-type-fields]')?.textContent).toContain('WS-8841');
        // Below the grid: after the table and its pager in reading order.
        expect(
          el().querySelector('table')!.compareDocumentPosition(panel) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(buttonByLabel(panel as HTMLElement, 'Edit')).toBeDefined();
      });

      it('swaps the panel to another asset without recreating it', async () => {
        await create(['Asset.View'], { selected: '9' });
        const panel = el().querySelector('mf-asset-details');
        assets.getAsset.mockReturnValue(
          ok(anAsset({ assetId: 10, displayName: 'Old room', isActive: false })),
        );
        await setInputs({ selected: '10' });

        expect(el().querySelector('mf-asset-details')).toBe(panel);
        expect(assets.getAsset).toHaveBeenLastCalledWith(10);
        expect(el().querySelector('#asset-panel h2')?.textContent).toContain('Old room');
        expect(rowOf(10)!.getAttribute('aria-current')).toBe('true');
        expect(rowOf(9)!.getAttribute('aria-current')).toBeNull();
      });

      it('closes the panel with the Close button, and with Escape, putting focus back on the row', async () => {
        await create(['Asset.View'], { selected: '9' });
        const close = el().querySelector<HTMLButtonElement>('[data-close-details]')!;
        expect(close.getAttribute('aria-label')).toBe('Close details');
        close.click();
        await settle(fixture);
        expect(navigate).toHaveBeenLastCalledWith([], {
          queryParams: { selected: null },
          queryParamsHandling: 'merge',
        });
        expect(document.activeElement).toBe(rowOf(9)!.querySelector('button.as-name'));

        navigate.mockClear();
        (document.activeElement as HTMLElement).blur();
        el()
          .querySelector<HTMLElement>('#asset-panel h2')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle(fixture);
        expect(navigate).toHaveBeenCalledWith([], {
          queryParams: { selected: null },
          queryParamsHandling: 'merge',
        });
        expect(document.activeElement).toBe(rowOf(9)!.querySelector('button.as-name'));
      });

      it('leaves Escape alone without a selection, when already handled, and inside a dialog', async () => {
        await create(['Asset.View']);
        const escape = (target: Element, prevent = false) => {
          const e = new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          });
          if (prevent) e.preventDefault();
          target.dispatchEvent(e);
        };
        escape(el().querySelector('table')!);
        expect(navigate).not.toHaveBeenCalled();

        await setInputs({ selected: '9' });
        escape(el().querySelector('#asset-panel h2')!, true);
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        el().querySelector('#asset-panel')!.appendChild(dialog);
        escape(dialog);
        expect(navigate).not.toHaveBeenCalled();
      });

      it('moves focus to the panel heading when a row is chosen with the keyboard, but not with the mouse', async () => {
        await create(['Asset.View']);
        const name = rowOf(9)!.querySelector<HTMLButtonElement>('button.as-name')!;
        name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); // mouse
        await setInputs({ selected: '9' });
        expect(document.activeElement).not.toBe(el().querySelector('#asset-panel h2'));

        await setInputs({ selected: '10' });
        const other = rowOf(9)!.querySelector<HTMLButtonElement>('button.as-name')!;
        other.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); // Enter or Space
        await setInputs({ selected: '9' });
        await settle(fixture);
        expect(document.activeElement).toBe(el().querySelector('#asset-panel h2'));
      });

      it('narrows the list to the matter of a linked asset that is not on this page, once, all states', async () => {
        await configure(['Asset.View']);
        assets.getAsset.mockReturnValue(
          ok(anAsset({ assetId: 55, matterRef: '00343-00099', isActive: false })),
        );
        fixture = TestBed.createComponent(AssetsListPage);
        fixture.componentRef.setInput('selected', '55');
        await settle(fixture);

        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith([], {
          queryParams: {
            matter: '00343-00099',
            matterId: null,
            name: null,
            extref: null,
            typeId: null,
            status: 'all',
            page: null,
          },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        // Not again for the same asset.
        setQuery({ matter: '00343-00099' });
        await settle(fixture);
        expect(navigate).toHaveBeenCalledTimes(1);
      });

      it('does not touch the filters when the linked asset is on the page, or when the user picked it', async () => {
        await create(['Asset.View'], { selected: '9' });
        expect(navigate).not.toHaveBeenCalled();

        // The user picks a row, then filters it away: the panel stays, the filters stay as typed.
        rowOf(10)!.querySelector<HTMLButtonElement>('button.as-name')!.click();
        assets.getAsset.mockReturnValue(ok(anAsset({ assetId: 10, matterRef: '00343-00012' })));
        assets.listAssets.mockReturnValue(ok(pageOfAssets(anAssetListItem({ assetId: 11 }))));
        await setInputs({ selected: '10', name: 'other' });
        expect(navigate).toHaveBeenCalledTimes(1); // only the click
      });

      it('updates the row when the panel sets the asset inactive', async () => {
        await create(['Asset.View', 'Asset.Edit'], { selected: '9' });
        expect(rowOf(9)!.textContent).not.toContain('Inactive');
        buttonByLabel(el().querySelector('#asset-panel') as HTMLElement, 'Set inactive')!.click();
        await settle(fixture);
        (
          Array.from(document.body.querySelectorAll<HTMLButtonElement>('p-dialog button')).find(
            (b) => b.textContent!.trim() === 'Set inactive',
          ) as HTMLButtonElement
        ).click();
        await settle(fixture);
        expect(rowOf(9)!.textContent).toContain('Inactive');
      });
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
      expect(navigate).toHaveBeenCalledWith(['/assets'], { queryParams: { selected: 12 } });
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
        'Workspace ID: Enter workspace ID.',
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
      expect(navigate).toHaveBeenCalledWith(['/assets'], { queryParams: { selected: 9 } });
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
      expect(buttonByLabel(el(), 'Save changes')!.disabled).toBe(true);
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

  describe('details', () => {
    let fixture: ComponentFixture<AssetDetails>;
    const el = (): HTMLElement => fixture.nativeElement;
    const tab = (label: string): HTMLElement | undefined =>
      Array.from(el().querySelectorAll<HTMLElement>('[role=tab]')).find(
        (t) => t.textContent!.trim() === label,
      );

    async function create(permissions: Permission[], asset = anAsset()): Promise<void> {
      await configure(permissions);
      assets.getAsset.mockReturnValue(ok(asset));
      fixture = TestBed.createComponent(AssetDetails);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
    }

    it('shows the type badge, the matter link, the external reference link and the stored values with their form version', async () => {
      await create(['Asset.View', 'Asset.Edit']);

      expect(el().querySelector('h2')?.textContent).toContain('Contract bundle');
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

    it('shows a non-URL external reference as plain text, with a copy button', async () => {
      await create(['Asset.View'], anAsset({ externalReference: 'WS-8841' }));
      expect(el().querySelector('[data-external-reference] a')).toBeNull();
      expect(el().querySelector('[data-external-reference]')?.textContent).toContain('WS-8841');
      expect(el().querySelector('[data-external-reference] mf-copy-button')).not.toBeNull();
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
      expect(buttonByLabel(el(), 'Set active')).toBeDefined();
      expect(el().querySelector('[data-inactive-banner]')).not.toBeNull();
    });

    it('deactivates after confirmation with the row version (assets are never deleted)', async () => {
      await create(['Asset.View', 'Asset.Edit']);
      expect(buttonByLabel(el(), 'Delete')).toBeUndefined();
      const changed = vi.fn();
      fixture.componentInstance.changed.subscribe(changed);

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
      expect(changed).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });

    it('offers a retry when the asset cannot be loaded', async () => {
      await configure(['Asset.View']);
      assets.getAsset.mockReturnValue(
        apiError(404, { title: 'x', status: 404, code: 'NOT_FOUND' }),
      );
      fixture = TestBed.createComponent(AssetDetails);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
      expect(el().querySelector('[role=alert]')?.textContent).toContain("couldn't find that asset");

      assets.getAsset.mockReturnValue(ok(anAsset()));
      buttonByLabel(el(), 'Retry')!.click();
      await settle(fixture);
      expect(el().querySelector('[role=alert]')).toBeNull();
      expect(el().querySelector('h2')?.textContent).toContain('Contract bundle');
    });

    it('shows a loading state, then reloads for another asset and ignores a slow answer for the old one', async () => {
      await configure(['Asset.View']);
      let release!: (a: ReturnType<typeof anAsset>) => void;
      assets.getAsset.mockReturnValueOnce(
        new Observable((o) => {
          release = (a) => {
            o.next(a);
            o.complete();
          };
        }),
      );
      fixture = TestBed.createComponent(AssetDetails);
      fixture.componentRef.setInput('assetId', '9');
      await settle(fixture);
      expect(el().querySelector('[data-loading]')?.getAttribute('aria-busy')).toBe('true');

      assets.getAsset.mockReturnValue(ok(anAsset({ assetId: 10, displayName: 'Old room' })));
      fixture.componentRef.setInput('assetId', '10');
      await settle(fixture);
      expect(el().querySelector('h2')?.textContent).toContain('Old room');

      release(anAsset({ assetId: 9, displayName: 'Contract bundle' }));
      await settle(fixture);
      expect(el().querySelector('h2')?.textContent).toContain('Old room');
    });

    it('has a Close button only when asked to, and moves focus to the heading on request', async () => {
      await create(['Asset.View']);
      expect(el().querySelector('[data-close-details]')).toBeNull();

      fixture.componentRef.setInput('closable', true);
      const closed = vi.fn();
      fixture.componentInstance.closed.subscribe(closed);
      await settle(fixture);
      el().querySelector<HTMLButtonElement>('[data-close-details]')!.click();
      expect(closed).toHaveBeenCalled();

      fixture.componentInstance.requestFocus();
      await settle(fixture);
      const heading = el().querySelector('h2')!;
      expect(heading.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(heading);
    });
  });
});
