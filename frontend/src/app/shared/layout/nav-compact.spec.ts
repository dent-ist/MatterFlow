import { NAV_ITEMS, compactNav } from './nav-items';

describe('compactNav (the menu of a person who lands on My Matters, epic #758)', () => {
  it('puts My Matters, Matters, Tasks and Assets in the main list and no Pod Work anywhere', () => {
    const { main, more } = compactNav(NAV_ITEMS);
    expect(main.map((i) => i.label)).toEqual([
      'Dashboard',
      'My Matters',
      'Matters',
      'Tasks',
      'Assets',
    ]);
    expect([...main, ...more].some((i) => i.path === '/pods/work')).toBe(false);
  });

  it('keeps every other route reachable behind More, in the order Clients, Projects, My Work', () => {
    const { more } = compactNav(NAV_ITEMS);
    expect(more.map((i) => [i.label, i.path])).toEqual([
      ['Clients', '/clients'],
      ['Projects', '/projects'],
      ['My Work', '/my-work'],
    ]);
  });

  it('never loses an item: everything except Pod Work is in one of the two lists, and the rule is data on the items', () => {
    const { main, more } = compactNav(NAV_ITEMS);
    const kept = new Set([...main, ...more].map((i) => i.path));
    for (const item of NAV_ITEMS) {
      expect(kept.has(item.path), item.label).toBe(item.compact !== 'hide');
    }
  });

  it('renames Task Queue to Tasks only in the compact menu', () => {
    expect(compactNav(NAV_ITEMS).main.find((i) => i.path === '/tasks')?.label).toBe('Tasks');
    expect(NAV_ITEMS.find((i) => i.path === '/tasks')?.label).toBe('Task Queue');
  });
});
