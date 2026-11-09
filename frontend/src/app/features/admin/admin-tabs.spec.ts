import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QuietRequests } from '../../core/http/interceptors';
import {
  AdminTab,
  AdminTabCounts,
  adminMenuTarget,
  adminTabItems,
  allowedAdminTabs,
  resolveAdminTab,
} from './admin-tabs';

const TABS: AdminTab[] = [
  {
    id: 'roles',
    label: 'Roles',
    route: '/admin/roles',
    permission: ['Role.Manage'],
    countKey: 'roles',
  },
  {
    id: 'pods',
    label: 'Pods',
    route: '/admin/pods',
    permission: ['Pod.Manage'],
    countKey: 'pods',
  },
];
const has =
  (...codes: string[]) =>
  (p: string) =>
    codes.includes(p);

describe('admin tab model (#545)', () => {
  it('offers only the tabs the person may open, in the order of the model', () => {
    expect(allowedAdminTabs(TABS, has('Role.Manage', 'Pod.Manage')).map((t) => t.id)).toEqual([
      'roles',
      'pods',
    ]);
    expect(allowedAdminTabs(TABS, has('Pod.Manage')).map((t) => t.id)).toEqual(['pods']);
    expect(allowedAdminTabs(TABS, has())).toEqual([]);
    // A tab without permissions is for everyone who reached the page; ANY listed permission is enough.
    const open: AdminTab = { id: 'x', label: 'X', route: '/x', permission: [] };
    const either: AdminTab = { id: 'y', label: 'Y', route: '/y', permission: ['A', 'B'] };
    expect(allowedAdminTabs([open, either], has('B')).map((t) => t.id)).toEqual(['x', 'y']);
  });

  it('gives the sidebar item the route of the first tab the person may open (BUG-1)', () => {
    expect(adminMenuTarget(TABS, has('Role.Manage', 'Pod.Manage'))).toBe('/admin/roles');
    expect(adminMenuTarget(TABS, has('Pod.Manage'))).toBe('/admin/pods');
    expect(adminMenuTarget(TABS, has())).toBeNull();
  });

  it('falls back to the first allowed tab for a requested tab the person may not use', () => {
    const can = has('Pod.Manage');
    expect(resolveAdminTab(TABS, 'roles', can)?.id).toBe('pods');
    expect(resolveAdminTab(TABS, 'pods', can)?.id).toBe('pods');
    expect(resolveAdminTab(TABS, undefined, can)?.id).toBe('pods');
    expect(resolveAdminTab(TABS, 'roles', has())).toBeNull();
    expect(resolveAdminTab(TABS, 'pods', has('Role.Manage', 'Pod.Manage'))?.id).toBe('pods');
  });

  it('builds mf-tabs items for the allowed tabs only, with "--" for an unknown count and the number spoken as active', () => {
    const can = has('Role.Manage', 'Pod.Manage');
    expect(adminTabItems(TABS, can)).toEqual([
      { key: 'roles', label: 'Roles', icon: 'pi-shield' },
      { key: 'pods', label: 'Pods', icon: 'pi-users' },
    ]);
    expect(adminTabItems(TABS, can, { roles: 12, pods: null })).toEqual([
      {
        key: 'roles',
        label: 'Roles',
        icon: 'pi-shield',
        count: 12,
        name: 'Roles, 12 active',
      },
      { key: 'pods', label: 'Pods', icon: 'pi-users', count: '--' },
    ]);
    // A zero is a real answer and is shown.
    expect(adminTabItems(TABS, can, { roles: 0 })[0]).toMatchObject({ count: 0 });
    // A hidden tab is not built, so it is never rendered; one allowed tab is one item (the shell then draws no strip).
    expect(adminTabItems(TABS, has('Role.Manage'), { roles: 3 })).toHaveLength(1);
  });
});

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Child {
  readonly report = AdminTabCounts.report('pods');
}

describe('AdminTabCounts (#545)', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [AdminTabCounts] });
    return TestBed.inject(AdminTabCounts);
  }
  const can = has('Role.Manage', 'Pod.Manage');

  it('asks once per page, one request per allowed tab, and shows "--" until the answer', async () => {
    const counts = setup();
    const p = vi.fn().mockResolvedValue(7);
    const s = vi.fn().mockResolvedValue(0);
    const loaders = { roles: p, pods: s };
    const roles = counts.count('roles');
    const started = counts.start(TABS, loaders, can);
    expect(roles()).toBe('--');
    expect(counts.snapshot()).toEqual({ roles: null, pods: null });
    await started;
    expect(roles()).toBe(7);
    expect(counts.count('pods')()).toBe(0);
    await counts.start(TABS, loaders, can); // a second start (a re-render) asks for nothing
    expect(p).toHaveBeenCalledTimes(1);
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing a person may not open', async () => {
    const counts = setup();
    const p = vi.fn().mockResolvedValue(7);
    const s = vi.fn().mockResolvedValue(3);
    await counts.start(TABS, { roles: p, pods: s }, has('Pod.Manage'));
    expect(p).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
    expect(counts.snapshot()).toEqual({ pods: 3 });
  });

  it('runs the request quiet, and a failure leaves "--" without throwing', async () => {
    const counts = setup();
    const quiet = TestBed.inject(QuietRequests);
    let wasQuiet = false;
    const loader = vi.fn(() => {
      wasQuiet = quiet.active;
      return Promise.reject(new Error('down'));
    });
    await counts.start(TABS, { roles: loader }, can);
    expect(wasQuiet).toBe(true);
    expect(quiet.active).toBe(false);
    expect(counts.count('roles')()).toBe('--');
    expect(counts.snapshot()['roles']).toBeNull();
  });

  it('refreshes after an edit, replacing the number, and keeps the old number if the refresh fails', async () => {
    const counts = setup();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockRejectedValueOnce(new Error('down'));
    await counts.start(TABS, { roles: loader }, can);
    expect(counts.count('roles')()).toBe(5);
    await counts.refresh('roles'); // created one
    expect(counts.count('roles')()).toBe(6);
    await counts.refresh('roles'); // failed: still 6
    expect(counts.count('roles')()).toBe(6);
    await counts.refresh('unknown'); // nothing registered: nothing happens
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('keeps the number the open tab reported, and a gone tab reports nothing', async () => {
    const counts = setup();
    const fixture = TestBed.createComponent(Child);
    let resolve!: (n: number) => void;
    const slow = new Promise<number>((r) => (resolve = r));
    const started = counts.start(TABS, { pods: () => slow }, can);
    fixture.componentInstance.report(9);
    resolve(4); // the answer that was on its way does not overwrite the newer number
    await started;
    expect(counts.count('pods')()).toBe(9);
    fixture.destroy();
    fixture.componentInstance.report(1);
    expect(counts.count('pods')()).toBe(9);
  });
});
