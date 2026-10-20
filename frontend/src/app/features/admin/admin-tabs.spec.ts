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
    id: 'priorities',
    label: 'Priorities',
    route: '/admin/priorities',
    permission: ['Priority.Manage'],
    countKey: 'priorities',
  },
  {
    id: 'status-labels',
    label: 'Status labels',
    route: '/admin/status-labels',
    permission: ['StatusLabel.Manage'],
    countKey: 'status-labels',
  },
];
const has =
  (...codes: string[]) =>
  (p: string) =>
    codes.includes(p);

describe('admin tab model (#545)', () => {
  it('offers only the tabs the person may open, in the order of the model', () => {
    expect(
      allowedAdminTabs(TABS, has('Priority.Manage', 'StatusLabel.Manage')).map((t) => t.id),
    ).toEqual(['priorities', 'status-labels']);
    expect(allowedAdminTabs(TABS, has('StatusLabel.Manage')).map((t) => t.id)).toEqual([
      'status-labels',
    ]);
    expect(allowedAdminTabs(TABS, has())).toEqual([]);
    // A tab without permissions is for everyone who reached the page; ANY listed permission is enough.
    const open: AdminTab = { id: 'x', label: 'X', route: '/x', permission: [] };
    const either: AdminTab = { id: 'y', label: 'Y', route: '/y', permission: ['A', 'B'] };
    expect(allowedAdminTabs([open, either], has('B')).map((t) => t.id)).toEqual(['x', 'y']);
  });

  it('gives the sidebar item the route of the first tab the person may open (BUG-1)', () => {
    expect(adminMenuTarget(TABS, has('Priority.Manage', 'StatusLabel.Manage'))).toBe(
      '/admin/priorities',
    );
    expect(adminMenuTarget(TABS, has('StatusLabel.Manage'))).toBe('/admin/status-labels');
    expect(adminMenuTarget(TABS, has())).toBeNull();
  });

  it('falls back to the first allowed tab for a requested tab the person may not use', () => {
    const can = has('StatusLabel.Manage');
    expect(resolveAdminTab(TABS, 'priorities', can)?.id).toBe('status-labels');
    expect(resolveAdminTab(TABS, 'status-labels', can)?.id).toBe('status-labels');
    expect(resolveAdminTab(TABS, undefined, can)?.id).toBe('status-labels');
    expect(resolveAdminTab(TABS, 'priorities', has())).toBeNull();
    expect(
      resolveAdminTab(TABS, 'status-labels', has('Priority.Manage', 'StatusLabel.Manage'))?.id,
    ).toBe('status-labels');
  });

  it('builds mf-tabs items for the allowed tabs only, with "--" for an unknown count and the number spoken as active', () => {
    const can = has('Priority.Manage', 'StatusLabel.Manage');
    expect(adminTabItems(TABS, can)).toEqual([
      { key: 'priorities', label: 'Priorities' },
      { key: 'status-labels', label: 'Status labels' },
    ]);
    expect(adminTabItems(TABS, can, { priorities: 12, 'status-labels': null })).toEqual([
      { key: 'priorities', label: 'Priorities', count: 12, name: 'Priorities, 12 active' },
      { key: 'status-labels', label: 'Status labels', count: '--' },
    ]);
    // A zero is a real answer and is shown.
    expect(adminTabItems(TABS, can, { priorities: 0 })[0]).toMatchObject({ count: 0 });
    // A hidden tab is not built, so it is never rendered; one allowed tab is one item (the shell then draws no strip).
    expect(adminTabItems(TABS, has('Priority.Manage'), { priorities: 3 })).toHaveLength(1);
  });
});

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Child {
  readonly report = AdminTabCounts.report('status-labels');
}

describe('AdminTabCounts (#545)', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [AdminTabCounts] });
    return TestBed.inject(AdminTabCounts);
  }
  const can = has('Priority.Manage', 'StatusLabel.Manage');

  it('asks once per page, one request per allowed tab, and shows "--" until the answer', async () => {
    const counts = setup();
    const p = vi.fn().mockResolvedValue(7);
    const s = vi.fn().mockResolvedValue(0);
    const loaders = { priorities: p, 'status-labels': s };
    const priorities = counts.count('priorities');
    const started = counts.start(TABS, loaders, can);
    expect(priorities()).toBe('--');
    expect(counts.snapshot()).toEqual({ priorities: null, 'status-labels': null });
    await started;
    expect(priorities()).toBe(7);
    expect(counts.count('status-labels')()).toBe(0);
    await counts.start(TABS, loaders, can); // a second start (a re-render) asks for nothing
    expect(p).toHaveBeenCalledTimes(1);
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('asks for nothing a person may not open', async () => {
    const counts = setup();
    const p = vi.fn().mockResolvedValue(7);
    const s = vi.fn().mockResolvedValue(3);
    await counts.start(TABS, { priorities: p, 'status-labels': s }, has('StatusLabel.Manage'));
    expect(p).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
    expect(counts.snapshot()).toEqual({ 'status-labels': 3 });
  });

  it('runs the request quiet, and a failure leaves "--" without throwing', async () => {
    const counts = setup();
    const quiet = TestBed.inject(QuietRequests);
    let wasQuiet = false;
    const loader = vi.fn(() => {
      wasQuiet = quiet.active;
      return Promise.reject(new Error('down'));
    });
    await counts.start(TABS, { priorities: loader }, can);
    expect(wasQuiet).toBe(true);
    expect(quiet.active).toBe(false);
    expect(counts.count('priorities')()).toBe('--');
    expect(counts.snapshot()['priorities']).toBeNull();
  });

  it('refreshes after an edit, replacing the number, and keeps the old number if the refresh fails', async () => {
    const counts = setup();
    const loader = vi
      .fn()
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockRejectedValueOnce(new Error('down'));
    await counts.start(TABS, { priorities: loader }, can);
    expect(counts.count('priorities')()).toBe(5);
    await counts.refresh('priorities'); // created one
    expect(counts.count('priorities')()).toBe(6);
    await counts.refresh('priorities'); // failed: still 6
    expect(counts.count('priorities')()).toBe(6);
    await counts.refresh('unknown'); // nothing registered: nothing happens
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('keeps the number the open tab reported, and a gone tab reports nothing', async () => {
    const counts = setup();
    const fixture = TestBed.createComponent(Child);
    let resolve!: (n: number) => void;
    const slow = new Promise<number>((r) => (resolve = r));
    const started = counts.start(TABS, { 'status-labels': () => slow }, can);
    fixture.componentInstance.report(9);
    resolve(4); // the answer that was on its way does not overwrite the newer number
    await started;
    expect(counts.count('status-labels')()).toBe(9);
    fixture.destroy();
    fixture.componentInstance.report(1);
    expect(counts.count('status-labels')()).toBe(9);
  });
});
