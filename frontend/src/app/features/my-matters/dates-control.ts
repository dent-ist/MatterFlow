import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MmFilters, MmRange, RANGE_LABELS } from './my-matters-filters';

/**
 * The date range of the Deadlines tab (issue #906): Today, Next 2 weeks, Next 4 weeks or a Custom From / To. It lives inside the tab, so the filter
 * bar above the tabs is the same on every tab and does not change shape when the tab does. The range is the page's one date state (in the address:
 * `range`, `from`, `to`); this control only reports a change. The ids keep their old names (`mm-range`, `mm-from`, `mm-to`).
 */
@Component({
  selector: 'mf-mm-dates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      margin: 0 0 var(--mf-s3);
    }
    .dc {
      --mf-fb-h: var(--mf-row-h-compact);
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s3) var(--mf-s4);
    }
    .dc__field {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    /* The same label style as the Client and Role filters (issue #899). */
    .dc__field label {
      color: var(--mf-text);
      font-size: var(--mf-fs-md);
      font-weight: 600;
      line-height: 1.4;
    }
    .dc__select {
      min-width: 9rem;
      max-width: 22rem;
    }
    .dc select,
    .dc input {
      box-sizing: border-box;
      height: var(--mf-fb-h);
      min-height: var(--mf-fb-h);
    }
    @media (max-width: 639.98px) {
      .dc {
        --mf-fb-h: 44px;
      }
      .dc__field,
      .dc__select {
        width: 100%;
        max-width: none;
      }
    }
  `,
  template: `
    <div class="dc" data-mm-dates>
      <div class="dc__field">
        <label for="mm-range">Dates</label>
        <select
          id="mm-range"
          class="mf-control mf-control--compact dc__select"
          data-filter="range"
          [value]="filters().range"
          (change)="rangePicked($any($event.target).value)"
        >
          @for (r of ranges; track r) {
            <option [value]="r" [selected]="r === filters().range">{{ labels[r] }}</option>
          }
        </select>
      </div>
      @if (filters().range === 'custom') {
        <div class="dc__field">
          <label for="mm-from">From</label>
          <input
            id="mm-from"
            type="date"
            class="mf-control mf-control--compact"
            data-filter="from"
            [value]="filters().from ?? ''"
            (change)="filterChange.emit({ from: $any($event.target).value || null })"
          />
        </div>
        <div class="dc__field">
          <label for="mm-to">To</label>
          <input
            id="mm-to"
            type="date"
            class="mf-control mf-control--compact"
            data-filter="to"
            [value]="filters().to ?? ''"
            (change)="filterChange.emit({ to: $any($event.target).value || null })"
          />
        </div>
      }
    </div>
  `,
})
export class MmDatesControl {
  readonly filters = input.required<MmFilters>();
  readonly filterChange = output<Partial<MmFilters>>();

  protected readonly ranges: MmRange[] = ['today', '2w', '4w', 'custom'];
  protected readonly labels = RANGE_LABELS;

  protected rangePicked(value: MmRange): void {
    this.filterChange.emit(
      value === 'custom' ? { range: value } : { range: value, from: null, to: null },
    );
  }
}
