import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-SR2 (Search review S1, S8, BUG-4; #463, #464, #465): the header suggestion panel shows three hits per group with the true count in the
 * heading, "See all N" where hits are left out, a footer with the total and the searched types, and fits the phone viewport.
 * Screenshots go to E2E_SCREENSHOTS (docs/ux/search-review/fixes/sr2-panel).
 */
async function seedMany(seed: import('../support/seed').Seeder) {
  const token = `Srp${uid().replace(/[^a-z0-9]/gi, '')}`;
  const client = await seed.client({ name: `${token} client` });
  const matter = await seed.matter({ client, name: `${token} matter` });
  const world = await seed.world();
  for (let i = 0; i < 5; i++) await seed.task(world, { title: `${token} task ${i}` });
  for (let i = 0; i < 4; i++) await seed.asset(world.matter, `${token} asset ${i}`);
  await seed.project(world.matter, `${token} project`);
  return { token, matter };
}

async function openBox(
  page: Page,
  name = 'Search clients, matters, tasks, assets',
): Promise<Locator> {
  const box = page.getByRole('combobox', { name });
  const button = page.getByTestId('search-button');
  await box.or(button).first().waitFor({ state: 'visible' });
  if (!(await box.isVisible())) await button.click();
  return box;
}

async function suggest(page: Page, text: string, name?: string): Promise<Locator> {
  await page.goto('/dashboard');
  const box = await openBox(page, name);
  await box.fill(text);
  await expect(page.locator('[data-search-panel] [data-view-all]')).toBeVisible();
  return box;
}

test.describe('Suggestion panel counts and phone sheet (WP-SR2)', () => {
  test.skip(() => !axeAvailable(), 'axe-core is not available');

  test('headings carry the true counts, three hits per group, See all opens the type tab, footer total equals the tab counts, axe at four sizes', async ({
    page,
    seed,
  }) => {
    const s = await seedMany(seed);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await suggest(page, s.token);
      const panel = page.locator('[data-search-panel]');
      const where = `at ${size.width}`;

      await expect(panel.locator('[data-group=task] .mf-gs__group')).toHaveText('Tasks (5)');
      await expect(panel.locator('[data-group=asset] .mf-gs__group')).toHaveText('Assets (4)');
      await expect(panel.locator('[data-group=project] .mf-gs__group')).toHaveText('Projects (1)');
      // Three hits per group, never more; See all only where hits are left out.
      await expect(panel.locator('[data-group=task] [data-hit]')).toHaveCount(3);
      await expect(panel.locator('[data-group=asset] [data-hit]')).toHaveCount(3);
      await expect(panel.locator('[data-group=project] [data-see-all]')).toHaveCount(0);
      await expect(panel.locator('[data-group=task] [data-see-all]')).toContainText('See all 5');
      await expect(panel.locator('[data-view-all-text]')).toContainText(
        `View all 12 results for "${s.token}"`,
      );

      // Footer in view, panel inside the page, no sideways scroll, axe clean with the panel open.
      const f = (await panel.locator('[data-view-all]').boundingBox())!;
      expect(f.y + f.height, `footer bottom ${where}`).toBeLessThanOrEqual(size.height);
      await noHorizontalScroll(page);
      expect(await axeViolations(page), `axe ${where}`).toEqual([]);
      await shot(page, 'sr2-panel');
    }

    // The counts equal the tab counts of the results page; See all opens the type tab.
    await page.setViewportSize({ width: 1366, height: 768 });
    const box = await suggest(page, s.token);
    await page.locator('[data-group=task] [data-see-all]').click();
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${s.token}&type=task`));
    await expect(page.getByRole('tab', { name: /^Tasks, 5 results/ })).toBeVisible();
    await expect(box).toBeVisible();
  });

  test('keyboard: Down meets See all before the group hits and Enter opens the tab', async ({
    page,
    seed,
  }) => {
    const s = await seedMany(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const box = await suggest(page, s.token);
    // Matters and Clients (one hit each, no See all) come first; the Tasks group starts with its See all.
    const options = page.locator('[data-search-panel] [role=option]');
    const seeAllIndex = await options.evaluateAll((els) =>
      els.findIndex((e) => e.hasAttribute('data-see-all')),
    );
    for (let i = 0; i <= seeAllIndex; i++) await box.press('ArrowDown');
    await expect(page.locator('[data-see-all][aria-selected=true]')).toHaveCount(1);
    await box.press('Enter');
    await expect(page).toHaveURL(/type=task/);
  });

  test('phone: the sheet fits the visible viewport with the footer in view, also with a 336 px high viewport', async ({
    page,
    seed,
  }) => {
    const s = await seedMany(seed);
    for (const size of [
      { width: 375, height: 812 },
      { width: 375, height: 667 },
      { width: 375, height: 336 }, // on-screen keyboard open
    ]) {
      await page.setViewportSize(size);
      await suggest(page, s.token);
      const panel = page.locator('[data-search-panel]');
      const footer = panel.locator('[data-view-all]');
      await expect(footer).toBeInViewport({ ratio: 0.99 });
      const p = (await panel.boundingBox())!;
      expect(p.y + p.height).toBeLessThanOrEqual(size.height);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.width).toBeLessThanOrEqual(size.width + 0.5);
      await noHorizontalScroll(page);
      expect(await axeViolations(page), `axe ${size.width}x${size.height}`).toEqual([]);
      await shot(page, 'sr2-panel-phone');
      await footer.click();
      await expect(page).toHaveURL(/\/search\?q=/);
    }
    // The page behind scrolls again once the panel is closed.
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  test('S8: the placeholder and the footer name only what is searched (Task.View only)', async ({
    seed,
    asUser,
  }) => {
    const s = await seedMany(seed);
    const role = await seed.role(['Task.View'], 'E2E tasks only');
    const user = await seed.user([role.name], 'tasks-only');
    const page = await asUser(user.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/my-work');
      const box = await openBox(page, 'Search tasks');
      await expect(box).toHaveAttribute('placeholder', 'Search tasks... (Ctrl+K)');
      await box.fill(s.token);
      await expect(page.locator('[data-search-panel] [data-view-all]')).toBeVisible();
      await expect(page.locator('[data-searched-in]')).toHaveText('Searched in: Tasks');
      await expect(page.locator('[data-group]')).toHaveCount(1);
      expect(await axeViolations(page), `axe tasks only ${size.width}`).toEqual([]);
    }
  });

  test('S8: System Admin sees the full placeholder and no searched-in line', async ({
    page,
    seed,
  }) => {
    const s = await seedMany(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    const box = await suggest(page, s.token);
    await expect(box).toHaveAttribute(
      'placeholder',
      'Search clients, matters, tasks, assets... (Ctrl+K)',
    );
    await expect(page.locator('[data-searched-in]')).toHaveCount(0);
  });
});
