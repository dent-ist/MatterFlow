import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Dropdown, DropdownItem } from '../ui/dropdown';

/**
 * Tri-state column filter: a native select with Any / Yes / No in domain wording ("Overdue only", "Not overdue"). The value is `''`
 * (any), `'true'` or `'false'`; it applies on change.
 */
@Component({
  selector: 'mf-column-tristate-filter',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-dropdown
      class="ts"
      size="sm"
      [label]="'Filter by ' + label()"
      [attr.data-filter]="key() || label()"
      [items]="items()"
      [value]="value()"
      [disabled]="disabled()"
      [panelWidth]="180"
      (valueChange)="valueChange.emit($event)"
    />
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    /* The cell is sized by the column, never by the words of the choices: the control takes the room it is given and shortens its text. */
    .ts {
      display: block;
      width: 0;
      min-width: 100%;
      --mf-ctl-h-sm: 32px;
    }
    .ts ::ng-deep .btn {
      padding-inline: var(--mf-s2);
    }
    .ts ::ng-deep .val {
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
  /** Text before every choice ("Sensitive: "): for a control in the filter row that has no column header to name it. */
  readonly prefix = input('');
  readonly valueChange = output<string>();
  protected readonly items = computed<DropdownItem[]>(() => [
    { value: '', label: `${this.prefix()}${this.anyLabel()}` },
    { value: 'true', label: `${this.prefix()}${this.yesLabel()}` },
    { value: 'false', label: `${this.prefix()}${this.noLabel()}` },
  ]);
}
