import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';

let nextId = 0;

export interface MeasureOption<T extends string> {
  value: T;
  label: string;
}

/**
 * The measure control of one Trends panel (`mf-trend-measure`): a segmented control (a native radio group, so the arrow keys move through
 * it and Tab leaves it) that becomes the shared dropdown below 600 px. The selected segment is bold with a check mark, never colour alone. With a single
 * option it is just the name of that option. Generic over the option values; the tab owns the state machine (see `normalizeChoice`).
 */
@Component({
  selector: 'mf-trend-measure',
  imports: [Dropdown],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length === 1) {
      <span class="single" [attr.data-measure-single]="panel()">{{ options()[0].label }}</span>
    } @else {
      <div class="seg" role="radiogroup" [attr.aria-label]="label()" [attr.data-measure]="panel()">
        @for (o of options(); track o.value) {
          <label class="opt" [class.on]="o.value === value()">
            <input
              type="radio"
              [name]="id"
              [value]="o.value"
              [attr.data-measure-option]="o.value"
              [checked]="o.value === value()"
              (change)="valueChange.emit(o.value)"
            />
            <span class="mark" aria-hidden="true">&#10003;</span>
            <span>{{ o.label }}</span>
          </label>
        }
      </div>
      <mf-dropdown
        class="select"
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
    .seg {
      display: inline-flex;
      flex-wrap: wrap;
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      overflow: hidden;
      background: var(--mf-surface);
    }
    .opt {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-height: var(--mf-target-min);
      padding: 0 var(--mf-s3);
      font-size: var(--mf-fs-sm);
      cursor: pointer;
      white-space: nowrap;
    }
    .opt + .opt {
      border-left: 1px solid var(--mf-border);
    }
    .opt:hover {
      background: var(--mf-surface-alt);
    }
    .opt input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      opacity: 0;
      cursor: pointer;
    }
    .opt:has(input:focus-visible) {
      outline: 2px solid var(--mf-focus, var(--mf-primary));
      outline-offset: -2px;
    }
    .opt.on {
      font-weight: 700;
      background: var(--mf-surface-alt);
      box-shadow: inset 0 -3px 0 var(--mf-primary);
    }
    .mark {
      display: none;
      margin-right: 0.35em;
    }
    .opt.on .mark {
      display: inline;
    }
    .select {
      display: none;
    }
    @media (max-width: 599.98px) {
      .seg {
        display: none;
      }
      .select {
        display: inline-block;
      }
    }
  `,
})
export class TrendMeasure {
  protected readonly id = `mf-trend-measure-${nextId++}`;

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
