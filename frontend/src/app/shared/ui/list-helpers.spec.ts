import {
  ariaSort,
  isActiveParam,
  naturalCompare,
  nextSort,
  parsePage,
  parseStatus,
} from './list-helpers';

describe('list helpers', () => {
  it('toggles sort direction on repeated activation', () => {
    expect(nextSort(undefined, 'name')).toBe('name');
    expect(nextSort('name', 'name')).toBe('-name');
    expect(nextSort('-name', 'name')).toBe('name');
    expect(nextSort('name', 'clientNumber')).toBe('clientNumber');
  });

  it('reports aria-sort for the first key, falling back to the default', () => {
    expect(ariaSort(undefined, 'clientNumber', 'clientNumber')).toBe('ascending');
    expect(ariaSort('-clientNumber', 'clientNumber', 'clientNumber')).toBe('descending');
    expect(ariaSort('name', 'clientNumber', 'clientNumber')).toBe('none');
    expect(ariaSort('name,-clientNumber', 'name', 'clientNumber')).toBe('ascending');
  });

  it('maps the status filter to the API parameter', () => {
    expect(isActiveParam('active')).toBe(true);
    expect(isActiveParam('inactive')).toBe(false);
    expect(isActiveParam('all')).toBeUndefined();
    expect(parseStatus('inactive')).toBe('inactive');
    expect(parseStatus('bogus')).toBe('active');
    expect(parseStatus(undefined)).toBe('active');
  });

  it('compares names naturally: numbers as numbers, case and accents ignored, ties stable (#249)', () => {
    const sorted = (names: string[]) => [...names].sort(naturalCompare);
    expect(sorted(['Wave 15', 'Wave 39', 'Wave 7', 'Wave 23', 'Wave 31'])).toEqual([
      'Wave 7',
      'Wave 15',
      'Wave 23',
      'Wave 31',
      'Wave 39',
    ]);
    expect(sorted(['Étude 10', 'etude 2'])).toEqual(['etude 2', 'Étude 10']);
    expect(naturalCompare('Etude 1', 'étude 1')).toBe(0);
    // Equal names keep their incoming order (the server's: name, then id).
    const rows = [
      { id: 2, name: 'Alpha' },
      { id: 1, name: 'alpha' },
    ];
    expect(rows.sort((a, b) => naturalCompare(a.name, b.name)).map((r) => r.id)).toEqual([2, 1]);
  });

  it('parses page numbers defensively', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});
