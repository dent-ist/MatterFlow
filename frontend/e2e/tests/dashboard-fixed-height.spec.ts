import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedBoard } from '../support/board';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard fixed height (issue #137) with the page chrome (#92 header row, #93 width cap, #100 single tab): at 1366x768, 1920x1080 and
 * 1024x768 the document never scrolls on any tab, the header row stays in view and only regions inside the tabs scroll. Boxes are
 * measured, not eyeballed. With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp2.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
] as const;

type TabName = 'summary' | 'breakdowns' | 'trends' | 'swimlane' | 'workload' | 'table' | 'coverage';

const TABS: { name: TabName; url: string; ready: string }[] = [
  { name: 'summary', url: '/dashboard', ready: '[data-panel="overdue"] li' },
  { name: 'breakdowns', url: '/dashboard?tab=breakdowns', ready: '[data-grid="breakdowns"]' },
  { name: 'trends', url: '/dashboard?tab=trends', ready: '[data-plot]' },
  { name: 'swimlane', url: '/dashboard?tab=swimlane', ready: '[data-board] [data-card]' },
  { name: 'workload', url: '/dashboard?tab=users', ready: '[data-users-grid] li' },
  { name: 'table', url: '/dashboard?tab=users', ready: '[data-users-table]' },
  { name: 'coverage', url: '/dashboard?tab=users&view=coverage', ready: '[data-coverage-region]' },
];

test.describe.configure({ timeout: 240_000 });

let tag: string;

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  tag = uid();
  // Lists for the Summary: six tasks of each kind (the lists show five).
  const world = await seed.world();
  for (let i = 0; i < 6; i++) {
    await seed.task(world, {
      title: `FH overdue ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, -(2 + i)),
    });
    await seed.task(world, {
      title: `FH due soon ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, i % 3),
    });
    await seed.task(world, { title: `FH unassigned ${i + 1} ${tag}` });
  }
  // Many task types, so the Trends list is longer than any window.
  for (let i = 0; i < 14; i++) {
    await seed.taskType({
      name: `FH type ${tag} ${String(i + 1).padStart(2, '0')}`,
      workflows: [world.workflow],
    });
  }
  // A busy board (cards in the lanes, people on the Users tab).
  await seedBoard(admin, seed, { tasks: 60 });
});

async function shoot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function open(
  page: Page,
  tab: (typeof TABS)[number],
  size: { width: number; height: number },
) {
  await page.setViewportSize(size);
  await page.goto(tab.url);
  // The layout is remembered per person in this browser: pick the one the case is about.
  if (tab.name === 'table' || tab.name === 'workload') {
    await expect(page.locator('[data-layout]').first()).toBeVisible({ timeout: 20_000 });
    await page.locator(`[data-layout="${tab.name === 'table' ? 'table' : 'cards'}"]`).click();
  }
  // The Coverage matrix of a shared test database (hundreds of task types) takes a while to draw.
  await expect(page.locator(tab.ready).first()).toBeVisible({
    timeout: tab.name === 'coverage' ? 120_000 : 20_000,
  });
  await page.waitForLoadState('networkidle');
}

/** How far the document can scroll (0 = the page does not scroll). */
const docOverflow = (page: Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement!;
    return { over: el.scrollHeight - el.clientHeight, top: el.scrollTop };
  });

async function headerInView(page: Page, height: number, tabs = true): Promise<void> {
  const head = (await page.locator('[data-dash-head]').boundingBox())!;
  expect(head.y).toBeGreaterThanOrEqual(0);
  expect(head.y + head.height).toBeLessThanOrEqual(height);
  await expect(page.locator('[data-refresh]')).toBeInViewport();
  if (tabs) await expect(page.getByRole('tab', { name: 'Summary' })).toBeInViewport();
  else await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
}

