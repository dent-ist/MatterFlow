import { Permission } from '../../core/auth/permissions';

export interface NavItem {
  label: string;
  /** PrimeIcons class. */
  icon: string;
  path: string;
  /** Visible when the user holds ANY of these; empty = every active user. (UX Appendix C) */
  permissions: Permission[];
  /** Shows the pending-users count next to the label. */
  pendingBadge?: boolean;
}

/** Left navigation (UX 2.1). Items are hidden, never disabled, without the matching View permission. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', icon: 'pi pi-home', path: '/dashboard', permissions: [] },
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
    label: 'Users & roles',
    icon: 'pi pi-id-card',
    path: '/admin/users',
    permissions: ['User.View', 'User.Manage', 'Role.Manage'],
    pendingBadge: true,
  },
  {
    label: 'Pods',
    icon: 'pi pi-sitemap',
    path: '/admin/pods',
    permissions: ['Pod.Manage', 'Pod.ManageMembers'],
  },
  {
    label: 'Task types & forms',
    icon: 'pi pi-file-edit',
    path: '/admin/task-types',
    permissions: ['TaskType.Manage'],
  },
  {
    label: 'Step library',
    icon: 'pi pi-clone',
    path: '/admin/steps',
    permissions: ['Workflow.Manage'],
  },
  {
    label: 'Workflows',
    icon: 'pi pi-share-alt',
    path: '/admin/workflows',
    permissions: ['Workflow.Manage'],
  },
  {
    label: 'Priorities & status labels',
    icon: 'pi pi-flag',
    path: '/admin/priorities',
    permissions: ['Priority.Manage', 'StatusLabel.Manage'],
  },
  {
    label: 'Asset types',
    icon: 'pi pi-tags',
    path: '/admin/asset-types',
    permissions: ['AssetType.Manage'],
  },
  {
    label: 'Asset link roles',
    icon: 'pi pi-link',
    path: '/admin/asset-link-roles',
    permissions: ['AssetType.Manage'],
  },
  {
    label: 'Custom fields',
    icon: 'pi pi-sliders-h',
    path: '/admin/custom-fields',
    permissions: ['CustomField.Manage'],
  },
  {
    label: 'Audit log',
    icon: 'pi pi-history',
    path: '/admin/audit',
    permissions: ['Audit.View'],
  },
];
