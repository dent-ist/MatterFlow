import { Provider } from '@angular/core';
import { environment } from '../../../../environments/environment';
import {
  HttpWorkflowLookup,
  StubWorkflowLookup,
  WorkflowLookup,
} from '../../../core/lookups/workflow-lookup';
import { HttpTaskTypesApi } from './http-task-types-api';
import { InMemoryTaskTypesApi } from './in-memory-task-types-api';
import { TaskTypesApi } from './task-types-api';

const stub = environment.authProvider === 'stub';

let inMemory: InMemoryTaskTypesApi | undefined;
const memory = (): InMemoryTaskTypesApi => (inMemory ??= new InMemoryTaskTypesApi());

/**
 * What the Task Types tab needs: the task type API and the workflow lookup (names of the eligible workflows). The page of the three
 * tabs (`/admin/task-types`, see `taskTypesTabsMatcher` in the admin routes) provides them, and so do the pages below.
 */
export const TASK_TYPE_TAB_PROVIDERS: Provider[] = [
  // One in-memory instance for the whole stub session, so a type created on its edit page shows in the list of the tab.
  { provide: TaskTypesApi, useFactory: () => (stub ? memory() : new HttpTaskTypesApi()) },
  { provide: WorkflowLookup, useClass: stub ? StubWorkflowLookup : HttpWorkflowLookup },
];
