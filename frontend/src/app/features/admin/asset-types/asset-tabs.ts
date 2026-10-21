import { AdminTab } from '../admin-tabs';

/** The two tabs of the Asset Types page (#633); both need `AssetType.Manage`, which is also what opens the page. */
export const ASSET_TABS: readonly AdminTab[] = [
  {
    id: 'types',
    label: 'Asset Types',
    route: '/admin/asset-types',
    permission: ['AssetType.Manage'],
    countKey: 'types',
  },
  {
    id: 'link-roles',
    label: 'Link Roles',
    route: '/admin/asset-types?tab=link-roles',
    permission: ['AssetType.Manage'],
    countKey: 'link-roles',
  },
];

export type AssetAdminTab = 'types' | 'link-roles';

/** One line per tab, 90 characters at most (the header shows it on one line). */
export const ASSET_TAB_TEXT: Record<AssetAdminTab, string> = {
  types:
    'Each type has its own fields. Fields are versioned; publishing never changes saved values.',
  'link-roles': 'The roles an asset can have on a task, such as Source, Destination or Result.',
};
