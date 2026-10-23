import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChoiceTestResponse, ReportChoicesClient } from '../../../api/generated/api-client';
import {
  LOOKUP_KINDS,
  PARAM_TYPES,
  ParamDef,
  ParamOption,
  ParamType,
  TYPE_LABEL,
  defaultKeywords,
  defaultText,
  placeholderNames,
  withType,
} from './report-model';

/** The default as typed: a number for a number, a boolean for yes/no, text otherwise (a keyword such as `today` stays text). */
export function parseDefault(def: ParamDef, text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  if (def.type === 'number') {
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  }
  if (def.type === 'yesNo') return t === 'true';
  if (
    (def.type === 'lookup' || def.type === 'single') &&
    /^-?\d+$/.test(t) &&
    (def.type === 'lookup' || def.valueType === 'int')
  )
    return Number(t);
  return t;
}

/**
 * The parameter definitions of a report (spec 5.1, 9.2): one card per `:NAME` found in the query, with the type, label, default, required
 * flag and what the type needs (lookup kind, a fixed list or a SELECT with a Test button, number limits, text length). The page keeps
 * the list in step with the query; this component only edits it and shows which ones the query no longer uses. It adds and removes
 * nothing by itself.
 */
@Component({
  selector: 'mf-parameters-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (defs().length === 0) {
      <p class="pe__empty" data-no-parameters>
        This query has no parameters yet. Write <code>:NAME</code> in the query where a value
        belongs, for example <code>WHERE t.DueDate &lt; :DUE</code>, and it appears here.
      </p>
    }
    @for (d of defs(); track d.name; let i = $index) {
      <fieldset
        class="pe__card"
        [class.pe__card--unused]="unused().has(d.name)"
        [attr.data-parameter]="d.name"
      >
        <legend class="pe__legend">
          <code>{{ placeholders(d) }}</code>
          @if (unused().has(d.name)) {
            <span class="pe__chip" data-unused
              >Not used in the query. It is dropped when you save.</span
            >
          }
        </legend>
        @if (errors()[d.name]; as list) {
          <ul class="pe__errors" role="alert" data-parameter-errors>
            @for (message of list; track message) {
              <li><i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ message }}</li>
            }
          </ul>
        }
        <div class="pe__grid">
          <div class="pe__field">
            <label class="mf-label mf-label--sm" [for]="id(i, 'type')">Type</label>
            <select
              class="mf-control mf-control--fill"
              [id]="id(i, 'type')"
              [value]="d.type"
              (change)="setType(i, $any($event.target).value)"
            >
              @for (t of types; track t.value) {
                <option [value]="t.value" [selected]="t.value === d.type">{{ t.label }}</option>
              }
            </select>
          </div>
          <div class="pe__field">
            <label class="mf-label mf-label--sm" [for]="id(i, 'label')">Label</label>
            <input
              class="mf-control mf-control--fill"
              type="text"
              maxlength="100"
              autocomplete="off"
              [id]="id(i, 'label')"
              [value]="d.label"
              (input)="patch(i, { label: $any($event.target).value })"
            />
          </div>
          <div class="pe__field">
            <label class="mf-label mf-label--sm" [for]="id(i, 'help')">Help text</label>
            <input
              class="mf-control mf-control--fill"
              type="text"
              maxlength="300"
              autocomplete="off"
              [id]="id(i, 'help')"
              [value]="d.helpText ?? ''"
              (input)="patch(i, { helpText: $any($event.target).value })"
            />
          </div>
          <div class="pe__field">
            <label class="mf-label mf-label--sm" [for]="id(i, 'default')">Default</label>
            <input
              class="mf-control mf-control--fill"
              type="text"
              autocomplete="off"
              [id]="id(i, 'default')"
              [attr.list]="keywordsOf(d).length ? id(i, 'keywords') : null"
              [value]="defaultOf(d)"
              (input)="patch(i, { default: parse(d, $any($event.target).value) })"
            />
            @if (keywordsOf(d).length) {
              <datalist [id]="id(i, 'keywords')">
                @for (k of keywordsOf(d); track k.value) {
                  <option [value]="k.value">{{ k.label }}</option>
                }
              </datalist>
            }
          </div>
          <label class="pe__check">
            <input
              type="checkbox"
              [checked]="!!d.isRequired"
              (change)="patch(i, { isRequired: $any($event.target).checked })"
            />
            Required
          </label>
        </div>

        @switch (d.type) {
          @case ('number') {
            <div class="pe__grid" data-number-settings>
              <div class="pe__field">
                <label class="mf-label mf-label--sm" [for]="id(i, 'min')">Lowest value</label>
                <input
                  class="mf-control mf-control--fill"
                  type="number"
                  [id]="id(i, 'min')"
                  [value]="d.min ?? ''"
                  (input)="patch(i, { min: num($any($event.target).value) })"
                />
              </div>
              <div class="pe__field">
                <label class="mf-label mf-label--sm" [for]="id(i, 'max')">Highest value</label>
                <input
                  class="mf-control mf-control--fill"
                  type="number"
                  [id]="id(i, 'max')"
                  [value]="d.max ?? ''"
                  (input)="patch(i, { max: num($any($event.target).value) })"
                />
              </div>
              <label class="pe__check">
                <input
                  type="checkbox"
                  [checked]="!!d.integerOnly"
                  (change)="patch(i, { integerOnly: $any($event.target).checked })"
                />
                Whole numbers only
              </label>
            </div>
          }
          @case ('text') {
            <div class="pe__field pe__field--short">
              <label class="mf-label mf-label--sm" [for]="id(i, 'maxlen')"
                >Longest text (at most 400)</label
              >
              <input
                class="mf-control mf-control--fill"
                type="number"
                min="1"
                max="400"
                [id]="id(i, 'maxlen')"
                [value]="d.maxLength ?? ''"
                (input)="patch(i, { maxLength: num($any($event.target).value) })"
              />
            </div>
          }
          @case ('lookup') {
            <div class="pe__grid" data-lookup-settings>
              <div class="pe__field">
                <label class="mf-label mf-label--sm" [for]="id(i, 'kind')">Searches</label>
                <select
                  class="mf-control mf-control--fill"
                  [id]="id(i, 'kind')"
                  (change)="patch(i, { lookupKind: $any($event.target).value })"
                >
                  @for (k of kinds; track k.value) {
                    <option [value]="k.value" [selected]="k.value === d.lookupKind">
                      {{ k.label }}
                    </option>
                  }
                </select>
              </div>
              <label class="pe__check">
                <input
                  type="checkbox"
                  [checked]="!!d.lookupMulti"
                  (change)="patch(i, { lookupMulti: $any($event.target).checked })"
                />
                More than one
              </label>
            </div>
          }
          @case ('single') {
            <ng-container [ngTemplateOutlet]="choice" [ngTemplateOutletContext]="{ d: d, i: i }" />
          }
          @case ('multi') {
            <ng-container [ngTemplateOutlet]="choice" [ngTemplateOutletContext]="{ d: d, i: i }" />
          }
        }
      </fieldset>
    }

    <ng-template #choice let-d="d" let-i="i">
      <div class="pe__grid" data-choice-settings>
        <div class="pe__field">
          <label class="mf-label mf-label--sm" [for]="id(i, 'source')">Choices come from</label>
          <select
            class="mf-control mf-control--fill"
            [id]="id(i, 'source')"
            (change)="patch(i, { optionsKind: $any($event.target).value })"
          >
            <option value="fixed" [selected]="d.optionsKind === 'fixed'">A fixed list</option>
            <option value="query" [selected]="d.optionsKind === 'query'">A SELECT</option>
          </select>
        </div>
        <div class="pe__field">
          <label class="mf-label mf-label--sm" [for]="id(i, 'vtype')">Value is</label>
          <select
            class="mf-control mf-control--fill"
            [id]="id(i, 'vtype')"
            (change)="patch(i, { valueType: $any($event.target).value })"
          >
            <option value="text" [selected]="(d.valueType ?? 'text') === 'text'">Text</option>
            <option value="int" [selected]="d.valueType === 'int'">Whole number</option>
          </select>
        </div>
      </div>
      @if (d.optionsKind === 'fixed') {
        <div class="pe__options" data-fixed-list>
          <p class="mf-label mf-label--sm" [id]="id(i, 'opts')">
            Fixed list (value and label, at most 200)
          </p>
          @for (o of d.options ?? []; track $index; let j = $index) {
            <div class="pe__option" role="group" [attr.aria-label]="'Choice ' + (j + 1)">
              <input
                class="mf-control"
                type="text"
                maxlength="200"
                [attr.aria-label]="'Value of choice ' + (j + 1)"
                [value]="o.value"
                (input)="setOption(i, j, { value: $any($event.target).value })"
              />
              <input
                class="mf-control"
                type="text"
                maxlength="200"
                [attr.aria-label]="'Label of choice ' + (j + 1)"
                [value]="o.label"
                (input)="setOption(i, j, { label: $any($event.target).value })"
              />
              <button
                type="button"
                class="mf-btn"
                (click)="removeOption(i, j)"
                [attr.aria-label]="'Remove choice ' + (j + 1)"
              >
                <i class="pi pi-times" aria-hidden="true"></i>
              </button>
            </div>
          }
          <button type="button" class="mf-btn" (click)="addOption(i)" data-add-option>
            <i class="pi pi-plus" aria-hidden="true"></i> Add a choice
          </button>
        </div>
      } @else {
        <div class="pe__field pe__field--wide" data-query-list>
          <label class="mf-label mf-label--sm" [for]="id(i, 'osql')"
            >SELECT with the columns Value and Label</label
          >
          <textarea
            class="mf-control mf-control--fill pe__sql"
            rows="4"
            spellcheck="false"
            [id]="id(i, 'osql')"
            [value]="d.optionsSql ?? ''"
            (input)="patch(i, { optionsSql: $any($event.target).value })"
          ></textarea>
          <p class="pe__hint">
            At most 1,000 rows and 10 seconds. It may use built-in values such as
            <code>:CURRENT_USER_ID</code> but no other parameter.
          </p>
          <div>
            <button
              type="button"
              class="mf-btn"
              (click)="test(i)"
              [disabled]="!reportId() || testing() === d.name"
              data-test-list
            >
              {{ testing() === d.name ? 'Testing...' : 'Test the SELECT' }}
            </button>
            @if (!reportId()) {
              <span class="pe__hint"> Save the report first to test.</span>
            }
          </div>
          @if (tested()[d.name]; as t) {
            <div class="pe__test" role="status" data-test-result>
              @if (t.success) {
                {{ t.total }} {{ t.total === 1 ? 'choice' : 'choices'
                }}{{ t.truncated ? ' (cut off at 1,000)' : '' }} in {{ t.durationMs }} ms:
                {{ preview(t) }}
              } @else {
                <span class="pe__fail"
                  ><i class="pi pi-exclamation-circle" aria-hidden="true"></i> {{ t.error }}</span
                >
              }
            </div>
          }
        </div>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      display: grid;
      gap: var(--mf-s3);
    }

    .pe__empty {
      margin: 0;
      color: var(--mf-text-muted);
    }

    .pe__card {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
      margin: 0;
      padding: var(--mf-s3) var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }

    .pe__card--unused {
      border-style: dashed;
      opacity: 0.85;
    }

    .pe__legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s2);
      align-items: center;
      padding: 0 var(--mf-s2);
      font-weight: 600;
    }

    .pe__chip {
      padding: 0 var(--mf-s2);
      border-radius: var(--mf-radius);
      background: var(--mf-warning-bg);
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
      font-weight: 400;
    }

    .pe__errors {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--mf-danger);
    }

    .pe__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--mf-s3);
      align-items: end;
    }

    .pe__field {
      display: grid;
      gap: var(--mf-s1);
      min-width: 0;
    }

    .pe__field--short {
      max-width: 14rem;
    }

    .pe__check {
      display: flex;
      gap: var(--mf-s2);
      align-items: center;
      min-height: var(--mf-target-min);
    }

    .pe__options {
      display: grid;
      gap: var(--mf-s2);
    }

    .pe__option {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: var(--mf-s2);
    }

    .pe__option .mf-control {
      min-width: 0;
    }

    .pe__sql {
      font-family: var(--mf-font-mono);
    }

    .pe__hint {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }

    .pe__test {
      padding: var(--mf-s2) var(--mf-s3);
      border-radius: var(--mf-radius);
      background: var(--mf-surface-alt);
      overflow-wrap: anywhere;
    }

    .pe__fail {
      color: var(--mf-danger);
    }
  `,
})
export class ParametersEditor {
  private readonly choices = inject(ReportChoicesClient);

  readonly defs = input.required<readonly ParamDef[]>();
  readonly unused = input<ReadonlySet<string>>(new Set());
  /** Messages by parameter name (from the page's checks and from the server). */
  readonly errors = input<Readonly<Record<string, readonly string[]>>>({});
  /** The saved report, for the Test button of a SELECT list; null for a report that is not saved yet. */
  readonly reportId = input<number | null>(null);
  readonly defsChange = output<ParamDef[]>();

  protected readonly types = PARAM_TYPES;
  protected readonly kinds = LOOKUP_KINDS;
  protected readonly testing = signal('');
  protected readonly tested = signal<Record<string, ChoiceTestResponse>>({});
  protected readonly typeLabel = TYPE_LABEL;

  protected readonly placeholders = (d: ParamDef): string =>
    placeholderNames(d)
      .map((n) => ':' + n)
      .join(' and ');

  protected id(i: number, part: string): string {
    return `param-${i}-${part}`;
  }

  protected keywordsOf(d: ParamDef) {
    return defaultKeywords(d);
  }

  protected defaultOf(d: ParamDef): string {
    return defaultText(d);
  }

  protected parse(d: ParamDef, text: string): unknown {
    return parseDefault(d, text);
  }

  protected num(text: string): number | undefined {
    const n = Number(text);
    return text.trim() === '' || !Number.isFinite(n) ? undefined : n;
  }

  protected setType(i: number, type: string): void {
    this.update(i, (d) => withType(d, type as ParamType));
  }

  protected patch(i: number, change: Partial<ParamDef>): void {
    this.update(i, (d) => ({ ...d, ...change }));
  }

  protected setOption(i: number, j: number, change: Partial<ParamOption>): void {
    this.update(i, (d) => ({
      ...d,
      options: (d.options ?? []).map((o, k) => (k === j ? { ...o, ...change } : o)),
    }));
  }

  protected addOption(i: number): void {
    this.update(i, (d) => ({ ...d, options: [...(d.options ?? []), { value: '', label: '' }] }));
  }

  protected removeOption(i: number, j: number): void {
    this.update(i, (d) => ({ ...d, options: (d.options ?? []).filter((_, k) => k !== j) }));
  }

  private update(i: number, change: (d: ParamDef) => ParamDef): void {
    this.defsChange.emit(this.defs().map((d, k) => (k === i ? change(d) : d)));
  }

  protected preview(t: ChoiceTestResponse): string {
    const shown = t.options
      .slice(0, 5)
      .map((o) => (o.value === o.label ? o.value : `${o.label} (${o.value})`));
    return shown.join(', ') + (t.total > shown.length ? ', ...' : '');
  }

  protected async test(i: number): Promise<void> {
    const d = this.defs()[i];
    const id = this.reportId();
    if (!d || id === null) return;
    this.testing.set(d.name);
    try {
      const result = await firstValueFrom(
        this.choices.testReportChoiceQuery(id, {
          sql: d.optionsSql ?? '',
          valueType: d.valueType ?? 'text',
        }),
      );
      this.tested.update((all) => ({ ...all, [d.name]: result }));
    } catch {
      this.tested.update((all) => ({
        ...all,
        [d.name]: {
          success: false,
          options: [],
          total: 0,
          truncated: false,
          durationMs: 0,
          errorCode: 'TEST_FAILED',
          error: 'The test could not be run.',
        },
      }));
    } finally {
      this.testing.set('');
    }
  }
}
