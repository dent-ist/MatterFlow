import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { of } from 'rxjs';
import { PodsClient } from '../../../api/generated/api-client';
import { FakeMeApi, provideFakeMe, withPermissions } from '../../../core/auth/auth-testing';
import { AuthStore } from '../../../core/auth/auth.store';
import { Permission } from '../../../core/auth/permissions';
import { IdentityAdminApi } from '../../../core/identity-admin/identity-admin-api';
import { InMemoryIdentityAdminApi } from '../../../core/identity-admin/in-memory-identity-admin-api';
import { ADMIN_ROUTES } from '../admin.routes';

// The first test loads the lazy admin pages (a large chunk to compile); on a loaded machine that can pass the 5 s default.
vi.setConfig({ testTimeout: 20000 });

/** /admin/users, with the status segment the page writes into the address once the counts are known (#429). */
const USERS_URL = /^\/admin\/users(\?|$)/;

describe('Users page tabs (Users, Roles, Pods)', () => {
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
        {
          provide: PodsClient,
          useValue: {
            listPods: () => of({ items: [], total: 0, page: 1, pageSize: 25 }),
            getPod: () =>
              of({
                pod: {
                  podId: 1,
                  name: 'Processing',
                  isActive: true,
                  memberCount: 0,
                  rowVersion: 'rv',
                },
                members: [],
              }),
          },
        },
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
    expect(el().querySelector('mf-filters-bar')).not.toBeNull();

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
    expect(router.url).toMatch(USERS_URL);
  });

  it('offers only the Users tab without Role.Manage, and only Roles without user permissions', async () => {
    await open('/admin/users', 'User.View');
    // One tab: the shell shows no tab strip (the kit rule), the Users list is the page.
    expect(tabs()).toEqual([]);
    expect(el().querySelector('mf-users-page')).not.toBeNull();
    await harness.navigateByUrl('/admin/roles');
    await settle();
    expect(TestBed.inject(Router).url).toMatch(USERS_URL);
  });

  it('sends a Role.Manage-only user from /admin/users to the Roles tab', async () => {
    const router = await open('/admin/users', 'Role.Manage');
    expect(tabs()).toEqual([]);
    expect(el().querySelector('mf-roles-page')).not.toBeNull();
    expect(router.url).toBe('/admin/roles');
  });

  it('sends a user with no tab permission to the 403 page', async () => {
    const router = await open('/admin/users', 'Task.View');
    expect(router.url).toBe('/403');
  });

  it('offers the Pods tab with Pod.Manage or Pod.ManageMembers, after Users and Roles', async () => {
    await open('/admin/users', 'User.View', 'Role.Manage', 'Pod.ManageMembers');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Users', 'Roles', 'Pods']);
    TestBed.resetTestingModule();
    await open('/admin/users', 'User.View', 'Pod.Manage');
    expect(tabs().map((t) => t.textContent!.trim())).toEqual(['Users', 'Pods']);
  });

  it('opens the Pods tab on /admin/pods, keeps the address in step and shows the pods list', async () => {
    const router = await open('/admin/pods', 'User.View', 'Role.Manage', 'Pod.Manage', 'Pod.View');
    expect(el().querySelector('h1')!.textContent).toContain('Users');
    expect(selected()).toEqual(['Pods']);
    expect(el().querySelector('[data-intro]')!.textContent).toContain('Pod leads are a role');
    expect(router.url).toBe('/admin/pods');

    tabs()[0].click();
    await settle();
    expect(router.url).toMatch(USERS_URL);
    expect(selected()).toEqual(['Users']);
    expect(el().querySelector('mf-pods-page')).toBeNull();

    tabs()[2].click();
    await settle();
    expect(router.url).toBe('/admin/pods');
  });

  it('keeps the pod editor deep link working: /admin/pods?pod=1 opens the editor in the Pods tab', async () => {
    const router = await open('/admin/pods?pod=1', 'Pod.Manage', 'Pod.ManageMembers', 'Pod.View');
    expect(el().querySelector('mf-pods-page')).not.toBeNull();
    expect((el().querySelector('#pod-name') as HTMLInputElement).value).toBe('Processing');
    expect(router.url).toContain('/admin/pods');
    expect(router.url).toContain('pod=1');
  });

  it('sends a user with only a Pods permission from /admin/users to the Pods tab', async () => {
    const router = await open('/admin/users', 'Pod.ManageMembers');
    expect(tabs()).toEqual([]);
    expect(el().querySelector('mf-pods-page')).not.toBeNull();
    expect(router.url).toBe('/admin/pods');
  });

  it('sends a Pods-less user from /admin/pods to the first tab they may use', async () => {
    const router = await open('/admin/pods', 'User.View');
    expect(router.url).toMatch(USERS_URL);
    expect(el().querySelector('mf-users-page')).not.toBeNull();
  });

  it('uses "Users - Pods" as the document title of the Pods tab', async () => {
    const titleOf = async (url: string): Promise<unknown> => {
      await open(url, 'User.View', 'Role.Manage', 'Pod.Manage');
      let route = TestBed.inject(Router).routerState.snapshot.root;
      while (route.firstChild) route = route.firstChild;
      TestBed.resetTestingModule();
      return route.title;
    };
    expect(await titleOf('/admin/users')).toBe('Users');
    expect(await titleOf('/admin/roles')).toBe('Users - Roles');
    expect(await titleOf('/admin/pods')).toBe('Users - Pods');
  });

  it('puts Filters with its count and Clear filters in the page header, and Clear keeps the segment (#431)', async () => {
    const router = await open(
      '/admin/users?status=all&name=a&email=firm',
      'User.View',
      'Role.Manage',
    );
    const header = el().querySelector('header') ?? el();
    expect(header.querySelector('[data-filters-toggle]')).not.toBeNull();
    expect(el().querySelector('mf-users-page [data-filters-toggle]')).toBeNull();
    expect(header.querySelector('[data-filter-count]')!.textContent).toBe('(2)'); // Name and Email; the segment is not a filter

    // One Clear filters: in the header while the row is open, in the bar below while it is closed or a sheet.
    expect(el().querySelectorAll('[data-clear-filters]').length).toBe(1);
    const clear = el().querySelector<HTMLElement>('[data-clear-filters]')!;
    expect(clear).not.toBeNull();
    clear.click();
    await settle();
    expect(router.url).toContain('status=all');
    expect(router.url).not.toContain('name=');
    expect(router.url).not.toContain('email=');

    // The Roles and Pods tabs have no column filters: no Filters button there.
    await harness.navigateByUrl('/admin/roles');
    await settle();
    expect(el().querySelector('[data-filters-toggle]')).toBeNull();
  });
});
