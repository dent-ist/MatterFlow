import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PreviewResponse } from '../../../api/generated/api-client';
import { ParamDef } from './report-model';

/** What the author typed for each parameter of the preview (text; the parts of a range have their own keys). */
export type SampleTexts = Record<string, string | undefined>;

const splitList = (text: string): string[] =>
  text
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * Turns the typed sample texts into the JSON values the preview endpoint takes. Empty texts are left out (the server then uses the default,
 * and for a required parameter a sample of its type). Pure, so it is easy to test.
 */
export function sampleValuesOf(
  defs: readonly ParamDef[],
  texts: SampleTexts,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const text = (texts[d.name] ?? '').trim();
    switch (d.type) {
      case 'dateRange': {
        const from = (texts[d.name + '.from'] ?? '').trim();
        const to = (texts[d.name + '.to'] ?? '').trim();
        if (from || to) out[d.name] = { from, to };
        break;
      }
      case 'number':
        if (text && Number.isFinite(Number(text))) out[d.name] = Number(text);
        break;
      case 'yesNo':
        if (text === 'true' || text === 'false') out[d.name] = text === 'true';
        break;
      case 'multi':
        if (text)
          out[d.name] = d.valueType === 'int' ? splitList(text).map(Number) : splitList(text);
        break;
      case 'lookup':
        if (text) out[d.name] = d.lookupMulti ? splitList(text).map(Number) : Number(text);
        break;
      default:
        if (text) out[d.name] = d.type === 'single' && d.valueType === 'int' ? Number(text) : text;
    }
  }
  return out;
}

/**
 * The preview panel (spec 6.6, 9.2, issue #714): sample values for the parameters, a Run preview button, then the first 20 rows with the
 * columns, the duration and the row count (and a hint when the full result would be cut off). An administrator sees the validation errors
 * with line and column, the parameter problems and SQL Server's own message in full. A successful preview of the saved version is what
 * allows Activate; the page shows that next to the button.
 */
