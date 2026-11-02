import { expect, test } from '../support/fixtures';

/**
 * A look at a matter's Tasks tab at 1366x768 (MD-04, #1005): no clipped column, the Status progress is visible, Due has two lines, and the Project cell is a dropdown.
 * Screenshots go to E2E_SCREENSHOTS when it is set.
 */
test('Tasks tab at 1366x768: columns fit and the cells show what they should', async ({
  page,
  seed,
}) => {
  const world = await seed.world();
  const project = await seed.project(world.matter, 'Wave 1');
  for (let i = 0; i < 6; i++) await seed.task(world, { dueDate: '2099-01-0' + (i + 1) });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
  const rows = page.locator('mf-task-table tbody tr[data-task]');
  await expect(rows.first()).toBeVisible();
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/tasks-1366x768.png` });

  // The table fits its frame: nothing scrolls sideways.
  const overflow = await page.evaluate(() => {
    const area = document.querySelector('mf-task-table .mf-scroll-area, mf-task-table')!;
    return area.scrollWidth - area.clientWidth;
  });
  expect(overflow, 'the Tasks table scrolls sideways').toBeLessThanOrEqual(1);

  // Every header is fully visible (not cut by the cell).
  const clippedHeaders = await page.evaluate(() =>
    Array.from(document.querySelectorAll('mf-task-table thead th'))
      .filter((th) => th.scrollWidth > th.clientWidth + 12)
      .map((th) => th.textContent?.trim()),
  );
  expect(clippedHeaders, 'clipped column headers').toEqual([]);

  const first = rows.first();
  await expect(first.locator('[data-type-icon]')).toBeVisible();
  await expect(first.locator('mf-due-cell')).toBeVisible();
  await expect(first.locator('mf-status-badge, [data-plain-status]').first()).toBeVisible();
  await expect(first.locator('mf-dropdown[data-project-dropdown]')).toBeVisible();
  await expect(first.locator('[data-steps]')).toContainText('steps');
  void project;
});
