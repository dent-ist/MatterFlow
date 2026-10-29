import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { MmWorld, inDays, mmWorld } from '../support/my-matters-fixtures';
import { noHorizontalScroll, shot } from '../support/screens';

/**
 * The Activity grid and the Breakdown (epic #893, issues #946, #911, #912, #907): what the owner asked to SEE, measured on the real page.
 *  - Activity: one line a row (44 px), the same columns in the same place on every row, a Matter column only with several matters, 25 to a page, cards on a phone;
 *  - Breakdown: only the task types in use, one header line, one link and one number per cell with a "!" for late work, the Focus said in words, and on a
 *    phone one compact card per matter (four matters at most 1,100 px tall, every chip a 44 px link with its type, count and overdue count in its name).
 */
interface Fixture {
  w: MmWorld;
  types: { id: number; name: string }[];
}

/** Four matters, three task types in use (and a fourth type with no task), one late task. */
async function fixture(
  seed: import('../support/seed').Seeder,
  personas: import('../support/personas').Personas,
  label: string,
): Promise<Fixture> {
  const w = await mmWorld(seed, personas, label);
  const extra = [
    await seed.taskType({ workflows: [w.world.workflow] }),
    await seed.taskType({ workflows: [w.world.workflow] }),
  ];
  await seed.taskType({ workflows: [w.world.workflow] }); // in use nowhere: no column
  const matters = [
    await w.matter('Alpha'),
    await w.matter('Bravo'),
    await w.matter('Charlie'),
    await w.matter('Delta'),
  ];
  for (const [i, m] of matters.entries()) {
    await w.task(m, { dueDate: inDays(5 + i) });
    await w.task(m, { taskTypeId: extra[0].id, dueDate: inDays(6 + i) });
    if (i % 2 === 0) await w.task(m, { taskTypeId: extra[1].id });
    for (let j = 0; j < 3; j++) await w.task(m, { dueDate: inDays(10 + j) });
  }
  await w.task(matters[0], { taskTypeId: extra[0].id, dueDate: '2000-01-01' });
  return { w, types: extra.map((t) => ({ id: t.id, name: t.name })) };
}

const settled = async (page: Page): Promise<void> => {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-mm-body]')).toHaveCSS('visibility', 'visible');
};

