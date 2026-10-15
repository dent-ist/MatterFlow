import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { SearchBox } from '../../../shared/ui/search-box';
import {
  COMPLETED_WINDOWS,
  Density,
  GROUP_BYS,
  GROUP_LABELS,
  GroupBy,
  SORTS,
  SORT_LABELS,
  SortKey,
  SwimlaneView,
  filterCount,
  isCompletedDays,
  isGroupBy,
  isSortKey,
} from './swimlane-model';

export interface Option {
  id: number;
  label: string;
}

/**
 * The one compact toolbar of the Swimlane tab: Group by, Sort, search, Filters (with the number of filters on), Only mine, card density,
 * the completed window, Expand and Collapse all (when grouped) and Refresh. It owns no state: each choice is emitted as a patch and the tab
 * writes it to the address and to the remembered choices.
 */
@Component({
  selector: 'mf-swimlane-toolbar',
  imports: [SearchBox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = view();
    <div class="bar" role="toolbar" aria-label="Swimlane controls">
      <div class="fld">
        <label class="lbl" for="sl-group">Group by</label>
        <select
          id="sl-group"
          class="mf-control mf-control--compact"
          data-group-by
          [value]="v.groupBy"
          (change)="onGroup($any($event.target).value)"
        >
          @for (g of groupBys; track g) {
            <option [value]="g" [selected]="g === v.groupBy">{{ groupLabels[g] }}</option>
          }
        </select>
      </div>
      <div class="fld">
        <label class="lbl" for="sl-sort">Sort</label>
        <select
          id="sl-sort"
          class="mf-control mf-control--compact"
          data-sort
          [value]="v.sort"
          (change)="onSort($any($event.target).value)"
        >
          @for (s of sorts; track s) {
            <option [value]="s" [selected]="s === v.sort">{{ sortLabels[s] }}</option>
          }
        </select>
      </div>
      <mf-search-box
        class="search"
        role="search"
        inputId="sl-q"
        label="Search title or ref"
        placeholder="Search title or ref"
        [hideLabel]="true"
        [hintOnFocus]="true"
        [value]="v.q"
        (searchChange)="viewChange.emit({ q: $event })"
      />
      <button
        type="button"
        class="mf-btn"
        data-filters
        [attr.aria-expanded]="panel()"
        [attr.aria-controls]="panel() ? 'sl-filters' : null"
        (click)="panel.set(!panel())"
      >
        <i class="pi pi-filter" aria-hidden="true"></i>
        Filters
        @if (count() > 0) {
          <span class="n" data-filter-count>({{ count() }})</span>
        }
      </button>
      <button
        type="button"
        class="mf-btn toggle"
        data-mine
        [attr.aria-pressed]="v.mine"
        (click)="viewChange.emit({ mine: !v.mine })"
      >
        <i class="pi pi-user" aria-hidden="true"></i>
        Only mine
      </button>
      <div class="fld">
        <label class="lbl" for="sl-density">Density</label>
        <select
          id="sl-density"
          class="mf-control mf-control--compact"
          data-density
          [value]="density()"
          (change)="densityChange.emit($any($event.target).value)"
        >
          <option value="comfortable" [selected]="density() === 'comfortable'">Comfortable</option>
          <option value="compact" [selected]="density() === 'compact'">Compact</option>
        </select>
      </div>
      <div class="fld">
        <label class="lbl" for="sl-days">Completed in last</label>
        <select
          id="sl-days"
          class="mf-control mf-control--compact"
          data-days
          [value]="v.days"
          (change)="onDays($any($event.target).value)"
        >
          @for (d of windows; track d) {
            <option [value]="d" [selected]="d === v.days">{{ d }} days</option>
          }
        </select>
      </div>
      @if (v.groupBy !== 'none') {
        <span class="pair" role="group" aria-label="Groups">
          <button type="button" class="mf-btn" data-expand-all (click)="expandAll.emit()">
            <i class="pi pi-plus" aria-hidden="true"></i>Expand all
          </button>
          <button type="button" class="mf-btn" data-collapse-all (click)="collapseAll.emit()">
            <i class="pi pi-minus" aria-hidden="true"></i>Collapse all
          </button>
        </span>
      }
      <span class="grow"></span>
      @if (updated(); as u) {
        <span class="updated" data-updated>Updated {{ u }}</span>
      }
      <button
        type="button"
        class="mf-btn"
        data-refresh-board
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

    @if (panel()) {
      <div id="sl-filters" class="panel" role="group" aria-label="Filters" data-filter-panel>
        @if (pods().length > 0) {
          <div class="fld fld--col">
            <label class="lbl" for="sl-pod">Pod</label>
            <select
              id="sl-pod"
              class="mf-control mf-control--compact"
              data-filter="pod"
              (change)="viewChange.emit({ pod: num($any($event.target).value) })"
            >
              <option value="">Any pod</option>
              @for (p of pods(); track p.id) {
                <option [value]="p.id" [selected]="v.pod === p.id">{{ p.label }}</option>
              }
            </select>
          </div>
        }
        <div class="fld fld--col">
          <label class="lbl" for="sl-assignee">Assignee</label>
          <select
            id="sl-assignee"
            class="mf-control mf-control--compact"
            data-filter="assignee"
            (change)="viewChange.emit({ assignee: $any($event.target).value || null })"
          >
            <option value="">Anyone</option>
            <option value="unassigned" [selected]="v.assignee === 'unassigned'">Unassigned</option>
            @for (p of people(); track p.id) {
              <option [value]="p.id" [selected]="v.assignee === '' + p.id">{{ p.label }}</option>
            }
          </select>
        </div>
        <div class="fld fld--col">
          <label class="lbl" for="sl-type">Task type</label>
          <select
            id="sl-type"
            class="mf-control mf-control--compact"
            data-filter="type"
            (change)="viewChange.emit({ type: num($any($event.target).value) })"
          >
            <option value="">Any type</option>
            @for (p of types(); track p.id) {
              <option [value]="p.id" [selected]="v.type === p.id">{{ p.label }}</option>
            }
          </select>
        </div>
        <div class="fld fld--col">
          <label class="lbl" for="sl-priority">Priority</label>
          <select
            id="sl-priority"
            class="mf-control mf-control--compact"
            data-filter="priority"
            (change)="viewChange.emit({ priority: num($any($event.target).value) })"
          >
            <option value="">Any priority</option>
            @for (p of priorities(); track p.id) {
              <option [value]="p.id" [selected]="v.priority === p.id">{{ p.label }}</option>
            }
          </select>
        </div>
        <label class="check">
          <input
            type="checkbox"
            data-filter="overdue"
            [checked]="v.overdue"
            (change)="viewChange.emit({ overdue: $any($event.target).checked })"
          />
          Overdue only
        </label>
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-clear-filters
          [attr.aria-disabled]="count() === 0 && !v.q && !v.mine ? 'true' : null"
          (click)="clear()"
        >
          Clear filters
        </button>
      </div>
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
    .n {
      font-variant-numeric: tabular-nums;
    }
    .toggle[aria-pressed='true'] {
      background: var(--mf-selected-bg);
      border-color: var(--mf-primary);
      color: var(--mf-primary);
      font-weight: 600;
    }
    .pair {
      display: inline-flex;
      gap: var(--mf-s2);
    }
    .updated {
      align-self: center;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
    }
    .panel {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: var(--mf-s3);
      margin-top: var(--mf-s2);
      padding: var(--mf-s3);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border);
      border-radius: var(--mf-radius-lg);
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: var(--mf-s2);
      min-height: var(--mf-row-h-compact);
    }
    @media (max-width: 560px) {
      .search {
        flex-basis: 100%;
      }
      .fld:not(.fld--col) {
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
export class SwimlaneToolbar {
  protected readonly groupBys = GROUP_BYS;
  protected readonly groupLabels = GROUP_LABELS;
  protected readonly sorts = SORTS;
  protected readonly sortLabels = SORT_LABELS;
  protected readonly windows = COMPLETED_WINDOWS;

  readonly view = input.required<SwimlaneView>();
  readonly density = input<Density>('comfortable');
  readonly pods = input<Option[]>([]);
  readonly people = input<Option[]>([]);
  readonly types = input<Option[]>([]);
  readonly priorities = input<Option[]>([]);
  readonly updated = input<string | null>(null);
  readonly refreshing = input(false);

  readonly viewChange = output<Partial<SwimlaneView>>();
  readonly densityChange = output<Density>();
  readonly expandAll = output<void>();
  readonly collapseAll = output<void>();
  readonly refresh = output<void>();

  protected readonly panel = signal(false);
  protected readonly count = computed(() => filterCount(this.view()));

  protected num(value: string): number | null {
    const n = Number(value);
    return value !== '' && Number.isInteger(n) && n > 0 ? n : null;
  }

  protected onGroup(value: string): void {
    if (isGroupBy(value)) this.viewChange.emit({ groupBy: value as GroupBy });
  }

  protected onSort(value: string): void {
    if (isSortKey(value)) this.viewChange.emit({ sort: value as SortKey });
  }

  protected onDays(value: string): void {
    const n = Number(value);
    if (isCompletedDays(n)) this.viewChange.emit({ days: n });
  }

  protected clear(): void {
    this.viewChange.emit({
      q: '',
      pod: null,
      assignee: null,
      type: null,
      priority: null,
      overdue: false,
      mine: false,
    });
  }
}
