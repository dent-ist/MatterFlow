import { NAV_ITEMS, mainNav } from './nav-items';

const labels = (items: readonly { label: string }[]): string[] => items.map((i) => i.label);

describe('main menu order (MM-59, #951)', () => {
  it('is one order for everybody: Dashboard, My Matters, My Work, Clients, Matters, Projects, Assets, People, Vendors, Pod Work, Task Queue, Reports', () => {
    expect(labels(mainNav(NAV_ITEMS, false))).toEqual([
      'Dashboard',
      'My Matters',
      'My Work',
      'Clients',
      'Matters',
      'Projects',
      'Assets',
      'People',
      'Vendors',
      'Pod Work',
      'Task Queue',
      'Reports',
    ]);
  });

  it('indents Projects and Assets, and only those, as normal links under Matters', () => {
    const items = mainNav(NAV_ITEMS, false);
    expect(items.filter((i) => i.child).map((i) => i.label)).toEqual(['Projects', 'Assets']);
    const at = (l: string): number => items.findIndex((i) => i.label === l);
    expect(at('Projects')).toBe(at('Matters') + 1);
    expect(at('Assets')).toBe(at('Matters') + 2);
  });

  it('for a person who lands on My Matters: the Task Queue keeps its name "Task Queue" (no compact "Tasks" label), no Pod Work, nothing else changes', () => {
    expect(labels(mainNav(NAV_ITEMS, true))).toEqual([
      'Dashboard',
      'My Matters',
      'My Work',
      'Clients',
      'Matters',
      'Projects',
      'Assets',
      'People',
      'Vendors',
      'Task Queue',
      'Reports',
    ]);
  });

  it('lists Reports last for Report.Run holders, in the compact menu too (#718, #775): it is plain data, no compact flag', () => {
    const reports = NAV_ITEMS.find((i) => i.label === 'Reports')!;
    expect(reports.path).toBe('/reports');
    expect(reports.permissions).toEqual(['Report.Run']);
    expect(reports.hideWhenCompact).toBeUndefined();
    expect(NAV_ITEMS.at(-1)).toBe(reports);
  });

  it('keeps every item reachable by path and gives each its own permission rule', () => {
    for (const item of NAV_ITEMS) expect(item.permissions.length, item.label).toBeGreaterThan(0);
    expect(new Set(NAV_ITEMS.map((i) => i.path)).size).toBe(NAV_ITEMS.length);
  });
});
