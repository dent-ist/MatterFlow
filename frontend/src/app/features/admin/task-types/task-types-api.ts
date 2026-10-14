import { Observable } from 'rxjs';
import type {
  CreateTaskTypeRequest,
  TaskTypeView,
  UpdateTaskTypeRequest,
} from '../../../api/generated/api-client';

export type { CreateTaskTypeRequest, TaskTypeView, UpdateTaskTypeRequest };

/**
 * Task Type administration (UX S14). The admin routes provide `HttpTaskTypesApi` (generated client) or, with the stub auth provider,
 * `InMemoryTaskTypesApi`. Failures are `ApiError`s (DUPLICATE_NAME, CONCURRENCY_CONFLICT, field errors keyed by DTO property).
 */
export abstract class TaskTypesApi {
  abstract list(): Observable<TaskTypeView[]>;
  abstract get(id: number): Observable<TaskTypeView>;
  abstract create(request: CreateTaskTypeRequest): Observable<TaskTypeView>;
  abstract update(id: number, request: UpdateTaskTypeRequest): Observable<TaskTypeView>;
}
