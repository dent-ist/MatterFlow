/** Types for the form rules contract (contracts/form-rules.md, v1). Pure TypeScript, no Angular. */

export type InputControl =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'CHECKBOX'
  | 'SELECT'
  | 'RADIO'
  | 'MULTISELECT'
  | 'DATE'
  | 'DATETIME'
  | 'URL'
  | 'ASSET_REF'
  | 'USER_REF';

export type FormControl = InputControl | 'SECTION_HEADING' | 'HELP_TEXT';

export type Scalar = string | number | boolean;

export type RuleNode =
  | { op: 'and' | 'or'; args: RuleNode[] }
  | { op: 'not'; arg: RuleNode }
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; field: string; value: Scalar }
  | { op: 'in' | 'notIn'; field: string; value: Scalar[] }
  | { op: 'isEmpty' | 'isNotEmpty' | 'isTrue' | 'isFalse'; field: string };

export interface FieldValidation {
  min?: number | string;
  max?: number | string;
  maxLength?: number;
  pattern?: string;
}

export interface FormOption {
  key: string;
  label?: string;
  availableWhen?: RuleNode;
}

export interface FormField {
  key: string;
  control: FormControl;
  label?: string;
  /** Help text shown beneath the control; for HELP_TEXT fields it is the displayed text. */
  helpText?: string;
  placeholder?: string;
  required?: boolean;
  section?: string;
  validation?: FieldValidation;
  showWhen?: RuleNode;
  requiredWhen?: RuleNode;
  options?: FormOption[];
}

export interface FormDefinition {
  fields: FormField[];
}

export type EvaluationMode = 'submit' | 'draft';

export type FormErrorCode =
  | 'REQUIRED'
  | 'INVALID_TYPE'
  | 'OUT_OF_RANGE'
  | 'TOO_LONG'
  | 'PATTERN'
  | 'OPTION_NOT_ALLOWED'
  | 'UNKNOWN_FIELD';

export type DefinitionErrorCode =
  | 'DUPLICATE_FIELD_KEY'
  | 'DUPLICATE_OPTION_KEY'
  | 'SCHEMA_VIOLATION'
  | 'RULE_TOO_DEEP'
  | 'UNKNOWN_FIELD_REFERENCE'
  | 'INVALID_REFERENCE_TARGET'
  | 'SELF_REFERENCE'
  | 'CIRCULAR_DEPENDENCY'
  | 'OPERATOR_TYPE_MISMATCH'
  | 'LITERAL_TYPE_MISMATCH'
  | 'UNKNOWN_OPTION_REFERENCE'
  | 'INVALID_SECTION';

export interface FormError {
  fieldKey: string;
  code: FormErrorCode;
}

export interface FormEvaluation {
  visible: Record<string, boolean>;
  required: Record<string, boolean>;
  options: Record<string, string[]>;
  errors: FormError[];
  /** Visible, non-empty, type-valid values only. Hidden values are never included. */
  normalized: Record<string, unknown>;
}
