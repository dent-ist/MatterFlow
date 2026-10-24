import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
      undefined,
      undefined,
      1,
      25,
      undefined,
    );
  });

  it('has no standalone search box or status select any more: the filters are column filters, open by default', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('#client-search, #client-status, mf-search-box')).toBeNull();
    // Open by default (WP8 #270): no click needed, and no toolbar row for the lone Filters button (it is in the page header).
    expect(el.querySelector('[data-filter-row]')).not.toBeNull();
    expect(el.querySelector('[data-grid-toolbar]')).toBeNull();
    expect(el.querySelector('mf-page-header [data-filters-toggle]')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Client number')).not.toBeNull();
    expect(control<HTMLInputElement>(el, 'Name')).not.toBeNull();
    // Active is the default: shown, not counted, not chipped, no Clear filters.
    expect(control<HTMLSelectElement>(el, 'Status').value).toBe('active');
    expect(el.querySelector('[data-filter-count]')).toBeNull();
    expect(el.querySelector('[data-filter-chips]')).toBeNull();
    expect(el.querySelector('[data-clear-filters]')).toBeNull();
  });

  it('remembers the closed row per list and shows chips with one Clear filters only while it is closed', async () => {
    const fixture = await create(['Client.View'], { name: 'acme', status: 'inactive' });
    const el: HTMLElement = fixture.nativeElement;

    // Open: the inputs show the values, no chips, exactly one Clear filters (in the header), the counter counts what was changed.
    expect(el.querySelector('[data-filter-chips]')).toBeNull();
    expect(el.querySelectorAll('[data-clear-filters]').length).toBe(1);
    expect(el.querySelector('mf-page-header [data-clear-filters]')).not.toBeNull();
    expect(el.querySelector('[data-filter-count]')?.textContent).toBe('(2)');

    el.querySelector<HTMLButtonElement>('[data-filters-toggle]')!.click();
    await settle(fixture);
    expect(el.querySelector('[data-filter-row]')).toBeNull();
    expect(el.querySelectorAll('[data-chip]').length).toBe(2);
    expect(el.querySelectorAll('[data-clear-filters]').length).toBe(1);
    expect(el.querySelector('mf-filters-bar [data-clear-filters]')).not.toBeNull();
    const key = Object.keys(localStorage).find((k) => k.startsWith('mf.clients.filters.open'))!;
    expect(localStorage.getItem(key)).toBe('0');
  });

  it('starts closed when the person closed it before', async () => {
    localStorage.clear();
    localStorage.setItem('mf.clients.filters.open', '0'); // before the profile loads: the key without a user
    api = { listClients: vi.fn().mockReturnValue(ok(pageOfClients(aClient()))) };
    query = fakeQuery();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        provideFakeMe(new FakeMeApi(withPermissions('Client.View'))),
        { provide: ClientsClient, useValue: api },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(ClientsListPage);
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-filter-row]')).toBeNull();
  });

  it('says how many inactive clients the default hides, and Show all sets Status to All', async () => {
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    api.listClients.mockImplementation((...args: unknown[]) =>
      ok(
        args[1] === false
          ? { items: [aClient()], total: 3, page: 1, pageSize: 1 }
          : pageOfClients(aClient()),
      ),
    );
    fixture.componentRef.setInput('sort', 'name'); // forces a reload
    await settle(fixture);

    expect(el.querySelector('[data-range]')?.textContent).toContain('Showing 1-1 of 1 active');
    expect(el.querySelector('[data-hidden-hint]')?.textContent).toContain('3 inactive hidden');
    // The second count is one cheap call: the other side of the status, one row, the same other filters.
    expect(api.listClients).toHaveBeenCalledWith(
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      1,
      'name',
    );

    el.querySelector<HTMLButtonElement>('[data-show-all]')!.click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'all', page: null },
      queryParamsHandling: 'merge',
    });
  });

  it('shows no hint for another Status, for nothing hidden or when the second count fails', async () => {
    const fixture = await create(['Client.View'], { status: 'inactive' });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-hidden-hint]')).toBeNull();
    expect(el.querySelector('[data-range]')?.textContent).toBe('Showing 1-1 of 1');

    query.set({ status: 'active' });
    api.listClients.mockImplementation((...args: unknown[]) =>
      args[1] === false
        ? apiError(500, { status: 500, code: 'INTERNAL_ERROR' })
        : ok(pageOfClients(aClient())),
    );
    fixture.componentRef.setInput('sort', 'name');
    await settle(fixture);
    expect(el.querySelector('[data-hidden-hint]')).toBeNull();
    expect(el.querySelector('tbody tr td a')).not.toBeNull(); // the list still works
    expect(el.querySelector('[data-range]')?.textContent).toBe('Showing 1-1 of 1');
  });

  it('clamps a long name at two lines with the full text as its tooltip, and keeps the number on one line', async () => {
    const long = 'A very long client name '.repeat(6).trim();
    const fixture = await create();
    api.listClients.mockReturnValue(ok(pageOfClients(aClient({ name: long }))));
    fixture.componentRef.setInput('sort', 'name');
    await settle(fixture);
    const row = fixture.nativeElement.querySelector('tbody tr')!;
    const name = row.querySelector('.pg-name')!;
    expect(name.getAttribute('title')).toBe(long);
    expect(name.textContent?.trim()).toBe(long);
    expect(row.querySelector('td.pg-nowrap')).not.toBeNull();
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
      undefined,
      undefined,
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

  describe('Open tasks and Overdue (WP9, #266, #268)', () => {
    const rowsOf = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr'));

    it('shows Open tasks and Overdue with Task.View: a link to the Task Queue above 0, plain 0 and an en dash at 0', async () => {
      const fixture = await create(['Client.View', 'Task.View']);
      api.listClients.mockReturnValue(
        ok(
          pageOfClients(
            aClient({ clientId: 1, openTaskCount: 12, overdueTaskCount: 3 }),
            aClient({ clientId: 2, name: 'Quiet LLC', openTaskCount: 0, overdueTaskCount: 0 }),
          ),
        ),
      );
      fixture.componentRef.setInput('sort', 'name');
      await settle(fixture);
      const el: HTMLElement = fixture.nativeElement;

      const heads = Array.from(el.querySelectorAll('thead tr:first-child th')).map((h) =>
        h.textContent!.trim(),
      );
      expect(heads).toEqual([
        'Client number',
        'Name',
        'Matters',
        'Open tasks',
        'Overdue',
        'Status',
      ]);
      const [busy, quiet] = rowsOf(el);
      const open = busy.querySelector<HTMLAnchorElement>('[data-count=open] a')!;
      expect(open.textContent!.trim()).toBe('12');
      expect(open.getAttribute('aria-label')).toBe('12 open tasks in Acme Corp');
      expect(open.getAttribute('href')).toBe(
        '/tasks?client=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD',
      );
      const overdue = busy.querySelector<HTMLAnchorElement>('[data-count=overdue] a')!;
      expect(overdue.getAttribute('aria-label')).toBe('3 overdue tasks in Acme Corp');
      expect(overdue.getAttribute('href')).toBe(
        '/tasks?client=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&overdue=true',
      );
      expect(overdue.querySelector('.pi-exclamation-circle')).not.toBeNull();
      // Zero work is not an error: 0 and an en dash, no link.
      expect(quiet.querySelector('[data-count=open]')!.textContent!.trim()).toBe('0');
      expect(quiet.querySelector('[data-count=overdue] [aria-hidden=true]')!.textContent).toBe('–');
      expect(quiet.querySelectorAll('[data-count] a')).toHaveLength(0);
    });

    it('leaves both columns out without Task.View', async () => {
      const fixture = await create(['Client.View']);
      const el: HTMLElement = fixture.nativeElement;
      const heads = Array.from(el.querySelectorAll('thead tr:first-child th')).map((h) =>
        h.textContent!.trim(),
      );
      expect(heads).toEqual(['Client number', 'Name', 'Matters', 'Status']);
      expect(el.querySelector('[data-count]')).toBeNull();
    });

    it('sorts by the counts, the first click descending, and shows aria-sort', async () => {
      const fixture = await create(['Client.View', 'Task.View']);
      fixture.componentRef.setInput('sort', '-openTasks');
      await settle(fixture);
      const el: HTMLElement = fixture.nativeElement;
      const th = Array.from(el.querySelectorAll('thead th')).find((h) =>
        h.textContent!.includes('Open tasks'),
      )!;
      expect(th.getAttribute('aria-sort')).toBe('descending');
      const overdue = Array.from(el.querySelectorAll('thead th')).find((h) =>
        h.textContent!.includes('Overdue'),
      )!;
      overdue.querySelector('button')!.click();
      expect(navigate).toHaveBeenLastCalledWith([], {
        queryParams: { sort: '-overdue', page: null },
        queryParamsHandling: 'merge',
      });
    });

    it('has the name as the one link and the number as plain text', async () => {
      const fixture = await create(['Client.View', 'Task.View']);
      const row = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
      const links = Array.from(row.querySelectorAll('a')).filter((a) => !a.closest('[data-count]'));
      expect(links).toHaveLength(1);
      expect(links[0].textContent!.trim()).toBe('Acme Corp');
      expect(row.querySelector('td.pg-mono a')).toBeNull();
    });
  });
});
