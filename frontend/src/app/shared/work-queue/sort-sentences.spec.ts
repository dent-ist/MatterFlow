import { directionWords, sortKind } from './sort-sentences';

describe('sort sentences (issue #898)', () => {
  it('says what comes first, never ascending or descending', () => {
    expect(directionWords('priority', 'asc')).toBe('most urgent first');
    expect(directionWords('priority', 'desc')).toBe('least urgent first');
    expect(directionWords('priorityAge', 'asc')).toBe('most urgent first');
    expect(directionWords('due', 'asc')).toBe('soonest first');
    expect(directionWords('due', 'desc')).toBe('latest first');
    expect(directionWords('created', 'asc')).toBe('oldest first');
    expect(directionWords('created', 'desc')).toBe('newest first');
    expect(directionWords('title', 'asc')).toBe('A to Z');
    expect(directionWords('title', 'desc')).toBe('Z to A');
    expect(directionWords('number', 'asc')).toBe('lowest first');
  });

  it('reads the Task Queue Age as the creation date reversed: ascending age is the newest task first', () => {
    expect(directionWords('age', 'asc')).toBe('newest first');
    expect(directionWords('age', 'desc')).toBe('oldest first');
  });

  it("reads a list's own count field as a count and an unknown field as text", () => {
    expect(directionWords('openTasks', 'desc', 'count')).toBe('most first');
    expect(directionWords('openTasks', 'asc', 'count')).toBe('fewest first');
    expect(sortKind('somethingNew')).toBe('text');
  });
});
