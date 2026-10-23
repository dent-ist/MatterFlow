import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthStore } from './auth.store';
import { FakeMeApi, profileOf, provideFakeMe, withPermissions } from './auth-testing';
import {
  ErrorRequest,
  ForbiddenRequest,
  accessGuard,
  landingGuard,
  landingLink,
  pendingOnlyGuard,
  permissionAllGuard,
  permissionGuard,
} from './guards';
import { ApiError } from '../http/api-error';
import { HttpErrorResponse } from '@angular/common/http';

async function run(guard: () => Promise<boolean | UrlTree>) {
  const result = await TestBed.runInInjectionContext(guard);
  const router = TestBed.inject(Router);
  return result instanceof UrlTree ? router.serializeUrl(result) : result;
}

function setup(me: ConstructorParameters<typeof FakeMeApi>[0]) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideFakeMe(new FakeMeApi(me))],
  });
}

describe('accessGuard', () => {
  it('lets users with permissions through', async () => {
    setup(withPermissions('Task.View'));
    expect(await run(accessGuard)).toBe(true);
  });

  it('redirects pending users to /access-pending', async () => {
    setup(profileOf({ status: 'ACCESS_PENDING' }));
    expect(await run(accessGuard)).toBe('/access-pending');
  });

  it('redirects users with zero permissions to /access-pending', async () => {
    setup(profileOf());
    expect(await run(accessGuard)).toBe('/access-pending');
  });

  it('redirects disabled users to /access-pending', async () => {
    setup(profileOf({ status: 'DISABLED' }));
    expect(await run(accessGuard)).toBe('/access-pending');
  });

  it('redirects to /error when /me cannot be loaded', async () => {
    setup(ApiError.from(new HttpErrorResponse({ status: 500 })));
    expect(await run(accessGuard)).toBe('/error');
  });
});

describe('the error page remembers the address (#608)', () => {
  it('a permission guard that cannot load /me keeps the address that was asked for', async () => {
    setup(ApiError.from(new HttpErrorResponse({ status: 500 })));
    const guard = permissionGuard('Task.View');
    const result = await TestBed.runInInjectionContext(() =>
      guard(undefined, { url: '/tasks?view=mine' } as RouterStateSnapshot),
    );
    expect(result instanceof UrlTree && TestBed.inject(Router).serializeUrl(result)).toBe('/error');
    expect(TestBed.inject(ErrorRequest).url()).toBe('/tasks?view=mine');
  });

  it('the access guard keeps it too, and never remembers /error itself', async () => {
    setup(ApiError.from(new HttpErrorResponse({ status: 500 })));
    await TestBed.runInInjectionContext(() =>
      accessGuard(undefined, { url: '/clients' } as RouterStateSnapshot),
    );
    expect(TestBed.inject(ErrorRequest).url()).toBe('/clients');
    await TestBed.runInInjectionContext(() =>
      accessGuard(undefined, { url: '/error' } as RouterStateSnapshot),
    );
    expect(TestBed.inject(ErrorRequest).url()).toBeNull();
  });
});

describe('permissionGuard', () => {
  it('allows when the user has the permission', async () => {
    setup(withPermissions('Task.Create'));
    expect(await run(permissionGuard('Task.Create'))).toBe(true);
  });

  it('allows when the user has any of several permissions', async () => {
    setup(withPermissions('Pod.Manage'));
    expect(await run(permissionGuard('Pod.ManageMembers', 'Pod.Manage'))).toBe(true);
  });

  it('redirects to /403 when the permission is missing', async () => {
    setup(withPermissions('Task.View'));
    expect(await run(permissionGuard('Task.Create'))).toBe('/403');
  });

  it('remembers the address it turned away for the 403 page (#598), and nothing when it lets the person in', async () => {
    setup(withPermissions('Task.View'));
    const state = { url: '/admin/users?status=all' } as RouterStateSnapshot;
    await TestBed.runInInjectionContext(() => permissionGuard('User.Manage')(undefined, state));
    expect(TestBed.inject(ForbiddenRequest).url()).toBe('/admin/users?status=all');
    TestBed.inject(ForbiddenRequest).url.set(null);
    await TestBed.runInInjectionContext(() => permissionGuard('Task.View')(undefined, state));
    expect(TestBed.inject(ForbiddenRequest).url()).toBeNull();
  });

  it('sends pending users to /access-pending rather than /403', async () => {
    setup(profileOf({ status: 'ACCESS_PENDING' }));
    expect(await run(permissionGuard('Task.View'))).toBe('/access-pending');
  });

  it('allows system admins everywhere', async () => {
    setup(profileOf({ isSystemAdmin: true }));
    expect(await run(permissionGuard('Audit.View'))).toBe(true);
  });
});

