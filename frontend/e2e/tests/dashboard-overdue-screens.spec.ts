import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';

/**
 * Screenshot run for docs/ux/dashboard-review-2/fixes (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder).
 * E2E_OVERDUE_BEFORE=1 simulates the previous behaviour on the same data (the list asks for the due-date order and the tile has no severity line).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const BEFORE = !!process.env['E2E_OVERDUE_BEFORE'];

test.describe('dashboard overdue order screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed }) => {
    test.setTimeout(300_000);
    fs.mkdirSync(OUT!, { recursive: true });
    const world = await seed.world();
    const res = await seed.admin.get<Record<string, unknown>>('/api/v1/priorities');
    const list = (Array.isArray(res) ? res : (res['items'] as unknown[])) as {
      id: number;
      label: string;
    }[];
    const id = (label: string) => list.find((p) => p.label === label)!.id;
    for (let i = 0; i < 8; i++)
      await seed.task(world, {
        title: `Redaction batch ${i + 1} ${uid()}`,
        priorityId: id('Critical'),
        dueDate: dateInZone(FIRM_ZONE, -(2 + i)),
      });
    for (let i = 0; i < 4; i++)
      await seed.task(world, {
        title: `Processing custodian set ${i + 1} ${uid()}`,
        priorityId: id('High'),
        dueDate: dateInZone(FIRM_ZONE, -(8 + i)),
      });
    for (let i = 0; i < 8; i++)
      await seed.task(world, {
        title: `Intake review ${i + 1} ${uid()}`,
        priorityId: id('Normal'),
        dueDate: dateInZone(FIRM_ZONE, -(20 + i)),
      });

    if (BEFORE) {
      await page.route('**/api/v1/task-queue?*', (route) => {
        const url = route.request().url();
        if (url.includes('overdue=true') && url.includes('sort=priority'))
          return route.continue({ url: url.replace('sort=priority', 'sort=due') });
        return route.continue();
      });
    }
    for (const [w, h] of [
      [1366, 768],
      [375, 812],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/dashboard');
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect(page.locator('[data-panel="overdue"] li').first()).toBeVisible();
      if (BEFORE) {
        await page.evaluate(() => {
          document.querySelectorAll('[data-detail]').forEach((e) => e.remove());
          document
            .querySelectorAll('[data-panel="overdue"] [data-order]')
            .forEach((e) => e.remove());
        });
      }
      await page.waitForLoadState('networkidle');
      const tiles = page.locator('[data-group="attention"]');
      await tiles.screenshot({
        path: path.join(OUT!, `${BEFORE ? 'before' : 'after'}-tiles-${w}.png`),
      });
      await page.locator('[data-panel="overdue"]').screenshot({
        path: path.join(OUT!, `${BEFORE ? 'before' : 'after'}-overdue-list-${w}.png`),
      });
    }
  });
});
