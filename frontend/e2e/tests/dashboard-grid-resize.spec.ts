import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';

/**
 * DB-10 (#1073): a column divider resizes the column on its left and nothing else. Dragged on the Dashboard Summary grid: only that column
 * changes (its neighbour keeps its width), the divider stays under the pointer, and the grid grows sideways instead of squeezing another column.
 */
const heads = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('mf-dash-grid thead tr:first-child th')).map((h) => [
        (h as HTMLElement).dataset['col'],
        h.getBoundingClientRect().width,
      ]),
    ),
  );

test('Dashboard grid: every divider resizes only its own column and follows the pointer', async ({
  page,
  seed,
}) => {
  const world = await seed.world();
  for (let i = 0; i < 3; i++) await seed.task(world);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/dashboard');
  await expect(page.locator('mf-dash-grid [data-task]').first()).toBeVisible();

  const keys = Object.keys(await heads(page));
  expect(keys.length).toBeGreaterThanOrEqual(5);
  let dragged = 0;
  for (const key of keys) {
    const handle = page.locator(`mf-dash-grid thead .wt-resize[data-resize="${key}"]`);
    if ((await handle.count()) === 0) continue;
    await handle.scrollIntoViewIfNeeded(); // the grid grew sideways with the earlier drags
    const before = await heads(page);
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 6, y, { steps: 6 });
    // (Ref may only grow 8 px, so the drag is 6 px.) While the button is down the divider is under the pointer: the live handle itself, or (a big grid or a slow frame) the guide line.
    const live = (await handle.boundingBox())!;
    const guideLine = page.locator('.wt-resize-guide');
    const guide = (await guideLine.count()) > 0 ? await guideLine.boundingBox() : null;
    const underPointer = guide ? guide.x : live.x + live.width / 2;
    expect(
      Math.abs(underPointer - (x + 6)),
      `${key}: the divider follows the pointer`,
    ).toBeLessThanOrEqual(4);
    await page.mouse.up();
    const after = await heads(page);
    expect(after[key] - before[key], `${key} grows by the drag`).toBeGreaterThan(4);
    expect(after[key] - before[key]).toBeLessThanOrEqual(7);
    for (const other of keys.filter((k) => k !== key)) {
      expect(
        Math.abs(after[other] - before[other]),
        `${key}: ${other} keeps its width`,
      ).toBeLessThanOrEqual(1.5);
    }
    dragged++;
  }
  expect(dragged).toBeGreaterThanOrEqual(5);

  // Remembered: a reload keeps the widths.
  const widths = await heads(page);
  await page.reload();
  await expect(page.locator('mf-dash-grid [data-task]').first()).toBeVisible();
  const again = await heads(page);
  for (const k of Object.keys(widths)) {
    if (k === 'title') continue; // the spring
    expect(Math.abs(again[k] - widths[k]), `${k} after reload`).toBeLessThanOrEqual(2);
  }
});
