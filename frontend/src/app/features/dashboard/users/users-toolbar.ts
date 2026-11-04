import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { WorkloadPriority, WorkloadThresholds } from '../../../api/generated/api-client';
import { SearchBox } from '../../../shared/ui/search-box';
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
 * The toolbar of the Users tab: search by name, highest priority, availability and sort, then icon buttons: clear filters, tile size, the
 * cards or table view and the legend (six states, one line each). It owns no state: every choice is emitted and the tab writes it to the address (the
 * filters) and to the remembered choices (sort, view).
 */
@Component({
  selector: 'mf-users-toolbar',
  imports: [SearchBox],
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
        [value]="f.q"
        (searchChange)="filtersChange.emit({ q: $event })"
      />
      <div class="fld">
        <label class="lbl" for="wl-prio">Highest priority</label>
        <select
          id="wl-prio"
          class="mf-control mf-control--compact"
          data-filter="priority"
          (change)="filtersChange.emit({ priority: num($any($event.target).value) })"
        >
          <option value="">Any priority</option>
          @for (p of priorities(); track p.priorityId) {
            <option [value]="p.priorityId" [selected]="f.priority === p.priorityId">
              {{ p.label }}
            </option>
          }
        </select>
      </div>
      <div class="fld">
        <label class="lbl" for="wl-avail">Availability</label>
        <select
          id="wl-avail"
          class="mf-control mf-control--compact"
          data-filter="availability"
          [value]="f.availability"
          (change)="onAvailability($any($event.target).value)"
        >
          @for (a of availabilities; track a) {
            <option [value]="a" [selected]="a === f.availability">
              {{ availabilityLabels[a] }}
            </option>
          }
        </select>
      </div>
      <div class="fld">
        <label class="lbl" for="wl-sort">Sort</label>
        <select
          id="wl-sort"
          class="mf-control mf-control--compact"
          data-sort
          [value]="sort()"
          (change)="onSort($any($event.target).value)"
        >
          @for (s of sorts; track s) {
            <option [value]="s" [selected]="s === sort()">{{ sortLabels[s] }}</option>
          }
        </select>
      </div>
      <span class="grow"></span>
      <span class="tools">
        @if (count() > 0) {
          <button
            type="button"
            class="mf-btn mf-btn--icon tip clear"
            data-clear-filters
            [attr.data-tip]="'Clear filters (' + count() + ')'"
            [attr.aria-label]="'Clear filters (' + count() + ')'"
            (click)="clear()"
          >
            <i class="pi pi-filter-slash" aria-hidden="true"></i>
            <span class="badge" aria-hidden="true">{{ count() }}</span>
          </button>
        }
        <span class="pair" role="group" aria-label="Layout" data-layout-group>
          @for (l of layouts; track l) {
            <button
              type="button"
              class="mf-btn mf-btn--icon tip toggle"
              [attr.data-layout]="l"
              [attr.data-tip]="
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
        </span>
        <button
          type="button"
          class="mf-btn tip toggle legend-btn"
          data-legend-toggle
          data-tip="Legend and help"
          aria-label="Legend and help"
          [attr.aria-pressed]="legendOpen()"
          [attr.aria-expanded]="legendOpen()"
          [attr.aria-controls]="legendOpen() ? 'wl-legend' : null"
          (click)="legendOpen.set(!legendOpen())"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
          <span class="legend-word" aria-hidden="true">Legend</span>
        </button>
      </span>
    </div>

    @if (legendOpen()) {
      <section id="wl-legend" class="legend" aria-label="Legend and help" data-legend>
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
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    /* The shared list toolbar standard (theme guide 11.1): one row, labels in line with their controls. */
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .fld {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
    }
    .lbl {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }
    .grow {
      flex: 1;
    }
    .search {
      min-width: 10rem;
      flex: 0 1 11rem;
    }
    .pair {
      display: inline-flex;
      gap: var(--mf-s1);
    }
    .mf-btn {
      min-height: 32px;
    }
    .mf-btn--icon {
      min-width: 32px;
    }
    /* A text tooltip on hover and on keyboard focus (a title shows on hover only). */
    .tip {
      position: relative;
    }
    .tip[data-tip]:hover::after,
    .tip[data-tip]:focus-visible::after {
      content: attr(data-tip);
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 30;
      padding: 3px var(--mf-s2);
      color: var(--mf-surface);
      background: var(--mf-text);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-xs);
      font-weight: 400;
      white-space: nowrap;
      pointer-events: none;
    }
    .legend-btn {
      gap: 6px;
      padding: 0 var(--mf-s2);
    }
    .legend-word {
      display: none;
    }
    @media (min-width: 1100px) {
      .legend-word {
        display: inline;
      }
    }
    .tools {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--mf-s2);
    }
    .fld select {
      max-width: 13rem;
    }
    .toggle[aria-pressed='true'],
    .toggle[aria-expanded='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
    }
    .mf-btn:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: 1px;
    }
    .clear {
      position: relative;
    }
    .badge {
      position: absolute;
      top: -6px;
      right: -6px;
      min-width: 16px;
      padding: 0 3px;
      color: #fff;
      background: var(--mf-primary);
      border-radius: 8px;
      font-size: 0.65rem;
      line-height: 16px;
      text-align: center;
    }
    /* The search input is as tall as the other (compact) controls on the line. */
    .search ::ng-deep .sb__input {
      min-height: var(--mf-row-h-compact);
      height: var(--mf-row-h-compact);
      padding-block: 0;
    }
    /* A short list: six states, each with its chip and one line. It fits without scrolling on a laptop. */
    .legend {
      margin-top: var(--mf-s2);
      padding: var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .legend h3 {
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-md);
    }
    .states {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      gap: var(--mf-s2) var(--mf-s4);
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
      min-width: 7.5rem;
      min-height: 26px;
      padding: 0 var(--mf-s2);
      color: var(--mf-text);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
      white-space: nowrap;
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
    @media (max-width: 560px) {
      .search {
        flex-basis: 100%;
      }
      .fld {
        flex: 1 1 8rem;
      }
      .fld select {
        width: 100%;
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

  protected num(value: string): number | null {
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
