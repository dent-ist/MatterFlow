/**
 * The column choice of one grid and one person (epic #1001, MD-28, #1032): the ORDER of the columns and which of them are SHOWN, remembered in
 * `localStorage` (`mf.grid.v1.<grid>.<userId|anon>`, every access guarded). Pure functions, no Angular: the grid component, the Columns menu and the
 * specs all use these. Widths are a separate store (`resizable-columns.ts`), so a reset of order and visibility never loses a width.
 *
 * Definition shape: `GridColumnDef` (key, label, optional `locked`, `defaultHidden`, `pinned`). A stored choice is sparse and safe: unknown keys are
 * ignored, a column the definitions gained later is placed where the definitions put it, a locked column is always shown.
 */
export interface GridColumnDef {
  /** Stable key: the storage, `data-col` of the header cell and the filter definition all use it. */
  readonly key: string;
  readonly label: string;
  /** Always shown, cannot be hidden (Ref, Title, Name). It may still be moved unless it is `pinned`. */
  readonly locked?: boolean;
  /** Not shown until the person adds it in the Columns menu. */
  readonly defaultHidden?: boolean;
  /** Stays first (a selection or reference column): it is neither moved nor moves other columns before it. */
  readonly pinned?: boolean;
}

export interface GridPrefs {
  /** Every known column key in the person's order (a subset is fine). */
  readonly order: readonly string[];
  /** The shown keys; null means the default visibility (nothing was ever chosen). */
  readonly visible: readonly string[] | null;
}

export const DEFAULT_GRID_PREFS: GridPrefs = { order: [], visible: null };

export const gridPrefsKey = (grid: string, userId: number | null | undefined): string =>
  `mf.grid.v1.${grid}.${userId ?? 'anon'}`;

export function loadGridPrefs(storageKey: string): GridPrefs {
  try {
    const text = localStorage.getItem(storageKey);
    const raw = (text ? JSON.parse(text) : null) as {
      v?: unknown;
      o?: unknown;
      s?: unknown;
    } | null;
    if (!raw || raw.v !== 1) return DEFAULT_GRID_PREFS;
    const strings = (x: unknown): string[] | null =>
      Array.isArray(x) && x.every((k) => typeof k === 'string') ? (x as string[]) : null;
    return { order: strings(raw.o) ?? [], visible: strings(raw.s) };
  } catch {
    return DEFAULT_GRID_PREFS;
  }
}

export function saveGridPrefs(storageKey: string, prefs: GridPrefs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ v: 1, o: prefs.order, s: prefs.visible }));
  } catch {
    // Blocked or full storage: the choice holds for this visit only.
  }
}

export function clearGridPrefs(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing stored that could be removed.
  }
}

/** All keys in the order to use: the stored order first, then the columns it does not know, in the order of the definitions; pinned ones first. */
export function orderedKeys(defs: readonly GridColumnDef[], prefs: GridPrefs): string[] {
  const known = new Set(defs.map((d) => d.key));
  const stored = prefs.order.filter((k, i) => known.has(k) && prefs.order.indexOf(k) === i);
  const rest = defs.map((d) => d.key).filter((k) => !stored.includes(k));
  // A column the person never ordered keeps its default neighbours: it goes after the column that precedes it in the definitions.
  const merged = [...stored];
  for (const key of rest) {
    const at = defs.findIndex((d) => d.key === key);
    const before = defs
      .slice(0, at)
      .map((d) => d.key)
      .reverse()
      .find((k) => merged.includes(k));
    merged.splice(before === undefined ? 0 : merged.indexOf(before) + 1, 0, key);
  }
  const pinned = defs.filter((d) => d.pinned).map((d) => d.key);
  return [...pinned, ...merged.filter((k) => !pinned.includes(k))];
}

/** Is a column shown under these prefs (locked: always)? */
export function isShown(def: GridColumnDef, prefs: GridPrefs): boolean {
  if (def.locked) return true;
  return prefs.visible ? prefs.visible.includes(def.key) : !def.defaultHidden;
}

/** The keys of the columns to draw, in order. */
export function shownKeys(defs: readonly GridColumnDef[], prefs: GridPrefs): string[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return orderedKeys(defs, prefs).filter((k) => isShown(byKey.get(k)!, prefs));
}

/** Moves a column one place (-1 left, +1 right) among the movable columns; pinned columns stay where they are. Returns the new full order. */
export function moveKey(
  defs: readonly GridColumnDef[],
  prefs: GridPrefs,
  key: string,
  delta: -1 | 1,
): string[] {
  const order = orderedKeys(defs, prefs);
  const pinned = new Set(defs.filter((d) => d.pinned).map((d) => d.key));
  if (pinned.has(key)) return order;
  const shown = new Set(shownKeys(defs, prefs));
  const at = order.indexOf(key);
  // The neighbour is the next SHOWN, movable column on that side, so a hidden column in between never swallows a press.
  let to = at + delta;
  while (to >= 0 && to < order.length && (pinned.has(order[to]) || !shown.has(order[to])))
    to += delta;
  if (at < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(at, 1);
  next.splice(to, 0, key);
  return next;
}

/** Drops `key` right before `beforeKey` (null: at the end); pinned columns never move and nothing goes before them. */
export function moveBefore(
  defs: readonly GridColumnDef[],
  prefs: GridPrefs,
  key: string,
  beforeKey: string | null,
): string[] {
  const order = orderedKeys(defs, prefs);
  const pinned = new Set(defs.filter((d) => d.pinned).map((d) => d.key));
  if (pinned.has(key) || key === beforeKey || (beforeKey !== null && pinned.has(beforeKey)))
    return order;
  const next = order.filter((k) => k !== key);
  const at = beforeKey === null ? next.length : next.indexOf(beforeKey);
  if (at < 0) return order;
  next.splice(at, 0, key);
  return next;
}

/** Shows or hides one column (a locked column ignores a hide). Returns the new visible list, with the defaults made explicit. */
export function withVisible(
  defs: readonly GridColumnDef[],
  prefs: GridPrefs,
  key: string,
  on: boolean,
): string[] {
  const current = new Set(defs.filter((d) => isShown(d, prefs)).map((d) => d.key));
  const def = defs.find((d) => d.key === key);
  if (!def || def.locked) return [...current];
  if (on) current.add(key);
  else current.delete(key);
  return defs.filter((d) => d.locked || current.has(d.key)).map((d) => d.key);
}
