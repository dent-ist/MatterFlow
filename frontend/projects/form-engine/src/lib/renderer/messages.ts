import { DefinitionErrorCode, FormErrorCode, FormField } from '../rules/types';

/**
 * Message wording for every form-rules error code. This table is a verbatim copy of `messages` in
 * contracts/form-rules.messages.json (docs/ux/ux-spec.md section 8.3 holds the same copy);
 * `messages.spec.ts` fails when the two differ. Keys are `CODE` or `CODE.variant`, with `{name}`
 * placeholders; the variant selection rules are in contracts/form-rules.md section 7.
 */
export const FORM_MESSAGES: Readonly<Record<string, string>> = {
  'REQUIRED.enter': 'Enter {label}.',
  'REQUIRED.select': 'Select {label}.',
  'INVALID_TYPE.default': 'Enter a valid {label}.',
  'INVALID_TYPE.URL': 'Enter a valid web address starting with http:// or https://.',
  'INVALID_TYPE.NUMBER': 'Enter a number.',
  'INVALID_TYPE.DATE': 'Enter a valid date.',
  'INVALID_TYPE.DATETIME': 'Enter a valid date and time.',
  'OUT_OF_RANGE.between': 'Enter a value from {min} to {max}.',
  'OUT_OF_RANGE.min': 'Enter a value of {min} or more.',
  'OUT_OF_RANGE.max': 'Enter a value of {max} or less.',
  'OUT_OF_RANGE.default': 'Enter a value within the allowed range.',
  TOO_LONG: 'Use at most {maxLength} characters.',
  'PATTERN.default': 'Enter {label} in the expected format.',
  OPTION_NOT_ALLOWED: 'Choose one of the available options.',
  UNKNOWN_FIELD: 'This field is not part of the form.',

  DUPLICATE_FIELD_KEY: 'Two fields share the key {field}. Give each field its own key.',
  INVALID_FIELD_KEY:
    'Use a key that starts with a lowercase letter and has only lowercase letters, digits and underscores (up to 64 characters).',
  UNKNOWN_CONTROL: "{field} uses a control type that isn't supported.",
  DUPLICATE_OPTION_KEY: 'Two options of {field} share a key. Give each option its own key.',
  INVALID_OPTION_KEY:
    'Use an option key that starts with a letter or digit and has only letters, digits, dots, hyphens and underscores (up to 64 characters).',
  NO_OPTIONS: 'Add at least one option.',
  INVALID_VALIDATION:
    "The limits on {field} aren't valid. Check the minimum, maximum, length and error message.",
  INVALID_PATTERN:
    "The format pattern on {field} can't be used. Use only the supported pattern syntax.",
  SCHEMA_VIOLATION: "A rule on {field} isn't valid. Check each condition.",
  RULE_TOO_DEEP: 'A rule on {field} has too many nested conditions. Use at most 3 levels.',
  UNKNOWN_FIELD_REFERENCE: "A rule on {field} refers to a field that doesn't exist.",
  INVALID_REFERENCE_TARGET:
    'A rule on {field} refers to a heading or help text. Rules can only refer to fields that hold a value.',
  SELF_REFERENCE: "{field} can't depend on itself.",
  CIRCULAR_DEPENDENCY: 'These fields depend on each other: {cycle}. Remove one rule.',
  OPERATOR_TYPE_MISMATCH: "A condition on {field} can't be used with that type of field.",
  LITERAL_TYPE_MISMATCH:
    "A value in a rule on {field} doesn't fit the type of the field it checks.",
  UNKNOWN_OPTION_REFERENCE: "A rule on {field} refers to an option that doesn't exist.",
  INVALID_SECTION: '{field} must belong to a section heading of this form.',
};

export function fieldLabel(field: FormField): string {
  return field.label?.trim() || field.key;
}

const SELECT_CONTROLS = new Set([
  'SELECT',
  'RADIO',
  'MULTISELECT',
  'CHECKBOX',
  'ASSET_REF',
  'USER_REF',
  'DATE',
  'DATETIME',
]);

function fill(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Message key (see FORM_MESSAGES) a field error resolves to, per contracts/form-rules.md section 7. */
export function validationMessageKey(field: FormField, code: FormErrorCode): string {
  switch (code) {
    case 'REQUIRED':
      return SELECT_CONTROLS.has(field.control) ? 'REQUIRED.select' : 'REQUIRED.enter';
    case 'INVALID_TYPE': {
      const specific = `INVALID_TYPE.${field.control}`;
      return specific in FORM_MESSAGES ? specific : 'INVALID_TYPE.default';
    }
    case 'OUT_OF_RANGE': {
      const hasMin = field.validation?.min != null;
      const hasMax = field.validation?.max != null;
      if (hasMin && hasMax) return 'OUT_OF_RANGE.between';
      if (hasMin) return 'OUT_OF_RANGE.min';
      return hasMax ? 'OUT_OF_RANGE.max' : 'OUT_OF_RANGE.default';
    }
    case 'PATTERN':
      return 'PATTERN.default';
    default:
      return code;
  }
}

/** User-facing text of a field error. A field's `validation.patternMessage` replaces the PATTERN wording. */
export function validationMessage(field: FormField, code: FormErrorCode): string {
  if (code === 'PATTERN' && field.validation?.patternMessage) {
    return field.validation.patternMessage;
  }
  const { min, max, maxLength } = field.validation ?? {};
  return fill(FORM_MESSAGES[validationMessageKey(field, code)], {
    label: fieldLabel(field),
    min: min ?? '',
    max: max ?? '',
    maxLength: maxLength ?? 0,
  });
}

/** User-facing text of a publish-time definition error. `field` is a field label or key; `cycle` the labels joined by " -> ". */
export function definitionMessage(
  code: DefinitionErrorCode,
  params: { field?: string; cycle?: string } = {},
): string {
  return fill(FORM_MESSAGES[code], { field: params.field ?? 'A field', cycle: params.cycle ?? '' });
}
