import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';

/** Projects (UX S07). `new` is matched before `:projectId`. */
export const PROJECTS_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Projects',
    loadComponent: () => import('./pages/projects-list-page').then((m) => m.ProjectsListPage),
  },
  {
    path: 'new',
    title: 'New project',
    canActivate: [permissionGuard('Project.Create')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/project-form-page').then((m) => m.ProjectFormPage),
  },
  {
    path: ':projectId/edit',
    title: 'Edit project',
    canActivate: [permissionGuard('Project.Edit')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./pages/project-form-page').then((m) => m.ProjectFormPage),
  },
  {
    path: ':projectId',
    title: 'Project',
    loadComponent: () => import('./pages/project-detail-page').then((m) => m.ProjectDetailPage),
  },
];
