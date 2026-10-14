import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DynamicForm, FormDefinition, ServerFieldError, errorSummary } from 'form-engine';
import { firstValueFrom } from 'rxjs';
import { FormsClient } from '../../api/generated/api-client';
import { toFormDefinition } from '../forms/form-schema';

/** Splits the server's field errors into those of the record itself and those of custom fields (keyed `form:<fieldKey>`). */
export function splitFormErrors(fields: Record<string, string>): {
  base: Record<string, string>;
  form: ServerFieldError[];
} {
  const base: Record<string, string> = {};
  const form: ServerFieldError[] = [];
  for (const [key, message] of Object.entries(fields)) {
    if (key.startsWith('form:')) form.push({ fieldKey: key.slice(5), message });
    else base[key] = message;
  }
  return { base, form };
}

/** Loads a form version's schema for rendering; `null` when there is no version, it has no fields or it can't be read. */
async function loadSchema(
  forms: FormsClient,
  versionId: number | null | undefined,
): Promise<FormDefinition | null> {
  if (versionId === undefined || versionId === null) return null;
  try {
    const detail = await firstValueFrom(forms.getFormVersionSchema(versionId));
    const definition = toFormDefinition(detail);
    return definition.fields.length > 0 ? definition : null;
  } catch {
    return null;
  }
}

/** The summary lines for invalid custom fields, one per field with its label; empty when all are valid. */
export function customFieldsProblems(custom: CollectedCustomFields | undefined): string[] {
  if (!custom?.invalid) return [];
  return custom.invalidFields.length > 0
    ? custom.invalidFields
    : ['Complete the highlighted custom fields.'];
}

/** What `collect()` hands to the page. */
export interface CollectedCustomFields {
  /** True when a visible custom field is invalid; the errors are shown inline. */
  invalid: boolean;
  /** One line per invalid field (label and message), in form order, for the summary list. */
  invalidFields: string[];
  /** Values to send: all values on create, a patch (changed values, `null` for cleared ones) on edit; undefined without a form. */
  values: Record<string, unknown> | undefined;
}

/**
 * The 'Custom fields' section of the Client, Matter and Project forms (UX S05 to S07): the PUBLISHED custom-field form rendered by the
 * form engine. Shows nothing while the object has no published form with fields. The server re-validates and drops hidden values.
 */
@Component({
  selector: 'mf-custom-fields-editor',
  imports: [DynamicForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (schema(); as definition) {
      <fieldset class="cf-fields" data-custom-fields>
        <legend>Custom fields</legend>
        <mf-dynamic-form
          [definition]="definition"
          [values]="values()"
          [serverErrors]="serverErrors()"
          (valuesChange)="changed()"
        />
      </fieldset>
    }
  `,
  styles: `
    .cf-fields {
      display: grid;
      gap: var(--mf-s3);
      margin: 0;
      padding: var(--mf-s3) 0 0;
      border: 0;
      border-top: 1px solid var(--mf-border);
    }
    .cf-fields legend {
      padding: 0 var(--mf-s2) 0 0;
      font-weight: 600;
    }
  `,
})
export class CustomFieldsEditor {
  /** The published form version to render, if any. */
  readonly versionId = input<number | null | undefined>();
  /** Stored values (edit) or empty (create). */
  readonly values = input<Record<string, unknown>>({});
  readonly serverErrors = input<ServerFieldError[]>([]);
  /** Emits when the user changes a value. */
  readonly touched = output<void>();

  private readonly forms = inject(FormsClient);
  private readonly dynamicForm = viewChild(DynamicForm);
  /** True once the user entered or changed a value in this section. */
  private readonly userTouched = signal(false);

  protected readonly schema = signal<FormDefinition | null>(null);

  constructor() {
    effect(() => {
      const id = this.versionId();
      untracked(() => void loadSchema(this.forms, id).then((s) => this.schema.set(s)));
    });
  }

  protected changed(): void {
    this.userTouched.set(true);
    this.touched.emit();
  }

  /**
   * Validates the visible fields (revealing errors inline, red border) and returns the values to send. When editing an existing record
   * whose custom-fields section the user did not touch, nothing is validated or sent, so new required fields never block the save
   * (decisions addendum P).
   */
  collect(original?: Record<string, unknown>): CollectedCustomFields {
    const schema = this.schema();
    const form = this.dynamicForm();
    if (!schema || !form) return { invalid: false, invalidFields: [], values: undefined };
    if (original && !this.userTouched())
      return { invalid: false, invalidFields: [], values: undefined };
    const evaluation = form.validate();
    if (evaluation.errors.length > 0) {
      const invalidFields = errorSummary(schema.fields, evaluation.errors);
      return { invalid: true, invalidFields, values: undefined };
    }
    const normalized = evaluation.normalized ?? {};
    if (!original) return { invalid: false, invalidFields: [], values: normalized };
    const known = new Set(schema.fields.map((f) => f.key));
    const patch: Record<string, unknown> = { ...normalized };
    for (const key of Object.keys(original)) {
      if (known.has(key) && !(key in normalized)) patch[key] = null;
    }
    return { invalid: false, invalidFields: [], values: patch };
  }
}

/** Read-only 'Custom fields' section for detail pages; values are shown with the form version they were captured under. */
@Component({
  selector: 'mf-custom-fields-view',
  imports: [DynamicForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (schema(); as definition) {
      <section class="cf-view" aria-labelledby="custom-fields-h" data-custom-fields>
        <h2 id="custom-fields-h" class="cf-title">Custom fields</h2>
        <mf-dynamic-form [definition]="definition" [values]="values()" [readOnly]="true" />
      </section>
    }
  `,
  styles: `
    .cf-view {
      margin-top: var(--mf-s4);
    }
    .cf-title {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-h3);
    }
  `,
})
export class CustomFieldsView {
  /** The version the stored values were captured under. */
  readonly versionId = input<number | null | undefined>();
  readonly values = input<Record<string, unknown>>({});

  private readonly forms = inject(FormsClient);
  protected readonly schema = signal<FormDefinition | null>(null);

  constructor() {
    effect(() => {
      const id = this.versionId();
      untracked(() => void loadSchema(this.forms, id).then((s) => this.schema.set(s)));
    });
  }
}
