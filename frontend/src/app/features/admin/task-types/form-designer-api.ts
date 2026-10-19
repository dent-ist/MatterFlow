import { Observable } from 'rxjs';
import type { DesignerDefinition } from 'form-engine';

export type FormVersionStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface FormVersionSummary {
  id: string;
  versionNo: number;
  status: FormVersionStatus;
  /** Optional note given at publish time. */
  note?: string;
  updatedAtUtc: string;
  /** Number of fields in the version (real API; the Request form tab of the Task Type page says "4 fields"). */
  fieldCount?: number;
  /** When the version was published; absent for a draft. */
  publishedAtUtc?: string;
  /** Concurrency token of the version (real API only); send it back when saving or publishing a draft. */
  rowVersion?: string;
}

export interface FormVersion extends FormVersionSummary {
  definition: DesignerDefinition;
}

export interface FormOwner {
  id: string;
  name: string;
}

/**
 * Persistence for form definition versions (architecture 7.2). The admin routes provide
 * `HttpFormDesignerApi` (the generated client over `/api/v1/forms`) and, with the stub auth provider
 * or in unit tests, `InMemoryFormDesignerApi`.
 *
 * Rules the server enforces (and the stub mimics): at most one DRAFT per owner; only a DRAFT can
 * be saved; publish re-validates and retires the previous PUBLISHED version atomically; published
 * and retired versions are immutable.
 */
export abstract class FormDesignerApi {
  abstract getOwner(ownerId: string): Observable<FormOwner>;
  abstract listVersions(ownerId: string): Observable<FormVersionSummary[]>;
  abstract getVersion(ownerId: string, versionId: string): Observable<FormVersion>;
  /** Clones the published (else latest) version into a new DRAFT; returns the existing DRAFT if there is one. */
  abstract createDraft(ownerId: string): Observable<FormVersion>;
  abstract saveDraft(
    ownerId: string,
    versionId: string,
    definition: DesignerDefinition,
    rowVersion?: string,
  ): Observable<FormVersion>;
  /**
   * Publishes a saved draft. A server-side definition check failure surfaces as an `ApiError` with
   * code `PUBLISH_VALIDATION_FAILED` and errors keyed `form:<fieldKey>`; a stale `rowVersion` as
   * `CONCURRENCY_CONFLICT`.
   */
  abstract publish(
    ownerId: string,
    versionId: string,
    note?: string,
    rowVersion?: string,
  ): Observable<FormVersion>;
  abstract retire(ownerId: string, versionId: string): Observable<FormVersion>;
}
