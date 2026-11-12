import { AdminTab } from '../admin-tabs';
import { ADMIN_FIELD_LIMITS } from '../shared/field-limits';

/** The nine lists of Administration > Lists (epic #1314), in catalogue order. The key is also the address segment: `/admin/lists/<key>`. */
export type AdminListKey =
  | 'matter-types'
  | 'matter-categories'
  | 'current-states'
  | 'team-titles'
  | 'priorities'
  | 'status-labels'
  | 'on-hold-reasons'
  | 'note-tags'
  | 'link-roles';

export type AdminListGroup = 'Matter' | 'Task' | 'Notes' | 'Assets';

/** The four catalogue groups with the icon of each (the one icon registry, D-17: the icon of the concept the group holds). */
export const ADMIN_LIST_GROUPS: readonly {
  readonly name: AdminListGroup;
  readonly icon: string;
}[] = [
  { name: 'Matter', icon: 'pi-briefcase' },
  { name: 'Task', icon: 'pi-check-square' },
  { name: 'Notes', icon: 'pi-file-edit' },
  { name: 'Assets', icon: 'pi-database' },
];

/** How a list differs from the others (UI spec 4.3, `backend-notes.md`): the shared editor frame and the specs read these, the bodies implement them. */
export interface AdminListTraits {
  /** The field that identifies an item: `id`, `code` (Status Labels, also the URL key) or `noteTagId`. */
  readonly idField: 'id' | 'code' | 'noteTagId';
  /** The field that holds the name: `name`, `label` (Priorities) or `displayLabel` (Status Labels). */
  readonly nameField: 'name' | 'label' | 'displayLabel';
  /** The longest name the list takes. */
  readonly nameLimit: number;
  /** Items have `isActive`; Status Labels are always active, so every row counts. */
  readonly hasActive: boolean;
  /** The colour field (`color` of a priority, `colourKey` of a note tag), none for the other lists. */
  readonly colour: 'color' | 'colourKey' | null;
  /** Items are ordered by hand (`sortOrder`, Move Up and Move Down); Note Tags are alphabetical and Status Labels fixed. */
  readonly reorder: boolean;
  /** The API has a DELETE for the list and the editor offers it for an unused item. */
  readonly delete: boolean;
  /** Items can be created (Status Labels are five fixed rows). */
  readonly create: boolean;
  /** One item is the default and the menu has Set as Default (Priorities). */
  readonly defaultAction: boolean;
}

export interface AdminListDef extends AdminListTraits {
  /** The address segment and the key of the count and the row-focus ids. */
  readonly key: AdminListKey;
  readonly group: AdminListGroup;
  /** The plural name: the catalogue label, the editor's H2 and the page title. */
  readonly label: string;
  /** The permission that opens the list (any one of these). */
  readonly permission: string;
  /** "Used for", one line of at most 40 characters. */
  readonly hint: string;
  /** The "Shown on" sentence of the editor (static copy; there is no endpoint for it). */
  readonly shownOn: string;
  /** The rule line at the foot of the editor. */
  readonly rule: string;
  /** The label of the primary button (`New Matter Type`); none for a list that cannot be created. */
  readonly newLabel: string | null;
  /** The REST path of the list, for the record (the editor calls the generated client). */
  readonly endpoint: string;
}

const MATTER_SHOWN_ON = 'Shown on: Matter form, Matters list (column and filter), Matter page.';
const MATTER_RULE =
  'An item in use is deactivated, not deleted. Delete appears only for an item that nothing uses.';

