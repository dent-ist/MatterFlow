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

  it('shows the number prominently with the matters of the client', async () => {
    await create(['Client.View', 'Matter.View']);

    expect(el().querySelector('[data-number]')?.textContent?.trim()).toBe('00343');
    expect(el().querySelector('h1')?.textContent).toContain('Acme Corp');
    expect(matters.listMatters).toHaveBeenCalledWith(
      undefined,
      1,
      undefined,
      undefined,
      1,
      100,
      'matterRef',
    );
    const ref = el().querySelector('tbody .mf-ref');
    expect(ref?.textContent).toBe('00343-00012');
    expect(ref?.getAttribute('href')).toBe('/matters/7');
    expect(el().textContent).toContain('Matters (2)');
  });

  it('gates the actions by permission', async () => {
    await create(['Client.View']);

    expect(buttonByLabel(el(), 'Edit')).toBeUndefined();
    expect(buttonByLabel(el(), 'Set inactive')).toBeUndefined();
    expect(buttonByLabel(el(), 'New Matter for this client')).toBeUndefined();
    expect(matters.listMatters).not.toHaveBeenCalled();
    expect(
      Array.from(el().querySelectorAll('[role=tab]')).map((t) => t.textContent!.trim()),
    ).toEqual(['Matters (2)', 'Details']);
  });

  it('starts a matter for this client, prefilled', async () => {
    await create(['Client.View', 'Matter.View', 'Matter.Create']);

    buttonByLabel(el(), 'New Matter for this client')!.click();
    expect(navigateByUrl).toHaveBeenCalledWith('/matters/new?clientId=1');
  });

  it('disables New Matter with a visible reason for an inactive client', async () => {
    await create(['Client.View', 'Matter.View', 'Matter.Create']);
    clients.getClient.mockReturnValue(ok(aClient({ isActive: false })));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(buttonByLabel(el(), 'New Matter for this client')!.disabled).toBe(true);
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
    expect(el().querySelector('.pg-chip')?.textContent).toContain('Inactive');
  });

  it('shows a not-found state with Retry', async () => {
    await create(['Client.View']);
    clients.getClient.mockReturnValue(apiError(404, { status: 404, code: 'NOT_FOUND' }));
    await fixture.componentInstance.load();
    await settle(fixture);

    expect(el().querySelector('[role=alert]')?.textContent).toContain("couldn't find that client");
  });

  it('shows the Activity tab only with Audit.View', async () => {
    await create(['Client.View', 'Audit.View']);

    const tabs = Array.from(el().querySelectorAll<HTMLElement>('[role=tab]'));
    expect(tabs.map((t) => t.textContent!.trim())).toContain('Activity');
    tabs.find((t) => t.textContent!.trim() === 'Activity')!.click();
    await settle(fixture);
    expect(el().querySelector('mf-entity-activity')).not.toBeNull();
  });
});
