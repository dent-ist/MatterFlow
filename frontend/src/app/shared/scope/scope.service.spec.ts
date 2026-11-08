import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { MattersClient } from '../../api/generated/api-client';
import { FakeMeApi, profileOf, provideFakeMe } from '../../core/auth/auth-testing';
import { AuthStore } from '../../core/auth/auth.store';
import { Permission } from '../../core/auth/permissions';
import { ScopeService } from './scope.service';

/** The matters list as the default scope reads it: the total of the active matters the person manages, or a failure. */
function mattersTotal(total: number | Error): { provide: typeof MattersClient; useValue: unknown } {
  const listMatters = vi.fn((): Observable<unknown> =>
    total instanceof Error ? throwError(() => total) : of({ items: [], total }),
  );
  return { provide: MattersClient, useValue: { listMatters } };
}

async function service(
  permissions: Permission[],
  extra: Parameters<typeof profileOf>[0] = {},
  managed: number | Error | null = null,
): Promise<ScopeService> {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideFakeMe(
        new FakeMeApi(profileOf({ userId: 7, permissions, roles: ['Test'], ...extra })),
      ),
      ...(managed === null ? [] : [mattersTotal(managed)]),
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

  describe('the default scope (epic #1330, #1334)', () => {
    const director: Permission[] = ['Matter.View', 'Matter.BeManager', 'Matter.AssignManagers'];

    it('is All for a person who manages no matter and may choose All', async () => {
      const s = await service(director, {}, 0);
      await s.ensureKnown();
      expect(s.managesMatters()).toBe(false);
      expect(s.defaultFor('matters')).toBe('all');
      expect(s.defaultFor('task-queue')).toBe('all');
    });

    it('is My matters for a person who manages at least one matter', async () => {
      const s = await service(director, {}, 3);
      await s.ensureKnown();
      expect(s.managesMatters()).toBe(true);
      expect(s.defaultFor('matters')).toBe('mine');
    });

    it('an explicit remembered choice wins in both directions', async () => {
      const none = await service(director, {}, 0);
      await none.ensureKnown();
      none.remember('clients', 'mine');
      expect(none.defaultFor('clients')).toBe('mine');
      TestBed.resetTestingModule();
      const some = await service(director, {}, 2);
      await some.ensureKnown();
      some.remember('clients', 'all');
      expect(some.defaultFor('clients')).toBe('all');
    });

    it('stays My matters for a person who cannot choose All, however few matters they manage', async () => {
      const s = await service(['Matter.View', 'Matter.BeManager'], {}, 0);
      await s.ensureKnown();
      expect(s.defaultFor('matters')).toBe('mine');
    });

    it('stays My matters while the answer is unknown and when reading it fails', async () => {
      const waiting = await service(director, {}, 0);
      expect(waiting.defaultFor('matters')).toBe('mine');
      TestBed.resetTestingModule();
      const failed = await service(director, {}, new Error('boom'));
      await failed.ensureKnown();
      expect(failed.managesMatters()).toBeNull();
      expect(failed.defaultFor('matters')).toBe('mine');
    });

    it('asks once, and not at all for a person the switch does not apply to', async () => {
      const s = await service(director, {}, 0);
      await Promise.all([s.ensureKnown(), s.ensureKnown()]);
      await s.ensureKnown();
      const client = TestBed.inject(MattersClient) as unknown as {
        listMatters: { mock: { calls: unknown[] } };
      };
      expect(client.listMatters.mock.calls).toHaveLength(1);
      TestBed.resetTestingModule();
      const other = await service(['Matter.View'], {}, 0);
      await other.ensureKnown();
      const none = TestBed.inject(MattersClient) as unknown as {
        listMatters: { mock: { calls: unknown[] } };
      };
      expect(none.listMatters.mock.calls).toHaveLength(0);
    });
  });
});
