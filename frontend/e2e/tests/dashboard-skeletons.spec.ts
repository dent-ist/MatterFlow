import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedBoard } from '../support/board';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard skeletons (P8, issue #96): while the first read of a tab is on its way the tab shows the silhouette of what will be there (not eight
 * identical blocks), in the same boxes as the loaded content, so the figures arriving move nothing. The reads are held back with a gate, the box of
 * the tab panel is measured before and after, the layout shift of the whole load is observed (at most 0.02), the silhouettes are decorative with
 * one polite "Loading" status per tab, the pulse stops with `prefers-reduced-motion` and axe finds nothing in the loading state.
 * With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp12.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 375, height: 812 },
] as const;

interface TabCase {
  name: string;
  url: string;
  /** The tab panel (its box must not change), the silhouette kind, and something only the loaded tab has. */
  panel: string;
  kind: string;
  ready: string;
}

const TABS: TabCase[] = [
  {
    name: 'summary',
    url: '/dashboard?tab=summary',
    panel: '[data-tabpanel="summary"]',
    kind: 'summary',
    ready: '[data-panel="overdue"] li',
  },
  {
    name: 'breakdowns',
    url: '/dashboard?tab=breakdowns',
    panel: '[data-tabpanel="breakdowns"]',
    kind: 'breakdowns',
    ready: '[data-grid="breakdowns"]',
  },
  {
    name: 'trends',
    url: '/dashboard?tab=trends',
    panel: '[data-tabpanel="trends"]',
    kind: 'trends',
    ready: '[data-plot]',
  },
  {
    name: 'swimlane',
    url: '/dashboard?tab=swimlane',
    panel: '[data-tabpanel="swimlane"]',
    kind: 'lane',
    ready: '[data-board] [data-card]',
  },
  {
    name: 'users',
    url: '/dashboard?tab=users',
    panel: '[data-tabpanel="users"]',
    kind: 'users',
    ready: '[data-users-grid] li',
  },
  {
    name: 'coverage',
    url: '/dashboard?tab=users&view=coverage',
    panel: '[data-tabpanel="users"]',
    kind: 'coverage',
    ready: '[data-coverage-region]',
  },
];

test.describe.configure({ timeout: 240_000 });

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(300_000);
  const tag = uid();
  const world = await seed.world();
  for (let i = 0; i < 6; i++) {
    await seed.task(world, {
      title: `SK overdue ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, -(2 + i)),
    });
    await seed.task(world, {
      title: `SK due soon ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, i % 3),
    });
    await seed.task(world, { title: `SK unassigned ${i + 1} ${tag}` });
  }
  await seedBoard(admin, seed, { tasks: 40 });
});

async function shoot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Holds every Dashboard read until `release()`; the page shows its first-load state meanwhile. */
async function hold(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/dashboard**', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** Sums the layout shifts of the whole load (shifts right after an input do not count, as in the browser's own CLS). */
async function observeShifts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number; __why: string[] };
    w.__cls = 0;
    w.__why = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources: { node: Element | null; previousRect: DOMRect; currentRect: DOMRect }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        w.__cls += entry.value;
        for (const src of entry.sources ?? []) {
          const n = src.node as HTMLElement | null;
          w.__why.push(
            `${entry.value.toFixed(3)} ${n?.tagName?.toLowerCase()}.${String(n?.className).slice(0, 30)} y ${Math.round(src.previousRect.y)}->${Math.round(src.currentRect.y)} h ${Math.round(src.previousRect.height)}->${Math.round(src.currentRect.height)}`,
          );
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}

const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
/** Which elements moved (shown when the shift is over the limit). */
const shiftSources = (page: Page) =>
  page.evaluate(() => (window as unknown as { __why: string[] }).__why.join(' | '));

/** The single announcements on screen: statuses that are visible to assistive technology and say "Loading". */
const announcements = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('[role="status"]')].filter(
        (el) => !el.closest('[aria-hidden="true"]') && /^Loading/.test(el.textContent ?? ''),
      ).length,
  );

