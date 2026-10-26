import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TYPE_STYLES } from './chart-palette';
import { ChartFormat, ChartRow, plainFormat } from './chart-types';

/**
 * Horizontal bars of one measure (hand-built, no chart library; lazy): a label, a bar whose length is the value on a common scale, and the value written
 * at the bar's end (direct labels, so nothing is read off an axis). The bars are decoration; the rows are real text a screen reader walks, and a row can
 * be a link. One series, so one colour: the category is told apart by its label, not by colour. Values must be zero or more.
 */
@Component({
  selector: 'mf-bar-chart',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      <p class="empty" data-bars-empty>{{ emptyText() }}</p>
    } @else {
      <ul class="bars" [attr.aria-label]="heading() + ', bar chart'" data-bars>
        @for (row of rows(); track $index) {
          <li class="bar" data-bar>
            @if (row.link; as l) {
              <a
                class="label link"
                [routerLink]="l.commands"
                [queryParams]="l.queryParams"
                [attr.title]="row.label"
                [attr.aria-label]="row.label + ': ' + fmt(row.value) + ' ' + unit()"
                >{{ row.label }}</a
              >
            } @else {
              <span class="label" [attr.title]="row.label">{{ row.label }}</span>
            }
            <span class="track" aria-hidden="true"
              ><span class="fill" [style.width.%]="width(row.value)"></span
            ></span>
            <span class="value">{{ fmt(row.value) }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        container-type: inline-size;
      }
      .empty {
        margin: 0;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      .bars {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: var(--mf-s1);
      }
      .bar {
        display: grid;
        grid-template-columns: minmax(6rem, 11rem) minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--mf-s2);
        min-height: 1.75rem;
      }
      .label {
        min-width: 0;
        font-size: var(--mf-fs-md);
        line-height: 1.25;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        color: var(--mf-text);
      }
      .link {
        text-decoration: underline;
        min-height: 24px;
      }
      .track {
        display: block;
        height: 1rem;
        background: var(--mf-surface-alt);
        border-radius: 2px;
      }
      .fill {
        display: block;
        height: 100%;
        min-width: 2px;
        border-radius: 2px;
        background: var(--bar-colour);
        border: 1px solid var(--mf-text);
        box-sizing: border-box;
      }
      .value {
        min-width: 3rem;
        text-align: right;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      /* A phone: the label sits over its bar so the bar keeps the width. */
      @container (max-width: 26rem) {
        .bar {
          grid-template-columns: minmax(0, 1fr) auto;
          row-gap: 2px;
        }
        .label {
          grid-column: 1 / -1;
        }
        .track {
          grid-column: 1;
        }
      }
      @media (forced-colors: active) {
        .fill {
          forced-color-adjust: none;
          background: CanvasText;
        }
        .track {
          border: 1px solid CanvasText;
        }
      }
    `,
  ],
  host: { '[style.--bar-colour]': 'colour' },
})
export class BarChart {
  readonly heading = input.required<string>();
  readonly rows = input.required<readonly ChartRow[]>();
  readonly emptyText = input('Nothing to show.');
  /** What the values count ("assets", "GB"), for the accessible name of a linked row. */
  readonly unit = input('');
  readonly format = input<ChartFormat>(plainFormat);

  protected readonly colour = TYPE_STYLES[0].color;
  private readonly max = computed(() => Math.max(0, ...this.rows().map((r) => r.value)));

  protected width(value: number): number {
    const max = this.max();
    return max > 0 && value > 0 ? Math.max(0.5, (value / max) * 100) : 0;
  }

  protected fmt(value: number): string {
    return this.format()(value);
  }
}
