import { convertToParamMap } from '@angular/router';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  commonArgs,
  filtersToParams,
  parseFilters,
  queryToParams,
  roleApplies,
} from './my-matters-filters';

const map = (o: Record<string, string>) => convertToParamMap(o);

describe('My Matters filters', () => {
  it('reads the defaults from an empty address', () => {
    expect(parseFilters(map({}), true)).toEqual(DEFAULT_FILTERS);
  });

  it('reads and writes a full set of filters', () => {
    const f = parseFilters(
      map({
        scope: 'all',
        role: 'primary',
        clientId: '12',
        matterId: '31',
        managerId: '7',
      }),
      true,
    );
    expect(f).toEqual({
      scope: 'all',
      role: 'primary',
      clientId: 12,
      matterId: 31,
      managerId: 7,
    });
    expect(filtersToParams(f)).toEqual({
      scope: 'all',
      role: 'primary',
      clientId: 12,
      matterId: 31,
      managerId: 7,
    });
  });

  it('leaves defaults out of the address (null removes a parameter on merge)', () => {
    expect(filtersToParams(DEFAULT_FILTERS)).toEqual({
      scope: null,
      role: null,
      clientId: null,
      matterId: null,
      managerId: null,
    });
  });

  it('ignores scope=all and managerId without Matter.AssignManagers', () => {
    const f = parseFilters(map({ scope: 'all', managerId: '7', role: 'secondary' }), false);
    expect(f.scope).toBe('mine');
    expect(f.managerId).toBeNull();
    expect(f.role).toBe('secondary');
  });

  it('drops bad values: unknown role, non-numeric client, an old date range', () => {
    const f = parseFilters(
      map({ role: 'boss', clientId: 'abc', range: '2w', from: '2026-10-01' }),
      true,
    );
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('sends scope, role, client and manager to the API', () => {
    const f = parseFilters(
      map({ scope: 'all', managerId: '7', role: 'secondary', clientId: '3' }),
      true,
    );
    expect(commonArgs(f)).toEqual({ scope: 'all', role: 'secondary', clientId: 3, managerId: 7 });
    expect(commonArgs(DEFAULT_FILTERS)).toEqual({
      scope: undefined,
      role: undefined,
      clientId: undefined,
      managerId: undefined,
    });
  });

  it('the Matter filter is read from the address, counts for Clear filters and goes to every call (#941)', () => {
    const f = parseFilters(map({ matterId: '31', clientId: '4' }), false);
    expect(f.matterId).toBe(31);
    expect(commonArgs(f).matterId).toBe(31);
    expect(filtersToParams(f)['matterId']).toBe(31);
    expect(activeFilterCount(f)).toBe(2);
    expect(parseFilters(map({ matterId: 'abc' }), false).matterId).toBeNull();
    expect(parseFilters(map({ matterId: '0' }), false).matterId).toBeNull();
    expect(commonArgs(DEFAULT_FILTERS).matterId).toBeUndefined();
  });

  it('does not send a role in the All scope until a manager is named (it would select nothing)', () => {
    const f = parseFilters(map({ scope: 'all', role: 'primary' }), true);
    expect(roleApplies(f)).toBe(false);
    expect(commonArgs(f).role).toBeUndefined();
  });

  it('counts the filters that differ from the default; the scope is a mode, not a filter', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, scope: 'all' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, role: 'primary', clientId: 4 })).toBe(2);
  });

  it('turns an API query into router parameters; repeated keys become arrays', () => {
    expect(queryToParams('managedByMe=true&status=NEW&status=IN_PROGRESS&sort=due')).toEqual({
      managedByMe: 'true',
      status: ['NEW', 'IN_PROGRESS'],
      sort: 'due',
    });
    expect(queryToParams('')).toEqual({});
  });
});
