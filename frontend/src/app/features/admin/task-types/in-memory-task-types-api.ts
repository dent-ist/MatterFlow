import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { FormVersionStatus } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import {
  CreateTaskTypeRequest,
  TaskTypeView,
  TaskTypesApi,
  UpdateTaskTypeRequest,
} from './task-types-api';

const problem = (
  status: number,
  code: string,
  detail: string,
  errors?: Record<string, { code: string; message: string }[]>,
): ApiError => ApiError.from(new HttpErrorResponse({ status, error: { code, detail, errors } }));

/**
 * Stand-in for the Task Types API (stub auth provider, unit tests): same rules as the server for names, the default workflow and the
 * "usable for new Tasks" flags. Form status is seeded for Data Processing only; new types start with an empty, unpublished form.
 */
@Injectable()
export class InMemoryTaskTypesApi extends TaskTypesApi {
  private nextId = 2;
  private revision = 1;
  private rows: TaskTypeView[] = [
    this.withFlags({
      id: 1,
      name: 'Data Processing',
      description: 'Process and load collected data.',
      iconKey: 'cpu-2',
      isActive: true,
      defaultWorkflowDefinitionId: 1,
      eligibleWorkflowIds: [1, 2],
      formDefinitionId: 1,
      formStatus: FormVersionStatus.Published,
      publishedFormVersionId: 1,
      publishedFormVersionNo: 1,
      draftFormVersionNo: undefined,
      hasFormFields: true,
      isUsable: false,
      usabilityIssues: [],
      rowVersion: '',
    }),
  ];

  list(workflowId?: number): Observable<TaskTypeView[]> {
    return this.run(() =>
      this.rows
        .filter((r) => workflowId === undefined || r.eligibleWorkflowIds.includes(workflowId))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => structuredClone(r)),
    );
  }

  get(id: number): Observable<TaskTypeView> {
    return this.run(() => structuredClone(this.find(id)));
  }

  create(request: CreateTaskTypeRequest): Observable<TaskTypeView> {
    return this.run(() => {
      const name = this.checkName(request.name, null);
      const eligible = this.check(
        request.eligibleWorkflowIds ?? [],
        request.defaultWorkflowDefinitionId,
      );
      const id = this.nextId++;
      const row = this.withFlags({
        id,
        name,
        description: request.description?.trim() || undefined,
        iconKey: this.checkIcon(request.iconKey, true),
        isActive: request.isActive ?? true,
        defaultWorkflowDefinitionId: request.defaultWorkflowDefinitionId,
        eligibleWorkflowIds: eligible,
        formDefinitionId: id,
        formStatus: undefined,
        publishedFormVersionId: undefined,
        publishedFormVersionNo: undefined,
        draftFormVersionNo: undefined,
        hasFormFields: false,
        isUsable: false,
        usabilityIssues: [],
        rowVersion: '',
      });
      this.rows.push(row);
      return structuredClone(row);
    });
  }

  update(id: number, request: UpdateTaskTypeRequest): Observable<TaskTypeView> {
    return this.run(() => {
      const current = this.find(id);
      if (request.rowVersion !== current.rowVersion) {
        throw problem(
          409,
          'CONCURRENCY_CONFLICT',
          'Someone else changed this item. Reload and try again.',
        );
      }
      const name = this.checkName(request.name, id);
      const eligible = this.check(request.eligibleWorkflowIds, request.defaultWorkflowDefinitionId);
      const next = this.withFlags({
        ...current,
        name,
        description: request.description?.trim() || undefined,
        iconKey: this.checkIcon(request.iconKey, false),
        isActive: request.isActive,
        defaultWorkflowDefinitionId: request.defaultWorkflowDefinitionId,
        eligibleWorkflowIds: eligible,
      });
      this.rows = this.rows.map((r) => (r.id === id ? next : r));
      return structuredClone(next);
    });
  }

  private find(id: number): TaskTypeView {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw problem(404, 'NOT_FOUND', 'Task type not found.');
    return row;
  }

  private checkName(value: string, exceptId: number | null): string {
    const name = value.trim();
    if (!name) {
      throw problem(400, 'VALIDATION_FAILED', 'Enter a name.', {
        name: [{ code: 'REQUIRED', message: 'Enter a name.' }],
      });
    }
    if (this.rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase())) {
      const message = `A task type named '${name}' already exists.`;
      throw problem(409, 'DUPLICATE_NAME', message, { name: [{ code: 'DUPLICATE', message }] });
    }
    return name;
  }

  private checkIcon(key: string | undefined, allowOmitted: boolean): string {
    if (key === undefined && allowOmitted) return 'file-text';
    if (!key || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
      const message = key ? 'Choose an icon from the library.' : 'Choose an icon.';
      throw problem(400, 'VALIDATION_FAILED', message, {
        iconKey: [{ code: key ? 'UNKNOWN_ICON' : 'REQUIRED', message }],
      });
    }
    return key;
  }

  private check(ids: number[], defaultId: number | undefined): number[] {
    const eligible = [...new Set(ids)].sort((a, b) => a - b);
    if (defaultId !== undefined && !eligible.includes(defaultId)) {
      const message = 'The default workflow must be one of the eligible workflows.';
      throw problem(400, 'VALIDATION_FAILED', message, {
        defaultWorkflowDefinitionId: [{ code: 'NOT_ELIGIBLE', message }],
      });
    }
    return eligible;
  }

  /** Recomputes the usability flags and bumps the row version, as the server does on every save. */
  private withFlags(row: TaskTypeView): TaskTypeView {
    const issues: string[] = [];
    if (!row.isActive) issues.push('INACTIVE');
    if (row.hasFormFields && row.publishedFormVersionId === undefined)
      issues.push('FORM_NOT_PUBLISHED');
    if (row.eligibleWorkflowIds.length === 0) issues.push('NO_ELIGIBLE_WORKFLOW');
    return {
      ...row,
      isUsable: issues.length === 0,
      usabilityIssues: issues,
      rowVersion: `rv${this.revision++}`,
    };
  }

  private run<T>(fn: () => T): Observable<T> {
    return defer(() => {
      try {
        return of(fn());
      } catch (e) {
        return throwError(() => e);
      }
    });
  }
}
