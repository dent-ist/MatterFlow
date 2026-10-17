import { expect, test } from '../support/fixtures';

/**
 * Two alignment details of the Dashboard (owner feedback):
 *  1. Summary: the first list panel starts on the same line as the first row of tiles, not on the "Needs attention" heading line.
 *  2. Users: the Workload | Coverage switch stays where it is when the view changes (the Workload toolbar has labels over its selects).
 */
test('Summary: the Unassigned panel is level with the first row of tiles', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/dashboard?tab=summary');
  const tile = page.locator('[data-group="attention"] mf-stat-tile').first();
  const panel = page.locator('[data-lists] [data-panel]').first();
  await expect(tile).toBeVisible();
  await expect(panel).toBeVisible();
  const t = (await tile.boundingBox())!;
  const p = (await panel.boundingBox())!;
  expect(Math.abs(p.y - t.y)).toBeLessThanOrEqual(2);
});

test('Summary under a pod scope: the no-pod hint takes the heading row and the panel stays level with the tiles', async ({
  page,
  seed,
}) => {
  const world = await seed.world();
  await seed.task(world, { title: `No pod ${Date.now()}` });
  const pod = await seed.pod(undefined, []);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/dashboard?tab=summary&pod=${pod.podId}`);
  const hint = page.locator('[data-no-pod-hint]');
  const tile = page.locator('[data-group="attention"] mf-stat-tile').first();
  const panel = page.locator('[data-lists] [data-panel]').first();
  await expect(hint).toBeVisible();
  await expect(tile).toBeVisible();
  await expect(panel).toBeVisible();
  const t = (await tile.boundingBox())!;
  const p = (await panel.boundingBox())!;
  const h = (await hint.boundingBox())!;
  expect(Math.abs(p.y - t.y)).toBeLessThanOrEqual(2);
  expect(h.y + h.height).toBeLessThanOrEqual(p.y + 1);
});

test('Users: the Workload | Coverage switch does not move between the views', async ({ page }) => {
  for (const width of [1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard?tab=users');
    const views = page.locator('[data-users-views]');
    await expect(views).toBeVisible();
    await expect(page.locator('[data-users-loading]')).toHaveCount(0);
    const workload = (await views.boundingBox())!;
    await views.getByRole('button', { name: /Coverage/ }).click();
    await expect(page.locator('mf-coverage-view')).toBeVisible();
    const coverage = (await views.boundingBox())!;
    expect(Math.abs(coverage.y - workload.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(coverage.x - workload.x)).toBeLessThanOrEqual(1);
    await views.getByRole('button', { name: /Workload/ }).click();
    const back = (await views.boundingBox())!;
    expect(Math.abs(back.y - workload.y)).toBeLessThanOrEqual(1);
  }
});
