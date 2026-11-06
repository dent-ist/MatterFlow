import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  TemplateRef,
  WritableSignal,
  Signal,
  ViewEncapsulation,
  afterNextRender,
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
import { CopyPart } from './copy-parts';
import type { ListFilters } from '../filters/list-filters';
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
import { rowOfBareClick } from './row-nav';
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

/** A group of rows (`RecordGrid.groupBy`, #1245): its key (stable, for the collapsed state) and the words of its header row ("Archived"). */
export interface RecordGroup {
  readonly key: string;
  readonly label: string;
}

/** What `groupToggle` tells the page: the group's key and whether it is open now. */
export interface RecordGroupToggle {
  readonly key: string;
  readonly open: boolean;
}

/** One drawn line of the body: a group header row or a record row. */
interface BodyItem<T> {
  readonly track: string | number | unknown;
  readonly group?: RecordGroup;
  readonly count?: number;
  readonly open?: boolean;
  readonly row?: T;
}

/**
 * Makes a row that holds no link or button of its own a Tab stop (`mf-record-grid` `rowClickable`, #1245): a row with a link keeps the link as its
 * keyboard way in, so one row is never two Tab stops.
 */
@Directive({ selector: 'tr[mfRowFocus]' })
export class RecordRowFocus {
  private readonly row = inject<ElementRef<HTMLTableRowElement>>(ElementRef).nativeElement;
  readonly mfRowFocus = input(false);