describe('pendingOnlyGuard', () => {
  it('keeps pending users on Access Pending', async () => {
    setup(profileOf({ status: 'ACCESS_PENDING' }));
    expect(await run(pendingOnlyGuard)).toBe(true);
  });

  it('keeps disabled users on Access Pending', async () => {
    setup(profileOf({ status: 'DISABLED' }));
    expect(await run(pendingOnlyGuard)).toBe(true);
  });

  it('sends users who now have access to their landing page', async () => {
    setup(profileOf({ permissions: ['Task.View'], hasWork: true }));
    expect(await run(pendingOnlyGuard)).toBe('/my-work');
  });
});

describe('Dashboard route guard', () => {
  it('sends users without Dashboard.View to /403, even with a tab permission', async () => {
    setup(withPermissions('Dashboard.ViewSummary'));
    expect(await run(permissionGuard('Dashboard.View'))).toBe('/403');
  });

  it('lets users with Dashboard.View through', async () => {
    setup(withPermissions('Dashboard.View'));
    expect(await run(permissionGuard('Dashboard.View'))).toBe(true);
  });
});

describe('permissionAllGuard (#549)', () => {
  it('allows when the user holds every code', async () => {
    setup(withPermissions('Pod.View', 'Task.View'));
    expect(await run(permissionAllGuard('Pod.View', 'Task.View'))).toBe(true);
  });

  it('turns away a user who holds only some of them (Pod.View without Task.View): the 403 page, with the address', async () => {
    setup(withPermissions('Pod.View', 'Dashboard.View'));
    const state = { url: '/pods/work?podId=3' } as RouterStateSnapshot;
    const result = await TestBed.runInInjectionContext(() =>
      permissionAllGuard('Pod.View', 'Task.View')(undefined, state),
    );
    expect(result instanceof UrlTree && TestBed.inject(Router).serializeUrl(result)).toBe('/403');
    expect(TestBed.inject(ForbiddenRequest).url()).toBe('/pods/work?podId=3');
  });
});

describe('landing for project managers (#691)', () => {
  it('lands the holder of Matter.BeManager, Matter.View and Task.View on My Matters, before My Work', async () => {
    setup(
      profileOf({ permissions: ['Matter.BeManager', 'Matter.View', 'Task.View'], hasWork: true }),
    );
    expect(await run(landingGuard)).toBe('/my-matters');
  });

  it('lands a manager with no matters and no work on My Matters too (a positive empty state, not another page)', async () => {
    setup(profileOf({ permissions: ['Matter.BeManager', 'Matter.View', 'Task.View'] }));
    expect(await run(landingGuard)).toBe('/my-matters');
  });

  it('puts a manager who also holds a Dashboard tab on My Matters (the marker permission decides)', async () => {
    setup(
      profileOf({
        permissions: [
          'Matter.BeManager',
          'Matter.View',
          'Task.View',
          'Dashboard.View',
          'Dashboard.ViewSummary',
        ],
      }),
    );
    expect(await run(landingGuard)).toBe('/my-matters');
  });

  it('does not change the landing without Task.View: My Matters would be a page of dead links', async () => {
    setup(profileOf({ permissions: ['Matter.BeManager', 'Matter.View', 'Client.View'] }));
    expect(await run(landingGuard)).toBe('/clients');
  });

  it('does not change the landing without Matter.View or without the marker permission (Director, technician)', async () => {
    setup(profileOf({ permissions: ['Matter.BeManager', 'Task.View'], hasWork: true }));
    expect(await run(landingGuard)).toBe('/my-work');
    TestBed.resetTestingModule();
    setup(
      profileOf({
        permissions: [
          'Matter.View',
          'Matter.AssignManagers',
          'Task.View',
          'Dashboard.View',
          'Dashboard.ViewSummary',
        ],
      }),
    );
    expect(await run(landingGuard)).toBe('/dashboard');
  });

  it('guards the route with all three permissions: 403 for a manager without Task.View, no page load', async () => {
    setup(withPermissions('Matter.BeManager', 'Matter.View'));
    const state = { url: '/my-matters' } as RouterStateSnapshot;
    const guard = permissionAllGuard('Matter.BeManager', 'Matter.View', 'Task.View');
    const result = await TestBed.runInInjectionContext(() => guard(undefined, state));
    expect(result instanceof UrlTree && TestBed.inject(Router).serializeUrl(result)).toBe('/403');
    TestBed.resetTestingModule();
    setup(withPermissions('Matter.BeManager', 'Matter.View', 'Task.View'));
    expect(await TestBed.runInInjectionContext(() => guard(undefined, state))).toBe(true);
  });

  it('names the 403 and 404 link "My Matters" for a manager', async () => {
    setup(profileOf({ permissions: ['Matter.BeManager', 'Matter.View', 'Task.View'] }));
    const store = TestBed.inject(AuthStore);
    await store.ensureLoaded();
    expect(landingLink(store)).toEqual({ path: '/my-matters', name: 'My Matters' });
  });
});

