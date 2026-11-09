import { Permission } from '../../core/auth/permissions';
import { pageIcon } from '../ui/tab-icons';

export interface NavItem {
  label: string;
  /** PrimeIcons classes, from the one icon registry (`pageIcon`, shared/ui/tab-icons.ts); the page tile shows the same icon. */
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
  /** Drawn indented under the item before it (Projects and Assets under Matters, MM-59 #951); a normal link, not a collapsible group. */
  child?: boolean;
  /** Left out of the menu of a person who lands on My Matters (epic #758; the rule is `landsOnMyMattersPage`, the resolved landing page, never a role name). The address still works. */
  hideWhenCompact?: boolean;
}

/**
 * Left navigation (UX 2.1; MM-59 #951): ONE order for everybody, Dashboard, My Matters, My Work, Clients, Matters (with Projects and Assets
 * indented under it), Pod Work, Tasks (the Task Queue; UI update epic #953 moved Pod Work before it, superseding #952), Reports (#718). Items are hidden, never disabled, without the matching View permission; each keeps its own rule, so a
 * person who may open Projects but not Matters still sees Projects at its place.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    icon: pageIcon('dashboard'),
    path: '/dashboard',
    permissions: ['Dashboard.View'],
    needsDashboardTab: true,
  },
  {
    // Project Managers' home (#691): above My Work, which stays in the menu. The same three permissions as the route's guard.
    label: 'My Matters',
    icon: pageIcon('my-matters'),
    path: '/my-matters',
    permissions: ['Matter.BeManager'],
    permissionsAll: ['Matter.BeManager', 'Matter.View', 'Task.View'],
  },
  {
    label: 'My Work',
    icon: pageIcon('my-work'),
    path: '/my-work',
    permissions: ['Task.View'],
  },
  {
    label: 'Clients',
    icon: pageIcon('clients'),
    path: '/clients',
    permissions: ['Client.View'],
  },
  {
    label: 'Matters',
    icon: pageIcon('matters'),
    path: '/matters',
    permissions: ['Matter.View'],
  },
  {
    label: 'Projects',
    icon: pageIcon('projects'),
    path: '/projects',
    permissions: ['Project.View'],
    child: true,
  },
  {
    label: 'Assets',
    icon: pageIcon('assets'),
    path: '/assets',
    permissions: ['Asset.View'],
    child: true,
  },
  {
    label: 'Pod Work',
    icon: pageIcon('pod-work'),
    path: '/pods/work',
    // The page lists tasks, so it needs Task.View as well as Pod.View (UX spec S04): without it the item is hidden, never a dead link.
    permissions: ['Pod.View'],
    permissionsAll: ['Pod.View', 'Task.View'],
    hideWhenCompact: true,
  },
  {
    label: 'Task Queue',
    icon: pageIcon('task-queue'),
    path: '/tasks',
    permissions: ['Task.View'],
  },
  {
    // The people-facing list of the reports a person may run (#718). Shown to everybody with Report.Run, also when nothing is assigned yet (the page
    // then says why it is empty; owner decision 10 of the Reports review). No `hideWhenCompact`: the compact menu of the Project Manager lists it (#775).
    label: 'Reports',
    icon: pageIcon('reports'),
    path: '/reports',
    permissions: ['Report.Run'],
  },
];

/**
 * The main menu of the permitted items (already filtered by permission). A person who lands on My Matters (epic #758) sees no Pod Work
 * (the Task Queue is called "Task Queue" for everybody, #978); everybody else sees the items as defined. Pure data: the flags on the items decide, never a role name.
 */
export function mainNav(items: readonly NavItem[], compact: boolean): NavItem[] {
  return items.filter((i) => !(compact && i.hideWhenCompact));
}

/** Administration section: shown only when at least one entry is permitted. */
export const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    label: 'Users',
    icon: pageIcon('users'),
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
    icon: pageIcon('task-types'),
    path: '/admin/task-types',
    alsoActive: ['/admin/workflows', '/admin/steps'],
    permissions: ['TaskType.Manage', 'Workflow.Manage'],
  },
  {
    label: 'Labels',
    icon: pageIcon('labels'),
    path: '/admin/priorities',
    alsoActive: ['/admin/status-labels', '/admin/on-hold-reasons', '/admin/note-tags'],
    permissions: ['Priority.Manage', 'StatusLabel.Manage', 'OnHoldReason.Manage'],
  },
  {
    // The Asset Types and Asset Link Roles tabs. Not the Assets data records above: the rail says "Asset types" (S5, #620), so the two
    // items differ in words as well as in icon in the 56 px rail and its tooltip. The page's own H1, crumb and tabs keep "Asset Types".
    label: 'Asset Types',
    icon: pageIcon('asset-types'),
    path: '/admin/asset-types',
    alsoActive: ['/admin/asset-link-roles'],
    permissions: ['AssetType.Manage'],
  },
  {
    label: 'Custom Fields',
    icon: pageIcon('custom-fields'),
    path: '/admin/custom-fields',
    permissions: ['CustomField.Manage'],
  },
  {
    // Matter Types, Current States and Team Titles: the pick lists of the Matter (epic #1298). One item, one permission.
    label: 'Matter Lists',
    icon: pageIcon('matter-lists'),
    path: '/admin/matter-types',
    alsoActive: ['/admin/current-states', '/admin/team-titles'],
    permissions: ['MatterList.Manage'],
  },
  {
    // The SQL reports setup page (#712): reports, categories, run log, assignments and the report login. Named "Report Setup" so that it differs
    // from the people-facing Reports item of the main menu (#718, owner decision 9 of the Reports review); the path and the permission are unchanged.
    label: 'Report Setup',
    icon: pageIcon('report-setup'),
    path: '/admin/reports',
    permissions: ['Report.Manage'],
  },
  {
    label: 'Audit Logs',
    icon: pageIcon('audit-logs'),
    path: '/admin/audit',
    permissions: ['Audit.View'],
  },
  {
    // Application settings (epic #850): today the Branding section (application name and icon).
    label: 'Settings',
    icon: pageIcon('settings'),
    path: '/admin/settings',
    permissions: ['Settings.Manage'],
  },
];
