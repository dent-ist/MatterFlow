import { Permission } from '../../core/auth/permissions';

export interface NavItem {
  label: string;
  /** PrimeIcons class. */
  icon: string;
  path: string;
  /** Visible when the user holds ANY of these; empty = every active user. (UX Appendix C) */
  permissions: Permission[];
  /** Also needs at least one Dashboard tab permission (`AuthStore.hasAnyDashboardTab`): a Dashboard with no tab is a dead end. */
  needsDashboardTab?: boolean;
  /** Shows the pending-users count next to the label. */
  pendingBadge?: boolean;
  /** Other paths whose pages belong to this item (a second tab of the same page); the item is highlighted on them too. */
  alsoActive?: string[];
}

/** Left navigation (UX 2.1). Items are hidden, never disabled, without the matching View permission. */
export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    icon: 'pi pi-home',
    path: '/dashboard',
    permissions: ['Dashboard.View'],
    needsDashboardTab: true,
  },
  { label: 'My Work', icon: 'pi pi-user', path: '/my-work', permissions: ['Task.View'] },
  { label: 'Task Queue', icon: 'pi pi-list-check', path: '/tasks', permissions: ['Task.View'] },
  { label: 'Pod Work', icon: 'pi pi-users', path: '/pods/work', permissions: ['Pod.View'] },
  { label: 'Clients', icon: 'pi pi-building', path: '/clients', permissions: ['Client.View'] },
  { label: 'Matters', icon: 'pi pi-briefcase', path: '/matters', permissions: ['Matter.View'] },
  { label: 'Projects', icon: 'pi pi-folder', path: '/projects', permissions: ['Project.View'] },
  { label: 'Assets', icon: 'pi pi-database', path: '/assets', permissions: ['Asset.View'] },
];

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
    // The Asset Types and Asset Link Roles tabs. Not the Assets data records above; the page itself is titled "Asset types and link roles".
    label: 'Assets',
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
    label: 'Audit Logs',
    icon: 'pi pi-history',
    path: '/admin/audit',
    permissions: ['Audit.View'],
  },
];
