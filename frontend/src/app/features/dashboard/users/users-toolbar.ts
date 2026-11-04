import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { WorkloadPriority, WorkloadThresholds } from '../../../api/generated/api-client';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { SearchBox } from '../../../shared/ui/search-box';
import { Segmented } from '../../../shared/ui/segmented';
import { UsersFilterPopover } from './users-filter-popover';
import {
  AVAILABILITY_FILTERS,
  AVAILABILITY_LABELS,
  AvailabilityFilter,
  CLEARED_FILTERS,
  LAYOUTS,
  Layout,
  USER_SORTS,
  USER_SORT_LABELS,
  UserSort,
  UsersFilters,
  filterCount,
  isAvailabilityFilter,
  isUserSort,
} from './users-model';

/**
 * The toolbar of the Workload view (US-07, #1098), in the look of the shared list toolbar (theme guide 11.1): the view switch, a search box with its icon, ONE Filters button (Highest
 * priority, Availability and Sort, with the themed dropdowns), the "Sorted by" line with Reset sort, and at the right the cards or table switch, the legend (an info icon with an anchored
 * popover) and whatever the page projects as `mfBarEnd` (Assign work and the unassigned link). It owns no state: every choice is emitted and the tab writes it to the address (the filters) and
 * to the remembered choices (sort, view).
 */
@Component({
  selector: 'mf-users-toolbar',
  imports: [SearchBox, Dropdown, Segmented, UsersFilterPopover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = filters();
    <div class="bar" role="toolbar" aria-label="Team workload controls">
      <ng-content />
      <mf-search-box
        class="search"
        role="search"
        inputId="wl-q"
        label="Search by name"
        placeholder="Search by name"
        [hideLabel]="true"
        [hintOnFocus]="true"
        [leadingIcon]="true"
        [compact]="true"
        [value]="f.q"
        (searchChange)="filtersChange.emit({ q: $event })"
      />
      <mf-users-filter-popover [count]="count()" (cleared)="clear()">
        <div class="fl" data-filter="priority">
          <span>Highest priority</span>
          <mf-dropdown
            buttonId="wl-prio"
            label="Highest priority"
            [items]="priorityItems()"
            [value]="f.priority === null ? '' : '' + f.priority"
            (valueChange)="filtersChange.emit({ priority: num($event) })"
            [panelWidth]="240"
          />
        </div>
        <div class="fl" data-filter="availability">
          <span>Availability</span>
          <mf-dropdown
            buttonId="wl-avail"
            label="Availability"
            [items]="availabilityItems"
            [value]="f.availability"
            [neutralValue]="'all'"
            (valueChange)="onAvailability($event)"
            [panelWidth]="240"
          />
        </div>
        <div class="fl" data-sort>
          <span>Sort</span>
          <mf-dropdown
            buttonId="wl-sort"
            label="Sort"
            [items]="sortItems"
            [value]="sort()"
            [neutralValue]="null"
            (valueChange)="onSort($event)"
            [panelWidth]="240"
          />
        </div>
      </mf-users-filter-popover>
      <p class="sorted" data-sorted-line>
        <span class="st" data-sorted-text>Sorted by {{ sortLabels[sort()] }}</span>
        @if (sort() !== 'load') {
          <button
            type="button"
            class="mf-btn mf-btn--text"
            data-reset-sort
            (click)="sortChange.emit('load')"
          >
            Reset sort
          </button>
        }
      </p>
      <span class="grow"></span>
      <div mfSegmented role="group" aria-label="Layout" data-layout-group>
        @for (l of layouts; track l) {
          <button
            type="button"
            class="mf-btn mf-btn--icon"
            [attr.data-layout]="l"
            [attr.title]="
              l === 'cards' ? 'Cards: one card per person' : 'Table: one row per person'
            "
            [attr.aria-pressed]="layout() === l"
            [attr.aria-label]="l === 'cards' ? 'Layout: cards' : 'Layout: table'"
            (click)="layoutChange.emit(l)"
          >
            <i
              class="pi"
              [class]="l === 'cards' ? 'pi-id-card' : 'pi-table'"
              aria-hidden="true"
            ></i>
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    /* One row like the shared list toolbar (theme guide 11.1); it wraps by group on a narrow window. */
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .grow {
      flex: 1;
    }
    .search {
      min-width: 10rem;
      flex: 0 1 11rem;
    }
    .sorted {
      flex: 1 1 5rem;
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-width: 0;
      margin: 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .st {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (max-width: 560px) {
      .search {
        flex: 1 1 8rem;
      }
      .sorted {
        flex-basis: 100%;
      }
    }
  `,
})
export class UsersToolbar {
  protected readonly sorts = USER_SORTS;
  protected readonly sortLabels = USER_SORT_LABELS;
  protected readonly availabilities = AVAILABILITY_FILTERS;
  protected readonly availabilityLabels = AVAILABILITY_LABELS;
  protected readonly layouts = LAYOUTS;

  protected readonly availabilityItems: DropdownItem[] = AVAILABILITY_FILTERS.map((a) => ({
    value: a,
    label: AVAILABILITY_LABELS[a],
  }));
  protected readonly sortItems: DropdownItem[] = USER_SORTS.map((v) => ({
    value: v,
    label: USER_SORT_LABELS[v],
  }));
  protected readonly priorityItems = computed<DropdownItem[]>(() => [
    { value: '', label: 'Any priority' },
    ...this.priorities().map((p) => ({ value: String(p.priorityId), label: p.label })),
  ]);

  readonly filters = input.required<UsersFilters>();
  readonly sort = input<UserSort>('load');
  readonly layout = input<Layout>('cards');
  readonly priorities = input<readonly WorkloadPriority[]>([]);
  readonly thresholds = input<WorkloadThresholds | null>(null);

  readonly filtersChange = output<Partial<UsersFilters>>();
  readonly sortChange = output<UserSort>();
  readonly layoutChange = output<Layout>();

  protected readonly count = computed(() => filterCount(this.filters()));

  protected num(value: string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return value !== '' && Number.isInteger(n) && n > 0 ? n : null;
  }

  protected onSort(value: string): void {
    if (isUserSort(value)) this.sortChange.emit(value);
  }

  protected onAvailability(value: string): void {
    if (isAvailabilityFilter(value)) {
      this.filtersChange.emit({ availability: value as AvailabilityFilter });
    }
  }

  protected clear(): void {
    this.filtersChange.emit({ ...CLEARED_FILTERS });
  }
}
