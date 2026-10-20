import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ClientsClient, FormsClient, MattersClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { DOCUMENT_FIELDS, aFormVersion } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  aClient,
  aMatter,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { MatterFormPage } from './matter-form-page';

describe('MatterFormPage custom fields', () => {
  async function create(inputs: Record<string, string>, matter = aMatter()) {
    const matters = {
      getMatter: vi.fn().mockReturnValue(ok(matter)),
      getMatterCustomFieldForm: vi.fn().mockReturnValue(ok({ publishedFormVersionId: 21 })),
      createMatter: vi.fn().mockReturnValue(ok(aMatter({ matterId: 21 }))),
      updateMatter: vi.fn().mockReturnValue(ok(aMatter())),
    };
    const forms = {
      getFormVersionSchema: vi.fn().mockReturnValue(ok(aFormVersion(DOCUMENT_FIELDS))),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(
          new FakeMeApi(withPermissions('Matter.View', 'Matter.Create', 'Matter.Edit')),
        ),
        { provide: MattersClient, useValue: matters },
        { provide: ClientsClient, useValue: { getClient: vi.fn().mockReturnValue(ok(aClient())) } },
        { provide: FormsClient, useValue: forms },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await TestBed.inject(AuthStore).ensureLoaded();
    const fixture = TestBed.createComponent(MatterFormPage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await settle(fixture);
    return { fixture, matters, forms };
  }

  const submit = async (fixture: Awaited<ReturnType<typeof create>>['fixture']) => {
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await settle(fixture);
  };

  it('renders the published custom form on create and blocks saving while a required field is empty', async () => {
    const { fixture, matters } = await create({ clientId: '1' });

    expect(matters.getMatterCustomFieldForm).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-custom-fields]')?.textContent).toContain(
      'Workspace ID',
    );

    const number = fixture.nativeElement.querySelector('#matter-number') as HTMLInputElement;
    number.value = '12';
    number.dispatchEvent(new Event('input'));
    const name = fixture.nativeElement.querySelector('#matter-name') as HTMLInputElement;
    name.value = 'Merger';
    name.dispatchEvent(new Event('input'));
    await settle(fixture);
    await submit(fixture);

    expect(fixture.nativeElement.querySelector('[data-summary]')?.textContent).toContain(
      'Workspace ID: Enter workspace ID.',
    );
    expect(matters.createMatter).not.toHaveBeenCalled();
  });

  it('sends the custom values as a patch on edit and shows stored values', async () => {
    const { fixture, matters } = await create(
      { matterId: '7' },
      aMatter({
        formVersionId: 21,
        publishedFormVersionId: 21,
        formValues: { workspace_id: 'WS-1', notes: 'old' },
      }),
    );
    const workspace = fixture.nativeElement.querySelector(
      '[data-custom-fields] input[type=text]',
    ) as HTMLInputElement;
    expect(workspace.value).toBe('WS-1');

    workspace.value = 'WS-2';
    workspace.dispatchEvent(new Event('input'));
    await settle(fixture);
    await submit(fixture);

    expect(matters.updateMatter).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ formValues: expect.objectContaining({ workspace_id: 'WS-2' }) }),
    );
  });
});
