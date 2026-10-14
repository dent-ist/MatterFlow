import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

const page = (path: string, title: string, ...codes: Parameters<typeof permissionGuard>) => ({
  path,
  canActivate: [permissionGuard(...codes)],
  component: PlaceholderPage,
  data: { title },
});

/** Administration (UX 2.1). Each screen needs its own *.Manage / View permission. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  page('users', 'Users & Roles', 'User.View', 'User.Manage', 'Role.Manage'),
  page('roles', 'Roles & Permissions', 'Role.Manage'),
  page('pods', 'Pods', 'Pod.Manage', 'Pod.ManageMembers'),
  page('task-types', 'Task Types & Forms', 'TaskType.Manage'),
  page('steps', 'Step Library', 'Workflow.Manage'),
  page('workflows', 'Workflows', 'Workflow.Manage'),
  page('asset-types', 'Asset Types', 'AssetType.Manage'),
  page('custom-fields', 'Custom Fields', 'CustomField.Manage'),
  page('priorities', 'Priorities', 'Priority.Manage'),
  page('status-labels', 'Status Labels', 'StatusLabel.Manage'),
  page('audit', 'Audit Log', 'Audit.View'),
];
