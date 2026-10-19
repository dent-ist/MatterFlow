import { ColumnDef } from './column-prefs';
import { ColumnWidthMap, columnWidthRem } from './column-widths';

/**
 * The one narrow-box rule of the work grids (#201). While the Title would be narrower than `TITLE_MIN_BOX_PX`, columns flagged
 * `autoHide` drop out of the table in `NARROW_DROP_ORDER` (the least important first). Priority, Due, Status, Assignee, Matter Number, Ref,
 * Title and Closed are never dropped; if they alone do not fit, the grid scrolls sideways (hint, sticky Ref). It replaces the three
 * width constants of UXR4-02 and the tablet band of WP9.
 */
export const TITLE_MIN_BOX_PX = 200;

/**
 * Least important first. Matter Name (#348) goes first: it is the newest default column, and measured, the Task Queue default with it needs a
 * 1140 px box (a 1366 px window has 1098, a 1440 px window 1172), so in a box that cannot hold it the columns the person had before (and
 * the ones they added: Age, Updated, Client, Workflow progress) keep their room instead of being dropped one by one before it.
 */
export const NARROW_DROP_ORDER: readonly string[] = [
  'matterName',
  'updated',
  'created',
  'age',
  'project',
  'workflow',
  'type',
  'pod',
  'requestor',
  'creator',
  'progress',
  'client',
];

/**
 * The keys to drop from `defs` (the columns that would be shown) in a box `boxPx` wide. `rootPx` is the real root font size (text-only zoom
 * grows it), because widths are rem. A box of 0 (not measured yet, or a test) drops nothing.
 */
export function narrowDrops(
  defs: readonly ColumnDef[],
  boxPx: number,
  rootPx: number,
  overrides?: ColumnWidthMap,
): Set<string> {
  const dropped = new Set<string>();
  if (!(boxPx > 0)) return dropped;
  let fixed = 0;
  for (const d of defs) if (!d.fill) fixed += columnWidthRem(d, overrides) * rootPx;
  for (const key of NARROW_DROP_ORDER) {
    if (boxPx - fixed >= TITLE_MIN_BOX_PX) break;
    const def = defs.find((d) => d.key === key && d.autoHide);
    if (!def) continue;
    dropped.add(key);
    fixed -= columnWidthRem(def, overrides) * rootPx;
  }
  return dropped;
}
