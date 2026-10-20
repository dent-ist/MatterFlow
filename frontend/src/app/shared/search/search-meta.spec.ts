import {
  SEARCH_TYPES,
  highlightParts,
  isSearchable,
  noResultsMessage,
  searchableTypes,
  suggestionLines,
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

  describe('suggestionLines', () => {
    const base = { isSensitive: false, matterRef: '00343-00012', matterName: 'Merger Review' };

    it('moves an asset reference into the tooltip and never onto the first line', () => {
      const lines = suggestionLines({
        ...base,
        type: 'asset',
        reference: 'https://x/y',
        secondary: 'Laptop',
      });
      expect(lines.reference).toBeNull();
      expect(lines.tooltip).toBe('https://x/y');
      expect(lines.context).toEqual(['Laptop', '00343-00012', 'Merger Review']);
    });

    it('drops the requestor of a task and adds the labelled status', () => {
      const lines = suggestionLines(
        { ...base, type: 'task', reference: 'TSK-1', secondary: 'Pat Partner', status: 'NEW' },
        (c) => (c === 'NEW' ? 'New' : c),
      );
      expect(lines.reference).toBe('TSK-1');
      expect(lines.context).toEqual(['00343-00012', 'Merger Review', 'New']);
    });

    it('asks for the lock on every sensitive hit except a matter (which keeps the badge)', () => {
      const sensitive = { ...base, isSensitive: true };
      expect(suggestionLines({ ...sensitive, type: 'matter' }).lock).toBe(false);
      for (const type of ['task', 'project', 'asset', 'client']) {
        expect(suggestionLines({ ...sensitive, type }).lock, type).toBe(true);
      }
      expect(suggestionLines({ ...base, type: 'task' }).lock).toBe(false);
    });
  });
});
