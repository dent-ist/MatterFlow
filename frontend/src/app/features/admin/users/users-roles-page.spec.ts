import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { MessageService } from 'primeng/api';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { ADMIN_ROUTES } from '../admin.routes';

describe('Users page tabs (Users, Roles)', () => {
  let harness: RouterTestingHarness;
  const el = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const tabs = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('[role="tab"]'));
  const selected = (): string[] =>
    tabs()
      .filter((t) => t.getAttribute('aria-selected') === 'true')
      .map((t) => t.textContent!.trim());

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
        InMemoryIdentityAdminApi,
        { provide: IdentityAdminApi, useExisting: InMemoryIdentityAdminApi },
      ],
    });
    await TestBed.inject(AuthStore).ensureLoaded();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
    return TestBed.inject(Router);
  }

  it('opens the Users tab on /admin/users and the Roles tab on /admin/roles', async () => {
    const router = await open('/admin/users', 'User.View', 'Role.Manage');
    expect(el().querySelector('h1')!.textContent).toBe('Users');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Users', 'Roles']);
    expect(selected()).toEqual(['Users']);
    expect(el().querySelector('#users-search')).not.toBeNull();

    await harness.navigateByUrl('/admin/roles');
    await settle();
    expect(selected()).toEqual(['Roles']);
    expect(el().querySelector('[data-editor], .mf-roles-bar')).not.toBeNull();
    expect(router.url).toBe('/admin/roles');
  });

  it('keeps the address in step with the selected tab, with roving tabindex and arrow keys', async () => {
    const router = await open('/admin/users', 'User.View', 'Role.Manage');
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1]);

    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(router.url).toBe('/admin/roles');
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0]);

    tabs()[1].click();
    tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    await settle();
    expect(router.url).toBe('/admin/users');
  });

  it('offers only the Users tab without Role.Manage, and only Roles without user permissions', async () => {
    await open('/admin/users', 'User.View');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Users']);
    await harness.navigateByUrl('/admin/roles');
    await settle();
    expect(TestBed.inject(Router).url).toBe('/admin/users');
  });

  it('sends a Role.Manage-only user from /admin/users to the Roles tab', async () => {
    const router = await open('/admin/users', 'Role.Manage');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Roles']);
    expect(router.url).toBe('/admin/roles');
  });

  it('sends a user with neither tab to the 403 page', async () => {
    const router = await open('/admin/users', 'Pod.Manage');
    expect(router.url).toBe('/403');
  });
});
