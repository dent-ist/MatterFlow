import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/** The Client, Matter and Project detail pages: Client and Matter have Details as their first tab, Project keeps its Details panel; the Activity drawer (docs/ux/detail-layout). */
test.describe('Detail pages: main area, Details panel and Activity drawer', () => {
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Details' });

  /** Between 1100 and 1399 px a Matter's or Project's Details panel starts collapsed to a slim "Details" button (UXR4-02). */
  async function showDetails(page: Page): Promise<void> {
    const toggle = panel(page).getByRole('button', { name: 'Details' });
    if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
      await toggle.click();
    }
  }

  async function noHorizontalScroll(page: Page): Promise<void> {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test('Client: Details is the first tab and the default; the Matters tab has the grid across the full width; no side panel', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Layout Client ${uid()}` });
    const matter = await seed.matter({ client, number: '00007', name: `Layout Matter ${uid()}` });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/clients/${client.clientId}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(client.name);
    await expect(page.getByRole('tab')).toHaveText(['Details', 'Matters']);
    await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(panel(page)).toHaveCount(0);
    const details = page.getByRole('tabpanel');
    await expect(details).toContainText(client.clientNumber);
    await expect(details).toContainText(client.name);
    await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Set inactive' })).toBeVisible();

    await page.getByRole('tab', { name: 'Matters' }).click();
    await expect(page).toHaveURL(/tab=matters/);
    const row = page.getByRole('row').filter({ hasText: matter.name });
    await expect(row.getByRole('link', { name: matter.matterRef })).toHaveAttribute(
      'href',
      `/matters/${matter.matterId}`,
    );
    const grid = (await page
      .getByRole('region', { name: 'Matters list, scrollable' })
      .boundingBox())!;
    expect(grid.width).toBeGreaterThan(1280 - 300); // the whole page width (less the menu), not beside a panel

    await page.getByRole('button', { name: 'Create matter' }).click();
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

    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByRole('textbox', { name: 'Filter by Name' }).fill(active.name);
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

  test('Matter: Details, Tasks, Projects and Assets tabs; Details has the facts, Edit and Set inactive', async ({
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
    await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
    // One task is open, so deactivation is disabled and says why.
    await expect(details.getByRole('button', { name: 'Set inactive' })).toBeDisabled();
    await expect(details).toContainText("aren't Completed or Cancelled");

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

  test('Project: Tasks grid in the main area; Archive and Restore from the Details panel', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const project = await seed.project(world.matter);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${project.projectId}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText(project.name);
    await showDetails(page);
    await panel(page).getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(panel(page).getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(panel(page)).toContainText('Archived');
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
    await expect(page.getByRole('tabpanel')).toContainText(longName);
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(url);
    await expect(page.getByRole('tabpanel').getByRole('button', { name: 'Edit' })).toBeVisible();
    await noHorizontalScroll(page);
    const dt = (await page.locator('[data-details-tab] dt').first().boundingBox())!;
    const dd = (await page.locator('[data-details-tab] dd').first().boundingBox())!;
    expect(dd.y).toBeGreaterThan(dt.y); // label above value: single column
  });
});