test.describe('Breakdown (#911, #912, #907)', () => {
  test('1366x768: only the types in use, one header line, one link and one number per cell, a "!" for late work, Options holds On hold only and Export', async ({
    seed,
    personas,
    asUser,
  }) => {
    const f = await fixture(seed, personas, 'bd1');
    const page = await asUser(f.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters?tab=breakdown');
    await settled(page);
    const table = page.locator('table[data-bd-table="matrix"]');
    await expect(table).toBeVisible();
    // The default type, the two used ones and the Total: not the fourth type, which has no task.
    await expect(table.locator('thead th[data-bd-col]')).toHaveCount(3);
    const heads = await table.locator('thead th').all();
    const heights = await Promise.all(heads.map(async (h) => (await h.boundingBox())!.height));
    for (const h of heights) expect(h, 'one line of header').toBeLessThanOrEqual(heights[0] + 1);
    expect(heights[0]).toBeLessThan(48);
    // One link in every cell with a number; the late one carries the mark and says so in its name.
    for (const cell of await table.locator('tbody td').all())
      expect(await cell.locator('a').count()).toBeLessThanOrEqual(1);
    const late = table.locator('a[data-bd-cell]:has([data-bd-overdue])');
    await expect(late).toHaveCount(1);
    await expect(late).toHaveAttribute('aria-label', /1 overdue/);
    await expect(table.locator('tfoot')).toContainText('All matters');
    // Choices live in Options: no toolbar of its own, the toggle only because there are four matters.
    await expect(page.locator('[data-bd-view]')).toHaveCount(2);
    await expect(page.locator('[data-bd-status]')).toHaveCount(0);
    await expect(page.locator('[data-panel=breakdown] [data-bd-onhold]')).toBeHidden();
    await page.locator('[data-panel=breakdown] [data-options-trigger]').click();
    await expect(page.locator('[data-panel=breakdown] [data-bd-onhold]')).toBeVisible();
    await expect(page.locator('[data-panel=breakdown] [data-export=csv]')).toBeVisible();
    await page.keyboard.press('Escape');
    await shot(page, 'mm-breakdown-desktop');
    if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
    await noHorizontalScroll(page);
  });

  test('"On hold only" is a checkbox in Options and narrows the numbers', async ({
    seed,
    personas,
    asUser,
  }) => {
    const f = await fixture(seed, personas, 'bd2');
    const page = await asUser(f.w.pm.username);
    await page.goto('/my-matters?tab=breakdown');
    await settled(page);
    await page.locator('[data-panel=breakdown] [data-options-trigger]').click();
    await page.locator('[data-panel=breakdown] [data-bd-onhold]').check();
    await expect(page).toHaveURL(/bstatus=onHold/);
    await settled(page);
    await expect(page.locator('[data-panel=breakdown]')).toContainText('No tasks on hold');
    await expect(page.locator('[data-panel=breakdown] [data-options-count]')).toHaveText('1');
  });

  test('Focus narrows the Breakdown and says so: "Focus: 1 task type"', async ({
    seed,
    personas,
    asUser,
  }) => {
    const f = await fixture(seed, personas, 'bd3');
    const page = await asUser(f.w.pm.username);
    await page.goto('/my-matters?tab=breakdown');
    await settled(page);
    await expect(page.locator('[data-bd-focus]')).toHaveCount(0);
    await page.locator('[data-header-options] [data-options-trigger]').click();
    await page.locator(`[data-focus-option="${f.types[1].id}"]`).check();
    await page.locator('[data-focus-save]').click();
    await expect(page.locator('[data-bd-focus]')).toHaveText('Focus: 1 task type');
    await settled(page);
    await expect(page.locator('table[data-bd-table="matrix"] thead th[data-bd-col]')).toHaveCount(
      1,
    );
    await expect(page.locator('table[data-bd-table="matrix"] thead th[data-bd-col]')).toHaveText(
      f.types[1].name,
    );
    // Every cell still opens the Task Queue with the same filter (the type is in the link).
    await expect(page.locator('a[data-bd-cell]').first()).toHaveAttribute('href', /\/tasks\?/);
    await page.locator('[data-focus-remove]').click();
    await expect(page.locator('[data-bd-focus]')).toHaveCount(0);
    await expect(page.locator('table[data-bd-table="matrix"] thead th[data-bd-col]')).toHaveCount(
      3,
    );
  });

  test('375x812: four matters are compact cards (at most 1,100 px), the total is one line, every chip is a 44 px link with a full name', async ({
    seed,
    personas,
    asUser,
  }) => {
    const f = await fixture(seed, personas, 'bd4');
    const page = await asUser(f.w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters?tab=breakdown');
    await settled(page);
    const cards = page.locator('[data-bd-cards="matrix"] [data-bd-row]');
    await expect(cards).toHaveCount(4);
    await expect(page.locator('[data-bd-total]')).toHaveText(/^\s*\d+ open, 1 overdue\s*$/);
    const box = (await page.locator('[data-panel=breakdown]').boundingBox())!;
    expect(box.height, 'the Breakdown of four matters on a phone').toBeLessThanOrEqual(1100);
    const chips = await page.locator('[data-bd-cards] a.bd__chip').all();
    expect(chips.length).toBeGreaterThanOrEqual(8);
    for (const chip of chips) {
      expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await chip.getAttribute('aria-label')).toMatch(/: \d+ open/);
      expect(await chip.getAttribute('href')).toContain('/tasks?');
    }
    await expect(page.locator('[data-bd-cards] [data-bd-cell] .bd__late').first()).toBeVisible();
    await shot(page, 'mm-breakdown-phone');
    if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
    await noHorizontalScroll(page);
  });

  test('one matter: one row, no All matters row, no toggle, Options is the only control', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'bd5');
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: inDays(4) });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters?tab=breakdown');
    await settled(page);
    const panel = page.locator('[data-panel=breakdown]');
    await expect(panel.locator('[data-bd-row]')).toHaveCount(1);
    await expect(panel.locator('tfoot')).toHaveCount(0);
    await expect(panel.locator('[data-bd-view]')).toHaveCount(0);
    await expect(panel.locator('[data-options-trigger]')).toHaveCount(1);
  });
});

