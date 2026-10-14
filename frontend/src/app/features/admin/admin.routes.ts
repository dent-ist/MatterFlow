import { Route, Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { AssetTypeFormDesignerApi } from './asset-types/asset-type-form-designer-api';
import { CustomFieldFormDesignerApi } from './custom-fields/custom-field-form-designer-api';
import { FormDesignerApi } from './task-types/form-designer-api';
import { StepFormDesignerApi } from './steps/step-form-designer-api';

const lazy = (
  path: string,
  title: string,
  permission: Parameters<typeof permissionGuard>[0],
  loadComponent: Route['loadComponent'],
): Route => ({ path, title, canActivate: [permissionGuard(permission)], loadComponent });

/** Step Library (UX S15): list, create/edit, and the step's input form in the shared form designer, backed by the Forms endpoints. */
const STEP_ROUTES: Routes = [
  lazy('steps', 'Step library', 'Workflow.Manage', () =>
    import('./steps/steps-list-page').then((m) => m.StepsListPage),
  ),
  {
    path: 'steps/new',
    title: 'New step',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./steps/step-edit-page').then((m) => m.StepEditPage),
  },
  {
    path: 'steps/:ownerId/form',
    title: 'Step form',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    providers: [{ provide: FormDesignerApi, useClass: StepFormDesignerApi }],
    data: { heading: 'Step library', ownerLabel: 'Step', sectionPath: '/admin/steps' },
    loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
  },
  {
    path: 'steps/:stepId',
    title: 'Edit step',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./steps/step-edit-page').then((m) => m.StepEditPage),
  },
];

/** Workflow designer (UX S16): list, create/edit with version history, and the version page (draft editor or read-only view). */
const WORKFLOW_ROUTES: Routes = [
  lazy('workflows', 'Workflows', 'Workflow.Manage', () =>
    import('./workflows/workflows-list-page').then((m) => m.WorkflowsListPage),
  ),
  {
    path: 'workflows/new',
    title: 'New workflow',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./workflows/workflow-edit-page').then((m) => m.WorkflowEditPage),
  },
  {
    path: 'workflows/:workflowId/versions/:versionId',
    title: 'Workflow version',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./workflows/workflow-version-page').then((m) => m.WorkflowVersionPage),
  },
  {
    path: 'workflows/:workflowId',
    title: 'Edit workflow',
    canActivate: [permissionGuard('Workflow.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./workflows/workflow-edit-page').then((m) => m.WorkflowEditPage),
  },
];

/** Asset Types > Fields (UX S17): the same designer, backed by the forms endpoints for the Asset Type's form. */
const assetTypeForm = (path: string): Route => ({
  path,
  title: 'Asset type fields',
  canActivate: [permissionGuard('AssetType.Manage')],
  canDeactivate: [unsavedChangesGuard],
  providers: [{ provide: FormDesignerApi, useClass: AssetTypeFormDesignerApi }],
  data: { heading: 'Asset types', ownerLabel: 'Asset Type', sectionPath: '/admin/asset-types' },
  loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
});

/** Custom Fields > Edit fields (UX S18): the same designer on the singleton form of Client, Matter or Project. */
const customFieldForm = (path: string): Route => ({
  path,
  title: 'Custom field form',
  canActivate: [permissionGuard('CustomField.Manage')],
  canDeactivate: [unsavedChangesGuard],
  providers: [{ provide: FormDesignerApi, useClass: CustomFieldFormDesignerApi }],
  data: { heading: 'Custom fields', ownerLabel: 'Object', sectionPath: '/admin/custom-fields' },
  loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
});

/** Administration (UX 2.1). Each screen needs its own *.Manage / View permission. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  {
    path: 'users',
    title: 'Users',
    canActivate: [permissionGuard('User.View')],
    loadComponent: () => import('./users/users-page').then((m) => m.UsersPage),
  },
  {
    path: 'roles',
    title: 'Roles',
    canActivate: [permissionGuard('Role.Manage')],
    loadComponent: () => import('./roles/roles-page').then((m) => m.RolesPage),
  },
  {
    path: 'pods',
    title: 'Pods',
    canActivate: [permissionGuard('Pod.Manage', 'Pod.ManageMembers')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pods/pods-page').then((m) => m.PodsPage),
  },
  {
    path: 'task-types',
    title: 'Task types',
    canActivate: [permissionGuard('TaskType.Manage')],
    loadChildren: () => import('./task-types/task-types.routes').then((m) => m.TASK_TYPE_ROUTES),
  },
  ...STEP_ROUTES,
  ...WORKFLOW_ROUTES,
  lazy('asset-types', 'Asset types', 'AssetType.Manage', () =>
    import('./asset-types/asset-types-page').then((m) => m.AssetTypesPage),
  ),
  assetTypeForm('asset-types/:ownerId/form'),
  lazy('custom-fields', 'Custom fields', 'CustomField.Manage', () =>
    import('./custom-fields/custom-fields-page').then((m) => m.CustomFieldsPage),
  ),
  customFieldForm('custom-fields/:ownerId/form'),
  lazy('priorities', 'Priorities', 'Priority.Manage', () =>
    import('./priorities/priorities-page').then((m) => m.PrioritiesPage),
  ),
  lazy('status-labels', 'Status labels', 'StatusLabel.Manage', () =>
    import('./status-labels/status-labels-page').then((m) => m.StatusLabelsPage),
  ),
  lazy('asset-link-roles', 'Asset link roles', 'AssetType.Manage', () =>
    import('./asset-link-roles/asset-link-roles-page').then((m) => m.AssetLinkRolesPage),
  ),
  lazy('audit', 'Audit log', 'Audit.View', () =>
    import('./audit/audit-page').then((m) => m.AuditPage),
  ),
];
