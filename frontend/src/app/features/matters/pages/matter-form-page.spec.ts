import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ClientsClient, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import {
  FakeMeApi,
  aClient,
  aMatter,
  apiError,
  buttonByLabel,
  ok,
  pageOfClients,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterFormPage } from './matter-form-page';

describe('MatterFormPage', () => {
  let matters: Record<
    'getMatter' | 'createMatter' | 'updateMatter' | 'changeMatterNumber',
    ReturnType<typeof vi.fn>
  >;
  let clients: Record<'listClients' | 'getClient', ReturnType<typeof vi.fn>>;
  let navigate: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<MatterFormPage>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(inputs: Record<string, string>, permissions: Permission[]) {
    matters = {
      getMatter: vi.fn().mockReturnValue(ok(aMatter())),
      createMatter: vi.fn().mockReturnValue(ok(aMatter({ matterId: 21 }))),
      updateMatter: vi.fn().mockReturnValue(ok(aMatter({ name: 'Renamed' }))),
      changeMatterNumber: vi
        .fn()
        .mockReturnValue(ok(aMatter({ matterNumber: '00099', matterRef: '00343-00099' }))),
    };
    clients = {
      listClients: vi
        .fn()
        .mockReturnValue(
          ok(
            pageOfClients(
              aClient(),
              aClient({ clientId: 2, clientNumber: '00001', name: 'Beta LLC', isActive: false }),
            ),
          ),
        ),
      getClient: vi.fn().mockReturnValue(ok(aClient())),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: MattersClient, useValue: matters },
        { provide: ClientsClient, useValue: clients },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(MatterFormPage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
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

  /** The "you will no longer see this matter" dialog (the page has two dialogs; each renders its own p-dialog). */
  function lossDialog(): HTMLElement {
    return Array.from(document.body.querySelectorAll<HTMLElement>('p-dialog')).find((d) =>
      d.querySelector('[data-loss-warning]'),
    )!;
  }

  async function pickClient(): Promise<void> {
    type('#matter-client', 'acme');
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    el()
      .querySelector('[role=option]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);
  }

  describe('create', () => {
    beforeEach(() => create({}, ['Matter.View', 'Matter.Create']));

    it('previews the combined reference live and saves the padded number', async () => {
      await pickClient();
      type('#matter-number', '12');
      fixture.detectChanges();
      expect(el().querySelector('[data-preview]')?.textContent).toContain(
        'Will be saved as 00012.',
      );
      expect(el().querySelector('[data-preview]')?.textContent).toContain(
        'Combined reference: 00343-00012',
      );

      type('#matter-number', '12', true);
      type('#matter-name', 'Merger Review');
      el().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      await submit();

      expect(matters.createMatter).toHaveBeenCalledWith({
        clientId: 1,
        matterNumber: '00012',
        name: 'Merger Review',
        isSensitive: true,
      });
      expect(navigate).toHaveBeenCalledWith(['/matters', 21]);
    });

    it('requires a client, a valid number and a name', async () => {
      await submit();

      const summary = el().querySelector('[data-summary]')!.textContent!;
      expect(summary).toContain('Select a client.');
      expect(summary).toContain('Enter a matter number.');
      expect(summary).toContain('Enter a matter name.');
      expect(matters.createMatter).not.toHaveBeenCalled();
    });

    it('marks inactive clients in the picker', async () => {
      type('#matter-client', 'a');
      await new Promise((r) => setTimeout(r, 300));
      await settle(fixture);

      expect(el().textContent).toContain('00001 Beta LLC');
      expect(el().querySelectorAll('mf-badge')).toHaveLength(1);
    });

    it('maps a duplicate matter number to the field and links to the existing matter', async () => {
      matters.createMatter.mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'DUPLICATE_NUMBER',
          errors: {
            matterNumber: [
              {
                code: 'DUPLICATE_NUMBER',
                message: 'Matter 00012 already exists for client 00343.',
              },
            ],
          },
          meta: { existingId: 5 },
        }),
      );
      await pickClient();
      type('#matter-number', '12', true);
      type('#matter-name', 'Dup');
      await submit();

      expect(el().querySelector('#matter-number-error')?.textContent).toContain(
        'Matter 00012 already exists for client 00343.',
      );
      expect(el().querySelector('[data-summary] a')?.getAttribute('href')).toBe('/matters/5');
    });

    it('shows the "needs a project manager" refusal next to the Sensitive checkbox', async () => {
      matters.createMatter.mockReturnValue(
        apiError(400, {
          status: 400,
          code: 'VALIDATION_FAILED',
          errors: {
            isSensitive: [
              {
                code: 'SENSITIVE_NEEDS_MANAGER',
                message:
                  'A sensitive matter needs a project manager, or be created by someone who can see all sensitive matters.',
              },
            ],
          },
        }),
      );
      await pickClient();
      type('#matter-number', '12', true);
      type('#matter-name', 'Secret');
      el().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      await submit();

      const box = el().querySelector<HTMLInputElement>('input[type=checkbox]')!;
      const error = el().querySelector('#matter-sensitive-error');
      expect(error?.textContent).toContain('needs a project manager');
      expect(box.getAttribute('aria-describedby')).toBe('matter-sensitive-error');
      expect(box.getAttribute('aria-invalid')).toBe('true');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('shows the inactive-client conflict on the client field', async () => {
      matters.createMatter.mockReturnValue(
        apiError(409, {
          status: 409,
          code: 'CLIENT_INACTIVE',
          errors: {
            clientId: [
              {
                code: 'CLIENT_INACTIVE',
                message: 'Client 00343 is inactive. Choose an active client.',
              },
            ],
          },
        }),
      );
      await pickClient();
      type('#matter-number', '12', true);
      type('#matter-name', 'N');
      await submit();

      expect(el().querySelector('#matter-client-error')?.textContent).toContain('is inactive');
    });
  });

  it('preselects the client when launched from a client page', async () => {
    await create({ clientId: '1' }, ['Matter.View', 'Matter.Create']);

    expect(clients.getClient).toHaveBeenCalledWith(1);
    expect(el().querySelector('[data-chosen]')?.textContent).toContain('00343 Acme Corp');
  });

  describe('edit', () => {
    it('locks client and number, and saves name and sensitivity with the row version', async () => {
      await create({ matterId: '7' }, ['Matter.View', 'Matter.Edit']);

      expect(el().querySelector('[data-locked-client]')?.textContent).toContain('00343');
      expect(el().querySelector('[data-locked-number]')?.textContent).toContain('00012');
      expect(el().querySelector('#matter-number')).toBeNull();
      expect(buttonByLabel(el(), 'Change number')).toBeUndefined();

      type('#matter-name', 'Renamed');
      el().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      await submit();

      expect(matters.updateMatter).toHaveBeenCalledWith(7, {
        name: 'Renamed',
        isSensitive: true,
        rowVersion: 'BBBB',
      });
    });

    it('asks "You will no longer see this matter" when marking would end the editor\'s own access, then repeats the save confirmed', async () => {
      await create({ matterId: '7' }, ['Matter.View', 'Matter.Edit']);
      matters.updateMatter
        .mockReturnValueOnce(
          apiError(409, {
            status: 409,
            code: 'SENSITIVE_CONFIRMATION_REQUIRED',
            meta: { willLoseAccess: true },
          }),
        )
        .mockReturnValueOnce(ok(aMatter({ isSensitive: true })));

      el().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      await submit();

      // No error text and no summary: the dialog is the answer, and nothing was saved yet.
      expect(el().querySelector('[data-summary]')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      const dialog = lossDialog();
      expect(dialog.textContent).toContain('You will no longer see this matter');
      expect(dialog.querySelector('[data-loss-warning]')?.textContent).toContain(
        'only its project managers',
      );

      buttonByLabel(dialog, 'Mark sensitive')!.click();
      await settle(fixture);

      expect(matters.updateMatter).toHaveBeenCalledTimes(2);
      expect(matters.updateMatter).toHaveBeenLastCalledWith(7, {
        name: 'Merger Review',
        isSensitive: true,
        confirmLossOfAccess: true,
        rowVersion: 'BBBB',
      });
      // The matter page would answer "not found" now: the editor goes to the list.
      expect(navigate).toHaveBeenCalledWith(['/matters']);
    });

    it('does not repeat the save when the person keeps the matter as it is', async () => {
      await create({ matterId: '7' }, ['Matter.View', 'Matter.Edit']);
      matters.updateMatter.mockReturnValueOnce(
        apiError(409, { status: 409, code: 'SENSITIVE_CONFIRMATION_REQUIRED' }),
      );

      el().querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      await submit();
      const dialog = lossDialog();
      buttonByLabel(dialog, 'Keep it as it is')!.click();
      await settle(fixture);

      expect(matters.updateMatter).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('changes the number behind a confirmation when permitted', async () => {
      await create({ matterId: '7' }, ['Matter.View', 'Matter.Edit', 'Matter.EditNumber']);

      buttonByLabel(el(), 'Change number')!.click();
      await settle(fixture);
      const dialog = document.body.querySelector('p-dialog') as HTMLElement;
      expect(dialog.querySelector('[data-number-warning]')?.textContent).toContain(
        'This change is recorded.',
      );
      const input = document.body.querySelector<HTMLInputElement>('#new-matter-number')!;
      input.value = '99';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      buttonByLabel(dialog, 'Change number')!.click();
      await settle(fixture);

      expect(matters.changeMatterNumber).toHaveBeenCalledWith(7, {
        number: '00099',
        rowVersion: 'BBBB',
      });
      expect(el().textContent).toContain('00343-00099');
    });
  });
});
