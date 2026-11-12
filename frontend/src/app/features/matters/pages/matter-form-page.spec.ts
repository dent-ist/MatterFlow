import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  ClientsClient,
  MatterCategoriesClient,
  MatterTypesClient,
  MattersClient,
} from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
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

describe('MatterFormPage: New and Edit Matter as full pages (epic #1368, #1371, #1381)', () => {
  let matters: Record<
    | 'createMatter'
    | 'updateMatter'
    | 'getMatter'
    | 'changeMatterNumber'
    | 'getMatterCustomFieldForm',
    ReturnType<typeof vi.fn>
  >;
  let clients: Record<'listClients' | 'getClient', ReturnType<typeof vi.fn>>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<MatterFormPage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const view = (id: number, name: string, sortOrder: number) => ({
    id,
    name,
    sortOrder,
    isActive: true,
    rowVersion: 'x',
    inUseCount: 0,
  });

  async function open(
    inputs: Record<string, string> = {},
    editing = aMatter({
      matterTypes: [{ id: 1, name: 'Litigation', isActive: true }],
      matterCategory: { id: 4, name: 'Advisory', isActive: true },
    }),
  ) {
    matters = {
      createMatter: vi.fn().mockReturnValue(ok(aMatter({ matterId: 21 }))),
      updateMatter: vi.fn().mockReturnValue(ok(aMatter())),
      changeMatterNumber: vi
        .fn()
        .mockReturnValue(ok(aMatter({ matterNumber: '00099', matterRef: '00343-00099' }))),
      getMatter: vi.fn().mockReturnValue(ok(editing)),
      getMatterCustomFieldForm: vi.fn().mockReturnValue(ok({})),
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
        provideFakeMe(
          new FakeMeApi(
            withPermissions('Matter.View', 'Matter.Create', 'Matter.Edit', 'Matter.EditNumber'),
          ),
        ),
        { provide: MattersClient, useValue: matters },
        { provide: ClientsClient, useValue: clients },
        {
          provide: MatterTypesClient,
          useValue: {
            listMatterTypes: vi
              .fn()
              .mockReturnValue(ok([view(1, 'Litigation', 1), view(2, 'Investigation', 2)])),
          },
        },
        {
          provide: MatterCategoriesClient,
          useValue: { listMatterCategories: vi.fn().mockReturnValue(ok([view(4, 'Advisory', 1)])) },
        },
      ],
    });
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true) as never;
    navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true) as never;
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

  async function pickClient(): Promise<void> {
    type('#matter-client', 'acme');
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    el()
      .querySelector('[role=option]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await settle(fixture);
  }

  const dropdownOption = (value: string) =>
    document.body.querySelector<HTMLElement>(`.dd-panel [role="option"][data-value="${value}"]`)!;

  it('is a page, not a pop-up: heading New Matter, the matter form, Cancel and Create Matter', async () => {
    await open();
    expect(el().querySelector('h1')?.textContent).toContain('New Matter');
    expect(document.body.querySelector('.mf-formdlg')).toBeNull();
    expect(el().querySelector('mf-matter-form')).not.toBeNull();
    expect(buttonByLabel(el(), 'Cancel')).toBeDefined();
    expect(buttonByLabel(el(), 'Create Matter')).toBeDefined();
    const labels = Array.from(el().querySelectorAll('.mf-label, .mf-field__label')).map((l) =>
      l
        .textContent!.replace(/\(required\)/, '')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    expect(labels).toEqual([
      'Client',
      'Matter Number',
      'CM Number',
      'Matter Name',
      'AI Allowed',
      'Matter Types',
      'Matter Category',
      'Current State',
      'DMS Path',
      'DFS Path',
    ]);
  });

  it('shows the CM Number live from the client and the matter number', async () => {
    await open();
    await pickClient();
    type('#matter-number', '12');
    await settle(fixture);
    expect(el().querySelector('[data-cm-value]')?.textContent).toBe('00343-00012');
  });

  it('requires a client, a valid number and a name, with the same messages as the pop-up had', async () => {
    await open();
    await submit();
    const summary = el().querySelector('[data-summary]')!.textContent!;
    expect(summary).toContain('Select a client.');
    expect(summary).toContain('Enter a matter number.');
    expect(summary).toContain('Enter a matter name.');
    expect(matters.createMatter).not.toHaveBeenCalled();
  });

  it('creates with several Matter Types and one Matter Category and opens the new matter', async () => {
    await open();
    await pickClient();
    type('#matter-number', '12', true);
    type('#matter-name', 'Merger Review');
    // Matter Types: a multi-select, two chosen.
    (el().querySelector('#matter-type') as HTMLButtonElement).click();
    await settle(fixture);
    dropdownOption('2').click();
    dropdownOption('1').click();
    await settle(fixture);
    (document.body.querySelector('[data-dd-done]') as HTMLElement).click();
    await settle(fixture);
    expect(el().querySelector('#matter-type')?.textContent).toContain('Litigation +1');
    // Matter Category: a single choice.
    (el().querySelector('#matter-category') as HTMLButtonElement).click();
    await settle(fixture);
    dropdownOption('4').click();
    await settle(fixture);
    buttonByLabel(el(), 'Create Matter')!.click();
    await settle(fixture);

    expect(matters.createMatter).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 1,
        matterNumber: '00012',
        name: 'Merger Review',
        isSensitive: false,
        aiAllowed: 'No',
        matterTypeIds: [1, 2],
        matterCategoryId: 4,
        currentStateId: undefined,
      }),
    );
    expect(navigate).toHaveBeenCalledWith(['/matters', 21]);
  });

  it('marks inactive clients in the picker', async () => {
    await open();
    type('#matter-client', 'a');
    await new Promise((r) => setTimeout(r, 300));
    await settle(fixture);
    expect(el().textContent).toContain('00001 Beta LLC');
    expect(el().querySelectorAll('mf-badge')).toHaveLength(1);
  });

  it('maps a duplicate matter number to the field and links to the existing matter', async () => {
    await open();
    matters.createMatter.mockReturnValue(
      apiError(409, {
        status: 409,
        code: 'DUPLICATE_NUMBER',
        errors: {
          matterNumber: [
            { code: 'DUPLICATE_NUMBER', message: 'Matter 00012 already exists for client 00343.' },
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
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the "needs a project manager" refusal next to the Sensitive checkbox', async () => {
    await open();
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
    expect(el().querySelector('#matter-sensitive-error')?.textContent).toContain(
      'needs a project manager',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preselects the client when opened from a client page (?clientId=)', async () => {
    await open({ clientId: '1' });
    expect(clients.getClient).toHaveBeenCalledWith(1);
    expect(el().querySelector('[data-chosen]')?.textContent).toContain('00343 Acme Corp');
  });

  it('Cancel goes to the Matters list when the page was opened directly', async () => {
    await open();
    buttonByLabel(el(), 'Cancel')!.click();
    await settle(fixture);
    expect(navigateByUrl).toHaveBeenCalledWith('/matters');
  });

  it('asks before leaving with typed values, not before leaving an untouched form', async () => {
    await open();
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    type('#matter-name', 'Typed');
    await settle(fixture);
    expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
  });

  describe('edit (#1381)', () => {
    it('loads the matter into the same form: heading Edit Matter, client and number locked, Save Changes', async () => {
      await open({ matterId: '7' });
      expect(matters.getMatter).toHaveBeenCalledWith(7);
      expect(el().querySelector('h1')?.textContent).toContain('Edit Matter');
      expect(el().querySelector('[data-matter-form] #matter-number')).not.toBeNull();
      expect((el().querySelector('#matter-number') as HTMLInputElement).disabled).toBe(true);
      expect(el().querySelector('[data-cm-value]')?.textContent).toBe('00343-00012');
      expect(buttonByLabel(el(), 'Save Changes')).toBeDefined();
      expect(buttonByLabel(el(), 'Create Matter')).toBeUndefined();
      expect(el().querySelector('#matter-type')?.textContent).toContain('Litigation');
      expect(el().querySelector('#matter-category')?.textContent).toContain('Advisory');
      expect(document.body.querySelector('.mf-formdlg')).toBeNull();
    });

    it('saves the Matter Types as a full set and the Matter Category as one id, then returns to the matter page', async () => {
      await open({ matterId: '7' });
      (el().querySelector('#matter-type') as HTMLButtonElement).click();
      await settle(fixture);
      dropdownOption('2').click();
      await settle(fixture);
      expect(el().querySelector('#matter-type')?.textContent).toContain('Litigation +1');
      buttonByLabel(el(), 'Save Changes')!.click();
      await settle(fixture);
      expect(matters.updateMatter).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ matterTypeIds: [1, 2], matterCategoryId: 4 }),
      );
      expect(navigateByUrl).toHaveBeenCalledWith('/matters/7');
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('clears the Matter Types when none is chosen (an empty list is the full value)', async () => {
      await open({ matterId: '7' });
      (el().querySelector('#matter-type') as HTMLButtonElement).click();
      await settle(fixture);
      dropdownOption('1').click();
      await settle(fixture);
      buttonByLabel(el(), 'Save Changes')!.click();
      await settle(fixture);
      expect(matters.updateMatter).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ matterTypeIds: [] }),
      );
    });

    it('asks before leaving with a changed name; Cancel goes to the matter page when opened directly', async () => {
      await open({ matterId: '7' });
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
      type('#matter-name', 'Renamed');
      await settle(fixture);
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
      buttonByLabel(el(), 'Cancel')!.click();
      await settle(fixture);
      expect(navigateByUrl).toHaveBeenCalledWith('/matters/7');
      expect(matters.updateMatter).not.toHaveBeenCalled();
    });

    it('shows a retry when the matter cannot be loaded', async () => {
      await open({}, aMatter());
      TestBed.resetTestingModule();
      matters.getMatter = vi.fn();
      // A second page with a failing load.
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Matter.Edit'))),
          {
            provide: MattersClient,
            useValue: {
              getMatter: vi.fn().mockReturnValue(apiError(500, { status: 500, code: 'X' })),
            },
          },
        ],
      });
      await TestBed.inject(AuthStore).ensureLoaded();
      const failing = TestBed.createComponent(MatterFormPage);
      failing.componentRef.setInput('matterId', '7');
      await settle(failing);
      expect(failing.nativeElement.textContent).toContain("We couldn't load that.");
      expect(buttonByLabel(failing.nativeElement, 'Retry')).toBeDefined();
    });

    it('unlocks the matter number after a confirmation and confirms the exact result on Save (MD-43, #1061)', async () => {
      await open({ matterId: '7' });
      const number = () => el().querySelector<HTMLInputElement>('#matter-number')!;
      expect(number().disabled).toBe(true);
      el().querySelector<HTMLButtonElement>('[data-change-number]')!.click();
      await settle(fixture);
      const confirm = () =>
        Array.from(
          document.body.querySelectorAll<HTMLButtonElement>(
            '[data-confirm-primary] button, button[data-confirm-primary]',
          ),
        );
      confirm().at(-1)!.click();
      await settle(fixture);
      expect(number().disabled).toBe(false);
      type('#matter-number', '99');
      await settle(fixture);
      expect(el().querySelector('[data-cm-value]')!.textContent).toBe('00343-00099');
      buttonByLabel(el(), 'Save Changes')!.click();
      await settle(fixture);
      expect(
        document.body.querySelector('[data-number-change-body]')!.textContent!.replace(/\s+/g, ' '),
      ).toContain('The CM Number changes from 00343-00012 to 00343-00099,');
      expect(matters.changeMatterNumber).not.toHaveBeenCalled();
      confirm().at(-1)!.click();
      await settle(fixture);
      expect(matters.changeMatterNumber).toHaveBeenCalledWith(7, {
        number: '99',
        rowVersion: 'BBBB',
      });
      expect(matters.updateMatter).toHaveBeenCalled();
    });
  });
});
