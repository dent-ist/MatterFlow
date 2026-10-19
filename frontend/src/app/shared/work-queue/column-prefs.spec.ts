/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_COLUMNS,
  WORK_COLUMNS,
  columnScope,
  defaultColumns,
  loadColumns,
  loadDensity,
  loadLastPod,
  loadPageSize,
  savePageSize,
  loadPrefs,
  normalizeColumns,
  resetColumns,
  saveColumns,
  saveDensity,
  saveLastPod,
  columnsNoticePending,
  dismissColumnsNotice,
} from './column-prefs';
import { ASSIGNEE_WITH_LINK_PX } from './column-widths';

const OLD_MY_WORK = ['ref', 'title', 'matter', 'priority', 'progress', 'due', 'status'];

describe('work table preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('remembers the page size per page and user, ignores sizes the pager does not offer', () => {
    expect(loadPageSize('queue', 7)).toBeNull();
    savePageSize('queue', 7, 100);
    expect(loadPageSize('queue', 7)).toBe(100);
    expect(loadPageSize('queue', 8)).toBeNull();
    expect(loadPageSize('my-work', 7)).toBeNull();
    localStorage.setItem('mf.work-table.v3.queue.7.page-size', '33');
    expect(loadPageSize('queue', 7)).toBeNull();
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
    // #198: Matter is in every default set again (two-line cell, #197).
    const active = [
      'ref',
      'title',
      'matter',
      'matterName',
      'progress',
      'priority',
      'due',
      'status',
    ];
    expect(defaultColumns('myWork.active')).toEqual(normalizeColumns(active));
    expect(defaultColumns('myWork.dueSoon')).toEqual(normalizeColumns(active));
    // C2: finished work has no progress, priority or due date by default.
    expect(defaultColumns('myWork.closed')).toEqual(
      normalizeColumns(['ref', 'title', 'matter', 'matterName', 'closed', 'status']),
    );
    // B1, B3: where did the work I handed off go.
    expect(defaultColumns('myWork.createdByMe')).toEqual(
      normalizeColumns([
        'ref',
        'title',
        'matter',
        'matterName',
        'priority',
        'assignee',
        'due',
        'status',
        'age',
      ]),
    );
    for (const sc of [
      'taskQueue',
      'podWork.all',
      'myWork.active',
      'myWork.dueSoon',
      'myWork.closed',
      'myWork.createdByMe',
    ]) {
      expect(defaultColumns(sc)).toContain('matter');
      expect(defaultColumns(sc)).toContain('matterName');
      expect(defaultColumns(sc)).not.toContain('client');
    }
    expect(defaultColumns('podWork.all')).toEqual(defaultColumns('podWork'));
    // The Closed tab shows the Closed column by default (C1); Active does not.
    expect(defaultColumns('myWork.closed')).toContain('closed');
    expect(defaultColumns('myWork.active')).not.toContain('closed');
    expect(defaultColumns('unknown.tab')).toEqual(defaultColumns('taskQueue'));
  });

  it('remembers columns per user, page and tab, and density per page', () => {
    saveColumns('myWork.active', 1, ['ref', 'title', 'matter', 'client']);
    expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'matter', 'client']);
    // Another tab keeps its default; another user and another page are untouched.
    expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
    expect(loadColumns('myWork.active', 2)).toEqual(defaultColumns('myWork.active'));
    expect(loadColumns('taskQueue', 1)).toEqual(defaultColumns('taskQueue'));

    saveDensity('my-work', 1, 'compact');
    expect(loadPrefs('my-work', 1, 'completed')).toEqual({
      columns: defaultColumns('myWork.closed'),
      density: 'compact',
    });
    expect(loadPrefs('my-work', 1, 'active').columns).toEqual(['ref', 'title', 'matter', 'client']);
    expect(loadDensity('queue', 1)).toBe('comfortable');
  });

  it('resets only the scope it is asked for', () => {
    saveColumns('myWork.active', 1, ['ref', 'title', 'matter', 'client']);
    saveColumns('myWork.closed', 1, ['ref', 'title', 'pod']);
    resetColumns('myWork.closed', 1);
    expect(loadColumns('myWork.closed', 1)).toEqual(defaultColumns('myWork.closed'));
    expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'matter', 'client']);
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
      legacy('my-work', ['ref', 'title', 'matter', 'due']);
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'matter', 'due']);
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
      legacy('my-work', ['ref', 'title', 'matter', 'due']);
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'matter', 'due']);
      resetColumns('myWork.active', 1);
      expect(loadColumns('myWork.active', 1)).toEqual(defaultColumns('myWork.active'));
    });
  });

  describe('Matter Name migration (#348)', () => {
    const OLD_QUEUE = ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status'];
    const stored = (scope: string, id: number) =>
      JSON.parse(localStorage.getItem(`mf.work-columns.v2.${scope}.${id}`) ?? 'null');

    it('puts Matter Name into the default of every page and tab, next to Matter Number', () => {
      for (const sc of ['taskQueue', 'podWork', 'myWork', 'myWork.closed', 'myWork.createdByMe']) {
        const cols = defaultColumns(sc);
        expect(cols.indexOf('matterName'), sc).toBe(cols.indexOf('matter') + 1);
      }
    });

    it('drops a stored set equal to the old default, so the new default (with Matter Name) applies', () => {
      saveColumns('taskQueue', 1, OLD_QUEUE);
      saveColumns('podWork.all', 1, OLD_QUEUE);
      saveColumns('myWork.active', 1, OLD_MY_WORK);
      saveColumns('myWork.closed', 1, ['ref', 'title', 'matter', 'closed', 'status']);
      expect(loadColumns('taskQueue', 1)).toEqual(defaultColumns('taskQueue'));
      expect(loadColumns('taskQueue', 1)).toContain('matterName');
      expect(loadColumns('podWork.all', 1)).toContain('matterName');
      expect(loadColumns('myWork.active', 1)).toContain('matterName');
      expect(loadColumns('myWork.closed', 1)).toContain('matterName');
      expect(stored('taskQueue', 1)).toBeNull();
    });

    it('leaves a customised set alone, once: the column is added by the user afterwards', () => {
      saveColumns('taskQueue', 1, [...OLD_QUEUE, 'client']);
      saveColumns('myWork.active', 1, ['ref', 'title', 'matter', 'due']);
      expect(loadColumns('taskQueue', 1)).toEqual(normalizeColumns([...OLD_QUEUE, 'client']));
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'matter', 'due']);
      // Idempotent: a later choice that happens to equal the old default is a choice and stays.
      saveColumns('taskQueue', 1, OLD_QUEUE);
      expect(loadColumns('taskQueue', 1)).toEqual(normalizeColumns(OLD_QUEUE));
    });

    it('leaves another user and a page without a stored set alone', () => {
      saveColumns('taskQueue', 1, OLD_QUEUE);
      loadColumns('taskQueue', 1);
      expect(loadColumns('taskQueue', 2)).toEqual(defaultColumns('taskQueue'));
      expect(loadColumns('myWork.active', 1)).toEqual(defaultColumns('myWork.active'));
    });
  });

  describe('Matter migration (#198)', () => {
    const flag = (page: string, id: number) => `mf.work-columns.v3.migrated.${page}.${id}`;
    const stored = (scope: string, id: number) =>
      JSON.parse(localStorage.getItem(`mf.work-columns.v2.${scope}.${id}`) ?? 'null');

    it('inserts Matter after Title in a My Work set without it, once', () => {
      saveColumns('myWork.active', 1, ['ref', 'title', 'progress', 'priority', 'due', 'status']);
      saveColumns('myWork.createdByMe', 1, ['ref', 'title', 'assignee']);
      expect(loadColumns('myWork.active', 1)).toEqual([
        'ref',
        'title',
        'matter',
        'progress',
        'priority',
        'due',
        'status',
      ]);
      expect(stored('myWork.createdByMe', 1)).toEqual(['ref', 'title', 'matter', 'assignee']);
      expect(columnsNoticePending('my-work', 1)).toBe(true);
      // Idempotent: the user takes Matter out again and it stays out.
      saveColumns('myWork.active', 1, ['ref', 'title', 'due']);
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'due']);
    });

    it('keeps a set that has Matter, and the Closed set', () => {
      saveColumns('myWork.active', 1, ['ref', 'title', 'matter', 'due']);
      saveColumns('myWork.closed', 1, ['ref', 'title', 'closed']);
      expect(loadColumns('myWork.active', 1)).toEqual(['ref', 'title', 'matter', 'due']);
      expect(loadColumns('myWork.closed', 1)).toEqual(['ref', 'title', 'closed']);
    });

    it('keeps a Task Queue and Pod Work choice without Matter and shows the notice', () => {
      saveColumns('taskQueue', 1, ['ref', 'title', 'status']);
      saveColumns('podWork.all', 1, ['ref', 'title', 'status']);
      expect(loadColumns('taskQueue', 1)).toEqual(['ref', 'title', 'status']);
      expect(loadColumns('podWork.all', 1)).toEqual(['ref', 'title', 'status']);
      expect(columnsNoticePending('queue', 1)).toBe(true);
      expect(columnsNoticePending('pod-work', 1)).toBe(true);
    });

    it('shows no notice and stores nothing extra for a user without a stored set', () => {
      expect(loadColumns('myWork.active', 2)).toEqual(defaultColumns('myWork.active'));
      expect(columnsNoticePending('my-work', 2)).toBe(false);
      expect(localStorage.getItem(flag('my-work', 2))).toBe('done');
    });

    it('remembers the dismissal, per page and user', () => {
      saveColumns('taskQueue', 1, ['ref', 'title']);
      saveColumns('myWork.active', 1, ['ref', 'title']);
      expect(columnsNoticePending('queue', 1)).toBe(true);
      dismissColumnsNotice('queue', 1);
      expect(columnsNoticePending('queue', 1)).toBe(false);
      expect(columnsNoticePending('my-work', 1)).toBe(true);
    });

    it('handles a corrupt value and blocked storage without throwing', () => {
      localStorage.setItem('mf.work-columns.v2.myWork.active.1', '{oops');
      expect(loadColumns('myWork.active', 1)).toEqual(defaultColumns('myWork.active'));
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(columnsNoticePending('my-work', 3)).toBe(false);
      expect(loadColumns('myWork.active', 3)).toEqual(defaultColumns('myWork.active'));
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

  it('docs/ux/tokens.css repeats the column widths of the contract (ux-spec 5.2): default, minimum and maximum', () => {
    const css = readFileSync(join(process.cwd(), '..', 'docs', 'ux', 'tokens.css'), 'utf8');
    const token = (name: string): number | null => {
      const m = css.match(new RegExp(`--mf-col-${name}:\\s*(\\d+)px`));
      return m ? Number(m[1]) : null;
    };
    for (const def of WORK_COLUMNS) {
      if (def.fill) {
        expect(token(`${def.key}-min`)).toBe(def.minWidth);
        continue;
      }
      expect(token(`${def.key}-w`), `${def.key} default`).toBe(def.width);
      expect(token(`${def.key}-min`), `${def.key} minimum`).toBe(def.minWidth);
      expect(token(`${def.key}-max`), `${def.key} maximum`).toBe(def.maxWidth);
    }
    expect(token('assignee-pod-work-w')).toBe(ASSIGNEE_WITH_LINK_PX);
  });
});
