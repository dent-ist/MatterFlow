import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Type,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';
import { DatePicker } from 'primeng/datepicker';
import { InputNumber } from 'primeng/inputnumber';
import { InputText } from 'primeng/inputtext';
import { MultiSelect } from 'primeng/multiselect';
import { RadioButton } from 'primeng/radiobutton';
import { Select } from 'primeng/select';
import { Textarea } from 'primeng/textarea';

import { evaluateForm, validateDefinition } from '../rules/evaluator';
import {
  DefinitionErrorCode,
  EvaluationMode,
  FormDefinition,
  FormEvaluation,
  FormField,
} from '../rules/types';
import { fieldLabel, validationMessage } from './messages';
import {
  MF_ASSET_PICKER,
  MF_USER_PICKER,
  ReferencePicker,
  ReferencePickerHost,
} from './reference-picker';

/** An error reported by the server for one field (architecture 7.4); shown inline. */
export interface ServerFieldError {
  fieldKey: string;
  message: string;
}

const INPUT_CONTROLS = new Set([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CHECKBOX',
  'SELECT',
  'RADIO',
  'MULTISELECT',
  'DATE',
  'DATETIME',
  'URL',
  'ASSET_REF',
  'USER_REF',
]);

const EMPTY_EVALUATION: FormEvaluation = {
  visible: {},
  required: {},
  options: {},
  errors: [],
  normalized: {},
};

