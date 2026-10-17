import {
  DEFAULT_COLUMNS,
  columnScope,
  defaultColumns,
  loadColumns,
  loadDensity,
  loadLastPod,
  loadPrefs,
  normalizeColumns,
  resetColumns,
  saveColumns,
  saveDensity,
  saveLastPod,
} from './column-prefs';

const OLD_MY_WORK = ['ref', 'title', 'matter', 'priority', 'progress', 'due', 'status'];

describe('work table preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('always keeps Ref and Title and drops unknown columns', () => {
    expect(normalizeColumns(['status', 'bogus'])).toEqual(['ref', 'title', 'status']);
    expect(normalizeColumns([])).toEqual(['ref', 'title']);
  });

  it('names the scope of a page and tab', () => {
    expect(columnScope('queue', null)).toBe('taskQueue');
    expect(columnScope('my-work', null)).toBe('myWork');
    expect(columnScope('my-work', 'dueSoon')).toBe('myWork.dueSoon');
    expect(columnScope('my-work', 'completed')).toBe('myWork.closed');
    expect(columnScope('pod-work', 'attention')).toBe('podWork.attention');
  });

  it('gives each scope its default and falls back to the page default for a tab without one', () => {
    expect(defaultColumns('taskQueue')).toEqual(normalizeColumns(DEFAULT_COLUMNS['taskQueue']!));
    expect(defaultColumns('myWork.active')).toEqual(normalizeColumns(OLD_MY_WORK));
    expect(defaultColumns('myWork.createdByMe')).toEqual(normalizeColumns(OLD_MY_WORK));
    expect(defaultColumns('podWork.all')).toEqual(defaultColumns('podWork'));
    // The Closed tab shows the Closed column by default (C1); Active does not.
    expect(defaultColumns('myWork.closed')).toContain('closed');
    expect(defaultColumns('myWork.active')).not.toContain('closed');
    expect(defaultColumns('unknown.tab')).toEqual(defaultColumns('taskQueue'));
  });

  it('remembers columns per user, page and tab, and density per page', () => {
    saveColumns('myWork.active', 1, ['ref', 'title', 'client']);
    expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'client']);
    // Another tab keeps its default; another user and another page are untouched.
    expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
    expect(loadColumns('myWork.active', 2)).toEqual(defaultColumns('myWork.active'));
    expect(loadColumns('taskQueue', 1)).toEqual(defaultColumns('taskQueue'));

    saveDensity('my-work', 1, 'compact');
    expect(loadPrefs('my-work', 1, 'completed')).toEqual({
      columns: defaultColumns('myWork.closed'),
      density: 'compact',
    });
    expect(loadPrefs('my-work', 1, 'active').columns).toEqual(['ref', 'title', 'client']);
    expect(loadDensity('queue', 1)).toBe('comfortable');
  });

  it('resets only the scope it is asked for', () => {
    saveColumns('myWork.active', 1, ['ref', 'title', 'client']);
    saveColumns('myWork.closed', 1, ['ref', 'title', 'pod']);
    resetColumns('myWork.closed', 1);
    expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
    expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'client']);
  });

  describe('migration from the one-set-for-all-tabs preference', () => {
    const legacy = (page: string, columns: string[], density = 'comfortable') =>
      localStorage.setItem(`mf.work-table.v3.${page}.1`, JSON.stringify({ columns, density }));

    it('gives a user who never customised the new defaults on every tab', () => {
      legacy('my-work', OLD_MY_WORK, 'compact');
      expect(loadColumns('myWork.active', 1)).toEqual(defaultColumns('myWork.active'));
      expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
      expect(loadDensity('my-work', 1)).toBe('compact');
    });

    it('treats a missing preference like the old default', () => {
      expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
    });

    it('keeps a customised set for the main tab only', () => {
      legacy('my-work', ['ref', 'title', 'due']);
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'due']);
      expect(loadColumns('myWork.dueSoon', 1)).toEqual(defaultColumns('myWork.dueSoon'));
      expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
    });

    it('keeps a customised Task Queue and Pod Work set', () => {
      legacy('queue', ['ref', 'title', 'client']);
      legacy('pod-work', ['ref', 'title', 'pod']);
      expect(loadColumns('taskQueue', 1)).toEqual(['ref', 'title', 'client']);
      expect(loadColumns('podWork.queue', 1)).toEqual(defaultColumns('podWork.queue'));
      expect(loadColumns('podWork', 1)).toEqual(['ref', 'title', 'pod']);
    });

    it('does not bring the old set back after a reset', () => {
      legacy('my-work', ['ref', 'title', 'due']);
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'due']);
      resetColumns('myWork.active', 1);
      expect(loadColumns('myWork.active', 1)).toEqual(defaultColumns('myWork.active'));
    });
  });

  it('falls back to the defaults for damaged data, without an error', () => {
    localStorage.setItem('mf.work-columns.v2.taskQueue.1', '{not json');
    expect(loadColumns('taskQueue', 1)).toEqual(defaultColumns('taskQueue'));
    localStorage.setItem('mf.work-columns.v2.taskQueue.1', JSON.stringify({ columns: 'x' }));
    expect(loadColumns('taskQueue', 1)).toEqual(defaultColumns('taskQueue'));
    localStorage.setItem('mf.work-table.v3.queue.1', JSON.stringify({ columns: 'x', density: 5 }));
    expect(loadDensity('queue', 1)).toBe('comfortable');
    localStorage.setItem('mf.work-table.v3.my-work.1', '{not json');
    expect(loadColumns('myWork.active', 1)).toEqual(defaultColumns('myWork.active'));
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadPrefs('queue', 1).columns).toEqual(defaultColumns('taskQueue'));
    expect(() => {
      saveColumns('taskQueue', 1, ['ref']);
      resetColumns('taskQueue', 1);
      saveDensity('queue', 1, 'compact');
    }).not.toThrow();
    expect(loadLastPod(1)).toBeNull();
    expect(() => saveLastPod(1, 4)).not.toThrow();
  });

  it('remembers the last Pod', () => {
    expect(loadLastPod(1)).toBeNull();
    saveLastPod(1, 4);
    expect(loadLastPod(1)).toBe(4);
    expect(loadLastPod(2)).toBeNull();
  });
});
