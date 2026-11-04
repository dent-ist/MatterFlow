import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { WorkloadPriority, WorkloadThresholds } from '../../../api/generated/api-client';
import { Dismissable } from '../../../shared/ui/dismissable';
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
  legendStates,
} from './users-model';

/**
 * The toolbar of the Workload view (US-07, #1098), in the look of the shared list toolbar (theme guide 11.1): the view switch, a search box with its icon, ONE Filters button (Highest
 * priority, Availability and Sort, with the themed dropdowns), the "Sorted by" line with Reset sort, and at the right the cards or table switch, the legend (an info icon with an anchored
 * popover) and whatever the page projects as `mfBarEnd` (Assign work and the unassigned link). It owns no state: every choice is emitted and the tab writes it to the address (the filters) and
 * to the remembered choices (sort, view).
 */
@Component({
  selector: 'mf-users-toolbar',
  imports: [SearchBox, Dropdown, Segmented, Dismissable, UsersFilterPopover],
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
      <span class="legend-wrap">
        <button
          #legendBtn
          type="button"
          class="mf-btn mf-btn--icon toggle"
          data-legend-toggle
          title="Legend and help"
          aria-label="Legend and help"
          aria-haspopup="dialog"
          [attr.aria-expanded]="legendOpen()"
          [attr.aria-controls]="legendOpen() ? 'wl-legend' : null"
          (click)="legendOpen.set(!legendOpen())"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
        @if (legendOpen()) {
          <section
            id="wl-legend"
            class="legend"
            role="dialog"
            aria-label="Legend and help"
            data-legend
            [mfDismissable]="legendBtn"
            (dismissed)="legendOpen.set(false)"
          >
            <h3>What the states mean</h3>
            <ul class="states" data-legend-states>
              @for (st of states(); track st.key) {
                <li [attr.data-state]="st.key">
                  <span class="chipk" [class]="'chipk chipk--' + st.key"
                    ><i class="pi" [class]="st.icon" aria-hidden="true"></i>{{ st.word }}</span
                  >&ngsp;<span class="line">{{ st.line }}</span>
                </li>
              }
            </ul>
          </section>
        }
      </span>
      <ng-content select="[mfBarEnd]" />
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
    /* Assign work and the unassigned link stay at the right end, also when they wrap to their own line. */
    :host ::ng-deep [mfBarEnd] {
      margin-left: auto;
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
    .legend-wrap {
      position: relative;
      display: inline-block;
    }
    .legend {
      position: absolute;
      top: calc(100% + var(--mf-s1));
      right: 0;
      z-index: 40;
      width: min(24rem, 90vw);
      padding: var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-pop);
    }
    .legend h3 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .states {
      display: grid;
      gap: var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .states li {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .chipk {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      box-sizing: border-box;
      min-width: 8rem;
      min-height: 28px;
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
    }
    .chipk .pi {
      font-size: var(--mf-icon-md);
    }
    .chipk--idle {
      background: color-mix(in srgb, var(--mf-success-bg) 45%, var(--mf-surface));
      border-color: var(--mf-success);
    }
    .chipk--light {
      background: var(--mf-info-bg);
    }
    .chipk--normal {
      background: color-mix(in srgb, var(--mf-info-bg) 55%, var(--mf-surface-alt));
    }
    .chipk--heavy {
      background: var(--mf-danger-bg);
      border-color: var(--mf-danger);
    }
    .chipk--heavy .pi {
      color: var(--mf-danger);
    }
    .chipk--out {
      border-style: dashed;
      background: repeating-linear-gradient(
        135deg,
        var(--mf-surface-alt) 0 5px,
        var(--mf-surface) 5px 10px
      );
    }
    .line {
      color: var(--mf-text);
      font-size: var(--mf-fs-sm);
    }
    .toggle[aria-expanded='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
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

  protected readonly legendOpen = signal(false);
  protected readonly count = computed(() => filterCount(this.filters()));
  /** The six states with their icon, chip and ONE line each; the load lines use the real thresholds. */
  protected readonly states = computed(() => legendStates(this.thresholds()));

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
