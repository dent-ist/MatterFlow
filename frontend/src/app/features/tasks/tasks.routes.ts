import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';

export const TASKS_ROUTES: Routes = [
  { path: '', component: PlaceholderPage, data: { title: 'Task Queue' } },
  {
    path: 'new',
    canActivate: [permissionGuard('Task.Create')],
    component: PlaceholderPage,
    data: { title: 'Create Task' },
  },
  { path: ':id', component: PlaceholderPage, data: { title: 'Task' } },
];
