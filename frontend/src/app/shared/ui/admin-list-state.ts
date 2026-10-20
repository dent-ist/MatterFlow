import { Signal, computed } from '@angular/core';
import type { ListFilters } from '../filters/list-filters';
import type { LoadState } from './data-table';

/**
 * What an admin list shows in its body (#575). The grid body and the phone cards draw the same six views, so a page never decides them twice:
 *
 *  - `loading`   five skeleton rows of the page's real columns and one polite "Loading ..."
 *  - `forbidden` "You don't have access to ..." (a 403 on the list's own request; no Retry)
 *  - `error`     "Couldn't load ..." with the error reference and Retry
 *  - `empty`     the first-run text; the New action lives in the page header only (no second button in the body)
 *  - `no-match`  "No ... match these filters" with Clear filters, and "n inactive hidden - Show all" when the default Status hides records
 *  - `rows`      the rows
 */
export type AdminListView = 'loading' | 'forbidden' | 'error' | 'empty' | 'no-match' | 'rows';

/** The pure rule behind `AdminListState`: a load state, the number of rows and whether a filter is on. */
export function adminListView(input: {
  state: LoadState;
  rows: number;
  filtered: boolean;
}): AdminListView {
  if (input.state !== 'ready') return input.state;
  if (input.rows > 0) return 'rows';
  return input.filtered ? 'no-match' : 'empty';
}

/** What `adminListState()` reads from the page. Everything is a signal, so the derived state follows the page. */
export interface AdminListStateSource {
  /** `loading` until the first answer, `error` / `forbidden` after a failed one, else `ready`. */
  readonly state: Signal<LoadState>;
  /** The rows the list shows now (after filters): a number, or the array itself. */
  readonly rows: Signal<number | readonly unknown[]>;
  /** The page's filters. `filtered` is "a filter is on" (`activeCount() > 0`); omit for a list without filters. */
  readonly filters?: ListFilters | null;
  /** Overrides `filters` when the page decides itself what counts as a filter. */
  readonly filtered?: Signal<boolean>;
  /** Records the default Status hides (`hiddenCount`); 0 or omitted when none. */
  readonly hidden?: Signal<number>;
}

/**
 * The four states of an admin list derived from `loading / error / items / filters` (#575). Bind it to `tbody[mfGridBody]` and to
 * `mf-record-card-list`, so the table and the cards can never disagree:
 *
 *   readonly ls = adminListState({ state: this.state, rows: this.rows, filters: this.filters, hidden: this.hiddenCount });
 *
 *   <tbody mfGridBody noun="asset types" [columnSpec]="cols" [filters]="filters" [state]="ls.state()" [empty]="ls.empty()"
 *          [filtered]="ls.filtered()" [hidden]="ls.hidden()" (retry)="load()" (clear)="clear()" (showAll)="showAll()">
 */
export class AdminListState {
  readonly state: Signal<LoadState>;
  /** True when the loaded list has no rows to show (a filtered or a first-run empty list). */
  readonly empty: Signal<boolean>;
  /** A filter is on: the empty list then reads "No ... match these filters" instead of the first-run text. */
  readonly filtered: Signal<boolean>;
  readonly hidden: Signal<number>;
  readonly view: Signal<AdminListView>;

  constructor(src: AdminListStateSource) {
    this.state = src.state;
    const count = computed(() => {
      const rows = src.rows();
      return typeof rows === 'number' ? rows : rows.length;
    });
    this.filtered = src.filtered ?? computed(() => (src.filters?.activeCount() ?? 0) > 0);
    this.empty = computed(() => count() === 0);
    this.hidden = src.hidden ?? computed(() => 0);
    this.view = computed(() =>
      adminListView({ state: src.state(), rows: count(), filtered: this.filtered() }),
    );
  }
}

/** Builds the state of an admin list (see `AdminListState`). */
export function adminListState(src: AdminListStateSource): AdminListState {
  return new AdminListState(src);
}

/**
 * One column of an admin grid, written once and used by the header, the cells and the skeleton (#575, #579): the skeleton of the loading
 * state then has the real columns and the loaded table keeps its shape (no layout shift).
 */
export interface AdminColumn {
  /** The cell class of the loaded column (`mf-cell-name`, `mf-cell-num`, ...), repeated on its skeleton cell. */
  readonly cls?: string;
  /** Width of the skeleton bone (a CSS length); about the width of the column's usual content. */
  readonly bone?: string;
  /** The `data-drop` width (640, 768, 900, 1100, 1280): the window width below which the column is hidden (see `columnDropOrder`). */
  readonly drop?: number | null;
}
