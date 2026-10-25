import { inject } from '@angular/core';
import { Route, Router, Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { pageTab } from '../../core/title/page-title';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { AssetTypeFormDesignerApi } from './asset-types/asset-type-form-designer-api';
import { CustomFieldFormDesignerApi } from './custom-fields/custom-field-form-designer-api';
import { labelsTabGuard } from './labels-tabs';
import { FormDesignerApi } from './task-types/form-designer-api';
import { TASK_TYPE_TAB_PROVIDERS } from './task-types/task-types-providers';
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

/** The first crumb of every Administration page (#588). */
const ADMIN_CRUMBS = [{ label: 'Administration' }];

/** The Administration breadcrumb prefix of the Task Types page (the step pages add `Workflow Steps` and the step after it). */
const TASK_TYPES_CRUMBS = [
  { label: 'Administration' },
  { label: 'Task Types', link: '/admin/task-types' },
];

/**
 * Workflow Steps (UX S15): create/edit, and the step's input form in the shared form designer, backed by the Forms endpoints. The step
 * list is the third tab of the Task Types page (`/admin/steps`, see `taskTypesTabsMatcher`).
 */
const STEP_ROUTES: Routes = [
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
    data: {
      heading: 'Workflow Steps',
      ownerLabel: 'Step',
      sectionPath: '/admin/steps',
      parentCrumbs: TASK_TYPES_CRUMBS,
    },
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

/** Workflow designer (UX S16): create/edit with version history, and the version page (draft editor or read-only view). The list is the second tab of the Task Types page. */
const WORKFLOW_ROUTES: Routes = [
  {
    path: 'workflows/new',
    title: pageTab('Task Types', 'New workflow'),
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
  // Crumbs: Administration > Asset Types > <the asset type> > Fields. The title names the type once it is loaded (the form page sets it).
  data: {
    heading: 'Asset Types',
    ownerLabel: 'Asset Type',
    sectionPath: '/admin/asset-types',
    parentCrumbs: ADMIN_CRUMBS,
    formCrumbLabel: 'Fields',
  },
  loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
});

/** Custom Fields > Edit fields (UX S18): the same designer on the singleton form of Client, Matter or Project. */
const customFieldForm = (path: string): Route => ({
  path,
  title: 'Custom Fields form',
  canActivate: [permissionGuard('CustomField.Manage')],
  canDeactivate: [unsavedChangesGuard],
  providers: [{ provide: FormDesignerApi, useClass: CustomFieldFormDesignerApi }],
  // Crumbs: Administration > Custom Fields > <the object>. The title is "<object> custom fields" once it is loaded.
  data: {
    heading: 'Custom Fields',
    ownerLabel: 'Object',
    sectionPath: '/admin/custom-fields',
    parentCrumbs: ADMIN_CRUMBS,
    formCrumbLabel: '',
  },
  loadComponent: () => import('./task-types/task-type-form-page').then((m) => m.TaskTypeFormPage),
});

/** `users`, `roles` and `pods` match one route, so switching the tab keeps the page and moves focus naturally; `:tab` is the segment. */
function usersRolesMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments.length === 1 && ['users', 'roles', 'pods'].includes(segments[0].path)
    ? { consumed: segments, posParams: { tab: segments[0] } }
    : null;
}

/** `priorities` and `status-labels` are the two tabs of the Labels page; `:tab` is the segment. */
function labelsTabsMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments.length === 1 && ['priorities', 'status-labels'].includes(segments[0].path)
    ? { consumed: segments, posParams: { tab: segments[0] } }
    : null;
}

/** `task-types`, `workflows` and `steps` are the three tabs of one page (the Task Types menu item); `:tab` is the segment. */
function taskTypesTabsMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  return segments.length === 1 && ['task-types', 'workflows', 'steps'].includes(segments[0].path)
    ? { consumed: segments, posParams: { tab: segments[0] } }
    : null;
}

