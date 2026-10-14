import { FormErrorCode, FormField } from '../rules/types';

/**
 * Validation messages from the UX copy deck (docs/ux/ux-spec.md section 8.3). Codes without a
 * copy-deck entry use messages written in the same tone; see docs/contract-issues-ts.md.
 */
export function fieldLabel(field: FormField): string {
  return field.label?.trim() || field.key;
}

const CHOICE_CONTROLS = new Set([
  'SELECT',
  'RADIO',
  'MULTISELECT',
  'CHECKBOX',
  'ASSET_REF',
  'USER_REF',
  'DATE',
  'DATETIME',
]);

export function validationMessage(field: FormField, code: FormErrorCode): string {
  const label = fieldLabel(field);
  switch (code) {
    case 'REQUIRED':
      // Copy deck "Required generic": "Enter <field>." / "Select <field>."
      return CHOICE_CONTROLS.has(field.control) ? `Select ${label}.` : `Enter ${label}.`;
    case 'INVALID_TYPE':
      switch (field.control) {
        case 'URL':
          return 'Enter a valid web address starting with http:// or https://.';
        case 'NUMBER':
          return 'Enter a number.';
        case 'DATE':
          return 'Enter a valid date.';
        case 'DATETIME':
          return 'Enter a valid date and time.';
        default:
          return `Enter a valid ${label}.`;
      }
    case 'OUT_OF_RANGE': {
      const { min, max } = field.validation ?? {};
      if (min !== undefined && max !== undefined) return `Enter a value from ${min} to ${max}.`;
      if (min !== undefined) return `Enter a value of ${min} or more.`;
      if (max !== undefined) return `Enter a value of ${max} or less.`;
      return 'Enter a value within the allowed range.';
    }
    case 'TOO_LONG':
      return `Use at most ${field.validation?.maxLength ?? 0} characters.`;
    case 'PATTERN':
      return `Enter ${label} in the expected format.`;
    case 'OPTION_NOT_ALLOWED':
      return 'Choose one of the available options.';
    case 'UNKNOWN_FIELD':
      return 'This field is not part of the form.';
  }
}
