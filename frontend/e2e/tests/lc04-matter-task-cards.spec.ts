import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { dropdownByAttr } from '../support/dropdown';
import { expect, test } from '../support/fixtures';
import { noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * LC-04 (#1041, epic #1037): the Matter Tasks tab is cards on a phone (under 640 px), like every other list. Search, Filters (a sheet with the Sort
 * select) and "+ New Task" are in the toolbar, Columns is not offered, a whole card opens its task, nothing scrolls sideways, and the table is
 * unchanged from 640 px up.
 */
const PHONE = { width: 375, height: 812 };
const cards = (page: Page) => page.locator('.tc-list .tc[data-task]');

test.describe('Matter Tasks tab on a phone (#1041)', () => {
  test.setTimeout(180_000);

  test('cards instead of a table: Ref, Title, Priority, Status, no Client line, no sideways scroll, axe clean', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 3 });
    const titles = [`Card A ${uid()}`, `Card B ${uid()}`];
    for (const title of titles) await seed.task(world, { title });
    await page.setViewportSize(PHONE);
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('table.wt')).toHaveCount(0);

    const first = cards(page).filter({ hasText: titles[0] });
    await expect(first.locator('a.wt-title')).toHaveText(titles[0]);
    await expect(first.locator('[data-col="priority"]')).toBeVisible();
    await expect(first.locator('[data-col="status"]')).toBeVisible();
    await expect(first.locator('[data-task]').or(first)).toContainText(/TSK-\d+/);
    // The matter and client are the page you are on: the card leaves that line out, and shows the Progress.
    await expect(first.locator('[data-card-matter]')).toHaveCount(0);
    await expect(first.locator('[data-card-progress]')).toContainText('of 3 steps');

    // The toolbar: Search, Filters, New Task; Columns is not offered.
    await expect(page.getByRole('searchbox', { name: 'Search tasks', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Task' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Columns/ })).toBeHidden();

    await noHorizontalScroll(page);
    const scroll = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.mf-main, .wt-wrap')).map(
        (e) => e.scrollWidth - e.clientWidth,
      ),
    );
    for (const over of scroll) expect(over).toBeLessThanOrEqual(1);
    if (axeAvailable()) expect(await axeViolations(page), 'axe').toEqual([]);
    await shot(page, 'lc04-matter-task-cards');
  });

  test('Search narrows the cards, the Filters sheet has the Sort select, the whole card opens the task', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const a = `Open me ${uid()}`;
    await seed.task(world, { title: a });
    await seed.task(world, { title: `Other ${uid()}` });
    await page.setViewportSize(PHONE);
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    await expect(cards(page)).toHaveCount(2);
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill(a);
    await expect(cards(page)).toHaveCount(1);
    await page.getByRole('searchbox', { name: 'Search tasks', exact: true }).fill('');
    await expect(cards(page)).toHaveCount(2);

    await page.locator('[data-filters-toggle]').click();
    const sheet = page.locator('[data-filter-sheet]');
    await expect(sheet).toBeVisible();
    const sort = dropdownByAttr(sheet, 'data-sort-select');
    expect(await sort.optionTexts()).toContain('Title');
    await sort.selectOption('title');
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Title');
    if (axeAvailable()) expect(await axeViolations(page), 'axe with the sheet open').toEqual([]);
    await shot(page, 'lc04-matter-task-sheet');
    await page.keyboard.press('Escape');

    // A tap on the empty part of the card opens the task (the title link is stretched over it).
    const card = cards(page).filter({ hasText: a });
    const box = (await card.boundingBox())!;
    await page.mouse.click(box.x + box.width - 8, box.y + 14);
    await expect(page).toHaveURL(/\/tasks\/\d+/);
  });

  test('ticking cards in selection mode still works with the bulk bar; the table is unchanged at 1366x768', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Sel A ${uid()}` });
    await seed.task(world, { title: `Sel B ${uid()}` });
    await page.setViewportSize(PHONE);
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    await expect(page.locator('[data-select-mode]')).toBeVisible();
    await page.locator('[data-select-mode]').click();
    await expect(page.locator('[data-select-cards]')).toBeVisible();
    await page.getByRole('checkbox', { name: /^Select .*Sel A/ }).check();
    await page.getByRole('checkbox', { name: /^Select .*Sel B/ }).check();
    await expect(page.locator('[data-selection-count]')).toHaveText('2 selected');
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    await expect(page.locator('table.wt')).toBeVisible();
    await expect(page.locator('.tc-list')).toHaveCount(0);
  });
});
