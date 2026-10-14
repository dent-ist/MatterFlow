import {
  SEARCH_TYPES,
  highlightParts,
  isSearchable,
  noResultsMessage,
  searchableTypes,
} from './search-meta';

describe('search-meta', () => {
  it('orders the types as the UX spec lists them', () => {
    expect(SEARCH_TYPES.map((t) => t.type)).toEqual([
      'matter',
      'client',
      'task',
      'project',
      'asset',
    ]);
  });

  it('offers only the types whose View permission the user holds', () => {
    const held = new Set(['Client.View', 'Task.View']);
    expect(searchableTypes((c) => held.has(c)).map((t) => t.type)).toEqual(['client', 'task']);
    expect(searchableTypes(() => false)).toEqual([]);
  });

  it('needs two characters, or one digit (numbers can be a single digit)', () => {
    expect(['', ' ', 'a', ' a ', null, undefined].map(isSearchable)).toEqual(Array(6).fill(false));
    expect(['ab', '7', ' 7 ', '343', '00002-1'].map(isSearchable)).toEqual(Array(5).fill(true));
  });

  it('splits text around the first case-insensitive match for highlighting', () => {
    expect(highlightParts('Big Orbit Group', 'orbit')).toEqual([
      { text: 'Big ', match: false },
      { text: 'Orbit', match: true },
      { text: ' Group', match: false },
    ]);
    expect(highlightParts('Orbit', 'ORBIT')).toEqual([{ text: 'Orbit', match: true }]);
    expect(highlightParts('Acme', 'zzz')).toEqual([{ text: 'Acme', match: false }]);
    expect(highlightParts('Acme', '')).toEqual([{ text: 'Acme', match: false }]);
    expect(highlightParts(undefined, 'a')).toEqual([{ text: '', match: false }]);
    // Regular expression characters in the input are plain text.
    expect(highlightParts('Rate 100% (final)', '100% (')).toEqual([
      { text: 'Rate ', match: false },
      { text: '100% (', match: true },
      { text: 'final)', match: false },
    ]);
  });

  it('words the empty state like the UX spec', () => {
    expect(noResultsMessage('x1')).toBe(
      "No results for 'x1'. Try a client or matter number, a task title, or an asset name.",
    );
  });
});
