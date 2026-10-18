import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP11 Tab strip and pager (#279, #280). `mf-tabs` shows a scroll cue (edge fade and chevron) on the side that has more tabs, brings the
 * selected tab into view and snaps; `mf-pager` is one row or two intentional rows between 640 and 900 px, never a lone button.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp11).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const noPageScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe.configure({ timeout: 180_000 });

let matterId: number;
let clientId: number;

test.beforeAll(async ({ seed }) => {
  test.setTimeout(300_000);
  const world = await seed.world();
  matterId = world.matter.matterId;
  clientId = world.client.clientId;
  const tag = uid();
  await seed.project(world.matter, `Strip ${tag}`);
  for (let batch = 0; batch < 3; batch++) {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        seed.task(world, { title: `Strip ${tag} ${batch * 10 + i + 1}` }),
      ),
    );
  }
});

const strip = (page: Page) => page.locator('mf-tabs .tabs');
const cue = (page: Page, side: 'start' | 'end') => page.locator(`mf-tabs [data-tab-cue="${side}"]`);
const lastTab = (page: Page) => page.locator('mf-tabs [role="tab"]').last();

/** The tab is whole inside the strip (the cue patches take the outer 28 px of a side that has one). */
async function wholeInStrip(page: Page, tab: Locator): Promise<boolean> {
  const t = await tab.boundingBox();
  const s = await strip(page).boundingBox();
  // While the page swaps its skeleton for the loaded tab strip the element is gone for a moment: not yet whole, the poll asks again.
  if (!t || !s) return false;
  const start = await cue(page, 'start').count();
  const end = await cue(page, 'end').count();
  return t.x >= s.x + (start ? 27 : -1) && t.x + t.width <= s.x + s.width - (end ? 27 : -1);
}

test.describe('Tab strip scroll cue (#279)', () => {
  test('375: a cue on the right, the end shows a cue on the left and the last tab whole, arrows keep working', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/matters/${matterId}`);
    await expect(page.getByRole('tab').first()).toBeVisible();
    await expect(cue(page, 'end')).toBeVisible();
    await expect(cue(page, 'start')).toHaveCount(0);
    for (const side of ['end'] as const) {
      const box = (await cue(page, side).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    expect(await noPageScroll(page)).toBe(true);
    await shot(page, 'matter-tabs-cue-end-375x812');

    // The chevrons are not Tab stops and not exposed; the selected tab is the only stop.
    await expect(cue(page, 'end')).toHaveAttribute('tabindex', '-1');
    await expect(cue(page, 'end')).toHaveAttribute('aria-hidden', 'true');

    // Arrow keys: End selects the last tab and scrolls it whole into view.
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('End');
    await expect(lastTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(cue(page, 'start')).toBeVisible();
    await expect(cue(page, 'end')).toHaveCount(0);
    await expect.poll(() => wholeInStrip(page, lastTab(page))).toBe(true);
    expect(await noPageScroll(page)).toBe(true);
    await shot(page, 'matter-tabs-cue-start-375x812');

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(lastTab(page)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect(cue(page, 'start')).toHaveCount(0);
    await expect(cue(page, 'end')).toBeVisible();
  });

  test('a deep link to the last tab opens with that tab whole in view', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/matters/${matterId}?tab=assets`);
      await expect(lastTab(page)).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => wholeInStrip(page, lastTab(page)), `at ${width}`).toBe(true);
      await expect(cue(page, 'start')).toBeVisible();
      expect(await noPageScroll(page), `no page scroll at ${width}`).toBe(true);
    }
  });

  test('the chevron scrolls the strip towards its side, and a click selects and reveals', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/matters/${matterId}`);
    await expect(cue(page, 'end')).toBeVisible();
    await cue(page, 'end').click();
    await expect.poll(() => strip(page).evaluate((el) => el.scrollLeft)).toBeGreaterThan(20);
    await expect(cue(page, 'start')).toBeVisible();
    await cue(page, 'start').click();
    await expect.poll(() => strip(page).evaluate((el) => el.scrollLeft)).toBe(0);
    await expect(cue(page, 'start')).toHaveCount(0);
    // Click the last tab: it is selected and whole.
    await cue(page, 'end').click();
    await expect.poll(() => cue(page, 'end').count()).toBe(0);
    await lastTab(page).click();
    await expect(lastTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => wholeInStrip(page, lastTab(page))).toBe(true);
  });

  test('with reduced motion the scroll is instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/matters/${matterId}`);
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('End');
    await expect(lastTab(page)).toHaveAttribute('aria-selected', 'true');
    const at = await strip(page).evaluate((el) => ({
      left: el.scrollLeft,
      max: el.scrollWidth - el.clientWidth,
    }));
    expect(at.left).toBe(at.max);
  });

  test('wide screens show no cue; counts in the labels do not break it', async ({ page }) => {
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${matterId}`);
      await expect(page.getByRole('tab', { name: /^Tasks/ })).toBeVisible();
      await expect(page.locator('mf-tabs [data-tab-cue]')).toHaveCount(0);
      await shot(page, `matter-tabs-no-cue-${w}x${h}`);
    }
  });

  test('client details: the strip behaves the same', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/clients/${clientId}`);
    await expect(page.getByRole('tab').first()).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    expect(await page.getByRole('tab').count()).toBeGreaterThan(1);
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('End');
    await expect(lastTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => wholeInStrip(page, lastTab(page))).toBe(true);
  });

  test('other tab strips still work (My Work, Task Queue, admin)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-work');
    await expect(page.getByRole('tablist').first()).toBeVisible();
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
    expect(await noPageScroll(page)).toBe(true);
    await page.goto('/admin/users');
    await expect(page.getByRole('tablist').first()).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
  });

  test('axe at four sizes', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${matterId}`);
      await expect(page.getByRole('tab').first()).toBeVisible();
      expect(await axeViolations(page), `matter at ${w}`).toEqual([]);
      expect(await noPageScroll(page)).toBe(true);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/matters/${matterId}?tab=assets`);
    await expect(cue(page, 'start')).toBeVisible();
    expect(await axeViolations(page), 'matter, scrolled, 375').toEqual([]);
  });
});

