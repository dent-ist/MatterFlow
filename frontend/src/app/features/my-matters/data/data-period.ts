import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DataPeriod, PERIOD_LABELS } from '../data-selection';

/** The choice of the period control. */
export interface PeriodChoice {
  period: DataPeriod;
  from: string | null;
  to: string | null;
}

/**
 * "Period" of the selection bar (epic #893, issue #931): when the assets were added. A short list of ready periods and a custom range of two dates. The ready
 * periods are counted from today in the viewer's calendar by the page; the custom range is two plain dates.
 */
@Component({
  selector: 'mf-data-period',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: var(--mf-s2);
      min-width: 0;
    }
    .pp__field {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .pp__field label {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    @media (max-width: 639.98px) {
      :host,
      .pp__field {
        width: 100%;
      }
      .pp__field select,
      .pp__field input {
        min-height: 44px;
      }
    }
  `,
  template: `
    <div class="pp__field">
      <label for="dp-period">Period</label>
      <select
        id="dp-period"
        class="mf-control mf-control--compact"
        data-data-period
        (change)="pick($any($event.target).value)"
      >
        @for (p of periods; track p) {
          <option [value]="p" [selected]="p === period()">{{ labels[p] }}</option>
        }
      </select>
    </div>
    @if (period() === 'custom') {
      <div class="pp__field">
        <label for="dp-from">From</label>
        <input
          id="dp-from"
          type="date"
          class="mf-control mf-control--compact"
          data-data-from
          [value]="from() ?? ''"
          [max]="to() ?? ''"
          (change)="range($any($event.target).value, to())"
        />
      </div>
      <div class="pp__field">
        <label for="dp-to">To</label>
        <input
          id="dp-to"
          type="date"
          class="mf-control mf-control--compact"
          data-data-to
          [value]="to() ?? ''"
          [min]="from() ?? ''"
          (change)="range(from(), $any($event.target).value)"
        />
      </div>
    }
  `,
})
export class DataPeriodControl {
  readonly period = input.required<DataPeriod>();
  readonly from = input<string | null>(null);
  readonly to = input<string | null>(null);
  readonly changed = output<PeriodChoice>();

  protected readonly periods: readonly DataPeriod[] = ['all', '30d', '12m', 'year', 'custom'];
  protected readonly labels = PERIOD_LABELS;

  protected pick(value: string): void {
    const period = this.periods.find((p) => p === value) ?? 'all';
    this.changed.emit({
      period,
      from: period === 'custom' ? this.from() : null,
      to: period === 'custom' ? this.to() : null,
    });
  }

  protected range(from: string | null, to: string | null): void {
    this.changed.emit({ period: 'custom', from: from || null, to: to || null });
  }
}
