import { Injectable, signal } from '@angular/core';
import { ColumnScope, WORK_COLUMNS } from './column-prefs';
import { ColumnWidthMap, pxToRem, remToPx } from './column-widths';

/**
 * Column widths a user chose (#203): the storage behind the resize package (drag handle #204, fit #205, Columns panel #206, header menu
 * #207). No UI here.
 *
 *  - Key `mf.work-widths.v1.<scope>.<userId>` (`anon` without a user), value `{"v":1,"w":{"due":132,"matter":176}}`. The scope is
 *    `columnScope(page, tab)` like the column sets (`mf.work-columns.v2.*`); widths never fall back to another scope, do not depend on the
 *    density, and survive hiding and showing a column.
 *  - Sparse: only a column the user changed has an entry; a column without one follows the default in `WORK_COLUMNS`, so a changed default
 *    reaches everybody who never touched it. A width equal to the default is not stored.
 *  - Stored numbers are integer CSS px at the default zoom (the app's root is 14 px, `ROOT_PX`; the review's numbers). The API in and out
 *    is rem (`ColumnWidthMap`, the grid's `colWidths` input): convert with `pxToRem` / `remToPx`, never with 16.
 *  - Reads clamp to the column's current min and max (a max that shrinks never traps a user) and ignore the Title, unknown keys,
 *    non-numbers and corrupt JSON. Every storage access is guarded: blocked or full storage means widths do not persist (they still
 *    hold for the visit in the store) and nothing throws.
 */
const WIDTHS_VERSION = 1;

const who = (userId: number | null) => userId ?? 'anon';
export const widthsKey = (scope: ColumnScope, userId: number | null): string =>
  `mf.work-widths.v${WIDTHS_VERSION}.${scope}.${who(userId)}`;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored widths of one scope as a sparse rem map, clamped to the columns' limits. Never throws. */
export function loadWidths(scope: ColumnScope, userId: number | null): ColumnWidthMap {
  let raw: unknown;
  try {
    const text = storage()?.getItem(widthsKey(scope, userId));
    raw = text ? JSON.parse(text) : null;
  } catch {
    return {};
  }
  const w = (raw as { v?: unknown; w?: unknown } | null)?.w;
  if (!raw || (raw as { v?: unknown }).v !== WIDTHS_VERSION || !w || typeof w !== 'object')
    return {};
  const out: Record<string, number> = {};
  for (const def of WORK_COLUMNS) {
    if (def.fill || def.resizable === false) continue;
    const value = (w as Record<string, unknown>)[def.key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    out[def.key] = pxToRem(clampPx(def.key, value));
  }
  return out;
}

/** A width in px clamped to the column's limits and rounded to a whole pixel. */
export function clampPx(key: string, px: number): number {
  const def = WORK_COLUMNS.find((c) => c.key === key);
  if (!def) return Math.round(px);
  return Math.round(Math.min(def.maxWidth, Math.max(def.minWidth, px)));
}

function write(scope: ColumnScope, userId: number | null, widths: ColumnWidthMap): void {
  try {
    const store = storage();
    if (!store) return;
    const keys = Object.keys(widths);
    if (keys.length === 0) {
      store.removeItem(widthsKey(scope, userId));
      return;
    }
    const w: Record<string, number> = {};
    for (const k of keys) w[k] = Math.round(remToPx(widths[k]));
    store.setItem(widthsKey(scope, userId), JSON.stringify({ v: WIDTHS_VERSION, w }));
  } catch {
    // Private window, blocked or full storage: the widths just do not persist.
  }
}

/**
 * The map with one column's width (rem) set: the Title, unknown columns and non-numbers change nothing; the value is clamped to the
 * column's limits; a value equal to the default (`defaultRem`, else the column's `width`) removes the entry, so the store stays sparse.
 */
function withWidth(
  current: ColumnWidthMap,
  key: string,
  rem: number,
  defaultRem?: number,
): ColumnWidthMap {
  const def = WORK_COLUMNS.find((c) => c.key === key);
  if (!def || def.fill || def.resizable === false || !Number.isFinite(rem)) return current;
  const next: Record<string, number> = { ...current };
  const px = clampPx(key, remToPx(rem));
  const base = defaultRem === undefined ? def.width : remToPx(defaultRem);
  if (px === Math.round(base)) delete next[key];
  else next[key] = pxToRem(px);
  return next;
}

/** Remembers one column's width (rem) in one scope (rules: `withWidth`). */
export function saveWidth(
  scope: ColumnScope,
  userId: number | null,
  key: string,
  rem: number,
  defaultRem?: number,
): void {
  write(scope, userId, withWidth(loadWidths(scope, userId), key, rem, defaultRem));
}

/** Forgets one column's width in one scope: its default returns. */
export function resetWidth(scope: ColumnScope, userId: number | null, key: string): void {
  const next: Record<string, number> = { ...loadWidths(scope, userId) };
  delete next[key];
  write(scope, userId, next);
}

/** Forgets every width of one scope ("Reset widths"): the key is removed, other scopes and the column sets are untouched. */
export function resetWidths(scope: ColumnScope, userId: number | null): void {
  try {
    storage()?.removeItem(widthsKey(scope, userId));
  } catch {
    // Not persisted.
  }
}

/** True while the scope has a stored width: enables or disables a "Reset widths" button. */
export function hasWidths(scope: ColumnScope, userId: number | null): boolean {
  return Object.keys(loadWidths(scope, userId)).length > 0;
}

/**
 * The widths of the work grids as signals: the pages read `widths(scope, userId)` into the grid's `colWidths` input, and the resize
 * package calls `set`, `reset` and `resetAll`. A change shows at once (also with blocked storage, for the visit), and a tab change
 * is a different scope, so it follows by itself.
 */
@Injectable({ providedIn: 'root' })
export class WorkWidths {
  private readonly version = signal(0);
  private readonly cache = new Map<string, ColumnWidthMap>();

  /** The sparse rem map of a scope (stable object until it changes). Reading it inside a computed tracks changes. */
  widths(scope: ColumnScope, userId: number | null): ColumnWidthMap {
    this.version();
    const key = widthsKey(scope, userId);
    let map = this.cache.get(key);
    if (!map) {
      map = loadWidths(scope, userId);
      this.cache.set(key, map);
    }
    return map;
  }

  /** True while the scope has a width of its own: for a disabled "Reset widths". */
  has(scope: ColumnScope, userId: number | null): boolean {
    return Object.keys(this.widths(scope, userId)).length > 0;
  }

  /** Sets one column (rem; see `saveWidth` for the rules). `defaultRem` is the default in force where it differs (Pod Work's Assignee). */
  set(
    scope: ColumnScope,
    userId: number | null,
    key: string,
    rem: number,
    defaultRem?: number,
  ): void {
    const next = withWidth(this.widths(scope, userId), key, rem, defaultRem);
    if (next === this.widths(scope, userId)) return;
    this.replace(scope, userId, next);
  }

  reset(scope: ColumnScope, userId: number | null, key: string): void {
    const next: Record<string, number> = { ...this.widths(scope, userId) };
    delete next[key];
    this.replace(scope, userId, next);
  }

  resetAll(scope: ColumnScope, userId: number | null): void {
    this.replace(scope, userId, {});
  }

  private replace(scope: ColumnScope, userId: number | null, next: ColumnWidthMap): void {
    this.cache.set(widthsKey(scope, userId), next);
    write(scope, userId, next);
    this.version.update((v) => v + 1);
  }
}
