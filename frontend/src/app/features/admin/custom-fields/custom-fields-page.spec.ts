import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CustomFieldFormState,
  CustomFieldFormSummary,
  FormDefinitionModel,
  FormOwnerKind,
  FormVersionStatus,
  FormsClient,
} from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { aFormVersion } from '../../../shared/testing/asset-testing';
import { apiError, ok, settle } from '../../../shared/testing/org-testing';
import { CustomFieldFormDesignerApi } from './custom-field-form-designer-api';
import { CustomFieldsPage } from './custom-fields-page';

const definition = (
  kind: FormOwnerKind,
  versions: { id: number; no: number; status: FormVersionStatus }[],
  draftVersionId?: number,
): FormDefinitionModel => ({
  formDefinitionId: 100 + kind.length,
  ownerKind: kind,
  ownerId: undefined,
  isActive: true,
  publishedVersionId: versions.find((v) => v.status === FormVersionStatus.Published)?.id,
  draftVersionId,
  versions: versions.map((v) => ({
    ...aFormVersion().version,
    formVersionId: v.id,
    versionNo: v.no,
    status: v.status,
  })),
});

const summary = (
  kind: FormOwnerKind,
  over: Partial<CustomFieldFormSummary> = {},
): CustomFieldFormSummary => ({
  ownerKind: kind,
  state: CustomFieldFormState.None,
  formId: undefined,
  fieldCount: 0,
  requiredCount: 0,
  publishedVersion: undefined,
  publishedAtUtc: undefined,
  publishedByName: undefined,
  draftVersion: undefined,
  draftFieldCount: 0,
  ...over,
});

describe('CustomFieldsPage (#644)', () => {
  let fixture: ComponentFixture<CustomFieldsPage>;
  let forms: Record<'listCustomFieldForms' | 'ensureFormDefinition', ReturnType<typeof vi.fn>>;
  const el = (): HTMLElement => fixture.nativeElement;
  const row = (name: string): HTMLElement => el().querySelector(`tr[data-row="${name}"]`)!;

  async function open(
    permissions: Permission[] = ['CustomField.Manage', 'Audit.View'],
    answer: unknown = ok([
      summary(FormOwnerKind.Client),
      summary(FormOwnerKind.Matter, {
        state: CustomFieldFormState.Published,
        formId: 7,
        fieldCount: 8,
        requiredCount: 2,
        publishedVersion: 2,
        publishedAtUtc: '2026-10-12T15:00:00Z',
        publishedByName: 'Kim Lee',
        draftVersion: 3,
      }),
      summary(FormOwnerKind.Project, {
        state: CustomFieldFormState.Draft,
        formId: 9,
        draftVersion: 1,
        draftFieldCount: 4,
      }),
    ]),
  ): Promise<void> {
    forms = {
      listCustomFieldForms: vi.fn().mockReturnValue(answer),
      ensureFormDefinition: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: FormsClient, useValue: forms },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(CustomFieldsPage);
    await settle(fixture);
  }

  it('reads once and never writes: no provisioning call on view', async () => {
    await open();
    expect(forms.listCustomFieldForms).toHaveBeenCalledTimes(1);
    expect(forms.ensureFormDefinition).not.toHaveBeenCalled();
  });

  it('lists Client, Matter and Project with the Object as the one link to the designer', async () => {
    await open();
    expect(
      Array.from(el().querySelectorAll('[data-objects] tbody tr[data-row]')).map((r) =>
        r.getAttribute('data-row'),
      ),
    ).toEqual(['Client', 'Matter', 'Project']);
    for (const [name, key] of [
      ['Client', 'client'],
      ['Matter', 'matter'],
      ['Project', 'project'],
    ]) {
      expect(row(name).querySelectorAll('a')).toHaveLength(1);
      expect(row(name).querySelector('a')!.getAttribute('href')).toBe(
        `/admin/custom-fields/${key}/form`,
      );
    }
  });

  it('shows the three states: none, published with a draft, only a draft', async () => {
    await open();
    expect(row('Client').querySelector('[data-fields]')!.textContent).toContain('No fields yet');
    expect(row('Client').querySelector('[data-published]')!.textContent).toContain('Not published');
    expect(row('Client').querySelector('[data-status]')!.textContent).toContain(
      'No published fields',
    );

    expect(row('Matter').querySelector('[data-fields]')!.textContent).toContain(
      '8 fields, 2 required',
    );
    const published = row('Matter').querySelector('[data-published]')!;
    expect(published.textContent!.replace(/\s+/g, ' ')).toContain('v2');
    expect(published.textContent).toContain('Oct 12');
    expect(published.getAttribute('title')).toBe('Published by Kim Lee');
    const status = row('Matter').querySelector('[data-status]')!.textContent!;
    expect(status).toContain('Published v2');
    expect(status).toContain('Draft v3');

    expect(row('Project').querySelector('[data-fields]')!.textContent).toContain('No fields yet');
    expect(row('Project').querySelector('[data-status]')!.textContent).toContain('Draft v1');
  });

  it('has Edit fields and History in one menu per row, and says on screen why History is not available without a form', async () => {
    await open();
    row('Client').querySelector<HTMLButtonElement>('button[data-overflow]')!.click();
    await settle(fixture);
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]'));
    expect(items.map((i) => i.getAttribute('data-action'))).toEqual(['fields', 'history']);
    expect(items[1].getAttribute('aria-disabled')).toBe('true');
    expect(items[1].textContent).toContain('No fields have been added yet.');
  });

  it('has no History without Audit.View', async () => {
    await open(['CustomField.Manage']);
    row('Matter').querySelector<HTMLButtonElement>('button[data-overflow]')!.click();
    await settle(fixture);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('[role=menuitem]')).map((i) =>
        i.getAttribute('data-action'),
      ),
    ).toEqual(['fields']);
  });

  it('shows one error with Retry that reads again, and no 403 retry', async () => {
    await open(undefined, apiError(500, { title: 'Error', status: 500 }));
    expect(el().querySelector('[data-error]')).not.toBeNull();
    forms.listCustomFieldForms.mockReturnValue(ok([summary(FormOwnerKind.Client)]));
    el().querySelector<HTMLButtonElement>('[data-error] button')!.click();
    await settle(fixture);
    expect(el().querySelectorAll('[data-objects] tbody tr[data-row]')).toHaveLength(3);
    expect(forms.ensureFormDefinition).not.toHaveBeenCalled();
  });
});

describe('CustomFieldFormDesignerApi', () => {
  it('provisions the singleton definition and uses it for the object key', async () => {
    const forms = {
      ensureFormDefinition: vi.fn().mockReturnValue(ok(definition(FormOwnerKind.Matter, []))),
      listFormVersions: vi.fn().mockReturnValue(ok([])),
    };
    TestBed.configureTestingModule({
      providers: [CustomFieldFormDesignerApi, { provide: FormsClient, useValue: forms }],
    });
    const api = TestBed.inject(CustomFieldFormDesignerApi);

    expect(await firstValueFrom(api.getOwner('matter'))).toEqual({
      id: 'matter',
      name: 'Matter custom fields',
      crumb: 'Matter',
    });
    await firstValueFrom(api.listVersions('matter'));

    expect(forms.ensureFormDefinition).toHaveBeenCalledWith({ ownerKind: FormOwnerKind.Matter });
    expect(forms.listFormVersions).toHaveBeenCalledWith(100 + FormOwnerKind.Matter.length);
  });
});
