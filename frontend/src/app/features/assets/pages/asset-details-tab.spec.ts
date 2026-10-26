import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AssetsClient, FormsClient } from '../../../api/generated/api-client';
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
        {
          provide: AssetsClient,
          useValue: { getAssetDispositionHistory: vi.fn().mockReturnValue(ok({ items: [] })) },
        },
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

  describe('long text (#508)', () => {
    const long = 'A long description sentence. '.repeat(60);
    const heights = (scroll: number, client: number): void => {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get: () => scroll,
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => client,
      });
    };
    afterEach(() => {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)['scrollHeight'];
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)['clientHeight'];
    });

    it('clamps a long description at six lines with a Show more / Show less button (aria-expanded)', async () => {
      heights(400, 120);
      await create(['Asset.View'], anAsset({ description: long }));
      const box = el().querySelector<HTMLElement>('[data-description]')!;
      expect(box.classList.contains('ad__desc--clamped')).toBe(true);
      const toggle = el().querySelector<HTMLButtonElement>('[data-description-toggle]')!;
      expect(toggle.textContent?.trim()).toBe('Show more');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe('ad-description');

      toggle.click();
      await settle(fixture);
      expect(box.classList.contains('ad__desc--clamped')).toBe(false);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.textContent?.trim()).toBe('Show less');
      expect(box.textContent).toContain(long.trim());
    });

    it('offers no button when the description fits in six lines', async () => {
      heights(100, 100);
      await create(['Asset.View'], anAsset({ description: 'Short.' }));
      expect(el().querySelector('[data-description-toggle]')).toBeNull();
      expect(el().querySelector('[data-description]')?.textContent).toContain('Short.');
    });

    it('shows the external reference on one line with the whole value as tooltip and a copy button', async () => {
      const url = 'https://dms.example/' + 'folder/'.repeat(100);
      await create(['Asset.View'], anAsset({ externalReference: url }));
      const link = el().querySelector<HTMLElement>('[data-external-reference] .ad__ref-text')!;
      expect(link.getAttribute('title')).toBe(url);
      expect(
        el().querySelector('[data-external-reference] .ad__ref button.mf-copy'),
      ).not.toBeNull();
    });
  });
});