/** The one registry that feeds the catalogue, the routes, the redirects, the page title and the guard (UI spec 3.1). */
export const ADMIN_LISTS: readonly AdminListDef[] = [
  {
    key: 'matter-types',
    group: 'Matter',
    label: 'Matter Types',
    permission: 'MatterList.Manage',
    hint: 'Kind of matter, set on the matter form',
    shownOn: MATTER_SHOWN_ON,
    rule: MATTER_RULE,
    newLabel: 'New Matter Type',
    endpoint: '/api/v1/matter-types',
    idField: 'id',
    nameField: 'name',
    nameLimit: ADMIN_FIELD_LIMITS.matterTypeName,
    hasActive: true,
    colour: null,
    reorder: true,
    delete: true,
    create: true,
    defaultAction: false,
  },
  {
    key: 'matter-categories',
    group: 'Matter',
    label: 'Matter Categories',
    permission: 'MatterList.Manage',
    hint: 'Category of a matter, one per matter',
    shownOn: 'Shown on: Matter form, Matter page.',
    rule: MATTER_RULE,
    newLabel: 'New Matter Category',
    endpoint: '/api/v1/matter-categories',
    idField: 'id',
    nameField: 'name',
    nameLimit: ADMIN_FIELD_LIMITS.matterCategoryName,
    hasActive: true,
    colour: null,
    reorder: true,
    delete: true,
    create: true,
    defaultAction: false,
  },
  {
    key: 'current-states',
    group: 'Matter',
    label: 'Current States',
    permission: 'MatterList.Manage',
    hint: 'Where a matter stands now',
    shownOn: MATTER_SHOWN_ON,
    rule: MATTER_RULE,
    newLabel: 'New State',
    endpoint: '/api/v1/current-states',
    idField: 'id',
    nameField: 'name',
    nameLimit: ADMIN_FIELD_LIMITS.currentStateName,
    hasActive: true,
    colour: null,
    reorder: true,
    delete: true,
    create: true,
    defaultAction: false,
  },
  {
    key: 'team-titles',
    group: 'Matter',
    label: 'Team Titles',
    permission: 'MatterList.Manage',
    hint: 'Title of each person on a matter team',
    shownOn: 'Shown on: Matter page, Team tab.',
    rule: MATTER_RULE,
    newLabel: 'New Title',
    endpoint: '/api/v1/team-titles',
    idField: 'id',
    nameField: 'name',
    nameLimit: ADMIN_FIELD_LIMITS.teamTitleName,
    hasActive: true,
    colour: null,
    reorder: true,
    delete: true,
    create: true,
    defaultAction: false,
  },
  {
    key: 'priorities',
    group: 'Task',
    label: 'Priorities',
    permission: 'Priority.Manage',
    hint: 'Urgency of every task',
    shownOn: 'Shown on: New Task form, task lists (column and filter), Task page.',
    rule: 'Order priorities from most to least urgent. Exactly one is the default.',
    newLabel: 'New Priority',
    endpoint: '/api/v1/priorities',
    idField: 'id',
    nameField: 'label',
    nameLimit: 50,
    hasActive: true,
    colour: 'color',
    reorder: true,
    delete: true,
    create: true,
    defaultAction: true,
  },
  {
    key: 'status-labels',
    group: 'Task',
    label: 'Status Labels',
    permission: 'StatusLabel.Manage',
    hint: 'Wording of the task statuses',
    shownOn: 'Shown on: task lists, Task page, Dashboard.',
    rule: "Rename how the five statuses read. You can't add or remove statuses.",
    newLabel: null,
    endpoint: '/api/v1/status-labels',
    idField: 'code',
    nameField: 'displayLabel',
    nameLimit: 50,
    hasActive: false,
    colour: null,
    reorder: false,
    delete: false,
    create: false,
    defaultAction: false,
  },
  {
    key: 'on-hold-reasons',
    group: 'Task',
    label: 'On-Hold Reasons',
    permission: 'OnHoldReason.Manage',
    hint: 'Why a task is put on hold',
    shownOn: 'Shown on: Put on Hold dialog, Task page.',
    rule: 'The reasons offered when a task is put on hold. A used reason is deactivated, not deleted.',
    newLabel: 'New Reason',
    endpoint: '/api/v1/on-hold-reasons',
    idField: 'id',
    nameField: 'name',
    nameLimit: ADMIN_FIELD_LIMITS.onHoldReasonName,
    hasActive: true,
    colour: null,
    reorder: true,
    delete: false,
    create: true,
    defaultAction: false,
  },
  {
    key: 'note-tags',
    group: 'Notes',
    label: 'Note Tags',
    // Owner decision 4 of epic #1314: Note Tags stay gated by StatusLabel.Manage (no new permission).
    permission: 'StatusLabel.Manage',
    hint: 'Tags people put on matter notes',
    shownOn: 'Shown on: Matter Notes tab (tag picker and filter), note templates.',
    rule: 'The tags people pick in a note. A tag that notes use is deactivated, not deleted.',
    newLabel: 'New Tag',
    endpoint: '/api/v1/note-tags',
    idField: 'noteTagId',
    nameField: 'name',
    nameLimit: 60,
    hasActive: true,
    colour: 'colourKey',
    reorder: false,
    delete: true,
    create: true,
    defaultAction: false,
  },
  {
    key: 'link-roles',
    group: 'Assets',
    label: 'Link Roles',
    permission: 'AssetType.Manage',
    hint: 'How an asset relates to a task',
    shownOn: 'Shown on: Link Asset dialog, Asset page, Linked Tasks tab.',
    rule: 'The roles an asset can have on a task, such as Source, Destination or Result.',
    newLabel: 'New Link Role',
    endpoint: '/api/v1/asset-link-roles',
    idField: 'id',
    nameField: 'name',
    nameLimit: ADMIN_FIELD_LIMITS.linkRoleName,
    hasActive: true,
    colour: null,
    reorder: true,
    delete: true,
    create: true,
    defaultAction: false,
  },
];

/** The permissions of the Lists page: any one of them opens it (the nav item shows for any of them). */
export const ADMIN_LIST_PERMISSIONS: readonly string[] = [
  ...new Set(ADMIN_LISTS.map((l) => l.permission)),
];

/** The lists as `AdminTab`s, so the shared helpers (`allowedAdminTabs`, `resolveAdminTab`, `adminMenuTarget`) apply the permission rule. */
export const ADMIN_LIST_TABS: readonly AdminTab[] = ADMIN_LISTS.map((l) => ({
  id: l.key,
  label: l.label,
  route: `/admin/lists/${l.key}`,
  permission: [l.permission],
  countKey: l.key,
}));

export function adminListByKey(key: string | null | undefined): AdminListDef | undefined {
  return ADMIN_LISTS.find((l) => l.key === key);
}

/** The words of the one-time notice of an old link (UI spec 6.3). */
export function movedNotice(def: AdminListDef): string {
  return `${def.label} has moved here, under Lists > ${def.group}. Update your bookmark.`;
}
