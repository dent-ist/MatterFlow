import { convertToParamMap } from '@angular/router';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  commonArgs,
  deadlineArgs,
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
        range: 'custom',
        from: '2026-10-01',
        to: '2026-10-31',
        managerId: '7',
        show: 'overdue',
      }),
      true,
    );
    expect(f).toEqual({
      scope: 'all',
      role: 'primary',
      clientId: 12,
      matterId: 31,
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      managerId: 7,
      show: 'overdue',
    });
    expect(filtersToParams(f)).toEqual({
      scope: 'all',
      role: 'primary',
      clientId: 12,
      matterId: 31,
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-31',
      managerId: 7,
      show: 'overdue',
    });
  });

  it('leaves defaults out of the address (null removes a parameter on merge)', () => {
    expect(filtersToParams(DEFAULT_FILTERS)).toEqual({
      scope: null,
      role: null,
      clientId: null,
      matterId: null,
      range: null,
      from: null,
      to: null,
      managerId: null,
      show: null,
    });
  });

  it('knows the six pre-filters of the grid and takes an unknown one for All open (#942)', () => {
    for (const key of ['open', 'overdue', 'atRisk', 'unassigned', 'onHold', 'dueSoon'])
      expect(parseFilters(map({ show: key }), true).show).toBe(key);
    expect(parseFilters(map({ show: 'everything' }), true).show).toBe('open');
    expect(parseFilters(map({}), true).show).toBe('open');
    // The pre-filter is not a filter of the filter bar: it does not count for "Clear filters".
    expect(activeFilterCount({ ...DEFAULT_FILTERS, show: 'overdue' })).toBe(0);
  });

  it('ignores scope=all and managerId without Matter.AssignManagers', () => {
    const f = parseFilters(map({ scope: 'all', managerId: '7', role: 'secondary' }), false);
    expect(f.scope).toBe('mine');
    expect(f.managerId).toBeNull();
    expect(f.role).toBe('secondary');
  });

  it('drops bad values: unknown role, non-numeric client, dates outside a custom range', () => {
    const f = parseFilters(
      map({ role: 'boss', clientId: 'abc', range: '9w', from: '2026-10-01' }),
      true,
    );
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('sends scope, role, client and manager to the API and never the date range', () => {
    const f = parseFilters(
      map({ scope: 'all', managerId: '7', role: 'secondary', clientId: '3', range: '2w' }),
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

  it('maps the date range to the deadlines window and due-date range', () => {
    expect(deadlineArgs(DEFAULT_FILTERS, '2026-10-23')).toEqual({
      days: 28,
      from: undefined,
      to: undefined,
    });
    expect(deadlineArgs({ ...DEFAULT_FILTERS, range: '2w' }, '2026-10-23').days).toBe(14);
    expect(deadlineArgs({ ...DEFAULT_FILTERS, range: 'today' }, '2026-10-23')).toEqual({
      days: 14,
      from: '2026-10-23',
      to: '2026-10-23',
    });
    expect(
      deadlineArgs(
        { ...DEFAULT_FILTERS, range: 'custom', from: '2026-11-01', to: '2026-11-05' },
        '2026-10-23',
      ),
    ).toEqual({ days: 28, from: '2026-11-01', to: '2026-11-05' });
  });

  it('counts the filters that differ from the default; the scope is a mode, not a filter', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, scope: 'all' })).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_FILTERS, role: 'primary', clientId: 4, range: '2w' }),
    ).toBe(3);
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
