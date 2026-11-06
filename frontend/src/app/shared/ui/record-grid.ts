import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  WritableSignal,
  Signal,
  ViewEncapsulation,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { AuthStore } from '../../core/auth/auth.store';
import { LoadState, SortHeader } from './data-table';
import { GridBody } from './grid-body';
import { GridColumns } from './grid-columns';
import { GridFrame } from './grid-frame';
import {
  GridColumnDef,
  GridPrefs,
  clearGridPrefs,
  gridPrefsKey,
  loadGridPrefs,
  moveBefore,
  saveGridPrefs,
  shownKeys,
} from './grid-prefs';
import { ColumnMove, ReorderColumns } from './reorder-columns';
import { ResizableColumns, columnWidthsKey } from './resizable-columns';

/**
 * One column of a record grid (the shared model, #1241): the key, label and visibility rules of `GridColumnDef` plus how the header and the cell look.
 * The cell itself is a template the page gives (`<ng-template mfCell="key" let-row><td>...</td></ng-template>`).
 */
export interface RecordGridColumn extends GridColumnDef {
  /** The API sort field; the heading is then a sort button (`mfSort`). */
  readonly sort?: string;
  /** Counts: the first click sorts the busiest record first. */
  readonly firstDesc?: boolean;
  /** A count column: heading and cell right aligned. */
  readonly num?: boolean;
  /** An optional column (shown only from the Columns menu): its heading carries `data-col-head`. */
  readonly extra?: boolean;
  /** CSS width of the heading cell ("36%", "9rem"): the spring columns of the grid. */
  readonly width?: string;
  /** CSS minimum width of the heading cell, a floor that holds while the list loads, is empty or has rows (no column moves between states). */
  readonly minWidth?: string;
}

/**
 * The shared state of one record grid: which columns exist, the person's order and visibility (stored per user and grid id in `localStorage`,
 * `mf.grid.v1.<grid>.<userId>`), reset and the widths reset. A page makes one in a field initialiser and hands it to `mf-record-grid` (the table) and
 * `mf-record-columns` (the Columns button in the toolbar):
 *
 *   protected readonly grid = new RecordGridState('clients', this.defs);
 *
 * `exclude` names columns that are left out for now whatever the person chose (a column a permission or the window hides).
 */
export class RecordGridState {
  private readonly auth = inject(AuthStore);
  private readonly key = computed(() => gridPrefsKey(this.grid, this.auth.profile()?.userId));
  readonly prefs: WritableSignal<GridPrefs>;
  /** Counts the "Reset Width" presses; the table clears its stored widths when it changes. */
  readonly widthsVersion = signal(0);
  /** The keys of the columns drawn, in the person's order. */
  readonly shown: Signal<string[]>;

  constructor(
    /** The stable id of the grid in storage ("matters", "clients"). */
    readonly grid: string,
    readonly defs: Signal<readonly RecordGridColumn[]>,
    exclude: () => ReadonlySet<string> | readonly string[] = () => [],
  ) {
    this.prefs = signal(loadGridPrefs(gridPrefsKey(grid, this.auth.profile()?.userId)));
    this.shown = computed(() => {
      const out = new Set(exclude());
      return shownKeys(this.defs(), this.prefs()).filter((k) => !out.has(k));
    });
  }

  set(next: GridPrefs): void {
    this.prefs.set(next);
    saveGridPrefs(this.key(), next);
  }

  /** Order and visibility back to the default (widths stay). */
  reset(): void {
    this.prefs.set({ order: [], visible: null });
    clearGridPrefs(this.key());
  }

  /** A header was dragged to a new place. */
  move(move: ColumnMove): void {
    const defs = this.defs();
    const prefs = this.prefs();
    // The drop target may be a column that is hidden by width: the visible neighbour in the order is what the person pointed at.
    this.set({ order: moveBefore(defs, prefs, move.key, move.beforeKey), visible: prefs.visible });
  }

  /** Forgets the stored widths: the columns go back to the grid's own layout (the spring column fills the free room again). */
  resetWidths(): void {
    clearGridPrefs(
      columnWidthsKey(
        this.grid,
        untracked(() => this.auth.profile()?.userId),
      ),
    );
    this.widthsVersion.update((n) => n + 1);
  }
}

