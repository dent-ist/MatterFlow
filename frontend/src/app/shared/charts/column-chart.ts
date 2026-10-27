import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TYPE_STYLES } from './chart-palette';
import { ChartFormat, ChartRow, plainFormat } from './chart-types';

/**
 * Columns over time (hand-built, no chart library; lazy): one column per row, oldest first, the height on a common scale from zero, the value
 * of the last column and the largest value written out (direct labels, so nothing is read off an axis) and a label under about four of the columns
 * (always the last). The columns are decoration; a screen reader gets a one-sentence summary (first, last, largest) and the table next to the chart
 * ("Show as table") carries every number. One series, so one colour. Values must be zero or more. Epic #851, issue #871.
 */
@Component({
  selector: 'mf-column-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      <p class="empty" data-columns-empty>{{ emptyText() }}</p>
    } @else {
      <figure class="cc" data-columns [attr.aria-label]="heading() + ', column chart'" role="group">
        <p class="cc__summary mf-sr-only" data-columns-summary>{{ summary() }}</p>
        <div class="cc__top" aria-hidden="true">
          <span>Highest {{ fmt(max()) }}</span>
          <span>Now {{ fmt(last()) }}</span>
        </div>
        <ul class="cc__cols" aria-hidden="true" [style.height]="chartHeight()">
          @for (row of rows(); track $index) {
            <li class="cc__col" data-column [attr.title]="row.label + ': ' + fmt(row.value)">
              <span class="cc__bar" [style.height.%]="height(row.value)"></span>
              <span class="cc__label">{{ labelAt($index) }}</span>
            </li>
          }
        </ul>
      </figure>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .empty {
        margin: 0;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .cc {
        margin: 0;
        min-width: 0;
      }
      .cc__top {
        display: flex;
        justify-content: space-between;
        gap: var(--mf-s2);
        margin-bottom: var(--mf-s1);
        font-size: var(--mf-fs-sm);
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .cc__cols {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        align-items: end;
        gap: 2px;
        height: 9rem;
        margin: 0;
        padding: 0 0 1.5rem;
        list-style: none;
        border-bottom: 1px solid var(--mf-border-strong);
        position: relative;
      }
      .cc__col {
        position: relative;
        display: flex;
        align-items: flex-end;
        height: 100%;
        min-width: 0;
      }
      .cc__bar {
        display: block;
        width: 100%;
        min-height: 2px;
        box-sizing: border-box;
        background: var(--bar-colour);
        border: 1px solid var(--mf-text);
        border-bottom: 0;
        border-radius: 2px 2px 0 0;
      }
      .cc__label {
        position: absolute;
        bottom: -1.4rem;
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .cc__label:empty {
        display: none;
      }
      @media (forced-colors: active) {
        .cc__bar {
          forced-color-adjust: none;
          background: CanvasText;
        }
      }
    `,
  ],
  host: { '[style.--bar-colour]': 'colour' },
})
export class ColumnChart {
  readonly heading = input.required<string>();
  readonly rows = input.required<readonly ChartRow[]>();
  readonly emptyText = input('Nothing to show.');
  /** What the values count ("GB", "Items"), for the summary sentence. */
  readonly unit = input('');
  readonly format = input<ChartFormat>(plainFormat);
  /** The height of the columns (a CSS length); the default is the Data tab's. A small chart in a card passes less. */
  readonly chartHeight = input('9rem');
  /** The last sentence of the summary; a chart with no table beside it passes an empty one. */
  readonly tableHint = input('The table has every month.');

  protected readonly colour = TYPE_STYLES[0].color;
  protected readonly max = computed(() => Math.max(0, ...this.rows().map((r) => r.value)));
  protected readonly last = computed(() => this.rows().at(-1)?.value ?? 0);
  /** A label under about four columns (always the last), so labels never touch on a phone. */
  private readonly step = computed(() => Math.max(1, Math.ceil(this.rows().length / 4)));

  protected readonly summary = computed(() => {
    const rows = this.rows();
    if (rows.length === 0) return '';
    const first = rows[0];
    const end = rows[rows.length - 1];
    const peak = rows.reduce((p, r) => (r.value > p.value ? r : p), rows[0]);
    const unit = this.unit() ? ` ${this.unit()}` : '';
    return (
      `${this.heading()}: from ${first.label} (${this.fmt(first.value)}${unit}) to ${end.label} ` +
      `(${this.fmt(end.value)}${unit}); highest ${peak.label} (${this.fmt(peak.value)}${unit}).` +
      (this.tableHint() ? ` ${this.tableHint()}` : '')
    );
  });

  protected height(value: number): number {
    const max = this.max();
    return max > 0 && value > 0 ? Math.max(1, (value / max) * 100) : 0;
  }

  protected labelAt(index: number): string {
    const rows = this.rows();
    const fromEnd = rows.length - 1 - index;
    return fromEnd % this.step() === 0 ? rows[index].label : '';
  }

  protected fmt(value: number): string {
    return this.format()(value);
  }
}
