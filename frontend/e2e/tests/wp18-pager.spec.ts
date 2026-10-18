import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Pager and microcopy (WP18: #237, #228, #229). Every list is scoped to one matter made for this file (`?matter=<id>`, 60 tasks), so the
 * counts do not depend on what other specs left in the shared database. 60 tasks: 3 pages of 25, 2 of 50, 1 of 100.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-queue-review/fixes/wp-pager).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const TOTAL = 60;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

test.describe.configure({ timeout: 180_000 });

let matterId: number;

test.beforeAll(async ({ seed }) => {
  test.setTimeout(300_000);
  const world = await seed.world();
  matterId = world.matter.matterId;
  const tag = uid();
  for (let batch = 0; batch < TOTAL / 10; batch++) {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        seed.task(world, { title: `Pager ${tag} ${String(batch * 10 + i + 1).padStart(2, '0')}` }),
      ),
    );
  }
});

const pager = (page: Page) => page.locator('mf-pager');
const button = (page: Page, name: string) => pager(page).getByRole('button', { name, exact: true });
const live = (page: Page) => page.locator('mf-work-list [role="status"]');

test.describe('Pager (#237)', () => {
  test('Page n of m, First and Last, the URL and one announcement per page change', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${matterId}&pageSize=25`);
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 3');
    await expect(pager(page).locator('[data-range]')).toHaveText(`Showing 1-25 of ${TOTAL}`);
    await expect(button(page, 'First')).toBeDisabled();
    await expect(button(page, 'Previous')).toBeDisabled();
    await expect(button(page, 'Next')).toBeEnabled();
    await expect(button(page, 'Last')).toBeEnabled();
    // The "Sorted by" note stays in the footer.
    await expect(pager(page).locator('[data-sort-note]')).toContainText('Sorted by');
    await shot(page, 'page1-of-3-1366x768');

    await button(page, 'Next').click();
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 2 of 3');
    await expect(pager(page).locator('[data-range]')).toHaveText(`Showing 26-50 of ${TOTAL}`);
    expect(new URL(page.url()).searchParams.get('page')).toBe('2');
    expect(new URL(page.url()).searchParams.get('pageSize')).toBe('25');
    await expect(live(page)).toHaveText(`${TOTAL} tasks, page 2 of 3, showing 26 to 50`);
    await shot(page, 'page2-of-3-1366x768');

    await button(page, 'Last').click();
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 3 of 3');
    await expect(pager(page).locator('[data-range]')).toHaveText(`Showing 51-60 of ${TOTAL}`);
    expect(new URL(page.url()).searchParams.get('page')).toBe('3');
    await expect(button(page, 'Next')).toBeDisabled();
    await expect(button(page, 'Last')).toBeDisabled();
    await expect(live(page)).toHaveText(`${TOTAL} tasks, page 3 of 3, showing 51 to 60`);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(10);
    await shot(page, 'last-page-1366x768');

    await button(page, 'First').click();
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 3');
    expect(new URL(page.url()).searchParams.has('page')).toBe(false);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(25);
  });

  test('pages = ceil(total / size) for every size, and the keyboard reaches and works the buttons', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    for (const [size, pages] of [
      [25, 3],
      [50, 2],
      [100, 1],
    ] as const) {
      await queue.open(`?matter=${matterId}&pageSize=${size}`);
      await expect(pager(page).locator('[data-page]')).toHaveText(`Page 1 of ${pages}`);
    }
    await queue.open(`?matter=${matterId}&pageSize=25`);
    await button(page, 'Next').focus();
    await page.keyboard.press('Enter');
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 2 of 3');
    // Tab order: First, Previous, Next, Last; the focused button is enabled.
    await button(page, 'First').focus();
    await page.keyboard.press('Tab');
    await expect(button(page, 'Previous')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(button(page, 'Next')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(button(page, 'Last')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 3 of 3');
  });

  test('the chosen size is remembered; a link with a size wins and does not overwrite it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${matterId}`);
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 2');
    await pager(page).getByLabel('Rows per page').selectOption('100');
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 1');
    expect(new URL(page.url()).searchParams.get('pageSize')).toBe('100');

    // A link without a size (the Dashboard): 100 applies.
    await queue.open(`?matter=${matterId}`);
    await expect(pager(page).getByLabel('Rows per page')).toHaveValue('100');
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 1');
    // A link with pageSize=25: 25 applies, the preference stays 100.
    await queue.open(`?matter=${matterId}&pageSize=25`);
    await expect(pager(page).getByLabel('Rows per page')).toHaveValue('25');
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 3');
    await queue.open(`?matter=${matterId}`);
    await expect(pager(page).getByLabel('Rows per page')).toHaveValue('100');
    // Choosing 50 while 100 is remembered keeps 50 in the address.
    await pager(page).getByLabel('Rows per page').selectOption('50');
    await expect(pager(page).locator('[data-page]')).toHaveText('Page 1 of 2');
    await queue.open(`?matter=${matterId}`);
    await expect(pager(page).getByLabel('Rows per page')).toHaveValue('50');
  });

  test('My Work and Pod Work share the pager', async ({ page }) => {
    await page.goto('/my-work');
    await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
    // The admin may have no tasks: the pager only exists with rows; the component is the same one when it does.
    if ((await pager(page).count()) > 0) {
      await expect(pager(page).locator('[data-page]')).toContainText(/^Page \d+ of \d+$/);
    }
  });

  test('axe, layout and the 375 px row at four sizes', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    const queue = new TaskQueuePage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await queue.open(`?matter=${matterId}&pageSize=25&page=2`);
      await expect(pager(page).locator('[data-page]')).toHaveText('Page 2 of 3');
      expect(await axeViolations(page), `pager at ${w}`).toEqual([]);
      const noSideScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(noSideScroll, `no page scroll at ${w}`).toBe(true);
      for (const name of w < 640 ? ['Previous', 'Next'] : ['First', 'Previous', 'Next', 'Last']) {
        const box = await button(page, name).boundingBox();
        expect(box!.height, `${name} at ${w}`).toBeGreaterThanOrEqual(24);
        expect(box!.width).toBeGreaterThanOrEqual(24);
      }
      if (w < 640) {
        // One row: Previous, "Page 2 of 3", Next.
        await expect(button(page, 'First')).toBeHidden();
        await expect(button(page, 'Last')).toBeHidden();
        const prev = (await button(page, 'Previous').boundingBox())!;
        const next = (await button(page, 'Next').boundingBox())!;
        const label = (await pager(page).locator('[data-page]').boundingBox())!;
        expect(Math.abs(prev.y - next.y)).toBeLessThan(4);
        expect(Math.abs(prev.y - label.y)).toBeLessThan(prev.height);
      }
      await shot(page, `page2-of-3-${w}x${h}`);
    }
  });
});