/** The Columns button of a record grid (`mf-grid-columns` bound to its state): show, hide, order, "Reset to Default" and "Reset Width". */
@Component({
  selector: 'mf-record-columns',
  imports: [GridColumns],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: inline-block;
    }
  `,
  template: `
    <mf-grid-columns
      [defs]="grid().defs()"
      [prefs]="grid().prefs()"
      [widthReset]="true"
      (prefsChange)="grid().set($event)"
      (resetColumns)="grid().reset()"
      (resetWidths)="grid().resetWidths()"
    />
  `,
})
export class RecordColumns {
  readonly grid = input.required<RecordGridState>();
}

/** The cell of one column (and of the reserved columns `select` and `actions`): `<ng-template mfCell="name" let-row><td>...</td></ng-template>`. */
@Directive({ selector: 'ng-template[mfCell]' })
export class RecordCell {
  readonly mfCell = input.required<string>();
  readonly template = inject<TemplateRef<{ $implicit: unknown }>>(TemplateRef);
}

/**
 * The shared record grid (`mf-record-grid`, #1241): the grid of every record list (Matters, Clients, Projects, Assets). One place for what the lists
 * share: the frame (D-42: rows 44, header 40, identifier pinned, sideways scroll inside the frame), sortable headings, resize handles with the width
 * stored per person and grid (`mfResizable`), drag to reorder, the Columns state (`RecordGridState`), the loading, empty and error body (`mfGridBody`),
 * an optional selection column and a row-action column.
 *
 *   <mf-record-grid label="Clients list" caption="Clients" noun="clients" [grid]="grid" [rows]="rows()" [rowKey]="clientKey"
 *       [loadState]="state()" [empty]="rows().length === 0" [filtered]="filters.activeCount() > 0"
 *       [sort]="sort()" [defaultSort]="defaultSort" (sorted)="setSort($event)" (retry)="load()" (clear)="clear()">
 *     <tr mfGridFilterRow mfColumnFilterRow ...></tr>                          optional: the inline filter row
 *     <ng-template mfCell="name" let-c><td>...</td></ng-template>               one per column key
 *     <div mfGridFoot>pager</div>
 *   </mf-record-grid>
 *
 * A page needs no table markup of its own, so a new list cannot drift (guard: `record-grid-guard.spec.ts`).
 */
@Component({
  selector: 'mf-record-grid',
  imports: [NgTemplateOutlet, GridFrame, GridBody, SortHeader, ResizableColumns, ReorderColumns],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The cells come from the page's own templates, so the grid styles (`.pg-table td`, rows 44, header 40) must not be scoped to this component.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './page.scss',
  styles: `
    mf-record-grid {
      display: contents;
    }
    .rg-select {
      width: 2.25rem;
    }
  `,
  template: `
    <mf-grid-frame [scrollLabel]="label()">
      <div class="mf-scroll">
        <table
          class="pg-table tt"
          [mfResizable]="grid().grid"
          mfReorder
          (columnMove)="grid().move($event)"
        >
          <caption class="pg-sr">
            {{
              caption() || label()
            }}
          </caption>
          <thead>
            <tr>
              @if (selecting()) {
                <th scope="col" class="rg-select" data-no-resize data-no-reorder>
                  <input
                    type="checkbox"
                    [attr.aria-label]="selectAllLabel()"
                    data-select-all
                    [checked]="allSelected()"
                    [indeterminate]="someSelected() && !allSelected()"
                    (change)="selectAll.emit($any($event.target).checked)"
                  />
                </th>
              }
              @for (d of drawn(); track d.key) {
                @if (d.sort) {
                  <th
                    [attr.data-col]="d.key"
                    [class.pg-num]="d.num"
                    [style.width]="d.width ?? null"
                    [attr.data-rg-width]="d.width ?? null"
                    [style.min-width]="d.minWidth ?? null"
                    [mfSort]="d.sort"
                    [sort]="sort()"
                    [defaultSort]="defaultSort()"
                    [firstDesc]="!!d.firstDesc"
                    (sorted)="sorted.emit($event)"
                  >
                    {{ d.label }}
                  </th>
                } @else {
                  <th
                    scope="col"
                    [attr.data-col]="d.key"
                    [attr.data-col-head]="d.extra ? d.key : null"
                    [class.pg-num]="d.num"
                    [style.width]="d.width ?? null"
                    [attr.data-rg-width]="d.width ?? null"
                    [style.min-width]="d.minWidth ?? null"
                  >
                    {{ d.label }}
                  </th>
                }
              }
              @if (actions()) {
                <th scope="col" class="mf-col-actions" data-no-resize data-no-reorder>
                  <span class="pg-sr">Actions</span>
                </th>
              }
            </tr>
            <ng-content select="[mfGridFilterRow]" />
          </thead>
          <tbody
            mfGridBody
            [noun]="noun()"
            [state]="loadState()"
            [empty]="empty()"
            [filtered]="filtered()"
            [columns]="columnKeys().length"
            [skeleton]="skeleton()"
            [emptyText]="emptyText()"
            [hidden]="hidden()"
            [hiddenLabel]="hiddenLabel()"
            (retry)="retry.emit()"
            (clear)="clear.emit()"
            (showAll)="showAll.emit()"
          >
            <ng-container ngProjectAs="[mfEmptyAction]">
              <ng-content select="[mfEmptyAction]" />
            </ng-container>
            @for (row of rows(); track rowKey()(row, $index)) {
              <tr>
                @if (selecting()) {
                  <ng-container *ngTemplateOutlet="cellOf('select'); context: { $implicit: row }" />
                }
                @for (d of drawn(); track d.key) {
                  <ng-container *ngTemplateOutlet="cellOf(d.key); context: { $implicit: row }" />
                }
                @if (actions()) {
                  <ng-container
                    *ngTemplateOutlet="cellOf('actions'); context: { $implicit: row }"
                  />
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div frameFoot><ng-content select="[mfGridFoot]" /></div>
    </mf-grid-frame>
  `,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class RecordGrid<T = any> {
  /** The state of the grid (columns, order, visibility, stored widths). */
  readonly grid = input.required<RecordGridState>();
  /** The accessible name of the scroll region ("Matters list"). */
  readonly label = input.required<string>();
  /** The hidden table caption; defaults to the label. */
  readonly caption = input('');
  /** Plural, lowercase: "clients" (the empty, error and loading sentences). */
  readonly noun = input.required<string>();
  readonly rows = input.required<readonly T[]>();
  /** The identity of a row for the `@for` track. */
  readonly rowKey = input<(row: T, index: number) => unknown>((_row, index) => index);
  readonly loadState = input.required<LoadState>();
  readonly empty = input(false);
  readonly filtered = input(false);
  readonly emptyText = input('');
  readonly hidden = input(0);
  readonly hiddenLabel = input('inactive');
  /** The bone width of each column while loading, by column key (CSS lengths). */
  readonly bones = input<Readonly<Record<string, string>>>({});
  readonly sort = input<string | null | undefined>(undefined);
  readonly defaultSort = input('');
  /** A row-action column ("..." menu) is drawn last. */
  readonly actions = input(false);
  /** A selection column is drawn first (bulk actions). */
  readonly selecting = input(false);
  readonly allSelected = input(false);
  readonly someSelected = input(false);
  readonly selectAllLabel = input('Select all rows on this page');

  readonly sorted = output<string>();
  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly showAll = output<void>();
  readonly selectAll = output<boolean>();

  private readonly cells = contentChildren(RecordCell);
  private readonly resizer = viewChild(ResizableColumns);
  private readonly byKey = computed(
    () => new Map(this.cells().map((c) => [c.mfCell(), c.template] as const)),
  );

  /** The columns drawn, in the person's order, as definitions. */
  protected readonly drawn = computed<RecordGridColumn[]>(() => {
    const defs = new Map(
      this.grid()
        .defs()
        .map((d) => [d.key, d] as const),
    );
    return this.grid()
      .shown()
      .map((k) => defs.get(k))
      .filter((d): d is RecordGridColumn => !!d);
  });

  /** Every column of the table, the selection and action ones included (what the inline filter row and the skeleton are built from). */
  readonly columnKeys = computed(() => [
    ...(this.selecting() ? ['select'] : []),
    ...this.drawn().map((d) => d.key),
    ...(this.actions() ? ['actions'] : []),
  ]);
  protected readonly skeleton = computed(() => {
    const bones = this.bones();
    return this.columnKeys().map(
      (k) => bones[k] ?? (k === 'select' ? '1rem' : k === 'actions' ? '1rem' : '6rem'),
    );
  });

  constructor() {
    // "Reset Width": the stored widths are gone, the table goes back to its own layout.
    effect(() => {
      const version = this.grid().widthsVersion();
      if (version > 0) untracked(() => this.resizer()?.reset());
    });
  }

  protected cellOf(key: string): TemplateRef<{ $implicit: unknown }> | null {
    return this.byKey().get(key) ?? null;
  }
}
