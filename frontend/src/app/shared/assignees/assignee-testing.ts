import { UserLookupItem } from '../../api/generated/api-client';

/** What a spec says about one `GET /users/lookup` item; everything else is filled in. */
export interface LookupItemPatch {
  userId: number;
  displayName?: string;
  availability?: { state: string; outUntil?: string; note?: string };
  openTaskCount?: number;
  lastAssignedUtc?: string;
  suggested?: boolean;
  reason?: string;
}

/** A `GET /users/lookup` item for specs: available, no open tasks, never assigned, unless the patch says otherwise. */
export function aLookupItem(patch: LookupItemPatch): UserLookupItem {
  const openTaskCount = patch.openTaskCount ?? 0;
  return {
    displayName: `User ${patch.userId}`,
    availability: { state: 'AVAILABLE' },
    openTaskCount,
    lastAssignedUtc: undefined,
    suggested: false,
    reason: `${openTaskCount} open tasks, never assigned`,
    ...patch,
  } as UserLookupItem;
}
