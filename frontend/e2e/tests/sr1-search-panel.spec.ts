import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-SR1 (Search review BUG-1, BUG-2, BUG-3, BUG-6): the header suggestion panel at the four sizes. Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/search-review/fixes/sr1-bugs).
 */
const URL_REFERENCE = `https://share.example.com/${'x'.repeat(960)}`;

async function seedFamily(seed: import('../support/seed').Seeder, sensitive: boolean) {
  const token = `Srq${uid().replace(/[^a-z0-9]/gi, '')}`;
  const world = await seed.world({ sensitive });
  const task = await seed.task(world, { title: `${token} task` });
  const project = await seed.project(world.matter, `${token} project`);
  const asset = await seed.admin.post('/api/v1/assets', {
    matterId: world.matter.matterId,
    assetTypeId: await seed.assetTypeId(),
    displayName: `${token} asset`,
    externalReference: URL_REFERENCE,
  });
  return { token, world, task, project, asset };
}

/** The header box at any width: on a phone it sits behind the search button. */
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

async function suggest(page: Page, text: string): Promise<Locator> {
  await page.goto('/dashboard');
  const box = await openBox(page);
  await box.fill(text);
  await expect(page.locator('[data-search-panel] [data-view-all]')).toBeVisible();
  return box;
}

test.describe('Search suggestion panel (WP-SR1)', () => {
  test.skip(() => !axeAvailable(), 'axe-core is not available');

  test('BUG-1, BUG-2, BUG-3, BUG-6 at four sizes: no violation, asset lines, one marker, no requestor, footer in view', async ({
    page,
    seed,
  }) => {
    const s = await seedFamily(seed, true);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const box = await suggest(page, s.token);
      const panel = page.locator('[data-search-panel]');
      const where = `at ${size.width}`;

      // BUG-2: the asset is its name, never the URL, and the URL stays in the tooltip.
      const asset = panel.getByRole('option', { name: new RegExp(`${s.token} asset`) });
      await expect(asset).toBeVisible();
      await expect(asset).not.toContainText('https://');
      await expect(asset).toHaveAttribute('title', URL_REFERENCE);
      await expect(asset.locator('.mf-gs__ref')).toHaveCount(0);
      await expect(asset.locator('.mf-gs__sub')).toContainText(s.world.matter.matterRef);

      // BUG-6: one named lock per option of a sensitive matter, never the full badge, and no requestor.
      const task = panel.getByRole('option', { name: new RegExp(`${s.token} task`) });
      await expect(task.locator('[data-sensitive-marker]')).toHaveCount(1);
      await expect(task.getByRole('img', { name: 'Sensitive matter' })).toHaveCount(1);
      await expect(task.locator('mf-sensitive-badge')).toHaveCount(0);
      await expect(panel).not.toContainText('Rita Requestor');

      // BUG-3: the footer is on screen without scrolling and the panel stays inside the page.
      const footer = panel.locator('[data-view-all]');
      const f = (await footer.boundingBox())!;
      expect(f.y + f.height, `footer bottom ${where}`).toBeLessThanOrEqual(size.height);
      expect(f.y, `footer top ${where}`).toBeGreaterThanOrEqual(0);
      const p = (await panel.boundingBox())!;
      expect(p.x + p.width, `panel right edge ${where}`).toBeLessThanOrEqual(size.width + 0.5);
      await noHorizontalScroll(page);

      // BUG-1: axe finds nothing with the panel open.
      expect(await axeViolations(page), `axe ${where}`).toEqual([]);
      await shot(page, 'sr1-panel');

      // The footer is one ArrowUp from the input, names itself as the active option and opens the results page.
      await box.press('ArrowUp');
      await expect(box).toHaveAttribute('aria-activedescendant', 'mf-gs-view-all');
      await box.press('Enter');
      await expect(page).toHaveURL(/\/search\?q=/);
    }
  });

  test('BUG-1: a panel that has to scroll is a named region and still has no axe violation; the arrows keep the active option in view', async ({
    page,
    seed,
  }) => {
    const token = `Srs${uid().replace(/[^a-z0-9]/gi, '')}`;
    const world = await seed.world();
    for (let i = 0; i < 6; i++) await seed.task(world, { title: `${token} task ${i}` });
    await page.setViewportSize({ width: 1366, height: 240 }); // short window: the three hits and the footer cannot fit
    const box = await suggest(page, token);
    const scroller = page.locator('[data-search-scroll]');
    await expect(scroller).toHaveAttribute('role', 'region');
    await expect(scroller).toHaveAttribute('aria-label', 'Search suggestions');
    expect(await axeViolations(page), 'axe with a scrolling panel').toEqual([]);
    await shot(page, 'sr1-panel-scrolling');

    for (let i = 0; i < 5; i++) await box.press('ArrowDown');
    const active = page.locator('[role=option][aria-selected=true]');
    await expect(active).toBeInViewport();
    await expect(box).toBeFocused();
  });

  test('a person with Task.View only gets task options with no matter link text and no dead marker', async ({
    seed,
    asUser,
  }) => {
    const s = await seedFamily(seed, false);
    const role = await seed.role(['Task.View'], 'E2E tasks only');
    const user = await seed.user([role.name], 'tasks-only');
    const page = await asUser(user.username);
    await page.goto('/my-work');
    const box = await openBox(page, 'Search tasks');
    await box.fill(s.token);
    const panel = page.locator('[data-search-panel]');
    const task = panel.getByRole('option', { name: new RegExp(`${s.token} task`) });
    await expect(task).toBeVisible();
    await expect(task.locator('.mf-gs__sub')).not.toContainText(s.world.matter.matterRef);
    await expect(panel.getByRole('option', { name: new RegExp(`${s.token} asset`) })).toHaveCount(
      0,
    );
    expect(await axeViolations(page), 'axe, Task.View only').toEqual([]);
  });
});
