import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { BarChart } from './bar-chart';
import { TYPE_STYLES } from './chart-palette';
import { ChartTable } from './chart-table';
import { ChartFormat, ChartKind, ChartRow, ChartSlice, plainFormat } from './chart-types';
import { PieChart } from './pie-chart';
import { MAX_SLICES, groupSlices } from './pie-geometry';

/** At most this many bars; the smaller rows are added up as one "Other" bar (the table always lists every row). */
export const MAX_BARS = 25;

/**
 * A result as a table first, then a Pie or a Bar on request, with a way back ("Show as table"): the pattern of the report builder and the Data tab.
 * The chart components are loaded only when someone asks for them. A pie needs values of zero or more and shows at most eight slices (the rest are
 * combined as "Other", said on screen); a bar shows at most 25. Every view carries the same numbers; the table is the accessible alternative.
 */
@Component({
  selector: 'mf-chart-panel',
  imports: [BarChart, ChartTable, PieChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel" data-chart-panel>
      <div class="bar-row">
        <div class="group" role="group" aria-label="Show the result as">
          <button
            type="button"
            class="mf-btn"
            [class.mf-btn--primary]="kind() === 'table'"
            [attr.aria-pressed]="kind() === 'table'"
            (click)="kind.set('table')"
            data-show-table
          >
            Table
          </button>
          <button
            type="button"
            class="mf-btn"
            [class.mf-btn--primary]="kind() === 'pie'"
            [attr.aria-pressed]="kind() === 'pie'"
            [disabled]="!chartable()"
            (click)="kind.set('pie')"
            data-show-pie
          >
            Pie
          </button>
          <button
            type="button"
            class="mf-btn"
            [class.mf-btn--primary]="kind() === 'bar'"
            [attr.aria-pressed]="kind() === 'bar'"
            [disabled]="!chartable()"
            (click)="kind.set('bar')"
            data-show-bar
          >
            Bar
          </button>
        </div>
        @if (!chartable() && rows().length > 0) {
          <p class="note" data-chart-unavailable>
            Charts need values of zero or more and at least one value above zero. The table shows
            every row.
          </p>
        }
      </div>

      @switch (effectiveKind()) {
        @case ('pie') {
          @defer (when effectiveKind() === 'pie') {
            <mf-pie-chart
              [heading]="heading()"
              [slices]="slices()"
              [emptyText]="emptyText()"
              [unit]="unit()"
              [format]="format()"
              [patterns]="true"
            />
          } @placeholder {
            <p class="note">Loading the chart.</p>
          }
          @if (pieGrouped()) {
            <p class="note" data-pie-other>
              The pie shows the largest {{ maxSlices - 1 }} rows; the others are combined as Other.
              The table lists every row.
            </p>
          }
        }
        @case ('bar') {
          @defer (when effectiveKind() === 'bar') {
            <mf-bar-chart
              [heading]="heading()"
              [rows]="barRows()"
              [emptyText]="emptyText()"
              [unit]="unit()"
              [format]="format()"
            />
          } @placeholder {
            <p class="note">Loading the chart.</p>
          }
          @if (barsGrouped()) {
            <p class="note" data-bar-other>
              The bars show the largest {{ maxBars - 1 }} rows; the others are combined as Other.
              The table lists every row.
            </p>
          }
        }
        @default {
          <mf-chart-table
            [caption]="heading()"
            [rows]="rows()"
            [labelHeader]="labelHeader()"
            [valueHeader]="valueHeader()"
            [emptyText]="emptyText()"
            [format]="format()"
            [showShare]="showShare()"
            [totalLabel]="totalLabel()"
          />
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .panel {
        display: grid;
        gap: var(--mf-s3);
        min-width: 0;
      }
      .bar-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--mf-s2) var(--mf-s3);
      }
      .group {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--mf-s1);
      }
      .note {
        margin: 0;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
    `,
  ],
})
export class ChartPanel {
  readonly heading = input.required<string>();
  readonly rows = input.required<readonly ChartRow[]>();
  readonly labelHeader = input('Group');
  readonly valueHeader = input('Value');
  /** What the values count ("assets", "GB"). */
  readonly unit = input('');
  readonly emptyText = input('Nothing to show.');
  readonly format = input<ChartFormat>(plainFormat);
  readonly showShare = input(false);
  readonly totalLabel = input('Total');
  /** What is shown; the table until someone picks a chart. */
  readonly kind = model<ChartKind>('table');

  protected readonly maxSlices = MAX_SLICES;
  protected readonly maxBars = MAX_BARS;

  /** Charts need non-negative values with something above zero. */
  protected readonly chartable = computed(() => {
    const values = this.rows().map((r) => r.value);
    return values.length > 0 && values.every((v) => v >= 0) && values.some((v) => v > 0);
  });

  protected readonly effectiveKind = computed<ChartKind>(() =>
    this.kind() !== 'table' && !this.chartable() ? 'table' : this.kind(),
  );

  protected readonly slices = computed<ChartSlice[]>(() => {
    const all: ChartSlice[] = this.rows()
      .filter((r) => r.value > 0)
      .map((r, i) => ({
        label: r.label,
        count: r.value,
        link: r.link ?? null,
        fill: TYPE_STYLES[i % TYPE_STYLES.length].color,
        outline: null,
      }));
    return groupSlices(all, (total) => ({
      label: 'Other',
      count: total.count,
      link: null,
      fill: 'var(--mf-border-strong)',
      outline: 'var(--mf-text-muted)',
    }));
  });

  protected readonly pieGrouped = computed(
    () => this.rows().filter((r) => r.value > 0).length > MAX_SLICES,
  );

  protected readonly barRows = computed<ChartRow[]>(() => {
    const rows = this.rows();
    if (rows.length <= MAX_BARS) return [...rows];
    const ranked = rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.value - a.r.value || a.i - b.i);
    const keep = new Set(ranked.slice(0, MAX_BARS - 1).map((x) => x.i));
    const rest = rows.filter((_, i) => !keep.has(i));
    return [
      ...rows.filter((_, i) => keep.has(i)),
      { label: 'Other', value: rest.reduce((n, r) => n + r.value, 0), link: null },
    ];
  });

  protected readonly barsGrouped = computed(() => this.rows().length > MAX_BARS);
}
