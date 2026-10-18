import { ClientSummaryResponse, TopMatterResponse } from '../../../api/generated/api-client';

/** A top matter of the client summary, for specs. */
export function aTopMatter(overrides: Partial<TopMatterResponse> = {}): TopMatterResponse {
  return {
    matterId: 7,
    reference: '00343-00012',
    name: 'Merger Review',
    isActive: true,
    openTasks: 4,
    overdue: 1,
    ...overrides,
  };
}

/** The summary of client 1 with every number present (a viewer with `Task.View` and `Matter.View`), for specs. */
export function aClientSummary(
  overrides: Partial<ClientSummaryResponse> = {},
): ClientSummaryResponse {
  return {
    clientId: 1,
    openTasks: 9,
    overdue: 2,
    asap: 3,
    onHold: 1,
    dueSoon: 2,
    matterCount: 2,
    activeMatterCount: 2,
    topMatters: [
      aTopMatter(),
      aTopMatter({
        matterId: 8,
        reference: '00343-00013',
        name: 'Audit',
        openTasks: 5,
        overdue: 0,
      }),
    ],
    ...overrides,
  };
}
