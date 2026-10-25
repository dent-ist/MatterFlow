import { Permission } from '../../core/auth/permissions';

/** The two groups of the main rail (S6, #621); the Administration items are a section of their own. */
export type NavGroup = 'work' | 'records';

export const NAV_GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'work', label: 'Work' },
  { key: 'records', label: 'Records' },
];

export interface NavItem {
  label: string;
  /** The group label above it in the rail. Administration items have none. */
  group?: NavGroup;
  /** PrimeIcons class. */
  icon: string;
  path: string;
  /** Visible when the user holds ANY of these; empty = every active user. (UX Appendix C) */
  permissions: Permission[];
  /** In addition, the user must hold ALL of these (Pod Work: Pod.View and Task.View, #549). Same rule as the route's `permissionAllGuard`. */
  permissionsAll?: Permission[];
  /** Also needs at least one Dashboard tab permission (`AuthStore.hasAnyDashboardTab`): a Dashboard with no tab is a dead end. */
  needsDashboardTab?: boolean;
  /** Shows the pending-users count next to the label. */
  pendingBadge?: boolean;
  /** Other paths whose pages belong to this item (a second tab of the same page); the item is highlighted on them too. */
  alsoActive?: string[];
  /**
   * The compact menu of people who land on My Matters (epic #758, PX-17; the rule is `landsOnMyMatters`, never a role name): `more` moves the
   * item into the collapsed "More" group (every route stays reachable), `hide` leaves it out of the menu (the address still works). Without it
   * the item stays where it is.
   */
  compact?: 'more' | 'hide';
  /** The item's name in the compact menu, when it differs ("Tasks" for the Task Queue). */
  compactLabel?: string;
  /** The item's place in the compact menu's main list, or in its More group (ascending); items without one follow the others in menu order. */
  compactOrder?: number;
}

/** Left navigation (UX 2.1). Items are hidden, never disabled, without the matching View permission. */
export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    icon: 'pi pi-home',
    group: 'work',
    path: '/dashboard',
    permissions: ['Dashboard.View'],
    needsDashboardTab: true,
    compactOrder: 0,
  },
  {
    // Project Managers' home (#691): above My Work, which stays in the menu. The same three permissions as the route's guard.
    label: 'My Matters',
    group: 'work',
    icon: 'pi pi-clipboard',
    path: '/my-matters',
    permissions: ['Matter.BeManager'],
    permissionsAll: ['Matter.BeManager', 'Matter.View', 'Task.View'],
    compactOrder: 1,
  },
  {
    label: 'My Work',
    group: 'work',
    // Not `pi-user`, which is the header user button's glyph (S8, #623).
    icon: 'pi pi-check-square',
    path: '/my-work',
    permissions: ['Task.View'],
    compact: 'more',
    compactOrder: 12,
  },
  {
    label: 'Task Queue',
    group: 'work',
    icon: 'pi pi-list-check',
    path: '/tasks',
    permissions: ['Task.View'],
    compactLabel: 'Tasks',
    compactOrder: 3,
  },
  {
    label: 'Pod Work',
    group: 'work',
    icon: 'pi pi-users',
    path: '/pods/work',
    // The page lists tasks, so it needs Task.View as well as Pod.View (UX spec S04): without it the item is hidden, never a dead link.
    permissions: ['Pod.View'],
    permissionsAll: ['Pod.View', 'Task.View'],
    compact: 'hide',
  },
  {
    label: 'Clients',
    group: 'records',
    icon: 'pi pi-building',
    path: '/clients',
    permissions: ['Client.View'],
    compact: 'more',
    compactOrder: 10,
  },
  {
    label: 'Matters',
    group: 'records',
    icon: 'pi pi-briefcase',
    path: '/matters',
    permissions: ['Matter.View'],
    compactOrder: 2,
  },
  {
    label: 'Projects',
    group: 'records',
    icon: 'pi pi-folder',
    path: '/projects',
    permissions: ['Project.View'],
    compact: 'more',
    compactOrder: 11,
  },
  {
    label: 'Assets',
    group: 'records',
    icon: 'pi pi-database',
    path: '/assets',
    permissions: ['Asset.View'],
    compactOrder: 4,
  },
];

