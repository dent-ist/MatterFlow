import { Route, Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';
import { FormDesignerApi } from './task-types/form-designer-api';
import { StepFormDesignerApi } from './steps/step-form-designer-api';

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

/** Step Library (UX S15): list, create/edit, and the step's input form in the shared form designer, backed by the Forms endpoints. */
const STEP_ROUTES: Routes = [
  lazy('steps', 'Workflow.Manage', () =>
    import('./steps/steps-list-page').then((m) => m.StepsListPage),
  ),
  {
    path: 'steps/new',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./steps/step-edit-page').then((m) => m.StepEditPage),
  },
  {
    path: 'steps/:ownerId/form',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    providers: [{ provide: FormDesignerApi, useClass: StepFormDesignerApi }],
    data: { heading: 'Step Library', ownerLabel: 'Step' },
    loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
  },
  {
    path: 'steps/:stepId',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./steps/step-edit-page').then((m) => m.StepEditPage),
  },
];

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
  ...STEP_ROUTES,
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
