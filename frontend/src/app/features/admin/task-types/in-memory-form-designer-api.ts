import { Injectable } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { DesignerDefinition, diagnoseDefinition, hasErrors } from 'form-engine';

import { FormDesignerApi, FormOwner, FormVersion, FormVersionSummary } from './form-designer-api';

const clone = <T>(v: T): T => structuredClone(v);

/** The baseline 8.3 example, used as the seeded published version. */
const SEED: DesignerDefinition = {
  fields: [
    { key: 'requires_ocr', control: 'CHECKBOX', label: 'Requires OCR?' },
    {
      key: 'ocr_language',
      control: 'SELECT',
      label: 'OCR Language',
      options: [
        { key: 'eng', label: 'English' },
        { key: 'spa', label: 'Spanish' },
      ],
      showWhen: { op: 'isTrue', field: 'requires_ocr' },
      requiredWhen: { op: 'isTrue', field: 'requires_ocr' },
    },
    { key: 'contains_encrypted_files', control: 'CHECKBOX', label: 'Contains Encrypted Files?' },
    {
      key: 'password_instructions',
      control: 'TEXT',
      label: 'Password Instructions',
      showWhen: { op: 'isTrue', field: 'contains_encrypted_files' },
      requiredWhen: { op: 'isTrue', field: 'contains_encrypted_files' },
    },
  ],
};

/** Stand-in for the persistence API: keeps versions per owner in memory. */
@Injectable()
export class InMemoryFormDesignerApi extends FormDesignerApi {
  private readonly owners = new Map<string, FormOwner>([
    ['data-processing', { id: 'data-processing', name: 'Data Processing' }],
    // The stub Task Types list (InMemoryTaskTypesApi) numbers Data Processing 1.
    ['1', { id: '1', name: 'Data Processing' }],
  ]);
  private readonly versions = new Map<string, FormVersion[]>([
    ['data-processing', [this.seedVersion()]],
    ['1', [this.seedVersion()]],
  ]);
  private nextId = 2;

  private seedVersion(): FormVersion {
    return {
      id: 'v1',
      versionNo: 1,
      status: 'PUBLISHED',
      updatedAtUtc: '2026-10-01T09:00:00Z',
      definition: clone(SEED),
    };
  }

  private list(ownerId: string): FormVersion[] {
    const list = this.versions.get(ownerId);
    if (!list) throw new Error('Task type not found.');
    return list;
  }

  private find(ownerId: string, versionId: string): FormVersion {
    const v = this.list(ownerId).find((x) => x.id === versionId);
    if (!v) throw new Error('Form version not found.');
    return v;
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

  getOwner(ownerId: string): Observable<FormOwner> {
    return this.run(() => {
      const o = this.owners.get(ownerId);
      if (!o) throw new Error('Task type not found.');
      return clone(o);
    });
  }

  listVersions(ownerId: string): Observable<FormVersionSummary[]> {
    return this.run(() =>
      this.list(ownerId)
        .map((v) => ({
          id: v.id,
          versionNo: v.versionNo,
          status: v.status,
          note: v.note,
          updatedAtUtc: v.updatedAtUtc,
          fieldCount: v.definition.fields.length,
          ...(v.status === 'PUBLISHED' ? { publishedAtUtc: v.updatedAtUtc } : {}),
        }))
        .sort((a, b) => b.versionNo - a.versionNo),
    );
  }

  getVersion(ownerId: string, versionId: string): Observable<FormVersion> {
    return this.run(() => clone(this.find(ownerId, versionId)));
  }

  createDraft(ownerId: string): Observable<FormVersion> {
    return this.run(() => {
      const list = this.list(ownerId);
      const existing = list.find((v) => v.status === 'DRAFT');
      if (existing) return clone(existing);
      const base =
        list.find((v) => v.status === 'PUBLISHED') ??
        [...list].sort((a, b) => b.versionNo - a.versionNo)[0];
      const draft: FormVersion = {
        id: `v${this.nextId++}`,
        versionNo: Math.max(0, ...list.map((v) => v.versionNo)) + 1,
        status: 'DRAFT',
        updatedAtUtc: new Date().toISOString(),
        definition: clone(base?.definition ?? { fields: [] }),
      };
      list.push(draft);
      return clone(draft);
    });
  }

  saveDraft(
    ownerId: string,
    versionId: string,
    definition: DesignerDefinition,
  ): Observable<FormVersion> {
    return this.run(() => {
      const v = this.find(ownerId, versionId);
      if (v.status !== 'DRAFT') throw new Error("Published versions can't be edited.");
      v.definition = clone(definition);
      v.updatedAtUtc = new Date().toISOString();
      return clone(v);
    });
  }

  publish(ownerId: string, versionId: string, note?: string): Observable<FormVersion> {
    return this.run(() => {
      const v = this.find(ownerId, versionId);
      if (v.status !== 'DRAFT') throw new Error('Only a draft can be published.');
      if (hasErrors(diagnoseDefinition(v.definition.fields))) {
        throw new Error('The form has errors. Fix them before publishing.');
      }
      for (const other of this.list(ownerId)) {
        if (other.status === 'PUBLISHED') other.status = 'RETIRED';
      }
      v.status = 'PUBLISHED';
      v.note = note?.trim() || undefined;
      v.updatedAtUtc = new Date().toISOString();
      return clone(v);
    });
  }

  retire(ownerId: string, versionId: string): Observable<FormVersion> {
    return this.run(() => {
      const v = this.find(ownerId, versionId);
      if (v.status !== 'PUBLISHED') throw new Error('Only a published version can be retired.');
      v.status = 'RETIRED';
      v.updatedAtUtc = new Date().toISOString();
      return clone(v);
    });
  }
}
