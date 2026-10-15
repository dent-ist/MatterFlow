import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { AssetLinkRolesClient, AssetTypesClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { FakeAssetLinkRolesClient } from '../../../core/lookups/lookups-testing';
import { anAssetType, pageOfAssetTypes } from '../../../shared/testing/asset-testing';
import { ok } from '../../../shared/testing/org-testing';
import { ADMIN_ROUTES } from '../admin.routes';

describe('Assets set-up page (Asset Types, Asset Link Roles)', () => {
  let harness: RouterTestingHarness;
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[role="tab"]'));
  const selected = (): string =>
    tabs()
      .find((t) => t.getAttribute('aria-selected') === 'true')!
      .textContent!.trim();

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
        MessageService,
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

  it('titles the page so it is not mistaken for the Assets data records, with two tabs', async () => {
    await open('/admin/asset-types', 'AssetType.Manage');
    expect(el().querySelector('h1')!.textContent).toBe('Asset types and link roles');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Asset Types', 'Asset Link Roles']);
    expect(selected()).toBe('Asset Types');
    expect(el().querySelector('[data-types]')).not.toBeNull();
  });

  it('opens the Asset Link Roles tab from ?tab=link-roles and keeps the address in step', async () => {
    const router = await open('/admin/asset-types?tab=link-roles', 'AssetType.Manage');
    expect(selected()).toBe('Asset Link Roles');
    expect(el().querySelector('[data-roles]')).not.toBeNull();

    tabs()[0].click();
    await settle();
    expect(router.url).toBe('/admin/asset-types');
    expect(selected()).toBe('Asset Types');

    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    expect(router.url).toBe('/admin/asset-types?tab=link-roles');
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0]);
  });

  it('redirects the old /admin/asset-link-roles address to the tab', async () => {
    const router = await open('/admin/asset-link-roles', 'AssetType.Manage');
    expect(router.url).toBe('/admin/asset-types?tab=link-roles');
    expect(selected()).toBe('Asset Link Roles');
  });

  it('needs AssetType.Manage', async () => {
    const router = await open('/admin/asset-types', 'Asset.View');
    expect(router.url).toBe('/403');
  });
});
