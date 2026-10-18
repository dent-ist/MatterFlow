import { TestBed } from '@angular/core/testing';
import { WORK_COLUMNS, columnScope } from './column-prefs';
import { columnWidthRem, pxToRem, remToPx } from './column-widths';
import {
  WorkWidths,
  hasWidths,
  loadWidths,
  resetWidth,
  resetWidths,
  saveWidth,
  widthsKey,
} from './work-widths';

const TQ = columnScope('queue', null);
const MY = columnScope('my-work', 'active');

describe('work widths (#203)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('names the key per scope and user, like the column sets', () => {
    expect(widthsKey('taskQueue', 7)).toBe('mf.work-widths.v1.taskQueue.7');
    expect(widthsKey(columnScope('my-work', 'dueSoon'), null)).toBe(
      'mf.work-widths.v1.myWork.dueSoon.anon',
    );
    expect(widthsKey(columnScope('pod-work', 'attention'), 3)).toBe(
      'mf.work-widths.v1.podWork.attention.3',
    );
    expect(widthsKey(columnScope('my-work', 'completed'), 3)).toBe(
      'mf.work-widths.v1.myWork.closed.3',
    );
  });

  it('round trips a width in rem as integer px at the 14 px root, sparse', () => {
    saveWidth(TQ, 7, 'due', pxToRem(180));
    expect(JSON.parse(localStorage.getItem('mf.work-widths.v1.taskQueue.7')!)).toEqual({
      v: 1,
      w: { due: 180 },
    });
    expect(loadWidths(TQ, 7)).toEqual({ due: 180 / 14 });
    expect(remToPx(loadWidths(TQ, 7)['due'])).toBe(180);
    expect(hasWidths(TQ, 7)).toBe(true);
  });

  it('stores nothing for the default, the Title, unknown keys and non-numbers', () => {
    saveWidth(TQ, 7, 'due', pxToRem(136));
    saveWidth(TQ, 7, 'title', 20);
    saveWidth(TQ, 7, 'foo', 20);
    saveWidth(TQ, 7, 'matter', NaN);
    expect(localStorage.length).toBe(0);
    saveWidth(TQ, 7, 'due', pxToRem(150));
    saveWidth(TQ, 7, 'due', pxToRem(136));
    expect(localStorage.length).toBe(0);
  });

  it('clamps on write and on read to the current limits', () => {
    saveWidth(TQ, 7, 'due', 99);
    expect(JSON.parse(localStorage.getItem(widthsKey(TQ, 7))!).w.due).toBe(200);
    localStorage.setItem(widthsKey(TQ, 7), '{"v":1,"w":{"due":9999,"matter":1,"foo":5}}');
    const w = loadWidths(TQ, 7);
    expect(w['due']).toBe(pxToRem(200));
    expect(w['matter']).toBe(pxToRem(112));
    expect(w['foo']).toBeUndefined();
  });

  it('ignores the Title, strings, nulls, a wrong version and corrupt JSON', () => {
    localStorage.setItem(
      widthsKey(TQ, 7),
      '{"v":1,"w":{"due":132,"title":300,"matter":"x","age":null}}',
    );
    expect(loadWidths(TQ, 7)).toEqual({ due: 132 / 14 });
    localStorage.setItem(widthsKey(TQ, 7), '{"v":2,"w":{"due":132}}');
    expect(loadWidths(TQ, 7)).toEqual({});
    for (const bad of ['{', 'null', '[]', '"x"', '{"v":1}', '{"v":1,"w":5}']) {
      localStorage.setItem(widthsKey(TQ, 7), bad);
      expect(loadWidths(TQ, 7)).toEqual({});
    }
  });

  it('keeps scopes and users apart, with no fallback between them', () => {
    saveWidth(TQ, 7, 'due', pxToRem(180));
    expect(loadWidths(MY, 7)).toEqual({});
    expect(loadWidths(TQ, 8)).toEqual({});
    saveWidth(MY, 7, 'due', pxToRem(150));
    expect(remToPx(loadWidths(TQ, 7)['due'])).toBe(180);
    expect(remToPx(loadWidths(MY, 7)['due'])).toBe(150);
  });

  it('resets one column or the whole scope only, and leaves the column set alone', () => {
    localStorage.setItem('mf.work-columns.v2.taskQueue.7', '["ref","title"]');
    saveWidth(TQ, 7, 'due', pxToRem(180));
    saveWidth(TQ, 7, 'matter', pxToRem(200));
    saveWidth(MY, 7, 'due', pxToRem(150));
    resetWidth(TQ, 7, 'due');
    expect(Object.keys(loadWidths(TQ, 7))).toEqual(['matter']);
    resetWidths(TQ, 7);
    expect(localStorage.getItem(widthsKey(TQ, 7))).toBeNull();
    expect(hasWidths(TQ, 7)).toBe(false);
    expect(localStorage.getItem(widthsKey(MY, 7))).not.toBeNull();
    expect(localStorage.getItem('mf.work-columns.v2.taskQueue.7')).not.toBeNull();
  });

  it('never throws when storage is blocked, full or missing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadWidths(TQ, 7)).toEqual({});
    expect(() => saveWidth(TQ, 7, 'due', 12)).not.toThrow();
    expect(() => resetWidth(TQ, 7, 'due')).not.toThrow();
    expect(() => resetWidths(TQ, 7)).not.toThrow();
    expect(hasWidths(TQ, 7)).toBe(false);
    const store = TestBed.inject(WorkWidths);
    expect(() => store.set(TQ, 7, 'due', pxToRem(150))).not.toThrow();
    // The visit still has the width, though nothing persisted.
    expect(remToPx(store.widths(TQ, 7)['due'])).toBe(150);
  });

  it('feeds the grid: columnWidthRem takes the stored width over the default', () => {
    saveWidth(TQ, 7, 'due', pxToRem(180));
    const due = WORK_COLUMNS.find((c) => c.key === 'due')!;
    expect(columnWidthRem(due, loadWidths(TQ, 7))).toBe(180 / 14);
    expect(columnWidthRem(due, loadWidths(MY, 7))).toBe(136 / 14);
  });
});

