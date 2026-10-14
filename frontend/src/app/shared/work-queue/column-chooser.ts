import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { WORK_COLUMNS, Density, normalizeColumns } from './column-prefs';

/** "Columns" and "Density" controls (UX 5.2): Ref and Title are always shown; the choice is remembered per user by the page. */
@Component({
  selector: 'mf-column-chooser',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cc">
      <button
        type="button"
        class="mf-btn cc-button"
        [attr.aria-controls]="open() ? 'cc-panel' : null"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        <i class="pi pi-table" aria-hidden="true"></i>
        Columns
      </button>
      @if (open()) {
        <div id="cc-panel" class="cc-panel" role="group" aria-label="Table columns and density">
          <fieldset class="cc-set">
            <legend>Columns</legend>
            @for (col of all; track col.key) {
              <label class="cc-check">
                <input
                  type="checkbox"
                  [checked]="col.locked || columns().includes(col.key)"
                  [disabled]="col.locked"
                  (change)="toggle(col.key)"
                />
                {{ col.label }}
                @if (col.locked) {
                  <span class="cc-note">(always shown)</span>
                }
              </label>
            }
          </fieldset>
          <fieldset class="cc-set">
            <legend>Density</legend>
            <label class="cc-check">
              <input
                type="radio"
                name="cc-density"
                [checked]="density() === 'comfortable'"
                (change)="densityChange.emit('comfortable')"
              />
              Comfortable
            </label>
            <label class="cc-check">
              <input
                type="radio"
                name="cc-density"
                [checked]="density() === 'compact'"
                (change)="densityChange.emit('compact')"
              />
              Compact
            </label>
          </fieldset>
        </div>
      }
    </div>
  `,
  styles: `
    .cc {
      position: relative;
    }
    .cc-panel {
      position: absolute;
      right: 0;
      z-index: 5;
      display: flex;
      gap: var(--mf-s5);
      margin-top: var(--mf-s1);
      padding: var(--mf-s4);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      background: var(--mf-surface);
      box-shadow: var(--mf-shadow-2);
    }
    .cc-set {
      display: grid;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      border: 0;
    }
    .cc-set legend {
      font-weight: 600;
    }
    .cc-check {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-target-min);
      white-space: nowrap;
    }
    .cc-note {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
    }
  `,
})
export class ColumnChooser {
  readonly columns = input.required<readonly string[]>();
  readonly density = input<Density>('comfortable');

  readonly columnsChange = output<string[]>();
  readonly densityChange = output<Density>();

  protected readonly all = WORK_COLUMNS;
  protected readonly open = signal(false);

  protected toggle(key: string): void {
    const current = this.columns();
    this.columnsChange.emit(
      normalizeColumns(
        current.includes(key) ? current.filter((c) => c !== key) : [...current, key],
      ),
    );
  }
}
