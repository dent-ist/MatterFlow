import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/** The Client, Matter and Project detail pages: main area + Details panel, and the Activity drawer (docs/ux/detail-layout). */
test.describe('Detail pages: main area, Details panel and Activity drawer', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Details' });

  async function noHorizontalScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test('Client: Matters grid on the left, Details panel on the right, no section tabs', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Layout Client ${uid()}` });
    const matter = await seed.matter({ client, number: '00007', name: `Layout Matter ${uid()}` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients/${client.clientId}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(client.name);
    const row = page.getByRole('row').filter({ hasText: matter.name });
    await expect(row.getByRole('link', { name: matter.matterRef })).toHaveAttribute(
      'href',
      `/matters/${matter.matterId}`,
    );
    await expect(panel(page)).toContainText(client.clientNumber);
    await expect(panel(page)).toContainText(client.name);
    await expect(panel(page).getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Set inactive' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);

    const grid = await row.boundingBox();
    const side = await panel(page).boundingBox();
    expect(side!.x).toBeGreaterThan(grid!.x + grid!.width - 1); // beside the grid, on the right
    expect(side!.width).toBeGreaterThan(330);
    expect(side!.width).toBeLessThan(350);

    await page.getByRole('button', { name: 'Create matter' }).click();
    await expect(page).toHaveURL(new RegExp(`/matters/new\\?clientId=${client.clientId}$`));
  });

  test('Client: the matters list searches and filters by status', async ({ page, seed }) => {
    const client = await seed.client({ name: `Filter Client ${uid()}` });
    const active = await seed.matter({ client, number: '00001', name: `Alpha ${uid()}` });
    await seed.matter({ client, number: '00002', name: `Beta ${uid()}` });
    await page.goto(`/clients/${client.clientId}`);

    await page.locator('#client-matter-search').fill(active.name);
    await expect(page).toHaveURL(/q=/);
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

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('Old ?tab= links: activity opens the drawer, details just shows the page', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}?tab=details`);
    await expect(panel(page)).toContainText(world.matter.matterRef);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`/matters/${world.matter.matterId}?tab=activity`);
    await expect(
      page.getByRole('dialog', { name: `Activity: ${world.matter.name}` }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/tab=activity/);
  });

  test('Matter: Tasks / Projects / Assets tabs in the main area, Details with Edit and Set inactive on the side', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ sensitive: true });
    const task = await seed.task(world);
    const project = await seed.project(world.matter);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/matters/${world.matter.matterId}`);

    await expect(page.getByRole('tab')).toHaveText([/Tasks/, /Projects/, /Assets/]);
    await expect(
      page.getByRole('link', { name: task.taskRef ?? task.title }).first(),
    ).toBeVisible();
    await expect(panel(page)).toContainText('Sensitive');
    await expect(panel(page).getByRole('button', { name: 'Edit' })).toBeVisible();
    // One task is open, so deactivation is disabled and says why.
    await expect(panel(page).getByRole('button', { name: 'Set inactive' })).toBeDisabled();
    await expect(panel(page)).toContainText("aren't Completed or Cancelled");

    await page.getByRole('tab', { name: /Projects/ }).click();
    await expect(page).toHaveURL(/tab=projects/);
    await expect(page.getByRole('link', { name: project.name })).toBeVisible();
    await expect(panel(page)).toBeVisible();
  });

  test('Project: Tasks grid in the main area; Archive and Restore from the Details panel', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const project = await seed.project(world.matter);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${project.projectId}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(project.name);
    await panel(page).getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(panel(page).getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(panel(page)).toContainText('Archived');
  });

  test('Narrow screens: the Details panel moves above the main area as a collapsible summary, without page scroll', async ({
    page,
    seed,
  }) => {
    const longName = `A very long client name that must wrap inside the panel without any sideways scrolling ${uid()}`;
    const client = await seed.client({ name: longName });
    await seed.matter({ client, name: `Narrow Matter ${uid()}` });
    const url = `/clients/${client.clientId}`;

    // Tablet: expanded, above the grid.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(url);
    const toggle = panel(page).getByRole('button', { name: 'Details' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page)).toContainText(longName);
    const side = await panel(page).boundingBox();
    const grid = await page.getByRole('heading', { level: 2, name: 'Matters' }).boundingBox();
    expect(side!.y).toBeLessThan(grid!.y);
    await noHorizontalScroll(page);

    // Phone: collapsed until opened.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(url);
    const phoneToggle = panel(page).getByRole('button', { name: 'Details' });
    await expect(phoneToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page).getByRole('button', { name: 'Edit' })).toBeHidden();
    await noHorizontalScroll(page);
    await phoneToggle.click();
    await expect(phoneToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page).getByRole('button', { name: 'Edit' })).toBeVisible();
    await noHorizontalScroll(page);
  });
});
