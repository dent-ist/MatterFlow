import { HttpErrorResponse } from '@angular/common/http';
import type { DesignerField } from 'form-engine';
import {
  FormVersionDetail,
  FormVersionStatus as ApiStatus,
  FormOwnerKind,
} from '../../../api/generated/api-client';
import { ApiError } from '../../../core/http/api-error';
import { publishIssuesOf, toDesignerField, toFieldModel, toVersion } from './form-mapping';

describe('form mapping', () => {
  it('round-trips a designer field with options, rules and validation', () => {
    const field: DesignerField = {
      key: 'ocr_language',
      control: 'SELECT',
      label: 'OCR Language',
      helpText: 'Pick one',
      section: 'details',
      required: true,
      options: [
        { key: 'eng', label: 'English' },
        { key: 'spa', label: 'Spanish', availableWhen: { op: 'isTrue', field: 'requires_ocr' } },
      ],
      showWhen: { op: 'isTrue', field: 'requires_ocr' },
      requiredWhen: { op: 'isTrue', field: 'requires_ocr' },
      validation: { maxLength: 20 },
      defaultValue: 'eng',
    };
    expect(toDesignerField(toFieldModel(field))).toEqual(field);
  });

  it('drops null and absent members coming from the server', () => {
    const field = toDesignerField({
      key: 'notes',
      label: 'Notes',
      control: 'TEXTAREA',
      helpText: null,
      section: null,
      required: false,
      showWhen: null,
      options: null,
    } as never);
    expect(field).toEqual({ key: 'notes', control: 'TEXTAREA', label: 'Notes' });
  });

  it('stores a help text block under its text and gives it no label back', () => {
    const model = toFieldModel({ key: 'tip', control: 'HELP_TEXT', helpText: 'Mind privilege.' });
    expect(model.label).toBe('Mind privilege.');
    expect(toDesignerField(model)).toEqual({
      key: 'tip',
      control: 'HELP_TEXT',
      helpText: 'Mind privilege.',
    });
  });

  it('labels an unlabelled field with its key and caps long labels', () => {
    expect(toFieldModel({ key: 'x', control: 'TEXT' }).label).toBe('x');
    expect(toFieldModel({ key: 'x', control: 'TEXT', label: 'L'.repeat(300) }).label).toHaveLength(
      200,
    );
  });

  it('maps a version detail to the designer version', () => {
    const detail: FormVersionDetail = {
      version: {
        formVersionId: 12,
        formDefinitionId: 3,
        versionNo: 2,
        status: ApiStatus.Draft,
        clonedFromVersionId: 11,
        createdAtUtc: '2026-10-01T00:00:00Z',
        publishedAtUtc: undefined,
        publishedByUserId: undefined,
        notes: undefined,
        fieldCount: 1,
        rowVersion: 'AAAA',
      },
      ownerKind: FormOwnerKind.TaskType,
      ownerId: 5,
      fields: [{ key: 'a', label: 'A', control: 'TEXT' }],
    };
    expect(toVersion(detail)).toEqual({
      id: '12',
      versionNo: 2,
      status: 'DRAFT',
      note: undefined,
      updatedAtUtc: '2026-10-01T00:00:00Z',
      fieldCount: 1,
      rowVersion: 'AAAA',
      definition: { fields: [{ key: 'a', control: 'TEXT', label: 'A' }] },
    });
  });
});

describe('publishIssuesOf', () => {
  const problem = (code: string, errors: Record<string, { code: string; message: string }[]>) =>
    ApiError.from(new HttpErrorResponse({ status: 400, error: { code, detail: 'x', errors } }));

  it('maps form:<fieldKey> errors to field issues placed by code, and "form" to form-level issues', () => {
    const issues = publishIssuesOf(
      problem('PUBLISH_VALIDATION_FAILED', {
        'form:ocr_language': [{ code: 'NO_OPTIONS', message: 'Needs an option.' }],
        'form:b': [{ code: 'CIRCULAR_DEPENDENCY', message: 'Loop.' }],
        form: [{ code: 'TOO_MANY_FIELDS', message: 'Too many.' }],
      }),
    )!;
    expect(issues.map((i) => [i.fieldKey, i.slot, i.code, i.severity, i.message])).toEqual([
      ['ocr_language', 'options', 'NO_OPTIONS', 'error', 'Needs an option.'],
      ['b', 'showWhen', 'CIRCULAR_DEPENDENCY', 'error', 'Loop.'],
      [undefined, 'form', 'TOO_MANY_FIELDS', 'error', 'Too many.'],
    ]);
    expect(new Set(issues.map((i) => i.id)).size).toBe(3);
  });

  it('ignores other errors', () => {
    expect(publishIssuesOf(problem('CONCURRENCY_CONFLICT', {}))).toBeNull();
    expect(publishIssuesOf(new Error('boom'))).toBeNull();
  });
});
