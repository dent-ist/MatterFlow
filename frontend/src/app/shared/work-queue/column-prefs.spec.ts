import {
  DEFAULT_COLUMNS,
  loadLastPod,
  loadPrefs,
  normalizeColumns,
  saveLastPod,
  savePrefs,
} from './column-prefs';

describe('work table preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('always keeps Ref and Title and drops unknown columns', () => {
    expect(normalizeColumns(['status', 'bogus'])).toEqual(['ref', 'title', 'status']);
    expect(normalizeColumns([])).toEqual(['ref', 'title']);
  });

  it('starts from the defaults of each screen', () => {
    expect(loadPrefs('queue', 1).columns).toEqual(normalizeColumns(DEFAULT_COLUMNS.queue));
    expect(loadPrefs('my-work', 1).columns).toContain('progress');
    expect(loadPrefs('queue', 1).density).toBe('comfortable');
  });

  it('remembers columns and density per user and screen', () => {
    savePrefs('queue', 1, { columns: ['ref', 'title', 'client'], density: 'compact' });
    expect(loadPrefs('queue', 1)).toEqual({
      columns: ['ref', 'title', 'client'],
      density: 'compact',
    });
    expect(loadPrefs('queue', 2).columns).toEqual(normalizeColumns(DEFAULT_COLUMNS.queue));
    expect(loadPrefs('my-work', 1).density).toBe('comfortable');
  });

  it('falls back to the defaults for damaged data', () => {
    localStorage.setItem('mf.work-table.v1.queue.1', '{not json');
    expect(loadPrefs('queue', 1).columns).toEqual(normalizeColumns(DEFAULT_COLUMNS.queue));
    localStorage.setItem('mf.work-table.v1.queue.1', JSON.stringify({ columns: 'x', density: 5 }));
    expect(loadPrefs('queue', 1).density).toBe('comfortable');
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadPrefs('queue', 1).columns).toEqual(normalizeColumns(DEFAULT_COLUMNS.queue));
    expect(() => savePrefs('queue', 1, { columns: ['ref'], density: 'compact' })).not.toThrow();
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
