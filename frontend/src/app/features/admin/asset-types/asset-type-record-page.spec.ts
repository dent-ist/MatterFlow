import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AssetTypesClient, FormsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
import { anAssetType } from '../../../shared/testing/asset-testing';
import { apiError, ok } from '../../../shared/testing/org-testing';
import { AssetTypeRecordPage, assetTypeTabOf } from './asset-type-record-page';

type Mock = ReturnType<typeof vi.fn>;

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  await fixture.whenStable();
}

describe('assetTypeTabOf', () => {
  it('opens Overview unless the address names Fields, or Assets for a person who may see assets; a new type has Overview only', () => {
    expect(assetTypeTabOf(undefined, false, true)).toBe('overview');
    expect(assetTypeTabOf('fields', false, false)).toBe('fields');
    expect(assetTypeTabOf('assets', false, true)).toBe('assets');
    expect(assetTypeTabOf('assets', false, false)).toBe('overview');
    expect(assetTypeTabOf('fields', true, true)).toBe('overview');
    expect(assetTypeTabOf('nonsense', false, true)).toBe('overview');
  });
});

describe('AssetTypeRecordPage', () => {
  let fixture: ComponentFixture<AssetTypeRecordPage>;
  let api: Record<
    | 'getAssetType'
    | 'createAssetType'
    | 'updateAssetType'
    | 'setAssetTypeSizeField'
    | 'reindexAssetType',
    Mock
  >;
  let forms: Record<'findFormDefinition' | 'getPublishedFormVersion', Mock>;
  let navigate: Mock;
  const el = (): HTMLElement => fixture.nativeElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => el().querySelector<T>(sel)!;
  const all = (sel: string): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>(sel));

  const published = (over = {}) =>
    anAssetType({
      assetTypeId: 4,
      assetCount: 12,
      fieldCount: 8,
      publishedAtUtc: '2026-10-12T15:00:00Z',
      draftVersionNo: undefined,
      ...over,
    });

  async function open(
    id?: string,
    tab?: string,
    permissions: Permission[] = ['AssetType.Manage', 'Asset.View', 'Audit.View'],
    type = published(),
    answer: unknown = ok(type),
  ): Promise<void> {
    api = {
      getAssetType: vi.fn().mockReturnValue(answer),
      createAssetType: vi
        .fn()
        .mockReturnValue(ok(anAssetType({ assetTypeId: 9, name: 'Data Room' }))),
      updateAssetType: vi.fn().mockReturnValue(ok(anAssetType({ name: 'Document Bundle' }))),
      setAssetTypeSizeField: vi
        .fn()
        .mockReturnValue(ok(anAssetType({ sizeFieldKey: 'volume_gb', sizeUnit: 'GB' }))),
      reindexAssetType: vi.fn().mockReturnValue(ok({ assetsProcessed: 3 })),
    };
    forms = {
      findFormDefinition: vi.fn().mockReturnValue(ok({ formDefinitionId: 31 })),
      getPublishedFormVersion: vi.fn().mockReturnValue(
        ok({
          fields: [
            { key: 'format', label: 'Format', control: 'SELECT' },
            { key: 'volume_gb', label: 'Volume (GB)', control: 'NUMBER' },
            { key: 'pages', label: 'Pages', control: 'NUMBER' },
          ],
        }),
      ),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AssetTypesClient, useValue: api },
        { provide: FormsClient, useValue: forms },
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as never;
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(AssetTypeRecordPage);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    if (tab !== undefined) fixture.componentRef.setInput('tab', tab);
    await settle(fixture);
  }

  async function type(sel: string, value: string): Promise<void> {
    const field = q<HTMLInputElement>(sel);
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
  }

  async function save(): Promise<void> {
    q<HTMLButtonElement>('[data-save]').click();
    el().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  describe('the record (#635)', () => {
    beforeEach(() => open('4'));

    it('shows the name, Active, Edit and the primary Edit fields, with no footer while nothing changed', () => {
      expect(q('[data-page-title]').textContent).toContain('Document Set');
      expect(q('[data-status-badge], mf-active-badge').textContent).toContain('Active');
      const ids = all('[data-page-actions] button[data-action]').map((b) =>
        b.getAttribute('data-action'),
      );
      expect(ids[ids.length - 1]).toBe('edit-fields');
      expect(ids).toContain('edit');
      expect(el().querySelector('[data-footer]')).toBeNull();
      expect(q<HTMLInputElement>('#at-name').value).toBe('Document Set');
      expect(q<HTMLTextAreaElement>('#at-description').value).toBe('Sets of documents');
    });

    it('names the page in the crumb as Administration > Asset Types and keeps the counters under the fields', () => {
      const trail = all('nav li').map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
      expect(trail.slice(0, 2)).toEqual(['Administration', 'Asset Types']);
      expect(q('[data-crumb-current]').textContent).toContain('Document Set');
      expect(el().textContent).toContain('12 / 100');
      expect(el().textContent).toContain('17 / 500');
    });

    it('has Overview, Fields (8) and Assets (12) tabs with live counts', () => {
      expect(all('[role=tab]').map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
        'Overview',
        'Fields (8)',
        'Assets (12)',
      ]);
      expect(q('[role=tab][aria-selected=true]').getAttribute('data-tab')).toBe('overview');
    });

    it('shows the footer only after an edit; Cancel puts the saved text back', async () => {
      await type('#at-name', 'Changed');
      expect(q('[data-footer]')).not.toBeNull();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(true);
      q<HTMLButtonElement>('[data-cancel]').click();
      await settle(fixture);
      expect(q<HTMLInputElement>('#at-name').value).toBe('Document Set');
      expect(el().querySelector('[data-footer]')).toBeNull();
      expect(fixture.componentInstance.hasUnsavedChanges()).toBe(false);
    });

    it('saves with the row version and the unchanged order and state', async () => {
      await type('#at-name', ' Document Bundle ');
      await save();
      expect(api.updateAssetType).toHaveBeenCalledWith(4, {
        name: 'Document Bundle',
        description: 'Sets of documents',
        sortOrder: 10,
        isActive: true,
        rowVersion: 'TTTT',
      });
      expect(el().querySelector('[data-footer]')).toBeNull();
    });

    it('has a colour choice with a live solid chip preview and saves the colour (UI-22)', async () => {
      const select = q<HTMLSelectElement>('[data-colour-select]');
      expect(select.options).toHaveLength(11);
      expect(q('[data-preview]').getAttribute('data-colour')).toBeTruthy();
      select.value = 'rose';
      select.dispatchEvent(new Event('change'));
      await settle(fixture);
      expect(q('[data-preview]').getAttribute('data-colour')).toBe('rose');
      await save();
      expect(api.updateAssetType).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ colourKey: 'rose' }),
      );
    });

    it('shows a duplicate name as a field error with the summary at the top and focus on Name', async () => {
      api.updateAssetType.mockReturnValue(
        apiError(409, {
          title: 'Conflict',
          status: 409,
          code: 'DUPLICATE_NAME',
          errors: {
            name: [{ code: 'DUPLICATE_NAME', message: "An asset type named 'X' already exists." }],
          },
        }),
      );
      await type('#at-name', 'X');
      await save();
      expect(q('[data-summary]').textContent).toContain('already exists');
      expect(q('#at-name').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(q('#at-name'));
    });

    it('offers Reload the latest version after a conflict', async () => {
      api.updateAssetType.mockReturnValue(
        apiError(409, { title: 'Conflict', status: 409, code: 'CONCURRENCY_CONFLICT' }),
      );
      await type('#at-name', 'X');
      await save();
      expect(q('[data-conflict]').textContent).toContain('Someone else changed this asset type');
      q<HTMLButtonElement>('[data-reload]').click();
      await settle(fixture);
      expect(api.getAssetType).toHaveBeenCalledTimes(2);
    });

    it('asks before another tab drops an edit: Stay keeps it', async () => {
      const ask = vi.spyOn(TestBed.inject(LeaveConfirmService), 'ask').mockResolvedValue(false);
      await type('#at-name', 'Half typed');
      q<HTMLElement>('[role=tab][data-tab="fields"]').click();
      await settle(fixture);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(navigate).not.toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'fields' } }),
      );
      expect(q<HTMLInputElement>('#at-name').value).toBe('Half typed');
    });

    it('opens the designer from Edit fields and carries the list address', async () => {
      q<HTMLElement>('[data-action="edit-fields"]').click();
      await settle(fixture);
      expect(navigate).toHaveBeenCalledWith(
        ['/admin/asset-types', 4, 'form'],
        expect.objectContaining({ state: expect.objectContaining({ keepRow: true }) }),
      );
    });

    it('asks before Deactivate with the impact line and saves the state only', async () => {
      q<HTMLButtonElement>('[data-page-actions] button[data-overflow]').click();
      await settle(fixture);
      q<HTMLElement>('[role=menuitem][data-action="deactivate"]').click();
      await settle(fixture);
      expect(document.body.textContent).toContain('Deactivate asset type?');
      expect(document.body.textContent).toContain('12 assets keep this type.');
      const confirm = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Deactivate asset type' && b.closest('.p-dialog'),
      );
      confirm!.click();
      await settle(fixture);
      expect(api.updateAssetType).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ isActive: false, name: 'Document Set', rowVersion: 'TTTT' }),
      );
    });
  });

  describe('the Fields and Assets tabs (#636)', () => {
    it('summarises the published form and the open draft, with Edit fields', async () => {
      await open('4', 'fields', undefined, published({ draftVersionNo: 3 }));
      const text = q('[data-fields-tab]').textContent!.replace(/\s+/g, ' ');
      expect(text).toContain('Published v2');
      expect(text).toContain('8 fields');
      expect(text).toContain('Last published Oct 12, 2026.');
      expect(text).toContain('Draft v3');
      expect(q('[data-form-draft]').textContent).toContain('Draft v3 is in progress.');
      expect(el().querySelector('[data-no-fields]')).toBeNull();
      expect(q('[data-open-fields]').textContent).toContain('Edit fields');
    });

    it('says so, neutrally, when nothing is published', async () => {
      await open(
        '4',
        'fields',
        undefined,
        published({
          publishedFormVersionId: undefined,
          publishedFormVersionNo: undefined,
          fieldCount: undefined,
          publishedAtUtc: undefined,
        }),
      );
      expect(q('[data-no-fields]').textContent).toContain('no published fields');
      expect(q('[data-open-fields]').textContent).toContain('Create fields');
      expect(all('[role=tab]').map((t) => t.textContent!.replace(/\s+/g, ' ').trim())[1]).toBe(
        'Fields',
      );
    });

    it('counts the assets and links to the Assets list filtered by the type', async () => {
      await open('4', 'assets');
      expect(q('[data-asset-count]').textContent!.replace(/\s+/g, ' ')).toContain(
        '12 assets have this type.',
      );
      expect(q('[data-assets-link]').getAttribute('href')).toBe('/assets?typeId=4');
    });

    it('has no Assets tab without Asset.View, and its address opens Overview', async () => {
      await open('4', 'assets', ['AssetType.Manage'], published({ assetCount: undefined }));
      expect(all('[role=tab]').map((t) => t.textContent!.trim())).toEqual([
        'Overview',
        'Fields (8)',
      ]);
      expect(el().querySelector('[data-assets-tab]')).toBeNull();
      expect(el().querySelector('[data-overview-tab]')).not.toBeNull();
    });

    it('has no Activity button without Audit.View', async () => {
      await open('4', undefined, ['AssetType.Manage']);
      expect(el().querySelector('[data-action="activity"]')).toBeNull();
    });
  });

  describe('the Size card (epic #851, issue #867)', () => {
    const sizeField = (): HTMLSelectElement => q<HTMLSelectElement>('[data-size-field]');
    const sizeUnit = (): HTMLSelectElement => q<HTMLSelectElement>('[data-size-unit]');
    const pick = async (select: HTMLSelectElement, value: string): Promise<void> => {
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await settle(fixture);
    };

    it('offers only the number fields of the published form and suggests the unit from the key', async () => {
      await open('4', 'fields');
      expect(Array.from(sizeField().options).map((o) => o.textContent!.trim())).toEqual([
        'None',
        'Volume (GB)',
        'Pages',
      ]);
      expect(q<HTMLButtonElement>('[data-size-save]').disabled).toBe(true);
      await pick(sizeField(), 'volume_gb');
      expect(sizeUnit().value).toBe('GB');
      await pick(sizeField(), 'pages');
      expect(sizeUnit().value).toBe('GB'); // an already chosen unit is kept
      expect(q<HTMLButtonElement>('[data-size-save]').disabled).toBe(false);
    });

    it('saves the field and unit with the row version and shows the saved choice', async () => {
      await open('4', 'fields');
      await pick(sizeField(), 'volume_gb');
      q<HTMLButtonElement>('[data-size-save]').click();
      await settle(fixture);
      expect(api.setAssetTypeSizeField).toHaveBeenCalledWith(4, {
        sizeFieldKey: 'volume_gb',
        sizeUnit: 'GB',
        rowVersion: 'TTTT',
      });
      expect(sizeField().value).toBe('volume_gb');
      expect(q<HTMLButtonElement>('[data-size-save]').disabled).toBe(true);
    });

    it('clears the designation when None is chosen', async () => {
      await open('4', 'fields', undefined, published({ sizeFieldKey: 'pages', sizeUnit: 'Items' }));
      expect(sizeField().value).toBe('pages');
      await pick(sizeField(), '');
      expect(sizeUnit().value).toBe('');
      q<HTMLButtonElement>('[data-size-save]').click();
      await settle(fixture);
      expect(api.setAssetTypeSizeField).toHaveBeenCalledWith(4, {
        sizeFieldKey: undefined,
        sizeUnit: undefined,
        rowVersion: 'TTTT',
      });
    });

    it('shows the server message for a refused field', async () => {
      await open('4', 'fields');
      api.setAssetTypeSizeField.mockReturnValue(
        apiError(400, {
          title: 'Bad Request',
          status: 400,
          code: 'VALIDATION_FAILED',
          errors: {
            sizeFieldKey: [{ code: 'INVALID', message: 'The size field must be a number field.' }],
          },
        }),
      );
      await pick(sizeField(), 'volume_gb');
      q<HTMLButtonElement>('[data-size-save]').click();
      await settle(fixture);
      expect(q('[data-size-error]').textContent).toContain('must be a number field');
    });

    it('rebuilds the index and says how many assets were read', async () => {
      await open('4', 'fields');
      q<HTMLButtonElement>('[data-reindex]').click();
      await settle(fixture);
      expect(api.reindexAssetType).toHaveBeenCalledWith(4);
      expect(el().textContent).toContain('Index rebuilt for 3 assets.');
    });

    it('asks to publish the fields first when the type has no published form', async () => {
      await open('4', 'fields', undefined, published({ publishedFormVersionNo: undefined }));
      expect(el().querySelector('[data-size-field]')).toBeNull();
      expect(q('[data-size-unavailable]').textContent).toContain('Publish the fields first');
      expect(forms.findFormDefinition).not.toHaveBeenCalled();
    });
  });

  describe('a new asset type (#635)', () => {
    beforeEach(() => open());

    it('is the same page with a plain header, no tabs, no Active badge and the footer from the start', () => {
      expect(q('[data-page-title]').textContent).toContain('New asset type');
      expect(el().querySelector('[role=tab]')).toBeNull();
      expect(el().querySelector('[data-page-actions] button[data-action]')).toBeNull();
      expect(q('[data-save]').textContent).toContain('Create asset type');
      expect(api.getAssetType).not.toHaveBeenCalled();
    });

    it('focuses Name with one message when the name is blank', async () => {
      await save();
      expect(q('[data-summary]').textContent!.match(/Enter a name\./g)).toHaveLength(1);
      expect(document.activeElement).toBe(q('#at-name'));
      expect(api.createAssetType).not.toHaveBeenCalled();
    });

    it('creates the type and lands on its Fields tab, replacing the address', async () => {
      await type('#at-name', ' Data Room ');
      await type('#at-description', 'Virtual rooms');
      await save();
      expect(api.createAssetType).toHaveBeenCalledWith({
        name: 'Data Room',
        description: 'Virtual rooms',
      });
      expect(navigate).toHaveBeenCalledWith(
        ['/admin/asset-types', 9],
        expect.objectContaining({ queryParams: { tab: 'fields' }, replaceUrl: true }),
      );
    });

    it('Cancel goes back to the list', async () => {
      q<HTMLButtonElement>('[data-cancel]').click();
      await settle(fixture);
      expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalled();
    });
  });

  describe('not found, no access and failures (#541)', () => {
    const all403 = ['AssetType.Manage'] as Permission[];

    it('shows "We couldn\'t find that asset type." for a 404, with the crumb, a way back and no Retry', async () => {
      await open(
        '99999',
        undefined,
        all403,
        published(),
        apiError(404, { title: 'Not found', status: 404 }),
      );
      expect(q('h1').textContent).toBe("We couldn't find that asset type.");
      expect(q('nav[aria-label=Breadcrumb]').textContent!.replace(/\s+/g, ' ')).toMatch(
        /Administration\s*>?\s*Asset Types\s*>?\s*Asset type/,
      );
      expect(q('[data-back-link]').getAttribute('href')).toBe('/admin/asset-types');
      expect(el().querySelector('[data-retry]')).toBeNull();
    });

    it('says the same for an address that is not a number, without asking the API', async () => {
      await open('abc');
      expect(q('h1').textContent).toBe("We couldn't find that asset type.");
      expect(api.getAssetType).not.toHaveBeenCalled();
    });

    it('shows the access text for a 403 and Retry for a failure', async () => {
      await open(
        '4',
        undefined,
        all403,
        published(),
        apiError(403, { title: 'Forbidden', status: 403 }),
      );
      expect(q('h1').textContent).toBe("You don't have access to this asset type.");
      expect(el().querySelector('[data-retry]')).toBeNull();
      fixture.destroy();
      TestBed.resetTestingModule();
      await open(
        '4',
        undefined,
        all403,
        published(),
        apiError(500, { title: 'Error', status: 500 }),
      );
      expect(q('h1').textContent).toBe("Couldn't load this asset type.");
      expect(q('[data-retry]')).not.toBeNull();
    });
  });
});
