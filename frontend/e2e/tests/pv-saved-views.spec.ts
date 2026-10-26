import { Page } from '@playwright/test';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * PM v2 lane G (epic #851): saved views (#880): named, applied, made the default, renamed and deleted; personal and kept on the server.
 */
const SIZES = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function clean(page: Page, what: string): Promise<void> {
  expect(axeAvailable(), 'axe must really run').toBe(true);
  const violations = await axeBestPractice(page);
  expect(
    violations.map((v) => `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map((n) => n.target))}`),
    what,
  ).toEqual([]);
}

async function noSidewaysScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `no sideways scroll: ${what}`).toBe(false);
}

test.describe('Saved views (#880)', () => {
  for (const size of SIZES) {
    test(`the Export and Views menus are clean at ${size.name}`, async ({ page, seed }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const world = await seed.world();
      await seed.task(world);
      await page.goto(`/tasks?matter=${world.matter.matterId}`);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      await page.locator('[data-views-trigger]').click();
      await expect(page.locator('[data-view-name-input]')).toBeVisible();
      await noSidewaysScroll(page, `Views open at ${size.name}`);
      await clean(page, `Views open at ${size.name}`);
      await page.keyboard.press('Escape');
      await page.locator('[data-export-menu] [data-overflow]').click();
      await expect(page.getByRole('menuitem', { name: 'Download CSV' })).toBeVisible();
      await clean(page, `Export open at ${size.name}`);
    });
  }

  test('a saved view is named, applied, made the default, renamed and deleted; the server keeps it', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    await seed.task(world);
    await page.goto(`/tasks?matter=${world.matter.matterId}&status=NEW`);
    await page.locator('[data-views-trigger]').click();
    await expect(page.locator('[data-views-empty]')).toBeVisible();
    await page.locator('[data-view-save]').click();
    await expect(page.locator('[data-view-form-error]')).toContainText('Enter a name');
    await page.locator('[data-view-name-input]').fill('My matter, new');
    await page.locator('[data-view-save]').click();
    const row = page.locator('[data-view-row][data-view-name="My matter, new"]');
    await expect(row).toBeVisible();
    // The same name again is refused with the server's words.
    await page.locator('[data-view-name-input]').fill('my matter, NEW');
    await page.locator('[data-view-save]').click();
    await expect(page.locator('[data-view-form-error]')).toContainText('already have a view');
    await page.keyboard.press('Escape');

    // Another list state, then the view brings the first one back.
    await page.goto(`/tasks?status=COMPLETED`);
    await page.locator('[data-views-trigger]').click();
    await page.locator('[data-view-apply]').click();
    await expect(page).toHaveURL(new RegExp(`matter=${world.matter.matterId}`));
    await expect(page).toHaveURL(/status=NEW/);

    // Rename, then make it the default: a plain /tasks opens on it.
    await page.locator('[data-views-trigger]').click();
    await page.locator('[data-view-rename]').click();
    await page.locator('[data-view-rename-input]').fill('Alpha new work');
    await page.locator('[data-view-rename-save]').click();
    const renamed = page.locator('[data-view-row][data-view-name="Alpha new work"]');
    await expect(renamed).toBeVisible();
    await renamed.locator('[data-view-default-toggle]').click();
    await expect(renamed.locator('[data-view-default]')).toBeVisible();
    const stored = await admin.get('/api/v1/me/views?surface=task-queue');
    expect(stored.items.filter((v: { name: string | null }) => v.name !== null)).toHaveLength(1);
    await page.goto('/tasks');
    await expect(page).toHaveURL(new RegExp(`matter=${world.matter.matterId}`));

    // Delete asks first; afterwards a plain /tasks is the plain list again.
    await page.locator('[data-views-trigger]').click();
    await page.locator('[data-view-delete]').click();
    await page.locator('[data-view-delete-confirm]').click();
    await expect(page.locator('[data-views-empty]')).toBeVisible();
    const after = await admin.get('/api/v1/me/views?surface=task-queue');
    expect(after.items.filter((v: { name: string | null }) => v.name !== null)).toHaveLength(0);
  });
});
