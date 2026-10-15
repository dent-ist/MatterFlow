import { inject } from '@angular/core';
import { Route, Router, Routes, UrlMatchResult, UrlSegment } from '@angular/router';
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

/** Like `lazy`, for screens with inline edit rows that can hold unsaved text (priorities, status labels, link roles, roles). */
const lazyGuarded = (...args: Parameters<typeof lazy>): Route => ({
  ...lazy(...args),
  canDeactivate: [unsavedChangesGuard],
});

/** Workflow Steps (UX S15): list, create/edit, and the step's input form in the shared form designer, backed by the Forms endpoints. */
const STEP_ROUTES: Routes = [
  lazy('steps', 'Workflow Steps', 'Workflow.Manage', () =>
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
    data: { heading: 'Workflow Steps', ownerLabel: 'Step', sectionPath: '/admin/steps' },
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
  title: 'Custom Fields form',
  canActivate: [permissionGuard('CustomField.Manage')],
  canDeactivate: [unsavedChangesGuard],
  providers: [{ provide: FormDesignerApi, useClass: CustomFieldFormDesignerApi }],
  data: { heading: 'Custom Fields', ownerLabel: 'Object', sectionPath: '/admin/custom-fields' },
  loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
});

/** `users` and `roles` match one route, so switching the tab keeps the page and moves focus naturally; `:tab` is the segment. */
function usersRolesMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments.length === 1 && (segments[0].path === 'users' || segments[0].path === 'roles')
    ? { consumed: segments, posParams: { tab: segments[0] } }
    : null;
}

/** Administration (UX 2.1). Each screen needs its own *.Manage / View permission. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  {
    // /admin/users and /admin/roles are the two tabs of one page; the component stays alive when the tab changes.
    matcher: usersRolesMatcher,
    title: 'Users',
    canActivate: [permissionGuard('User.View', 'User.Manage', 'Role.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./users/users-roles-page').then((m) => m.UsersRolesPage),
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
    title: 'Task Types & Forms',
    canActivate: [permissionGuard('TaskType.Manage')],
    loadChildren: () => import('./task-types/task-types.routes').then((m) => m.TASK_TYPE_ROUTES),
  },
  ...STEP_ROUTES,
  ...WORKFLOW_ROUTES,
  lazyGuarded('asset-types', 'Asset types and link roles', 'AssetType.Manage', () =>
    import('./asset-types/asset-admin-page').then((m) => m.AssetAdminPage),
  ),
  {
    // The old Asset link roles screen is the second tab of the Assets page.
    path: 'asset-link-roles',
    pathMatch: 'full',
    redirectTo: () => inject(Router).parseUrl('/admin/asset-types?tab=link-roles'),
  },
  assetTypeForm('asset-types/:ownerId/form'),
  lazy('custom-fields', 'Custom Fields', 'CustomField.Manage', () =>
    import('./custom-fields/custom-fields-page').then((m) => m.CustomFieldsPage),
  ),
  customFieldForm('custom-fields/:ownerId/form'),
  lazyGuarded('priorities', 'Priorities', 'Priority.Manage', () =>
    import('./priorities/priorities-page').then((m) => m.PrioritiesPage),
  ),
  lazyGuarded('status-labels', 'Status labels', 'StatusLabel.Manage', () =>
    import('./status-labels/status-labels-page').then((m) => m.StatusLabelsPage),
  ),
  lazy('audit', 'Audit Logs', 'Audit.View', () =>
    import('./audit/audit-page').then((m) => m.AuditPage),
  ),
];
