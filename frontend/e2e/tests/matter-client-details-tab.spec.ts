import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Matter and Client detail pages (#244): Details is the first tab and the default, the old right-hand Details panel is gone, the
 * other tabs keep their `?tab=` deep links. Every test works on its own tagged client / matter (the database is shared).
 *
 * Screenshots (not a test: skipped unless E2E_SCREENSHOTS is set to the output folder):
 *   E2E_SCREENSHOTS=docs/ux/org-details-tab frontend/e2e/run-local.sh -g "org details tab screenshots"
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const noHorizontalScroll = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name });
const noAside = (page: Page) =>
  expect(page.locator('aside, [data-detail-panel]'), 'no right-hand Details panel').toHaveCount(0);

test.describe('Matter and Client detail pages: Details is the first tab', () => {
  test('Matter: Details is first and selected by default, shows the facts, and there is no side panel', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ sensitive: true });
    await seed.task(world);
    await seed.project(world.matter);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}`);

    await expect(page.getByRole('tab')).toHaveText([
      /^\s*Details\s*$/,
      /^\s*Tasks/,
      /^\s*Projects/,
      /^\s*Assets\s*$/,
    ]);
    await expect(tab(page, 'Details')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Details')).toHaveAttribute('tabindex', '0');
    await expect(tab(page, /^Tasks/)).toHaveAttribute('tabindex', '-1');
    await expect(page).not.toHaveURL(/tab=/);
    await noAside(page);

    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('id', 'matter-panel');
    await expect(panel).toHaveAttribute('aria-labelledby', 'matter-tab-details');
    await expect(panel.getByText('Matter reference')).toBeVisible();
    await expect(panel).toContainText(world.matter.matterRef);
    await expect(panel).toContainText(world.matter.name);
    await expect(panel).toContainText('Sensitive');
    await expect(panel).toContainText('Warning only');
    await expect(panel.getByRole('link', { name: new RegExp(world.client.name) })).toHaveAttribute(
      'href',
      `/clients/${world.client.clientId}`,
    );
    // The actions are in the header (WP3): Edit, and Set inactive in the overflow, disabled with its reason.
    await expect(panel.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(
      page.locator('[data-page-actions]').getByRole('button', { name: 'Edit' }),
    ).toBeVisible();
    await page.locator('[data-overflow]').click();
    const blocked = page.getByRole('menuitem', { name: /Set inactive/ });
    await expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await expect(blocked).toContainText("aren't Completed or Cancelled");
    await page.keyboard.press('Escape');
    // Readable form-like list: left aligned, no wider than about 70 characters.
    const list = (await panel.locator('dl.pg-dl').boundingBox())!;
    const area = (await page
      .getByRole('region', { name: 'Matter details, scrollable' })
      .boundingBox())!;
    expect(list.x - area.x).toBeLessThan(40);
    expect(list.width).toBeLessThan(760);
    await noHorizontalScroll(page);
  });

  test('Matter: deep links ?tab=tasks|projects|assets, the tab list is URL-synced, and the Tasks grid has the whole page width', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const project = await seed.project(world.matter);
    const asset = await seed.asset(world.matter);
    await page.setViewportSize({ width: 1366, height: 768 });
    const base = `/matters/${world.matter.matterId}`;

    await page.goto(`${base}?tab=tasks`);
    await expect(tab(page, /^Tasks/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(`tr[data-task="${task.taskNumber}"]`)).toBeVisible();
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'matter-tab-tasks');
    const grid = (await page.locator('.wt-wrap').boundingBox())!;
    expect(grid.width).toBeGreaterThan(1366 - 300); // the page width less the menu; the old side panel took 340 px more
    await noAside(page);

    await page.goto(`${base}?tab=projects`);
    await expect(tab(page, /^Projects/)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('link', { name: project.name })).toBeVisible();

    await page.goto(`${base}?tab=assets`);
    await expect(tab(page, 'Assets')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Assets list, scrollable' })).toContainText(
      asset.displayName,
    );

    await page.goto(base);
    await tab(page, /^Projects/).click();
    await expect(page).toHaveURL(/tab=projects/);
    await tab(page, 'Details').click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(tab(page, 'Details')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(tab(page, /^Projects/)).toHaveAttribute('aria-selected', 'true');
  });

  test('Matter: arrow keys, Home and End move between the tabs (roving tabindex)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}`);
    await tab(page, 'Details').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Tasks/)).toBeFocused();
    await expect(tab(page, /^Tasks/)).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/tab=tasks/);
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Projects/)).toBeFocused();
    await page.keyboard.press('End');
    await expect(tab(page, 'Assets')).toBeFocused();
    await page.keyboard.press('ArrowRight'); // wraps round to the first tab
    await expect(tab(page, 'Details')).toBeFocused();
    await expect(tab(page, 'Details')).toHaveAttribute('aria-selected', 'true');
    await expect(page).not.toHaveURL(/tab=/);
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Assets')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab(page, 'Details')).toBeFocused();
  });

  test('Client: Overview is first and selected by default, shows the strip and the dates, and there is no side panel', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Details Client ${uid()}` });
    const matter = await seed.matter({ client, number: '00003', name: `Details Matter ${uid()}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/clients/${client.clientId}`);

    await expect(page.getByRole('tab')).toHaveText([/^\s*Overview\s*$/, /^\s*Matters \(1\)\s*$/]);
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page).not.toHaveURL(/tab=/);
    await noAside(page);
    const panel = page.getByRole('tabpanel');
    await expect(panel).toHaveAttribute('id', 'client-panel');
    await expect(panel).toHaveAttribute('aria-labelledby', 'client-tab-details');
    await expect(panel).toContainText('Created'); // the number, name and status are in the header only (WP6)
    await expect(panel).not.toContainText(client.name);
    await expect(panel.locator('[data-strip]')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Edit' })).toHaveCount(0); // the header has it (WP3)
    await expect(
      page.locator('[data-page-actions]').getByRole('button', { name: 'Edit' }),
    ).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: matter.name })).toHaveCount(0);

    // Deep link and keyboard.
    await tab(page, 'Overview').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Matters')).toBeFocused();
    await expect(page).toHaveURL(/tab=matters/);
    await expect(page.getByRole('row').filter({ hasText: matter.name })).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page).not.toHaveURL(/tab=/);
    await page.goto(`/clients/${client.clientId}?tab=matters`);
    await expect(tab(page, 'Matters')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('row').filter({ hasText: matter.name })).toHaveCount(1);
  });

  test('Edit from the header opens the form and Cancel comes back to the Overview; Set inactive from the overflow returns focus to the overflow button', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Edit Client ${uid()}` });
    await page.goto(`/clients/${client.clientId}`);
    await page.locator('[data-page-actions]').getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client.clientId}/edit$`));
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${client.clientId}$`));
    await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');

    const overflow = page.locator('[data-overflow]');
    await overflow.click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(overflow).toBeFocused();
    await overflow.click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set inactive' }).click();
    await overflow.click();
    await expect(page.getByRole('menuitem', { name: 'Set active' })).toBeVisible();
    await expect(page.locator('[data-record-header]')).toContainText('Inactive'); // the status is in the header only (WP6)
  });

  test('a read-only user sees the Details and Overview without Edit or Set inactive, and a plain client name without Client.View', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const reader = await seed.role(['Matter.View', 'Client.View'], 'E2E details reader');
    const viewer = await seed.user([reader.name], 'details-reader');
    const page = await asUser(viewer.username);

    await page.goto(`/matters/${world.matter.matterId}`);
    const panel = page.getByRole('tabpanel');
    await expect(tab(page, 'Details')).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toContainText(world.matter.matterRef);
    await expect(panel.getByRole('link', { name: new RegExp(world.client.name) })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Set (in)?active$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Activity' })).toHaveCount(0);

    await page.goto(`/clients/${world.client.clientId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(world.client.name);
    await expect(page.getByRole('tabpanel')).toContainText('Created');
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Set (in)?active$/ })).toHaveCount(0);

    const noClient = await seed.role(['Matter.View'], 'E2E matter only');
    const other = await seed.user([noClient.name], 'matter-only');
    const page2 = await asUser(other.username);
    await page2.goto(`/matters/${world.matter.matterId}`);
    await expect(page2.getByRole('tabpanel')).toContainText(world.client.name);
    await expect(page2.locator('[data-client-value] a')).toHaveCount(0);
  });

  test('a long Details tab scrolls inside the panel while the header and tabs stay put', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Scroll Client ${uid()}` });
    await page.setViewportSize({ width: 1366, height: 600 });
    await page.goto(`/clients/${client.clientId}`);
    const area = page.getByRole('region', { name: 'Client overview, scrollable' });
    await expect(area).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('[data-details-tab] .ov')!;
      const filler = document.createElement('div');
      filler.style.height = '1500px';
      el.appendChild(filler);
    });
    const title = page.getByRole('heading', { level: 1 });
    const before = (await title.boundingBox())!;
    await area.evaluate((el) => (el.scrollTop = 400));
    expect(await area.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await title.boundingBox()).toEqual(before);
    await expect(tab(page, 'Overview')).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
  });

  test('accessibility: Matter and Client Details and the other tabs have no axe violations at 1366, 1920, 768 and 375', async ({
    page,
    seed,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not available (set E2E_AXE_PATH)');
    test.setTimeout(240_000);
    const world = await seed.world({ sensitive: true });
    await seed.task(world);
    await seed.project(world.matter);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const url of [
        `/matters/${world.matter.matterId}`,
        `/matters/${world.matter.matterId}?tab=tasks`,
        `/clients/${world.client.clientId}`,
        `/clients/${world.client.clientId}?tab=matters`,
      ]) {
        await page.goto(url);
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await expect(page.getByRole('tabpanel')).not.toContainText('Loading');
        await noHorizontalScroll(page);
        expect(await axeViolations(page), `${url} at ${size.width}`).toEqual([]);
      }
    }
  });
});

const OUT = process.env['E2E_SCREENSHOTS'];

test.describe('org details tab screenshots', () => {
  test.skip(!OUT, 'set E2E_SCREENSHOTS to the output folder');

  test('capture', async ({ page, seed }) => {
    test.setTimeout(300_000);
    const world = await seed.world({ sensitive: true });
    await seed.task(world);
    await seed.project(world.matter);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      for (const [name, url] of [
        ['matter-details', `/matters/${world.matter.matterId}`],
        ['matter-tasks', `/matters/${world.matter.matterId}?tab=tasks`],
        ['client-details', `/clients/${world.client.clientId}`],
        ['client-matters', `/clients/${world.client.clientId}?tab=matters`],
      ] as const) {
        await page.goto(url);
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(OUT!, `${name}-${size.width}x${size.height}.png`),
        });
      }
    }
  });
});
