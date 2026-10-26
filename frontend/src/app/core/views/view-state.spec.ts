import { fitsViewState, isViewState, mergeViewState } from './view-state';

describe('view state helpers', () => {
  it('merges defaults, remembered state and the address, the address winning', () => {
    const defaults = { sort: 'due', types: [] as number[], dir: 'asc' };
    expect(mergeViewState(defaults, null, null)).toEqual(defaults);
    expect(mergeViewState(defaults, { sort: 'priority', types: [1] }, null)).toEqual({
      sort: 'priority',
      types: [1],
      dir: 'asc',
    });
    expect(mergeViewState(defaults, { sort: 'priority', types: [1] }, { types: [5] })).toEqual({
      sort: 'priority',
      types: [5],
      dir: 'asc',
    });
    expect(mergeViewState(defaults, { sort: 'priority' }, { sort: undefined }).sort).toBe(
      'priority',
    );
  });

  it('accepts only small plain objects', () => {
    expect(isViewState({})).toBe(true);
    expect(isViewState([])).toBe(false);
    expect(isViewState(null)).toBe(false);
    expect(fitsViewState({ a: 'x'.repeat(100) })).toBe(true);
    expect(fitsViewState({ a: 'x'.repeat(5000) })).toBe(false);
  });
});
