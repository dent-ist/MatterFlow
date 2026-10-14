import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Projects (UX S07). `new` is matched before `:projectId`. */
export const PROJECTS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/projects-list-page').then((m) => m.ProjectsListPage),
  },
  {
    path: 'new',
    canActivate: [permissionGuard('Project.Create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/project-form-page').then((m) => m.ProjectFormPage),
  },
  {
    path: ':projectId/edit',
    canActivate: [permissionGuard('Project.Edit')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/project-form-page').then((m) => m.ProjectFormPage),
  },
  {
    path: ':projectId',
    loadComponent: () => import('./pages/project-detail-page').then((m) => m.ProjectDetailPage),
  },
];
