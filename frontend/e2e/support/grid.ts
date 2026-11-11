import { Locator, Page } from '@playwright/test';

/**
 * The rows of a data grid, whichever way the page marks them (E2E #1359). The lists of the app carry their row key in three places and the specs used to pick
 * one: the shared record grid puts `data-record-id` on the `tr` (Users, Pods, Workflows, Steps, Assets...), the list editors of the Lists epic put `data-row`
 * on the `tr` (Priorities, Status Labels, Link Roles, Matter lists, On-hold reasons) and some pages put `data-row` on the name cell, `td[data-row]` (Task Types,
 * Asset Types, Custom Fields, Reports). A selector for one of them found nothing on the others:
 *
 *   await expect(gridRows(page).first()).toBeVisible();
 *   await rowOf(page, 'Urgent').getByRole('button', { name: 'Actions' }).click();   // the row that shows this text
 *   await rowByKey(page, 'Urgent');                                                  // the row whose data-row is exactly this
 */
export const GRID_ROW_SELECTOR = 'tbody tr:is([data-row], [data-record-id], :has(> td[data-row]))';

/** The same rows, and the cards that stand in for them on a narrow window (`li.rc`). */
export const GRID_ROW_OR_CARD_SELECTOR = `${GRID_ROW_SELECTOR}, li.rc`;

/** Every data row of the grids in `scope` (a page or a region), not the heading, filter or skeleton rows. */
export const gridRows = (scope: Page | Locator): Locator => scope.locator(GRID_ROW_SELECTOR);

/** Rows and cards, for a spec that must work with both layouts. */
export const gridRowsOrCards = (scope: Page | Locator): Locator =>
  scope.locator(GRID_ROW_OR_CARD_SELECTOR);

/** The row of this text: the data rows whose text contains it (a regular expression is matched as given). */
export const rowOf = (scope: Page | Locator, text: string | RegExp): Locator =>
  gridRows(scope).filter({ hasText: text });

/**
 * The row whose key (`data-row`, on the row or on its name cell) is exactly this value, or, for a grid keyed by id, whose `data-record-id` is. The key of a row is
 * the name or label the page was given, so a name that another row contains as a part (Normal, Normal Plus) still finds one row.
 */
export const rowByKey = (scope: Page | Locator, key: string): Locator => {
  const quoted = JSON.stringify(key);
  return gridRows(scope).and(
    scope.locator(
      `tr[data-row=${quoted}], tr[data-record-id=${quoted}], tr:has(> td[data-row=${quoted}])`,
    ),
  );
};

/**
 * The row of a record by its name: the rows whose key (`data-row`, on the row or on its name cell) is exactly this name, or that hold a link or button showing it.
 * The workflow and step lists key their rows by id and carry no `data-row` at all, so the name is looked for in the row's link.
 */
export const rowNamed = (scope: Page | Locator, name: string): Locator => {
  const quoted = JSON.stringify(name);
  return gridRows(scope).and(
    scope.locator(
      `tr:has([data-row=${quoted}], a:has-text(${quoted}), button:has-text(${quoted}))`,
    ),
  );
};

/** The part of a row that shows this name (its `data-row` key or its link): for "the last row is X" assertions on rows of any marking. */
export const nameInRow = (row: Locator, name: string): Locator => {
  const quoted = JSON.stringify(name);
  return row
    .locator(`[data-row=${quoted}], a:has-text(${quoted}), button:has-text(${quoted})`)
    .first();
};

/** The scrolling box around a grid: the list editors' `.mf-table-wrap`, the scroll area of the shared grid frame, or the cards of a narrow window. */
export const gridScroller = (scope: Page | Locator): Locator =>
  scope.locator('.mf-table-wrap, mf-grid-frame .scroll, ul[data-record-cards]').first();
