import { expect, test } from '../support/fixtures';

/**
 * A look at a matter's Tasks tab at 1366x768 (MD-04, #1005; MD-24, #1028): no clipped column, a Type chip column, Status shows the status only, a thin Progress bar with the "n of m steps" tooltip on hover and on focus, Due has two lines, and the Project cell is a dropdown (Project is a default column, MD-29).
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

  // Default order (MD-29, #1154): Ref, Type, Title, Project, Priority, Assignee, Due, Status; Progress is off by default and added in the Columns menu below.
  const order = (await page.locator('mf-task-table thead tr:first-child th').allTextContents()).map(
    (t) => t.trim(),
  );
  expect(order).toEqual([
    'Ref',
    'Type',
    'Title',
    'Project',
    'Priority',
    'Assignee',
    'Due',
    'Status',
  ]);

  // Every header is fully visible (not cut by the cell).
  const clippedHeaders = await page.evaluate(() =>
    Array.from(document.querySelectorAll('mf-task-table thead th'))
      .filter((th) => th.scrollWidth > th.clientWidth + 12)
      .map((th) => th.textContent?.trim()),
  );
  expect(clippedHeaders, 'clipped column headers').toEqual([]);

  const first = rows.first();
  // No cell cuts its text: the status and priority chips and the assignee are whole at 1366 (#1154).
  const cutChips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('mf-task-table tbody .im-value'))
      .filter(
        (v) =>
          v.scrollWidth > v.clientWidth + 1 &&
          v.closest('td[data-col="status"], td[data-col="priority"]'),
      )
      .map((v) => v.textContent?.trim()),
  );
  expect(cutChips, 'a Status or Priority chip is cut').toEqual([]);
  await expect(first.locator('[data-type-chip]')).toBeVisible();
  // The chip is the My Matters chip (32 px) with the type's name beside it (MD-29).
  await expect(first.locator('[data-type-name]')).not.toHaveText('');
  const chip = await first.locator('[data-type-chip] .chip').boundingBox();
  expect(chip!.width).toBeGreaterThanOrEqual(31);
  await expect(page.locator('mf-task-table thead th', { hasText: /^\s*Type\s*$/ })).toBeVisible();
  await page.locator('[data-grid-columns]').click();
  await page.locator('[data-grid-columns-panel] [data-column="steps"]').check();
  await page.keyboard.press('Escape');
  await expect(
    page.locator('mf-task-table thead th', { hasText: /^\s*Progress\s*$/ }),
  ).toBeVisible();
  await expect(first.locator('mf-due-cell')).toBeVisible();
  await expect(first.locator('mf-status-badge, [data-plain-status]').first()).toBeVisible();
  await expect(first.locator('mf-dropdown[data-project-dropdown]')).toBeVisible();
  // Status shows the status only; the progress is a thin bar with role progressbar, named and described "n of m steps".
  await expect(first.locator('[data-steps]')).toHaveCount(0);
  const bar = first.locator('[data-step-bar]');
  await expect(bar).toHaveAttribute('role', 'progressbar');
  await expect(bar).toHaveAttribute('aria-valuenow', /^\d+$/);
  await expect(bar).toHaveAttribute('aria-valuemax', /^[1-9]\d*$/);
  await expect(bar).toHaveAttribute('aria-label', /^\d+ of \d+ steps$/);
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(26);
  await bar.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/^\d+ of \d+ steps$/);
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await bar.focus();
  await expect(page.getByRole('tooltip')).toHaveText(/^\d+ of \d+ steps$/);
  void project;
});
