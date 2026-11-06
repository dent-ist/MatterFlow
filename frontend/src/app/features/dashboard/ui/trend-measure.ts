import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';

export interface MeasureOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The measure control of one Trends panel (`mf-trend-measure`): the shared dropdown with the prefix "Measure:" (D-14; the flows panel has five
 * measures, more than the 2 to 4 of the segmented switch, D-16, and its equal segments would not fit the 712 px panel at 1366). Both panels use it so the tab has one
 * control. With a single option it is just the name of that option. Generic over the option values; the tab owns the state machine (see `normalizeChoice`).
 */
@Component({
  selector: 'mf-trend-measure',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length === 1) {
      <span class="single" [attr.data-measure-single]="panel()">{{ options()[0].label }}</span>
    } @else {
      <mf-dropdown
        prefix="Measure:"
        [label]="label()"
        [attr.data-measure-select]="panel()"
        [items]="items()"
        [value]="value()"
        [neutralValue]="null"
        (valueChange)="valueChange.emit($event)"
      />
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
    }
    .single {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
  `,
})
export class TrendMeasure {
  readonly panel = input.required<string>();
  /** Accessible name of the group, e.g. "Measure of the flows panel". */
  readonly label = input.required<string>();
  readonly options = input.required<readonly MeasureOption<string>[]>();
  readonly value = input.required<string>();
  readonly valueChange = output<string>();

  protected readonly items = computed<DropdownItem[]>(() =>
    this.options().map((o) => ({ value: o.value, label: o.label })),
  );
}