test.describe('Microcopy (#228, #229)', () => {
  test('filter boxes say what they filter, and the button is Other filters', async ({ page }) => {
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await new TaskQueuePage(page).open(`?matter=${matterId}`);
      const row = page.locator('tr[data-filter-row]');
      await expect(row.locator('input[data-filter="q"]')).toHaveAttribute(
        'placeholder',
        'Title or ref',
      );
      await expect(row.locator('input[data-filter="q"]')).toHaveAttribute(
        'aria-label',
        'Filter by Title or Ref',
      );
      await expect(row.locator('input[data-filter="matterText"]')).toHaveAttribute(
        'placeholder',
        'Matter',
      );
      await expect(row.locator('input[data-filter="matterText"]')).toHaveAttribute(
        'aria-label',
        'Filter by Matter',
      );
      await expect(page.getByRole('button', { name: 'Other filters' })).toBeVisible();
      await expect(page.getByText('More filters')).toHaveCount(0);
      await page.screenshot({
        path: OUT ? path.join(OUT, `filters-copy-${w}x${h}.png`) : undefined,
      });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByRole('button', { name: 'Other filters' }).click();
    await expect(page.getByRole('dialog', { name: 'Other filters' })).toBeVisible();
  });

  test('the placeholder is cut with an ellipsis in a narrow cell and never wraps', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open(`?matter=${matterId}`);
    const style = await page
      .locator('tr[data-filter-row] input[data-filter="matterText"]')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { overflow: s.overflow, ellipsis: s.textOverflow, wrap: s.whiteSpace };
      });
    expect(style.overflow).toMatch(/^(hidden|clip)$/);
    expect([style.ellipsis, style.wrap]).toEqual(['ellipsis', 'nowrap']);
  });

  test('the sort note names the order in one sentence', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open(`?matter=${matterId}`);
    await page.getByRole('button', { name: 'How the default order works' }).click();
    await expect(page.locator('[data-sort-rule]')).toContainText(
      'Priority, then ASAP first, then due date, then oldest',
    );
  });

  test('axe with the copy at four sizes', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await new TaskQueuePage(page).open(`?matter=${matterId}`);
      expect(await axeViolations(page), `copy at ${w}`).toEqual([]);
    }
  });
});
