import { Routes } from '@angular/router';
import { accessGuard, landingGuard, pendingOnlyGuard, permissionGuard } from './core/auth/guards';
import { AppShell } from './shared/layout/app-shell';

/**
 * Route tree (architecture section 3/12): Access Pending and Error sit outside the shell (no
 * nav, no search); everything else is inside the shell behind `accessGuard`, which sends users
 * without effective permissions to Access Pending. Features are lazy and never import each other.
 * Permission guards use canActivate so a denied user lands on /403 instead of a 404.
 */
export const routes: Routes = [
  {
    path: 'access-pending',
    canActivate: [pendingOnlyGuard],
    loadChildren: () =>
      import('./features/access-pending/access-pending.routes').then(
        (m) => m.ACCESS_PENDING_ROUTES,
      ),
  },
  {
    path: 'error',
    loadComponent: () => import('./features/system/pages/error-page').then((m) => m.ErrorPage),
  },
  {
    path: '',
    component: AppShell,
    canActivate: [accessGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [landingGuard], children: [] },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
      },
      {
        path: 'my-work',
        canActivate: [permissionGuard('Task.View')],
        loadChildren: () =>
          import('./features/my-work/my-work.routes').then((m) => m.MY_WORK_ROUTES),
      },
      {
        path: 'tasks',
        canActivate: [permissionGuard('Task.View')],
        loadChildren: () => import('./features/tasks/tasks.routes').then((m) => m.TASKS_ROUTES),
      },
      {
        path: 'pods/work',
        canActivate: [permissionGuard('Pod.View')],
        loadChildren: () =>
          import('./features/pod-work/pod-work.routes').then((m) => m.POD_WORK_ROUTES),
      },
      {
        path: 'clients',
        canActivate: [permissionGuard('Client.View')],
        loadChildren: () =>
          import('./features/clients/clients.routes').then((m) => m.CLIENTS_ROUTES),
      },
      {
        path: 'matters',
        canActivate: [permissionGuard('Matter.View')],
        loadChildren: () =>
          import('./features/matters/matters.routes').then((m) => m.MATTERS_ROUTES),
      },
      {
        path: 'projects',
        canActivate: [permissionGuard('Project.View')],
        loadChildren: () =>
          import('./features/projects/projects.routes').then((m) => m.PROJECTS_ROUTES),
      },
      {
        path: 'assets',
        canActivate: [permissionGuard('Asset.View')],
        loadChildren: () => import('./features/assets/assets.routes').then((m) => m.ASSETS_ROUTES),
      },
      {
        path: 'search',
        loadChildren: () => import('./features/search/search.routes').then((m) => m.SEARCH_ROUTES),
      },
      {
        path: 'admin',
        canActivate: [
          permissionGuard(
            'User.View',
            'User.Manage',
            'Role.Manage',
            'Pod.Manage',
            'Pod.ManageMembers',
            'TaskType.Manage',
            'Workflow.Manage',
            'AssetType.Manage',
            'CustomField.Manage',
            'Priority.Manage',
            'StatusLabel.Manage',
            'Audit.View',
          ),
        ],
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      {
        path: '',
        loadChildren: () => import('./features/system/system.routes').then((m) => m.SYSTEM_ROUTES),
      },
    ],
  },
];
