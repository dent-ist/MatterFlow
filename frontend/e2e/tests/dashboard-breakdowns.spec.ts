import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';

/**
 * Dashboard > Breakdowns (epic #85): every bar split into not overdue and overdue with the overdue link carrying `overdue=true` into the
 * Task Queue (#109), six age buckets (#110), one title per card (#113), the card grid chosen by the width of the tab (#111) and Low drawn
 * differently from Normal (#112). Screenshots: set E2E_SCREENSHOTS to the output folder.
 */
const SHOTS = process.env['E2E_SCREENSHOTS'];

interface Row {
  label: string;
  count: number;
  overdue: number;
  query: string | null;
}
interface Summary {
  overdue: { count: number };
  open: { count: number };
  byPriority: Row[];
  byTaskType: Row[];
  byStatus: Row[];
  aging: (Row & { key: string })[];
}

async function openBreakdowns(page: Page) {
  await page.goto('/dashboard?tab=breakdowns');
  // The summary is cached on the server for a few seconds: Refresh reads it now, so the tasks the test has just created are in it.
  const fresh = page.waitForResponse(
    (r) => r.url().includes('/api/v1/dashboard?') && r.url().includes('fresh=true'),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await fresh;
  const section = page.locator('[data-section="breakdowns"]');
  await expect(section.locator('mf-bar-list li').first()).toBeVisible();
  await expect(section.locator('mf-stacked-bar .legend li').first()).toBeVisible();
  return section;
}

test.describe('Dashboard Breakdowns', () => {
  test('overdue shares: the rows, the buckets and the Overdue tile agree, and the overdue link opens the queue with the same count', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `BD late ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -3) });
    await seed.task(world, { title: `BD late 2 ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -9) });
    await seed.task(world, { title: `BD later ${uid()}`, dueDate: dateInZone(FIRM_ZONE, 20) });
    await seed.task(world, { title: `BD asap ${uid()}` });

    const summary = await seed.admin.get<Summary>('/api/v1/dashboard?fresh=true');
    const overdueTotal = summary.overdue.count;
    expect(overdueTotal).toBeGreaterThanOrEqual(2);
    for (const group of ['byPriority', 'byTaskType', 'byStatus', 'aging'] as const) {
      const rows = summary[group];
      expect(
        rows.reduce((n, r) => n + r.overdue, 0),
        group,
      ).toBe(overdueTotal);
    }
    expect(summary.aging.map((b) => b.key)).toEqual([
      '0-2',
      '3-7',
      '8-14',
      '15-30',
      '31-60',
      '61+',
    ]);

    const section = await openBreakdowns(page);
    const priority = section.locator('mf-bar-list').first();
    const withOverdue = priority.locator('li', { has: page.locator('.od-text') }).first();
    const text = (await withOverdue.locator('.od-text').innerText()).trim();
    const shown = Number(/^(\d+) overdue/.exec(text)![1]);
    await withOverdue.locator('.od-text').click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page).toHaveURL(/priority=\d+/);
    const queue = await seed.admin.get<{ total: number }>(
      `/api/v1/task-queue?pageSize=1&${new URL(page.url()).searchParams.toString()}`,
    );
    expect(queue.total).toBe(shown);

    // The row with no overdue task shows a plain bar and no text.
    await openBreakdowns(page);
    const plain = section.locator('mf-bar-list li', { hasNot: page.locator('.od-text') }).first();
    await expect(plain.locator('.od')).toHaveCount(0);
  });

  test('one title per card: a hidden "Open tasks" H2 and the cards as H3, no "Open by" headings', async ({
    page,
  }) => {
    const section = await openBreakdowns(page);
    await expect(section.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Open tasks');
    await expect(section.getByRole('heading', { level: 3 })).toHaveText([
      'Priority',
      'Task type',
      'Status',
      'Age',
    ]);
    await expect(section.getByRole('heading', { name: /^Open (by|tasks by)/ })).toHaveCount(0);
    await expect(page.locator('[data-bd-caption]')).toContainText(
      'Open tasks, now. Not affected by the period.',
    );
    await expect(page.getByRole('link', { name: /^0-2 days: \d+ tasks/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^More than 60 days: \d+ tasks/ })).toBeVisible();
  });

  test('the grid follows the width of the tab, keeps reading and tab order, and leaves no empty card interior', async ({
    page,
  }) => {
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      const section = await openBreakdowns(page);
      const grid = section.locator('[data-grid="breakdowns"]');
      const box = await grid.boundingBox();
      const cards = section.locator('mf-bar-list, mf-stacked-bar');
      await expect(cards).toHaveCount(4);
      const lefts = await cards.evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().left)),
      );
      const columns = new Set(lefts).size;
      const wide = box!.width;
      const expected = wide >= 1300 ? 4 : wide >= 700 ? 2 : 1;
      expect(columns, `${width}px viewport, tab ${Math.round(wide)}px`).toBe(expected);
      // No horizontal scroll.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      // Nothing inside a card sits more than 40px above its bottom edge (cards are not stretched).
      const gaps = await cards.evaluateAll((els) =>
        els.map((e) => {
          const card = e.querySelector('section')!.getBoundingClientRect();
          const last = Array.from(e.querySelectorAll('section > *')).pop()!;
          return Math.round(card.bottom - last.getBoundingClientRect().bottom);
        }),
      );
      for (const gap of gaps) expect(gap, `${width}px`).toBeLessThanOrEqual(40);

      // Tab order = reading order: Priority, Task type, Status, Age.
      const order = await grid.evaluate((g) => {
        const focusables = Array.from(g.querySelectorAll<HTMLElement>('a[href], button')).filter(
          (e) => e.tabIndex >= 0,
        );
        return focusables.map(
          (e) => e.closest('mf-bar-list, mf-stacked-bar')!.querySelector('h3')!.textContent,
        );
      });
      const firstSeen = [...new Set(order)];
      expect(firstSeen).toEqual(['Priority', 'Task type', 'Status', 'Age']);
    }
  });

  test('the cards do not move when the data arrives (layout shift of the tab 0.02 or less)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[])
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/dashboard?tab=breakdowns');
    await expect(page.locator('[data-section="breakdowns"] mf-bar-list li').first()).toBeVisible();
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => (window as unknown as { __cls: number }).__cls),
    ).toBeLessThanOrEqual(0.02);
  });

  test('Low and Normal bars differ by stroke, in the bar and in the table view', async ({
    page,
    seed,
  }) => {
    const priorities = await seed.admin.get<{ id: number; label: string }[]>('/api/v1/priorities');
    const world = await seed.world();
    for (const label of ['Normal', 'Low']) {
      const p = priorities.find((x) => x.label === label);
      if (p) await seed.task(world, { title: `BD ${label} ${uid()}`, priorityId: p.id });
    }
    const section = await openBreakdowns(page);
    const priority = section.locator('mf-bar-list').first();
    const stroke = async (label: string) =>
      priority
        .locator('li', { has: page.locator(`a[aria-label^="${label}:"]`) })
        .locator('.bar')
        .evaluate((e) => {
          const s = getComputedStyle(e);
          return `${s.borderTopStyle} ${s.borderTopWidth}`;
        });
    expect(await stroke('Normal')).toBe('solid 1px');
    expect(await stroke('Low')).toBe('dashed 2px');
    await priority.getByRole('button', { name: /View as table/ }).click();
    await expect(priority.locator('thead th')).toHaveText([
      'Priority',
      'Tasks',
      'Overdue',
      'Share',
    ]);
    await expect(priority.locator('tbody .marker')).not.toHaveCount(0);
  });

  test('axe is clean at 1366, 1920 and 375 (bars, table view and the age bar)', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      const section = await openBreakdowns(page);
      expect(await axeViolations(page), `${width} bars`).toEqual([]);
      for (const toggle of await section.locator('.toggle').all()) await toggle.click();
      expect(await axeViolations(page), `${width} tables`).toEqual([]);
    }
  });

  test('screenshots', async ({ page, seed }) => {
    test.skip(!SHOTS, 'set E2E_SCREENSHOTS to the output folder');
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS!, { recursive: true });
    const world = await seed.world();
    await seed.task(world, { title: `BD shot ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -4) });
    for (const [width, height] of [
      [1366, 900],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await openBreakdowns(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS!, `breakdowns-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    const section = await openBreakdowns(page);
    await page.addStyleTag({ content: 'html{filter:grayscale(1)}' });
    await section.screenshot({ path: path.join(SHOTS!, 'breakdowns-greyscale-1366.png') });
    await page.emulateMedia({ forcedColors: 'active' });
    await section.screenshot({ path: path.join(SHOTS!, 'breakdowns-forced-colors-1366.png') });
  });
});
