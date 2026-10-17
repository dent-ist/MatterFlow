import { convertToParamMap } from '@angular/router';
import {
  TECH_HEADING,
  hasTechFilters,
  ownWorkText,
  techFilterDefs,
  techFilterQuery,
  techIds,
  withTechFilters,
} from './dash-technician';
import { parseFilters, serializeValue } from '../../shared/filters/filter-def';

const params = (o: Record<string, string | string[]>) => convertToParamMap(o);

describe('Technician Summary model (S9)', () => {
  it('names the page for what it shows', () => {
    expect(TECH_HEADING).toBe('Unassigned work');
  });

  it('turns sprio and stype into the Task Queue terms priority and type, in that order', () => {
    expect(techFilterQuery(params({ sprio: '1,2', stype: '4' }))).toBe(
      'priority=1&priority=2&type=4',
    );
    expect(techFilterQuery(params({ stype: ['4', '5'] }))).toBe('type=4&type=5');
    expect(techFilterQuery(params({}))).toBe('');
  });

  it('reads comma lists and repeated parameters alike and drops anything that is not an id or repeats', () => {
    expect(techIds(params({ sprio: ['1,2', '2', ' 3 '] }), 'sprio')).toEqual(['1', '2', '3']);
    expect(techIds(params({ sprio: 'x,0,-1,1.5,7,,' }), 'sprio')).toEqual(['7']);
    expect(techIds(params({ sprio: '1234567890' }), 'sprio')).toEqual([]);
  });

  it('adds the filters to a Task Queue query and says whether there are any', () => {
    const q = 'status=NEW&unassigned=true';
    expect(withTechFilters(q, params({ sprio: '1' }))).toBe(
      'status=NEW&unassigned=true&priority=1',
    );
    expect(withTechFilters(q, params({}))).toBe(q);
    expect(hasTechFilters(params({ stype: '3' }))).toBe(true);
    expect(hasTechFilters(params({ stype: 'zzz' }))).toBe(false);
  });

  it('defines the two filters as multi-selects of the column-filter foundation that write comma lists', () => {
    const defs = techFilterDefs(
      [{ value: '1', label: 'Critical' }],
      [{ value: '3', label: 'Redaction' }],
    );
    expect(defs.map((d) => [d.key, d.label, d.type])).toEqual([
      ['sprio', 'Priority', 'multiSelect'],
      ['stype', 'Task type', 'multiSelect'],
    ]);
    const values = parseFilters(defs, params({ sprio: '1', stype: '3,4' }));
    expect(values['sprio']).toEqual(['1']);
    expect(values['stype']).toEqual(['3', '4']);
    expect(serializeValue(defs[1], ['3', '4'])).toEqual({ stype: '3,4' });
    expect(serializeValue(defs[1], [])).toEqual({ stype: null });
  });

  it('words the own-work line neutrally', () => {
    expect(ownWorkText(6, 1)).toBe('You have 6 open, 1 overdue.');
    expect(ownWorkText(0, 0)).toBe('You have 0 open, 0 overdue.');
  });
});
