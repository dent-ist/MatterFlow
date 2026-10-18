import { ColumnDef } from './column-prefs';
import { SortDirection } from './queue-filters';

/**
 * The pure side of the column header menu (#207): which items a column gets and what Widen and Narrow do to a width. No DOM here, so the
 * grid imports it without pulling in the menu component (which loads on first use).
 */
export type ColumnMenuId = 'sort-asc' | 'sort-desc' | 'widen' | 'narrow' | 'fit' | 'reset' | 'hide';

export interface ColumnMenuItem {
  id: ColumnMenuId;
  /** The visible text. */
  label: string;
  /** The accessible name: the label and the column ("Widen Due"). It starts with the visible text (WCAG 2.5.3). */
  name: string;
  /** A visible second line explaining why the item is off ("Fills the space left"). */
  hint?: string;
  /** Shown dimmed and does nothing; still reachable with the arrow keys so the person learns why. */
  disabled: boolean;
}

/** Widen and Narrow step, CSS px at the default zoom (the larger 32 px step is in the Columns panel, #206). */
export const WIDTH_STEP_PX = 8;

/** The width after one step in whole px, clamped to the column's limits. */
export function steppedPx(def: ColumnDef, currentPx: number, direction: 1 | -1): number {
  return Math.min(
    def.maxWidth,
    Math.max(def.minWidth, Math.round(currentPx) + direction * WIDTH_STEP_PX),
  );
}

export interface ColumnMenuState {
  /** The width in force, px at the default zoom. */
  currentPx: number;
  /** True when the user stored a width for this column (enables "Reset width"). */
  stored: boolean;
  /** Narrow-box and phone rules do not matter here: the grid does not open the menu on a phone. */
  canHide: boolean;
}

/**
 * The items of a column's menu, in order. Sort comes first for a sortable column; the Title (the spring) has no width items, only a
 * disabled "Fit to content" that says why; Ref and Title cannot be hidden.
 */
export function columnMenuItems(def: ColumnDef, state: ColumnMenuState): ColumnMenuItem[] {
  const item = (
    id: ColumnMenuId,
    label: string,
    disabled = false,
    hint?: string,
  ): ColumnMenuItem => ({
    id,
    label,
    name: `${label} ${def.label}${hint ? `, ${hint}` : ''}`,
    disabled,
    ...(hint ? { hint } : {}),
  });
  const items: ColumnMenuItem[] = [];
  if (def.sortField) {
    items.push(item('sort-asc', 'Sort ascending'), item('sort-desc', 'Sort descending'));
  }
  if (def.fill || def.resizable === false) {
    items.push(item('fit', 'Fit to content', true, 'Fills the space left'));
  } else {
    items.push(
      item('widen', 'Widen', state.currentPx >= def.maxWidth),
      item('narrow', 'Narrow', state.currentPx <= def.minWidth),
      item('fit', 'Fit to content'),
      item('reset', 'Reset width', !state.stored),
    );
  }
  if (state.canHide && !def.locked) items.push(item('hide', 'Hide column'));
  return items;
}

/** What the grid tells the page besides a new width: the page owns the sort, the column set and the stored widths. */
export type ColumnAction =
  | { kind: 'sort'; field: string; dir: SortDirection }
  | { kind: 'hide'; key: string }
  | { kind: 'reset'; key: string };

/** The polite message after a width change: "Due column 144 pixels". */
export const widthMessage = (def: ColumnDef, px: number): string =>
  `${def.label} column ${Math.round(px)} pixels`;