describe('landingGuard', () => {
  it('goes to My Work for users with work', async () => {
    setup(profileOf({ permissions: ['Task.View'], hasWork: true }));
    expect(await run(landingGuard)).toBe('/my-work');
  });

  it('goes to Task Queue when the user has Task.View but no work', async () => {
    setup(profileOf({ permissions: ['Task.View'] }));
    expect(await run(landingGuard)).toBe('/tasks');
  });

  it('goes to the Dashboard without Task.View only when the user may open it', async () => {
    setup(profileOf({ permissions: ['Client.View', 'Dashboard.View', 'Dashboard.ViewSwimlane'] }));
    expect(await run(landingGuard)).toBe('/dashboard');
  });

  it('skips a Dashboard with no tab turned on (R2): the first permitted screen instead', async () => {
    setup(profileOf({ permissions: ['Client.View', 'Dashboard.View', 'Dashboard.ViewCoverage'] }));
    expect(await run(landingGuard)).toBe('/clients');
  });

  it('never lands on the Dashboard without Dashboard.View: the first permitted screen instead', async () => {
    setup(profileOf({ permissions: ['Client.View', 'Asset.View'] }));
    expect(await run(landingGuard)).toBe('/clients');
  });

  it('lands oversight roles with Task.View, a Dashboard tab and no work on the Dashboard, not on a 141-row Task Queue (S4a, #628)', async () => {
    setup(profileOf({ permissions: ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary'] }));
    expect(await run(landingGuard)).toBe('/dashboard');
  });

  it('counts every Dashboard tab permission, Unassigned included (the Intake Coordinator, #628)', async () => {
    for (const tab of [
      'Dashboard.ViewSummary',
      'Dashboard.ViewBreakdowns',
      'Dashboard.ViewTrends',
      'Dashboard.ViewSwimlane',
      'Dashboard.ViewUsers',
      'Dashboard.ViewUnassigned',
    ] as const) {
      TestBed.resetTestingModule();
      setup(profileOf({ permissions: ['Task.View', 'Dashboard.View', tab] }));
      expect(await run(landingGuard)).toBe('/dashboard');
    }
  });

  it('Coverage alone opens no tab, so it does not change the landing (#628)', async () => {
    setup(profileOf({ permissions: ['Task.View', 'Dashboard.View', 'Dashboard.ViewCoverage'] }));
    expect(await run(landingGuard)).toBe('/tasks');
  });

  it('keeps Task Queue for a Task.View person with Dashboard.View but no tab turned on (#628)', async () => {
    setup(profileOf({ permissions: ['Task.View', 'Dashboard.View'] }));
    expect(await run(landingGuard)).toBe('/tasks');
  });

  it('keeps My Work ahead of the Dashboard for a user with Task.View and work (#142)', async () => {
    setup(
      profileOf({
        permissions: ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary'],
        hasWork: true,
      }),
    );
    expect(await run(landingGuard)).toBe('/my-work');
  });

  it('never lands on My Work without Task.View, even with work (#142)', async () => {
    setup(profileOf({ permissions: ['Dashboard.View', 'Dashboard.ViewSummary'], hasWork: true }));
    expect(await run(landingGuard)).toBe('/dashboard');
  });

  it('sends a work-holding user without Task.View to their first permitted screen (#142)', async () => {
    setup(profileOf({ permissions: ['Client.View'], hasWork: true }));
    expect(await run(landingGuard)).toBe('/clients');
  });

  it('never lands on Pod Work without Task.View: Pod Work needs both permissions (#549)', async () => {
    setup(profileOf({ permissions: ['Pod.View', 'Client.View'] }));
    expect(await run(landingGuard)).toBe('/clients');
  });

  it('goes to Access Pending for pending users', async () => {
    setup(profileOf({ status: 'ACCESS_PENDING' }));
    expect(await run(landingGuard)).toBe('/access-pending');
  });
});
