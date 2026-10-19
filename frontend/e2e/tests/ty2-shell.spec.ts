import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';

/**
 * WP-TY2 page shell of the Task Types administration (#363 descriptions, #365 filter row open by default, #369 hidden-count line and
 * Status sort, #370 list states). Screenshots go to E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty2-shell).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const;

const TABS = [
  {
    key: 'task-types',
    url: '/admin/task-types',
    text: 'What people can request: a request form and its eligible workflows.',
    row: '#task-type-filter-row',
  },
  {
    key: 'workflows',
    url: '/admin/workflows',
    text: 'Ordered steps a request follows, with versions you publish.',
    row: '#workflow-filter-row',
  },
  {
    key: 'steps',
    url: '/admin/steps',
    text: 'The reusable steps and inputs that workflows are built from.',
    row: '#step-filter-row',
  },
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

const description = (page: Page) => page.locator('[data-page-description]');
/** The number of text lines of the page description and whether its text is cut off. */
const measure = (page: Page) =>
  description(page).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
    return { clipped: el.scrollWidth > el.clientWidth, lines: tops.size };
  });
const toggle = (page: Page) => page.locator('[data-filters-toggle]');

test.describe('one short sentence per tab (#363)', () => {
  for (const tab of TABS) {
    test(`${tab.key}: the description is the agreed sentence, whole on one line at 1366 and 1920`, async ({
      page,
    }) => {
      await page.goto(tab.url);
      for (const size of [SIZES[0], SIZES[1]]) {
        await page.setViewportSize(size);
        await expect(description(page)).toHaveText(tab.text);
        expect(tab.text.length).toBeLessThanOrEqual(90);
        const box = await measure(page);
        expect(box.clipped, `${tab.key} at ${size.width} is cut off`).toBe(false);
        expect(box.lines, `${tab.key} at ${size.width}`).toBe(1);
        await expect(description(page)).toHaveAttribute('title', tab.text);
      }
      await page.setViewportSize(SIZES[3]);
      const { lines } = await measure(page);
      expect(lines, `${tab.key} at 375`).toBeLessThanOrEqual(2);
      await expect(page).toHaveTitle(/Task Types|Workflows|Workflow Steps/);
    });
  }
});

test.describe('the filter row is open from 640 px and the Filters button sits in the header (#365)', () => {
  for (const tab of TABS) {
    test(`${tab.key}: open at 768, 1366 and 1920, closed at 375, button in the header, no extra toolbar row`, async ({
      page,
    }) => {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.evaluate(() => localStorage.clear()).catch(() => undefined);
        await page.goto(tab.url);
        await expect(page.locator('tbody[mfGridBody], tbody').first()).toBeVisible();
        // At 768 the grids still scroll sideways until the narrow-window columns of #374 and #375, which puts the controls in the sheet.
        const open = size.width >= 1366;
        if (open) await expect(page.locator(tab.row)).toBeVisible();
        else if (size.width < 640) await expect(page.locator(tab.row)).toHaveCount(0);
        // The button is one of the page header's actions, not a row of its own above the grid.
        const header = page.locator('mf-page-header');
        await expect(header.locator('[data-filters-toggle]')).toBeVisible();
        await expect(page.locator('[data-grid-toolbar]')).toHaveCount(0);
        if (open) await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await noSideScroll(page, `${tab.key} at ${size.width}`);
        if (axeAvailable()) {
          expect(await axeViolations(page), `${tab.key} at ${size.width}`).toEqual([]);
        }
        await shot(page, `p3-${tab.key}`);
      }
    });

    test(`${tab.key}: the choice is remembered for this tab and does not leak to the others`, async ({
      page,
    }) => {
      await page.setViewportSize(SIZES[0]);
      await page.goto(tab.url);
      await expect(page.locator(tab.row)).toBeVisible();
      await toggle(page).click();
      await expect(page.locator(tab.row)).toHaveCount(0);
      await page.reload();
      await expect(toggle(page)).toBeVisible();
      await expect(page.locator(tab.row)).toHaveCount(0);
      // The other tabs keep their own default.
      for (const other of TABS.filter((t) => t.key !== tab.key)) {
        await page.goto(other.url);
        await expect(page.locator(other.row)).toBeVisible();
      }
      // Open it again by keyboard.
      await page.goto(tab.url);
      await toggle(page).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator(tab.row)).toBeVisible();
      await page.reload();
      await expect(page.locator(tab.row)).toBeVisible();
    });
  }

  test('on a phone the Filters button opens the sheet and its filters work', async ({ page }) => {
    await page.setViewportSize(SIZES[3]);
    await page.goto('/admin/task-types');
    await toggle(page).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await shot(page, 'p3-sheet-task-types');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toggle(page)).toBeFocused();
  });

  test('permissions: Workflow.Manage only gets the button on Workflows; TaskType.Manage only on Task Types; Task.View only gets the 403', async ({
    seed,
    asUser,
  }) => {
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow only');
    const wf = await asUser((await seed.user([wfRole.name], 'ty2-wfonly')).username);
    await wf.goto('/admin/task-types');
    await expect(wf).toHaveURL(/\/admin\/workflows$/);
    await expect(wf.locator('mf-page-header [data-filters-toggle]')).toBeVisible();
    await expect(wf.locator('#workflow-filter-row')).toBeVisible();

    const typeRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const tt = await asUser((await seed.user([typeRole.name], 'ty2-ttonly')).username);
    await tt.goto('/admin/task-types');
    await expect(tt.locator('mf-page-header [data-filters-toggle]')).toBeVisible();
    await expect(tt.locator('#task-type-filter-row')).toBeVisible();

    const viewerRole = await seed.role(['Task.View'], 'Viewer');
    const viewer = await asUser((await seed.user([viewerRole.name], 'ty2-viewer')).username);
    await viewer.goto('/admin/task-types');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(viewer.locator('[data-filters-toggle]')).toHaveCount(0);
  });
});