describe('WorkWidths store (#203)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('reads storage once per scope, follows set, reset and resetAll at once, per scope', () => {
    localStorage.setItem(widthsKey(TQ, 7), '{"v":1,"w":{"due":180}}');
    const store = TestBed.inject(WorkWidths);
    expect(remToPx(store.widths(TQ, 7)['due'])).toBe(180);
    expect(store.widths(MY, 7)).toEqual({});
    const same = store.widths(TQ, 7);
    expect(store.widths(TQ, 7)).toBe(same);

    store.set(MY, 7, 'due', pxToRem(150));
    expect(remToPx(store.widths(MY, 7)['due'])).toBe(150);
    expect(remToPx(store.widths(TQ, 7)['due'])).toBe(180);
    expect(JSON.parse(localStorage.getItem(widthsKey(MY, 7))!).w).toEqual({ due: 150 });

    store.set(TQ, 7, 'matter', pxToRem(200));
    expect(store.has(TQ, 7)).toBe(true);
    store.reset(TQ, 7, 'due');
    expect(Object.keys(store.widths(TQ, 7))).toEqual(['matter']);
    store.resetAll(TQ, 7);
    expect(store.has(TQ, 7)).toBe(false);
    expect(localStorage.getItem(widthsKey(TQ, 7))).toBeNull();
    expect(store.has(MY, 7)).toBe(true);
  });

  it('a default that differs (Pod Work Assignee) is not stored', () => {
    const store = TestBed.inject(WorkWidths);
    store.set(columnScope('pod-work', null), 7, 'assignee', pxToRem(216), pxToRem(216));
    expect(store.has(columnScope('pod-work', null), 7)).toBe(false);
  });
});
