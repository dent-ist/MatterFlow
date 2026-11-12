import { MATTER_TABS, MatterTabKey } from '../../src/app/features/matters/ui/matter-tabs';
import { WORK_COLUMNS } from '../../src/app/shared/work-queue/column-prefs';

/**
 * Counts of the application that many specs used to hard-code (7 tabs became 8 with a tab, and back to 7 when the Team moved into the Summary, 8 columns became 9 with the asset numbering: about twelve files
 * had to be edited each time; E2E #1359). One place now; `app-counts.spec.ts` fails when the application no longer agrees, so a change of the application
 * is fixed here once.
 */

/**
 * The tabs of the Matter page, in order, for a viewer who sees all of them (the System Admin). The source of truth is the registry the page itself builds its
 * strip from (`src/app/features/matters/ui/matter-tabs.ts`), imported, not copied: a new tab is a new entry there and every spec follows.
 */
export const MATTER_TAB_KEYS: readonly MatterTabKey[] = MATTER_TABS.map((t) => t.key);
export const MATTER_TAB_LABELS: readonly string[] = MATTER_TABS.map((t) => t.label);
export const MATTER_TAB_COUNT = MATTER_TABS.length;

/**
 * One pattern per tab of the Matter page, in order, for `expect(page.getByRole('tab')).toHaveText(matterTabPatterns())`. A tab matches its label anywhere in its text
 * (the count in parentheses follows the label); `override` gives a stricter pattern for the tabs a spec checks closely.
 */
export function matterTabPatterns(override: Partial<Record<MatterTabKey, RegExp>> = {}): RegExp[] {
  return MATTER_TABS.map((t) => override[t.key] ?? new RegExp(t.label));
}

/**
 * The text of each tab of the Matter page, in order, for `toHaveText(matterTabTexts(...))` (it compares with the spaces collapsed): the label, and after it the
 * suffix given for its key (the reserved count of a skeleton, " (--)").
 */
export function matterTabTexts(suffix: Partial<Record<MatterTabKey, string>> = {}): string[] {
  return MATTER_TABS.map((t) => `${t.label}${suffix[t.key] ?? ''}`);
}

/**
 * Header cells (`thead tr:first-child th`) of the Assets list for a viewer who sees every column: the selection box, Name, Type, Matter, Size, External
 * Reference, Linked Tasks, Disposition and the numbering column of #1297. The Assets list has no column registry (its columns are written in the page template,
 * `src/app/features/assets/pages/assets-list-page.ts`), so this number is a constant and `app-counts.spec.ts` checks it against the real page.
 */
export const ASSETS_LIST_COLUMN_COUNT = 9;

/**
 * The width the Title column of every task grid keeps however narrow the window is (it is the spring of the grid; the Type chip and name took room from it in
 * UI2 #1232, so it is 120 px, no longer 160). Read from the column registry the grids use.
 */
export const TASK_TITLE_MIN_WIDTH: number = WORK_COLUMNS.find((c) => c.key === 'title')!.minWidth;
