import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { SearchBox } from '../../../shared/ui/search-box';
import {
  COMPLETED_WINDOWS,
  DEFAULT_COMPLETED_DAYS,
  DEFAULT_VIEW,
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

let nextId = 0;

export interface Option {
  id: number;
  label: string;
}

/**
 * The one-line toolbar of the Swimlane tab (W1): Search, Group, Sort, Filters (with the number of filters on) and a "..." menu button
 * holding Density, the "Done in the last" window, Only mine and Expand/Collapse all. Settings in the menu that differ from the defaults
 * show as text chips so they are never invisible. It owns no state: each choice is emitted as a patch and the tab writes it to the
 * address and to the remembered choices.
 */
@Component({
  selector: 'mf-swimlane-toolbar',
  imports: [SearchBox, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
  template: `
    @let v = view();
    <div class="bar" role="toolbar" aria-label="Swimlane controls">
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
      @if (!compact()) {
        <ng-container *ngTemplateOutlet="groupSort" />
      }
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
        @if (shownCount() > 0) {
          <span class="n" data-filter-count>({{ shownCount() }})</span>
        }
      </button>
      <span class="grow"></span>
      @if (settings().length > 0) {
        <ul class="chips" data-active-settings aria-label="Board settings in effect">
          @for (t of settings(); track t) {
            <li class="chip">{{ t }}</li>
          }
        </ul>
      }
      <div class="more">
        <button
          #trigger
          type="button"
          class="mf-btn more-btn"
          data-more
          aria-haspopup="menu"
          aria-label="More options"
          [attr.aria-expanded]="menu()"
          [attr.aria-controls]="menu() ? uid + '-menu' : null"
          (click)="toggleMenu($event)"
          (keydown)="onTriggerKey($event)"
        >
          <i class="pi pi-ellipsis-h" aria-hidden="true"></i>
        </button>
        @if (menu()) {
          <div
            class="menu"
            role="menu"
            tabindex="-1"
            data-more-menu
            aria-label="Board options"
            [id]="uid + '-menu'"
            (keydown)="onMenuKey($event)"
          >
            <div role="group" aria-labelledby="sl-m-density">
              <div class="mh" id="sl-m-density">Density</div>
              @for (d of densities; track d.id) {
                <button
                  type="button"
                  role="menuitemradio"
                  class="mi"
                  tabindex="-1"
                  [attr.data-density]="d.id"
                  [attr.aria-checked]="density() === d.id"
                  (click)="pickDensity(d.id)"
                >
                  <i class="pi" [class.pi-check]="density() === d.id" aria-hidden="true"></i>
                  {{ d.label }}
                </button>
              }
            </div>
            <div role="group" aria-labelledby="sl-m-days">
              <div class="mh" id="sl-m-days">Done in the last</div>
              @for (d of windows; track d) {
                <button
                  type="button"
                  role="menuitemradio"
                  class="mi"
                  tabindex="-1"
                  [attr.data-days]="d"
                  [attr.aria-checked]="v.days === d"
                  (click)="pickDays(d)"
                >
                  <i class="pi" [class.pi-check]="v.days === d" aria-hidden="true"></i>
                  {{ d }} days
                </button>
              }
            </div>
            <div class="sep" role="separator"></div>
            <button
              type="button"
              role="menuitemcheckbox"
              class="mi"
              tabindex="-1"
              data-mine
              [attr.aria-checked]="v.mine"
              (click)="pickMine()"
            >
              <i class="pi" [class.pi-check]="v.mine" aria-hidden="true"></i>
              Only mine
            </button>
            @if (v.groupBy !== 'none') {
              <div class="sep" role="separator"></div>
              <button
                type="button"
                role="menuitem"
                class="mi"
                tabindex="-1"
                data-expand-all
                (click)="run(expandAll)"
              >
                <i class="pi pi-plus" aria-hidden="true"></i>Expand all
              </button>
              <button
                type="button"
                role="menuitem"
                class="mi"
                tabindex="-1"
                data-collapse-all
                (click)="run(collapseAll)"
              >
                <i class="pi pi-minus" aria-hidden="true"></i>Collapse all
              </button>
            }
          </div>
        }
      </div>
    </div>

    <ng-template #groupSort>
      <div class="fld">
        <label class="lbl" for="sl-group">Group</label>
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
    </ng-template>

    @if (panel()) {
      <div
        id="sl-filters"
        class="panel"
        role="group"
        [attr.aria-label]="compact() ? 'Filters, group and sort' : 'Filters'"
        data-filter-panel
      >
        @if (compact()) {
          <ng-container *ngTemplateOutlet="groupSort" />
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
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
    }
    .fld {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
    }
    .fld--col {
      display: grid;
      align-items: stretch;
      gap: 2px;
    }
    .lbl {
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-sm);
      font-weight: 600;
    }
    .grow {
      flex: 1;
    }
    .search {
      min-width: 10rem;
      flex: 1 1 18rem;
      max-width: 22rem;
    }
    /* The search input is as tall as the other (compact) controls on the line, not the 40px form height. */
    .search ::ng-deep .sb__input {
      min-height: var(--mf-row-h-compact);
      height: var(--mf-row-h-compact);
      padding-block: 0;
    }
    .n {
      font-variant-numeric: tabular-nums;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--mf-s1) var(--mf-s2);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .chip {
      padding: 0 var(--mf-s2);
      border: 1px solid var(--mf-border-strong);
      border-radius: 999px;
      background: var(--mf-surface);
      color: var(--mf-text);
      font-size: var(--mf-fs-xs);
      line-height: 1.5rem;
      white-space: nowrap;
    }
    .more {
      position: relative;
    }
    .menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 30;
      min-width: 14rem;
      padding: var(--mf-s1);
      background: var(--mf-surface);
      border: 1px solid var(--mf-border-strong);
      border-radius: var(--mf-radius-lg);
      box-shadow: var(--mf-shadow-2, 0 6px 20px rgb(0 0 0 / 0.18));
    }
    .mh {
      padding: var(--mf-s1) var(--mf-s2) 0;
      color: var(--mf-text-muted);
      font-size: var(--mf-fs-xs);
      font-weight: 600;
    }
    .mi {
      display: flex;
      align-items: center;
      gap: var(--mf-s2);
      width: 100%;
      min-height: 1.75rem;
      padding: var(--mf-s1) var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius);
      background: none;
      color: var(--mf-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .mi i {
      width: 1rem;
      font-size: 0.8125rem;
    }
    .mi:hover,
    .mi:focus-visible {
      background: var(--mf-selected-bg);
    }
    .mi:focus-visible {
      outline: 2px solid var(--mf-focus);
      outline-offset: -2px;
    }
    .sep {
      height: 1px;
      margin: var(--mf-s1) 0;
      background: var(--mf-border);
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
    /* From 1100 px the controls are one row; below, they wrap to two lines at most. */
    @media (min-width: 1100px) {
      .bar {
        flex-wrap: nowrap;
      }
      .chips {
        flex-wrap: nowrap;
      }
    }
    @media (max-width: 560px) {
      .search {
        flex-basis: 100%;
        max-width: none;
      }
      .fld:not(.fld--col) {
        flex: 1 1 8rem;
      }
      .fld select {
        flex: 1;
        min-width: 0;
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
  readonly people = input<Option[]>([]);
  readonly types = input<Option[]>([]);
  readonly priorities = input<Option[]>([]);
  /** The phone layout (W4): the bar is Search, Filters and "..."; Group and Sort move into the Filters panel. */
  readonly compact = input(false);

  readonly viewChange = output<Partial<SwimlaneView>>();
  readonly densityChange = output<Density>();
  readonly expandAll = output<void>();
  readonly collapseAll = output<void>();

  protected readonly densities: { id: Density; label: string }[] = [
    { id: 'comfortable', label: 'Comfortable' },
    { id: 'compact', label: 'Compact' },
  ];
  protected readonly uid = `sl-tb-${nextId++}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly panel = signal(false);
  protected readonly menu = signal(false);
  /** The settings behind the "..." button that differ from the defaults, as text, so a hidden setting is never invisible. */
  protected readonly settings = computed(() => {
    const out: string[] = [];
    if (this.density() === 'compact') out.push('Compact');
    if (this.view().days !== DEFAULT_COMPLETED_DAYS) out.push(`Done in ${this.view().days} days`);
    if (this.view().mine) out.push('Only mine');
    return out;
  });
  protected readonly count = computed(() => filterCount(this.view()));
  /** The number on the Filters button. Where Group and Sort live in its panel (compact), a non-default one counts too, so it is never invisible. */
  protected readonly shownCount = computed(
    () =>
      this.count() +
      (this.compact() && this.view().groupBy !== DEFAULT_VIEW.groupBy ? 1 : 0) +
      (this.compact() && this.view().sort !== DEFAULT_VIEW.sort ? 1 : 0),
  );

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
      assignee: null,
      type: null,
      priority: null,
      overdue: false,
      mine: false,
    });
  }

  // ---- the "..." menu button (ARIA menu button pattern)

  protected toggleMenu(event: Event): void {
    event.stopPropagation();
    if (this.menu()) this.closeMenu(true);
    else this.openMenu(0);
  }

  private openMenu(focusIndex: number): void {
    this.menu.set(true);
    setTimeout(() => this.focusItem(focusIndex));
  }

  private closeMenu(returnFocus: boolean): void {
    if (!this.menu()) return;
    this.menu.set(false);
    if (returnFocus) this.host.nativeElement.querySelector<HTMLElement>('[data-more]')?.focus();
  }

  private items(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[data-more-menu] [role^="menuitem"]'),
    );
  }

  private focusItem(index: number): void {
    const list = this.items();
    if (list.length === 0) return;
    list[(index + list.length) % list.length].focus();
  }

  protected onTriggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.openMenu(event.key === 'ArrowDown' ? 0 : -1);
    } else if (event.key === 'Escape' && this.menu()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu(true);
    }
  }

  protected onMenuKey(event: KeyboardEvent): void {
    if (!this.menu()) return;
    const list = this.items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusItem(at + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.focusItem(at - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        this.focusItem(-1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.closeMenu(true);
        break;
      case 'Tab':
        this.closeMenu(false);
        break;
    }
  }

  protected onDocumentClick(event: Event): void {
    if (
      this.menu() &&
      !this.host.nativeElement.querySelector('.more')?.contains(event.target as Node)
    ) {
      this.closeMenu(false);
    }
  }

  protected pickDensity(density: Density): void {
    this.densityChange.emit(density);
    this.closeMenu(true);
  }

  protected pickDays(days: number): void {
    if (isCompletedDays(days)) this.viewChange.emit({ days });
    this.closeMenu(true);
  }

  protected pickMine(): void {
    this.viewChange.emit({ mine: !this.view().mine });
    this.closeMenu(true);
  }

  protected run(output: { emit: () => void }): void {
    output.emit();
    this.closeMenu(true);
  }
}
