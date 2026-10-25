import {
  CLEARED_PARAMS,
  FILTER_KEYS,
  NO_FILTERS,
  TYPE_FILTERS,
  activeKinds,
  apiArgs,
  filterChips,
  filterParams,
  readFilters,
  withoutFilter,
} from './search-filter-defs';

describe('search filter definitions (#474, #475, #476)', () => {
  it('offers per type exactly what the retired Advanced search page offered (parity)', () => {
    expect(TYPE_FILTERS).toEqual({
      client: ['active'],
      matter: ['client', 'active', 'sensitive'],
      project: ['matter', 'active'],
      task: ['client', 'matter', 'status', 'requestor'],
      asset: ['matter', 'assetType', 'active'],
    });
    // Every filter of every type has a URL key named like the Advanced API parameter.
    for (const kinds of Object.values(TYPE_FILTERS))
      for (const kind of kinds) expect(FILTER_KEYS).toContain(kind);
  });

  it('reads the address, dropping filters the type does not offer and invalid values', () => {
    expect(
      readFilters('task', {
        client: '3',
        matter: 'x',
        assetType: '9',
        active: 'true',
        status: ['NEW', 'BOGUS', 'ON_HOLD'],
        requestor: '  pat ',
      }),
    ).toEqual({
      ...NO_FILTERS,
      client: 3,
      status: ['NEW', 'ON_HOLD'],
      requestor: 'pat',
    });
    expect(readFilters('client', { client: '3', active: 'false' })).toEqual({
      ...NO_FILTERS,
      active: 'false',
    });
    expect(readFilters('matter', { sensitive: 'true', status: 'NEW' }).status).toEqual([]);
    // A comma list is one parameter too.
    expect(readFilters('task', { status: 'NEW,IN_PROGRESS' }).status).toEqual([
      'NEW',
      'IN_PROGRESS',
    ]);
  });

  it('maps the filters to the Advanced API call; Any is no filter and a short requestor is not sent', () => {
    expect(apiArgs(NO_FILTERS)).toEqual({
      client: undefined,
      matter: undefined,
      assetType: undefined,
      active: undefined,
      sensitive: undefined,
      status: undefined,
      requestor: undefined,
    });
    expect(
      apiArgs({
        client: 3,
        matter: 4,
        assetType: 5,
        active: 'false',
        sensitive: 'true',
        status: ['NEW'],
        requestor: 'pat',
      }),
    ).toEqual({
      client: 3,
      matter: 4,
      assetType: 5,
      active: false,
      sensitive: true,
      status: ['NEW'],
      requestor: 'pat',
    });
    expect(apiArgs({ ...NO_FILTERS, requestor: 'p' }).requestor).toBeUndefined();
  });

  it('writes the address and clears every key', () => {
    expect(filterParams({ ...NO_FILTERS, client: 3, status: ['NEW'] })).toEqual({
      ...CLEARED_PARAMS,
      client: '3',
      status: ['NEW'],
    });
    expect(Object.keys(CLEARED_PARAMS).sort()).toEqual([...FILTER_KEYS].sort());
  });

  it('makes one chip per active filter and removing a chip puts that filter back', () => {
    const values = {
      ...NO_FILTERS,
      client: 3,
      active: 'false' as const,
      status: ['NEW', 'ON_HOLD'],
    };
    expect(activeKinds('task', values)).toEqual(['client', 'status']);
    expect(
      filterChips('task', values, { client: () => '00343 Acme Corp' }).map((c) => c.label),
    ).toEqual(['Client: 00343 Acme Corp', 'Task status: New, On Hold']);
    expect(filterChips('matter', values).map((c) => c.label)).toEqual([
      'Client: Client 3',
      'Status: Inactive',
    ]);
    expect(withoutFilter(values, 'status').status).toEqual([]);
    // A requestor shorter than the minimum is not a filter yet.
    expect(activeKinds('task', { ...NO_FILTERS, requestor: 'p' })).toEqual([]);
  });
});
