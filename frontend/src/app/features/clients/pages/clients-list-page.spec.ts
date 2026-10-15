import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ClientsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aClient,
  apiError,
  buttonByLabel,
  fakeQuery,
  ok,
  pageOfClients,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ClientsListPage } from './clients-list-page';

describe('ClientsListPage', () => {
  let api: { listClients: ReturnType<typeof vi.fn> };
  let query: ReturnType<typeof fakeQuery>;
  let navigate: ReturnType<typeof vi.fn>;

  async function create(
    permissions: Permission[] = ['Client.View', 'Client.Create'],
    params: Record<string, string> = {},
  ) {
    localStorage.clear();
    api = { listClients: vi.fn().mockReturnValue(ok(pageOfClients(aClient()))) };
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ClientsClient, useValue: api },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    query.set(params);
    const fixture = TestBed.createComponent(ClientsListPage);
    await settle(fixture);
    return fixture;
  }

  const control = <T extends HTMLElement>(el: HTMLElement, name: string): T =>
    el.querySelector<T>(`[aria-label="Filter by ${name}"]`)!;

  it('lists clients with the padded number prominently and a link to the detail page', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;

    const row = el.querySelector('tbody tr')!;
    expect(row.querySelector('.pg-mono')?.textContent?.trim()).toBe('00343');
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/clients/1');
    expect(row.textContent).toContain('Acme Corp');
    expect(row.textContent).toContain('Active');
    expect(el.textContent).toContain('Showing 1-1 of 1');
    // Default request: active clients, first page, default sort.
    expect(api.listClients).toHaveBeenCalledWith(
      undefined,
      true,
      undefined,
      undefined,
      1,
      25,
      undefined,
    );
  });

  it('has no standalone search box or status select any more: the filters are column filters, closed by default', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('#client-search, #client-status, mf-search-box')).toBeNull();
    expect(el.querySelector('[data-filter-row]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-filter-row]')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Client number')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Name')).not.toBeNull();
    // Active is the default: shown, not counted.
    expect(control<HTMLSelectElement>(el, 'Status').value).toBe('active');
    expect(el.querySelector('[data-filter-count]')).toBeNull();
  });

  it('sends the filters of the URL to the API: number, name, status, page and sort', async () => {
    const fixture = await create(['Client.View'], {
      clientNumber: '343',
      name: ' acme ',
      status: 'all',
    });
    fixture.componentRef.setInput('page', '2');
    fixture.componentRef.setInput('sort', '-name');
    await settle(fixture);

    expect(api.listClients).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      '343',
      'acme',
      2,
      25,
      '-name',
    );
    // A deep link with filters opens the row and shows the values and the count (status All is a change from the default).
    const el: HTMLElement = fixture.nativeElement;
    expect(control<HTMLInputElement>(el, 'Client number').value).toBe('343');
    expect(control<HTMLInputElement>(el, 'Name').value).toBe('acme');
    expect(el.querySelector('[data-filter-count]')?.textContent).toBe('(3)');
  });

  it('writes filter and sort changes back to the URL and resets the page', async () => {
    const fixture = await create(['Client.View'], { page: '3' });
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);

    const name = control<HTMLInputElement>(el, 'Name');
    name.value = ' acme ';
    name.dispatchEvent(new Event('input'));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { name: 'acme', page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    const status = control<HTMLSelectElement>(el, 'Status');
    status.value = 'inactive';
    status.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'inactive', page: null },
      queryParamsHandling: 'merge',
    });

    buttonByLabel(el, 'Name')!.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { sort: 'name', page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('shows aria-sort on the active column', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('sort', '-clientNumber');
    await settle(fixture);

    const headers = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('th'));
    expect(headers[0].getAttribute('aria-sort')).toBe('descending');
    expect(headers[1].getAttribute('aria-sort')).toBe('none');
  });

  it('keeps the headers and the filter row in the empty states: first run with New client, filtered with Clear filters', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    api.listClients.mockReturnValue(ok(pageOfClients()));
    fixture.componentRef.setInput('sort', 'name'); // forces a reload
    await settle(fixture);
    expect(el.querySelector('[data-empty=none]')?.textContent).toContain('No clients yet');
    expect(buttonByLabel(el.querySelector('[data-empty=none]')!, 'New client')).toBeDefined();
    expect(el.querySelector('thead th')).not.toBeNull();

    query.set({ name: 'zzz' });
    await settle(fixture);
    expect(el.querySelector('[data-empty=filtered]')?.textContent).toContain(
      'No clients match these filters',
    );
    expect(el.querySelector('thead th')).not.toBeNull();
    expect(el.querySelector('[data-filter-row]')).not.toBeNull(); // opened by the filter in the address
    expect(
      el.querySelector('[data-empty=filtered]') &&
        buttonByLabel(el.querySelector('[data-empty=filtered]')!, 'Clear filters'),
    ).toBeDefined();
  });

  it('shows an inline error with Retry inside the grid and recovers', async () => {
    const fixture = await create();
    api.listClients.mockReturnValue(apiError(500, { status: 500, code: 'INTERNAL_ERROR' }));
    fixture.componentRef.setInput('sort', 'name');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role=alert]')?.textContent).toContain("Couldn't load clients.");
    expect(el.querySelector('thead th')).not.toBeNull();

    api.listClients.mockReturnValue(ok(pageOfClients(aClient())));
    buttonByLabel(el, 'Retry')!.click();
    await settle(fixture);
    expect(el.querySelector('tbody tr td a')).not.toBeNull();
  });

  it('hides New client without Client.Create', async () => {
    const fixture = await create(['Client.View']);

    expect(buttonByLabel(fixture.nativeElement, 'New client')).toBeUndefined();
  });
});
