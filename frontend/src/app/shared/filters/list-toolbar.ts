import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FiltersToggle } from '../ui/column-filters';
import { SearchBox } from '../ui/search-box';
import { FilterChips, FilterNotice } from './filter-chips';
import { FocusFilter } from './focus-filter';
import { MoreFilters } from './filters-bar';
import { FilterSheet } from './filter-sheet';

let nextId = 0;

/**
 * The list toolbar (`mf-list-toolbar`, LC-01 #1038, decision AR): the zones under the title row of every list page, always in this order, a zone that a
 * page does not fill is left out and never moves the others (the anatomy of `docs/ux/grid-consistency/anatomy-mockup.html`, theme guide section 11).
 *
 *   Row 2  [Search tasks]  [Filters (2)]  [Other filters]  [view slot]  ......  [Columns]  [... menu]      (a bulk bar replaces the whole row)
 *   Row 3  chips ... Clear filters                                           Sorted by Name, A to Z  Reset sort
 *
 *   <mf-list-toolbar [filters]="filters" controls="client-filter-row" searchLabel="Search clients" [clearAlso]="['q']">
 *     <mf-quick-views mfView ... />            <!-- optional: quick-view chips or a View dropdown -->
 *     <mf-grid-columns mfColumns ... />        <!-- optional: the Columns menu, right end (hidden under 640 px) -->
 *     <mf-options-menu mfMore ...>...</mf-options-menu>   <!-- optional: the "..." menu: Export, Saved views -->
 *     <mf-sorted-line mfBarEnd ... />          <!-- the Sorted by line with Reset sort -->
 *     <p-button mfPrimary label="New Task" icon="pi pi-plus" />   <!-- a tab has no H1: its primary button ends row 2 -->
 *     <div mfBulk>3 selected ...</div>         <!-- shown instead of row 2 while `bulkActive` -->
 *     <mf-record-sort mfSheetSort ... />       <!-- the Sort select of the Filters sheet (phone) -->
 *   </mf-list-toolbar>
 *
 * Search is always visible and is not the global search: it drives the one text filter of the list that is marked `search: true` in its `FilterDef[]` (so the
 * page keeps the same query parameter, and saved views and links keep working). Filters opens the existing inline filter row (a sheet on a phone or when the
 * grid overflows); the chips with Clear filters show whenever a filter is active, with the row open or closed. The `/` shortcut (unchanged) focuses Search.
 * Also here, as in `mf-filters-bar`: the restored-view notice, the polite result announcement, the print line and the sheet.
 */
