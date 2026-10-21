import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import {
  AssetLinkRoleView,
  CreateAssetLinkRoleRequest,
  CreatePriorityRequest,
  PriorityView,
  ReorderRequest,
  StatusLabelView,
  UpdateAssetLinkRoleRequest,
  UpdatePriorityRequest,
  UpdateStatusLabelRequest,
} from '../../api/generated/api-client';
import { ApiError } from '../http/api-error';

/** A failed API call as the HTTP interceptor would surface it. */
export function apiError(
  status: number,
  code: string,
  detail: string,
  errors?: Record<string, { code: string; message: string }[]>,
): ApiError {
  return ApiError.from(new HttpErrorResponse({ status, error: { code, detail, errors } }));
}

export function priority(
  id: number,
  label: string,
  overrides: Partial<PriorityView> = {},
): PriorityView {
  return {
    id,
    label,
    sortOrder: id,
    color: 'normal',
    isActive: true,
    isDefault: false,
    rowVersion: `v${id}`,
    ...overrides,
  };
}

export const SEEDED_PRIORITIES = (): PriorityView[] => [
  priority(1, 'Critical', { color: 'critical' }),
  priority(2, 'High', { color: 'high' }),
  priority(3, 'Normal', { color: 'normal', isDefault: true }),
  priority(4, 'Low', { color: 'low' }),
];

export const SEEDED_STATUS_LABELS = (): StatusLabelView[] => [
  { code: 'NEW', displayLabel: 'New', sortOrder: 1, rowVersion: 's1' },
  { code: 'IN_PROGRESS', displayLabel: 'In Progress', sortOrder: 2, rowVersion: 's2' },
  { code: 'ON_HOLD', displayLabel: 'On Hold', sortOrder: 3, rowVersion: 's3' },
  { code: 'COMPLETED', displayLabel: 'Completed', sortOrder: 4, rowVersion: 's4' },
  { code: 'CANCELLED', displayLabel: 'Cancelled', sortOrder: 5, rowVersion: 's5' },
];

export const SEEDED_LINK_ROLES = (): AssetLinkRoleView[] =>
  ['Source', 'Destination', 'Subject', 'Result'].map((name, i) => ({
    id: i + 1,
    name,
    sortOrder: i + 1,
    isActive: true,
    rowVersion: `r${i + 1}`,
  }));

let version = 100;
const nextVersion = () => `v${++version}`;

/** In-memory stand-in for PrioritiesClient that mimics the server rules. Set `failNext` to make the next call fail. */
export class FakePrioritiesClient {
  rows: PriorityView[] = SEEDED_PRIORITIES();
  calls: string[] = [];
  failNext: ApiError | null = null;

  private guard<T>(name: string, run: () => T): Observable<T> {
    this.calls.push(name);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return throwError(() => error);
    }
    return of(run());
  }

  listPriorities(): Observable<PriorityView[]> {
    return this.guard('list', () => [...this.rows]);
  }

  createPriority(body: CreatePriorityRequest): Observable<PriorityView> {
    return this.guard('create', () => {
      const created = priority(this.rows.length + 10, body.label, {
        color: body.color,
        sortOrder: this.rows.length + 1,
        isActive: body.isActive ?? true,
      });
      this.rows = [...this.rows, created];
      return created;
    });
  }

  updatePriority(id: number, body: UpdatePriorityRequest): Observable<PriorityView> {
    return this.guard(`update:${id}`, () => {
      const updated = {
        ...this.rows.find((r) => r.id === id)!,
        ...body,
        rowVersion: nextVersion(),
      };
      this.rows = this.rows.map((r) => (r.id === id ? updated : r));
      return updated;
    });
  }

  deletePriority(id: number): Observable<void> {
    return this.guard(`delete:${id}`, () => {
      this.rows = this.rows.filter((r) => r.id !== id);
    });
  }

  setDefaultPriority(id: number): Observable<PriorityView[]> {
    return this.guard(`default:${id}`, () => {
      this.rows = this.rows.map((r) => ({
        ...r,
        isDefault: r.id === id,
        rowVersion: nextVersion(),
      }));
      return [...this.rows];
    });
  }

  reorderPriorities(body: ReorderRequest): Observable<PriorityView[]> {
    return this.guard(`reorder:${body.ids.join(',')}`, () => {
      this.rows = body.ids.map((id, i) => ({
        ...this.rows.find((r) => r.id === id)!,
        sortOrder: i + 1,
      }));
      return [...this.rows];
    });
  }
}

export class FakeStatusLabelsClient {
  rows: StatusLabelView[] = SEEDED_STATUS_LABELS();
  calls: string[] = [];
  failNext: ApiError | null = null;

  listStatusLabels(): Observable<StatusLabelView[]> {
    this.calls.push('list');
    return of([...this.rows]);
  }

  updateStatusLabel(code: string, body: UpdateStatusLabelRequest): Observable<StatusLabelView> {
    this.calls.push(`update:${code}:${body.displayLabel}`);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return throwError(() => error);
    }
    const updated = {
      ...this.rows.find((r) => r.code === code)!,
      displayLabel: body.displayLabel,
      rowVersion: nextVersion(),
    };
    this.rows = this.rows.map((r) => (r.code === code ? updated : r));
    return of(updated);
  }
}

export class FakeAssetLinkRolesClient {
  rows: AssetLinkRoleView[] = SEEDED_LINK_ROLES();
  calls: string[] = [];
  failNext: ApiError | null = null;

  private guard<T>(name: string, run: () => T): Observable<T> {
    this.calls.push(name);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      return throwError(() => error);
    }
    return of(run());
  }

  listAssetLinkRoles(): Observable<AssetLinkRoleView[]> {
    return this.guard('list', () => [...this.rows]);
  }

  createAssetLinkRole(body: CreateAssetLinkRoleRequest): Observable<AssetLinkRoleView> {
    return this.guard('create', () => {
      const created = {
        id: this.rows.length + 10,
        name: body.name,
        sortOrder: this.rows.length + 1,
        isActive: body.isActive ?? true,
        rowVersion: nextVersion(),
        linkCount: 0,
      };
      this.rows = [...this.rows, created];
      return created;
    });
  }

  updateAssetLinkRole(id: number, body: UpdateAssetLinkRoleRequest): Observable<AssetLinkRoleView> {
    return this.guard(`update:${id}`, () => {
      const updated = {
        ...this.rows.find((r) => r.id === id)!,
        ...body,
        rowVersion: nextVersion(),
      };
      this.rows = this.rows.map((r) => (r.id === id ? updated : r));
      return updated;
    });
  }

  deleteAssetLinkRole(id: number): Observable<void> {
    return this.guard(`delete:${id}`, () => {
      this.rows = this.rows.filter((r) => r.id !== id);
    });
  }

  reorderAssetLinkRoles(body: ReorderRequest): Observable<AssetLinkRoleView[]> {
    return this.guard(`reorder:${body.ids.join(',')}`, () => {
      this.rows = body.ids.map((id, i) => ({
        ...this.rows.find((r) => r.id === id)!,
        sortOrder: i + 1,
      }));
      return [...this.rows];
    });
  }
}
