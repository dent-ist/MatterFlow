import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  AssetTypesClient,
  MattersClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
import { ViewStateService } from '../../../core/views/view-state.service';
import { FakeMeApi, profileOf, provideFakeMe } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { DEFAULT_FILTERS, MmFilters } from '../my-matters-filters';
import { DataTab } from './data-tab';

const unit = (u: string, value: number, assets = 1) => ({ unit: u, value, assets });
const counts = (c: Partial<Record<string, number>> = {}, size = [unit('GB', 100)]) => ({
  assets: 10,
  active: 6,
  inactive: 1,
  pendingDisposition: 2,
  disposed: 1,
  size,
  ...c,
});

function data(over: object = {}) {
  return {
    totals: counts({ assets: 12, active: 8, inactive: 1, pendingDisposition: 2, disposed: 1 }),
    matters: [
      {
        matterId: 5,
        matterRef: '90001-80001',
        matterName: 'Smith v Acme',
        clientName: 'Acme',
        matterIsActive: true,
        counts: counts(),
        query: 'matterId=5',
      },
      {
        matterId: 6,
        matterRef: '90002-80002',
        matterName: 'Internal',
        clientName: 'Acme',
        matterIsActive: false,
        counts: counts(
          { assets: 2, active: 2, inactive: 0, pendingDisposition: 0, disposed: 0 },
          [],
        ),
        query: 'matterId=6',
      },
    ],
    types: [
      {
        assetTypeId: 3,
        name: 'Relativity Workspace',
        counts: counts(),
        measures: [{ key: 'size_gb', label: 'Size (GB)', unit: 'GB' }],
        numberFields: [
          { key: 'size_gb', label: 'Size (GB)', isDefault: true, unit: 'GB' },
          { key: 'docs', label: 'Documents', isDefault: false },
        ],
        dispositionSizes: [{ disposition: 'ACTIVE', size: [unit('GB', 60)] }],
        query: 'matterManagedByMe=true&assetTypeId=3',
      },
      {
        assetTypeId: 4,
        name: 'Production',
        counts: counts(
          { assets: 2, active: 2, inactive: 0, pendingDisposition: 0, disposed: 0 },
          [],
        ),
        measures: [],
        numberFields: [],
        dispositionSizes: [],
        query: 'matterManagedByMe=true&assetTypeId=4',
      },
    ],
    selectedMatters: [],
    warnings: {
      inactiveLinked: { assets: 2, query: 'matterManagedByMe=true&inactiveLinked=true' },
      awaitingDisposition: {
        assets: 1,
        oldestDays: 41,
        query: 'matterManagedByMe=true&disposition=PENDING_DISPOSITION',
      },
    },
    scopeQuery: 'matterManagedByMe=true',
    ...over,
  };
}

function volume(over: object = {}) {
  const point = (month: string, held: number, added: number) => ({
    month,
    assets: 3,
    assetsAdded: 1,
    held: [unit('GB', held)],
    added: [unit('GB', added)],
    removed: [unit('GB', 0, 0)],
  });
  return {
    points: [point('2026-09', 100, 100), point('2026-10', 160, 60)],
    units: ['GB'],
    limitation: 'Derived from the month each asset was created, using its current size.',
    ...over,
  };
}