/** Administration (UX 2.1). Each screen needs its own *.Manage / View permission. */
export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'users' },
  {
    // /admin/users, /admin/roles and /admin/pods are the three tabs of one page; the component stays alive when the tab changes.
    matcher: usersRolesMatcher,
    // Document title = the page name plus the open tab (UXR4-12): "Users", "Users: Roles", "Users: Pods".
    title: (route) =>
      route.params['tab'] === 'roles'
        ? pageTab('Users', 'Roles')
        : route.params['tab'] === 'pods'
          ? pageTab('Users', 'Pods')
          : 'Users',
    canActivate: [
      permissionGuard('User.View', 'User.Manage', 'Role.Manage', 'Pod.Manage', 'Pod.ManageMembers'),
    ],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./users/users-roles-page').then((m) => m.UsersRolesPage),
  },
  {
    // /admin/task-types, /admin/workflows and /admin/steps are the three tabs of one page; the component stays alive when the tab
    // changes. Each tab needs its own permission (the page offers only the permitted ones), so the route needs either.
    matcher: taskTypesTabsMatcher,
    // Document title = the page name plus the open tab: "Task Types", "Task Types: Workflows", "Task Types: Workflow Steps".
    title: (route) =>
      route.params['tab'] === 'workflows'
        ? pageTab('Task Types', 'Workflows')
        : route.params['tab'] === 'steps'
          ? pageTab('Task Types', 'Workflow Steps')
          : 'Task Types',
    canActivate: [permissionGuard('TaskType.Manage', 'Workflow.Manage')],
    providers: TASK_TYPE_TAB_PROVIDERS,
    loadComponent: () =>
      import('./task-types/task-types-admin-page').then((m) => m.TaskTypesAdminPage),
  },
  {
    // Create, edit and the request form of a task type (the list is the first tab above).
    path: 'task-types',
    canActivate: [permissionGuard('TaskType.Manage')],
    loadChildren: () => import('./task-types/task-types.routes').then((m) => m.TASK_TYPE_ROUTES),
  },
  ...STEP_ROUTES,
  ...WORKFLOW_ROUTES,
  {
    // The Asset Types page of the Administration menu (not the Assets data list): title = page name plus the open tab (#588).
    ...lazyGuarded('asset-types', 'Asset Types', 'AssetType.Manage', () =>
      import('./asset-types/asset-admin-page').then((m) => m.AssetAdminPage),
    ),
    title: (route) =>
      route.queryParams['tab'] === 'link-roles'
        ? pageTab('Asset Types', 'Link Roles')
        : 'Asset Types',
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  {
    // The old Asset link roles screen is the second tab of the Assets page.
    path: 'asset-link-roles',
    pathMatch: 'full',
    redirectTo: () => inject(Router).parseUrl('/admin/asset-types?tab=link-roles'),
  },
  {
    // The asset type record page (#635): `new` is the same page with a plain header; the address is the record's own page, the designer is below it.
    path: 'asset-types/new',
    title: 'New asset type',
    canActivate: [permissionGuard('AssetType.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./asset-types/asset-type-record-page').then((m) => m.AssetTypeRecordPage),
  },
  assetTypeForm('asset-types/:ownerId/form'),
  {
    path: 'asset-types/:id',
    title: 'Asset type',
    canActivate: [permissionGuard('AssetType.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () =>
      import('./asset-types/asset-type-record-page').then((m) => m.AssetTypeRecordPage),
  },
  lazy('custom-fields', 'Custom Fields', 'CustomField.Manage', () =>
    import('./custom-fields/custom-fields-page').then((m) => m.CustomFieldsPage),
  ),
  customFieldForm('custom-fields/:ownerId/form'),
  {
    // /admin/priorities and /admin/status-labels are the two tabs of one page (Labels, #593); the component stays alive when the tab
    // changes. Each tab needs its own permission: the other tab's address falls back to the allowed one (labelsTabGuard).
    matcher: labelsTabsMatcher,
    title: (route) =>
      route.params['tab'] === 'status-labels'
        ? pageTab('Labels', 'Status labels')
        : pageTab('Labels', 'Priorities'),
    canActivate: [labelsTabGuard()],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./labels-admin-page').then((m) => m.LabelsAdminPage),
  },
  {
    // The Reports page (#712): tabs in `?tab=`. Needs Report.Manage; the 403 page shows without a request for a person without it.
    ...lazyGuarded('reports', 'Reports', 'Report.Manage', () =>
      import('./reports/reports-admin-page').then((m) => m.ReportsAdminPage),
    ),
    title: (route) => {
      const tab = route.queryParams['tab'];
      const names: Record<string, string> = {
        categories: pageTab('Reports', 'Categories'),
        runs: pageTab('Reports', 'Run log'),
        assignments: pageTab('Reports', 'Assignments'),
        health: pageTab('Reports', 'Settings'),
      };
      return names[tab] ?? 'Reports';
    },
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  {
    path: 'reports/new',
    title: 'New report',
    canActivate: [permissionGuard('Report.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./reports/report-editor-page').then((m) => m.ReportEditorPage),
  },
  {
    path: 'reports/:id',
    title: 'Report',
    canActivate: [permissionGuard('Report.Manage')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./reports/report-editor-page').then((m) => m.ReportEditorPage),
  },
  lazy('audit', 'Audit Logs', 'Audit.View', () =>
    import('./audit/audit-page').then((m) => m.AuditPage),
  ),
];
