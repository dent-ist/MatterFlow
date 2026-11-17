import { Observable } from 'rxjs';
import type {
  CreateTaskTypeRequest,
  PreviewTaskTypeAccessRequest,
  ReplaceTaskTypeAccessRequest,
  TaskTypeAccessLists,
  TaskTypeAccessPreview,
  TaskTypeAccessRole,
  TaskTypeAccessView,
  TaskTypeView,
  UpdateTaskTypeRequest,
} from '../../../api/generated/api-client';

/** A role a list may name: its name, whether it is active and how many people hold it (shown beside it in the lists). */
export type AccessRoleChoice = TaskTypeAccessRole & { memberCount?: number };

export type {
  CreateTaskTypeRequest,
  PreviewTaskTypeAccessRequest,
  ReplaceTaskTypeAccessRequest,
  TaskTypeAccessLists,
  TaskTypeAccessPreview,
  TaskTypeAccessRole,
  TaskTypeAccessView,
  TaskTypeView,
  UpdateTaskTypeRequest,
};

/**
 * Task Type administration (UX S14). The admin routes provide `HttpTaskTypesApi` (generated client) or, with the stub auth provider,
 * `InMemoryTaskTypesApi`. Failures are `ApiError`s (DUPLICATE_NAME, CONCURRENCY_CONFLICT, field errors keyed by DTO property).
 */
export abstract class TaskTypesApi {
  /** All task types by name; with `workflowId` only those for which that workflow is eligible. */
  abstract list(workflowId?: number): Observable<TaskTypeView[]>;
  abstract get(id: number): Observable<TaskTypeView>;
  abstract create(request: CreateTaskTypeRequest): Observable<TaskTypeView>;
  abstract update(id: number, request: UpdateTaskTypeRequest): Observable<TaskTypeView>;
  /** The access rules of a type with the roles that may be chosen and whether the server enforces them (`GET /task-types/{id}/access`, #1399). */
  abstract getAccess(id: number): Observable<TaskTypeAccessView>;
  /** Replaces the three lists; shares the row version of the type (`PUT /task-types/{id}/access`). */
  abstract replaceAccess(
    id: number,
    request: ReplaceTaskTypeAccessRequest,
  ): Observable<TaskTypeAccessView>;
  /** Who would lose access if these lists were saved (`POST /task-types/{id}/access/preview`); changes nothing. */
  abstract previewAccess(
    id: number,
    request: PreviewTaskTypeAccessRequest,
  ): Observable<TaskTypeAccessPreview>;
  /**
   * The roles the lists may use: every role but System Admin, which always sees everything (`GET /roles`, readable with `TaskType.Manage`). The type's own access
   * view only names the roles already in its lists, so the choices come from here; whether a role is active comes from the access view.
   */
  abstract accessRoles(): Observable<AccessRoleChoice[]>;
}