@Component({
  imports: [DataTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<mf-mm-data-tab
    [filters]="filters()"
    [canAll]="true"
    (showAll)="shown.set(shown() + 1)"
  />`,
})
class Host {
  filters = signal<MmFilters>(DEFAULT_FILTERS);
  shown = signal(0);
}

describe('DataTab', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let saved: [string, unknown][] = [];
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  /** Opens the panel of a picker the way a click on its summary does (the details element's toggle event). */
  async function openPicker(selector: string): Promise<HTMLElement> {
    const picker = q(selector);
    const details = picker.querySelector<HTMLDetailsElement>('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await settle();
    return picker;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  async function open(configure?: () => void, url = ''): Promise<void> {
    saved = [];
    api = {
      getMyMattersData: vi.fn().mockReturnValue(of(data())),
      getMyMattersDataVolume: vi.fn().mockReturnValue(of(volume())),
    };
    configure?.();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideFakeMe(
          new FakeMeApi(profileOf({ permissions: ['Matter.View', 'Task.View', 'Asset.View'] })),
        ),
        { provide: MyMattersClient, useValue: api },
        {
          provide: AssetTypesClient,
          useValue: {
            listAssetTypes: vi.fn().mockReturnValue(
              of({
                items: [
                  {
                    assetTypeId: 3,
                    name: 'Relativity Workspace',
                    sizeFieldKey: 'size_gb',
                    sizeUnit: 'GB',
                  },
                  { assetTypeId: 4, name: 'Production' },
                ],
              }),
            ),
          },
        },
        {
          provide: MattersClient,
          useValue: {
            listMatters: vi.fn().mockReturnValue(
              of({
                items: [
                  {
                    matterId: 5,
                    matterRef: '90001-80001',
                    name: 'Smith v Acme',
                    clientName: 'Acme',
                  },
                  { matterId: 6, matterRef: '90002-80002', name: 'Internal', clientName: 'Acme' },
                ],
              }),
            ),
          },
        },
        {
          provide: ViewStateService,
          useValue: {
            cached: () => null,
            load: () => Promise.resolve(null),
            save: (surface: string, state: unknown) => saved.push([surface, state]),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    await TestBed.inject(Router).navigateByUrl(url || '/');
    fixture = TestBed.createComponent(Host);
    await settle();
  }

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('shows the headline numbers as tiles, then one line for the warning, then a real grid of the asset types', async () => {
    await open();
    expect(api['getMyMattersData']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const names = Array.from(
      el().querySelectorAll('[data-tiles] button, [data-tiles] [role=group]'),
    ).map((t) => t.getAttribute('aria-label'));
    // The value comes first in every accessible name; the unit is said once.
    expect(names).toEqual([
      '12 total assets',
      '100 GB total size',
      '8 active',
      '1 inactive',
      '2 pending disposition, oldest 41 days',
      '1 disposed',
    ]);
    expect(el().querySelector('[data-tile=assets]')!.textContent).toContain('12');
    expect(el().querySelector('[data-tile=size]')!.textContent).toContain('GB');

    const warning = q('[data-warning=inactive-linked]');
    expect(warning.textContent).toContain('2 assets are not active but still linked to open tasks');
    const show = warning.querySelector<HTMLAnchorElement>('a')!;
    expect(show.getAttribute('href')).toContain('inactiveLinked=true');
    expect(show.getAttribute('href')).toContain('status=all');
    expect(show.getAttribute('href')).toContain('scope=mine');

    const table = q('[data-types-table]');
    expect(table.querySelector('caption')!.textContent).toContain('Assets by asset type');
    expect(
      Array.from(table.querySelectorAll('thead th')).every(
        (h) => h.getAttribute('scope') === 'col',
      ),
    ).toBe(true);
    expect(
      Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent!.trim()),
    ).toEqual([
      'Asset type',
      'Assets',
      'Size',
      'Active',
      'Inactive',
      'Pending disposition',
      'Disposed',
    ]);
    const rows = table.querySelectorAll('[data-type-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('th')!.getAttribute('scope')).toBe('row');
    expect(rows[0].textContent).toContain('100 GB');
    // No raw field name anywhere on the screen.
    expect(el().textContent).not.toContain('size_gb');
    const pending = rows[0].querySelector<HTMLAnchorElement>('td:nth-of-type(5) a')!;
    expect(pending.getAttribute('aria-label')).toBe(
      '2 pending disposition assets on Relativity Workspace, open in the Assets list',
    );
    expect(pending.getAttribute('href')).toContain('typeId=3');
    expect(pending.getAttribute('href')).toContain('status=pending');
    // A type without a size says so, and a zero is plain muted text, not a link to an empty list.
    expect(rows[1].textContent).toContain('No size');
    expect(rows[1].querySelectorAll('td:nth-of-type(5) a')).toHaveLength(0);
    // The old second table by matter is gone.
    expect(el().querySelector('[data-matters-table]')).toBeNull();
  });

  it('keeps units apart: GB and Items are two tiles and two lines in a cell, never one sum', async () => {
    await open(() => {
      const mixed = data();
      mixed.totals = counts({}, [unit('GB', 100), unit('Items', 900)]);
      mixed.types[0].counts = counts({}, [unit('GB', 100), unit('Items', 900)]);
      api['getMyMattersData'].mockReturnValue(of(mixed));
    });
    const names = Array.from(el().querySelectorAll('[data-tiles] [role=group]')).map((t) =>
      t.getAttribute('aria-label'),
    );
    expect(names).toContain('100 total size in gb');
    expect(names).toContain('900 total size in items');
    const cell = q('[data-types-table] [data-type-row] [data-size-cell]');
    expect(cell.querySelectorAll('.dt__unit')).toHaveLength(2);
    expect(cell.textContent).not.toContain('+');
  });

  it('filters the grid to a status when its tile is pressed, and says so', async () => {
    await open();
    const pending = q<HTMLButtonElement>('[data-tile=pending] button');
    expect(pending.getAttribute('aria-pressed')).toBe('false');
    pending.click();
    await settle();
    expect(TestBed.inject(Router).url).toContain('dstatus=pending');
    expect(q('[data-tile=pending] button').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-status-filter]').textContent).toContain(
      'Showing pending disposition assets only',
    );
    const headers = Array.from(el().querySelectorAll('[data-types-table] thead th')).map((h) =>
      h.textContent!.trim(),
    );
    expect(headers).toEqual(['Asset type', 'Pending disposition', 'Size']);
    const first = q('[data-type-row]');
    expect(first.querySelector('td a')!.textContent!.trim()).toBe('2');
    expect(first.querySelector('td a')!.getAttribute('href')).toContain('status=pending');
    // The size of that status comes from the split in the answer: nothing recorded for Pending here.
    expect(first.textContent).toContain('No size');
    q<HTMLButtonElement>('[data-clear-status]').click();
    await settle();
    expect(TestBed.inject(Router).url).not.toContain('dstatus');
    expect(el().querySelector('[data-status-filter]')).toBeNull();
  });

  it('mutes a zero tile and does not make it a button', async () => {
    await open(() => {
      const none = data();
      none.totals = counts({ disposed: 0, inactive: 0 });
      api['getMyMattersData'].mockReturnValue(of(none));
    });
    const inactive = q('[data-tile=inactive]');
    expect(inactive.querySelector('button')).toBeNull();
    expect(inactive.querySelector('.st--zero')).not.toBeNull();
    expect(q('[data-tile=active] button')).not.toBeNull();
  });

  it('switches the same data to a Bar and a Pie with the shared lazy charts, and back to the table', async () => {
    await open();
    expect(q('[data-show-table]').getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('mf-bar-chart')).toBeNull();
    q<HTMLButtonElement>('[data-show-bar]').click();
    await settle();
    expect(TestBed.inject(Router).url).toContain('dv=bar');
    expect(q('[data-show-bar]').getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('mf-bar-chart')).not.toBeNull();
    expect(el().querySelector('[data-types-table]')).toBeNull();
    // What the bars measure: the number of assets, or the size in a unit.
    expect(
      Array.from(el().querySelectorAll('[data-chart-measure] button')).map((b) =>
        b.textContent!.trim(),
      ),
    ).toEqual(['Assets', 'Size in GB']);
    q<HTMLButtonElement>('[data-measure=GB]').click();
    await settle();
    expect(q('[data-measure=GB]').getAttribute('aria-pressed')).toBe('true');
    q<HTMLButtonElement>('[data-show-pie]').click();
    await settle();
    expect(el().querySelector('mf-pie-chart')).not.toBeNull();
    // The choice stays when the selection changes, and is remembered with it.
    const period = q<HTMLSelectElement>('[data-data-period]');
    period.value = '12m';
    period.dispatchEvent(new Event('change'));
    await settle();
    expect(TestBed.inject(Router).url).toContain('dv=pie');
    expect(saved.at(-1)).toEqual([
      'my-matters.data',
      expect.objectContaining({ period: '12m', view: 'pie' }),
    ]);
    q<HTMLButtonElement>('[data-show-table]').click();
    await settle();
    expect(el().querySelector('[data-types-table]')).not.toBeNull();
  });

  it('draws the volume over time only when assets came in over at least three months, as a chart with a table behind it', async () => {
    // Two months of additions: not history, nothing is drawn.
    await open();
    expect(el().querySelector('[data-panel=data-volume]')).toBeNull();
    TestBed.resetTestingModule();

    const history = volume({
      points: [
        {
          month: '2026-08',
          assets: 1,
          assetsAdded: 1,
          held: [unit('GB', 40)],
          added: [unit('GB', 40)],
          removed: [unit('GB', 0, 0)],
        },
        {
          month: '2026-09',
          assets: 3,
          assetsAdded: 2,
          held: [unit('GB', 100)],
          added: [unit('GB', 60)],
          removed: [unit('GB', 0, 0)],
        },
        {
          month: '2026-10',
          assets: 4,
          assetsAdded: 1,
          held: [unit('GB', 160)],
          added: [unit('GB', 60)],
          removed: [unit('GB', 0, 0)],
        },
      ],
    });
    await open(() => {
      api['getMyMattersDataVolume'].mockReturnValue(of(history));
    });
    expect(api['getMyMattersDataVolume']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      24,
    );
    expect(q('[data-volume-as-chart]').getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('mf-column-chart')).not.toBeNull();
    q<HTMLButtonElement>('[data-volume-as-table]').click();
    await settle();
    expect(
      Array.from(q('[data-volume-table]').querySelectorAll('tbody tr')).map((r) =>
        Array.from(r.children).map((c) => c.textContent!.trim()),
      ),
    ).toEqual([
      ['Aug 2026', '1', '40', '40', '0'],
      ['Sep 2026', '3', '100', '60', '0'],
      ['Oct 2026', '4', '160', '60', '0'],
    ]);
    // The limit of the figures is in the one info point, not under the chart.
    expect(el().querySelector('[data-volume-limit]')).toBeNull();
    q<HTMLButtonElement>('[data-how]').click();
    await settle();
    expect(q('[data-info-volume]').textContent).toContain('Derived from the month');
  });

  it('says what the numbers are in one info point, with the size field of each type in plain words', async () => {
    await open();
    expect(el().querySelector('[data-info]')).toBeNull();
    const how = q<HTMLButtonElement>('[data-how]');
    expect(how.getAttribute('aria-expanded')).toBe('false');
    how.click();
    await settle();
    expect(q('[data-info-size]').textContent).toContain('Relativity Workspace (Size (GB) (GB))');
    expect(q('[data-info-size]').textContent).toContain('never added together');
    expect(el().querySelector('[data-info-links]')).toBeNull();
  });

  it('turns the numbers into plain text when several matters or a period make the Assets list unable to show exactly them', async () => {
    await open(undefined, '/?dm=5,6&dp=all');
    expect(el().querySelectorAll('[data-types-table] td a')).toHaveLength(0);
    expect(el().querySelector('[data-warning=inactive-linked] a')).toBeNull();
    q<HTMLButtonElement>('[data-how]').click();
    await settle();
    expect(q('[data-info-links]').textContent).toContain('do not open the Assets list');
  });

  it('says so when there are no assets and offers All matters to a person who may', async () => {
    await open(() => {
      api['getMyMattersData'].mockReturnValue(
        of(
          data({
            totals: counts(
              { assets: 0, active: 0, inactive: 0, pendingDisposition: 0, disposed: 0 },
              [],
            ),
            matters: [],
            types: [],
          }),
        ),
      );
    });
    expect(q('[data-empty]').textContent).toContain('no assets on the matters you manage');
    q<HTMLButtonElement>('[data-show-all]').click();
    await settle();
    expect(fixture.componentInstance.shown()).toBe(1);
  });

  it('shows no warning line when there is nothing to warn about', async () => {
    await open(() => {
      api['getMyMattersData'].mockReturnValue(
        of(
          data({
            warnings: {
              inactiveLinked: { assets: 0, query: 'x' },
              awaitingDisposition: { assets: 0, query: 'y' },
            },
          }),
        ),
      );
    });
    expect(el().querySelectorAll('[data-warning]')).toHaveLength(0);
    expect(el().textContent).not.toContain('No warnings');
  });

  it('reports a failure of the data inside its panel with Retry', async () => {
    await open(() => {
      api['getMyMattersData'].mockReturnValue(throwError(() => new Error('boom')));
    });
    expect(q('[data-panel=data] [data-panel-error]').textContent).toContain("Couldn't load data");
    api['getMyMattersData'].mockReturnValue(of(data()));
    q<HTMLButtonElement>('[data-panel=data] [data-panel-retry]').click();
    await settle();
    expect(el().querySelector('[data-types-table]')).not.toBeNull();
  });

  it('narrows the Data by matters, asset types, size fields and period, in the address and in what is remembered', async () => {
    await open();
    // Matters: a list asked for from the server, ticked in a popover.
    const matters = await openPicker('[data-pick-matters]');
    const box = matters.querySelector<HTMLInputElement>('[data-pick="5"]')!;
    box.click();
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)).toEqual([
      undefined,
      undefined,
      [5],
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(TestBed.inject(Router).url).toContain('dm=5');
    expect(matters.querySelector('summary')!.textContent).toContain('90001-80001 Smith v Acme');
    expect(saved.at(-1)).toEqual([
      'my-matters.data',
      expect.objectContaining({ matterIds: [5], period: 'all' }),
    ]);

    // Asset types.
    const types = await openPicker('[data-pick-types]');
    types.querySelector<HTMLInputElement>('[data-pick="3"]')!.click();
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)![3]).toEqual([3]);

    // Size fields: another number field of the type needs its unit before it is sent.
    const sizes = await openPicker('[data-pick-sizes]');
    sizes.querySelector<HTMLInputElement>('[data-size-field="3:docs"]')!.click();
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)![4]).toBeUndefined();
    const unitSelect = sizes.querySelector<HTMLSelectElement>('[data-size-unit="3:docs"]')!;
    unitSelect.value = 'Items';
    unitSelect.dispatchEvent(new Event('change'));
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)![4]).toEqual(['3:size_gb', '3:docs:Items']);
    expect(api['getMyMattersDataVolume'].mock.calls.at(-1)![4]).toEqual([
      '3:size_gb',
      '3:docs:Items',
    ]);

    // Period: a ready period becomes dates from today's calendar.
    const period = q<HTMLSelectElement>('[data-data-period]');
    period.value = 'year';
    period.dispatchEvent(new Event('change'));
    await settle();
    const call = api['getMyMattersData'].mock.calls.at(-1)!;
    expect(call[5]).toMatch(/^\d{4}-01-01$/);
    expect(call[6]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('opens on what the address says, and on what was remembered when it says nothing', async () => {
    await open(
      undefined,
      '/?dm=5,6&dt=3&ds=3:docs:Items&dp=custom&dfrom=2026-01-01&dto=2026-03-31',
    );
    expect(api['getMyMattersData'].mock.calls.at(-1)).toEqual([
      undefined,
      undefined,
      [5, 6],
      [3],
      ['3:docs:Items'],
      '2026-01-01',
      '2026-03-31',
    ]);
    expect(q('[data-pick-matters] summary').textContent).toContain('2 matters');
  });

  it('says so when a selection leaves no asset, and clears it', async () => {
    await open(() => {
      api['getMyMattersData'].mockReturnValue(
        of(
          data({
            totals: counts(
              { assets: 0, active: 0, inactive: 0, pendingDisposition: 0, disposed: 0 },
              [],
            ),
            matters: [],
            types: [],
          }),
        ),
      );
    }, '/?dm=5&dp=all');
    expect(q('[data-no-match]').textContent).toContain('No assets match this selection');
    q<HTMLButtonElement>('[data-clear-selection]').click();
    await settle();
    expect(TestBed.inject(Router).url).not.toContain('dm=');
  });

  it('keeps the scope of the page in every link, so a row of someone else matters opens in All', async () => {
    await open();
    fixture.componentInstance.filters.set({ ...DEFAULT_FILTERS, scope: 'all' });
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)![0]).toBe('all');
    const href = q<HTMLAnchorElement>('[data-type-row] td:nth-of-type(1) a').getAttribute('href')!;
    expect(href).toContain('scope=all');
  });
});
