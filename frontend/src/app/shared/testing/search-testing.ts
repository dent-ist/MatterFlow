import {
  AdvancedSearchPage,
  SearchGroup,
  SearchHit,
  SearchResponse,
} from '../../api/generated/api-client';

/** Builders shared by the search component tests. */
export function aHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    type: 'matter',
    id: 7,
    reference: '00343-00012',
    label: 'Merger Review',
    secondary: 'Acme Corp',
    path: '/matters/7',
    isSensitive: false,
    matterRef: '00343-00012',
    matterName: 'Merger Review',
    isActive: true,
    status: undefined,
    ...overrides,
  };
}

/** A group; the total defaults to the items shown (the answer when nothing was cut off). */
export const aGroup = (
  type: string,
  items: SearchHit[],
  hasMore = false,
  total = items.length,
  totalCapped = false,
): SearchGroup => ({
  type,
  items,
  hasMore,
  total,
  totalCapped,
});

export const aResponse = (
  groups: SearchGroup[],
  query = 'merger',
  normalized?: string,
): SearchResponse => ({ query, normalized, groups, searchedTypes: groups.map((g) => g.type) });

/** The typical answer to "343": a client, a matter and a task (FND-17), server order (clients first). */
export function numericResponse(): SearchResponse {
  return aResponse(
    [
      aGroup('client', [
        aHit({
          type: 'client',
          id: 1,
          reference: '00343',
          label: 'Acme Corp',
          secondary: undefined,
          path: '/clients/1',
          matterRef: undefined,
          matterName: undefined,
        }),
      ]),
      aGroup('matter', [aHit({ isSensitive: true })]),
      aGroup('project', []),
      aGroup('task', [
        aHit({
          type: 'task',
          id: 1042,
          reference: 'TSK-1042',
          label: 'Process custodian data',
          secondary: 'Pat Partner',
          path: '/tasks/1042',
          status: 'NEW',
        }),
      ]),
      aGroup('asset', []),
    ],
    '343',
    '00343',
  );
}

export const anAdvancedPage = (
  items: SearchHit[],
  overrides: Partial<AdvancedSearchPage> = {},
): AdvancedSearchPage => ({
  type: 'matter',
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...overrides,
});
