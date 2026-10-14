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
import { DynamicForm, FormDefinition, ServerFieldError } from 'form-engine';
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

/** What `collect()` hands to the page. */
export interface CollectedCustomFields {
  /** True when a visible custom field is invalid; the errors are shown inline. */
  invalid: boolean;
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
          (valuesChange)="touched.emit()"
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

  protected readonly schema = signal<FormDefinition | null>(null);

  constructor() {
    effect(() => {
      const id = this.versionId();
      untracked(() => void loadSchema(this.forms, id).then((s) => this.schema.set(s)));
    });
  }

  /** Validates the visible fields (revealing errors inline) and returns the values to send. */
  collect(original?: Record<string, unknown>): CollectedCustomFields {
    const schema = this.schema();
    const form = this.dynamicForm();
    if (!schema || !form) return { invalid: false, values: undefined };
    const evaluation = form.validate();
    if (evaluation.errors.length > 0) return { invalid: true, values: undefined };
    const normalized = evaluation.normalized ?? {};
    if (!original) return { invalid: false, values: normalized };
    const known = new Set(schema.fields.map((f) => f.key));
    const patch: Record<string, unknown> = { ...normalized };
    for (const key of Object.keys(original)) {
      if (known.has(key) && !(key in normalized)) patch[key] = null;
    }
    return { invalid: false, values: patch };
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
      font-size: var(--mf-fs-h2);
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
