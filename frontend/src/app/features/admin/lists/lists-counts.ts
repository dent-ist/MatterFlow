import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AssetLinkRolesClient,
  CurrentStatesClient,
  MatterTypesClient,
  NoteTagsClient,
  OnHoldReasonsClient,
  PrioritiesClient,
  StatusLabelsClient,
  TeamTitlesClient,
} from '../../../api/generated/api-client';
import { CountLoader } from '../admin-tabs';
import { AdminListKey } from './admin-lists';

/**
 * The count loaders of the catalogue (UI spec 3.2, `backend-notes.md`): each list's own GET, counted on the client. A count is the number of ACTIVE items (`isActive`; the
 * five Status Labels have no such field, so all of them count) and never a usage figure (`inUseCount`, `openTaskCount`, `linkCount`, `visibleNoteCount` mean different things
 * per list and are null without `Task.View` or `Asset.View`). Note Tags are asked with `includeInactive=true`, the only query parameter that endpoint takes. Call in an
 * injection context; `AdminTabCounts.start` runs them quietly and only for the lists the person may manage.
 */
export function listCountLoaders(): Record<AdminListKey, CountLoader> {
  const types = inject(MatterTypesClient);
  const states = inject(CurrentStatesClient);
  const titles = inject(TeamTitlesClient);
  const priorities = inject(PrioritiesClient);
  const statuses = inject(StatusLabelsClient);
  const reasons = inject(OnHoldReasonsClient);
  const tags = inject(NoteTagsClient);
  const roles = inject(AssetLinkRolesClient);
  const active = (rows: readonly { isActive: boolean }[]): number =>
    rows.filter((r) => r.isActive).length;
  return {
    'matter-types': () => firstValueFrom(types.listMatterTypes()).then(active),
    'current-states': () => firstValueFrom(states.listCurrentStates()).then(active),
    'team-titles': () => firstValueFrom(titles.listTeamTitles()).then(active),
    priorities: () => firstValueFrom(priorities.listPriorities()).then(active),
    'status-labels': () => firstValueFrom(statuses.listStatusLabels()).then((r) => r.length),
    'on-hold-reasons': () => firstValueFrom(reasons.listOnHoldReasons()).then(active),
    'note-tags': () => firstValueFrom(tags.listNoteTags(true)).then(active),
    'link-roles': () => firstValueFrom(roles.listAssetLinkRoles()).then(active),
  };
}
