import { aComment } from './task-panels-testing';
import {
  countNew,
  latestOf,
  readOpen,
  readSeen,
  requestInitiallyOpen,
  requestOpenKey,
  saveOpen,
  saveSeen,
} from './section-state';

describe('section-state', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('remembers a flag and reads rubbish as "not set"', () => {
    expect(readOpen('k')).toBeNull();
    saveOpen('k', true);
    expect(readOpen('k')).toBe(true);
    saveOpen('k', false);
    expect(readOpen('k')).toBe(false);
    localStorage.setItem('k', 'maybe');
    expect(readOpen('k')).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readOpen('k')).toBeNull();
    expect(() => saveOpen('k', true)).not.toThrow();
    expect(readSeen(1, 2)).toBeNull();
    expect(() => saveSeen(1, 2, 3)).not.toThrow();
  });

  it('keeps the seen time per user and task, the most recent 200 tasks only', () => {
    saveSeen(1, 10, 111);
    saveSeen(2, 10, 222);
    expect(readSeen(1, 10)).toBe(111);
    expect(readSeen(2, 10)).toBe(222);
    expect(readSeen(1, 11)).toBeNull();
    for (let id = 100; id < 300; id++) saveSeen(1, id, id);
    expect(readSeen(1, 10)).toBeNull(); // pushed out
    expect(readSeen(1, 299)).toBe(299);
    expect(readSeen(2, 10)).toBe(222); // another user's list is separate
  });

  it('counts comments by others after the seen time; nothing on a first visit', () => {
    const at = (id: number, time: string, user = 9) =>
      aComment({
        commentId: id,
        createdAtUtc: time,
        author: { userId: user, displayName: 'X', isActive: true },
      });
    const items = [
      at(1, '2026-10-13T10:00:00Z'),
      at(2, '2026-10-13T13:00:00Z'),
      at(3, '2026-10-13T14:00:00Z', 1),
    ];
    const seen = Date.parse('2026-10-13T12:00:00Z');
    expect(countNew(items, seen, 1)).toBe(1);
    expect(countNew(items, seen, 5)).toBe(2);
    expect(countNew(items, null, 5)).toBe(0);
    expect(latestOf(items)?.commentId).toBe(3);
    expect(latestOf([])).toBeNull();
  });
});

describe('request details state (#313)', () => {
  beforeEach(() => localStorage.clear());

  it('starts open for 6 fields or fewer and closed for more, unless the person chose for this task type', () => {
    expect(requestInitiallyOpen(1, 7, 5)).toBe(true);
    expect(requestInitiallyOpen(1, 7, 6)).toBe(true);
    expect(requestInitiallyOpen(1, 7, 7)).toBe(false);
    expect(requestInitiallyOpen(1, 7, 14)).toBe(false);
    saveOpen(requestOpenKey(1, 7), true);
    expect(requestInitiallyOpen(1, 7, 14)).toBe(true);
    expect(requestInitiallyOpen(1, 8, 14)).toBe(false); // another type
    expect(requestInitiallyOpen(2, 7, 14)).toBe(false); // another person
    saveOpen(requestOpenKey(1, 7), false);
    expect(requestInitiallyOpen(1, 7, 3)).toBe(false);
  });
});
