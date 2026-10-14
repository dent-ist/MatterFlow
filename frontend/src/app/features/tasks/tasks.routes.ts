import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { MF_ASSET_PICKER, MF_USER_PICKER } from 'form-engine';
import { unsavedChangesGuard } from '../../shared/guards/unsaved-changes.guard';
import { AssetPicker } from '../../shared/ui/asset-picker';
import { PlaceholderPage } from '../../shared/ui/placeholder-page';
import { UserPicker } from './create/user-picker';

export const TASKS_ROUTES: Routes = [
  {
    path: '',
    title: 'Task Queue',
    loadComponent: () => import('../task-queue/pages/task-queue-page').then((m) => m.TaskQueuePage),
  },
  {
    path: 'new',
    canActivate: [permissionGuard('Task.Create')],
    canDeactivate: [unsavedChangesGuard],
    providers: [
      { provide: MF_ASSET_PICKER, useValue: AssetPicker },
      { provide: MF_USER_PICKER, useValue: UserPicker },
    ],
    loadComponent: () => import('./create/create-task-page').then((m) => m.CreateTaskPage),
  },
  {
    path: ':id',
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./detail/task-detail-page').then((m) => m.TaskDetailPage),
  },
];
