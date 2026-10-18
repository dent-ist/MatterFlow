import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { AuditEventsClient, ClientsClient, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aClient,
  aMatter,
  apiError,
  buttonByLabel,
  fakeQuery,
  ok,
  openOverflow,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ClientDetailPage } from './client-detail-page';
import { aClientSummary } from './client-overview-testing';

describe('ClientDetailPage', () => {
  let clients: {
    getClient: ReturnType<typeof vi.fn>;
    updateClient: ReturnType<typeof vi.fn>;
    getClientSummary: ReturnType<typeof vi.fn>;
  };
  let matters: { listMatters: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ClientDetailPage>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof fakeQuery>;
  const el = (): HTMLElement => fixture.nativeElement;

  const tab = (label: string): HTMLElement =>
    Array.from(el().querySelectorAll<HTMLElement>('[role=tab]')).find((t) =>
      t.textContent!.trim().startsWith(label),
    )!;

  /** The tab lives in the address (`?tab=`); the router binds it to the page input, so tests set the input. */
  async function openTab(key: string | undefined): Promise<void> {
    fixture.componentRef.setInput('tab', key);
    await settle(fixture);
  }

  async function create(permissions: Permission[], startTab?: string) {
    localStorage.clear();
    query = fakeQuery();
    clients = {
      getClient: vi.fn().mockReturnValue(ok(aClient())),
      updateClient: vi.fn().mockReturnValue(ok(aClient({ isActive: false }))),
      getClientSummary: vi.fn().mockReturnValue(ok(aClientSummary())),
    };
    matters = { listMatters: vi.fn().mockReturnValue(ok(pageOfMatters(aMatter()))) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        query.provider,
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ClientsClient, useValue: clients },
        { provide: MattersClient, useValue: matters },
        {
          provide: AuditEventsClient,
          useValue: { listAuditEvents: vi.fn().mockReturnValue(ok({ items: [] })) },
        },
      ],
    });
    navigateByUrl = vi
      .spyOn(TestBed.inject(Router), 'navigateByUrl')
      .mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ClientDetailPage);
    fixture.componentRef.setInput('clientId', '1');
    if (startTab) fixture.componentRef.setInput('tab', startTab);
    await settle(fixture);
  }

  it('shows the number prominently with the matters of the client in the Matters tab', async () => {
    await create(['Client.View', 'Matter.View'], 'matters');

    expect(el().querySelector('[data-ref]')?.textContent?.trim()).toBe('00343');
    expect(el().querySelector('h1')?.textContent).toContain('Acme Corp');
    expect(matters.listMatters).toHaveBeenCalledWith(
      undefined,
      1,
      true, // status filter defaults to Active
      undefined,
      undefined,
      undefined,
      undefined,
      1,
      25,
      undefined,
    );
    const ref = el().querySelector('mf-client-matters tbody .mf-ref');
    expect(ref?.textContent).toBe('00343-00012');
    expect(ref?.getAttribute('href')).toBeNull(); // the reference is plain text; the name is the one link (WP9, #268)
    expect(el().querySelector('mf-client-matters tbody a.pg-name')?.getAttribute('href')).toBe(
      '/matters/7',
    );
    expect(tab('Matters').getAttribute('aria-selected')).toBe('true');
  });

  it('has Overview and Matters tabs, Overview first and the default; ?tab= selects the others', async () => {
    await create(['Client.View', 'Matter.View']);

    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Overview', 'Matters (2)']);
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    expect(el().querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe(
      'client-tab-details',
    );
    expect(matters.listMatters.mock.calls.map((c) => c[8])).toEqual([5]); // only the Overview's short list (no Task.View); the grid loads when its tab opens
    expect(el().querySelector('aside')).toBeNull();

    await openTab('matters');
    expect(tab('Matters').getAttribute('aria-selected')).toBe('true');
    expect(matters.listMatters.mock.calls.some((c) => c[8] === 25)).toBe(true); // the grid loads when its tab opens
    for (const key of [undefined, 'details', 'nonsense']) {
      await openTab(key);
      expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
    }
  });

  it('keeps the tab in the address (absent for Overview)', async () => {
    await create(['Client.View', 'Matter.View']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    tab('Matters').click();
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: {
        tab: 'matters',
        q: null,
        matterRef: null,
        name: null,
        isSensitive: null,
        status: null,
        page: null,
        size: null,
        sort: null,
      },
      queryParamsHandling: 'merge',
    });
    await openTab('matters'); // the page input follows the address
    tab('Overview').click();
    expect(
      (navigate.mock.lastCall![1] as { queryParams: { tab: unknown } }).queryParams.tab,
    ).toBeNull();
  });

  it('shows the Overview, not the number, name and status again, with no side panel', async () => {
    await create(['Client.View', 'Matter.View', 'Task.View']);

    expect(el().querySelector('aside')).toBeNull();
    const details = el().querySelector('[role=tabpanel] [data-details-tab]')!;
    expect(details.querySelector('[data-client-overview]')).not.toBeNull();
    expect(details.querySelector('dl')).toBeNull(); // the duplicated rows are gone
    expect(details.textContent).not.toContain('Client number');
    expect(details.textContent).toContain('Created Oct 1, 2026');
    expect(details.querySelector('[data-top-matters]')).not.toBeNull();
    expect(clients.getClientSummary).toHaveBeenCalledWith(1);
  });

  it('counts the matters in the tab label, muted at zero, and speaks the count once', async () => {
    await create(['Client.View', 'Matter.View']);
    expect(tab('Matters').textContent!.replace(/\s+/g, ' ').trim()).toBe('Matters (2)');
    expect(tab('Matters').getAttribute('aria-label')).toBe('Matters, 2');
    expect(tab('Overview').querySelector('.count')).toBeNull(); // never a count on Overview
    expect(tab('Overview').getAttribute('aria-label')).toBeNull();

    clients.getClient.mockReturnValue(ok(aClient({ matterCount: 0 })));
    await fixture.componentInstance.load();
    await settle(fixture);
    expect(tab('Matters').textContent!.replace(/\s+/g, ' ').trim()).toBe('Matters (0)');
    expect(tab('Matters').querySelector('.count')).not.toBeNull();
    expect(tab('Matters').getAttribute('aria-label')).toBe('Matters, 0');
  });

  it('has no Matters tab without Matter.View, and a Matters link falls back to the Overview', async () => {
    await create(['Client.View', 'Task.View'], 'matters');
    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Overview']);
    expect(el().querySelector('[data-top-matters]')).toBeNull();
    expect(el().querySelector('[data-overview-matters]')).toBeNull();
    expect(el().querySelector('[data-strip]')).not.toBeNull();
    expect(matters.listMatters).not.toHaveBeenCalled();
  });

  it('has column filters for Matter and Name and a Status that shows Active; no search box', async () => {
    await create(['Client.View', 'Matter.View'], 'matters');
    expect(el().querySelector('#client-matter-search, #client-matter-status')).toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull(); // open by default (WP8 #270)

    const control = <T extends HTMLElement>(name: string): T =>
      el().querySelector<T>(`[aria-label="Filter by ${name}"]`)!;
    expect(control('Matter')).not.toBeNull();
    expect(control('Name')).not.toBeNull();
    expect(control<HTMLSelectElement>('Status').value).toBe('active');
    expect(control<HTMLSelectElement>('Sensitive').value).toBe('');
    expect(el().querySelector('[data-more-filters]')).toBeNull();
    expect(el().querySelector('[data-filter-count]')).toBeNull();
  });

  it('filters, sorts and pages the matters through the address', async () => {
    await create(['Client.View', 'Matter.View'], 'matters');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const box = el().querySelector<HTMLInputElement>('[aria-label="Filter by Name"]')!;
    box.value = 'merger';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { name: 'merger', page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    const status = el().querySelector<HTMLSelectElement>('[aria-label="Filter by Status"]')!;
    status.value = 'all';
    status.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'all', page: null },
      queryParamsHandling: 'merge',
    });

    // The list state comes from the address: the filters from the query string, paging and sort from the page's router-bound inputs.
    query.set({ status: 'all', name: 'merger', matterRef: '343-12', isSensitive: 'false' });
    fixture.componentRef.setInput('status', 'all');
    fixture.componentRef.setInput('sort', '-name');
    fixture.componentRef.setInput('page', '2');
    await settle(fixture);
    expect(matters.listMatters).toHaveBeenLastCalledWith(
      undefined,
      1,
      undefined,
      false,
      '343-12',
      'merger',
      undefined,
      2,
      25,
      '-name',
    );
  });

  it('keeps the headers and filter row in the empty state and shows a retry inside the grid', async () => {
    await create(['Client.View', 'Matter.View'], 'matters');
    matters.listMatters.mockReturnValue(ok(pageOfMatters()));
    query.set({ name: 'zzz' });
    await settle(fixture);
    expect(el().textContent).toContain('No matters match');
    expect(el().querySelector('mf-client-matters thead th')).not.toBeNull();
    expect(el().querySelector('[data-filter-row]')).not.toBeNull();

    matters.listMatters.mockReturnValue(apiError(500, { title: 'x', status: 500 } as never));
    query.set({ name: 'yyy' });
    await settle(fixture);
    expect(el().querySelector('mf-client-matters [role=alert]')).not.toBeNull();
    expect(el().querySelector('mf-client-matters thead th')).not.toBeNull();
  });

  it('gates the actions by permission', async () => {
    await create(['Client.View']);

    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(buttonByLabel(el(), 'Activity')).toBeUndefined();
    expect(el().querySelector('[data-page-actions] button')).toBeNull(); // no empty "..." either
    expect(el().querySelector('[data-overflow]')).toBeNull();
    expect(buttonByLabel(el(), 'New matter')).toBeUndefined();
    expect(matters.listMatters).not.toHaveBeenCalled();
    expect(clients.getClientSummary).not.toHaveBeenCalled(); // no Task.View: no numbers asked for
  });

  it('opens Edit from the header; the Overview tab holds no action', async () => {
    await create(['Client.View', 'Client.Edit']);

    const edit = buttonByLabel(el(), 'Edit')!;
    expect(el().querySelector('[data-page-actions]')!.contains(edit)).toBe(true);
    expect(el().querySelector('[data-details-tab] button')).toBeNull();
    edit.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/clients/1/edit');
  });

  it('starts a matter for this client, prefilled', async () => {
    await create(['Client.View', 'Matter.View', 'Matter.Create'], 'matters');

    expect(buttonByLabel(el(), 'Create matter')).toBeUndefined();
    buttonByLabel(el(), 'New matter')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/matters/new?clientId=1');
  });

  it('disables New matter (aria-disabled, still focusable) with a visible reason for an inactive client', async () => {
    await create(['Client.View', 'Matter.View', 'Matter.Create'], 'matters');
    clients.getClient.mockReturnValue(ok(aClient({ isActive: false })));
    await fixture.componentInstance.load();
    await settle(fixture);

    // The header's primary action stays focusable and says why; the Matters tab has no second New matter button any more (WP9).
    const reason = 'This client is inactive. Set it active to add matters.';
    const header = el().querySelector<HTMLButtonElement>(
      '[data-page-actions] [data-action=new-matter]',
    )!;
    expect(header.disabled).toBe(false); // focusable, so the reason is reachable
    expect(header.getAttribute('aria-disabled')).toBe('true');
    expect(header.getAttribute('title')).toBe(reason);
    expect(document.getElementById(header.getAttribute('aria-describedby')!)?.textContent).toBe(
      reason,
    );
    header.click();
    expect(el().querySelector('[data-create-matter]')).toBeNull();
    expect(navigateByUrl).not.toHaveBeenCalled(); // activating it does nothing
  });

  it('puts New matter in the header as the primary action and Set inactive in the overflow', async () => {
    await create(['Client.View', 'Client.Edit', 'Matter.Create']);

    const header = Array.from(el().querySelectorAll('[data-page-actions] > button')).map((b) =>
      b.getAttribute('data-action'),
    );
    expect(header).toEqual(['edit', 'new-matter']);
    const menu = await openOverflow(fixture);
    expect(
      Array.from(menu!.querySelectorAll('[role=menuitem]')).map((b) => b.textContent!.trim()),
    ).toEqual(['Set inactive']);
    el().querySelector<HTMLButtonElement>('[data-page-actions] [data-action=new-matter]')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/matters/new?clientId=1');
  });

  it('confirms before setting a client inactive and states the consequence', async () => {
    await create(['Client.View', 'Client.Edit']);

    await openOverflow(fixture);
    buttonByLabel(el(), 'Set inactive')!.click();
    await settle(fixture);
    const dialog = document.body.querySelector('p-dialog') as HTMLElement;
    expect(dialog.querySelector('[data-toggle-body]')?.textContent).toContain(
      "New matters can't be created for an inactive client.",
    );
    expect(clients.updateClient).not.toHaveBeenCalled();

    buttonByLabel(dialog, 'Set inactive')!.click();
    await settle(fixture);
    expect(clients.updateClient).toHaveBeenCalledWith(1, {
      name: 'Acme Corp',
      isActive: false,
      rowVersion: 'AAAA',
    });
    expect(el().querySelector('[data-record-header] mf-active-badge')?.textContent).toContain(
      'Inactive',
    );
  });

  it('shows the not-found text with a link back and no Retry for a 404', async () => {
    await create(['Client.View']);
    clients.getClient.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('h1')?.textContent).toContain("We couldn't find that client.");
    expect(el().querySelector('[data-back-link]')?.textContent).toContain('Go to clients');
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
    expect(el().querySelector('[role=tablist]')).toBeNull(); // no header and tabs in an error state
  });

  it('shows the access text and no Retry for a 403', async () => {
    await create(['Client.View']);
    clients.getClient.mockReturnValue(apiError(403, { status: 403, code: 'PERMISSION_DENIED' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('h1')?.textContent).toContain(
      "You don't have access to this client.",
    );
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
  });

  it('shows "Couldn\'t load" with Retry for a server fault and recovers on Retry', async () => {
    await create(['Client.View']);
    clients.getClient.mockReturnValue(apiError(500, { status: 500, traceId: 'abc' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('h1')?.textContent).toContain("Couldn't load this client.");
    const retry = buttonByLabel(el(), 'Retry')!;
    retry.focus();
    clients.getClient.mockReturnValue(ok(aClient()));
    retry.click();
    await settle(fixture);
    expect(el().querySelector('[data-page-title]')?.textContent).toContain('Acme Corp');
    expect(buttonByLabel(el(), 'Retry')).toBeUndefined();
    expect(document.activeElement).toBe(el().querySelector('[data-page-title]'));
    expect(el().querySelector('[data-record-live]')?.textContent).toBe('Loaded');
  });

  it('names the record and the tab in the document title, and the id while loading', async () => {
    await create(['Client.View', 'Matter.View']);
    expect(document.title).toBe('00343 Acme Corp: Overview - MatterFlow');
    await openTab('matters');
    expect(document.title).toBe('00343 Acme Corp: Matters - MatterFlow');
    await openTab(undefined);
    expect(document.title).toBe('00343 Acme Corp: Overview - MatterFlow');
  });

  it('offers Activity as a header button (Audit.View) that opens the drawer titled with the client', async () => {
    await create(['Client.View', 'Audit.View']);
    expect(document.body.querySelector('.mf-drawer')).toBeNull();

    buttonByLabel(el(), 'Activity')!.click();
    await settle(fixture);
    const drawer = document.body.querySelector('.mf-drawer') as HTMLElement;
    expect(drawer.textContent).toContain('Activity: Acme Corp');
    expect(drawer.querySelector('mf-entity-activity')).not.toBeNull();
  });

  it('opens the drawer for an old ?tab=activity link (showing the Overview) and ?tab=details just shows the Overview', async () => {
    await create(['Client.View', 'Audit.View']);
    fixture.componentRef.setInput('tab', 'details');
    await settle(fixture);
    expect(document.body.querySelector('.mf-drawer')).toBeNull();
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');

    fixture.componentRef.setInput('tab', 'activity');
    await settle(fixture);
    expect(document.body.querySelector('.mf-drawer')).not.toBeNull();
    expect(tab('Overview').getAttribute('aria-selected')).toBe('true');
  });
});