test.describe('no page scroll on any tab (#137)', () => {
  for (const size of SIZES) {
    for (const tab of TABS) {
      test(`${tab.name} at ${size.width}x${size.height}: the document does not scroll, the header row stays`, async ({
        page,
      }) => {
        await open(page, tab, size);
        const { over } = await docOverflow(page);
        expect(over, 'document scroll height beyond the window').toBeLessThanOrEqual(0);
        await headerInView(page, size.height);
        // The tab panel ends inside the window as well (nothing hangs below the fold).
        const panel = (await page.locator('[data-tabpanel]').first().boundingBox())!;
        expect(panel.y + panel.height).toBeLessThanOrEqual(size.height + 1);
        await shoot(page, `${tab.name}-${size.width}`);
        // Scrolling the wheel over the page leaves the header where it was.
        await page.mouse.move(size.width / 2, size.height / 2);
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(150);
        expect((await docOverflow(page)).top).toBe(0);
        await headerInView(page, size.height);
      });
    }
  }

  test('the single-tab technician view fills the window too', async ({ seed, asUser }) => {
    const role = await seed.role(
      ['Task.View', 'Task.Assign', 'Dashboard.View', 'Dashboard.ViewUnassigned'],
      'E2E FH technician',
    );
    const user = await seed.user([role.name], 'fhtech');
    const page = await asUser(user.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/dashboard');
      await expect(page.locator('[data-panel="unassigned"] li').first()).toBeVisible();
      await expect(page.getByRole('tablist')).toHaveCount(0);
      expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
      await headerInView(page, size.height, false);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await shoot(page, 'technician-1366');
    await page.close();
  });
});

test.describe('regions inside the tabs scroll (#137)', () => {
  test('Summary at 1366x768: tiles stay, each list scrolls inside its panel with the heading and View all pinned, all five rows are there', async ({
    page,
  }) => {
    await open(page, TABS[0], { width: 1366, height: 768 });
    let scrollable = 0;
    for (const kind of ['unassigned', 'overdue', 'dueSoon']) {
      const panel = page.locator(`[data-panel="${kind}"]`);
      // The full capped list (5), not 3: the panel scrolls instead.
      await expect(panel.locator('li')).toHaveCount(5);
      const rows = panel.locator('[data-rows]');
      await expect(rows).toHaveAttribute('role', 'region');
      await expect(rows).toHaveAttribute('tabindex', '0');
      await expect(rows).toHaveAttribute('aria-label', /scrollable/);
      const m = await rows.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
      if (m.sh > m.ch + 1) scrollable++;
      const heading = (await panel.locator('h3').boundingBox())!;
      const outer = (await panel.boundingBox())!;
      expect(heading.y + heading.height).toBeLessThanOrEqual(outer.y + outer.height);
      await rows.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(100);
      const after = (await panel.locator('h3').boundingBox())!;
      expect(after.y, `${kind} heading did not move`).toBe(heading.y);
      if (await panel.locator('[data-view-all]').count()) {
        expect(await panel.locator('[data-view-all]').isVisible()).toBe(true);
      }
    }
    expect(scrollable, 'on a 768 px window the lists do not all fit: they scroll').toBeGreaterThan(
      0,
    );
    // The tiles did not move.
    const tile = page.locator('mf-stat-tile').first();
    await expect(tile).toBeInViewport();
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
  });

  test('Summary at 1024x768: the lists sit under the tiles and the Summary scrolls as one named region', async ({
    page,
  }) => {
    await open(page, TABS[0], { width: 1024, height: 768 });
    const region = page.getByRole('region', { name: 'Summary, scrollable' });
    await expect(region).toHaveAttribute('tabindex', '0');
    const m = await region.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh).toBeGreaterThan(m.ch);
    await region.evaluate((el) => (el.scrollTop = 200));
    expect((await docOverflow(page)).top).toBe(0);
    await headerInView(page, 768);
    // Five rows in every list.
    await expect(page.locator('[data-panel="overdue"] li')).toHaveCount(5);
  });

  test('Breakdowns: the cards scroll in their own region; the caption stays', async ({ page }) => {
    await open(page, TABS[1], { width: 1024, height: 768 });
    const region = page.getByRole('region', { name: 'Open task breakdowns, scrollable' });
    await expect(region).toHaveAttribute('tabindex', '0');
    const m = await region.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh).toBeGreaterThan(m.ch);
    const caption = (await page.locator('[data-bd-caption]').boundingBox())!;
    await region.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(100);
    expect((await page.locator('[data-bd-caption]').boundingBox())!.y).toBe(caption.y);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
  });

  test('Trends with the task types ticked: only the Task Types list moves, both charts keep their size and stay fully visible', async ({
    page,
  }) => {
    await open(page, TABS[2], { width: 1366, height: 768 });
    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(page.locator('[data-plot] polyline.series:not(.partial)').first()).toBeAttached();
    const ticked = await page.locator('[data-type-box]:checked').count();
    expect(ticked).toBeGreaterThanOrEqual(8);
    const list = page.getByRole('region', { name: 'Task types, scrollable' });
    const flows = page.locator('[data-panel="flows"]');
    const backlog = page.locator('[data-panel="backlog"]');
    const before = [await flows.boundingBox(), await backlog.boundingBox()];
    const m = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh, 'the list is longer than its box').toBeGreaterThan(m.ch);
    await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(150);
    expect((await list.evaluate((el) => el.scrollTop)) > 0).toBe(true);
    expect([await flows.boundingBox(), await backlog.boundingBox()]).toEqual(before);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
    for (const panel of [flows, backlog]) {
      const b = (await panel.boundingBox())!;
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(768);
      expect(b.height).toBeGreaterThanOrEqual(160);
    }
    // Nothing of the chart column scrolls: the charts fit.
    const chart = page.locator('[data-plot]');
    const c = await chart.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(c.sh).toBeLessThanOrEqual(c.ch + 1);
    await shoot(page, 'trends-ticked-1366');
  });

  test('Trends: resizing the window from 768 to 1080 high re-fits the charts with no clipping', async ({
    page,
  }) => {
    await open(page, TABS[2], { width: 1366, height: 768 });
    const flows = page.locator('[data-panel="flows"] .panel-plot');
    const small = (await flows.boundingBox())!;
    await page.setViewportSize({ width: 1366, height: 1080 });
    await expect
      .poll(async () => (await flows.boundingBox())!.height, { timeout: 5000 })
      .toBeGreaterThan(small.height + 100);
    for (const key of ['flows', 'backlog']) {
      const b = (await page.locator(`[data-panel="${key}"]`).boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(1080);
    }
    // The svg is drawn at its panel's height (no clipping, no gap).
    const fit = await page.evaluate(() => {
      const wrap = document
        .querySelector('[data-panel="flows"] .panel-plot')!
        .getBoundingClientRect();
      const svg = document.querySelector('[data-panel="flows"] svg')!.getBoundingClientRect();
      return Math.abs(wrap.height - svg.height) < 1.5 && Math.abs(wrap.width - svg.width) < 1.5;
    });
    expect(fit).toBe(true);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect
      .poll(async () => (await flows.boundingBox())!.height, { timeout: 5000 })
      .toBeLessThanOrEqual(small.height + 2);
  });

  test('Swimlane: the toolbar is pinned, the board fills the rest and the lanes scroll', async ({
    page,
  }) => {
    await open(page, TABS[3], { width: 1366, height: 768 });
    const board = page.getByRole('region', { name: 'Swimlane board' });
    const b = (await board.boundingBox())!;
    expect(b.y + b.height).toBeGreaterThan(768 - 40);
    expect(b.y + b.height).toBeLessThanOrEqual(768);
    const lanes = await page.locator('[data-board] mf-swimlane-lane').evaluateAll((els) =>
      els.map((el) => {
        const body = el.querySelector('.body')!;
        return { sh: body.scrollHeight, ch: body.clientHeight };
      }),
    );
    expect(lanes.some((l) => l.sh > l.ch)).toBe(true);
    const toolbar = (await page.locator('mf-swimlane-toolbar').boundingBox())!;
    await page
      .locator('[data-board] mf-swimlane-lane .body')
      .first()
      .evaluate((el) => (el.scrollTop = 400));
    expect((await page.locator('mf-swimlane-toolbar').boundingBox())!.y).toBe(toolbar.y);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
  });

  test('Users: toolbar and summary strip are pinned, the people scroll in their own region (cards and table)', async ({
    page,
  }) => {
    await open(page, TABS[4], { width: 1024, height: 768 });
    const region = page.getByRole('region', { name: 'Team workload, scrollable' });
    await expect(region).toHaveAttribute('tabindex', '0');
    const strip = (await page.locator('mf-users-summary').boundingBox())!;
    const box = (await region.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(768);
    await open(page, TABS[5], { width: 1024, height: 768 });
    const table = page.getByRole('region', { name: 'Team workload, scrollable' });
    const th = page.locator('[data-users-table] thead th').first();
    const before = (await th.boundingBox())!;
    await table.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(100);
    // The header row is still at the top of the region (sticky) when the rows have scrolled, or the table fits.
    const after = (await th.boundingBox())!;
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
  });

  test('Coverage: the matrix is the scrolling region, heading and controls stay', async ({
    page,
  }) => {
    await open(page, TABS[6], { width: 1366, height: 768 });
    const region = page.locator('[data-coverage-region]');
    await expect(region).toHaveAttribute('tabindex', '0');
    const r = (await region.boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual(768);
    expect(r.y + r.height).toBeGreaterThan(768 - 60);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
    await shoot(page, 'coverage-1366');
  });
});

test.describe('keyboard (#137)', () => {
  test('the Task Types list is reachable with Tab and scrolls with the arrow keys; focus is never trapped', async ({
    page,
  }) => {
    await open(page, TABS[2], { width: 1366, height: 768 });
    const list = page.getByRole('region', { name: 'Task types, scrollable' });
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await list.evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab reaches the list region').toBe(true);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(150);
    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Tab');
    expect(await list.evaluate((el) => el === document.activeElement)).toBe(false);
    expect((await docOverflow(page)).top).toBe(0);
  });

  test('a Summary list is reachable with Tab and scrolls with the keyboard', async ({ page }) => {
    await open(page, TABS[0], { width: 1366, height: 768 });
    const rows = page.getByRole('region', { name: 'Unassigned tasks, scrollable' });
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await rows.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    await page.keyboard.press('End');
    expect((await docOverflow(page)).top).toBe(0);
  });
});

test.describe('page chrome and width (#92, #93, #100)', () => {
  test('the H1 sits in the tab row at 20 px and the header takes at most 56 px', async ({
    page,
  }) => {
    await open(page, TABS[0], { width: 1366, height: 768 });
    const h1 = page.getByRole('heading', { level: 1, name: 'Dashboard' });
    await expect(h1).toHaveCSS('font-size', '20px');
    const tab = (await page.getByRole('tab', { name: 'Summary' }).boundingBox())!;
    const h = (await h1.boundingBox())!;
    expect(Math.abs(h.y + h.height / 2 - (tab.y + tab.height / 2))).toBeLessThanOrEqual(4);
    const head = (await page.locator('[data-dash-head]').boundingBox())!;
    expect(head.height).toBeLessThanOrEqual(56);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await shoot(page, 'header-1366');
  });

  test('1600 px and up: Swimlane, Users and Trends use the whole content area, Summary and Breakdowns keep 1360 px; the left edge never moves', async ({
    page,
  }) => {
    const widths: Record<string, number> = {};
    const lefts = new Set<number>();
    for (const tab of TABS.filter((t) =>
      ['summary', 'breakdowns', 'trends', 'swimlane', 'workload'].includes(t.name),
    )) {
      await open(page, tab, { width: 1920, height: 1080 });
      const b = (await page.locator('mf-fixed-page').boundingBox())!;
      widths[tab.name] = Math.round(b.width);
      lefts.add(Math.round(b.x));
    }
    expect(lefts.size, 'one left edge for every tab').toBe(1);
    expect(widths['summary']).toBeLessThanOrEqual(1360);
    expect(widths['breakdowns']).toBeLessThanOrEqual(1360);
    for (const name of ['trends', 'swimlane', 'workload'])
      expect(widths[name], name).toBeGreaterThan(1360);
    // 1366: nothing changes (the content is narrower than the cap anyway).
    await open(page, TABS[3], { width: 1366, height: 768 });
    expect((await page.locator('mf-fixed-page').boundingBox())!.width).toBeLessThanOrEqual(1360);
  });

  test('Trends at 1920x1080: the chart is at least 1000 px wide (#114)', async ({ page }) => {
    await open(page, TABS[2], { width: 1920, height: 1080 });
    const w = (await page.locator('[data-panel="flows"] svg').boundingBox())!.width;
    expect(w).toBeGreaterThanOrEqual(1000);
    await shoot(page, 'trends-1920');
  });

  test('a role with one tab has no tablist: the tab name is the H1, Refresh stays, the panel is a labelled region, no ?tab= is written', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Dashboard.View', 'Dashboard.ViewTrends'],
      'E2E FH trends only',
    );
    const user = await seed.user([role.name], 'fhtrends');
    const page = await asUser(user.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('tabpanel')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Trends' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    await expect(page.locator('[data-plot]')).toBeVisible();
    await expect(page).not.toHaveURL(/tab=/);
    expect((await docOverflow(page)).over).toBeLessThanOrEqual(0);
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await shoot(page, 'trends-only-1366');
    await page.close();
  });

  test('below 768 px the page scrolls normally (documented fallback) and the tab row is not sticky below 600 px', async ({
    page,
  }) => {
    await open(page, TABS[0], { width: 375, height: 812 });
    expect((await docOverflow(page)).over).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    const pos = await page.locator('mf-dash-tabs').evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe('static');
    await shoot(page, 'summary-375');
    await open(page, TABS[2], { width: 375, height: 812 });
    await shoot(page, 'trends-375');
    await open(page, TABS[3], { width: 375, height: 812 });
    await shoot(page, 'swimlane-375');
    await open(page, TABS[4], { width: 375, height: 812 });
    await shoot(page, 'users-375');
    await open(page, TABS[1], { width: 375, height: 812 });
    await shoot(page, 'breakdowns-375');
  });

  test('at 700 px the header row is sticky while the page scrolls', async ({ page }) => {
    await open(page, TABS[0], { width: 700, height: 900 });
    expect(await page.locator('mf-dash-tabs').evaluate((el) => getComputedStyle(el).position)).toBe(
      'sticky',
    );
    await page.mouse.move(350, 500);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(200);
    const head = (await page.locator('[data-dash-head]').boundingBox())!;
    expect(head.y).toBeGreaterThanOrEqual(0);
    expect(head.y).toBeLessThan(120);
    await expect(page.locator('[data-refresh]')).toBeInViewport();
  });
});

test.describe('axe (#137)', () => {
  test.skip(!axeAvailable(), 'axe-core is not available');
  for (const size of [SIZES[0], SIZES[1], { width: 375, height: 812 }]) {
    for (const tab of TABS) {
      test(`${tab.name} at ${size.width}x${size.height} is axe clean`, async ({ page }) => {
        await open(page, tab, size);
        expect(await axeViolations(page)).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
      });
    }
  }
});
