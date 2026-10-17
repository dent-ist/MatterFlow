import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * "New" on My Work (WP8b, #179): the strip item, the filter (`new=1`, the instant goes to the API as `assignedFrom`), the dot in the Ref
 * cell and the pill. The visit start is written into the browser's storage before the app loads, so the test controls it; tasks are
 * tagged and belong to the test's own user, so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/my-work-review/fixes/wp8b).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

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

/** Writes the visit record once, before the app runs (a later navigation keeps what the app stored). */
async function startVisit(
  page: Page,
  userId: number,
  visitSince: number,
  lastActiveAt: number,
): Promise<void> {
  await page.addInitScript(
    ([key, record]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, record);
    },
    [`mf.my-work.visit.v2.${userId}`, JSON.stringify({ visitSince, lastActiveAt })] as const,
  );
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('My Work: New', () => {
  test('A5: New 3 in the strip, the filter lists exactly those 3 with a dot in Ref, Back keeps it, a new visit changes it', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'new');
    const world = await seed.world();
    const tag = uid();
    const make = (name: string) =>
      seed.task(world, { title: `${name} ${tag}`, assignedUserId: me.userId });
    await make('Old1');
    await make('Old2');
    await pause(1500);
    const visitSince = Date.now();
    await pause(1500);
    await make('Fresh1');
    await make('Fresh2');
    await make('Fresh3');

    const page = await asUser(me.username);
    await startVisit(page, me.userId, visitSince, Date.now() - 60_000);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();

    const strip = page.locator('[data-strip]');
    const item = page.locator('[data-strip-item="new"]');
    const rows = page.locator('tr[data-task]');
    await expect(rows).toHaveCount(5);
    await expect(item).toContainText('New 3');
    // After ASAP and On hold.
    expect((await strip.innerText()).replace(/\s+/g, ' ')).toMatch(/ASAP \d+ On hold \d+ New 3/);
    // The pill under the title and the dot in Ref, on the same three rows.
    await expect(page.locator('[data-new-marker]')).toHaveCount(3);
    await expect(page.locator('td[data-col="ref"] [data-new-dot]')).toHaveCount(3);
    await shot(page, 'new-all-1366x768');

    // The item applies the filter: exactly the 3 new rows; the address carries the flag, not the instant.
    await item.click();
    await expect(page).toHaveURL(/new=1/);
    await expect(page).not.toHaveURL(new RegExp(String(visitSince)));
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Fresh' })).toHaveCount(3);
    await expect(page.locator('td[data-col="ref"] [data-new-dot]')).toHaveCount(3);
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-chip="newSince"]')).toContainText('New since your last visit');
    await shot(page, 'new-filter-1366x768');

    // Open a task and go Back: still New 3 and the same three rows (the visit did not move).
    await rows.first().locator('a.wt-title').click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await page.goBack();
    await expect(item).toContainText('New 3');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('td[data-col="ref"] [data-new-dot]')).toHaveCount(3);

    // Removing the chip lists everything again; the second click on the item does the same.
    await page.locator('[data-chip="newSince"] button').click();
    await expect(rows).toHaveCount(5);
    await item.click();
    await expect(rows).toHaveCount(3);
    await item.click();
    await expect(rows).toHaveCount(5);
    await expect(page).not.toHaveURL(/new=1/);

    // A new visit (more than 30 minutes without activity) starts at the previous activity: the count follows it (all 5 were assigned since).
    const key = `mf.my-work.visit.v2.${me.userId}`;
    const lastActiveAt = Date.now() - 31 * 60_000;
    await page.evaluate(
      ([k, since, at]) =>
        window.localStorage.setItem(k, JSON.stringify({ visitSince: since, lastActiveAt: at })),
      [key, visitSince, lastActiveAt] as const,
    );
    await page.reload();
    await expect(rows).toHaveCount(5);
    await expect(item).toContainText('New 5');
    await expect(page.locator('[data-new-dot]')).toHaveCount(5);
    const stored = JSON.parse((await page.evaluate((k) => window.localStorage.getItem(k), key))!);
    expect(stored.visitSince).toBe(lastActiveAt);
  });

  test('A5: a first visit hides the item and the markers', async ({ seed, asUser }) => {
    const me = await seed.user(['Data Technician'], 'new-first');
    const world = await seed.world();
    await seed.task(world, { title: `First ${uid()}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(page.locator('[data-strip-item="overdue"]')).toBeVisible();
    await expect(page.locator('tr[data-task]')).toHaveCount(1);
    await expect(page.locator('[data-strip-item="new"]')).toHaveCount(0);
    await expect(page.locator('[data-new-dot]')).toHaveCount(0);
  });

  test('A5: sizes, axe and no horizontal scroll with the New item and the dots', async ({
    seed,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    const me = await seed.user(['Data Technician'], 'new-sizes');
    const world = await seed.world();
    const visitSince = Date.now() - 20_000;
    await pause(1200);
    for (const n of [1, 2, 3])
      await seed.task(world, {
        title: `Sized ${n} with a rather long title that keeps going ${uid()}`,
        assignedUserId: me.userId,
      });
    const page = await asUser(me.username);
    await startVisit(page, me.userId, visitSince, Date.now() - 60_000);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      // A plain visit would reopen the last view (New on); name the tab so each size starts unfiltered.
      await myWork.open('?view=active');
      await expect(page.locator('[data-strip-item="new"]')).toContainText('New 3');
      await expect(page.locator('[data-new-dot]')).toHaveCount(3);
      await expect(page.locator('tbody')).not.toContainText('Loading');
      expect(await axeViolations(page), `axe at ${w}`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
        `no horizontal page scroll at ${w}`,
      ).toBe(false);
      if (w === 375) {
        const heights = await page
          .locator('[data-strip-item]')
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('[data-new-dot]').first()).toBeVisible();
      }
      await page.locator('[data-strip-item="new"]').click();
      await expect(page).toHaveURL(/new=1/);
      await expect(page.locator('tr[data-task]')).toHaveCount(3);
      expect(await axeViolations(page), `axe filtered at ${w}`).toEqual([]);
      await shot(page, `new-${w}x${h}`);
    }
  });
});
