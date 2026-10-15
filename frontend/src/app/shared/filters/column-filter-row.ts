import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FilterControl } from './filter-control';
import { FilterDef } from './filter-def';
import { ListFilters } from './list-filters';

interface Cell {
  readonly column: string;
  readonly span: number;
  readonly defs: readonly FilterDef[];
}

/**
 * The second header row of a filtered grid (docs/ux/column-filters-review.md 4.1): one `<td>` per visible column with that column's
 * 32 px control, generated from the screen's `FilterDef[]`. A filter with `span` > 1 takes the cells of the columns it searches
 * ("Filter by Title or Ref"); several filters of one column stack; a column without a filter gets an empty cell. Filters whose column
 * is not shown get no cell (they show as chips and in "More filters"). Put it in the table head under the header row, only while
 * `filters.rowVisible()`:
 *
 *   <thead>
 *     <tr>...sortable headers...</tr>
 *     @if (filters.rowVisible()) {
 *       <tr mfColumnFilterRow id="my-filter-row" [filters]="filters" [columns]="['name', 'status']"></tr>
 *     }
 *   </thead>
 *
 * Its look (sticky under the 40 px header row, 40 px high) is `.mf-filter-row` in `styles/_fixed-page.scss`.
 */
@Component({
  // An attribute selector on the native <tr>, so the row keeps its table semantics.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'tr[mfColumnFilterRow]',
  imports: [FilterControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mf-filter-row', 'aria-label': 'Column filters', 'data-filter-row': '' },
  template: `
    @for (cell of cells(); track cell.column) {
      <td [attr.colspan]="cell.span > 1 ? cell.span : null">
        @for (d of cell.defs; track d.key) {
          <mf-filter-control [def]="d" [filters]="filters()" />
        }
      </td>
    }
  `,
  styles: `
    @media print {
      :host {
        display: none;
      }
    }
    td mf-filter-control + mf-filter-control {
      margin-top: var(--mf-s1);
    }
  `,
})
export class ColumnFilterRow {
  readonly filters = input.required<ListFilters>();
  /** Keys of the columns on screen, in order. */
  readonly columns = input.required<readonly string[]>();

  protected readonly cells = computed<Cell[]>(() => {
    const defs = this.filters().defs();
    const out: Cell[] = [];
    const cols = this.columns();
    for (let i = 0; i < cols.length; i++) {
      const own = defs.filter((d) => d.column === cols[i] && !d.noControl);
      const span = Math.max(1, ...own.map((d) => Math.min(d.span ?? 1, cols.length - i)));
      out.push({ column: cols[i], span, defs: own });
      i += span - 1;
    }
    return out;
  });
}
