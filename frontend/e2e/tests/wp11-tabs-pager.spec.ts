import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * WP11 Tab strip and pager (#279, #280). `mf-tabs` shows a scroll cue (edge fade and chevron) on the side that has more tabs, brings the
 * selected tab into view and snaps; `mf-pager` is one row at the two desktop sizes, never a lone button.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/clients-review/fixes/wp11).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [1920, 1080],
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

test.beforeAll(async ({ seed }) => {
  test.setTimeout(300_000);
  const world = await seed.world();
  matterId = world.matter.matterId;
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

test.describe('Tab strip scroll cue (#279)', () => {
  test('wide screens show no cue; counts in the labels do not break it', async ({ page }) => {
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${matterId}`);
      await expect(page.getByRole('tab', { name: /^Tasks/ })).toBeVisible();
      // The Matter page has 8 tabs (the System Admin's strip): at both desktop sizes they all fit, so there is no scroll cue (#1367).
      const overflows = await page
        .locator('mf-tabs [role="tablist"]')
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(overflows, `the 8 tabs fit at ${w}`).toBe(false);
      await expect(page.locator('mf-tabs [data-tab-cue]')).toHaveCount(0);
      await shot(page, `matter-tabs-no-cue-${w}x${h}`);
    }
  });

  test('axe at both desktop sizes', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not available');
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/matters/${matterId}`);
      await expect(page.getByRole('tab').first()).toBeVisible();
      expect(await axeViolations(page), `matter at ${w}`).toEqual([]);
      expect(await noPageScroll(page)).toBe(true);
    }
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

test.describe('Pager (#280)', () => {
  test('Task Queue: one row and never a lone button, at both desktop sizes', async ({ page }) => {
    const queue = new TaskQueuePage(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await queue.open(`?matter=${matterId}&pageSize=25&page=2`);
      await expect(page.locator('mf-pager [data-page]')).toHaveText('Page 2 of 2');
      const rows = await pagerRows(page);
      expectIntentional(rows, width, 'Task Queue');
      if (width >= 1366) expect(rows.length, 'one row on a wide screen').toBe(1);
      expect(await noPageScroll(page)).toBe(true);
    }
  });

  test('axe at both desktop sizes', async ({ page }) => {
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