/** The rows the pager's parts sit in (by top edge) and, for each row, the parts in it. */
async function pagerRows(page: Page): Promise<string[][]> {
  return page.locator('mf-pager nav').evaluate((nav) => {
    const parts = Array.from(
      nav.querySelectorAll<HTMLElement>(
        '.mf-pager__size, [data-range], [data-page], .mf-pager__nav button',
      ),
    )
      .filter((el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed')
      .map((el) => ({
        name:
          el.tagName === 'BUTTON'
            ? `button:${el.textContent!.trim()}`
            : el.dataset['range'] !== undefined
              ? 'range'
              : el.dataset['page'] !== undefined
                ? 'page'
                : 'size',
        top: Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2),
        h: 20,
      }));
    const rows: { top: number; names: string[] }[] = [];
    for (const p of parts.sort((a, b) => a.top - b.top)) {
      const row = rows.find((r) => Math.abs(r.top - p.top) < p.h);
      if (row) row.names.push(p.name);
      else rows.push({ top: p.top, names: [p.name] });
    }
    return rows.map((r) => r.names);
  });
}

function expectIntentional(rows: string[][], width: number, label: string): void {
  expect(rows.length, `${label}: at most two rows at ${width}`).toBeLessThanOrEqual(2);
  for (const row of rows) {
    const lone = row.length === 1 && row[0].startsWith('button:');
    expect(lone, `${label}: no lone button at ${width}: ${JSON.stringify(rows)}`).toBe(false);
  }
  if (width >= 640 && rows.length === 2) {
    // Two rows: the facts above, the controls (page and buttons) below.
    expect(
      rows[1].some((n) => n.startsWith('button:')),
      `${label}: buttons in row 2`,
    ).toBe(true);
    expect(
      rows[0].every((n) => !n.startsWith('button:')),
      `${label}: no buttons in row 1 at ${width}: ${JSON.stringify(rows)}`,
    ).toBe(true);
  }
}

test.describe('Pager between 640 and 900 px (#280)', () => {
  test('Task Queue: at most two rows and never a lone button, 640 to 1200', async ({ page }) => {
    const queue = new TaskQueuePage(page);
    for (const width of [640, 700, 768, 899, 900, 1024, 1366]) {
      await page.setViewportSize({ width, height: 1024 });
      await queue.open(`?matter=${matterId}&pageSize=25&page=2`);
      await expect(page.locator('mf-pager [data-page]')).toHaveText('Page 2 of 2');
      const rows = await pagerRows(page);
      expectIntentional(rows, width, 'Task Queue');
      if (width >= 1366) expect(rows.length, 'one row on a wide screen').toBe(1);
      expect(await noPageScroll(page)).toBe(true);
      if (width === 768) await shot(page, 'task-queue-pager-768x1024');
    }
  });

  test('below 640 the phone pager is unchanged: one row, Previous, Page, Next', async ({
    page,
  }) => {
    const queue = new TaskQueuePage(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await queue.open(`?matter=${matterId}&pageSize=25&page=2`);
    const rows = await pagerRows(page);
    expect(rows).toHaveLength(1);
    expect(rows[0].sort()).toEqual(['button:Next', 'button:Previous', 'page']);
    await shot(page, 'task-queue-pager-375x812');
  });

  test('the footer follows the real pager height: the grid is never covered', async ({ page }) => {
    const queue = new TaskQueuePage(page);
    for (const width of [768, 899]) {
      await page.setViewportSize({ width, height: 1024 });
      await queue.open(`?matter=${matterId}&pageSize=25&page=1`);
      await expect(page.locator('mf-pager [data-page]')).toBeVisible();
      const pager = (await page.locator('mf-pager').boundingBox())!;
      const area = (await page.locator('.mf-scroll-area').first().boundingBox())!;
      expect(area.y + area.height, `grid ends above the pager at ${width}`).toBeLessThanOrEqual(
        pager.y + 1,
      );
      const footer = await page.evaluate(() =>
        Number.parseFloat(document.documentElement.style.getPropertyValue('--mf-page-footer-h')),
      );
      expect(Math.abs(footer - pager.height), `footer offset follows at ${width}`).toBeLessThan(
        pager.height * 0.5 + 4,
      );
    }
  });

  for (const [name, url] of [
    ['Clients', '/clients'],
    ['Matters', '/matters'],
    ['Projects', '/projects'],
  ] as const) {
    test(`${name} list at 768: at most two rows, no lone button`, async ({ page }) => {
      for (const width of [640, 700, 768, 899]) {
        await page.setViewportSize({ width, height: 1024 });
        await page.goto(url);
        await expect(page.locator('mf-pager [data-page]')).toBeVisible();
        expectIntentional(await pagerRows(page), width, name);
      }
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(url);
      await expect(page.locator('mf-pager [data-page]')).toBeVisible();
      await shot(page, `${name.toLowerCase()}-pager-768x1024`);
    });
  }

  test('axe at four sizes', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    const queue = new TaskQueuePage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await queue.open(`?matter=${matterId}&pageSize=25&page=2`);
      await expect(page.locator('mf-pager [data-page]')).toBeVisible();
      expect(await axeViolations(page), `pager at ${w}`).toEqual([]);
      expect(await noPageScroll(page)).toBe(true);
      await shot(page, `task-queue-pager-${w}x${h}`);
    }
  });
});