test.describe('Activity grid (#946)', () => {
  test('1366x768: one line a row of 44 px, the columns line up, a sort button, Options for the choices, the since-line stays on top', async ({
    seed,
    personas,
    asUser,
  }) => {
    const f = await fixture(seed, personas, 'ag1');
    const page = await asUser(f.w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters?tab=activity');
    await settled(page);
    const act = page.locator('[data-panel=activity-tab]');
    const rows = await act.locator('[data-activity-row]').all();
    expect(rows.length).toBe(25);
    const lefts: number[][] = [];
    for (const row of rows) {
      const box = (await row.boundingBox())!;
      expect(box.height, 'a row is one line of 44 px').toBeGreaterThanOrEqual(43);
      expect(box.height).toBeLessThanOrEqual(50);
      lefts.push(
        await Promise.all(
          (await row.locator('td').all()).map(async (c) => Math.round((await c.boundingBox())!.x)),
        ),
      );
    }
    for (const l of lefts) expect(l, 'the same columns in the same place').toEqual(lefts[0]);
    await expect(act.locator('thead th')).toHaveText(['When', 'Who', 'What', 'Task', 'Matter']);
    // The since line (when something needs a decision) is above the grid, the grid has its own sort.
    const since = page.locator('[data-panel=since]');
    if (await since.count()) {
      const s = (await since.boundingBox())!;
      const g = (await act.boundingBox())!;
      expect(s.y).toBeLessThan(g.y);
    }
    await expect(act.locator('[data-filter=kind]')).toBeHidden();
    await shot(page, 'mm-activity-desktop');
    if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
    await noHorizontalScroll(page);
  });

  test('a long task title wraps in its own cell and nothing else does', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ag2');
    const a = await w.matter('Alpha');
    await w.matter('Beta');
    const long = 'A very long task title that goes on and on '.repeat(4).trim();
    await w.task(a, { title: long });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters?tab=activity');
    await settled(page);
    const row = page.locator('[data-activity-row]').first();
    await expect(row.locator('[data-col=task]')).toContainText('A very long task title');
    // The title wraps (the row is taller than one line); the other cells do not: they are cut with an ellipsis, never folded.
    const rowHeight = (await row.boundingBox())!.height;
    expect(rowHeight).toBeGreaterThan(50);
    for (const col of ['who', 'what'])
      await expect(row.locator(`[data-col=${col}]`)).toHaveCSS('white-space', 'nowrap');
    await expect(row.locator('td').first()).toHaveCSS('white-space', 'nowrap');
    await noHorizontalScroll(page);
  });

  test('375x812: cards in the same order, 44 px links, no sideways scroll', async ({
    seed,
    personas,
    asUser,
  }) => {
    const f = await fixture(seed, personas, 'ag3');
    const page = await asUser(f.w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters?tab=activity');
    await settled(page);
    const cards = page.locator('[data-activity-cards] [data-activity-row]');
    expect(await cards.count()).toBe(25);
    for (const link of await page.locator('[data-activity-cards] a[data-activity-link]').all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('table[data-activity-table]')).toHaveCount(0);
    await expect(page.locator('mf-pager')).toHaveCount(1);
    await shot(page, 'mm-activity-phone');
    if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
    await noHorizontalScroll(page);
  });
});