  constructor() {
    afterNextRender(() => {
      if (this.mfRowFocus() && !this.row.querySelector('a[href], button, [tabindex]')) {
        this.row.tabIndex = 0;
      }
    });
  }
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
 *
 * Extension points (#1245; each has a spec in `record-grid.spec.ts`):
 *  - `[groupBy]="fn"`: `fn(row)` returns `{ key, label }` or null (a row without a group). Rows of one group must be next to each other in `rows`.
 *    Each run gets a header row (36 px, `scope="colgroup"`, a text button with the chevron, `aria-expanded`, "Archived (3)"), Enter and Space
 *    toggle it. `[collapsedGroups]="['archived']"` lists the groups that start closed (a new array resets the choice); `(groupToggle)` reports a toggle.
 *  - `[rowClass]="fn"`: `fn(row)` gives extra CSS class names of that row; "is-selected" is styled by the grid (a ticked row), other names by the page or the theme.
 *  - `[rowClickable]="true"` and `(rowClick)="open($event)"`: a click on the row (not on a link, button, field or menu inside it), and Enter or Space
 *    on the focused row, emit the row. A row that has its own link (`a[mfRowLink]`, `[data-row-open]`) is opened by the shell for the link, as always: the link
 *    stays a link and `rowClick` does not fire for it. A row without a link or button is a Tab stop so the keyboard reaches it.
 *  - Every record row carries `data-record-id` (the `rowKey` value) for tests and scripts.
 *  - `actions`: the row-action column ("..." menu, `mfCell="actions"`), always 48 px (`--mf-col-actions-w`), never resized or stored.
 *  - `mfEmptyAction`: the "+ New <Thing>" button of the empty body (D-51).
 *
 * Every column gives a `width` or `minWidth` (tokens `--mf-col-*-w`, D-43) except the one spring column, so the headings keep their widths while the
 * list loads, is empty, fails or shows rows.
 */
@Component({
  selector: 'mf-record-grid',
  imports: [
    NgTemplateOutlet,
    GridFrame,
    GridBody,
    SortHeader,
    ResizableColumns,
    ReorderColumns,
    RecordRowFocus,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The cells come from the page's own templates, so the grid styles (`.pg-table td`, rows 44, header 40) must not be scoped to this component.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './page.scss',
  styles: `
    mf-record-grid {
      display: contents;
    }
    /* The select column is as wide as its checkbox and 4 px each side (a page may ask for more on its row cell): the header checkbox sits over the row checkboxes, both centred. */
    .pg-table.tt th.rg-select {
      width: 1.5rem;
      padding-inline: var(--mf-s1);
      text-align: center;
    }
    .pg-table.tt th.rg-select input {
      margin: 0;
    }
    /* A group header row (#1245): 36 px, under the rows above it, the toggle is a text button. */
    .pg-table .rg-group th {
      height: var(--mf-grid-group-h);
      padding: 0 var(--mf-s2);
      border-bottom: 1px solid var(--mf-border-strong);
      text-transform: none;
      letter-spacing: normal;
    }
    .rg-group .pi {
      font-size: var(--mf-icon-xs);
    }
    .rg-group__count {
      color: var(--mf-text-muted);
      font-weight: 400;
    }
    /* A row class "is-selected" (rowClass) gives the selected look of a ticked row. */
    .pg-table tbody tr.is-selected {
      background: var(--mf-selected-bg);
    }
    .pg-table tbody tr.rg-row--click {
      cursor: pointer;
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
            [fixed]="true"
            [emptyText]="emptyText()"
            [emptyParts]="emptyParts()"
            [filters]="filters()"
            [hidden]="hidden()"
            [hiddenLabel]="hiddenLabel()"
            (retry)="retry.emit()"
            (clear)="clear.emit()"
            (showAll)="showAll.emit()"
          >
            <ng-container ngProjectAs="[mfEmptyAction]">
              <ng-content select="[mfEmptyAction]" />
            </ng-container>
            @for (it of items(); track it.track) {
              @if (it.group; as g) {
                <tr class="rg-group" [attr.data-group]="g.key">
                  <th scope="colgroup" [attr.colspan]="columnKeys().length">
                    <button
                      type="button"
                      class="mf-btn mf-btn--text"
                      [attr.aria-expanded]="it.open ? 'true' : 'false'"
                      (click)="toggleGroup(g.key)"
                    >
                      <i
                        class="pi"
                        [class.pi-chevron-down]="it.open"
                        [class.pi-chevron-right]="!it.open"
                        aria-hidden="true"
                      ></i>
                      <span
                        >{{ g.label }} <span class="rg-group__count">({{ it.count }})</span></span
                      >
                    </button>
                  </th>
                </tr>
              } @else {
                <tr
                  [attr.data-record-id]="it.track"
                  [mfRowFocus]="rowClickable()"
                  [class]="rowClassOf(it.row)"
                  [class.rg-row--click]="rowClickable()"
                  (click)="onRowClick($event, it.row)"
                  (keydown)="onRowKey($event, it.row)"
                >
                  @if (selecting()) {
                    <ng-container
                      *ngTemplateOutlet="cellOf('select'); context: { $implicit: it.row }"
                    />
                  }
                  @for (d of drawn(); track d.key) {
                    <ng-container
                      *ngTemplateOutlet="cellOf(d.key); context: { $implicit: it.row }"
                    />
                  }
                  @if (actions()) {
                    <ng-container
                      *ngTemplateOutlet="cellOf('actions'); context: { $implicit: it.row }"
                    />
                  }
                </tr>
              }
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
  /** The empty sentence with a link in it (copy parts), instead of `emptyText`; shown when the list is empty and not filtered. */
  readonly emptyParts = input<readonly CopyPart[] | null>(null);
  /** The page's filters: the empty body then says what was searched (No results for "zzz") and the bar above shows no second Clear Filters. */
  readonly filters = input<ListFilters | null>(null);
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
  /** Group header rows (#1245): the group of a row, or null for a row without one. Rows of one group are next to each other. */
  readonly groupBy = input<((row: T) => RecordGroup | null) | null>(null);
  /** The keys of the groups that start closed; a new array resets what the person toggled. */
  readonly collapsedGroups = input<readonly string[]>([]);
  /** Extra CSS class names of a row (#1245): the "inactive" or "selected" style of the page. */
  readonly rowClass = input<((row: T) => string | null | undefined) | null>(null);
  /** The whole row is clickable and a Tab stop when it has no link of its own (#1245); `rowClick` carries the row. */
  readonly rowClickable = input(false);

  readonly sorted = output<string>();
  readonly retry = output<void>();
  readonly clear = output<void>();
  readonly showAll = output<void>();
  readonly selectAll = output<boolean>();
  /** A group header was opened or closed (#1245). */
  readonly groupToggle = output<RecordGroupToggle>();
  /** A row was clicked, or Enter or Space was pressed on it (#1245); see `rowClickable`. */
  readonly rowClick = output<T>();

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
  private readonly closed = signal<ReadonlySet<string>>(new Set());
  /** The lines of the body: the rows, with a header row before each group and the rows of a closed group left out. */
  protected readonly items = computed<BodyItem<T>[]>(() => {
    const rows = this.rows();
    const keyOf = this.rowKey();
    const groupOf = this.groupBy();
    const closed = this.closed();
    const out: BodyItem<T>[] = [];
    if (!groupOf) {
      rows.forEach((row, i) => out.push({ track: keyOf(row, i), row }));
      return out;
    }
    let i = 0;
    while (i < rows.length) {
      const g = groupOf(rows[i]);
      if (!g) {
        out.push({ track: keyOf(rows[i], i), row: rows[i] });
        i++;
        continue;
      }
      let end = i;
      while (end < rows.length && groupOf(rows[end])?.key === g.key) end++;
      const open = !closed.has(g.key);
      out.push({ track: `group:${g.key}:${i}`, group: g, count: end - i, open });
      if (open) for (let n = i; n < end; n++) out.push({ track: keyOf(rows[n], n), row: rows[n] });
      i = end;
    }
    return out;
  });

  protected readonly skeleton = computed(() => {
    const bones = this.bones();
    return this.columnKeys().map(
      (k) => bones[k] ?? (k === 'select' ? '1rem' : k === 'actions' ? '1rem' : '6rem'),
    );
  });

  constructor() {
    // The groups that start closed come from the page; a new list resets what the person toggled.
    effect(() => {
      const initial = this.collapsedGroups();
      untracked(() => this.closed.set(new Set(initial)));
    });
    // "Reset Width": the stored widths are gone, the table goes back to its own layout.
    effect(() => {
      const version = this.grid().widthsVersion();
      if (version > 0) untracked(() => this.resizer()?.reset());
    });
  }

  protected toggleGroup(key: string): void {
    const next = new Set(this.closed());
    const open = next.has(key);
    if (open) next.delete(key);
    else next.add(key);
    this.closed.set(next);
    this.groupToggle.emit({ key, open });
  }

  protected rowClassOf(row: T | undefined): string | null {
    const fn = this.rowClass();
    return fn && row !== undefined ? (fn(row) ?? null) : null;
  }

  protected onRowClick(event: MouseEvent, row: T | undefined): void {
    if (!this.rowClickable() || row === undefined) return;
    const tr = rowOfBareClick(event);
    // A row with a link of its own is opened by the shell through that link (the link stays a link).
    if (!tr || tr.querySelector('a[data-row-list], [data-row-open]')) return;
    this.rowClick.emit(row);
  }

  protected onRowKey(event: KeyboardEvent, row: T | undefined): void {
    if (!this.rowClickable() || row === undefined) return;
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.rowClick.emit(row);
  }

  protected cellOf(key: string): TemplateRef<{ $implicit: unknown }> | null {
    return this.byKey().get(key) ?? null;
  }
}
