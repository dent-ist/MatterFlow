import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Injector,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FOCUS_FILTER_SHORTCUT, ShortcutRegistry, isShortcut } from '../layout/shortcut-registry';
import { FiltersToggle } from '../ui/column-filters';
import { FilterChips, FilterNotice } from './filter-chips';
import { FilterControl } from './filter-control';
import { FilterDef, isActive } from './filter-def';
import { FilterPopover } from './filter-popover';
import { FilterSheet } from './filter-sheet';
import { ListFilters } from './list-filters';

let nextId = 0;

/**
 * "More filters" menu: filters whose column is hidden or that have no column (Matter "Sensitive", Created on a task list). Choosing one
 * opens its control in the same panel (a "Back" button returns to the list); the filter then shows as a chip.
 */
@Component({
  selector: 'mf-more-filters',
  imports: [FilterPopover, FilterControl],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #btn
      type="button"
      class="mf-btn"
      aria-haspopup="dialog"
      data-more-filters
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? uid : null"
      (click)="toggle()"
    >
      <i class="pi pi-plus" aria-hidden="true"></i>
      More filters
    </button>
    @if (open()) {
      <mf-filter-popover [anchor]="btn" label="More filters" (closed)="close()">
        <div [id]="uid" class="mfm">
          @if (picked(); as d) {
            <button type="button" class="mf-btn mf-btn--text" (click)="picked.set(null)">
              <i class="pi pi-arrow-left" aria-hidden="true"></i> Back
            </button>
            <p class="mfm__title">{{ d.label }}</p>
            <mf-filter-control [def]="d" [filters]="filters()" [inline]="true" />
          } @else {
            <p class="mfm__title">Add a filter</p>
            <ul class="mfm__list">
              @for (d of filters().moreDefs(); track d.key) {
                <li>
                  <button
                    type="button"
                    class="mfm__item"
                    [attr.data-more-filter]="d.key"
                    (click)="picked.set(d)"
                  >
                    {{ d.label }}
                    @if (isSet(d)) {
                      <span class="mfm__set">(set)</span>
                    }
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      </mf-filter-popover>
    }
  `,
  styles: `
    .mfm__title {
      margin: 0 0 var(--mf-s1);
      font-weight: 600;
    }
    .mfm__list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .mfm__item {
      display: flex;
      justify-content: space-between;
      width: 100%;
      min-height: 32px;
      padding: 0 var(--mf-s2);
      border: 0;
      border-radius: var(--mf-radius);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .mfm__item:hover {
      background: var(--mf-surface-alt);
    }
    .mfm__set {
      color: var(--mf-text-muted);
    }
  `,
})
export class MoreFilters {
  readonly filters = input.required<ListFilters>();
  protected readonly uid = `mf-more-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly picked = signal<FilterDef | null>(null);

  protected toggle(): void {
    this.picked.set(null);
    this.open.update((v) => !v);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected isSet(def: FilterDef): boolean {
    return isActive(def, this.filters().value(def.key));
  }
}

/**
 * The bar above a filtered grid (docs/ux/column-filters-review.md 4.1), right aligned like Sorted by / Columns on the work lists:
 * `[start slot] [chips ...] Clear filters [content slot] More filters  Filters (n)`. It also holds what belongs with the filters but has
 * no place of its own: the "Restored your last view" notice, the polite live region that announces the result count after a filter
 * change, the print line ("Filters: Status Active, Type Laptop") and the sheet used below 768 px or when the grid overflows.
 *
 *   <mf-filters-bar [filters]="filters" controls="asset-filter-row" [clearAlso]="['q']">
 *     <span mfBarStart>...presets...</span>   <!-- optional, left -->
 *     ...Columns, Sorted by...                 <!-- optional, before More filters -->
 *     <a mfSheetFooter>...</a>                 <!-- optional, in the footer of the Filters sheet (narrow windows) -->
 *   </mf-filters-bar>
 */
@Component({
  selector: 'mf-filters-bar',
  imports: [FiltersToggle, FilterChips, FilterNotice, FilterSheet, MoreFilters],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mf-filter-notice [filters]="filters()" />
    <div class="fbar" data-grid-toolbar>
      <ng-content select="[mfBarStart]" />
      <div class="fbar__chips">
        <mf-filter-chips
          [filters]="filters()"
          [mode]="filters().rowVisible() ? 'hidden' : 'all'"
          (showColumn)="showColumn.emit($event)"
        />
      </div>
      @if (filters().activeCount() > 0) {
        <button
          type="button"
          class="mf-btn mf-btn--text"
          data-clear-filters
          (click)="filters().clear(clearAlso())"
        >
          Clear filters
        </button>
      }
      <ng-content />
      @if (filters().moreDefs().length > 0) {
        <mf-more-filters [filters]="filters()" />
      }
      <mf-filters-toggle
        [controls]="filters().sheetMode() ? '' : controls()"
        [open]="filters().toggleOpen()"
        [count]="filters().activeCount()"
        [sheet]="filters().sheetMode()"
        (toggled)="filters().toggle()"
      />
    </div>
    <p class="fbar__live" role="status" aria-live="polite" aria-atomic="true" data-filter-live>
      {{ filters().announcement() }}
    </p>
    @if (filters().printLine(); as line) {
      <p class="fbar__print" data-filter-print>{{ line }}</p>
    }
    <mf-filter-sheet [filters]="filters()" [clearAlso]="clearAlso()">
      <ng-content select="[mfSheetFooter]" ngProjectAs="[mfSheetFooter]" />
    </mf-filter-sheet>
  `,
  styles: `
    :host {
      display: block;
    }
    .fbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      align-items: center;
      gap: var(--mf-s2) var(--mf-s3);
      margin: 0 0 var(--mf-s2);
    }
    .fbar__chips {
      min-width: 0;
      margin-right: auto;
    }
    .fbar__live {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .fbar__print {
      display: none;
      margin: 0 0 var(--mf-s2);
      font-size: var(--mf-fs-sm);
    }
    @media print {
      .fbar {
        display: none;
      }
      .fbar__print {
        display: block;
      }
    }
  `,
})
export class FiltersBar {
  readonly filters = input.required<ListFilters>();
  /** Id of the filter row (the Filters button's `aria-controls`). */
  readonly controls = input('');
  /** Legacy parameters that Clear filters drops too. */
  readonly clearAlso = input<readonly string[]>([]);
  /** A chip on a hidden column asks for the column back (the page owns the column chooser). */
  readonly showColumn = output<string>();

  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  /** Whether `/` works here: the screen has a text filter with a control. */
  private readonly hasTextFilter = computed(() =>
    this.filters()
      .defs()
      .some((d) => d.type === 'text' && !d.noControl && !d.disabledReason?.()),
  );

  constructor() {
    // The `?` help lists `/` only while a screen that has it is open: under "Work lists" on the three work lists, else as the page's own.
    const registry = inject(ShortcutRegistry);
    let unregister: (() => void) | null = null;
    effect(() => {
      unregister?.();
      unregister = null;
      if (!this.hasTextFilter()) return;
      const path = this.router.url.split(/[?#]/)[0];
      const workList = ['/tasks', '/my-work', '/pods/work'].includes(path);
      unregister = registry.register({
        ...FOCUS_FILTER_SHORTCUT,
        keys: [...FOCUS_FILTER_SHORTCUT.keys],
        group: workList ? 'work-lists' : 'page',
        does: workList ? 'Focus the Title or Ref filter' : 'Focus the first text filter',
      });
    });
    inject(DestroyRef).onDestroy(() => unregister?.());
  }

  /**
   * `/` opens the row (or the sheet) if it is closed and focuses the first text filter, unless the user is typing somewhere. Only on
   * screens that have a text filter.
   */
  @HostListener('document:keydown', ['$event'])
  protected onSlash(event: KeyboardEvent): void {
    if (!isShortcut('focus-filter', event) || event.defaultPrevented) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable || target?.closest?.('[role="dialog"]')) return;
    const f = this.filters();
    if (!f.defs().some((d) => d.type === 'text' && !d.noControl && !d.disabledReason?.())) return;
    event.preventDefault();
    f.reveal();
    afterNextRender(
      () =>
        document
          .querySelector<HTMLElement>(
            '[data-filter-row] .cf__input, [data-filter-sheet] .cf__input',
          )
          ?.focus(),
      { injector: this.injector },
    );
  }
}
