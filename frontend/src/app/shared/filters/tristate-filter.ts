import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Tri-state column filter: a native select with Any / Yes / No in domain wording ("Overdue only", "Not overdue"). The value is `''`
 * (any), `'true'` or `'false'`; it applies on change.
 */
@Component({
  selector: 'mf-column-tristate-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select
      class="mf-control mf-control--compact ts"
      [attr.aria-label]="'Filter by ' + label()"
      [attr.data-filter]="key() || label()"
      [disabled]="disabled()"
      (change)="valueChange.emit($any($event.target).value)"
    >
      <option value="" [selected]="value() === ''">{{ anyLabel() }}</option>
      <option value="true" [selected]="value() === 'true'">{{ yesLabel() }}</option>
      <option value="false" [selected]="value() === 'false'">{{ noLabel() }}</option>
    </select>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .ts {
      width: 100%;
      min-width: 0;
      font-weight: 400;
    }
  `,
})
export class ColumnTristateFilter {
  readonly label = input.required<string>();
  readonly key = input('');
  readonly value = input('');
  readonly anyLabel = input('Any');
  readonly yesLabel = input('Yes');
  readonly noLabel = input('No');
  readonly disabled = input(false);
  readonly valueChange = output<string>();
}
