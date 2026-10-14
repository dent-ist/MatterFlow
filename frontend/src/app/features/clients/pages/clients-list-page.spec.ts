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
  ok,
  pageOfClients,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ClientsListPage } from './clients-list-page';

describe('ClientsListPage', () => {
  let api: { listClients: ReturnType<typeof vi.fn> };

  async function create(permissions: Permission[] = ['Client.View', 'Client.Create']) {
    api = { listClients: vi.fn().mockReturnValue(ok(pageOfClients(aClient()))) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ClientsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(ClientsListPage);
    await settle(fixture);
    return fixture;
  }

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
    expect(api.listClients).toHaveBeenCalledWith(undefined, true, 1, 25, undefined);
  });

  it('sends the URL state to the API: search text (padded or not), status, page and sort', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('q', ' 343 ');
    fixture.componentRef.setInput('status', 'all');
    fixture.componentRef.setInput('page', '2');
    fixture.componentRef.setInput('sort', '-name');
    await settle(fixture);

    expect(api.listClients).toHaveBeenLastCalledWith('343', undefined, 2, 25, '-name');
  });

  it('writes search, status and sort changes back to the URL', async () => {
    const fixture = await create();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;

    const box = el.querySelector<HTMLInputElement>('#client-search')!;
    box.value = '343';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { q: '343', page: null },
      queryParamsHandling: 'merge',
    });

    const status = el.querySelector<HTMLSelectElement>('#client-status')!;
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

  it('shows the empty state with New client when permitted, and a filtered empty state otherwise', async () => {
    const fixture = await create();
    api.listClients.mockReturnValue(ok(pageOfClients()));
    fixture.componentRef.setInput('page', '1');
    fixture.componentRef.setInput('q', undefined);
    fixture.componentRef.setInput('sort', 'name'); // forces a reload
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-empty=none]')?.textContent).toContain('No clients yet');
    expect(buttonByLabel(el.querySelector('[data-empty=none]')!, 'New client')).toBeDefined();

    fixture.componentRef.setInput('q', 'zzz');
    await settle(fixture);
    expect(el.querySelector('[data-empty=filtered]')?.textContent).toContain(
      'No results match these filters.',
    );
    expect(buttonByLabel(el, 'Clear filters')).toBeDefined();
  });

  it('shows an inline error with Retry and recovers', async () => {
    const fixture = await create();
    api.listClients.mockReturnValue(apiError(500, { status: 500, code: 'INTERNAL_ERROR' }));
    fixture.componentRef.setInput('sort', 'name');
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Something went wrong');

    api.listClients.mockReturnValue(ok(pageOfClients(aClient())));
    buttonByLabel(el, 'Retry')!.click();
    await settle(fixture);
    expect(el.querySelector('tbody tr')).not.toBeNull();
  });

  it('hides New client without Client.Create', async () => {
    const fixture = await create(['Client.View']);

    expect(buttonByLabel(fixture.nativeElement, 'New client')).toBeUndefined();
  });
});
