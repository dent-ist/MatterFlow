import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { toasts } from '../support/toasts';
import { uid } from '../support/seed';

/**
 * WP-AD1 #537 (BUG-7): a refused delete (409 IN_USE) is reported once, with one wording: the inline line that names the row. No toast.
 * Priorities and Link roles. Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad1-first-release).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(0);
}

test.describe('a refused delete is reported once (#537)', () => {
  test('Priorities: one inline message, no toast, axe clean at four widths (a delete the server refuses after the page offered it)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    for (const size of SIZES) {
      const label = `Used ${uid().slice(0, 6)}`;
      const priority = await seed.admin.post('/api/v1/priorities', {
        label,
        color: 'normal',
        isActive: true,
      });
      await page.setViewportSize(size);
      await page.goto('/admin/priorities');
      // Unused when the page loaded, so Delete is offered; a task is filed on it before the confirm (the race the server must refuse).
      const row = page.locator(`tbody tr[data-row="${label}"], li.rc:has-text("${label}")`);
      await row.getByRole('button', { name: /^Actions for / }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await seed.task(world, { priorityId: priority.id });
      await page.getByRole('dialog').getByRole('button', { name: 'Delete priority' }).click();

      const failure = page.locator('[data-failure]');
      await expect(failure).toHaveText(
        `Tasks use ${label}, so it can't be deleted. Deactivate it instead.`,
      );
      // Exactly one message: the toast stays away, the inline line is the only copy of the sentence.
      await expect(toasts(page)).toHaveCount(0);
      await expect(page.getByText("so it can't be deleted")).toHaveCount(1);
      await noSideScroll(page, `priorities at ${size.width}`);
      expect(axeAvailable(), 'axe-core is available').toBe(true);
      expect(await axeViolations(page)).toEqual([]);
      await shot(page, 'refused-delete-priorities');
    }
  });

  test('Link roles: the same single message', async ({ page, seed }) => {
    const name = `Used ${uid().slice(0, 6)}`;
    const role = await seed.admin.post('/api/v1/asset-link-roles', { name, isActive: true });
    const world = await seed.world();
    const task = await seed.task(world);
    const asset = await seed.asset(world.matter);
    await seed.admin.post(`/api/v1/tasks/${task.taskId}/assets`, {
      assetId: asset.assetId,
      assetLinkRoleId: role.id,
    });

    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/asset-link-roles');
      const row = page.locator(`[data-row="${name}"]`);
      await row.getByRole('button', { name: `Delete ${name}` }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete role' }).click();

      await expect(page.locator('[data-failure]')).toHaveText(
        `Links use ${name}, so it can't be deleted. Deactivate it instead.`,
      );
      await expect(toasts(page)).toHaveCount(0);
      await expect(page.getByText("so it can't be deleted")).toHaveCount(1);
      await noSideScroll(page, `link roles at ${size.width}`);
      expect(axeAvailable(), 'axe-core is available').toBe(true);
      expect(await axeViolations(page)).toEqual([]);
      await shot(page, 'refused-delete-link-roles');
    }
  });
});
