import { Routes } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { unsavedChangesGuard } from '../../../shared/guards/unsaved-changes.guard';
import { FormDesignerApi } from './form-designer-api';
import { HttpFormDesignerApi } from './http-form-designer-api';
import { InMemoryFormDesignerApi } from './in-memory-form-designer-api';
import { TASK_TYPE_TAB_PROVIDERS } from './task-types-providers';

const stub = environment.authProvider === 'stub';

/**
 * Task Types (UX S14), under `/admin/task-types/...` (guarded by `TaskType.Manage` in the admin routes): create, edit and the request
 * form designer. The list itself is the first tab of the Task Types page. The real APIs go over the generated client; the in-memory
 * stubs serve the stub auth provider (no backend) and unit tests. Workflows come from the workflow endpoints (stub lookup under the
 * stub provider).
 */
export const TASK_TYPE_ROUTES: Routes = [
  {
    path: '',
    providers: [
      ...TASK_TYPE_TAB_PROVIDERS,
      { provide: FormDesignerApi, useClass: stub ? InMemoryFormDesignerApi : HttpFormDesignerApi },
    ],
    children: [
      {
        path: 'new',
        title: 'New task type',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./task-type-edit-page').then((m) => m.TaskTypeEditPage),
      },
      {
        path: ':ownerId/form',
        title: 'Task type form',
        data: {
          heading: 'Task Types',
          ownerLabel: 'Task Type',
          sectionPath: '/admin/task-types',
          parentCrumbs: [{ label: 'Administration' }],
        },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./task-type-form-page').then((m) => m.TaskTypeFormPage),
      },
      {
        path: ':id',
        title: 'Edit task type',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./task-type-edit-page').then((m) => m.TaskTypeEditPage),
      },
    ],
  },
];
