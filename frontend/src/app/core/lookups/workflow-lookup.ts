import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, from, of } from 'rxjs';
import { WorkflowsClient } from '../../api/generated/api-client';

/** A workflow definition a Task Type can be made eligible for (UX S14 "Workflows" picker). */
export interface WorkflowOption {
  id: number;
  name: string;
  /** Version number of the current PUBLISHED version; absent while the workflow has none. */
  publishedVersionNo?: number;
  /** False for a deactivated workflow (still resolvable by id so saved eligibility keeps its name). */
  isActive?: boolean;
}

/**
 * Read access to workflow definitions for pickers. The admin routes provide `HttpWorkflowLookup` (generated client); the stub auth
 * provider and unit tests use `StubWorkflowLookup`.
 */
export abstract class WorkflowLookup {
  abstract list(): Observable<WorkflowOption[]>;
}

/** Fixed stand-in list (stable ids, so eligibility chosen against it stays meaningful). */
@Injectable()
export class StubWorkflowLookup extends WorkflowLookup {
  private static readonly OPTIONS: readonly WorkflowOption[] = [
    { id: 1, name: 'Standard Processing', publishedVersionNo: 2 },
    { id: 2, name: 'Expedited Processing', publishedVersionNo: 1 },
    { id: 3, name: 'Collection and Review', publishedVersionNo: 3 },
    { id: 4, name: 'Production' },
  ];

  list(): Observable<WorkflowOption[]> {
    return of(StubWorkflowLookup.OPTIONS.map((o) => ({ ...o })));
  }
}

/** Real lookup over `/api/v1/workflows` (all pages, active and inactive, each with its latest published version number). */
@Injectable()
export class HttpWorkflowLookup extends WorkflowLookup {
  private readonly client = inject(WorkflowsClient);

  list(): Observable<WorkflowOption[]> {
    return from(this.loadAll());
  }

  private async loadAll(): Promise<WorkflowOption[]> {
    const options: WorkflowOption[] = [];
    for (let page = 1; ; page++) {
      const result = await firstValueFrom(
        this.client.listWorkflows(
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          page,
          100,
        ),
      );
      for (const w of result.items) {
        options.push({
          id: w.workflowDefinitionId,
          name: w.name,
          publishedVersionNo: w.publishedVersionNo,
          isActive: w.isActive,
        });
      }
      if (result.items.length === 0 || page * result.pageSize >= result.total) break;
    }
    return options;
  }
}
