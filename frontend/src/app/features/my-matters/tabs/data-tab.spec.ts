import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import {
  AssetReportsClient,
  AssetTypesClient,
  MyMattersClient,
} from '../../../api/generated/api-client';
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
        sizeFieldKey: 'size_gb',
        sizeUnit: 'GB',
        query: 'matterManagedByMe=true&assetTypeId=3',
      },
    ],
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
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  }

  async function open(configure?: () => void, url = ''): Promise<void> {
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
          provide: AssetReportsClient,
          useValue: {
            getAssetReportFields: vi.fn().mockReturnValue(
              of({
                numberFields: [
                  { key: 'size_gb', label: 'Size (GB)', isDefaultSize: true, unit: 'GB' },
                  { key: 'docs', label: 'Documents', isDefaultSize: false },
                ],
              }),
            ),
          },
        },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    if (url) window.history.replaceState({}, '', url);
    fixture = TestBed.createComponent(Host);
    await settle();
  }

  afterEach(() => window.history.replaceState({}, '', '/'));

  it('states the warnings with their links, then the totals, then a real table of the matters', async () => {
    await open();
    expect(api['getMyMattersData']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const warnings = el().querySelectorAll('[data-warning]');
    expect(warnings).toHaveLength(2);
    expect(q('[data-warning=inactive-linked]').textContent).toContain(
      '2 assets are not active but still linked to open tasks',
    );
    expect(q('[data-warning=awaiting-disposition]').textContent).toContain(
      '1 asset waits for disposition (oldest 41 days)',
    );
    const show = q<HTMLAnchorElement>('[data-warning=inactive-linked] a');
    expect(show.getAttribute('href')).toContain('/assets?');
    expect(show.getAttribute('href')).toContain('inactiveLinked=true');
    expect(show.getAttribute('href')).toContain('status=all');
    expect(show.getAttribute('href')).toContain('scope=mine');

    expect(q('[data-total-size]').textContent!.trim()).toBe('100 GB');
    const table = q('[data-matters-table]');
    expect(table.querySelector('caption')!.textContent).toContain('Assets by matter');
    expect(
      Array.from(table.querySelectorAll('thead th')).every(
        (h) => h.getAttribute('scope') === 'col',
      ),
    ).toBe(true);
    const rows = table.querySelectorAll('[data-matter-row]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('th')!.getAttribute('scope')).toBe('row');
    expect(rows[1].textContent).toContain('(closed)');
    expect(rows[1].textContent).toContain('No size');
    const pending = rows[0].querySelector<HTMLAnchorElement>('td:nth-of-type(5) a')!;
    expect(pending.getAttribute('aria-label')).toBe(
      '2 pending disposition assets on 90001-80001, open in the Assets list',
    );
    expect(pending.getAttribute('href')).toContain('matterId=5');
    expect(pending.getAttribute('href')).toContain('status=pending');
    // A zero is plain text, not a link to an empty list.
    expect(rows[1].querySelectorAll('td:nth-of-type(5) a')).toHaveLength(0);
    expect(q('[data-matters-total]').textContent).toContain('All my matters');
    expect(q('[data-types-table] [data-type-row]').textContent).toContain('size_gb (GB)');
  });

  it('draws the volume table on request, says what the numbers are and loads the chart lazily by default', async () => {
    await open();
    expect(api['getMyMattersDataVolume']).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      12,
    );
    expect(q('[data-show-chart]').getAttribute('aria-pressed')).toBe('true');
    expect(el().querySelector('mf-column-chart')).not.toBeNull();
    expect(q('[data-volume-limit]').textContent).toContain('Derived from the month');
    q<HTMLButtonElement>('[data-show-table]').click();
    await settle();
    const table = q('[data-volume-table]');
    expect(
      Array.from(table.querySelectorAll('tbody tr')).map((r) =>
        Array.from(r.children).map((c) => c.textContent!.trim()),
      ),
    ).toEqual([
      ['Sep 2026', '3', '100', '100', '0'],
      ['Oct 2026', '3', '160', '60', '0'],
    ]);
    expect(el().querySelector('mf-column-chart')).toBeNull();
  });

  it('offers a unit when GB and Items meet, and a matter to narrow the line to', async () => {
    await open(() => {
      api['getMyMattersDataVolume'].mockReturnValue(
        of(
          volume({
            units: ['GB', 'Items'],
            unitsWarning: 'This result mixes units: GB and Items. Each unit is charted on its own.',
            points: [
              {
                month: '2026-10',
                assets: 2,
                held: [unit('GB', 5), unit('Items', 900)],
                added: [unit('GB', 5), unit('Items', 900)],
                removed: [unit('GB', 0, 0), unit('Items', 0, 0)],
              },
            ],
          }),
        ),
      );
    });
    expect(q('[data-volume-units-warning]').textContent).toContain('mixes units');
    const select = q<HTMLSelectElement>('[data-volume-unit]');
    select.value = 'Items';
    select.dispatchEvent(new Event('change'));
    q<HTMLButtonElement>('[data-show-table]').click();
    await settle();
    expect(q('[data-volume-table] tbody tr').textContent).toContain('900');

    const matter = q<HTMLSelectElement>('[data-volume-matter]');
    matter.value = '5';
    matter.dispatchEvent(new Event('change'));
    await settle();
    const last = api['getMyMattersDataVolume'].mock.calls.at(-1)!;
    expect(last[5]).toBe(5);
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

  it('shows no warning rows when there is nothing to warn about, and says it', async () => {
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
    expect(q('[data-no-warnings]').textContent).toContain('No warnings');
  });

  it('reports a failure of the data inside its panel with Retry, and the volume stays on its own', async () => {
    await open(() => {
      api['getMyMattersData'].mockReturnValue(throwError(() => new Error('boom')));
    });
    expect(q('[data-panel=data] [data-panel-error]').textContent).toContain("Couldn't load data");
    expect(
      q('[data-panel=data-volume] [data-volume-table], [data-panel=data-volume] mf-column-chart'),
    ).not.toBeNull();
    api['getMyMattersData'].mockReturnValue(of(data()));
    q<HTMLButtonElement>('[data-panel=data] [data-panel-retry]').click();
    await settle();
    expect(el().querySelector('[data-matters-table]')).not.toBeNull();
  });

  it('measures another number field of one asset type only once its unit is chosen', async () => {
    await open();
    const type = q<HTMLSelectElement>('[data-data-type]');
    type.value = '3';
    type.dispatchEvent(new Event('change'));
    await settle();
    // Asset type chosen, default field: the API gets only the type.
    expect(api['getMyMattersData'].mock.calls.at(-1)).toEqual([
      undefined,
      undefined,
      3,
      undefined,
      undefined,
    ]);
    const field = q<HTMLSelectElement>('[data-data-field]');
    expect(Array.from(field.options).map((o) => o.value)).toEqual(['', 'size_gb', 'docs']); // number fields only
    field.value = 'docs';
    field.dispatchEvent(new Event('change'));
    await settle();
    expect(q('[data-unit-needed]')).not.toBeNull();
    expect(api['getMyMattersData'].mock.calls.at(-1)).toEqual([
      undefined,
      undefined,
      3,
      undefined,
      undefined,
    ]);
    const unitSelect = q<HTMLSelectElement>('[data-data-unit]');
    unitSelect.value = 'Items';
    unitSelect.dispatchEvent(new Event('change'));
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)).toEqual([
      undefined,
      undefined,
      3,
      'docs',
      'Items',
    ]);
  });

  it('keeps the scope of the page in every link, so a matter of someone else opens in All', async () => {
    await open();
    fixture.componentInstance.filters.set({ ...DEFAULT_FILTERS, scope: 'all' });
    await settle();
    expect(api['getMyMattersData'].mock.calls.at(-1)![0]).toBe('all');
    const href = q<HTMLAnchorElement>('[data-matter-row] td:nth-of-type(1) a').getAttribute(
      'href',
    )!;
    expect(href).toContain('scope=all');
    expect(q('[data-matters-total]').textContent).toContain('All matters');
  });
});
