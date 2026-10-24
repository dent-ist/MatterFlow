import { TestBed } from '@angular/core/testing';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { ScopeService } from './scope.service';

async function service(
  permissions: Permission[],
  extra: Parameters<typeof profileOf>[0] = {},
): Promise<ScopeService> {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideFakeMe(
        new FakeMeApi(profileOf({ userId: 7, permissions, roles: ['Test'], ...extra })),
      ),
    ],
  });
  await TestBed.inject(AuthStore).ensureLoaded();
  return TestBed.inject(ScopeService);
}

describe('ScopeService', () => {
  afterEach(() => localStorage.clear());

  it('applies only to people who can be a project manager', async () => {
    const s = await service(['Matter.View', 'Matter.AssignManagers']);
    expect(s.eligible()).toBe(false);
    expect(s.defaultFor('matters')).toBeNull();
    expect(s.clamp('mine')).toBeNull();
  });

  it('defaults to mine and offers all only with Matter.AssignManagers', async () => {
    const pm = await service(['Matter.View', 'Matter.BeManager']);
    expect(pm.eligible()).toBe(true);
    expect(pm.canAll()).toBe(false);
    expect(pm.defaultFor('matters')).toBe('mine');
    expect(pm.clamp('all')).toBe('mine');
  });

  it('remembers per page and per person, and ignores a stored all without the permission', async () => {
    const s = await service(['Matter.View', 'Matter.BeManager', 'Matter.AssignManagers']);
    expect(s.canAll()).toBe(true);
    s.remember('assets', 'all');
    expect(s.defaultFor('assets')).toBe('all');
    expect(s.defaultFor('clients')).toBe('mine');
    expect(localStorage.getItem('mf.scope.assets.7')).toBe('all');
  });

  it('ignores a stored all when the person no longer holds the permission', async () => {
    localStorage.setItem('mf.scope.assets.7', 'all');
    const s = await service(['Matter.View', 'Matter.BeManager']);
    localStorage.setItem('mf.scope.assets.7', 'all');
    expect(s.remembered('assets')).toBeNull();
    expect(s.defaultFor('assets')).toBe('mine');
  });

  it('works without storage', async () => {
    const s = await service(['Matter.BeManager', 'Matter.AssignManagers']);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(s.defaultFor('matters')).toBe('mine');
    expect(() => s.remember('matters', 'all')).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });

  it('does not count a System Admin as a project manager unless they hold the role', async () => {
    const admin = await service([], { isSystemAdmin: true, roles: ['System Admin'] });
    expect(admin.eligible()).toBe(false);
    TestBed.resetTestingModule();
    const pmAdmin = await service([], { isSystemAdmin: true, roles: ['Project Manager'] });
    expect(pmAdmin.eligible()).toBe(true);
    expect(pmAdmin.canAll()).toBe(true);
  });
});
