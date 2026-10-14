import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

export const TASKS_ROUTES: Routes = [
  { path: '', component: PlaceholderPage, data: { title: 'Task Queue' } },
  {
    path: 'new',
    canActivate: [permissionGuard('Task.Create')],
    component: PlaceholderPage,
    data: { title: 'Create Task' },
  },
  {
    path: ':id',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./detail/task-detail-page').then((m) => m.TaskDetailPage),
  },
];
