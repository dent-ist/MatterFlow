import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FiltersToggle } from '../ui/column-filters';
import { ListFilters } from './list-filters';

/**
 * The Filters button of a record list (Clients, Matters, Projects), placed in the page header's action slot (WP8 #270) so the grid does not
 * lose a toolbar row to one button:
 *
 *   <mf-page-header heading="Clients">
 *     <mf-list-filters-button mfActions [filters]="filters" controls="client-filter-row" [clearAlso]="['q']" />
 *     <p-button mfActions label="New client" ... />
 *   </mf-page-header>
 *   <mf-filters-bar [bare]="true" [filters]="filters" ... />
 *
 * While the filter row is open the button is preceded by the one "Clear filters" link (the inputs show the values, there are no chips);
 * while it is closed, or in the sheet, "Clear filters" sits with the chips in the bar (`mf-filters-bar [bare]`).
 */
@Component({
  selector: 'mf-list-filters-button',
  imports: [FiltersToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'lfb' },
  template: `
    @if (clearHere()) {
      <button
        type="button"
        class="mf-btn mf-btn--text"
        data-clear-filters
        (click)="filters().clear(clearAlso())"
      >
        Clear filters
      </button>
    }
    <mf-filters-toggle
      [controls]="filters().sheetMode() ? '' : controls()"
      [open]="filters().toggleOpen()"
      [count]="filters().activeCount()"
      [sheet]="filters().sheetMode()"
      (toggled)="filters().toggle()"
    />
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
  `,
})
export class ListFiltersButton {
  readonly filters = input.required<ListFilters>();
  /** Id of the filter row (the button's `aria-controls`). */
  readonly controls = input('');
  /** Legacy parameters that Clear filters drops too. */
  readonly clearAlso = input<readonly string[]>([]);

  protected readonly clearHere = computed(() => {
    const f = this.filters();
    return f.rowVisible() && f.activeCount() > 0 && !f.emptyClear();
  });
}
