import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Dropdown, DropdownItem } from '../../../shared/ui/dropdown';
import { SearchBox } from '../../../shared/ui/search-box';
import { Segmented } from '../../../shared/ui/segmented';
import {
  LAYOUTS,
  Layout,
  SORT_MENU,
  USER_SORT_LABELS,
  UserSort,
  UsersFilters,
  isUserSort,
} from './users-model';

/**
 * The toolbar of the Workload view (US-07, #1098), in the look of the shared list toolbar (theme guide 11.1): the view switch, a search box with its icon, ONE Sort dropdown (Availability and load, Name, Open tasks, Overdue, Next due; US-11 removed the Filters button), the "Sorted by" line with Reset sort, and at the right the cards or table switch. It owns no state: every choice is emitted and the tab writes it to the address (the filters) and
 * to the remembered choices (sort, view).
 */
@Component({
  selector: 'mf-users-toolbar',
  imports: [SearchBox, Dropdown, Segmented],
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
      <mf-dropdown
        class="sortdd"
        buttonId="wl-sort"
        label="Sort"
        prefix="Sort:"
        data-sort
        [items]="sortItems()"
        [value]="sort()"
        [neutralValue]="'load'"
        [panelWidth]="240"
        (valueChange)="onSort($event)"
      />
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
    /* One control height on all three views (the shared token): the search box, the switches, the dropdowns and the icon buttons are the same height. */
    .bar .mf-btn {
      min-height: var(--mf-ctl-h);
    }
    /* Wide enough for the whole placeholder "Search by name" at 1366 px (#1126). */
    .search {
      min-width: 12rem;
      flex: 0 1 14rem;
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
  protected readonly sortLabels = USER_SORT_LABELS;
  protected readonly layouts = LAYOUTS;

  /** The five sorts of the menu; a sort chosen from a table header (Highest priority, Fewest open tasks) is added while it is the current one. */
  protected readonly sortItems = computed<DropdownItem[]>(() => {
    const keys: readonly UserSort[] = SORT_MENU.includes(this.sort())
      ? SORT_MENU
      : [...SORT_MENU, this.sort()];
    return keys.map((v) => ({ value: v, label: USER_SORT_LABELS[v] }));
  });

  readonly sort = input<UserSort>('load');
  readonly layout = input<Layout>('cards');
  readonly filters = input.required<UsersFilters>();

  readonly filtersChange = output<Partial<UsersFilters>>();
  readonly sortChange = output<UserSort>();
  readonly layoutChange = output<Layout>();

  protected onSort(value: string): void {
    if (isUserSort(value)) this.sortChange.emit(value);
  }
}
