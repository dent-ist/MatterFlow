import { ColumnDef } from './column-prefs';

/**
 * Column widths of the work grids (#200). The extension point of the resize package (#203 to #207):
 *
 *  - a `ColumnWidthMap` is a sparse map `column key -> width in rem`; the grid takes it as its `colWidths` input (one signal map);
 *  - a column without an entry has its `ColumnDef.width` default; an entry is clamped to the column's `minWidth` and `maxWidth`;
 *  - the Title (`fill`) never takes an entry;
 *  - the grid writes the result as CSS custom properties on the table (`--w-due: 8.5rem`), read by the `<col>` of each column.
 *
 * Widths are px in the definitions (the review's numbers) and `rem` everywhere they are applied, so text-only zoom scales the columns
 * (WCAG 1.4.4). The root font size of the app is 14 px (`html { font-size: var(--mf-fs-md) }`), not the browser's 16: `ROOT_PX` is that
 * root, so a column declared 136 px is 136 px at the default zoom. The resize package must convert its pixel widths with `pxToRem` and
 * `remToPx`, never with a hard-coded 16.
 */
export type ColumnWidthMap = Readonly<Record<string, number>>;

/** Default width of the Assignee column where a row says "Unassigned" and offers "Assign to me" beside it (Pod Work, #199): both on one line. */
export const ASSIGNEE_WITH_LINK_PX = 216;

/** The root font size of the app (styles.scss: `html { font-size: var(--mf-fs-md) }`, 14 px). */
export const ROOT_PX = 14;
export const pxToRem = (px: number): number => px / ROOT_PX;
export const remToPx = (rem: number): number => rem * ROOT_PX;

/** The width of a column in rem: the stored width if any (clamped), else its default. */
export function columnWidthRem(def: ColumnDef, overrides?: ColumnWidthMap): number {
  const stored = def.fill || def.resizable === false ? undefined : overrides?.[def.key];
  if (stored === undefined || !Number.isFinite(stored)) return pxToRem(def.width);
  return Math.min(pxToRem(def.maxWidth), Math.max(pxToRem(def.minWidth), stored));
}

/** The CSS custom properties of the table: `--w-<key>` per column (not the fill column). */
export function widthVars(
  defs: readonly ColumnDef[],
  overrides: ColumnWidthMap | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const d of defs) {
    if (!d.fill) vars[`--w-${d.key}`] = `${columnWidthRem(d, overrides)}rem`;
  }
  return vars;
}

/** The narrowest the table may be (rem): the widths of the fixed columns plus the minimum of the fill column. Below it the grid scrolls. */
export function tableMinRem(
  defs: readonly ColumnDef[],
  overrides: ColumnWidthMap | undefined,
): number {
  let sum = 0;
  for (const d of defs) sum += d.fill ? pxToRem(d.minWidth) : columnWidthRem(d, overrides);
  return sum;
}
