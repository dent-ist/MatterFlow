import { FilterOption } from './filter-def';

/**
 * The Disposition filter of the Assets list and of a matter's Assets tab (the `status` address key stays, so old links keep working). Active is the default.
 * The address also accepts `notactive` (the three other states together, as the warning link uses); it has no entry in the list, because the longest label
 * sets the width of the column and the grid must still fit at 640 px.
 */
export const ASSET_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'pending', label: 'Pending' },
  { value: 'disposed', label: 'Disposed' },
  { value: 'all', label: 'All' },
];

export type AssetStatusKey = 'active' | 'notactive' | 'inactive' | 'pending' | 'disposed' | 'all';

export function parseAssetStatusKey(value: string | null | undefined): AssetStatusKey {
  return value === 'notactive' || ASSET_STATUS_OPTIONS.some((o) => o.value === value)
    ? (value as AssetStatusKey)
    : 'active';
}

/** What each choice asks the API for: `isActive` for Active and Not active, the disposition for the single states. */
export function assetStatusQuery(key: AssetStatusKey): {
  isActive?: boolean;
  disposition?: string[];
} {
  switch (key) {
    case 'active':
      return { isActive: true };
    case 'notactive':
      return { isActive: false };
    case 'inactive':
      return { disposition: ['INACTIVE'] };
    case 'pending':
      return { disposition: ['PENDING_DISPOSITION'] };
    case 'disposed':
      return { disposition: ['DISPOSED'] };
    default:
      return {};
  }
}
