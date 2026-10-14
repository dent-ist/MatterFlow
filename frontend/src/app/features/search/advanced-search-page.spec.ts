import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { throwError } from 'rxjs';
import {
  AssetTypesClient,
  ClientsClient,
  MattersClient,
  PrioritiesClient,
  SearchClient,
  StatusLabelsClient,
} from '../../api/generated/api-client';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { FakePrioritiesClient, FakeStatusLabelsClient } from '../../core/lookups/lookups-testing';
import {
  FakeMeApi,
  aClient,
  aMatter,
  ok,
  pageOfClients,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../shared/testing/org-testing';
import { aHit, anAdvancedPage } from '../../shared/testing/search-testing';
import { AdvancedSearchPage } from './advanced-search-page';

const ALL: Permission[] = ['Client.View', 'Matter.View', 'Project.View', 'Task.View', 'Asset.View'];

describe('AdvancedSearchPage', () => {
  let api: { advancedSearch: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  async function create(inputs: Record<string, unknown> = {}, permissions: Permission[] = ALL) {
    api = { advancedSearch: vi.fn().mockReturnValue(ok(anAdvancedPage([aHit()], { total: 1 }))) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: SearchClient, useValue: api },
        {
          provide: ClientsClient,
          useValue: {
            listClients: vi.fn().mockReturnValue(ok(pageOfClients(aClient()))),
            getClient: vi.fn().mockReturnValue(ok(aClient())),
          },
        },
        {
          provide: MattersClient,
          useValue: {
            listMatters: vi.fn().mockReturnValue(ok(pageOfMatters(aMatter()))),
            getMatter: vi.fn().mockReturnValue(ok(aMatter())),
          },
        },
        {
          provide: AssetTypesClient,
          useValue: {
            listAssetTypes: vi.fn().mockReturnValue(
              ok({
                items: [
                  { assetTypeId: 4, name: 'Laptop', isActive: true },
                  { assetTypeId: 5, name: 'Server', isActive: true },
                ],
                total: 2,
                page: 1,
                pageSize: 100,
              }),
            ),
          },
        },
        { provide: PrioritiesClient, useClass: FakePrioritiesClient },
        { provide: StatusLabelsClient, useClass: FakeStatusLabelsClient },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AdvancedSearchPage);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await settle(fixture);
    return fixture;
  }

  const labels = (el: HTMLElement, selector: string) =>
    Array.from(el.querySelectorAll(selector)).map((n) =>
      n.textContent!.replace(/\s+/g, ' ').trim(),
    );

  it('offers an object-type selector with only the types the user may search', async () => {
    const full = await create();
    expect(labels(full.nativeElement, '.adv-types label')).toEqual([
      'Matter',
      'Client',
      'Task',
      'Project',
      'Asset',
    ]);
    TestBed.resetTestingModule();

    const limited = await create({}, ['Client.View', 'Asset.View']);
    expect(labels(limited.nativeElement, '.adv-types label')).toEqual(['Client', 'Asset']);
    const checked = limited.nativeElement.querySelector(
      'input[name=adv-type]:checked',
    ) as HTMLInputElement;
    expect(checked.value).toBe('client');
  });

  it('does not search until a search is asked for', async () => {
    const fixture = await create();
    expect(api.advancedSearch).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-hit-table]')).toBeNull();
  });

  it('shows the filters of the chosen type and resets those of the previous one', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    const radio = (value: string) =>
      el.querySelector<HTMLInputElement>(`input[name=adv-type][value=${value}]`)!;
    const filterIds = () =>
      Array.from(el.querySelectorAll('[data-filters] [id]'))
        .map((n) => n.id)
        .filter((id) => /^adv-(?!q$)/.test(id) && !id.endsWith('-list'));

    expect(filterIds()).toEqual(
      expect.arrayContaining(['adv-client', 'adv-active', 'adv-sensitive']),
    );
    expect(filterIds()).not.toContain('adv-asset-type');

    radio('asset').click();
    radio('asset').dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(filterIds()).toEqual(
      expect.arrayContaining(['adv-matter', 'adv-asset-type', 'adv-active']),
    );
    expect(filterIds()).not.toContain('adv-sensitive');
    expect(labels(el, '#adv-asset-type option')).toEqual(['Any type', 'Laptop', 'Server']);

    radio('task').dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(labels(el, '.adv-statuses label')).toEqual([
      'New',
      'In Progress',
      'On Hold',
      'Completed',
      'Cancelled',
    ]);
    expect(el.querySelector('#adv-requestor')).not.toBeNull();
    expect(el.querySelector('#adv-active')).toBeNull();

    radio('client').dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el.querySelector('#adv-active')).not.toBeNull();
    expect(el.querySelector('#adv-matter')).toBeNull();
  });

  it('puts the search in the URL when the form is submitted', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    const choose = (value: string) =>
      el
        .querySelector<HTMLInputElement>(`input[name=adv-type][value=${value}]`)!
        .dispatchEvent(new Event('change'));

    choose('matter');
    const text = el.querySelector<HTMLInputElement>('#adv-q')!;
    text.value = ' merger ';
    text.dispatchEvent(new Event('input'));
    const sensitive = el.querySelector<HTMLSelectElement>('#adv-sensitive')!;
    sensitive.value = 'true';
    sensitive.dispatchEvent(new Event('change'));
    const active = el.querySelector<HTMLSelectElement>('#adv-active')!;
    active.value = 'false';
    active.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    el.querySelector('form')!.dispatchEvent(new Event('submit'));

    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: {
        type: 'matter',
        q: 'merger',
        client: null,
        matter: null,
        assetType: null,
        active: 'false',
        sensitive: 'true',
        status: null,
        requestor: null,
        page: null,
      },
    });
  });

  it('sends the URL state to the API with only the filters of the type', async () => {
    await create({
      type: 'matter',
      q: 'merger',
      client: '1',
      active: 'true',
      sensitive: 'false',
      requestor: 'ignored',
      page: '2',
    });
    expect(api.advancedSearch).toHaveBeenLastCalledWith(
      'matter',
      'merger',
      1,
      undefined,
      undefined,
      undefined,
      true,
      false,
      undefined,
      undefined,
      2,
      25,
    );
  });

  it('sends Task filters the way the Task Queue names them', async () => {
    await create({
      type: 'task',
      status: ['NEW', 'ON_HOLD'],
      client: '1',
      matter: '7',
      requestor: ' pat ',
      active: 'true',
    });
    expect(api.advancedSearch).toHaveBeenLastCalledWith(
      'task',
      undefined,
      1,
      7,
      undefined,
      undefined,
      undefined,
      undefined,
      ['NEW', 'ON_HOLD'],
      'pat',
      1,
      25,
    );
  });

  it('sends Asset filters', async () => {
    await create({ type: 'asset', matter: '7', assetType: '5', active: 'false' });
    expect(api.advancedSearch).toHaveBeenLastCalledWith(
      'asset',
      undefined,
      undefined,
      7,
      undefined,
      5,
      false,
      undefined,
      undefined,
      undefined,
      1,
      25,
    );
  });

  it('fills the form and the pickers from the URL', async () => {
    const fixture = await create({
      type: 'asset',
      q: 'laptop',
      matter: '7',
      assetType: '5',
      active: 'true',
    });
    const el: HTMLElement = fixture.nativeElement;

    expect((el.querySelector('input[name=adv-type]:checked') as HTMLInputElement).value).toBe(
      'asset',
    );
    expect(el.querySelector<HTMLInputElement>('#adv-q')!.value).toBe('laptop');
    expect(el.querySelector('[data-chosen]')!.textContent).toContain('00343-00012 Merger Review');
    expect(el.querySelector<HTMLSelectElement>('#adv-active')!.value).toBe('true');
  });

  it('lists the results in a table with a count and pages them', async () => {
    const fixture = await create({ type: 'matter', q: 'merger' });
    api.advancedSearch.mockReturnValue(ok(anAdvancedPage([aHit()], { total: 60 })));
    fixture.componentRef.setInput('q', 'merge');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-count]')!.textContent).toContain('60 results');
    expect(el.querySelectorAll('[data-hit-row]').length).toBe(1);
    expect(el.textContent).toContain('Showing 1-25 of 60');
    expect(el.querySelector('[data-live]')!.textContent).toContain('60 results');

    Array.from(el.querySelectorAll('mf-pager button'))
      .find((b) => b.textContent!.includes('Next'))!
      .dispatchEvent(new Event('click'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { page: 2 },
      queryParamsHandling: 'merge',
    });
  });

  it('shows an empty state with a reset, and an error with a retry', async () => {
    const fixture = await create({ type: 'client', q: 'zzz' });
    api.advancedSearch.mockReturnValue(ok(anAdvancedPage([], { type: 'client', total: 0 })));
    fixture.componentRef.setInput('q', 'zzzz');
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-state=empty]')).not.toBeNull();

    api.advancedSearch.mockReturnValue(throwError(() => new Error('boom')));
    fixture.componentRef.setInput('q', 'zzzzz');
    await settle(fixture);
    const error = fixture.nativeElement.querySelector('[data-state=error]');
    expect(error.textContent).toContain('Search is unavailable. Try again.');
    expect(fixture.nativeElement.querySelector('[data-live]').textContent).toContain(
      'Search is unavailable',
    );
  });

  it('ignores a type in the URL that the user may not search', async () => {
    const fixture = await create({ type: 'task' }, ['Client.View']);
    expect(api.advancedSearch).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement.querySelector('input[name=adv-type]:checked') as HTMLInputElement)
        .value,
    ).toBe('client');
  });
});
