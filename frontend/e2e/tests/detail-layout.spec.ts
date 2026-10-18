import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/** The Client, Matter and Project detail pages: Client and Matter have Details as their first tab, Project has Tasks (n) and Details tabs (WP4); the Activity drawer (docs/ux/detail-layout). */
test.describe('Detail pages: main area, Details panel and Activity drawer', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Details' });

  async function noHorizontalScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test('Client: Overview is the first tab and the default; the Matters tab has the grid across the full width; no side panel', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Layout Client ${uid()}` });
    const matter = await seed.matter({ client, number: '00007', name: `Layout Matter ${uid()}` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients/${client.clientId}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(client.name);
    await expect(page.getByRole('tab')).toHaveText(['Overview', 'Matters (1)']);
    await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel(page)).toHaveCount(0);
    const details = page.getByRole('tabpanel');
    // The number and name are in the header only (WP6 #261); the tab shows the strip, the matters and the dates.
    await expect(details).toContainText('Created');
    await expect(details).not.toContainText(client.name);
    await expect(details.locator('[data-strip]')).toBeVisible();
    // Edit is in the header and Set inactive in its overflow (WP3); the tab holds no action.
    await expect(
      page.locator('[data-page-actions]').getByRole('button', { name: 'Edit' }),
    ).toBeVisible();
    await expect(details.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Set inactive' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Matters' }).click();
    await expect(page).toHaveURL(/tab=matters/);
    const row = page.getByRole('row').filter({ hasText: matter.name });
    // The name is the one link; the reference is plain text (WP9, #268).
    await expect(row.getByRole('link', { name: matter.name })).toHaveAttribute(
      'href',
      `/matters/${matter.matterId}`,
    );
    await expect(row.getByRole('link', { name: matter.matterRef })).toHaveCount(0);
    const grid = (await page
      .getByRole('region', { name: 'Matters list, scrollable' })
      .boundingBox())!;
    expect(grid.width).toBeGreaterThan(1280 - 300); // the whole page width (less the menu), not beside a panel

    // The primary action of the header (the Matters tab has its own button too until the list package drops it).
    await page.locator('[data-page-actions]').getByRole('button', { name: 'New matter' }).click();
    await expect(page).toHaveURL(new RegExp(`/matters/new\\?clientId=${client.clientId}$`));
  });

  test('Client: the matters grid filters by name through the column filter row', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Filter Client ${uid()}` });
    const active = await seed.matter({ client, number: '00001', name: `Alpha ${uid()}` });
    await seed.matter({ client, number: '00002', name: `Beta ${uid()}` });
    await page.goto(`/clients/${client.clientId}?tab=matters`);

    // The filter row is open by default from 640 px (WP8 #270).
    const nameFilter = page.getByRole('textbox', { name: 'Filter by Name' });
    await expect(nameFilter).toBeVisible();
    await nameFilter.fill(active.name);
    await expect(page).toHaveURL(/name=/);
    await expect(page.getByRole('row').filter({ hasText: 'Beta' })).toHaveCount(0);
    await expect(page.getByRole('row').filter({ hasText: active.name })).toHaveCount(1);
  });

  test('Activity opens in a right-side dialog and Esc returns focus to the button', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Activity Client ${uid()}` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients/${client.clientId}`);

    const button = page.getByRole('button', { name: 'Activity' });
    await button.click();
    const drawer = page.getByRole('dialog', { name: `Activity: ${client.name}` });
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box!.x + box!.width).toBeGreaterThan(1270); // docked to the right edge
    await expect(drawer.getByRole('list', { name: 'Activity' })).toBeVisible();
    // Esc under load can arrive before the dialog has taken focus: wait until it has, as a keyboard user would.
    await expect(drawer.locator(':focus')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('Old ?tab= links: activity opens the drawer, details shows the Details tab', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}?tab=details`);
    await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tabpanel')).toContainText(world.matter.matterRef);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`/matters/${world.matter.matterId}?tab=activity`);
    await expect(
      page.getByRole('dialog', { name: `Activity: ${world.matter.name}` }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/tab=activity/);
  });

  test('Matter: Details, Tasks, Projects and Assets tabs; Details has the facts, the header has Edit and the overflow Set inactive', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ sensitive: true });
    const task = await seed.task(world);
    const project = await seed.project(world.matter);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/matters/${world.matter.matterId}`);

    await expect(page.getByRole('tab')).toHaveText([/Details/, /Tasks/, /Projects/, /Assets/]);
    await expect(panel(page)).toHaveCount(0);
    const details = page.getByRole('tabpanel');
    await expect(details).toContainText('Sensitive');
    await expect(details).toContainText(world.matter.matterRef);
    await expect(
      page.locator('[data-page-actions]').getByRole('button', { name: 'Edit' }),
    ).toBeVisible();
    // One task is open, so deactivation is disabled in the overflow and says why.
    await page.locator('[data-overflow]').click();
    const toggle = page.getByRole('menuitem', { name: /Set inactive/ });
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toContainText("aren't Completed or Cancelled");
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: /Tasks/ }).click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(
      page.getByRole('link', { name: task.taskRef ?? task.title }).first(),
    ).toBeVisible();

    await page.getByRole('tab', { name: /Projects/ }).click();
    await expect(page).toHaveURL(/tab=projects/);
    await expect(page.getByRole('link', { name: project.name })).toBeVisible();

    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('Matter at 1280 px: the Tasks grid uses the whole page width (no Details panel beside it)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);

    await expect(panel(page)).toHaveCount(0);
    const grid = page.locator('.wt-wrap');
    await expect(grid).toBeVisible();
    expect((await grid.boundingBox())!.width).toBeGreaterThan(1280 - 300);
    // Status and Due are not scrolled out of view: the table is not wider than its box.
    expect(await grid.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('Project: Tasks grid across the page, no side panel; Archive and Restore from the header overflow', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const project = await seed.project(world.matter);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${project.projectId}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(project.name);
    await expect(panel(page)).toHaveCount(0);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Restore' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Details' }).click();
    await expect(page.locator('[data-details-tab]')).toContainText('Archived');
  });

  test('Narrow screens: the Details tab is one column without page scroll', async ({
    page,
    seed,
  }) => {
    const longName = `A very long client name that must wrap inside the tab without any sideways scrolling ${uid()}`;
    const client = await seed.client({ name: longName });
    await seed.matter({ client, name: `Narrow Matter ${uid()}` });
    const url = `/clients/${client.clientId}`;

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(longName);
    await expect(page.getByRole('tabpanel')).toContainText('Created');
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(url);
    // On a phone the header keeps the primary action and the overflow; Edit is in the menu.
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    await page.keyboard.press('Escape');
    await noHorizontalScroll(page);
    await expect(page.getByRole('tabpanel')).toContainText('Created');
  });
});
