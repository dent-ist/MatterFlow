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
import { MatterCreatePage } from './matter-create-page';

describe('MatterCreatePage: New Matter as a full page (epic #1368, #1371)', () => {
  let matters: Record<'createMatter' | 'getMatterCustomFieldForm', ReturnType<typeof vi.fn>>;
  let clients: Record<'listClients' | 'getClient', ReturnType<typeof vi.fn>>;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<MatterCreatePage>;
  const el = (): HTMLElement => fixture.nativeElement;
  const view = (id: number, name: string, sortOrder: number) => ({
    id,
    name,
    sortOrder,
    isActive: true,
    rowVersion: 'x',
    inUseCount: 0,
  });

  async function open(inputs: Record<string, string> = {}) {
    matters = {
      createMatter: vi.fn().mockReturnValue(ok(aMatter({ matterId: 21 }))),
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
        provideFakeMe(new FakeMeApi(withPermissions('Matter.View', 'Matter.Create'))),
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
    fixture = TestBed.createComponent(MatterCreatePage);
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
});