@Component({
  selector: 'mf-list-toolbar',
  imports: [FiltersToggle, FilterChips, FilterNotice, FilterSheet, MoreFilters, SearchBox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lt" data-grid-toolbar data-list-toolbar>
      @if (bulkActive()) {
        <ng-content select="[mfBulk]" />
      } @else {
        @if (searchDef(); as def) {
          <mf-search-box
            class="lt__search"
            data-list-search
            [inputId]="searchId"
            [label]="searchLabel()"
            [placeholder]="searchLabel()"
            [hideLabel]="true"
            [hintOnFocus]="true"
            [leadingIcon]="true"
            [compact]="true"
            [value]="filters().text(def.key)"
            (searchChange)="filters().set(def.key, $event, { replace: true })"
          />
        }
        <mf-filters-toggle
          class="lt__filters"
          [controls]="filters().sheetMode() ? '' : controls()"
          [open]="filters().toggleOpen()"
          [count]="filters().badgeCount()"
          [sheet]="filters().sheetMode()"
          (toggled)="filters().toggle()"
        />
        @if (filters().moreDefs().length > 0) {
          <mf-more-filters class="lt__other" [filters]="filters()" />
        }
        <ng-content select="[mfView]" />
        <span class="lt__tail">
          <span class="lt__cols"><ng-content select="[mfColumns]" /></span>
          <ng-content select="[mfMore]" />
          <ng-content select="[mfPrimary]" />
        </span>
      }
    </div>
    @if (rowThree()) {
      <div class="lt lt--row3" data-toolbar-row2>
        @if (filters().restored()) {
          <mf-filter-notice [filters]="filters()" />
        } @else {
          <div class="lt__chips">
            <mf-filter-chips
              [filters]="filters()"
              mode="all"
              (showColumn)="showColumn.emit($event)"
            />
          </div>
          @if (filters().activeCount() > 0 && !filters().emptyClear()) {
            <button
              type="button"
              class="mf-btn mf-btn--text"
              data-clear-filters
              (click)="filters().clear(clearAlso())"
            >
              Clear filters
            </button>
          }
        }
        <span class="lt__end"><ng-content select="[mfBarEnd]" /></span>
      </div>
    }
    <p class="lt__live" role="status" aria-live="polite" aria-atomic="true" data-filter-live>
      {{ filters().announcement() }}
    </p>
    @if (filters().printLine(); as line) {
      <p class="lt__print" data-filter-print>{{ line }}</p>
    }
    <mf-filter-sheet [filters]="filters()" [clearAlso]="clearAlso()">
      <ng-content select="[mfSheetSort]" ngProjectAs="[mfSheetSort]" />
      <ng-content select="[mfSheetFooter]" ngProjectAs="[mfSheetFooter]" />
    </mf-filter-sheet>
  `,
  styles: `
    :host {
      display: block;
    }
    .lt {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
      margin: 0 0 var(--mf-s2);
    }
    .lt__search {
      flex: 0 1 18rem;
      min-width: 11rem;
    }
    /* Columns, the "..." menu and the primary button of a tab: the right end of row 2 (it wraps as one piece, right aligned). */
    .lt__tail {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      margin-left: auto;
    }
    .lt__cols {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .lt__cols:empty {
      display: none;
    }
    /* The grid's own header band separates row 3 from the grid. */
    .lt--row3 {
      min-height: 28px;
      margin-bottom: var(--mf-s1);
    }
    .lt__chips {
      min-width: 0;
    }
    .lt__end {
      margin-left: auto;
    }
    /* A phone: Search and Filters (the sheet holds every filter and the Sort select); Columns and Other filters are not offered. */
    @media (width < 640px) {
      .lt__search {
        flex: 1 1 10rem;
      }
      .lt__cols,
      .lt__other {
        display: none;
      }
      /* Search, Filters and the "..." menu stay in the first row, the views take the second (a visual order only; every control keeps its tab order). */
      .lt__search {
        order: -3;
      }
      .lt__filters {
        order: -2;
      }
      .lt__tail {
        order: -1;
        margin-left: 0;
      }
    }
    .lt__live {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .lt__print {
      display: none;
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    @media print {
      .lt {
        display: none;
      }
      .lt__print {
        display: block;
      }
    }
  `,
})
export class ListToolbar extends FocusFilter {
  /** Id of the filter row (the Filters button's `aria-controls`). */
  readonly controls = input('');
  /** Legacy parameters that Clear filters drops too. */
  readonly clearAlso = input<readonly string[]>([]);
  /** "Search tasks": the placeholder and the accessible name of the Search box. */
  readonly searchLabel = input('Search');
  /** Rows are selected: the `[mfBulk]` bar replaces row 2. */
  readonly bulkActive = input(false);
  /** Row 3 is always there (it holds the Sorted by line); false for a list with no sort line. */
  readonly sortLine = input(true);
  /** A chip on a hidden column asks for the column back (the page owns the column chooser). */
  readonly showColumn = output<string>();

  protected readonly searchId = `mf-list-search-${nextId++}`;
  protected readonly searchDef = computed(() =>
    this.filters()
      .defs()
      .find((d) => d.search && !d.disabledReason?.()),
  );
  protected readonly rowThree = computed(() => {
    const f = this.filters();
    return this.sortLine() || f.restored() || f.chips().length > 0 || f.activeCount() > 0;
  });
}
