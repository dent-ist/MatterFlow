import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AssetLinkRolesClient, AssetTypesClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { LeaveConfirmService } from '../../../shared/guards/unsaved-changes.guard';
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

  it('is titled Asset Types (the Assets data list is another item), with two tabs', async () => {
    await open('/admin/asset-types', 'AssetType.Manage');
    expect(el().querySelector('h1')!.textContent).toBe('Asset Types');
    // The breadcrumb says it is the Administration item "Asset Types" (#588), not the Assets data list.
    expect(el().querySelector('nav[aria-label=Breadcrumb]')!.textContent).toMatch(
      /Administration\s*>?\s*Asset Types/,
    );
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

  it('asks before the tab switch or navigation drops a half-typed asset type (#530)', async () => {
    const router = await open('/admin/asset-types', 'AssetType.Manage');
    const leave = TestBed.inject(LeaveConfirmService);
    const ask = vi.spyOn(leave, 'ask').mockResolvedValue(false);

    // Untouched form: the tab opens without a question.
    el().querySelector<HTMLButtonElement>('p-button button, button.p-button')!.click();
    await settle();
    expect(el().querySelector('[data-editor]')).not.toBeNull();
    tabs()[1].click();
    await settle();
    expect(ask).not.toHaveBeenCalled();
    expect(selected()).toBe('Asset Link Roles');
    tabs()[0].click();
    await settle();

    // Half-typed: Stay keeps the text on the same tab.
    el().querySelector<HTMLButtonElement>('p-button button, button.p-button')!.click();
    await settle();
    const name = el().querySelector<HTMLInputElement>('#type-name')!;
    name.value = 'Half typed';
    name.dispatchEvent(new Event('input'));
    await settle();
    tabs()[1].click();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(selected()).toBe('Asset Types');
    expect(el().querySelector<HTMLInputElement>('#type-name')!.value).toBe('Half typed');

    // Navigating away asks too (the route guard), and Leave goes.
    await router.navigateByUrl('/403');
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(router.url).toBe('/admin/asset-types');
    ask.mockResolvedValue(true);
    await router.navigateByUrl('/403');
    await settle();
    expect(router.url).toBe('/403');
  });

  it('needs AssetType.Manage', async () => {
    const router = await open('/admin/asset-types', 'Asset.View');
    expect(router.url).toBe('/403');
  });
});
