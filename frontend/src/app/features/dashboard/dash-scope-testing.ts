import { of } from 'rxjs';
import { DashboardScopeChoices } from '../../api/generated/api-client';

/** The answer of `GET /dashboard/scopes` for a person in no pod (default All pods) or, with `mine`, in Pods 1 and 2 (default My pods). */
export function aScopeChoices(
  overrides: Partial<DashboardScopeChoices> = {},
): DashboardScopeChoices {
  return { defaultScope: 'all', hasPods: false, pods: [], ...overrides };
}

export function aMemberChoices(): DashboardScopeChoices {
  return {
    defaultScope: 'mine',
    hasPods: true,
    pods: [
      { podId: 1, name: 'Review Alpha', isMine: true },
      { podId: 2, name: 'Review Beta', isMine: true },
      { podId: 3, name: 'Processing', isMine: false },
    ],
  };
}

/** The one method of `DashboardClient` the scope reads, answering with the given choices. */
export function scopesMock(choices: DashboardScopeChoices = aScopeChoices()) {
  return () => of(choices);
}