/** One field prepared for the template. */
interface FieldRow {
  field: FormField;
  id: string;
  label: string;
  required: boolean;
  isInput: boolean;
  /** Offered options (label + key), in declared order. */
  items: { label: string; value: string }[];
  /** Value in the shape the PrimeNG control expects. */
  model: unknown;
  /** Display text for read-only mode. */
  text: string;
  error: string | null;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function dateFromString(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function dateToString(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateTimeFromString(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC instant as `yyyy-MM-ddTHH:mm:ssZ` (addendum M: stored UTC, entered and shown local). */
function dateTimeToString(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

let nextInstance = 0;

/**
 * Renders a form definition with live show/hide/required behavior.
 *
 * Inputs: `definition`, `values`, `readOnly`, `mode`, `serverErrors`, `assetPicker`, `userPicker`.
 * Outputs: `valuesChange` (visible, non-empty, type-valid values only; hidden values are never
 * emitted) and `evaluationChange`. Call `validate()` on submit to reveal required errors.
 */
@Component({
  selector: 'mf-dynamic-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    InputText,
    Textarea,
    InputNumber,
    Checkbox,
    Select,
    RadioButton,
    MultiSelect,
    DatePicker,
    ReferencePickerHost,
  ],
  templateUrl: './dynamic-form.html',
  styleUrl: './dynamic-form.scss',
})
export class DynamicForm {
  /** The form definition (fields in display order). */
  readonly definition = input.required<FormDefinition>();
  /** Current values, keyed by field key. Re-seeds the form whenever the object changes. */
  readonly values = input<Readonly<Record<string, unknown>>>({});
  /** Read-only mode: values are shown as text, no controls. */
  readonly readOnly = input(false, { transform: booleanAttribute });
  /** `draft` skips REQUIRED errors (step inputs saved without completing). */
  readonly mode = input<EvaluationMode>('submit');
  /** Field errors returned by the server, shown inline. */
  readonly serverErrors = input<readonly ServerFieldError[]>([]);
  /** Overrides the `MF_ASSET_PICKER` token for ASSET_REF fields. */
  readonly assetPicker = input<Type<ReferencePicker> | null>(null);
  /** Overrides the `MF_USER_PICKER` token for USER_REF fields. */
  readonly userPicker = input<Type<ReferencePicker> | null>(null);

  readonly valuesChange = output<Record<string, unknown>>();
  readonly evaluationChange = output<FormEvaluation>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly assetToken = inject(MF_ASSET_PICKER, { optional: true });
  private readonly userToken = inject(MF_USER_PICKER, { optional: true });
  private readonly idPrefix = `mf-form-${nextInstance++}`;

  /** What the user has entered, including values of currently hidden fields. */
  private readonly draft = linkedSignal<Record<string, unknown>>(() => ({ ...this.values() }));
  private readonly touched = signal<ReadonlySet<string>>(new Set());
  private readonly submitted = signal(false);

  readonly definitionErrors = computed<DefinitionErrorCode[]>(() =>
    validateDefinition(this.definition().fields),
  );

  /** Latest evaluation (visibility, requiredness, options, errors, normalized values). */
  readonly evaluation = computed<FormEvaluation>(() => {
    if (this.definitionErrors().length) return EMPTY_EVALUATION;
    return this.evaluate(this.draft());
  });

  protected readonly resolvedAssetPicker = computed(() => this.assetPicker() ?? this.assetToken);
  protected readonly resolvedUserPicker = computed(() => this.userPicker() ?? this.userToken);

  protected readonly rows = computed<FieldRow[]>(() => {
    if (this.definitionErrors().length) return [];
    const ev = this.evaluation();
    const draft = this.draft();
    const readOnly = this.readOnly();
    const touched = this.touched();
    const submitted = this.submitted();
    const server = this.serverErrors();
    const rows: FieldRow[] = [];
    for (const field of this.definition().fields) {
      if (!ev.visible[field.key]) continue;
      const isInput = INPUT_CONTROLS.has(field.control);
      const raw = draft[field.key];
      const local = ev.errors.find((e) => e.fieldKey === field.key);
      const serverError = server.find((e) => e.fieldKey === field.key);
      // Format errors show after the field was left; required errors wait for submit.
      const showLocal =
        local && (submitted || (touched.has(field.key) && local.code !== 'REQUIRED'));
      const offered = ev.options[field.key];
      rows.push({
        field,
        id: `${this.idPrefix}-${field.key}`,
        label: fieldLabel(field),
        required: ev.required[field.key] === true,
        isInput,
        items: (field.options ?? [])
          .filter((o) => !offered || offered.includes(o.key))
          .map((o) => ({ label: o.label?.trim() || o.key, value: o.key })),
        model: this.toModel(field, raw),
        text: readOnly ? this.toText(field, raw) : '',
        error:
          !readOnly && isInput
            ? (serverError?.message ??
              (showLocal && local ? validationMessage(field, local.code) : null))
            : null,
      });
    }
    return rows;
  });

  /**
   * Validate for submit: reveals every error and returns the evaluation. Focuses the first
   * invalid control. The caller persists `normalized` only when `errors` is empty.
   */
  validate(): FormEvaluation {
    this.submitted.set(true);
    const ev = this.evaluation();
    if (ev.errors.length) {
      queueMicrotask(() =>
        this.host.nativeElement
          .querySelector<HTMLElement>('[aria-invalid="true"], [aria-invalid="true"] input')
          ?.focus(),
      );
    }
    return ev;
  }

  /** Clear the revealed-error state (after a successful save or a reset). */
  resetValidation(): void {
    this.submitted.set(false);
    this.touched.set(new Set());
  }

  protected pickerFor(row: FieldRow): Type<ReferencePicker> | null {
    return row.field.control === 'ASSET_REF'
      ? this.resolvedAssetPicker()
      : this.resolvedUserPicker();
  }

  protected setValue(field: FormField, control: unknown): void {
    const value = this.fromModel(field, control);
    this.draft.update((d) => {
      const next = { ...d };
      if (value === undefined) delete next[field.key];
      else next[field.key] = value;
      return next;
    });
    const ev = this.evaluation();
    this.valuesChange.emit({ ...ev.normalized });
    this.evaluationChange.emit(ev);
  }

  protected markTouched(key: string): void {
    if (this.touched().has(key)) return;
    this.touched.update((t) => new Set(t).add(key));
  }

  protected errorId(row: FieldRow): string {
    return `${row.id}-error`;
  }

  protected helpId(row: FieldRow): string {
    return `${row.id}-help`;
  }

  protected describedBy(row: FieldRow): string | null {
    const ids = [row.field.helpText ? this.helpId(row) : '', row.error ? this.errorId(row) : ''];
    return ids.filter(Boolean).join(' ') || null;
  }

  // ---------------------------------------------------------------------------------------

  private evaluate(draft: Record<string, unknown>): FormEvaluation {
    // Keys that are not input fields (values kept for retired fields) are not form input.
    const inputKeys = new Set(
      this.definition()
        .fields.filter((f) => INPUT_CONTROLS.has(f.control))
        .map((f) => f.key),
    );
    const values = Object.fromEntries(Object.entries(draft).filter(([k]) => inputKeys.has(k)));
    return evaluateForm(this.definition().fields, values, this.mode());
  }

  /** Stored JSON value to the control's model. */
  private toModel(field: FormField, raw: unknown): unknown {
    switch (field.control) {
      case 'DATE':
        return dateFromString(raw);
      case 'DATETIME':
        return dateTimeFromString(raw);
      case 'MULTISELECT':
        return Array.isArray(raw) ? raw : [];
      case 'TEXT':
      case 'TEXTAREA':
      case 'URL':
        return typeof raw === 'string' ? raw : '';
      case 'NUMBER':
      case 'ASSET_REF':
      case 'USER_REF':
        return typeof raw === 'number' ? raw : null;
      case 'CHECKBOX':
        return typeof raw === 'boolean' ? raw : null;
      default:
        return raw ?? null;
    }
  }

  /** Control model back to the JSON value; undefined means "unanswered". */
  private fromModel(field: FormField, v: unknown): unknown {
    switch (field.control) {
      case 'DATE':
        return v instanceof Date ? dateToString(v) : undefined;
      case 'DATETIME':
        return v instanceof Date ? dateTimeToString(v) : undefined;
      case 'MULTISELECT':
        return Array.isArray(v) && v.length ? v : undefined;
      default:
        return v === null || v === undefined ? undefined : v;
    }
  }

  private toText(field: FormField, raw: unknown): string {
    const none = 'Not provided';
    if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && !raw.length)) {
      return none;
    }
    const label = (key: unknown): string => {
      const o = field.options?.find((x) => x.key === key);
      return o?.label?.trim() || String(key);
    };
    switch (field.control) {
      case 'CHECKBOX':
        return raw === true ? 'Yes' : raw === false ? 'No' : none;
      case 'SELECT':
      case 'RADIO':
        return label(raw);
      case 'MULTISELECT':
        return Array.isArray(raw) ? raw.map(label).join(', ') : none;
      case 'DATETIME': {
        const d = dateTimeFromString(raw);
        return d ? d.toLocaleString(undefined, { timeZoneName: 'short' }) : String(raw);
      }
      default:
        return String(raw);
    }
  }
}
