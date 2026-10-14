import type { FormControl, FormDefinition, FormField, FormOption } from 'form-engine';
import type { FormFieldModel, FormOptionModel } from '../../api/generated/api-client';

/** Server JSON `null` and `undefined` both mean "absent" (contracts/form-rules.md section 1). */
const present = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

function toOption(option: FormOptionModel): FormOption {
  return {
    key: option.key,
    label: option.label,
    availableWhen: present(option.availableWhen) as FormOption['availableWhen'],
  };
}

/** One server field in the shape the renderer and the rules evaluator use. */
export function toRuntimeField(field: FormFieldModel): FormField {
  const out: FormField = {
    key: field.key,
    control: field.control as FormControl,
    label: field.label,
  };
  if (field.helpText) out.helpText = field.helpText;
  if (field.required) out.required = true;
  if (field.section) out.section = field.section;
  if (present(field.validation)) out.validation = field.validation as FormField['validation'];
  if (present(field.showWhen)) out.showWhen = field.showWhen as FormField['showWhen'];
  if (present(field.requiredWhen))
    out.requiredWhen = field.requiredWhen as FormField['requiredWhen'];
  if (field.options?.length) out.options = field.options.map(toOption);
  return out;
}

/** The fields of a form version (published or stored) as a renderer definition. */
export function toFormDefinition(version: { fields: readonly FormFieldModel[] }): FormDefinition {
  return { fields: version.fields.map(toRuntimeField) };
}
