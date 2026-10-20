import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedMix } from '../support/admin-lists';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP-AD2 #544 (admin list shell), #545 (counted route tabs, first allowed tab) and #554 (row overflow) on the list that adopts the kit:
 * the Task Types administration (/admin/task-types, /admin/workflows, /admin/steps). Screenshots go to E2E_SCREENSHOTS
 * (docs/ux/admin-pages-review/fixes/ad2-kit).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const TABS = [
  { key: 'task-types', url: '/admin/task-types', label: 'Task Types', table: '[data-task-types]' },
  { key: 'workflows', url: '/admin/workflows', label: 'Workflows', table: '[data-workflows]' },
  { key: 'steps', url: '/admin/steps', label: 'Workflow Steps', table: '[data-steps]' },
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

const toggle = (page: Page) => page.locator('[data-filters-toggle]');
const skip = (page: Page) => page.locator('a.mf-skip[data-skip-list]');

test.describe('the shell on the Task Types administration (#544, #545)', () => {
  test('crumb, H1 and one-line description do not wrap at 1366 and 1920; Filters comes before the primary action', async ({
    page,
    admin,
  }) => {
    await seedMix(admin, 'types', uid(), 2, 0);
    for (const tab of TABS) {
      for (const size of [SIZES[0], SIZES[1]]) {
        await page.setViewportSize(size);
        await page.goto(tab.url);
        const header = page.locator('mf-page-header');
        const box = await header.evaluate((el) => {
          // The number of text lines of an element: its height over its line height (an icon on the baseline must not count as a line).
          const lines = (sel: string) => {
            const node = el.querySelector<HTMLElement>(sel);
            if (!node) return 0;
            const style = getComputedStyle(node);
            const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
            return Math.round(node.getBoundingClientRect().height / lh);
          };
          const desc = el.querySelector<HTMLElement>('[data-page-description]')!;
          return {
            crumb: lines('nav ol'),
            title: lines('h1'),
            desc: lines('[data-page-description]'),
            clipped: desc.scrollWidth > desc.clientWidth,
          };
        });
        expect(box, `${tab.key} at ${size.width}`).toEqual({
          crumb: 1,
          title: 1,
          desc: 1,
          clipped: false,
        });
        // Filters first, then the primary action last (right).
        const order = await page.evaluate(() => {
          const f = document.querySelector('[data-filters-toggle]')!.getBoundingClientRect();
          const buttons = Array.from(
            document.querySelectorAll('[data-page-actions] button'),
          ).filter(
            (b) => !b.hasAttribute('data-filters-toggle') && !b.hasAttribute('data-clear-filters'),
          );
          const last = buttons[buttons.length - 1].getBoundingClientRect();
          return { filtersLeft: f.left, primaryLeft: last.left };
        });
        expect(order.filtersLeft, `${tab.key} at ${size.width}`).toBeLessThan(order.primaryLeft);
        await expect(page.locator('nav[aria-label="Breadcrumb"]')).toContainText('Administration');
      }
    }
  });

  test('"Skip to table" is the first Tab stop on every tab, visible on focus, and moves focus to the first row', async ({
    page,
    admin,
  }) => {
    await seedMix(admin, 'types', uid(), 2, 0);
    await page.setViewportSize(SIZES[1]);
    for (const tab of TABS) {
      await page.goto(tab.url);
      await expect(page.locator(`${tab.table} tbody tr[data-row]`).first()).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(skip(page)).toBeFocused();
      await expect(skip(page)).toHaveText('Skip to table');
      const rect = await skip(page).boundingBox();
      expect(rect && rect.width > 0 && rect.height > 0, 'the link is visible when focused').toBe(
        true,
      );
      await shot(page, `shell-skip-${tab.key}`);
      await page.keyboard.press('Enter');
      // The list's own skip target (#413) replaces the shell's: focus lands on the first row's name link.
      await expect(page.locator(`${tab.table} tbody tr[data-row] a`).first()).toBeFocused();
    }
  });

  test('on a phone the skip link lands on the first card', async ({ page, admin }) => {
    await seedMix(admin, 'types', uid(), 2, 0);
    await page.setViewportSize(SIZES[4]);
    await page.goto('/admin/task-types');
    // The first card with a link (the loading skeleton has cards without one).
    await expect(page.locator('li.rc a[href]').first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(skip(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('li.rc a[href]').first()).toBeFocused();
  });

  test('the tabs carry the active count and keep the arrow, Home and End keys', async ({
    page,
    admin,
  }) => {
    await seedMix(admin, 'types', uid(), 2, 1);
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/task-types');
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText([
      /Task Types \(\d+\)$/,
      /Workflows \(\d+\)$/,
      /Workflow Steps \(\d+\)$/,
    ]);
    await expect(tabs.first()).toHaveAttribute('aria-label', /^Task Types, \d+ active$/);
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/admin\/workflows$/);
    await expect(page.getByRole('tab', { name: /^Workflows/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(page).toHaveURL(/\/admin\/steps$/);
    await page.keyboard.press('Home');
    await expect(page).toHaveURL(/\/admin\/task-types$/);
    await expect(page.locator('[role="tabpanel"]')).toHaveAttribute(
      'aria-labelledby',
      'task-types-admin-tab-task-types',
    );
  });

  test('there is one Clear filters at a time: in the header while the row is open, with the chips while it is closed', async ({
    page,
    admin,
  }) => {
    const token = uid();
    await seedMix(admin, 'types', token, 2, 0);
    await page.setViewportSize(SIZES[1]);
    await page.goto(`/admin/task-types?name=${token}`);
    await expect(page.locator('#task-type-filter-row')).toBeVisible();
    await expect(page.locator('[data-clear-filters]')).toHaveCount(1);
    await expect(page.locator('mf-page-header [data-clear-filters]')).toHaveCount(1);
    await toggle(page).click();
    await expect(page.locator('#task-type-filter-row')).toHaveCount(0);
    await expect(page.locator('[data-clear-filters]')).toHaveCount(1);
  });

  test('permissions: Workflow.Manage only gets two tabs and Workflows; TaskType.Manage only gets no tab strip; Task.View only gets the 403 without a toast', async ({
    seed,
    asUser,
  }) => {
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ad2-wfonly')).username);
    await wf.goto('/admin/task-types');
    await expect(wf).toHaveURL(/\/admin\/workflows$/);
    await expect(wf.getByRole('tab')).toHaveText([/Workflows \(\d+\)$/, /Workflow Steps \(\d+\)$/]);

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ad2-ttonly')).username);
    await tt.goto('/admin/workflows');
    await expect(tt).toHaveURL(/\/admin\/task-types$/);
    await expect(tt.getByRole('heading', { name: 'Task Types', level: 1 })).toBeVisible();
    await expect(tt.getByRole('tablist')).toHaveCount(0);
    await expect(tt.locator('[data-task-types]')).toBeVisible();
    await expect(tt.locator('[data-filters-toggle]')).toBeVisible();

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ad2-viewer')).username);
    await viewer.goto('/admin/task-types');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(viewer.getByRole('tablist')).toHaveCount(0);
    await expect(viewer.locator('.p-toast-message, [role="alert"]:has-text("denied")')).toHaveCount(
      0,
    );
    await expect(
      viewer.getByRole('link', { name: /Task Types/ }).and(viewer.locator('mf-page-header *')),
    ).toHaveCount(0);
  });
});

test.describe('axe, reflow and the row overflow at five widths (#544, #545, #554)', () => {
  for (const size of SIZES) {
    test(`${size.width}: axe 0 and no sideways scroll on every tab, with the row menu and the Filters sheet open`, async ({
      page,
      admin,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      const token = uid();
      await seedMix(admin, 'types', token, 3, 1);
      await page.setViewportSize(size);
      for (const tab of TABS) {
        await page.goto(tab.url);
        await expect(page.locator('tbody tr[data-row], li.rc').first()).toBeVisible();
        await noSideScroll(page, `${tab.key} at ${size.width}`);
        expect(await axeViolations(page), `${tab.key} at ${size.width}`).toEqual([]);
        await shot(page, `shell-${tab.key}`);
      }
      // The last row's menu opens in view (floating), one Tab stop per row, and axe is clean with it open. The list is limited to the rows
      // seeded above: on a long list the rows that scroll under the sticky header are part-covered links, which axe reports whatever the
      // list is (the data volume of the shared database must not decide this test).
      await page.goto(`/admin/task-types?name=${token}`);
      await page.locator('tbody tr[data-row], li.rc').first().waitFor();
      const menus = page.locator('[data-overflow]');
      const last = size.width >= 640 ? menus.last() : menus.first();
      await last.scrollIntoViewIfNeeded();
      await last.click();
      const menu = page.getByRole('menu').first();
      await expect(menu).toBeVisible();
      const inView = await menu.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.bottom <= window.innerHeight &&
          r.left >= 0 &&
          r.right <= window.innerWidth
        );
      });
      expect(inView, `menu in view at ${size.width}`).toBe(true);
      await expect(last).toHaveAttribute('aria-label', /^Actions for /);
      expect(await axeViolations(page), `menu open at ${size.width}`).toEqual([]);
      await shot(page, 'shell-menu');
      await page.keyboard.press('Escape');
      await expect(last).toBeFocused();
      if (size.width < 640) {
        await toggle(page).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await axeViolations(page), `sheet open at ${size.width}`).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(toggle(page)).toBeFocused();
      }
    });
  }
});
