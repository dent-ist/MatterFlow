import { HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { FormVersionStatus } from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import {
  TASK_TYPE_TARGET_DAYS_MAX,
  TASK_TYPE_TARGET_DAYS_MIN,
  isTaskTypeColour,
} from '../../../shared/task-type/task-type-colours';
import {
  CreateTaskTypeRequest,
  PreviewTaskTypeAccessRequest,
  ReplaceTaskTypeAccessRequest,
  TaskTypeAccessLists,
  TaskTypeAccessPreview,
  AccessRoleChoice,
  TaskTypeAccessRole,
  TaskTypeAccessView,
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
  /** The roles of the stub (id, name, active, members). */
  readonly roles: readonly (TaskTypeAccessRole & { members: number })[] = [
    { roleId: 1, name: 'Attorney', isActive: true, members: 20 },
    { roleId: 2, name: 'eDiscovery Analyst', isActive: true, members: 14 },
    { roleId: 3, name: 'Paralegal', isActive: true, members: 12 },
    { roleId: 4, name: 'Partner', isActive: true, members: 6 },
    { roleId: 5, name: 'Project Manager', isActive: true, members: 9 },
    { roleId: 6, name: 'Vendor Liaison', isActive: false, members: 1 },
  ];
  /** Whether the stub server enforces the rules (`Features:TaskTypeAccess`); off by default like the real one. */
  enforced = false;
  /** The roles of the signed-in person, for `callerLosesView`. */
  callerRoleIds: number[] = [1];
  /** Set to make the next preview or save fail (tests): the error is thrown once. */
  failNext: { preview?: ApiError; replace?: ApiError; get?: ApiError } = {};
  private readonly access = new Map<number, TaskTypeAccessLists>();
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
        .map((r) => this.view(r)),
    );
  }

  get(id: number): Observable<TaskTypeView> {
    return this.run(() => this.view(this.find(id)));
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
        colourKey: this.checkColour(request.colourKey),
        targetDays: this.checkTargetDays(request.targetDays),
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
      return this.view(row);
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
        colourKey: this.checkColour(request.colourKey),
        targetDays: this.checkTargetDays(request.targetDays),
        isActive: request.isActive,
        defaultWorkflowDefinitionId: request.defaultWorkflowDefinitionId,
        eligibleWorkflowIds: eligible,
      });
      this.rows = this.rows.map((r) => (r.id === id ? next : r));
      return this.view(next);
    });
  }

  getAccess(id: number): Observable<TaskTypeAccessView> {
    return this.run(() => {
      const failure = this.failNext.get;
      this.failNext.get = undefined;
      if (failure) throw failure;
      return this.accessView(this.find(id));
    });
  }

  replaceAccess(id: number, request: ReplaceTaskTypeAccessRequest): Observable<TaskTypeAccessView> {
    return this.run(() => {
      const failure = this.failNext.replace;
      this.failNext.replace = undefined;
      if (failure) throw failure;
      const current = this.find(id);
      if (request.rowVersion !== current.rowVersion) {
        throw problem(
          409,
          'CONCURRENCY_CONFLICT',
          'Someone else changed this item. Reload and try again.',
        );
      }
      const old = this.listsOf(id);
      for (const field of ['canView', 'canEdit', 'canAssign'] as const) {
        const ids = request[field];
        const bad = ids.find(
          (r) =>
            !this.roles.some((x) => x.roleId === r) ||
            (!old[field].includes(r) && this.roles.find((x) => x.roleId === r)?.isActive === false),
        );
        if (bad !== undefined) {
          const message = 'One of the roles does not exist or is inactive.';
          throw problem(400, 'VALIDATION_FAILED', message, {
            [field]: [{ code: 'ROLE_NOT_FOUND', message }],
          });
        }
      }
      const view = [
        ...new Set([...request.canView, ...request.canEdit, ...request.canAssign]),
      ].sort((a, b) => a - b);
      this.access.set(id, {
        isRestricted: view.length > 0,
        canView: view,
        canEdit: [...request.canEdit],
        canAssign: [...request.canAssign],
      });
      // The access is part of the type row: the row version moves, as on the server.
      const next = this.withFlags(current);
      this.rows = this.rows.map((r) => (r.id === id ? next : r));
      return this.accessView(next);
    });
  }

  previewAccess(
    id: number,
    request: PreviewTaskTypeAccessRequest,
  ): Observable<TaskTypeAccessPreview> {
    return this.run(() => {
      const failure = this.failNext.preview;
      this.failNext.preview = undefined;
      if (failure) throw failure;
      const row = this.find(id);
      const old = this.listsOf(id);
      const view = new Set([...request.canView, ...request.canEdit, ...request.canAssign]);
      const people = (ids: number[]): number =>
        ids.reduce((n, r) => n + (this.roles.find((x) => x.roleId === r)?.members ?? 0), 0);
      const lostView = old.canView.filter((r) => !view.has(r));
      const edit = new Set(request.canEdit);
      const lostEdit = old.canEdit.filter((r) => !edit.has(r));
      const open = view.size === 0;
      const loses = !open && !this.callerRoleIds.some((r) => view.has(r));
      return {
        isRestricted: !open,
        becomesOpenToEveryone: open && old.isRestricted,
        openTasksBecomingHidden: open ? 0 : people(lostView) > 0 ? (row.openTaskCount ?? 14) : 0,
        peopleLosingView: open ? 0 : people(lostView),
        openTasksAssignedToPeopleLosingView: open ? 0 : people(lostView) > 0 ? 3 : 0,
        peopleLosingEdit: people(lostEdit),
        callerLosesView: loses,
      };
    });
  }

  accessRoles(): Observable<AccessRoleChoice[]> {
    return this.run(() =>
      this.roles.map(({ roleId, name, isActive, members }) => ({
        roleId,
        name,
        isActive,
        memberCount: members,
      })),
    );
  }

  /** Puts lists in place without the server checks (a test or a story that needs a role that is inactive now). */
  setAccess(
    id: number,
    lists: { canView: number[]; canEdit?: number[]; canAssign?: number[] },
  ): void {
    const view = [
      ...new Set([...lists.canView, ...(lists.canEdit ?? []), ...(lists.canAssign ?? [])]),
    ];
    this.access.set(id, {
      isRestricted: view.length > 0,
      canView: view,
      canEdit: lists.canEdit ?? [],
      canAssign: lists.canAssign ?? [],
    });
  }

  private listsOf(id: number): TaskTypeAccessLists {
    return this.access.get(id) ?? { isRestricted: false, canView: [], canEdit: [], canAssign: [] };
  }

  private view(row: TaskTypeView): TaskTypeView {
    return structuredClone({ ...row, access: this.listsOf(row.id) });
  }

  private accessView(row: TaskTypeView): TaskTypeAccessView {
    const lists = this.listsOf(row.id);
    return structuredClone({
      taskTypeId: row.id,
      ...lists,
      roles: this.roles.map(({ roleId, name, isActive }) => ({ roleId, name, isActive })),
      enforced: this.enforced,
      rowVersion: row.rowVersion,
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

  private checkColour(key: string | undefined): string | undefined {
    if (!key?.trim()) return undefined;
    if (!isTaskTypeColour(key)) {
      const message = 'Choose a color from the palette.';
      throw problem(400, 'VALIDATION_FAILED', message, {
        colourKey: [{ code: 'UNKNOWN_COLOUR', message }],
      });
    }
    return key;
  }

  private checkTargetDays(days: number | undefined): number | undefined {
    if (days === undefined || days === null) return undefined;
    if (
      !Number.isInteger(days) ||
      days < TASK_TYPE_TARGET_DAYS_MIN ||
      days > TASK_TYPE_TARGET_DAYS_MAX
    ) {
      const message = `Enter a whole number of days from ${TASK_TYPE_TARGET_DAYS_MIN} to ${TASK_TYPE_TARGET_DAYS_MAX}, or leave it empty.`;
      throw problem(400, 'VALIDATION_FAILED', message, {
        targetDays: [{ code: 'INVALID_TARGET_DAYS', message }],
      });
    }
    return days;
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
