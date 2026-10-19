import type {
  DesignerDefinition,
  DesignerField,
  DesignerIssue,
  FormControl,
  FormField,
  FormOption,
  IssueSlot,
  RuleNode,
} from 'form-engine';
import { ApiError } from '../../../core/http/api-error';
import {
  FormFieldModel,
  FormOptionModel,
  FormVersionDetail,
  FormVersionStatus as ApiVersionStatus,
  FormVersionSummary as ApiVersionSummary,
  JsonElement,
} from '../../../api/generated/api-client';
import { FormVersion, FormVersionStatus, FormVersionSummary } from './form-designer-api';

const asJson = (value: unknown): JsonElement => value as JsonElement;

const present = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

/** Server field -> designer field. Absent and `null` members are dropped, as the designer expects. */
export function toDesignerField(f: FormFieldModel): DesignerField {
  const field: DesignerField = { key: f.key, control: f.control as FormControl };
  // A help-text block has no label in the designer; the server stores the text as its label too.
  if (f.control !== 'HELP_TEXT' && present(f.label)) field.label = f.label;
  if (present(f.helpText)) field.helpText = f.helpText;
  if (present(f.section)) field.section = f.section;
  if (f.required) field.required = true;
  if (present(f.validation)) field.validation = f.validation as FormField['validation'];
  if (present(f.showWhen)) field.showWhen = f.showWhen as unknown as RuleNode;
  if (present(f.requiredWhen)) field.requiredWhen = f.requiredWhen as unknown as RuleNode;
  if (present(f.defaultValue)) field.defaultValue = f.defaultValue as unknown as string;
  if (f.options?.length) {
    field.options = f.options.map((o): FormOption => {
      const option: FormOption = { key: o.key, label: o.label };
      if (present(o.availableWhen)) option.availableWhen = o.availableWhen as unknown as RuleNode;
      return option;
    });
  }
  return field;
}

/** Designer field -> server field. The server needs a label on every field, so a help text uses its text. */
export function toFieldModel(f: DesignerField): FormFieldModel {
  const label = (f.label?.trim() || f.helpText?.trim() || f.key).slice(0, 200);
  const model: FormFieldModel = { key: f.key, label, control: f.control };
  if (f.helpText) model.helpText = f.helpText;
  if (f.section) model.section = f.section;
  model.required = !!f.required;
  if (f.validation) model.validation = asJson(f.validation);
  if (f.showWhen) model.showWhen = asJson(f.showWhen);
  if (f.requiredWhen) model.requiredWhen = asJson(f.requiredWhen);
  if (f.defaultValue !== undefined) model.defaultValue = asJson(f.defaultValue);
  if (f.options?.length) {
    model.options = f.options.map((o): FormOptionModel => {
      const option: FormOptionModel = { key: o.key, label: o.label ?? o.key };
      if (o.availableWhen) option.availableWhen = asJson(o.availableWhen);
      return option;
    });
  }
  return model;
}

const STATUS: Record<ApiVersionStatus, FormVersionStatus> = {
  [ApiVersionStatus.Draft]: 'DRAFT',
  [ApiVersionStatus.Published]: 'PUBLISHED',
  [ApiVersionStatus.Retired]: 'RETIRED',
};

export function toSummary(v: ApiVersionSummary): FormVersionSummary {
  return {
    id: String(v.formVersionId),
    versionNo: v.versionNo,
    status: STATUS[v.status],
    note: v.notes ?? undefined,
    updatedAtUtc: v.publishedAtUtc ?? v.createdAtUtc,
    fieldCount: v.fieldCount,
    publishedAtUtc: v.publishedAtUtc ?? undefined,
    rowVersion: v.rowVersion,
  };
}

export function toVersion(detail: FormVersionDetail): FormVersion {
  return {
    ...toSummary(detail.version),
    definition: { fields: detail.fields.map(toDesignerField) },
  };
}

export function toFieldModels(definition: DesignerDefinition): FormFieldModel[] {
  return definition.fields.map(toFieldModel);
}

// ---------------------------------------------------------------- publish validation errors

const FORM_PREFIX = 'form:';

/** Where an issue of a given definition code is shown next to the selected field. */
function slotOf(code: string): IssueSlot {
  switch (code) {
    case 'DUPLICATE_FIELD_KEY':
    case 'INVALID_FIELD_KEY':
    case 'INVALID_KEY':
    case 'IMMUTABLE_FIELD':
    case 'FIELD_TYPE_CHANGED':
      return 'key';
    case 'LABEL_REQUIRED':
    case 'INVALID_LABEL':
    case 'MISSING_LABEL':
      return 'label';
    case 'NO_OPTIONS':
    case 'EMPTY_OPTIONS':
    case 'TOO_MANY_OPTIONS':
    case 'DUPLICATE_OPTION_KEY':
    case 'INVALID_OPTION_KEY':
      return 'options';
    case 'INVALID_VALIDATION':
    case 'INVALID_PATTERN':
    case 'INVALID_RANGE':
      return 'validation';
    case 'INVALID_SECTION':
      return 'section';
    case 'INVALID_DEFAULT':
      return 'default';
    case 'SCHEMA_VIOLATION':
    case 'RULE_TOO_DEEP':
    case 'UNKNOWN_FIELD_REFERENCE':
    case 'INVALID_REFERENCE_TARGET':
    case 'SELF_REFERENCE':
    case 'CIRCULAR_DEPENDENCY':
    case 'OPERATOR_TYPE_MISMATCH':
    case 'LITERAL_TYPE_MISMATCH':
    case 'UNKNOWN_OPTION_REFERENCE':
      return 'showWhen';
    default:
      return 'form';
  }
}

/**
 * Turns a `PUBLISH_VALIDATION_FAILED` problem (errors keyed `form:<fieldKey>`, or `form` for the whole form) into designer issues
 * so the designer shows them inline next to the field and in its Validation list. Returns null for any other error.
 */
export function publishIssuesOf(error: unknown): DesignerIssue[] | null {
  if (!(error instanceof ApiError) || error.code !== 'PUBLISH_VALIDATION_FAILED') return null;
  const issues: DesignerIssue[] = [];
  for (const [key, list] of Object.entries(error.problem?.errors ?? {})) {
    const fieldKey = key.startsWith(FORM_PREFIX) ? key.slice(FORM_PREFIX.length) : undefined;
    for (const [i, e] of list.entries()) {
      issues.push({
        id: `server:${key}:${e.code}:${i}`,
        code: e.code as DesignerIssue['code'],
        severity: 'error',
        fieldKey: fieldKey || undefined,
        slot: fieldKey ? slotOf(e.code) : 'form',
        message: e.message,
      });
    }
  }
  return issues;
}
