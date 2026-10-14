import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TaskTypesClient } from '../../../api/generated/api-client';
import {
  CreateTaskTypeRequest,
  TaskTypeView,
  TaskTypesApi,
  UpdateTaskTypeRequest,
} from './task-types-api';

/** Real provider over the generated client. */
@Injectable()
export class HttpTaskTypesApi extends TaskTypesApi {
  private readonly client = inject(TaskTypesClient);

  list(): Observable<TaskTypeView[]> {
    return this.client.listTaskTypes();
  }

  get(id: number): Observable<TaskTypeView> {
    return this.client.getTaskType(id);
  }

  create(request: CreateTaskTypeRequest): Observable<TaskTypeView> {
    return this.client.createTaskType(request);
  }

  update(id: number, request: UpdateTaskTypeRequest): Observable<TaskTypeView> {
    return this.client.updateTaskType(id, request);
  }
}