for (const size of SIZES) {
  test.describe(`skeletons at ${size.width}`, () => {
    for (const tab of TABS) {
      test(`${tab.name}: the silhouette fills the box of the loaded tab, shifts nothing and is clean`, async ({
        page,
      }) => {
        await page.setViewportSize(size);
        await observeShifts(page);
        const release = await hold(page);
        await page.goto(tab.url);

        const skeleton = page.locator(`${tab.panel} mf-dash-skeleton`).first();
        await expect(skeleton).toBeVisible({ timeout: 20_000 });
        await expect(page.locator(tab.ready)).toHaveCount(0);
        // One status, no matter how many lanes or tiles; the bones are decorative; the region is busy.
        expect(await announcements(page), 'one Loading status').toBe(1);
        await expect(skeleton).toHaveAttribute('data-skeleton', /.+/);
        if (tab.name !== 'swimlane') {
          await expect(skeleton).toHaveAttribute('data-skeleton', tab.kind);
        }
        await expect(skeleton).toHaveAttribute('aria-busy', 'true');
        await expect(skeleton.locator('.sil').first()).toHaveAttribute('aria-hidden', 'true');
        const before = (await page.locator(tab.panel).boundingBox())!;
        await shoot(page, `${tab.name}-skeleton-${size.width}`);
        if (axeAvailable()) {
          expect(await axeViolations(page), `axe while loading`).toEqual([]);
        }

        release();
        await expect(page.locator(tab.ready).first()).toBeVisible({
          timeout: tab.name === 'coverage' ? 120_000 : 30_000,
        });
        await expect(page.locator('mf-dash-skeleton')).toHaveCount(0);
        await page.waitForLoadState('networkidle');
        const after = (await page.locator(tab.panel).boundingBox())!;
        expect(Math.abs(after.x - before.x), 'x').toBeLessThanOrEqual(1);
        expect(Math.abs(after.y - before.y), 'y').toBeLessThanOrEqual(1);
        expect(Math.abs(after.width - before.width), 'width').toBeLessThanOrEqual(1);
        // The fixed-height page (window of at least 768 x 561): the panel is the same height with a silhouette and with the figures.
        if (size.width >= 768) {
          expect(Math.abs(after.height - before.height), 'height').toBeLessThanOrEqual(1);
        }
        expect(
          await shifts(page),
          `layout shift of the load: ${await shiftSources(page)}`,
        ).toBeLessThanOrEqual(0.02);
        expect(await announcements(page)).toBe(0);
        await shoot(page, `${tab.name}-loaded-${size.width}`);
      });
    }
  });
}

test.describe('skeleton motion', () => {
  for (const tab of TABS) {
    test(`${tab.name}: the pulse runs, and stops with prefers-reduced-motion`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const animation = () =>
        page
          .locator(`${tab.panel} mf-dash-skeleton .bone, ${tab.panel} mf-dash-skeleton .frame`)
          .first()
          .evaluate((el) => getComputedStyle(el).animationName);

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      let release = await hold(page);
      await page.goto(tab.url);
      await expect(page.locator(`${tab.panel} mf-dash-skeleton`).first()).toBeVisible({
        timeout: 20_000,
      });
      expect(await animation()).toContain('pulse');
      release();
      await expect(page.locator(tab.ready).first()).toBeVisible({
        timeout: tab.name === 'coverage' ? 120_000 : 30_000,
      });

      await page.unroute('**/api/v1/dashboard**');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      release = await hold(page);
      await page.goto(tab.url);
      await expect(page.locator(`${tab.panel} mf-dash-skeleton`).first()).toBeVisible({
        timeout: 20_000,
      });
      expect(await animation()).toBe('none');
      release();
    });
  }
});

test.describe('skeleton of the Summary lists', () => {
  test('the three lists read their rows after the figures: five silhouette rows each, one status, the same height as the loaded lists', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await observeShifts(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/task-queue?**', async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto('/dashboard?tab=summary');
    const lists = page.locator('[data-list-loading]');
    await expect(lists).toHaveCount(3, { timeout: 30_000 });
    for (const list of await lists.all()) {
      await expect(list.locator('.bone')).toHaveCount(5);
    }
    expect(await announcements(page), 'one Loading status for the three lists').toBe(1);
    await expect(page.locator('[data-lists]')).toHaveAttribute('aria-busy', 'true');
    const heights = async () =>
      page
        .locator('[data-lists] [data-panel]')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    const before = await heights();
    await shoot(page, 'summary-lists-skeleton-1920');
    release();
    await expect(page.locator('[data-panel="overdue"] li').first()).toBeVisible();
    await expect(lists).toHaveCount(0);
    const after = await heights();
    expect(after.length).toBe(before.length);
    after.forEach((h, i) =>
      expect(Math.abs(h - before[i]), `list ${i}: ${before} -> ${after}`).toBeLessThanOrEqual(1),
    );
    expect(await shifts(page), `shift: ${await shiftSources(page)}`).toBeLessThanOrEqual(0.02);
  });
});

test.describe('skeleton refresh', () => {
  test('a manual Refresh with figures on screen shows no silhouette', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/dashboard?tab=summary');
    await expect(page.locator('[data-panel="overdue"] li').first()).toBeVisible({
      timeout: 30_000,
    });
    const release = await hold(page);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForTimeout(500);
    await expect(page.locator('mf-dash-skeleton')).toHaveCount(0);
    await expect(page.locator('[data-panel="overdue"] li').first()).toBeVisible();
    release();
  });
});
