import { convertToParamMap } from '@angular/router';
import { ARCHIVE_STATUS_OPTIONS, matterColumnDefs, statusDef, triBool } from './common-defs';
import { buildChips, defaultValue, isActive, parseFilters } from './filter-def';

describe('shared record-list filter definitions', () => {
  it('status shows Active and does not count it; All and Inactive do', () => {
    const def = statusDef();
    expect(defaultValue(def)).toBe('active');
    expect(isActive(def, 'active')).toBe(false);
    expect(isActive(def, 'all')).toBe(true);
    expect(buildChips(def, 'active', false)).toEqual([]);
    expect(buildChips(def, 'inactive', false)[0].label).toBe('Status: Inactive');
    expect(buildChips(statusDef(ARCHIVE_STATUS_OPTIONS), 'inactive', false)[0].label).toBe(
      'Status: Archived',
    );
  });

  it('matter filters: reference, name and status have columns; Sensitive has none (More filters)', () => {
    const defs = matterColumnDefs();
    expect(defs.map((d) => [d.key, d.column])).toEqual([
      ['matterRef', 'matterRef'],
      ['name', 'name'],
      ['status', 'status'],
      ['isSensitive', undefined],
    ]);
    expect(matterColumnDefs('Matter')[0].label).toBe('Matter');
  });

  it('reads the existing and new URL parameter names', () => {
    const values = parseFilters(
      matterColumnDefs(),
      convertToParamMap({
        matterRef: '343-12',
        name: 'merger',
        isSensitive: 'true',
        status: 'all',
      }),
    );
    expect(values).toEqual({
      matterRef: '343-12',
      name: 'merger',
      status: 'all',
      isSensitive: 'true',
    });
    // A plain address is not filtered by anything.
    expect(parseFilters(matterColumnDefs(), convertToParamMap({}))).toEqual({
      matterRef: '',
      name: '',
      status: 'active',
      isSensitive: '',
    });
  });

  it('turns the text of a tri-state filter into the API argument', () => {
    expect(triBool('true')).toBe(true);
    expect(triBool('false')).toBe(false);
    expect(triBool('')).toBeUndefined();
    expect(triBool('maybe')).toBeUndefined();
  });
});
