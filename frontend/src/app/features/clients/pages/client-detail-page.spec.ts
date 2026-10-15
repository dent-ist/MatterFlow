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
  ok,
  pageOfMatters,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ClientDetailPage } from './client-detail-page';

describe('ClientDetailPage', () => {
  let clients: { getClient: ReturnType<typeof vi.fn>; updateClient: ReturnType<typeof vi.fn> };
  let matters: { listMatters: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ClientDetailPage>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(permissions: Permission[]) {
    clients = {
      getClient: vi.fn().mockReturnValue(ok(aClient())),
      updateClient: vi.fn().mockReturnValue(ok(aClient({ isActive: false }))),
    };
    matters = { listMatters: vi.fn().mockReturnValue(ok(pageOfMatters(aMatter()))) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
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
    await settle(fixture);
  }

  it('shows the number prominently with the matters of the client in the main area', async () => {
    await create(['Client.View', 'Matter.View']);

    expect(el().querySelector('[data-ref]')?.textContent?.trim()).toBe('00343');
    expect(el().querySelector('h1')?.textContent).toContain('Acme Corp');
    expect(matters.listMatters).toHaveBeenCalledWith(
      undefined,
      1,
      true, // status filter defaults to Active
      undefined,
      1,
      25,
      undefined,
    );
    const ref = el().querySelector('[data-detail-main] tbody .mf-ref');
    expect(ref?.textContent).toBe('00343-00012');
    expect(ref?.getAttribute('href')).toBe('/matters/7');
    expect(el().querySelector('[data-detail-main] h2')?.textContent).toContain('Matters');
    expect(el().querySelector('[role=tab]')).toBeNull();
  });

  it('shows the fields in a labelled Details panel on the side', async () => {
    await create(['Client.View', 'Matter.View']);

    const aside = el().querySelector('aside')!;
    const heading = document.getElementById(aside.getAttribute('aria-labelledby')!)!;
    expect(heading.textContent?.trim()).toBe('Details');
    expect(aside.textContent).toContain('00343');
    expect(aside.textContent).toContain('Acme Corp');
    expect(aside.querySelector('mf-active-badge')?.textContent).toContain('Active');
    expect(aside.textContent).toContain('Created');
  });

  it('searches, filters by status, sorts and pages the matters through the address', async () => {
    await create(['Client.View', 'Matter.View']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const box = el().querySelector<HTMLInputElement>('#client-matter-search')!;
    box.value = 'merger';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { q: 'merger', page: null },
      queryParamsHandling: 'merge',
    });

    const status = el().querySelector<HTMLSelectElement>('#client-matter-status')!;
    status.value = 'all';
    status.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenLastCalledWith([], {
      queryParams: { status: 'all', page: null },
      queryParamsHandling: 'merge',
    });

    // The list state comes from the address (router-bound inputs of the page).
    fixture.componentRef.setInput('status', 'all');
    fixture.componentRef.setInput('q', 'merger');
    fixture.componentRef.setInput('sort', '-name');
    fixture.componentRef.setInput('page', '2');
    await settle(fixture);
    expect(matters.listMatters).toHaveBeenLastCalledWith(
      'merger',
      1,
      undefined,
      undefined,
      2,
      25,
      '-name',
    );
  });

  it('shows an empty state and a retry for the matters', async () => {
    await create(['Client.View', 'Matter.View']);
    matters.listMatters.mockReturnValue(ok(pageOfMatters()));
    fixture.componentRef.setInput('q', 'zzz');
    await settle(fixture);
    expect(el().textContent).toContain('No matters match');

    matters.listMatters.mockReturnValue(apiError(500, { title: 'x', status: 500 } as never));
    fixture.componentRef.setInput('q', 'yyy');
    await settle(fixture);
    expect(el().querySelector('[data-detail-main] [role=alert]')).not.toBeNull();
  });

  it('gates the actions by permission', async () => {
    await create(['Client.View']);

    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(buttonByLabel(el(), 'Set inactive')).toBeUndefined();
    expect(buttonByLabel(el(), 'Create matter')).toBeUndefined();
    expect(buttonByLabel(el(), 'Activity')).toBeUndefined();
    expect(matters.listMatters).not.toHaveBeenCalled();
    expect(el().querySelector('[data-no-access=matters]')).not.toBeNull();
  });

  it('opens Edit from the Details panel', async () => {
    await create(['Client.View', 'Client.Edit']);

    const edit = buttonByLabel(el(), 'Edit')!;
    expect(el().querySelector('aside')!.contains(edit)).toBe(true);
    edit.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/clients/1/edit');
  });

  it('starts a matter for this client, prefilled', async () => {
    await create(['Client.View', 'Matter.View', 'Matter.Create']);

    buttonByLabel(el(), 'Create matter')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/matters/new?clientId=1');
  });

  it('disables Create matter with a visible reason for an inactive client', async () => {
    await create(['Client.View', 'Matter.View', 'Matter.Create']);
    clients.getClient.mockReturnValue(ok(aClient({ isActive: false })));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(buttonByLabel(el(), 'Create matter')!.disabled).toBe(true);
    expect(el().querySelector('[data-inactive-reason]')?.textContent).toContain(
      "new matters can't be created",
    );
  });

  it('confirms before setting a client inactive and states the consequence', async () => {
    await create(['Client.View', 'Client.Edit']);

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
    expect(el().querySelector('aside mf-active-badge')?.textContent).toContain('Inactive');
  });

  it('shows a not-found state with Retry', async () => {
    await create(['Client.View']);
    clients.getClient.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('[role=alert]')?.textContent).toContain("couldn't find that client");
  });

  it('offers Activity as a header button (Audit.View) that opens the drawer titled with the client', async () => {
    await create(['Client.View', 'Audit.View']);
    expect(el().querySelector('[role=tab]')).toBeNull();
    expect(document.body.querySelector('.mf-drawer')).toBeNull();

    buttonByLabel(el(), 'Activity')!.click();
    await settle(fixture);
    const drawer = document.body.querySelector('.mf-drawer') as HTMLElement;
    expect(drawer.textContent).toContain('Activity: Acme Corp');
    expect(drawer.querySelector('mf-entity-activity')).not.toBeNull();
  });

  it('opens the drawer for an old ?tab=activity link and ignores ?tab=details', async () => {
    await create(['Client.View', 'Audit.View']);
    fixture.componentRef.setInput('tab', 'details');
    await settle(fixture);
    expect(document.body.querySelector('.mf-drawer')).toBeNull();
    expect(el().querySelector('aside')).not.toBeNull();

    fixture.componentRef.setInput('tab', 'activity');
    await settle(fixture);
    expect(document.body.querySelector('.mf-drawer')).not.toBeNull();
  });
});
