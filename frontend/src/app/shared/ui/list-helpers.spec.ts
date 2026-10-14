import { ariaSort, isActiveParam, nextSort, parsePage, parseStatus } from './list-helpers';

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

  it('parses page numbers defensively', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
});
