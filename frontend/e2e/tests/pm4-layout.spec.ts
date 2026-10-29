import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { SIZES, shot } from '../support/screens';

/**
 * Phone and tablet layout of My Matters (epic #667, #700; #818; epic #893 and the owner's rework of 2026-10-29): at 375 px the filters are one "Filters (n)" button with a sheet, the
 * pre-filter dropdown (it replaced the tiles, #942) and the first card are on the first screen, the grid is cards (25 a page, #943), and the Matters section is gone (#945). The
 * events left the Overview in #909; the Workload panel was removed, #826.
 */
/** No page-level sideways scroll once the layout has settled after a resize (polled: the table measures itself on the next frame). */
const noHorizontalScroll = async (page: Page): Promise<void> => {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { message: 'page-level horizontal scroll' },
    )
    .toBeLessThanOrEqual(0);
};

const y = async (page: Page, selector: string): Promise<number> => {
  const box = await page.locator(selector).first().boundingBox();
  return box ? box.y : -1;
};

test.describe('My Matters on a phone and a tablet', () => {
  test('phone: the first screen shows the dropdown and the first card; cards; no sideways scroll; the Filters sheet holds Client, Matter and Role', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'lay1');
    const a = await w.matter('Layout alpha');
    await w.matter('Layout bravo', w.other, w.pm); // Secondary here: the Role filter (and so the Filters button) is offered
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a, { dueDate: inDays(2) });
    await w.task(a);
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=tasks] li[data-task]').first()).toBeVisible();
    await shot(page, 'my-matters-phone');
    // Filters: one button; its sheet holds every filter.
    const filtersButton = page.locator('[data-filters-open]');
    await expect(filtersButton).toHaveText(/Filters/);
    await expect(page.locator('[data-filter=role]')).toHaveCount(0);
    expect((await filtersButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // No tiles: the dropdown of counts is a 44 px target inside the page width and on the first screen, with the first card under it.
    await expect(page.locator('[data-strip-item], [data-mm-strip]')).toHaveCount(0);
    const select = (await page.locator('select[data-prefilter]').boundingBox())!;
    expect(select.x).toBeGreaterThanOrEqual(0);
    expect(select.x + select.width).toBeLessThanOrEqual(375);
    expect(select.height).toBeGreaterThanOrEqual(43.5);
    const heading = (await page.locator('[data-panel=tasks] h2.mmp__title').boundingBox())!;
    expect(heading.y + heading.height).toBeLessThanOrEqual(812);
    const card = (await page.locator('[data-panel=tasks] li[data-task]').first().boundingBox())!;
    expect(card.y + card.height, 'the first card is whole on the first screen').toBeLessThanOrEqual(
      812,
    );
    // The one-line description would only be cut off: it is kept for screen readers and takes no room.
    const description = (await page.locator('[data-page-description]').boundingBox())!;
    expect(description.height).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-page-description]')).toContainText('The matters you manage');
    // "New task" is on the first screen too (#814), in the one Options menu of the title row (issue #922).
    const options = (await page
      .locator('[data-header-options] [data-options-trigger]')
      .boundingBox())!;
    expect(options.y + options.height).toBeLessThanOrEqual(812);
    await page.locator('[data-header-options] [data-options-trigger]').click();
    await expect(page.locator('[data-header-options] [data-new-task-inline]')).toBeVisible();
    await page.keyboard.press('Escape');
    // No Matters section under the grid.
    await expect(page.locator('[data-panel=health], [data-health-row]')).toHaveCount(0);
    await noHorizontalScroll(page);
    // The sheet.
    await filtersButton.click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet.locator('[data-filter=role]')).toBeVisible();
    await expect(sheet.locator('#mm-matter')).toBeVisible();
    await sheet.locator('[data-filter=role]').selectOption('primary');
    await expect(page).toHaveURL(/role=primary/);
    expect(await axeViolations(page), 'filter sheet open at 375').toEqual([]);
    await sheet.getByRole('button', { name: 'Show results' }).click();
    await expect(filtersButton).toHaveText(/Filters \(1\)/);
  });

  test('phone: the grid is cards, each with its title, matter and due; all of them on one page of 25, no View all', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'lay2');
    const a = await w.matter('Layout many');
    await w.matter('Layout many two'); // several matters: the matter's name is on each card (a matter named on every row says nothing for one)
    for (let i = 0; i < 7; i++)
      await w.task(a, { dueDate: `2000-01-0${i + 1}`, title: `Layout task ${i}` });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    const grid = page.locator('[data-panel=tasks]');
    // The shared table is cards on a phone (#929): a title, the client and matter, and the Due cell that says overdue.
    await expect(grid.locator('li[data-task]')).toHaveCount(7);
    for (const item of await grid.locator('li[data-task]').all()) {
      await expect(item.locator('a.wt-title')).toBeVisible();
      await expect(item.locator('[data-card-matter]')).toBeVisible();
      await expect(item.locator('[data-col=due]')).toContainText(/overdue/i);
    }
    await expect(grid.locator('[data-view-all]')).toHaveCount(0);
    await expect(page.locator('mf-pager')).toHaveCount(0); // 7 of 25: no page control
    // The events are not on the Overview.
    await expect(page.locator('[data-panel=activity], [data-activity-row]')).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test('tablet: one column, the grid fits without sideways scroll', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'lay3');
    const a = await w.matter('Layout tablet');
    await w.matter('Layout tablet two');
    await w.task(a, { dueDate: inDays(2) });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=tasks] tr[data-task]').first()).toBeVisible();
    await expect(page.locator('[data-panel]')).toHaveCount(1);
    await shot(page, 'my-matters-tablet');
    await noHorizontalScroll(page);
    for (const width of [768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      const row = (await page.locator('[data-panel=tasks] tr[data-task]').first().boundingBox())!;
      expect(row.height, `a task row at ${width}`).toBeLessThanOrEqual(48);
    }
  });

  test('no sideways scroll, 44 px targets on a phone and axe 0 at the four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const w = await mmWorld(seed, personas, 'lay4');
    const a = await w.matter('Layout sizes');
    await w.matter('Layout sizes two', w.pm, w.other);
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a, { dueDate: inDays(3) });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(
        page
          .locator('[data-panel=tasks] [data-task], [data-panel=tasks] [data-record-card]')
          .first(),
      ).toBeVisible();
      expect(await axeViolations(page), `page at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'my-matters');
      if (size.width < 640) {
        const small = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLElement>('main a[href], main button, main select'),
          )
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.width > 0 && r.height > 0 && r.height < 44 && !el.classList.contains('rc-name')
              );
            })
            .map(
              (el) =>
                `${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}`,
            ),
        );
        expect(small, 'targets under 44 px on a phone').toEqual([]);
      }
    }
  });
});
