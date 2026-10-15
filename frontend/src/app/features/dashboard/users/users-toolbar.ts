import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { WorkloadPriority, WorkloadThresholds } from '../../../api/generated/api-client';
import { SearchBox } from '../../../shared/ui/search-box';
import { priorityColors } from '../../../shared/ui/priority-badge';
import {
  AVAILABILITY_FILTERS,
  AVAILABILITY_LABELS,
  AvailabilityFilter,
  DENSITIES,
  Density,
  LAYOUTS,
  Layout,
  USER_SORTS,
  USER_SORT_LABELS,
  UserSort,
  UsersFilters,
  filterCount,
  isAvailabilityFilter,
  isDensity,
  isUserSort,
  thresholdText,
} from './users-model';

export interface PodOption {
  id: number;
  label: string;
}

/**
 * The toolbar of the Users tab: sort, pod, availability, search by name, density, the cards or table view, Refresh and the legend (card
 * colours, load levels and what this view is not). It owns no state: every choice is emitted and the tab writes it to the address (the
 * filters) and to the remembered choices (sort, density, view).
 */
@Component({
  selector: 'mf-users-toolbar',
  imports: [SearchBox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = filters();
    <div class="bar" role="toolbar" aria-label="Team workload controls">
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
      @if (pods().length > 0 || f.pod !== null) {
        <div class="fld">
          <label class="lbl" for="wl-pod">Pod</label>
          <select
            id="wl-pod"
            class="mf-control mf-control--compact"
            data-filter="pod"
            (change)="filtersChange.emit({ pod: num($any($event.target).value) })"
          >
            <option value="">All pods</option>
            @for (p of pods(); track p.id) {
              <option [value]="p.id" [selected]="f.pod === p.id">{{ p.label }}</option>
            }
          </select>
        </div>
      }
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
        <label class="lbl" for="wl-density">Density</label>
        <select
          id="wl-density"
          class="mf-control mf-control--compact"
          data-density
          [value]="density()"
          (change)="onDensity($any($event.target).value)"
        >
          @for (d of densities; track d) {
            <option [value]="d" [selected]="d === density()">
              {{ d === 'compact' ? 'Compact' : 'Comfortable' }}
            </option>
          }
        </select>
      </div>
      <span class="pair" role="group" aria-label="View">
        @for (l of layouts; track l) {
          <button
            type="button"
            class="mf-btn toggle"
            [attr.data-layout]="l"
            [attr.aria-pressed]="layout() === l"
            (click)="layoutChange.emit(l)"
          >
            <i
              class="pi"
              [class]="l === 'cards' ? 'pi-th-large' : 'pi-list'"
              aria-hidden="true"
            ></i>
            {{ l === 'cards' ? 'Cards' : 'Table' }}
          </button>
        }
      </span>
      @if (count() > 0) {
        <button type="button" class="mf-btn mf-btn--text" data-clear-filters (click)="clear()">
          Clear filters ({{ count() }})
        </button>
      }
      <span class="grow"></span>
      @if (updated(); as u) {
        <span class="updated" data-updated>Updated {{ u }}</span>
      }
      <button
        type="button"
        class="mf-btn"
        data-legend-toggle
        [attr.aria-expanded]="legendOpen()"
        [attr.aria-controls]="legendOpen() ? 'wl-legend' : null"
        (click)="legendOpen.set(!legendOpen())"
      >
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        Legend and help
      </button>
      <button
        type="button"
        class="mf-btn"
        data-refresh-users
        [attr.aria-disabled]="refreshing() ? 'true' : null"
        [attr.aria-busy]="refreshing() ? 'true' : null"
        (click)="refresh.emit()"
      >
        <i
          class="pi"
          [class]="refreshing() ? 'pi-spin pi-spinner' : 'pi-refresh'"
          aria-hidden="true"
        ></i>
        Refresh
      </button>
    </div>

    @if (legendOpen()) {
      <section id="wl-legend" class="legend" aria-label="Legend and help" data-legend>
        <div>
          <h3>Card colour</h3>
          <p class="small">
            The top band shows the highest priority among the person's open tasks. It always says it
            in words too.
          </p>
          <ul class="swatches">
            @for (p of priorities(); track p.priorityId) {
              <li>
                <span
                  class="swatch"
                  [style.background]="colorsOf(p.color).bg"
                  [style.color]="colorsOf(p.color).fg"
                  >Highest priority: {{ p.label }}</span
                >
              </li>
            }
            <li>
              <span class="swatch swatch--free"
                ><i class="pi pi-check-circle" aria-hidden="true"></i>Available - no open
                tasks</span
              >
            </li>
            <li>
              <span class="swatch swatch--ooo"
                ><i class="pi pi-calendar-minus" aria-hidden="true"></i>Not available (out of
                office)</span
              >
            </li>
          </ul>
        </div>
        <div>
          <h3>Load</h3>
          <ul class="plain" data-load-help>
            @for (line of loadLines(); track line) {
              <li>{{ line }}</li>
            }
          </ul>
          <p class="small">The load bar is split by priority, in the same order and colours.</p>
        </div>
        <div>
          <h3>What this is not</h3>
          <p class="small">
            This view shows operational capacity: who has room and what is open. It has no
            completion counts, speed, ranking or other performance measures.
          </p>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s3);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .fld {
      display: grid;
      gap: 2px;
    }
    .lbl {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .grow {
      flex: 1;
    }
    .search {
      min-width: 14rem;
      flex: 0 1 18rem;
    }
    .pair {
      display: inline-flex;
      gap: var(--mf-s1);
    }
    .toggle[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
      font-weight: 600;
    }
    .updated {
      align-self: center;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: var(--mf-s4);
      margin-top: var(--mf-s2);
      padding: var(--mf-s3) var(--mf-s4);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .legend h3 {
      margin: 0 0 var(--mf-s1);
      font-size: var(--mf-fs-md);
    }
    .small {
      margin: 0 0 var(--mf-s2);
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .swatches,
    .plain {
      display: grid;
      gap: var(--mf-s1);
      margin: 0;
      padding: 0;
      list-style: none;
      font-size: var(--mf-fs-sm);
    }
    .swatch {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s1);
      padding: 0 var(--mf-s2);
      border: 1px solid currentColor;
      border-radius: var(--mf-radius);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .swatch--free {
      color: var(--mf-success);
      background: var(--mf-success-bg);
    }
    .swatch--ooo {
      color: var(--mf-text);
      border-style: dashed;
      background: repeating-linear-gradient(
        135deg,
        var(--mf-border) 0 6px,
        var(--mf-surface-alt) 6px 12px
      );
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
      .updated {
        display: none;
      }
    }
  `,
})
export class UsersToolbar {
  protected readonly sorts = USER_SORTS;
  protected readonly sortLabels = USER_SORT_LABELS;
  protected readonly availabilities = AVAILABILITY_FILTERS;
  protected readonly availabilityLabels = AVAILABILITY_LABELS;
  protected readonly densities = DENSITIES;
  protected readonly layouts = LAYOUTS;

  readonly filters = input.required<UsersFilters>();
  readonly sort = input<UserSort>('load');
  readonly density = input<Density>('comfortable');
  readonly layout = input<Layout>('cards');
  readonly pods = input<PodOption[]>([]);
  readonly priorities = input<readonly WorkloadPriority[]>([]);
  readonly thresholds = input<WorkloadThresholds | null>(null);
  readonly updated = input<string | null>(null);
  readonly refreshing = input(false);

  readonly filtersChange = output<Partial<UsersFilters>>();
  readonly sortChange = output<UserSort>();
  readonly densityChange = output<Density>();
  readonly layoutChange = output<Layout>();
  readonly refresh = output<void>();

  protected readonly legendOpen = signal(false);
  protected readonly count = computed(() => filterCount(this.filters()));
  protected readonly loadLines = computed(() => thresholdText(this.thresholds()));

  protected colorsOf(tone: string) {
    return priorityColors(tone);
  }

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

  protected onDensity(value: string): void {
    if (isDensity(value)) this.densityChange.emit(value);
  }

  protected clear(): void {
    this.filtersChange.emit({ pod: null, availability: 'all', q: '' });
  }
}
