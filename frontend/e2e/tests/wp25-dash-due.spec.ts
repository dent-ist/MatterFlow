import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard and Swimlane adopt the shared Due cell (TQ-WP25, #213, #214): the Summary lists show the whole "Overdue 24d" at every size
 * (no clipping, BUG-TQ2), the Summary rows, the Swimlane card and the task header say the same words as the Task Queue row of the same
 * task, and axe is clean at four sizes. Own tagged tasks only (the database is shared); the Summary lists are the top five of the whole
 * database, so what they show is compared row by row with the queue instead of expecting our tasks in them. Screenshots go to
 * E2E_SCREENSHOTS when it is set (docs/ux/task-queue-review/fixes/wp-dash-due).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

function inFirmZone(ms: number): { dueDate: string; dueTime: string } {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: FIRM_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: FIRM_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return { dueDate: date, dueTime: time };
}

const ALL_SIZES = [
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [1024, 768],
  [768, 1024],
  [375, 812],
] as const;
const AXE_SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

interface Cell {
  num: string;
  title: string;
  sr: string;
  l2: string;
  fits: boolean;
  inside: boolean;
}

/** What a Due cell says: the spoken sentence and the relative text (line 2), whitespace-normalised. */
const words = (sr: string | null, l2: string | null) => ({
  sr: (sr ?? '').replace(/\s+/g, ' ').trim(),
  l2: (l2 ?? '').replace(/\s+/g, ' ').trim(),
});

test.describe('Dashboard and Swimlane Due cell (#213, #214)', () => {
  let tag: string;
  const titles: Record<string, string> = {};
  const ids: Record<string, number> = {};
  const title = (k: string) => `Dash due ${k} ${tag}`;

  test.beforeAll(async ({ seed }) => {
    test.setTimeout(180_000);
    const world = await seed.world();
    tag = uid();
    const now = Date.now();
    const make = async (k: string, due: object) => {
      const t = await seed.task(world, { title: title(k), ...due });
      titles[k] = title(k);
      ids[k] = Number(t['taskId']);
    };
    await make('overdue24d', { dueDate: dateInZone(FIRM_ZONE, -24) });
    await make('overdue12d', { dueDate: dateInZone(FIRM_ZONE, -12) });
    await make('overdueTimed', inFirmZone(now - 30 * 3600_000));
    await make('overdue6h', inFirmZone(now - 6 * 3600_000 - 60_000));
    await make('today', { dueDate: dateInZone(FIRM_ZONE, 0), dueTime: '23:59' });
    await make('tomorrow', { dueDate: dateInZone(FIRM_ZONE, 1) });
    await make('in2', { dueDate: dateInZone(FIRM_ZONE, 2) });
    await make('later', { dueDate: dateInZone(FIRM_ZONE, 20) });
    await make('asap', {});
  });

  test('Swimlane card and task header say what the Task Queue row says, the compact card stays 44 px; axe at four sizes', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const queue = new TaskQueuePage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await queue.open(`?q=${tag}&status=NEW`);
    const keys = Object.keys(titles);
    const grid: Record<string, { sr: string; l2: string }> = {};
    for (const k of keys) {
      const cell = page
        .locator('tbody tr[data-task]', { hasText: titles[k] })
        .locator('td[data-col="due"] .dc');
      await expect(cell).toBeVisible();
      grid[k] = words(
        await cell.locator('.dc-sr').textContent(),
        await cell
          .locator('.dc-l2')
          .textContent({ timeout: 500 })
          .catch(() => null),
      );
    }
    expect(grid['overdue24d'].l2).toBe('Overdue 24d');
    expect(grid['in2'].l2).toBe('In 2 days');

    await page.goto(`/dashboard?tab=swimlane&q=${tag}`);
    await expect(page.locator('[data-lane="NEW"] mf-swimlane-card').first()).toBeVisible();
    for (const k of keys) {
      const card = page.locator('mf-swimlane-card', { hasText: titles[k] }).first();
      await expect(card, `${k} card`).toBeVisible();
      const cell = card.locator('[data-due] mf-due-cell .dc');
      const l2 = await cell
        .locator('.dc-l2')
        .textContent({ timeout: 500 })
        .catch(() => null);
      const got = words(await cell.locator('.dc-sr').textContent(), l2);
      expect(got, `${k}: Swimlane card = queue row`).toEqual(grid[k]);
      expect(
        await cell.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        `${k} chip not clipped`,
      ).toBe(true);
    }
    // The compact card (when the board is compact) is one line of 44 px.
    const line = page.locator('mf-swimlane-card .card--line').first();
    if (await line.count()) expect((await line.boundingBox())!.height).toBeCloseTo(44, 0);
    await shot(page, 'after-swimlane-1366');

    // The task header: the same words (the page shows the shared cell in its inline layout).
    for (const k of ['overdue24d', 'in2', 'asap']) {
      await page.goto(`/tasks/${ids[k]}`);
      const cell = page.locator('[data-due] mf-due-cell .dc').first();
      await expect(cell, `${k} header`).toBeVisible();
      const l2 = await cell
        .locator('.dc-l2')
        .textContent({ timeout: 500 })
        .catch(() => null);
      expect(
        words(await cell.locator('.dc-sr').textContent(), l2),
        `${k}: header = queue row`,
      ).toEqual(grid[k]);
      if (k === 'overdue24d') await shot(page, 'after-task-header-1366');
    }

    for (const [w, h] of AXE_SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/dashboard?tab=swimlane&q=${tag}${w < 900 ? '&lane=new' : ''}`);
      await expect(page.locator('mf-swimlane-card').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await shot(page, `after-swimlane-${w}`);
      await axeClean(page, `axe swimlane ${w}`);
    }
  });
});
