import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AssetLinkRolesClient, AssetTypesClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { FakeAssetLinkRolesClient } from '../../../core/lookups/lookups-testing';
import { anAssetType, pageOfAssetTypes } from '../../../shared/testing/asset-testing';
import { ok } from '../../../shared/testing/org-testing';
import { ADMIN_ROUTES } from '../admin.routes';
import { ASSET_TYPES_TEXT } from './asset-admin-page';

describe('Asset Types page (one tab; Link Roles moved to Lists, epic #1314)', () => {
  let harness: RouterTestingHarness;
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r));
      harness.detectChanges();
    }
  }

  async function open(url: string, ...permissions: Permission[]): Promise<Router> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'admin', children: ADMIN_ROUTES },
            { path: '403', children: [] },
          ],
          withComponentInputBinding(),
        ),
        provideFakeMe(new FakeMeApi(withPermissions(...permissions))),
        {
          provide: AssetTypesClient,
          useValue: { listAssetTypes: () => ok(pageOfAssetTypes(anAssetType())) },
        },
        { provide: AssetLinkRolesClient, useValue: new FakeAssetLinkRolesClient() },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return TestBed.inject(Router);
  }

  it('is titled Asset Types (the Assets data list is another item), with no tab strip', async () => {
    await open('/admin/asset-types', 'AssetType.Manage');
    expect(el().querySelector('h1')!.textContent).toBe('Asset Types');
    // The breadcrumb says it is the Administration item "Asset Types" (#588), not the Assets data list.
    expect(el().querySelector('nav[aria-label=Breadcrumb]')!.textContent).toMatch(
      /Administration\s*>?\s*Asset Types/,
    );
    expect(el().querySelector('[role="tab"]')).toBeNull();
    expect(el().querySelector('[role="tablist"]')).toBeNull();
    expect(el().querySelector('[data-types]')).not.toBeNull();
    expect(el().querySelector('[data-roles]')).toBeNull();
  });

  it('has Filters and New asset type in the header and one line of description', async () => {
    await open('/admin/asset-types', 'AssetType.Manage');
    const header = el().querySelector('mf-page-header')!;
    expect(header.querySelector('[data-new]')!.textContent).toContain('New Asset Type');
    expect(header.querySelector('[data-filters-toggle]')).not.toBeNull();
    expect(header.textContent).toContain('Each type has its own fields.');
    // The list has no New button of its own, and Link Roles has none on this page any more.
    expect(el().querySelectorAll('[data-new]')).toHaveLength(1);
    expect(el().querySelector('[data-new-role]')).toBeNull();
  });

  it('keeps the description to one line of 90 characters or less', () => {
    expect(ASSET_TYPES_TEXT.length).toBeLessThanOrEqual(90);
  });

  it('sends the old Link Roles tab address and /admin/asset-link-roles to the Link Roles list', async () => {
    // The Lists page takes the one-time `moved` marker out of the address after it has said so.
    let router = await open('/admin/asset-types?tab=link-roles', 'AssetType.Manage');
    expect(router.url).toBe('/admin/lists/link-roles');
    expect(el().querySelector('[data-moved-banner]')!.textContent).toContain(
      'Link Roles has moved here, under Lists > Assets.',
    );
    TestBed.resetTestingModule();
    router = await open('/admin/asset-link-roles', 'AssetType.Manage');
    expect(router.url).toBe('/admin/lists/link-roles');
    expect(el().querySelector('[data-moved-banner]')).not.toBeNull();
  });

  it('keeps the other Asset Types addresses (status filter, page) on the page', async () => {
    const router = await open('/admin/asset-types?status=inactive&page=2', 'AssetType.Manage');
    expect(router.url).toBe('/admin/asset-types?status=inactive&page=2');
    expect(el().querySelector('[data-types]')).not.toBeNull();
  });

  it('needs AssetType.Manage', async () => {
    const router = await open('/admin/asset-types', 'Asset.View');
    expect(router.url).toBe('/403');
  });
});
