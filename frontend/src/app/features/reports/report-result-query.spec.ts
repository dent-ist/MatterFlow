import { convertToParamMap } from '@angular/router';
import { parseFilters } from '../../shared/filters/filter-def';
import { resultColumns } from './report-column-defs';
import {
  columnRef,
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
      { column: '#0', op: 'contains', value: 'acme' },
      { column: '#1', op: 'between', value: '1.5', value2: '9.25' },
      { column: '#2', op: 'gte', value: '3' },
      { column: '#3', op: 'onOrBefore', value: '2026-03-31' },
      { column: '#4', op: 'between', value: '2026-01-01', value2: '2026-01-31' },
      { column: '#5', op: 'eq', value: 'false' },
    ]);
  });

  it('uses lte for a number with only a Max and onOrAfter for a date with only a From', () => {
    const json = serverFilter(columns, values({ c2To: '7', c3From: '2026-02-01' }));
    expect(JSON.parse(json!)).toEqual([
      { column: '#2', op: 'lte', value: '7' },
      { column: '#3', op: 'onOrAfter', value: '2026-02-01' },
    ]);
  });

  it('turns the sort of the grid into #<position>:asc or :desc and nothing for the report order (#1288)', () => {
    expect(serverSort(columns, 'c2')).toBe('#2:asc');
    expect(serverSort(columns, '-c1')).toBe('#1:desc');
    expect(serverSort(columns, 'c0')).toBe('#0:asc');
    expect(serverSort(columns, null)).toBeUndefined();
    expect(serverSort(columns, undefined)).toBeUndefined();
    expect(serverSort(columns, 'c99')).toBeUndefined();
    expect(serverSort(columns, '-c99')).toBeUndefined();
  });

  it('never puts a column name in the sort, so a comma, a colon, a leading minus or a name like #3 cannot break it (#1288)', () => {
    const odd = resultColumns([
      { name: 'a,b', type: 'text' },
      { name: '#0', type: 'integer' },
      { name: '-x:y', type: 'text' },
      { name: 'a,b', type: 'text' },
    ]);
    expect(serverSort(odd, 'c0')).toBe('#0:asc');
    expect(serverSort(odd, '-c0')).toBe('#0:desc');
    // The column named "#0" is the one at position 1: the position of the column wins, whatever its name looks like.
    expect(serverSort(odd, 'c1')).toBe('#1:asc');
    expect(serverSort(odd, '-c2')).toBe('#2:desc');
    // Two columns of one name are told apart by position.
    expect(serverSort(odd, 'c3')).toBe('#3:asc');
  });

  it('identifies a column by its position in the filter, the sort and the export alike, so two columns of one name never meet (#1291)', () => {
    // SELECT a.Name, b.Name, Id: the server keeps both names.
    const twins = resultColumns([
      { name: 'Name', type: 'text' },
      { name: 'Name', type: 'text' },
      { name: 'Id', type: 'integer' },
    ]);
    expect(twins.map((c) => c.name)).toEqual(['Name', 'Name', 'Id']);
    // The grid still tells them apart for storage and data-col.
    expect(twins.map((c) => c.key)).toEqual(['Name', 'Name (2)', 'Id']);
    const f = (params: Record<string, string>) =>
      parseFilters(filterDefsOf(twins), convertToParamMap(params));
    // A filter on the second Name hits position 1 and only that.
    expect(JSON.parse(serverFilter(twins, f({ c1: 'smith' }))!)).toEqual([
      { column: '#1', op: 'contains', value: 'smith' },
    ]);
    expect(JSON.parse(serverFilter(twins, f({ c0: 'jones', c1: 'smith' }))!)).toEqual([
      { column: '#0', op: 'contains', value: 'jones' },
      { column: '#1', op: 'contains', value: 'smith' },
    ]);
    expect(serverSort(twins, 'c0')).toBe('#0:asc');
    expect(serverSort(twins, '-c1')).toBe('#1:desc');
    // The header of both says Name (the sorted line and the chips show the server's name).
    expect(sortLabels(twins)).toEqual({ c0: 'Name', c1: 'Name', c2: 'Id' });
    expect(twins.map((c) => columnRef(c))).toEqual(['#0', '#1', '#2']);
    // A name that looks like a position still gives the real position.
    const odd = resultColumns([
      { name: '#2', type: 'text' },
      { name: 'x', type: 'text' },
    ]);
    expect(
      JSON.parse(
        serverFilter(odd, parseFilters(filterDefsOf(odd), convertToParamMap({ c0: 'a' })))!,
      ),
    ).toEqual([{ column: '#0', op: 'contains', value: 'a' }]);
  });

  it('keeps the one-column rule: the sort is one key', () => {
    expect(serverSort(columns, 'c1')!.includes(',')).toBe(false);
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