/** The menu of a person who lands on My Matters (epic #758, PX-17): the short list, and the items that moved into the collapsed "More" group. */
export interface CompactNav {
  /** My Matters, Matters, Tasks, Assets (and the Dashboard in front when the person holds it), under their compact names. */
  main: NavItem[];
  /** Clients, Projects, My Work, in menu order. */
  more: NavItem[];
}

/**
 * Splits the permitted items (already filtered by permission) into the compact menu. Pure data: the flags on the items decide, never a role
 * name. An item without a flag follows the main list in menu order, so a new item is never lost from the compact menu.
 */
export function compactNav(items: readonly NavItem[]): CompactNav {
  const named = (i: NavItem): NavItem => (i.compactLabel ? { ...i, label: i.compactLabel } : i);
  const ordered = (list: readonly NavItem[]): NavItem[] =>
    list
      .map((i, index) => ({ item: named(i), order: i.compactOrder ?? 100 + index }))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.item);
  return {
    main: ordered(items.filter((i) => !i.compact)),
    more: ordered(items.filter((i) => i.compact === 'more')),
  };
}

/** Administration section: shown only when at least one entry is permitted. */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    label: 'Users',
    icon: 'pi pi-id-card',
    path: '/admin/users',
    alsoActive: ['/admin/roles', '/admin/pods'],
    // Users tab: User.View / User.Manage; Roles tab: Role.Manage; Pods tab: Pod.Manage / Pod.ManageMembers.
    permissions: ['User.View', 'User.Manage', 'Role.Manage', 'Pod.Manage', 'Pod.ManageMembers'],
    pendingBadge: true,
  },
  {
    // One item, three tabs: Task Types, Workflows and Workflow Steps (and the create/edit/form pages under them). Task types lead to
    // their eligible workflows, which are built from the shared step library. Task Types needs TaskType.Manage, the other two
    // Workflow.Manage; a person with only Workflow.Manage lands on the Workflows tab.
    label: 'Task Types',
    icon: 'pi pi-file-edit',
    path: '/admin/task-types',
    alsoActive: ['/admin/workflows', '/admin/steps'],
    permissions: ['TaskType.Manage', 'Workflow.Manage'],
  },
  {
    label: 'Labels',
    icon: 'pi pi-flag',
    path: '/admin/priorities',
    alsoActive: ['/admin/status-labels'],
    permissions: ['Priority.Manage', 'StatusLabel.Manage'],
  },
  {
    // The Asset Types and Asset Link Roles tabs. Not the Assets data records above: the rail says "Asset types" (S5, #620), so the two
    // items differ in words as well as in icon in the 56 px rail and its tooltip. The page's own H1, crumb and tabs keep "Asset Types".
    label: 'Asset types',
    icon: 'pi pi-tags',
    path: '/admin/asset-types',
    alsoActive: ['/admin/asset-link-roles'],
    permissions: ['AssetType.Manage'],
  },
  {
    label: 'Custom Fields',
    icon: 'pi pi-sliders-h',
    path: '/admin/custom-fields',
    permissions: ['CustomField.Manage'],
  },
  {
    // The SQL reports page (#712): reports, categories, run log, assignments and the report login. The people-facing list of reports is a
    // separate item that arrives with the user screens.
    label: 'Reports',
    icon: 'pi pi-chart-bar',
    path: '/admin/reports',
    permissions: ['Report.Manage'],
  },
  {
    label: 'Audit Logs',
    icon: 'pi pi-history',
    path: '/admin/audit',
    permissions: ['Audit.View'],
  },
];
