import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

/** A workflow definition a Task Type can be made eligible for (UX S14 "Workflows" picker). */
export interface WorkflowOption {
  id: number;
  name: string;
  /** Version number of the current PUBLISHED version; absent while the workflow has none. */
  publishedVersionNo?: number;
}

/**
 * Read access to workflow definitions for pickers. The workflow module's endpoints do not exist yet, so the admin routes provide
 * `StubWorkflowLookup`; replace the provider with one backed by the generated client when workflows land.
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
    { id: 4, name: 'Production (not published yet)' },
  ];

  list(): Observable<WorkflowOption[]> {
    return of(StubWorkflowLookup.OPTIONS.map((o) => ({ ...o })));
  }
}
