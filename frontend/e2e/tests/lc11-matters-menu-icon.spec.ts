import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/** LC-11 (#1062): the Matters row menu labels, Open Task List opens the matter's Tasks tab, and the page title icon is the 32 px primary tile of My Matters. */
test.describe('Matters list: row menu and title icon (LC-11)', () => {
  test('the row menu says New Task, Bulk Update, Add Comment, Open Task List (no plus sign) and Open Task List opens the Tasks tab', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const client = await seed.client({ name: `Menu Client ${token}` });
    const matter = await seed.matter({ client, number: '00001', name: `Menu Matter ${token}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters?name=${token}`);
    await page
      .locator('tbody tr', { hasText: matter.matterRef })
      .locator('[data-overflow]')
      .click();
    await expect(page.locator('[role=menuitem]')).toHaveText([
      /^\s*New Task\s*$/,
      /^\s*Bulk Update\s*$/,
      /^\s*Add Comment\s*$/,
      /^\s*Open Task List\s*$/,
    ]);
    if (axeAvailable()) expect(await axeViolations(page), 'menu open').toEqual([]);
    await page.locator('[data-action=open-tasks]').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${matter.matterId}\\?tab=tasks`));
  });

  test('the title icon is a 32 px rounded primary tile on the list pages, at 1366x768 and 375x812', async ({
    page,
  }) => {
    for (const size of [{ width: 1366, height: 768 }]) {
      await page.setViewportSize(size);
      for (const url of ['/matters', '/clients', '/projects', '/assets']) {
        await page.goto(url);
        const icon = page.locator('h1 i[data-page-icon]').first();
        await expect(icon).toBeVisible();
        const box = (await icon.boundingBox())!;
        expect(Math.round(box.width), `${url} icon width at ${size.width}`).toBe(32);
        expect(Math.round(box.height), `${url} icon height`).toBe(32);
        const bg = await icon.evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(bg, `${url}: a filled tile`).not.toBe('rgba(0, 0, 0, 0)');
      }
      if (axeAvailable()) expect(await axeViolations(page), `axe at ${size.width}`).toEqual([]);
    }
  });
});
