import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { RolesClient, TaskTypesClient } from '../../../api/generated/api-client';
import {
  CreateTaskTypeRequest,
  PreviewTaskTypeAccessRequest,
  ReplaceTaskTypeAccessRequest,
  TaskTypeAccessPreview,
  AccessRoleChoice,
  TaskTypeAccessView,
  TaskTypeView,
  TaskTypesApi,
  UpdateTaskTypeRequest,
} from './task-types-api';

/** Real provider over the generated client. */
@Injectable()
export class HttpTaskTypesApi extends TaskTypesApi {
  private readonly client = inject(TaskTypesClient);
  private readonly roles = inject(RolesClient);

  list(workflowId?: number): Observable<TaskTypeView[]> {
    return this.client.listTaskTypes(workflowId);
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

  getAccess(id: number): Observable<TaskTypeAccessView> {
    return this.client.getTaskTypeAccess(id);
  }

  replaceAccess(id: number, request: ReplaceTaskTypeAccessRequest): Observable<TaskTypeAccessView> {
    return this.client.replaceTaskTypeAccess(id, request);
  }

  previewAccess(
    id: number,
    request: PreviewTaskTypeAccessRequest,
  ): Observable<TaskTypeAccessPreview> {
    return this.client.previewTaskTypeAccess(id, request);
  }

  accessRoles(): Observable<AccessRoleChoice[]> {
    return this.roles.listRoles().pipe(
      map((list) =>
        list
          .filter((r) => !r.isSystemAdmin)
          .map((r) => ({
            roleId: r.roleId,
            name: r.name,
            isActive: true,
            memberCount: r.memberCount,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      ),
    );
  }
}
