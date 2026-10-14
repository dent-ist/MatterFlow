import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { ClientFormPage } from './client-form-page';

describe('ClientFormPage', () => {
  let api: {
    getClient: ReturnType<typeof vi.fn>;
    createClient: ReturnType<typeof vi.fn>;
    updateClient: ReturnType<typeof vi.fn>;
    changeClientNumber: ReturnType<typeof vi.fn>;
  };
  let navigate: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<ClientFormPage>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(clientId: string | undefined, permissions: Permission[]) {
    api = {
      getClient: vi.fn().mockReturnValue(ok(aClient())),
      createClient: vi.fn().mockReturnValue(ok(aClient({ clientId: 9, clientNumber: '00343' }))),
      updateClient: vi.fn().mockReturnValue(ok(aClient({ name: 'Acme Corporation' }))),
      changeClientNumber: vi.fn().mockReturnValue(ok(aClient({ clientNumber: '00344' }))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        MessageService,
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: ClientsClient, useValue: api },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(ClientFormPage);
    if (clientId) fixture.componentRef.setInput('clientId', clientId);
    await settle(fixture);
  }

  function type(selector: string, value: string, blur = false): void {
    const input = el().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    if (blur) input.dispatchEvent(new Event('blur'));
  }

  async function submit(): Promise<void> {
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  describe('create', () => {
    beforeEach(() => create(undefined, ['Client.View', 'Client.Create']));

    it('previews the normalized number and saves it padded', async () => {
      type('#client-number', '343');
      fixture.detectChanges();
      expect(el().querySelector('[data-preview]')?.textContent).toContain(
        'Will be saved as 00343.',
      );

      type('#client-number', '343', true); // blur normalizes
      type('#client-name', '  Acme Corp ');
      await submit();

      expect(el().querySelector<HTMLInputElement>('#client-number')!.value).toBe('00343');
      expect(api.createClient).toHaveBeenCalledWith({ clientNumber: '00343', name: 'Acme Corp' });
      expect(navigate).toHaveBeenCalledWith(['/clients', 9]);
    });

    it('blocks submit with copy-deck messages and does not call the API', async () => {
      await submit();
      expect(api.createClient).not.toHaveBeenCalled();
      expect(el().querySelector('[data-summary]')?.textContent).toContain('Enter a client number.');
      expect(el().querySelector('[data-summary]')?.textContent).toContain('Enter a client name.');

      type('#client-number', '1234567', true);
      type('#client-name', 'X');
      await submit();
      expect(el().querySelector('[data-summary]')?.textContent).toContain('Use at most 5 digits.');
      expect(api.createClient).not.toHaveBeenCalled();
    });

    it('maps a duplicate-number response to the field, with a link to the existing client', async () => {
      api.createClient.mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'DUPLICATE_NUMBER',
          errors: {
            clientNumber: [{ code: 'DUPLICATE_NUMBER', message: 'Client 00343 already exists.' }],
          },
          meta: { existingId: 4 },
        }),
      );
      type('#client-number', '343', true);
      type('#client-name', 'Acme');
      await submit();

      expect(el().querySelector('#client-number-error')?.textContent).toContain(
        'Client 00343 already exists.',
      );
      const link = el().querySelector('[data-summary] a');
      expect(link?.getAttribute('href')).toBe('/clients/4');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('warns about unsaved changes only once something was typed', async () => {
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      type('#client-name', 'A');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
    });
  });

  describe('edit', () => {
    it('locks the number and hides Change number without Client.EditNumber', async () => {
      await create('1', ['Client.View', 'Client.Edit']);

      expect(el().querySelector('[data-locked-number]')?.textContent).toContain('00343');
      expect(el().querySelector('#client-number')).toBeNull();
      expect(buttonByLabel(el(), 'Change number')).toBeUndefined();
    });

    it('saves name and status with the row version', async () => {
      await create('1', ['Client.View', 'Client.Edit']);
      type('#client-name', 'Acme Corporation');
      const inactive = el().querySelectorAll<HTMLInputElement>('input[type=radio]')[1];
      inactive.click();
      await submit();

      expect(api.updateClient).toHaveBeenCalledWith(1, {
        name: 'Acme Corporation',
        isActive: false,
        rowVersion: 'AAAA',
      });
    });

    it('offers a conflict banner with Reload latest on 409', async () => {
      await create('1', ['Client.View', 'Client.Edit']);
      api.updateClient.mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'CONCURRENCY_CONFLICT',
          meta: { currentRowVersion: 'ZZ' },
        }),
      );
      type('#client-name', 'Changed');
      await submit();

      expect(el().querySelector('[data-conflict]')).not.toBeNull();
      api.getClient.mockReturnValue(ok(aClient({ name: 'Server name', rowVersion: 'ZZ' })));
      buttonByLabel(el().querySelector('[data-conflict]')!, 'Reload latest')!.click();
      await settle(fixture);
      expect(el().querySelector<HTMLInputElement>('#client-name')!.value).toBe('Server name');
    });

    it('changes the number through a confirmation dialog that explains the consequence', async () => {
      await create('1', ['Client.View', 'Client.Edit', 'Client.EditNumber']);

      buttonByLabel(el(), 'Change number')!.click();
      await settle(fixture);
      const dialog = document.body.querySelector('p-dialog')!;
      expect(dialog.querySelector('[data-number-warning]')?.textContent).toContain(
        'Changing this number changes how matters are named in emails, workspaces and folders. This change is recorded.',
      );

      const input = document.body.querySelector<HTMLInputElement>('#new-client-number')!;
      input.value = '344';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      buttonByLabel(dialog as HTMLElement, 'Change number')!.click();
      await settle(fixture);

      expect(api.changeClientNumber).toHaveBeenCalledWith(1, {
        number: '00344',
        rowVersion: 'AAAA',
      });
      expect(el().querySelector('[data-locked-number]')?.textContent).toContain('00344');
    });

    it('shows a duplicate-number error inside the change-number dialog', async () => {
      await create('1', ['Client.View', 'Client.Edit', 'Client.EditNumber']);
      api.changeClientNumber.mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'DUPLICATE_NUMBER',
          errors: {
            number: [{ code: 'DUPLICATE_NUMBER', message: 'Client 00500 already exists.' }],
          },
        }),
      );
      buttonByLabel(el(), 'Change number')!.click();
      await settle(fixture);
      const input = document.body.querySelector<HTMLInputElement>('#new-client-number')!;
      input.value = '500';
      input.dispatchEvent(new Event('input'));
      buttonByLabel(
        document.body.querySelector('p-dialog') as HTMLElement,
        'Change number',
      )!.click();
      await settle(fixture);

      expect(document.body.querySelector('#new-client-number-error')?.textContent).toContain(
        'Client 00500 already exists.',
      );
    });
  });
});
