import { Routes } from '@angular/router';
import { environment } from '../../../../environments/environment';
import {
  HttpWorkflowLookup,
  StubWorkflowLookup,
  WorkflowLookup,
} from '../../../core/lookups/workflow-lookup';
import { unsavedChangesGuard } from '../../../shared/guards/unsaved-changes.guard';
import { FormDesignerApi } from './form-designer-api';
import { HttpFormDesignerApi } from './http-form-designer-api';
import { HttpTaskTypesApi } from './http-task-types-api';
import { InMemoryFormDesignerApi } from './in-memory-form-designer-api';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
import { TaskTypesApi } from './task-types-api';

const stub = environment.authProvider === 'stub';

/**
 * Task Types & Forms (UX S14), under `/admin/task-types` (guarded by `TaskType.Manage` in the admin routes): the list, create/edit and
 * the request form designer. The real APIs go over the generated client; the in-memory stubs serve the stub auth provider (no
 * backend) and unit tests. Workflows come from the workflow endpoints (stub lookup under the stub provider).
 */
export const TASK_TYPE_ROUTES: Routes = [
  {
    path: '',
    providers: [
      { provide: TaskTypesApi, useClass: stub ? InMemoryTaskTypesApi : HttpTaskTypesApi },
      { provide: FormDesignerApi, useClass: stub ? InMemoryFormDesignerApi : HttpFormDesignerApi },
      { provide: WorkflowLookup, useClass: stub ? StubWorkflowLookup : HttpWorkflowLookup },
    ],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./task-types-page').then((m) => m.TaskTypesPage),
      },
      {
        path: 'new',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./task-type-edit-page').then((m) => m.TaskTypeEditPage),
      },
      {
        path: ':ownerId/form',
        data: { heading: 'Task Types & Forms', ownerLabel: 'Task Type' },
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./task-type-form-page').then((m) => m.TaskTypeFormPage),
      },
      {
        path: ':id',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./task-type-edit-page').then((m) => m.TaskTypeEditPage),
      },
    ],
  },
];
