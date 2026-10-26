import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { sharePercent } from './pie-geometry';
import { ChartFormat, ChartRow, plainFormat } from './chart-types';

/**
 * The table alternative of every chart ("Show as table"): a real table with a caption, header cells with scope, the value as text and, optionally,
 * the share and a total row. On a narrow screen it scrolls inside its own labelled region (never the page). A row label can be a link.
 */
@Component({
  selector: 'mf-chart-table',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length === 0) {
      <p class="empty" data-table-empty>{{ emptyText() }}</p>
    } @else {
      <div class="scroll" role="region" [attr.aria-label]="caption()" tabindex="0">
        <table class="ct" data-chart-table>
          <caption class="mf-sr-only">
            {{
              caption()
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ labelHeader() }}</th>
              <th scope="col" class="num">{{ valueHeader() }}</th>
              @if (showShare()) {
                <th scope="col" class="num">Share</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track $index) {
              <tr>
                <th scope="row">
                  @if (row.link; as l) {
                    <a [routerLink]="l.commands" [queryParams]="l.queryParams">{{ row.label }}</a>
                  } @else {
                    {{ row.label }}
                  }
                </th>
                <td class="num">{{ fmt(row.value) }}</td>
                @if (showShare()) {
                  <td class="num">{{ share(row.value) }}</td>
                }
              </tr>
            }
          </tbody>
          @if (totalLabel(); as label) {
            <tfoot>
              <tr>
                <th scope="row">{{ label }}</th>
                <td class="num" data-table-total>{{ fmt(total()) }}</td>
                @if (showShare()) {
                  <td class="num">{{ total() > 0 ? '100%' : '0%' }}</td>
                }
              </tr>
            </tfoot>
          }
        </table>
      </div>
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
      .scroll {
        max-width: 100%;
        overflow-x: auto;
      }
      .ct {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--mf-fs-md);
      }
      th,
      td {
        padding: var(--mf-s2) var(--mf-s3);
        border-bottom: 1px solid var(--mf-border);
        text-align: left;
        vertical-align: top;
      }
      thead th {
        font-weight: 600;
        color: var(--mf-text-muted);
        font-size: var(--mf-fs-sm);
      }
      tbody th {
        font-weight: 400;
        overflow-wrap: anywhere;
      }
      tfoot th,
      tfoot td {
        font-weight: 700;
        border-top: 2px solid var(--mf-border-strong);
      }
      .num {
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class ChartTable {
  readonly caption = input.required<string>();
  readonly rows = input.required<readonly ChartRow[]>();
  readonly labelHeader = input('Group');
  readonly valueHeader = input('Value');
  readonly emptyText = input('Nothing to show.');
  readonly format = input<ChartFormat>(plainFormat);
  readonly showShare = input(false);
  /** The label of the total row; empty hides it (an average has no meaningful total). */
  readonly totalLabel = input<string>('Total');

  protected readonly total = computed(() => this.rows().reduce((n, r) => n + r.value, 0));

  protected fmt(value: number): string {
    return this.format()(value);
  }

  protected share(value: number): string {
    return sharePercent(value, this.total());
  }
}
