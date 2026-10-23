import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * App shell navigation on phones (#164, WP13a): below 640 px the rail collapses behind a Menu button that opens the navigation as an
 * overlay panel; from 640 px the rail is unchanged. Every main screen is opened at 375 and 768 px and must have no horizontal scroll and
 * no axe violations. With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/my-work-review/fixes/wp13a.
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const OUT_WP_RAIL = process.env['E2E_SCREENSHOTS_RAIL'];
const PHONE = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

let taskId: number;
test.beforeAll(async ({ seed }) => {
  const world = await seed.world();
  taskId = (await seed.task(world)).taskId;
});

const SCREENS: { name: string; url: string; heading: RegExp }[] = [
  { name: 'dashboard', url: '/dashboard', heading: /Dashboard/ },
  { name: 'my-work', url: '/my-work', heading: /My Work/ },
  { name: 'task-queue', url: '/tasks', heading: /Task Queue/ },
  { name: 'pod-work', url: '/pods/work', heading: /Pod Work/ },
  { name: 'matters', url: '/matters', heading: /Matters/ },
  { name: 'clients', url: '/clients', heading: /Clients/ },
  { name: 'projects', url: '/projects', heading: /Projects/ },
  { name: 'assets', url: '/assets', heading: /Assets/ },
  { name: 'admin-users', url: '/admin/users', heading: /Users/ },
  { name: 'admin-task-types', url: '/admin/task-types', heading: /Task Types/ },
  { name: 'admin-labels', url: '/admin/priorities', heading: /Labels|Priorities/ },
  { name: 'admin-asset-types', url: '/admin/asset-types', heading: /Asset/ },
  { name: 'admin-custom-fields', url: '/admin/custom-fields', heading: /Custom Fields/ },
  { name: 'admin-audit', url: '/admin/audit', heading: /Audit/ },
  { name: 'create-task', url: '/tasks/new', heading: /Create task|New task/i },
];

test.describe('Phone navigation (below 640 px)', () => {
  test.use({ viewport: PHONE });

  test('the rail is gone, the Menu button is the first control after the skip link and the content is the full width', async ({
    page,
  }) => {
    await page.goto('/my-work');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();

    // Tab order: the skip links ("Skip to task list" on a work page, #181, then "Skip to main content"), then Menu.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to task list' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toBeFocused();

    // No reserved 56 px: main starts at the left edge and is the whole width, with a 16 px gutter inside.
    const main = (await page.locator('#mf-main').boundingBox())!;
    expect(main.x).toBe(0);
    expect(main.width).toBe(375);
    const pad = await page
      .locator('#mf-main')
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(pad).toBe(16);
    expect(await noHorizontalScroll(page)).toBe(true);
    await shot(page, 'my-work-375-closed');
  });

  test('the header keeps Create task, search and the user menu without a truncated field', async ({
    page,
  }) => {
    await page.goto('/my-work');
    await expect(page.getByRole('button', { name: 'Create task' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
    await expect(page.getByTestId('user-menu')).toBeVisible();
    await expect(page.getByRole('combobox', { name: /Search clients/ })).toBeHidden();
    // Everything fits in one row inside the screen.
    for (const loc of [
      page.getByRole('button', { name: 'Menu', exact: true }),
      page.getByRole('button', { name: 'Create task' }),
      page.getByRole('button', { name: 'Search', exact: true }),
      page.getByTestId('user-menu'),
    ]) {
      const b = (await loc.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(375);
      expect(b.y + b.height).toBeLessThanOrEqual(64);
    }
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const box = page.getByRole('combobox', { name: /Search clients/ });
    await expect(box).toBeVisible();
    await expect(box).toBeFocused();
    expect((await box.boundingBox())!.width).toBeGreaterThanOrEqual(300);
    await shot(page, 'my-work-375-search');
    await box.fill('zz');
    await page.keyboard.press('Escape'); // closes the results first
    await page.keyboard.press('Escape'); // then the row
    await expect(box).toBeHidden();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  });

  test('opens as a panel with focus inside, traps Tab, closes with Esc and returns focus to Menu', async ({
    page,
  }) => {
    await page.goto('/tasks');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    // The current item is highlighted and has focus; the labels are visible text.
    const current = nav.getByRole('link', { name: 'Task Queue' });
    await expect(current).toHaveClass(/mf-active/);
    await expect(current).toBeFocused();
    await expect(nav.getByRole('link', { name: 'My Work' })).toBeVisible();
    await expect(nav.getByText('My Work')).toBeVisible();
    await shot(page, 'task-queue-375-menu-open');

    // Focus stays inside the panel in both directions.
    const links = await nav.getByRole('link').count();
    for (let i = 0; i < links + 3; i++) {
      await page.keyboard.press('Tab');
      expect(await nav.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await nav.evaluate((el) => el.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  test('choosing an item navigates and closes the panel; an outside tap closes it too', async ({
    page,
  }) => {
    await page.goto('/my-work');
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Clients' }).click();
    await expect(page).toHaveURL(/\/clients/);
    await expect(nav).toBeHidden();

    await menu.click();
    await expect(nav).toBeVisible();
    await page.mouse.click(360, 400); // on the backdrop, right of the panel
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();

    // The Administration group is in the panel, with its heading, and keeps its permissions rule.
    await menu.click();
    await expect(page.getByRole('list', { name: 'Administration' }).getByRole('link')).toHaveCount(
      7,
    );
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test('every main screen at 375: no horizontal scroll and no axe violations, with the panel closed and open', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(240_000);
    const screens = [...SCREENS, { name: 'task-detail', url: `/tasks/${taskId}`, heading: /./ }];
    for (const s of screens) {
      await page.goto(s.url);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await noHorizontalScroll(page), `${s.name} scrolls horizontally`).toBe(true);
      expect(await axeViolations(page), `${s.name} axe`).toEqual([]);
      await shot(page, `${s.name}-375`);
    }
    await page.goto('/matters');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('Dashboard Trends chart at 375 (#121)', () => {
  test.use({ viewport: PHONE });

  test('the chart is at least 343 px wide now that the rail is a Menu button', async ({ page }) => {
    await page.goto('/dashboard?tab=trends');
    const flows = page.locator('[data-panel="flows"] svg');
    await expect(flows).toBeVisible();
    await page.waitForLoadState('networkidle');
    const box = (await flows.boundingBox())!;
    console.log(`TRENDS_CHART_375 ${box.width}x${box.height} at x=${box.x}`);
    expect(box.width).toBeGreaterThanOrEqual(343);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (OUT_WP_RAIL) {
      fs.mkdirSync(OUT_WP_RAIL, { recursive: true });
      await page.screenshot({ path: path.join(OUT_WP_RAIL, 'trends-375.png') });
    }
  });
});

test.describe('Tablet (768 px): the rail is unchanged', () => {
  test.use({ viewport: TABLET });

  test('56 px icon rail, no Menu button, every main screen is clean', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(240_000);
    await page.goto('/my-work');
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    expect((await nav.boundingBox())!.width).toBe(56);
    await expect(page.getByRole('combobox', { name: /Search clients/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeHidden();

    const screens = [...SCREENS, { name: 'task-detail', url: `/tasks/${taskId}`, heading: /./ }];
    for (const s of screens) {
      await page.goto(s.url);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await noHorizontalScroll(page), `${s.name} scrolls horizontally`).toBe(true);
      expect(await axeViolations(page), `${s.name} axe`).toEqual([]);
      await shot(page, `${s.name}-768`);
    }
  });
});

test.describe('Phone to desktop: growing the window dissolves the panel', () => {
  test('an open panel closes when the window grows to 640 px', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/my-work');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    await expect(page.locator('[data-testid=nav-backdrop]')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });
});
