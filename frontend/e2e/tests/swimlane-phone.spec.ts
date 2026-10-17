import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { BoardSeed, seedBoard } from '../support/board';
import { expect, test } from '../support/fixtures';

/**
 * Dashboard > Swimlane, work package WP9b: the lane switcher below 900 px (#125 W4), the tab row of the Dashboard on a phone (a clipped
 * "Summary" and "Breakdowns" at 375 px) and the big-screen verification of #126 (W5) with the width cap of #93 (P5). Boxes are measured, not
 * eyeballed. With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp9b.
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
const laneTab = (page: Page, code: string): Locator => page.locator(`[data-lane-tab="${code}"]`);
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

const shownLanes = (page: Page) =>
  page.locator('[data-lane]').evaluateAll((l) => l.map((e) => e.getAttribute('data-lane')));

test.describe('Lane switcher below 900 px (#125)', () => {
  test('375x812: a tablist of four lanes with counts, one lane at a time, natural height, no nested scroll box', async ({
    page,
  }) => {
    await openBoard(page, { width: 375, height: 812 });
    const list = page.getByRole('tablist', { name: 'Swimlane lanes' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('tab')).toHaveCount(4);
    // Name and count of each tab equal the lane's own count.
    for (const code of CODES) {
      await laneTab(page, code).click();
      await expect(lane(page, code)).toBeVisible();
      const count = (await lane(page, code).locator('a[data-lane-count]').textContent())?.trim();
      expect(
        (await laneTab(page, code).locator('[data-lane-tab-count]').textContent())?.trim(),
      ).toBe(count);
      expect(await shownLanes(page)).toEqual([code]);
      await shot(page, `lane-${code.toLowerCase()}-375`);
    }
    await laneTab(page, 'IN_PROGRESS').click();
    expect(await shownLanes(page)).toEqual(['IN_PROGRESS']);

    // Natural height: no element of the board scrolls on its own; the page does.
    const nested = await page.locator('[data-board]').evaluate((board) =>
      [board, ...Array.from(board.querySelectorAll<HTMLElement>('*'))]
        .filter((e) => {
          const s = getComputedStyle(e);
          return ['auto', 'scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
        })
        .map((e) => e.tagName + '.' + e.className),
    );
    expect(nested).toEqual([]);
    const laneBox = (await lane(page, 'IN_PROGRESS').boundingBox())!;
    const pageHeight = await page.evaluate(() => document.scrollingElement!.scrollHeight);
    expect(pageHeight).toBeLessThanOrEqual(1.5 * laneBox.height + 200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await shot(page, 'switcher-375');
  });

  test('a tap on On Hold changes the lane, the focus stays on the tab and the panel is labelled; the address and a reload keep it', async ({
    page,
  }) => {
    await openBoard(page, { width: 375, height: 812 });
    expect(page.url()).not.toContain('lane=');
    await laneTab(page, 'ON_HOLD').click();
    await expect(laneTab(page, 'ON_HOLD')).toHaveAttribute('aria-selected', 'true');
    await expect(laneTab(page, 'ON_HOLD')).toBeFocused();
    expect(page.url()).toContain('lane=hold');
    const panel = page.getByRole('tabpanel', { name: /On Hold/ });
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-lane="ON_HOLD"]')).toBeVisible();
    await page.reload();
    await expect(laneTab(page, 'ON_HOLD')).toHaveAttribute('aria-selected', 'true');
    // The default lane is not written to the address.
    await laneTab(page, 'IN_PROGRESS').click();
    await expect(laneTab(page, 'IN_PROGRESS')).toBeFocused();
    expect(page.url()).not.toContain('lane=');
    // The choice is remembered for the session when the address does not name a lane.
    await laneTab(page, 'NEW').click();
    await page.goto(base);
    await expect(laneTab(page, 'NEW')).toHaveAttribute('aria-selected', 'true');
  });

  test('keyboard: roving tabindex, arrows wrap, Home and End jump, the lane panel is a tab stop away', async ({
    page,
  }) => {
    await openBoard(page, { width: 375, height: 812 });
    const tabs = page.getByRole('tablist', { name: 'Swimlane lanes' }).getByRole('tab');
    await expect(tabs.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
    await tabs.nth(1).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(2)).toBeFocused();
    await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(tabs.nth(3)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(3)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toBeFocused();
    expect(await shownLanes(page)).toEqual(['NEW']);
    expect(page.url()).toContain('lane=new');
    // Tab leaves the tablist for the lane (one tab stop for the list).
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => document.activeElement?.closest('[role="tablist"]')),
    ).toBeNull();
  });

  test('the two tablists have distinct names and the switcher is sticky under the tab row while the page scrolls', async ({
    page,
  }) => {
    await openBoard(page, { width: 375, height: 812 });
    await expect(page.getByRole('tablist')).toHaveCount(2);
    await expect(page.getByRole('tablist', { name: 'Dashboard views' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Swimlane lanes' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 600));
    const top = (await page.locator('[data-lane-switcher]').boundingBox())!.y;
    expect(top).toBeGreaterThanOrEqual(-1);
    expect(top).toBeLessThan(60);
    await shot(page, 'switcher-sticky-375');
  });

  test('the bar is Search, Filters and "..." (Group and Sort sit in the Filters panel): two rows at 375, one row at 768', async ({
    page,
  }) => {
    await openBoard(page, { width: 375, height: 812 });
    const h375 = (await page.locator('mf-swimlane-toolbar .bar').boundingBox())!.height;
    await expect(page.locator('mf-swimlane-toolbar [data-group-by]')).toHaveCount(0);
    await shot(page, 'toolbar-375');
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.locator('[data-filter-panel] [data-group-by]')).toBeVisible();
    await expect(page.locator('[data-filter-panel] [data-sort]')).toBeVisible();
    await page.locator('[data-filter-panel] [data-group-by]').selectOption('assignee');
    await expect(page.locator('[data-filter-count]')).toHaveText('(1)');
    await expect(lane(page, 'IN_PROGRESS').locator('.grp-btn').first()).toBeVisible();
    await shot(page, 'toolbar-filters-375');
    await openBoard(page, { width: 768, height: 900 });
    const h768 = (await page.locator('mf-swimlane-toolbar .bar').boundingBox())!.height;
    // A row of controls is 28 to 36 px high: two rows with the gap are at most 90 px.
    expect(h375).toBeLessThanOrEqual(90);
    expect(h768).toBeLessThanOrEqual(44);
  });

  test('grouped by client and matter the single lane is a tree and the collapse state is shared by the lanes', async ({
    page,
  }) => {
    await openBoard(page, { width: 375, height: 812 }, '&group=clientMatter&sort=clientMatter');
    await expect(lane(page, 'IN_PROGRESS').getByRole('tree')).toBeVisible();
    const clients = lane(page, 'IN_PROGRESS').locator('[role="treeitem"][aria-level="1"]');
    const first = clients.first();
    const label = await first.getAttribute('aria-label');
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await laneTab(page, 'NEW').click();
    await laneTab(page, 'IN_PROGRESS').click();
    await expect(
      lane(page, 'IN_PROGRESS').locator(`[role="treeitem"][aria-label="${label}"]`),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  test('768x1024: the switcher is shown with one lane that fills the window and scrolls inside it; 1024: the four lanes', async ({
    page,
  }) => {
    await openBoard(page, { width: 768, height: 1024 });
    await expect(page.locator('[data-lane-switcher]')).toBeVisible();
    expect(await shownLanes(page)).toEqual(['IN_PROGRESS']);
    // Fixed-height page: the document does not scroll, the lane body does and reaches the bottom of the window.
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1),
    ).toBe(true);
    const body = (await lane(page, 'IN_PROGRESS').locator('[data-lane-body]').boundingBox())!;
    expect(body.y + body.height).toBeGreaterThan(1024 - 60);
    expect(
      await lane(page, 'IN_PROGRESS')
        .locator('[data-lane-body]')
        .evaluate((e) => e.scrollHeight > e.clientHeight),
    ).toBe(true);
    for (const code of CODES) {
      await laneTab(page, code).click();
      await shot(page, `lane-${code.toLowerCase()}-768`);
    }
    await laneTab(page, 'IN_PROGRESS').click();
    await page.setViewportSize({ width: 899, height: 900 });
    await expect(page.locator('[data-lane-switcher]')).toBeVisible();
    await page.setViewportSize({ width: 900, height: 900 });
    await expect(page.locator('[data-lane-switcher]')).toHaveCount(0);
    expect(await shownLanes(page)).toEqual([...CODES]);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('[data-lane-switcher]')).toHaveCount(0);
    await shot(page, 'board-1024');
  });

  test('a short landscape phone (812x375) scrolls the page; the switcher scrolls away with it', async ({
    page,
  }) => {
    await openBoard(page, { width: 812, height: 375 });
    await expect(page.locator('[data-lane-switcher]')).toBeVisible();
    expect(
      await page.locator('[data-lane-switcher]').evaluate((e) => getComputedStyle(e).position),
    ).toBe('static');
    expect(await shownLanes(page)).toEqual(['IN_PROGRESS']);
  });

  test('axe is clean with the lane switcher at 375 and 768, and with the four lanes at 1366 and 1920', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    for (const [w, h] of [
      [375, 812],
      [768, 1024],
      [1366, 768],
      [1920, 1080],
    ]) {
      await openBoard(page, { width: w, height: h });
      expect(await axeViolations(page), `board ${w}`).toEqual([]);
      if (w < 900) {
        await laneTab(page, 'ON_HOLD').click();
        expect(await axeViolations(page), `on hold ${w}`).toEqual([]);
        await laneTab(page, 'COMPLETED').click();
        expect(await axeViolations(page), `completed ${w}`).toEqual([]);
      }
    }
  });
});

test.describe('Dashboard tab row on a phone', () => {
  test('375: every tab is reachable; the strip scrolls with a visible hint and keeps the tablist keyboard', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    const list = page.getByRole('tablist', { name: 'Dashboard views' });
    await expect(list.getByRole('tab')).toHaveCount(5);
    const strip = page.locator('mf-dash-tabs .strip');
    await expect(strip).toHaveAttribute('data-more-end', 'true');
    await expect(strip).toHaveAttribute('data-more-start', 'false');
    await expect(page.locator('mf-dash-tabs .hint--end')).toBeVisible();
    await shot(page, 'tabs-375-summary');
    const inside = async (name: string) => {
      const box = (await list.getByRole('tab', { name }).boundingBox())!;
      const bar = (await list.boundingBox())!;
      expect(box.x, name).toBeGreaterThanOrEqual(bar.x - 1);
      expect(box.x + box.width, name).toBeLessThanOrEqual(bar.x + bar.width + 1);
    };
    // Clicking any tab brings it fully into view; the hints follow the scroll position.
    for (const name of ['Users', 'Swimlane', 'Trends', 'Breakdowns', 'Summary']) {
      await list.getByRole('tab', { name }).click();
      await expect(list.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
      await inside(name);
    }
    await expect(strip).toHaveAttribute('data-more-start', 'false');
    // Keyboard: End goes to Users (the strip scrolls to it and shows the start hint), Home returns to Summary.
    await list.getByRole('tab', { name: 'Summary' }).focus();
    await page.keyboard.press('End');
    await expect(list.getByRole('tab', { name: 'Users' })).toBeFocused();
    await inside('Users');
    await expect(strip).toHaveAttribute('data-more-end', 'false');
    await expect(strip).toHaveAttribute('data-more-start', 'true');
    await shot(page, 'tabs-375-users');
    await page.keyboard.press('ArrowLeft');
    await expect(list.getByRole('tab', { name: 'Swimlane' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(list.getByRole('tab', { name: 'Summary' })).toBeFocused();
    await inside('Summary');
    expect(page.url()).not.toContain('tab=users');
    // No horizontal scroll of the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('the scroll hints follow the room: shown only while the tab list overflows; axe is clean at 375', async ({
    page,
  }) => {
    for (const width of [768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/dashboard');
      await expect(page.locator('mf-dash-tabs .strip')).toBeVisible();
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => {
        const list = document.querySelector<HTMLElement>('mf-dash-tabs .tabs')!;
        const strip = document.querySelector<HTMLElement>('mf-dash-tabs .strip')!;
        return {
          overflow: list.scrollWidth > list.clientWidth + 1,
          end: strip.getAttribute('data-more-end') === 'true',
        };
      });
      expect(state.end, `hint at ${width}`).toBe(state.overflow);
    }
    // 1366 has room for all five tabs.
    await expect(page.locator('mf-dash-tabs .hint--end')).toBeHidden();
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('mf-dash-tabs .strip')).toHaveAttribute('data-more-end', 'true');
    expect(await axeViolations(page), 'tabs 375').toEqual([]);
  });
});

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

  test('1920x1080: the board spans the content width and the window height; a lane shows 14 compact (and 5 whole comfortable) cards', async ({
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
      // Known gap (#126): a comfortable card is 162 px high, so 5 whole cards fit (the sixth is cut); the target of 6 is reported on #87.
      expect(comfortable[i], `comfortable ${code}`).toBeGreaterThanOrEqual(Math.min(5, total));
    }
    await density(page, 'Comfortable');
  });

  test('2560x1440: a lane is at most 480 px wide, the board is left aligned and blank space is on the right', async ({
    page,
  }) => {
    await openBoard(page, { width: 2560, height: 1440 });
    const head = (await page.locator('[data-dash-head]').boundingBox())!;
    const boxes = await Promise.all(CODES.map(async (c) => (await lane(page, c).boundingBox())!));
    for (const box of boxes) expect(box.width).toBeLessThanOrEqual(480.5);
    expect(Math.abs(boxes[0].x - head.x)).toBeLessThanOrEqual(1);
    const board = (await page.locator('[data-board]').boundingBox())!;
    expect(board.y + board.height).toBeGreaterThanOrEqual(1440 - 40);
    // Lanes keep a gap and are in one row.
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width);
    expect(new Set(boxes.map((x) => Math.round(x.y))).size).toBe(1);
    await shot(page, 'board-2560');
  });

  test('1600 and 2560: Swimlane, Users, Trends and Coverage use the whole width, Summary and Breakdowns keep 1360 px; the left edge never moves', async ({
    page,
  }) => {
    const tabs = [
      { name: 'summary', url: '/dashboard', capped: true },
      { name: 'breakdowns', url: '/dashboard?tab=breakdowns', capped: true },
      { name: 'trends', url: '/dashboard?tab=trends', capped: false },
      { name: 'swimlane', url: `${base}`, capped: false },
      { name: 'users', url: '/dashboard?tab=users', capped: false },
      { name: 'coverage', url: '/dashboard?tab=users&view=coverage', capped: false },
    ];
    for (const width of [1366, 1600, 2560]) {
      await page.setViewportSize({ width, height: width === 2560 ? 1440 : 900 });
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
    await expect(page.locator('[data-panel="overdue"] li').first()).toBeVisible();
    await page.waitForTimeout(800);
    const cls = () => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    const reset = () => page.evaluate(() => ((window as unknown as { __cls: number }).__cls = 0));
    const tabList = page.getByRole('tablist', { name: 'Dashboard views' });
    const results: Record<string, number> = {};
    for (const [name, ready] of [
      ['Users', '[data-users-grid] li'],
      ['Summary', '[data-panel="overdue"] li'],
      ['Swimlane', '[data-board] mf-swimlane-card'],
      ['Summary', '[data-panel="overdue"] li'],
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

  test('axe is clean on the 1920 board and the 2560 board', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    for (const [w, h] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      await openBoard(page, { width: w, height: h });
      expect(await axeViolations(page), `board ${w}`).toEqual([]);
    }
  });
});
