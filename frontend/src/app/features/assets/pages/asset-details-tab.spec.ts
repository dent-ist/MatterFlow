import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormsClient } from '../../../api/generated/api-client';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { aFormVersion, anAsset } from '../../../shared/testing/asset-testing';
import {
  FakeMeApi,
  ok,
  provideFakeMe,
  settle,
  withPermissions,
} from '../../../shared/testing/org-testing';
import { AssetDetailsTab } from './asset-details-tab';

describe('AssetDetailsTab', () => {
  let forms: { getFormVersionSchema: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<AssetDetailsTab>;
  const el = (): HTMLElement => fixture.nativeElement;

  async function create(permissions: Permission[], asset = anAsset()): Promise<void> {
    forms = { getFormVersionSchema: vi.fn().mockReturnValue(ok(aFormVersion())) };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        { provide: FormsClient, useValue: forms },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    fixture = TestBed.createComponent(AssetDetailsTab);
    fixture.componentRef.setInput('asset', asset);
    await settle(fixture);
  }

  it('has an Asset section and a "<Type> fields (n)" section with the stored values and the version', async () => {
    await create(['Asset.View', 'Matter.View', 'Client.View', 'Task.View']);

    expect(forms.getFormVersionSchema).toHaveBeenCalledWith(21);
    expect(el().querySelector('[data-section="asset"] h3')?.textContent).toContain('Asset');
    const fieldCount = aFormVersion().fields.length;
    expect(el().querySelector('[data-type-fields-title]')?.textContent?.replace(/\s+/g, ' ')).toBe(
      ` Document Set fields (${fieldCount}) `,
    );
    expect(el().querySelector('[data-type-fields]')?.textContent).toContain('WS-8841');
    expect(el().querySelector('[data-matter] a.mf-ref')?.getAttribute('href')).toBe('/matters/7');
    expect(el().querySelector('[data-external-reference] a')?.getAttribute('href')).toBe(
      'https://dms.example/folders/42',
    );
    expect(el().querySelector('[data-external-reference] button.mf-copy')).not.toBeNull();
    expect(el().textContent).toContain('First batch');
  });

  it('sends no schema request without Task.View or a form management permission and says so once (no vanished section)', async () => {
    await create(['Asset.View']);

    expect(forms.getFormVersionSchema).not.toHaveBeenCalled();
    expect(el().querySelector('[data-fields-unavailable]')?.textContent).toContain(
      'Type fields are not available with your access.',
    );
    expect(el().querySelector('[data-type-fields]')).toBeNull();
    expect(el().querySelector('[data-matter] a')).toBeNull(); // no Matter.View: plain text
    expect(el().querySelector('[data-matter] .mf-ref')?.textContent).toBe('00343-00012');
  });

  it('reads the schema with a form management permission instead of Task.View', async () => {
    await create(['Asset.View', 'AssetType.Manage']);
    expect(forms.getFormVersionSchema).toHaveBeenCalledTimes(1);
    expect(el().querySelector('[data-type-fields]')).not.toBeNull();
  });

  it('says there are no type-specific values for an asset whose type has no form, and asks nothing', async () => {
    await create(
      ['Asset.View', 'Task.View'],
      anAsset({ formVersionId: undefined, formValues: {} }),
    );
    expect(forms.getFormVersionSchema).not.toHaveBeenCalled();
    expect(el().querySelector('[data-no-fields]')).not.toBeNull();
    expect(el().querySelector('[data-fields-unavailable]')).toBeNull();
  });

  it('keeps the base details when the schema cannot be read', async () => {
    await create(['Asset.View', 'Task.View']);
    forms.getFormVersionSchema.mockImplementation(() => {
      throw new Error('boom');
    });
    fixture.componentRef.setInput('asset', anAsset({ formVersionId: 22 }));
    await settle(fixture);
    expect(el().querySelector('[data-details]')).not.toBeNull();
    expect(el().querySelector('[data-no-fields]')).not.toBeNull();
  });

  it('shows a plain text for a reference that is not a URL and omits Last changed when there is none', async () => {
    await create(
      ['Asset.View'],
      anAsset({ externalReference: 'REL-77', modifiedAtUtc: undefined }),
    );
    expect(el().querySelector('[data-external-reference] a')).toBeNull();
    expect(el().querySelector('[data-external-reference] .pg-mono')?.textContent).toBe('REL-77');
    expect(el().textContent).not.toContain('Last changed');
  });
});
