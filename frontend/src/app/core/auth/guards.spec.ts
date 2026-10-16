import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { FakeMeApi, profileOf, provideFakeMe, withPermissions } from './auth-testing';
import { accessGuard, landingGuard, pendingOnlyGuard, permissionGuard } from './guards';
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

  it('keeps My Work and Task Queue ahead of the Dashboard', async () => {
    setup(profileOf({ permissions: ['Task.View', 'Dashboard.View', 'Dashboard.ViewSummary'] }));
    expect(await run(landingGuard)).toBe('/tasks');
  });

  it('goes to Access Pending for pending users', async () => {
    setup(profileOf({ status: 'ACCESS_PENDING' }));
    expect(await run(landingGuard)).toBe('/access-pending');
  });
});