@Component({
  selector: 'mf-preview-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pp" aria-labelledby="pp-title" data-preview-panel>
      <h2 id="pp-title" class="pp__title">Preview with sample values</h2>
      @if (defs().length > 0) {
        <div class="pp__samples">
          @for (d of defs(); track d.name) {
            @if (d.type === 'dateRange') {
              <div class="pp__field">
                <label class="mf-label mf-label--sm" [for]="'pp-' + d.name + '-from'"
                  >{{ d.label }} from</label
                >
                <input
                  class="mf-control mf-control--fill"
                  type="date"
                  [id]="'pp-' + d.name + '-from'"
                  [value]="texts()[d.name + '.from'] ?? ''"
                  (input)="set(d.name + '.from', $any($event.target).value)"
                />
              </div>
              <div class="pp__field">
                <label class="mf-label mf-label--sm" [for]="'pp-' + d.name + '-to'"
                  >{{ d.label }} to</label
                >
                <input
                  class="mf-control mf-control--fill"
                  type="date"
                  [id]="'pp-' + d.name + '-to'"
                  [value]="texts()[d.name + '.to'] ?? ''"
                  (input)="set(d.name + '.to', $any($event.target).value)"
                />
              </div>
            } @else if (d.type === 'yesNo') {
              <div class="pp__field">
                <label class="mf-label mf-label--sm" [for]="'pp-' + d.name">{{ d.label }}</label>
                <select
                  class="mf-control mf-control--fill"
                  [id]="'pp-' + d.name"
                  (change)="set(d.name, $any($event.target).value)"
                >
                  <option value="" [selected]="!texts()[d.name]">Default</option>
                  <option value="true" [selected]="texts()[d.name] === 'true'">Yes</option>
                  <option value="false" [selected]="texts()[d.name] === 'false'">No</option>
                </select>
              </div>
            } @else {
              <div class="pp__field">
                <label class="mf-label mf-label--sm" [for]="'pp-' + d.name"
                  >{{ d.label }}{{ hint(d) }}</label
                >
                <input
                  class="mf-control mf-control--fill"
                  [type]="d.type === 'date' ? 'date' : 'text'"
                  autocomplete="off"
                  [id]="'pp-' + d.name"
                  [value]="texts()[d.name] ?? ''"
                  (input)="set(d.name, $any($event.target).value)"
                />
              </div>
            }
          }
        </div>
        <p class="pp__hint">
          Leave a box empty to use the default. A required parameter without a default gets a sample
          of its type.
        </p>
      }
      <div class="pp__actions">
        <button
          type="button"
          class="mf-btn mf-btn--primary"
          (click)="run.emit(values())"
          [disabled]="busy() || !!blocked()"
          data-run-preview
        >
          {{ busy() ? 'Running...' : 'Run preview' }}
        </button>
        @if (blocked(); as why) {
          <span class="pp__hint" data-preview-blocked>{{ why }}</span>
        }
      </div>

      <div role="status" aria-live="polite" class="pp__live" data-preview-live>
        @if (result(); as r) {
          @if (r.success) {
            <p class="pp__ok" data-preview-ok>
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              First {{ r.rows.length }} of {{ r.rowCount }}
              {{ r.rowCount === 1 ? 'row' : 'rows' }} in {{ r.durationMs }} ms.
              @if (r.exceedsCap) {
                The full result would be cut off at the row limit.
              }
            </p>
          } @else {
            <p class="pp__bad" data-preview-failed>
              <i class="pi pi-exclamation-circle" aria-hidden="true"></i>
              The preview did not run ({{ r.status }}).
            </p>
          }
        }
      </div>

      @if (result(); as r) {
        @if (r.validationErrors.length > 0) {
          <ul class="pp__problems" data-validation-errors>
            @for (e of r.validationErrors; track $index) {
              <li>Line {{ e.line }}, column {{ e.column }}: {{ e.message }}</li>
            }
          </ul>
        }
        @if (r.parameterErrors.length > 0) {
          <ul class="pp__problems" data-parameter-errors>
            @for (e of r.parameterErrors; track $index) {
              <li>{{ e.name }}: {{ e.message }}</li>
            }
          </ul>
        }
        @if (r.sqlError) {
          <pre
            class="pp__sqlerror"
            data-sql-error>{{ r.sqlError }}@if (r.sqlErrorLine) { (line {{ r.sqlErrorLine }})}</pre>
        }
        @if (r.success) {
          <div class="pp__table" tabindex="0" role="region" aria-label="Preview rows">
            <table class="mf-grid">
              <caption class="mf-sr-only">
                First rows of the preview
              </caption>
              <thead>
                <tr>
                  @for (c of r.columns; track $index) {
                    <th scope="col">{{ c.name }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of r.rows; track $index) {
                  <tr>
                    @for (cell of row; track $index) {
                      <td>{{ cell === null || cell === undefined ? '' : cell }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .pp {
      display: grid;
      gap: var(--mf-s3);
      min-width: 0;
      padding: var(--mf-s4);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
    }

    .pp__title {
      margin: 0;
      font-size: var(--mf-fs-lg);
    }

    .pp__samples {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--mf-s3);
    }

    .pp__field {
      display: grid;
      gap: var(--mf-s1);
      min-width: 0;
    }

    .pp__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s3);
      align-items: center;
    }

    .pp__hint {
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }

    .pp__live p {
      margin: 0;
    }

    .pp__ok {
      color: var(--mf-success);
    }

    .pp__bad,
    .pp__problems {
      color: var(--mf-danger);
    }

    .pp__problems {
      margin: 0;
      padding-left: var(--mf-s5);
    }

    .pp__sqlerror {
      margin: 0;
      padding: var(--mf-s3);
      overflow: auto;
      border-radius: var(--mf-radius);
      background: var(--mf-danger-bg);
      color: var(--mf-text);
      font-family: var(--mf-font-mono);
      white-space: pre-wrap;
    }

    .pp__table {
      max-width: 100%;
      overflow: auto;
    }
  `,
})
export class PreviewPanel {
  /** The parameters the query uses (not the unused ones). */
  readonly defs = input.required<readonly ParamDef[]>();
  readonly result = input<PreviewResponse | null>(null);
  readonly busy = input(false);
  /** Why a preview cannot run now ("Save the report first"); empty when it can. */
  readonly blocked = input('');
  readonly run = output<Record<string, unknown>>();

  protected readonly texts = signal<SampleTexts>({});
  protected readonly values = computed(() => sampleValuesOf(this.defs(), this.texts()));

  protected set(key: string, text: string): void {
    this.texts.update((all) => ({ ...all, [key]: text }));
  }

  protected hint(d: ParamDef): string {
    return d.type === 'multi' || (d.type === 'lookup' && d.lookupMulti)
      ? ' (separate with commas)'
      : '';
  }
}
