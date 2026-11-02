import {
  GridColumnDef,
  GridPrefs,
  gridPrefsKey,
  loadGridPrefs,
  moveBefore,
  moveKey,
  orderedKeys,
  saveGridPrefs,
  shownKeys,
  withVisible,
} from './grid-prefs';

const DEFS: GridColumnDef[] = [
  { key: 'ref', label: 'Ref', locked: true, pinned: true },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title', locked: true },
  { key: 'project', label: 'Project', defaultHidden: true },
  { key: 'due', label: 'Due' },
];
const NONE: GridPrefs = { order: [], visible: null };

describe('grid prefs (MD-28, #1032)', () => {
  beforeEach(() => localStorage.clear());

  it('shows the defaults when nothing was chosen: defaultHidden stays out, locked is in', () => {
    expect(shownKeys(DEFS, NONE)).toEqual(['ref', 'type', 'title', 'due']);
  });

  it('keeps a stored order, places a column it does not know after its predecessor and keeps pinned first', () => {
    const prefs: GridPrefs = { order: ['due', 'title', 'type', 'ref'], visible: null };
    expect(orderedKeys(DEFS, prefs)).toEqual(['ref', 'due', 'title', 'project', 'type']);
    expect(orderedKeys(DEFS, { order: ['ref', 'type', 'due'], visible: null })).toEqual([
      'ref',
      'type',
      'title',
      'project',
      'due',
    ]);
  });

  it('ignores unknown and repeated keys in a stored order', () => {
    expect(orderedKeys(DEFS, { order: ['x', 'due', 'due'], visible: null })).toEqual([
      'ref',
      'type',
      'title',
      'project',
      'due',
    ]);
  });

  it('moves a column one place among the shown ones and never past a pinned column', () => {
    expect(moveKey(DEFS, NONE, 'title', -1).slice(0, 4)).toEqual([
      'ref',
      'title',
      'type',
      'project',
    ]);
    expect(moveKey(DEFS, NONE, 'type', -1)).toEqual(orderedKeys(DEFS, NONE)); // Ref is pinned
    expect(moveKey(DEFS, NONE, 'ref', 1)).toEqual(orderedKeys(DEFS, NONE));
    // the hidden Project column does not swallow a press
    expect(moveKey(DEFS, NONE, 'title', 1)).toEqual(['ref', 'type', 'project', 'due', 'title']);
  });

  it('drops a column before another one, or at the end', () => {
    expect(moveBefore(DEFS, NONE, 'due', 'type')).toEqual([
      'ref',
      'due',
      'type',
      'title',
      'project',
    ]);
    expect(moveBefore(DEFS, NONE, 'type', null).at(-1)).toBe('type');
    expect(moveBefore(DEFS, NONE, 'due', 'ref')).toEqual(orderedKeys(DEFS, NONE));
  });

  it('shows and hides; a locked column cannot be hidden', () => {
    const visible = withVisible(DEFS, NONE, 'project', true);
    expect(shownKeys(DEFS, { order: [], visible })).toContain('project');
    const hidden = withVisible(DEFS, { order: [], visible }, 'due', false);
    expect(shownKeys(DEFS, { order: [], visible: hidden })).not.toContain('due');
    expect(withVisible(DEFS, NONE, 'title', false)).toContain('title');
  });

  it('round-trips through storage per person and ignores corrupt data; blocked storage never throws', () => {
    const key = gridPrefsKey('tasks', 7);
    expect(key).toBe('mf.grid.v1.tasks.7');
    expect(gridPrefsKey('tasks', null)).toBe('mf.grid.v1.tasks.anon');
    saveGridPrefs(key, { order: ['a', 'b'], visible: ['a'] });
    expect(loadGridPrefs(key)).toEqual({ order: ['a', 'b'], visible: ['a'] });
    localStorage.setItem(key, '{nope');
    expect(loadGridPrefs(key)).toEqual(NONE);
    localStorage.setItem(key, JSON.stringify({ v: 1, o: [1], s: 'x' }));
    expect(loadGridPrefs(key)).toEqual(NONE);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadGridPrefs(key)).toEqual(NONE);
    expect(() => saveGridPrefs(key, NONE)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});
