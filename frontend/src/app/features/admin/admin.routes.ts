import { Route, Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

const page = (path: string, title: string, ...codes: Parameters<typeof permissionGuard>) => ({
  path,
  canActivate: [permissionGuard(...codes)],
  component: PlaceholderPage,
  data: { title },
});

const lazy = (
  path: string,
  permission: Parameters<typeof permissionGuard>[0],
  loadComponent: Route['loadComponent'],
): Route => ({ path, canActivate: [permissionGuard(permission)], loadComponent });

/** Administration (UX 2.1). Each screen needs its own *.Manage / View permission. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  {
    path: 'users',
    canActivate: [permissionGuard('User.View')],
    loadComponent: () => import('./users/users-page').then((m) => m.UsersPage),
  },
  {
    path: 'roles',
    canActivate: [permissionGuard('Role.Manage')],
    loadComponent: () => import('./roles/roles-page').then((m) => m.RolesPage),
  },
  {
    path: 'pods',
    canActivate: [permissionGuard('Pod.Manage', 'Pod.ManageMembers')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pods/pods-page').then((m) => m.PodsPage),
  },
  {
    path: 'task-types',
    canActivate: [permissionGuard('TaskType.Manage')],
    loadChildren: () => import('./task-types/task-types.routes').then((m) => m.TASK_TYPE_ROUTES),
  },
  page('steps', 'Step Library', 'Workflow.Manage'),
  page('workflows', 'Workflows', 'Workflow.Manage'),
  page('asset-types', 'Asset Types', 'AssetType.Manage'),
  page('custom-fields', 'Custom Fields', 'CustomField.Manage'),
  lazy('priorities', 'Priority.Manage', () =>
    import('./priorities/priorities-page').then((m) => m.PrioritiesPage),
  ),
  lazy('status-labels', 'StatusLabel.Manage', () =>
    import('./status-labels/status-labels-page').then((m) => m.StatusLabelsPage),
  ),
  lazy('asset-link-roles', 'AssetType.Manage', () =>
    import('./asset-link-roles/asset-link-roles-page').then((m) => m.AssetLinkRolesPage),
  ),
  page('audit', 'Audit Log', 'Audit.View'),
];
