import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { BoardSeed, seedBoard } from '../support/board';
import { expect, test } from '../support/fixtures';

/**
 * Dashboard > Swimlane: the big-screen verification of #126 (W5) with the width cap of #93 (P5). Boxes are measured, not eyeballed. The lane
 * switcher and phone tab-row tests of WP9b were deleted with the phone layout (D-82, #1268). With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp9b.
 */
let board: BoardSeed;
let base: string;

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  board = await seedBoard(admin, seed, { tasks: 150, clients: 3, matters: 2, users: 4 });
  base = `/dashboard?tab=swimlane&q=${board.tag}`;
});

const OUT = process.env['E2E_SCREENSHOTS'];
const shot = async (page: Page, name: string) => {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
};

const lane = (page: Page, code: string): Locator => page.locator(`[data-lane="${code}"]`);
const CODES = ['NEW', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'] as const;

async function openBoard(
  page: Page,
  size: { width: number; height: number },
  query = '',
): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`${base}${query}`);
  await expect(page.locator('[data-board] mf-swimlane-card').first()).toBeVisible();
  await expect(page.locator('[data-board][aria-busy="true"]')).toHaveCount(0);
}

test.describe('Big screens (#126 W5, #93 P5)', () => {
  /** Cards of a lane whose whole box is inside the lane's scrolling area. */
  const visibleCards = (page: Page, code: string) =>
    lane(page, code)
      .locator('[data-lane-body]')
      .evaluate((body) => {
        const area = body.getBoundingClientRect();
        return Array.from(body.querySelectorAll('mf-swimlane-card')).filter((c) => {
          const r = c.getBoundingClientRect();
          return r.top >= area.top - 1 && r.bottom <= area.bottom + 1;
        }).length;
      });

  async function density(page: Page, name: 'Compact' | 'Comfortable'): Promise<void> {
    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('menuitemradio', { name }).click();
    await expect(page.locator('[data-board]')).toHaveAttribute('data-density', name.toLowerCase());
  }

  test('1920x1080: the board spans the content width and the window height; a lane shows 14 compact (and 4 whole comfortable) cards', async ({
    page,
  }) => {
    await openBoard(page, { width: 1920, height: 1080 });
    const head = (await page.locator('[data-dash-head]').boundingBox())!;
    const b = (await page.locator('[data-board]').boundingBox())!;
    // Same left edge as the header row; the right edge reaches the right gutter (the page gutter is 24 px).
    expect(Math.abs(b.x - head.x)).toBeLessThanOrEqual(1);
    expect(b.x + b.width).toBeGreaterThanOrEqual(1920 - 40);
    expect(b.width).toBeGreaterThan(1600);
    // Height: the board ends at the bottom of the window (minus the page padding).
    expect(b.y + b.height).toBeGreaterThanOrEqual(1080 - 40);
    expect(b.y + b.height).toBeLessThanOrEqual(1080);
    // Four lanes that share the width; none is cut off.
    const widths = await Promise.all(
      CODES.map(async (c) => (await lane(page, c).boundingBox())!.width),
    );
    for (const w of widths) expect(w).toBeGreaterThan(400);
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1),
    ).toBe(true);
    await density(page, 'Comfortable');
    const comfortable = await Promise.all(CODES.map((c) => visibleCards(page, c)));
    await shot(page, 'board-1920-comfortable');
    await density(page, 'Compact');
    const compact = await Promise.all(CODES.map((c) => visibleCards(page, c)));
    await shot(page, 'board-1920-compact');
    test.info().annotations.push({
      type: 'measure',
      description: `1920x1080 board ${JSON.stringify(b)} comfortable ${comfortable} compact ${compact}`,
    });
    // Lanes with fewer cards than the target are limited by the data, not the layout.
    for (const [i, code] of CODES.entries()) {
      const total = await lane(page, code).locator('mf-swimlane-card').count();
      expect(compact[i], `compact ${code}`).toBeGreaterThanOrEqual(Math.min(14, total));
      // Known gap (#126): a comfortable card is 162 px high, so only a few whole cards fit (the last is cut); the target of 6 is reported on #87.
      // The page-header contract (#603) puts the tab strip under the 22 px title as on My Work, which takes one more card's worth of height
      // from the board at this size: 5 whole cards became 4. Compact still shows 14.
      expect(comfortable[i], `comfortable ${code}`).toBeGreaterThanOrEqual(Math.min(4, total));
    }
    await density(page, 'Comfortable');
  });

  test('1920: Summary, Swimlane, Users, Trends and Coverage use the whole width, Breakdowns keeps 1360 px; the left edge never moves', async ({
    page,
  }) => {
    const tabs = [
      // The v4 Summary (grid and right column) uses the whole width from 1600 px like the board tabs.
      { name: 'summary', url: '/dashboard', capped: false },
      { name: 'breakdowns', url: '/dashboard?tab=breakdowns', capped: true },
      { name: 'trends', url: '/dashboard?tab=trends', capped: false },
      { name: 'swimlane', url: `${base}`, capped: false },
      { name: 'users', url: '/dashboard?tab=users', capped: false },
      { name: 'coverage', url: '/dashboard?tab=users&view=coverage', capped: false },
    ];
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      const lefts: number[] = [];
      for (const t of tabs) {
        await page.goto(t.url);
        await expect(page.locator('mf-dash-tabs')).toBeVisible();
        await expect(page.locator('[data-dash-state="error"]')).toHaveCount(0);
        await page.waitForTimeout(500);
        const box = (await page.locator('mf-fixed-page.dash').boundingBox())!;
        lefts.push(box.x);
        if (t.capped || width < 1600)
          expect(box.width, `${t.name} ${width}`).toBeLessThanOrEqual(1360);
        else {
          // The container reaches the right gutter.
          expect(box.x + box.width, `${t.name} ${width}`).toBeGreaterThanOrEqual(width - 40);
        }
        await shot(page, `${t.name}-${width}`);
      }
      expect(Math.max(...lefts) - Math.min(...lefts), `left edge ${width}`).toBeLessThanOrEqual(1);
    }
  });

  test('switching from Summary (capped) to Users and Swimlane (uncapped) at 1920 shifts nothing sideways (layout shift 0.02 or less)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[])
          if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/dashboard');
    await expect(page.locator('mf-dash-grid [data-task]').first()).toBeVisible();
    await page.waitForTimeout(800);
    const cls = () => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    const reset = () => page.evaluate(() => ((window as unknown as { __cls: number }).__cls = 0));
    const tabList = page.getByRole('tablist', { name: 'Dashboard views' });
    const results: Record<string, number> = {};
    for (const [name, ready] of [
      ['Users', '[data-users-grid] li'],
      ['Summary', 'mf-dash-grid [data-task]'],
      ['Swimlane', '[data-board] mf-swimlane-card'],
      ['Summary', 'mf-dash-grid [data-task]'],
    ] as const) {
      await reset();
      const before = (await page.locator('mf-fixed-page.dash').boundingBox())!.x;
      await tabList.getByRole('tab', { name }).click();
      await expect(page.locator(ready).first()).toBeVisible();
      await page.waitForTimeout(800);
      const after = (await page.locator('mf-fixed-page.dash').boundingBox())!.x;
      expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
      results[`${Object.keys(results).length + 1} ${name}`] = await cls();
      expect(await cls(), `layout shift after ${name}`).toBeLessThanOrEqual(0.02);
    }
    test.info().annotations.push({ type: 'measure', description: JSON.stringify(results) });
  });

  test('axe is clean on the 1920 board', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    await openBoard(page, { width: 1920, height: 1080 });
    expect(await axeViolations(page), 'board 1920').toEqual([]);
  });
});
