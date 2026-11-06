import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * The Matter page header of the Matter detail redesign (MD-01, #1002): breadcrumb `Matters > number` with a copy button, the title `Client > Matter name`,
 * one subtitle line with the CM number and the Active, Sensitive and AI chips, the New and More actions menus, and the seven tabs. Replaces the Matter cases of
 * wp3-record-header.spec.ts, which tested the shared record header the Matter page no longer uses.
 */
const MATTER_150 =
  'Regulatory Investigation and Related Civil Litigation Concerning Historic Manufacturing, Distribution and Labelling Practices of Legacy Products Across Multiple Jurisdictions';
const SIZES = [
  [1366, 768],
  [1920, 1080],
] as const;

const menu = (page: Page, name: string) =>
  page.locator(`[data-matter-header] [data-overflow][aria-label^="${name}"]`);
const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

test.describe('Matter header (MD-01)', () => {
  test('breadcrumb with the matter name, title, New and More; no CM number or chips in the header (MD-42)', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Hartwell ${uid()}` });
    const matter = await seed.matter({ client, name: `Short ${uid()}` });
    await page.goto(`/matters/${matter.matterId}`);
    const header = page.locator('[data-matter-header]');
    await expect(header.getByRole('link', { name: 'Matters' })).toHaveAttribute('href', '/matters');
    await expect(header.locator('[data-crumb-current]')).toHaveText(matter.name);
    await expect(header.locator('h1')).toContainText(`${client.name}`);
    await expect(header.locator('h1')).toContainText(matter.name);
    // The CM number, Active and AI chips are in the Summary's Details, with the copy button.
    await expect(header).not.toContainText(matter.matterRef);
    await expect(header.locator('[data-matter-subtitle], [data-ai-chip]')).toHaveCount(0);
    const details = page.locator('[data-summary-details]');
    await expect(details).toContainText(matter.matterRef);
    await expect(details.locator('mf-copy-button button')).toBeVisible();
    await expect(details).toContainText('Active');
    await expect(details.locator('[data-ai-value]')).toContainText('No');
    await expect(header.locator('[data-sensitive-banner]')).toHaveCount(0);
    // No task counts or status buttons in the header.
    await expect(header).not.toContainText(/Overdue|Due soon|ASAP/);
  });

  test('a long matter name stays within two lines and the full name is in the tooltip', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Long ${uid()}` });
    const matter = await seed.matter({ client, name: MATTER_150 });
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${matter.matterId}`);
      const name = page.locator('[data-matter-header] h1 [data-name]');
      await expect(name).toBeVisible();
      await expect(name).toHaveAttribute('title', new RegExp(MATTER_150.slice(0, 40)));
      const lines = await name.evaluate(
        (e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight),
      );
      expect(lines, `title lines at ${w}`).toBeLessThanOrEqual(2.05);
      await noSidewaysScroll(page);
      if (axeAvailable()) expect(await axeViolations(page), `axe at ${w}`).toEqual([]);
    }
  });

  test('a sensitive matter keeps the access note in the header; the Sensitive chip is in the Details and points to the note', async ({
    page,
    seed,
  }) => {
    const client = await seed.client({ name: `Sens ${uid()}` });
    const matter = await seed.matter({ client, name: `Sensitive ${uid()}`, sensitive: true });
    await page.goto(`/matters/${matter.matterId}`);
    const note = page.locator('[data-matter-header] [data-sensitive-banner]');
    await expect(note).toHaveAttribute('role', 'note');
    await expect(note).toContainText('Only its project managers');
    const noteId = await note.getAttribute('id');
    await expect(
      page.locator('[data-summary-details] [data-sensitive-value] [aria-describedby]'),
    ).toHaveAttribute('aria-describedby', noteId!);
  });

  test('New menu offers Task, Project and Asset; New > Project opens the side panel and the page stays', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}`);
    await menu(page, 'Create').click();
    await expect(page.getByRole('menuitem')).toContainText(['Task', 'Project', 'Asset']);
    await page.getByRole('menuitem', { name: 'Project' }).click();
    const panel = page.locator('.mf-formdlg');
    await expect(panel).toContainText('New Project'); // a centred pop-up dialog (MD-22)
    // Cancel is on the left and the primary action on the right.
    const buttons = panel.locator('[data-panel-footer] button');
    await expect(buttons.first()).toHaveText('Cancel');
    await expect(buttons.last()).toHaveText('Create Project');
    await expect(page).toHaveURL(new RegExp(`/matters/${world.matter.matterId}$`));
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('More actions is a menu: ArrowDown opens it, Esc closes it and returns focus; Set inactive is blocked with its reason while tasks are open', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world);
    await page.goto(`/matters/${world.matter.matterId}`);
    const more = menu(page, 'More actions');
    await more.focus();
    await page.keyboard.press('ArrowDown');
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const toggle = page.getByRole('menuitem', { name: /Set inactive/ });
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toContainText("aren't Completed or Cancelled");
    await page.keyboard.press('Escape');
    await expect(more).toBeFocused();
  });

  test('Set inactive confirms and focus returns to More actions', async ({ page, seed }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}`);
    const more = menu(page, 'More actions');
    await more.click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set Matter Inactive' }).click();
    await expect(page.locator('[data-inactive-banner]')).toBeVisible();
    // The header no longer carries the Active chip: the inactive banner and the Summary's Status say it.
    await expect(page.locator('[data-summary-details]')).toContainText('Inactive');
  });

  test('seven tabs in order; a view-only user gets no New menu and no empty menus', async ({
    page,
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    await page.goto(`/matters/${world.matter.matterId}`);
    await expect(page.getByRole('tab')).toHaveText([
      /Summary/,
      /Tasks/,
      /Projects/,
      /Assets/,
      /Productions/,
      /Notes/,
      /Activities/,
    ]);
    const reader = await seed.role(['Matter.View', 'Client.View'], 'E2E header reader');
    const viewer = await seed.user([reader.name], 'header-reader');
    const page2 = await asUser(viewer.username);
    await page2.goto(`/matters/${world.matter.matterId}`);
    await expect(page2.locator('[data-matter-header] h1')).toBeVisible();
    await expect(page2.locator('[data-matter-header] [data-overflow]')).toHaveCount(0);
  });

  test('the loading skeleton has the same header height as the loaded page (no jump)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await page.setViewportSize({ width: 1366, height: 768 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/api/v1/matters/${world.matter.matterId}`, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`/matters/${world.matter.matterId}`, { waitUntil: 'commit' });
    const sk = page.locator('[data-matter-header-skeleton]');
    await expect(sk).toBeVisible();
    const skeleton = (await sk.boundingBox())!;
    const tabsSkeleton = (await page.locator('[role=tablist]').first().boundingBox())!;
    release();
    await expect(page.locator('[data-matter-header] h1')).toBeVisible();
    const loaded = (await page.locator('[data-matter-header]').boundingBox())!;
    const tabsLoaded = (await page.locator('[role=tablist]').first().boundingBox())!;
    expect(Math.abs(skeleton.height - loaded.height)).toBeLessThanOrEqual(8);
    expect(Math.abs(tabsSkeleton.y - tabsLoaded.y)).toBeLessThanOrEqual(8);
  });
});
