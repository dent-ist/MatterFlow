import { convertToParamMap } from '@angular/router';
import { parseFilters } from '../../shared/filters/filter-def';
import { resultColumns } from './report-column-defs';
import {
  filterDefsOf,
  serverFilter,
  serverSort,
  sortKinds,
  sortLabels,
} from './report-result-query';

const columns = resultColumns([
  { name: 'Matter', type: 'text' },
  { name: 'Hours', type: 'decimal' },
  { name: 'Open Tasks', type: 'integer' },
  { name: 'Due', type: 'date' },
  { name: 'Updated', type: 'dateTime' },
  { name: 'Active', type: 'boolean' },
]);
const values = (params: Record<string, string>) =>
  parseFilters(filterDefsOf(columns), convertToParamMap(params));

describe('report result query (#720)', () => {
  it('makes one filter per column by its type, keyed by the column id and placed in its cell', () => {
    const defs = filterDefsOf(columns);
    expect(defs.map((d) => [d.key, d.type, d.column])).toEqual([
      ['c0', 'text', 'Matter'],
      ['c1', 'numberRange', 'Hours'],
      ['c2', 'numberRange', 'Open Tasks'],
      ['c3', 'dateRange', 'Due'],
      ['c4', 'dateRange', 'Updated'],
      ['c5', 'triState', 'Active'],
    ]);
    expect(defs[1].numberShape).toBe('decimal');
    expect(defs[2].numberShape).toBe('long');
  });

  it('sends no filter when nothing is set', () => {
    expect(serverFilter(columns, values({}))).toBeUndefined();
  });

  it('sends text as contains, ranges as between or one-sided operators, Yes and No as eq', () => {
    const json = serverFilter(
      columns,
      values({
        c0: ' acme ',
        c1From: '1.5',
        c1To: '9.25',
        c2From: '3',
        c3To: '2026-03-31',
        c4From: '2026-01-01',
        c4To: '2026-01-31',
        c5: 'false',
      }),
    );
    expect(JSON.parse(json!)).toEqual([
      { column: 'Matter', op: 'contains', value: 'acme' },
      { column: 'Hours', op: 'between', value: '1.5', value2: '9.25' },
      { column: 'Open Tasks', op: 'gte', value: '3' },
      { column: 'Due', op: 'onOrBefore', value: '2026-03-31' },
      { column: 'Updated', op: 'between', value: '2026-01-01', value2: '2026-01-31' },
      { column: 'Active', op: 'eq', value: 'false' },
    ]);
  });

  it('uses lte for a number with only a Max and onOrAfter for a date with only a From', () => {
    const json = serverFilter(columns, values({ c2To: '7', c3From: '2026-02-01' }));
    expect(JSON.parse(json!)).toEqual([
      { column: 'Open Tasks', op: 'lte', value: '7' },
      { column: 'Due', op: 'onOrAfter', value: '2026-02-01' },
    ]);
  });

  it('turns the sort of the grid into Name:asc or Name:desc, by id so odd names are safe, and nothing for the report order', () => {
    expect(serverSort(columns, 'c2')).toBe('Open Tasks:asc');
    expect(serverSort(columns, '-c1')).toBe('Hours:desc');
    expect(serverSort(columns, null)).toBeUndefined();
    expect(serverSort(columns, 'c99')).toBeUndefined();
    const odd = resultColumns([{ name: '-x, y:z', type: 'text' }]);
    expect(serverSort(odd, '-c0')).toBe('-x, y:z:desc');
  });

  it('names a sort column by its header for the Sorted by line', () => {
    expect(sortLabels(columns)['c2']).toBe('Open Tasks');
  });

  it('words the direction of a sort by the type of the column (#1289)', () => {
    expect(sortKinds(columns)).toEqual({
      c0: 'text',
      c1: 'number',
      c2: 'number',
      c3: 'date',
      c4: 'date',
      c5: 'yesno',
    });
  });
});
