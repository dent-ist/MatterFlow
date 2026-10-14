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
}

export interface FormVersion extends FormVersionSummary {
  definition: DesignerDefinition;
}

export interface FormOwner {
  id: string;
  name: string;
}

/**
 * Persistence for form definition versions (architecture 7.2). The backend API does not exist yet;
 * the admin route provides `InMemoryFormDesignerApi`. Swap the provider for a client generated
 * from contracts/openapi when the endpoints land; nothing else changes.
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
  ): Observable<FormVersion>;
  abstract publish(ownerId: string, versionId: string, note?: string): Observable<FormVersion>;
  abstract retire(ownerId: string, versionId: string): Observable<FormVersion>;
}
