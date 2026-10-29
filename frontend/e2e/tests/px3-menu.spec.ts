import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { pmFixtures } from '../support/pm-fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';

/**
 * The menu of the Project Manager (epic #758; MM-59 #951 removed the "More" group): the one order, My Matters, My Work, Clients, Matters, Projects
 * and Assets (indented), Tasks, and no Pod Work. The Reports item waits for epic #671 and is not there. Everybody who does not land on My
 * Matters has the same order with "Task Queue" and Pod Work.
 */
test.describe('The short menu of the Project Manager', () => {
  const links = (page: Page) => page.locator('nav[aria-label="Main"] a');

  test('My Matters, My Work, Clients, Matters, Projects, Assets, Tasks; no More button and no Pod Work', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const page = await asUser(fx.pmA.username);
    await page.goto('/my-matters');
    await expect(links(page)).toHaveText([
      'My Matters',
      'My Work',
      'Clients',
      'Matters',
      'Projects',
      'Assets',
      'Tasks',
    ]);
    await expect(page.locator('[data-nav-more], [data-nav-more-toggle]')).toHaveCount(0);
    // Every route stays reachable, with the current item marked; an indented item is current without Matters.
    await page.goto('/my-work');
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('My Work');
    await page.goto('/projects');
    await expect(page.locator('nav a[aria-current="page"]')).toHaveText('Projects');
    // The go-to sequences keep working (no new or changed shortcut).
    await page.goto('/my-matters');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/tasks/);
  });

  test('the full menu stays for the System Admin and for everybody who does not land on My Matters', async ({
    page,
    seed,
    personas,
    asUser,
  }) => {
    await page.goto('/matters');
    await expect(links(page).filter({ hasText: 'Pod Work' })).toHaveCount(1);
    await expect(links(page).filter({ hasText: 'Task Queue' })).toHaveCount(1);
    const fx = await pmFixtures(seed, personas);
    const noTask = await asUser(fx.pmNoTask.username); // no Task.View: does not land on My Matters
    await noTask.goto('/matters');
    await expect(noTask.locator('[data-nav-more]')).toHaveCount(0);
    const tech = await asUser(fx.technician.username);
    await tech.goto('/my-work');
    await expect(tech.locator('[data-nav-more]')).toHaveCount(0);
    await expect(
      tech.locator('nav[aria-label="Main"] a').filter({ hasText: 'My Work' }),
    ).toHaveCount(1);
  });

  for (const size of SIZES) {
    test(`axe and no sideways scroll at ${size.width}x${size.height}, menu open`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const fx = await pmFixtures(seed, personas);
      const page = await asUser(fx.pmA.username);
      await page.setViewportSize(size);
      for (const url of ['/matters', '/tasks', '/assets', '/clients', '/projects']) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expect(page.locator('[data-scope-switch]')).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await axeViolations(page), `${url} at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        if (size.width < 640) {
          // The scope switch is a full-width two-button group on a phone with 44 px targets.
          const box = await page.locator('[data-scope="all"]').boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(43.5);
        }
      }
      if (size.width < 640) await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Main menu' })).toBeVisible();
      expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
    });
  }
});
