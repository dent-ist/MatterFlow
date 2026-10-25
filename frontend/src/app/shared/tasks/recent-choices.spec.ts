import {
  flagFocusReturn,
  lastMatterId,
  parseIds,
  recentTypeIds,
  rememberMatter,
  rememberType,
  takeFocusReturn,
  withRecentType,
} from './recent-choices';

describe('recent task choices (#814)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('keeps the last three types, newest first, without duplicates', () => {
    expect(withRecentType([], 5)).toEqual([5]);
    expect(withRecentType([5, 6, 7], 8)).toEqual([8, 5, 6]);
    expect(withRecentType([5, 6, 7], 7)).toEqual([7, 5, 6]);
    expect(withRecentType([5, 6], 6)).toEqual([6, 5]);
  });

  it('remembers per person', () => {
    rememberType(1, 10);
    rememberType(1, 11);
    rememberType(2, 99);
    expect(recentTypeIds(1)).toEqual([11, 10]);
    expect(recentTypeIds(2)).toEqual([99]);
    expect(recentTypeIds(3)).toEqual([]);
    rememberMatter(1, 7);
    expect(lastMatterId(1)).toBe(7);
    expect(lastMatterId(2)).toBeNull();
  });

  it('ignores what is not a list of positive whole numbers', () => {
    expect(parseIds(null)).toEqual([]);
    expect(parseIds('nope')).toEqual([]);
    expect(parseIds('{"a":1}')).toEqual([]);
    expect(parseIds('[1,"2",-3,4.5,0,6]')).toEqual([1, 6]);
    expect(parseIds('[1,2,3,4,5]')).toEqual([1, 2, 3]);
  });

  it('works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(recentTypeIds(1)).toEqual([]);
    expect(lastMatterId(1)).toBeNull();
    expect(() => rememberType(1, 2)).not.toThrow();
    expect(takeFocusReturn()).toBe(false);
    vi.restoreAllMocks();
  });

  it('gives the focus back once, within half an hour', () => {
    flagFocusReturn(1_000);
    expect(takeFocusReturn(2_000)).toBe(true);
    expect(takeFocusReturn(2_000)).toBe(false);
    flagFocusReturn(1_000);
    expect(takeFocusReturn(1_000 + 31 * 60_000)).toBe(false);
  });
});
