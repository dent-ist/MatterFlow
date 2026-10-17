import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { WorkloadPriority, WorkloadThresholds } from '../../../api/generated/api-client';
import { SearchBox } from '../../../shared/ui/search-box';
import { levelBars, priorityColors } from '../../../shared/ui/priority-badge';
import {
  AVAILABILITY_FILTERS,
  AVAILABILITY_LABELS,
  AvailabilityFilter,
  DEFAULT_FILTERS,
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
import { UsersGlyph } from './users-glyph';

/**
 * The toolbar of the Users tab: search by name, highest priority, availability and sort, then icon buttons: clear filters, tile size, the
 * cards or table view and the legend (pill colours, marks, load levels and what this view is not). It owns no state: every choice is emitted and the tab writes it to the address (the
 * filters) and to the remembered choices (sort, density, view).
 */
@Component({
  selector: 'mf-users-toolbar',
  imports: [SearchBox, UsersGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = filters();
    <div class="bar" role="toolbar" aria-label="Team workload controls">
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
        <ng-content />
        @if (count() > 0) {
          <button
            type="button"
            class="mf-btn mf-btn--icon clear"
            data-clear-filters
            [attr.aria-label]="'Clear filters (' + count() + ')'"
            [attr.title]="'Clear filters (' + count() + ')'"
            (click)="clear()"
          >
            <i class="pi pi-filter-slash" aria-hidden="true"></i>
            <span class="badge" aria-hidden="true">{{ count() }}</span>
          </button>
        }
        <span class="pair" role="group" aria-label="Tile size" data-density-group>
          @for (d of densities; track d) {
            <button
              type="button"
              class="mf-btn mf-btn--icon toggle"
              [attr.data-density]="d"
              [attr.aria-pressed]="density() === d"
              [attr.aria-label]="d === 'compact' ? 'Dense tiles' : 'Standard tiles'"
              [attr.title]="d === 'compact' ? 'Dense tiles: name and count only' : 'Standard tiles'"
              (click)="densityChange.emit(d)"
            >
              <i
                class="pi"
                [class]="d === 'compact' ? 'pi-window-minimize' : 'pi-window-maximize'"
                aria-hidden="true"
              ></i>
            </button>
          }
        </span>
        <span class="pair" role="group" aria-label="View">
          @for (l of layouts; track l) {
            <button
              type="button"
              class="mf-btn mf-btn--icon toggle"
              [attr.data-layout]="l"
              [attr.aria-pressed]="layout() === l"
              [attr.aria-label]="l === 'cards' ? 'Cards' : 'Table'"
              [attr.title]="
                l === 'cards' ? 'Cards: one tile per person' : 'Table: one row per person'
              "
              (click)="layoutChange.emit(l)"
            >
              <i
                class="pi"
                [class]="l === 'cards' ? 'pi-th-large' : 'pi-list'"
                aria-hidden="true"
              ></i>
            </button>
          }
        </span>
        <button
          type="button"
          class="mf-btn mf-btn--icon toggle"
          data-legend-toggle
          aria-label="Legend and help"
          title="Legend and help"
          [attr.aria-pressed]="legendOpen()"
          [attr.aria-expanded]="legendOpen()"
          [attr.aria-controls]="legendOpen() ? 'wl-legend' : null"
          (click)="legendOpen.set(!legendOpen())"
        >
          <i class="pi pi-info-circle" aria-hidden="true"></i>
        </button>
      </span>
    </div>

    @if (legendOpen()) {
      <section id="wl-legend" class="legend" aria-label="Legend and help" data-legend>
        <div>
          <h3>Pill colour: highest open priority</h3>
          <ul class="swatches" data-legend-priorities>
            @for (p of priorities(); track p.priorityId) {
              <li>
                <span
                  class="swatch"
                  [style.background]="colorsOf(p.color).bg"
                  [style.color]="colorsOf(p.color).fg"
                  [style.border-color]="colorsOf(p.color).fg"
                  ><mf-users-glyph [level]="barsOf(p.rank)" />{{ p.label }}</span
                >
              </li>
            }
            <li>
              <span class="swatch swatch--free"
                ><i class="pi pi-check-circle" aria-hidden="true"></i>Idle: no open tasks</span
              >
            </li>
            <li>
              <span class="swatch swatch--ooo"
                ><i class="pi pi-calendar-minus" aria-hidden="true"></i>Out of office
                (hatched)</span
              >
            </li>
          </ul>
          <p class="small">
            The number in the pill is the open tasks. The coloured edge of the tile repeats the
            priority colour.
          </p>
        </div>
        <div>
          <h3>Marks and bar</h3>
          <ul class="plain" data-legend-marks>
            <li><i class="pi pi-clock late" aria-hidden="true"></i> 2: overdue tasks</li>
            <li>
              <i class="pi pi-exclamation-triangle late" aria-hidden="true"></i> Heavy load (red
              outline)
            </li>
            <li><i class="pi pi-moon" aria-hidden="true"></i> Off hours</li>
            <li>
              <span class="sample" aria-hidden="true"></span> The bar splits the open tasks by
              priority, in the colours above; a full bar is a normal load or more.
            </li>
          </ul>
          <h3>Load</h3>
          <ul class="plain" data-load-help>
            @for (line of loadLines(); track line) {
              <li>{{ line }}</li>
            }
          </ul>
        </div>
        <div>
          <h3>Names and details</h3>
          <p class="small">
            Hover or focus a tile for the full status (for example "Out of office until Nov 3"). A
            click opens the person's tasks. The user-plus icon on a tile assigns work.
          </p>
          <h3>What this is not</h3>
          <p class="small" data-frame>
            Operational capacity only: who has room and what is open. No completion counts, speed,
            ranking or other performance measures.
          </p>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--mf-s2);
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s2);
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
      min-width: 10rem;
      flex: 0 1 11rem;
    }
    .pair {
      display: inline-flex;
      gap: var(--mf-s1);
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
      margin: 0 0 var(--mf-s2);
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
      border-radius: 999px;
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
    .late {
      color: var(--mf-danger);
    }
    .plain .sample {
      display: inline-block;
      width: 2rem;
      height: 8px;
      vertical-align: middle;
      background: linear-gradient(90deg, var(--mf-pr-high-bg) 50%, var(--mf-pr-normal-bg) 50%);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
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
  protected readonly densities = DENSITIES;
  protected readonly layouts = LAYOUTS;

  readonly filters = input.required<UsersFilters>();
  readonly sort = input<UserSort>('load');
  readonly density = input<Density>('comfortable');
  readonly layout = input<Layout>('cards');
  readonly priorities = input<readonly WorkloadPriority[]>([]);
  readonly thresholds = input<WorkloadThresholds | null>(null);

  readonly filtersChange = output<Partial<UsersFilters>>();
  readonly sortChange = output<UserSort>();
  readonly densityChange = output<Density>();
  readonly layoutChange = output<Layout>();

  protected readonly legendOpen = signal(false);
  protected readonly count = computed(() => filterCount(this.filters()));
  protected readonly loadLines = computed(() => thresholdText(this.thresholds()));

  protected colorsOf(tone: string) {
    return priorityColors(tone);
  }

  protected barsOf(rank: number | null | undefined): number {
    return levelBars(rank);
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
    this.filtersChange.emit({ ...DEFAULT_FILTERS });
  }
}
