import { TestBed } from '@angular/core/testing';
import { AssetTypesClient, ClientsClient, MattersClient } from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { NO_FILTERS, SearchFilterValues } from './search-filter-defs';
import { SearchFilters } from './search-filters';

const ALL: Permission[] = ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'];

describe('mf-search-filters (#474, #475, #476)', () => {
  const clients = {
    listClients: vi.fn(),
    getClient: vi
      .fn()
      .mockReturnValue(
        ok({ clientId: 3, clientNumber: '00343', name: 'Acme Corp', isActive: true }),
      ),
  };
  const matters = {
    listMatters: vi.fn(),
    getMatter: vi
      .fn()
      .mockReturnValue(
        ok({ matterId: 4, matterRef: '00343-00012', name: 'Merger', isActive: true }),
      ),
  };
  const assetTypes = {
    listAssetTypes: vi
      .fn()
      .mockReturnValue(ok({ items: [{ assetTypeId: 7, name: 'Production' }] })),
  };

  async function create(
    type: string,
    values: SearchFilterValues = NO_FILTERS,
    open = true,
    permissions: Permission[] = ALL,
  ) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ClientsClient, useValue: clients },
        { provide: MattersClient, useValue: matters },
        { provide: AssetTypesClient, useValue: assetTypes },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(SearchFilters);
    fixture.componentRef.setInput('type', type);
    fixture.componentRef.setInput('values', values);
    fixture.componentRef.setInput('open', open);
    const changes: SearchFilterValues[] = [];
    fixture.componentInstance.valuesChange.subscribe((v) => changes.push(v));
    let cleared = 0;
    fixture.componentInstance.cleared.subscribe(() => cleared++);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement, changes, cleared: () => cleared };
  }

  const labels = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-filters-panel] label, [data-filters-panel] legend')).map(
      (l) => l.textContent!.replace(/\s+/g, ' ').replace('(required)', '').trim(),
    );

  it('offers the controls of each type and nothing else', async () => {
    expect(labels((await create('client')).el)).toEqual(['Status']);
    expect(labels((await create('matter')).el)).toEqual(['Client', 'Status', 'Sensitive matter']);
    expect(labels((await create('project')).el)).toEqual(['Matter', 'Status']);
    expect(labels((await create('task')).el)).toEqual([
      'Client',
      'Matter',
      'Task status',
      'New',
      'In Progress',
      'On Hold',
      'Completed',
      'Cancelled',
      'Requestor',
    ]);
    expect(labels((await create('asset')).el)).toEqual(['Matter', 'Asset type', 'Status']);
  });

  it('offers no record picker to a person who may not view those records (Task.View only)', async () => {
    const { el } = await create('task', NO_FILTERS, true, ['Task.View']);
    expect(labels(el)).toEqual([
      'Task status',
      'New',
      'In Progress',
      'On Hold',
      'Completed',
      'Cancelled',
      'Requestor',
    ]);
  });

  it('shows no panel while closed, but the chips and Clear filters stay', async () => {
    const { el } = await create('matter', { ...NO_FILTERS, active: 'false' }, false);
    expect(el.querySelector('[data-filters-panel]')).toBeNull();
    expect(el.querySelector('[data-filter-chip]')!.textContent).toContain('Status: Inactive');
    expect(el.querySelector('[data-clear-filters]')).not.toBeNull();
  });

  it('applies a select change at once, with Any as the default status (not Active only)', async () => {
    const { el, changes } = await create('matter');
    const status = el.querySelector<HTMLSelectElement>('#sf-active')!;
    expect(status.value).toBe('any');
    expect(Array.from(status.options).map((o) => o.text.trim())).toEqual([
      'Any',
      'Active',
      'Inactive',
    ]);
    status.value = 'false';
    status.dispatchEvent(new Event('change'));
    expect(changes.at(-1)).toEqual({ ...NO_FILTERS, active: 'false' });
  });

  it('toggles task statuses in a fixed order and types the requestor after a pause, only from two characters', async () => {
    const { el, changes, fixture } = await create('task', { ...NO_FILTERS, status: ['ON_HOLD'] });
    vi.useFakeTimers();
    try {
      const box = (code: string) =>
        el.querySelector<HTMLInputElement>(`input[type=checkbox][value=${code}]`)!;
      expect(box('ON_HOLD').checked).toBe(true);
      box('NEW').checked = true;
      box('NEW').dispatchEvent(new Event('change'));
      expect(changes.at(-1)!.status).toEqual(['NEW', 'ON_HOLD']);

      const requestor = el.querySelector<HTMLInputElement>('#sf-requestor')!;
      requestor.value = 'p';
      requestor.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(500);
      expect(changes.filter((c) => c.requestor !== '')).toHaveLength(0);
      requestor.value = 'pat';
      requestor.dispatchEvent(new Event('input'));
      expect(changes.filter((c) => c.requestor !== '')).toHaveLength(0);
      vi.advanceTimersByTime(500);
      expect(changes.at(-1)!.requestor).toBe('pat');
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes one filter with its chip (a button with a name) and clears all with Clear filters', async () => {
    const { el, changes, cleared } = await create('task', {
      ...NO_FILTERS,
      client: 3,
      status: ['NEW'],
    });
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-filter-chip]'));
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Remove filter Client: 00343 Acme Corp',
      'Remove filter Task status: New',
    ]);
    chips[1].click();
    expect(changes.at(-1)).toEqual({ ...NO_FILTERS, client: 3 });
    el.querySelector<HTMLElement>('[data-clear-filters]')!.click();
    expect(cleared()).toBe(1);
  });

  it('loads the asset types for the Asset type filter and names the chip from them', async () => {
    const { el } = await create('asset', { ...NO_FILTERS, assetType: 7 });
    const select = el.querySelector<HTMLSelectElement>('#sf-asset-type')!;
    expect(Array.from(select.options).map((o) => o.text.trim())).toEqual([
      'Any type',
      'Production',
    ]);
    expect(select.value).toBe('7');
    expect(el.querySelector('[data-filter-chip]')!.textContent).toContain('Asset type: Production');
  });
});
