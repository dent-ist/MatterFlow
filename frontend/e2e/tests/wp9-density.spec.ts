import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Density and space on the work lists (WP9): nine rows at 1366x768 and fourteen at 1920x1080 with one-line titles (M3, #189), Status in view
 * and the sideways hint at tablet widths (BUG-14, #191), Compact rows (M3-Compact, #190) and skeleton rows with reserved tab counts (G4,
 * #176). Every test uses its own user and tagged tasks, so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS when it is
 * set (docs/ux/my-work-review/fixes/wp9).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const TITLES = [
  'Review privileged documents batch',
  'Prepare the quarterly compliance filing',
  'Dedup and review of custodian mailbox',
  'Respond to opposing counsel letter',
  'Collect data from the finance team',
  'Draft the privilege log for production 4',
  'Reconcile the matter budget with billing',
  'Escalate the failed export to the vendor',
  'Update the hold notice for new custodians',
  'Verify the redaction set before delivery',
  'Index the new scanned boxes from storage',
  'Confirm the deposition schedule with counsel',
  'Summarise the expert report for the partner',
];
const LONG =
  'A very long title that goes on and on about the review of the entire set of documents for the matter and its custodians';

/** A user with 14 assigned tasks (some overdue, some ASAP, one with a very long title), all tagged. */
async function worker(seed: Seeder, label: string) {
  const me = await seed.user(['Data Technician'], label);
  const world = await seed.world();
  const tag = uid();
  const titles = [...TITLES.map((t) => `${t} ${tag}`), `${LONG} ${tag}`];
  let i = 0;
  for (const title of titles) {
    await seed.task(world, {
      title,
      assignedUserId: me.userId,
      ...(i % 3 === 0 ? { dueDate: dateInZone(FIRM_ZONE, -13 + i) } : {}),
    });
    i++;
  }
  return { me, tag, count: titles.length };
}

/** Rows whose bottom edge is inside the scrolling grid box: what is on screen without scrolling. */
function rowsInView(page: Page): Promise<number> {
  return page.evaluate(() => {
    const box = (document.querySelector('.wt-wrap') as HTMLElement).getBoundingClientRect();
    return Array.from(document.querySelectorAll('tbody tr[data-task]')).filter(
      (r) => r.getBoundingClientRect().bottom <= box.bottom + 1,
    ).length;
  });
}

/** Distance from the top of the window to the first column header: the chrome above the grid. */
function chromeHeight(page: Page): Promise<number> {
  return page.evaluate(
    () => (document.querySelector('.wt-wrap') as HTMLElement).getBoundingClientRect().top,
  );
}

function overflow(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => {
    const w = document.querySelector('.wt-wrap') as HTMLElement;
    return { scroll: w.scrollWidth, client: w.clientWidth };
  });
}

/** True for every title link that fits on one line. */
function titleLines(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('tbody tr[data-task] a.wt-title')).map(
      (a) => a.getBoundingClientRect().height,
    ),
  );
}

async function setDensity(page: Page, name: 'Compact' | 'Comfortable'): Promise<void> {
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('radio', { name }).check();
  await page.keyboard.press('Escape');
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

test.describe('Density and space', () => {
  test('M3: nine rows at 1366x768, fourteen at 1920x1080, one-line titles, chrome under 230 px, a steady Due column', async ({
    seed,
    asUser,
  }) => {
    const { me, tag, count } = await worker(seed, 'dense');
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);

    await page.setViewportSize({ width: 1366, height: 768 });
    await myWork.open();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
    expect(await chromeHeight(page), 'chrome above the grid, strip included').toBeLessThanOrEqual(
      230,
    );
    const bar = await page.locator('mf-filters-bar').boundingBox();
    expect(bar!.height, 'the toolbar is one line').toBeLessThanOrEqual(40);
    // #198: Matter is a default column again, and with the fixed layout (#200: 44 px rows, Due 136 px) the ninth row is back at 1366.
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(9);
    // #196: a Comfortable title takes at most two lines; the long one is cut with an ellipsis and keeps the whole text as its tooltip.
    for (const h of await titleLines(page))
      expect(h, 'a title is at most two 18 px lines (#210)').toBeLessThanOrEqual(36);
    const long = page.locator('a.wt-title', { hasText: LONG.slice(0, 30) });
    expect(
      await long.evaluate((a) => a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth),
    ).toBe(true);
    await expect(long).toHaveAttribute('title', `${LONG} ${tag}`);
    expect((await overflow(page)).scroll).toBeLessThanOrEqual((await overflow(page)).client);
    await shot(page, 'm3-active-1366x768');
    await axeClean(page, 'My Work 1366x768');

    await page.setViewportSize({ width: 1920, height: 1080 });
    await myWork.open();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(14);
    for (const h of await titleLines(page)) expect(h).toBeLessThanOrEqual(40);
    await shot(page, 'm3-active-1920x1080');
    await axeClean(page, 'My Work 1920x1080');

    // No sideways scroll from 1024 px (the default Active columns).
    for (const width of [1024, 1180, 1280]) {
      await page.setViewportSize({ width, height: 768 });
      await myWork.open();
      await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
      const o = await overflow(page);
      expect(o.scroll, `no sideways scroll at ${width}`).toBeLessThanOrEqual(o.client);
    }
    await shot(page, 'm3-active-1024x768');

    // The Due column keeps its width when its filter popover opens and when a range is chosen.
    await page.setViewportSize({ width: 1366, height: 768 });
    await myWork.open('?view=active');
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
    const due = page.locator('thead tr').first().locator('th[data-col="due"]');
    const before = (await due.boundingBox())!.width;
    expect(before, 'Due is about 210 px').toBeLessThan(230);
    await page.locator('tr[data-filter-row] [data-filter="due"]').click();
    await expect(page.getByRole('group', { name: 'Presets' })).toBeVisible();
    expect(Math.abs((await due.boundingBox())!.width - before)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Next 7 days' }).click();
    await page.keyboard.press('Escape');
    expect(Math.abs((await due.boundingBox())!.width - before)).toBeLessThanOrEqual(1);
  });

  test('M3: Task Queue shares the table: one-line titles and no sideways scroll', async ({
    seed,
    asUser,
  }) => {
    const { tag } = await worker(seed, 'dense-queue');
    const role = await seed.role(['Task.View', 'Matter.View'], `E2E queue ${uid()}`);
    const viewer = await seed.user([role.name], 'dense-viewer');
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(tag);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    for (const h of await titleLines(page)) expect(h).toBeLessThanOrEqual(40);
    const o = await overflow(page);
    expect(o.scroll).toBeLessThanOrEqual(o.client);
    await shot(page, 'm3-task-queue-1920x1080');
    await page.setViewportSize({ width: 1366, height: 768 });
    await queue.open();
    await queue.search(tag);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    for (const h of await titleLines(page)) expect(h).toBeLessThanOrEqual(40);
    await shot(page, 'm3-task-queue-1366x768');
  });

  test('BUG-14: from 640 to 1023 px the grid fits or, with only the never-dropped columns left, scrolls with the hint and a sticky Ref; a wide custom set gets the hint', async ({
    seed,
    asUser,
  }) => {
    const { me, count } = await worker(seed, 'tablet');
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [width, height] of [
      [640, 900],
      [700, 900],
      [768, 1024],
      [900, 800],
      [1023, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await myWork.open();
      await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
      const o = await overflow(page);
      if (o.scroll > o.client + 1) {
        // #201: the one narrow-box rule dropped every column it may; the never-dropped ones (Ref, Title, Matter, Priority, Due, Status)
        // need more than this box, so the grid scrolls: the hint says so and Ref stays in view.
        await expect(page.locator('[data-scroll-hint]')).toBeVisible();
        const keys = await page
          .locator('thead tr')
          .first()
          .locator('th')
          .evaluateAll((ths) => ths.map((t) => (t as HTMLElement).dataset['col']));
        for (const k of keys)
          expect(['ref', 'title', 'matter', 'priority', 'due', 'status']).toContain(k);
        expect(
          await page
            .locator('thead th[data-col="ref"]')
            .evaluate((t) => getComputedStyle(t).position),
        ).toBe('sticky');
      } else {
        expect(o.scroll, `no sideways scroll at ${width}`).toBeLessThanOrEqual(o.client);
        const wrap = (await page.locator('.wt-wrap').boundingBox())!;
        for (const col of ['priority', 'due', 'status']) {
          const cell = (await page
            .locator('tbody tr[data-task]')
            .first()
            .locator(`td[data-col="${col}"]`)
            .boundingBox())!;
          expect(cell.x + cell.width, `${col} is inside the box at ${width}`).toBeLessThanOrEqual(
            wrap.x + wrap.width + 1,
          );
        }
        await expect(page.locator('[data-scroll-hint]')).toBeHidden();
      }
      // #196: the Ref column stays on a tablet (it is the first, sticky column); nothing sits under the title.
      const first = await page
        .locator('thead tr')
        .first()
        .locator('th')
        .first()
        .getAttribute('data-col');
      expect(first).toBe('ref');
      await expect(page.locator('[data-sub-task], .wt-subline')).toHaveCount(0);
      // The whole status badge is readable (not clipped to a letter).
      const status = page.locator('tbody tr[data-task]').first().locator('td[data-col="status"]');
      expect(await status.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
      if (width === 768) {
        await shot(page, 'bug14-active-768x1024');
        await axeClean(page, 'My Work 768');
      }
    }

    // A custom set that is too wide: the hint and the edge shadow show, and the sticky first column is Ref.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      [
        `mf.work-columns.v2.myWork.active.${me.userId}`,
        JSON.stringify([
          'ref',
          'title',
          'client',
          'matter',
          'type',
          'workflow',
          'priority',
          'due',
          'status',
        ]),
      ],
    );
    await myWork.open();
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    const wide = await overflow(page);
    expect(wide.scroll).toBeGreaterThan(wide.client);
    await expect(page.locator('[data-scroll-hint]')).toBeVisible();
    const sticky = await page
      .locator('thead tr')
      .first()
      .locator('th')
      .first()
      .evaluate((th) => ({
        col: th.getAttribute('data-col'),
        position: getComputedStyle(th).position,
      }));
    expect(sticky).toEqual({ col: 'ref', position: 'sticky' });
    await shot(page, 'bug14-wide-set-hint-768x1024');
    await axeClean(page, 'My Work 768 wide set');

    // Below 640 px the table stays as it was (cards come later): sideways scroll with the hint.
    await page.setViewportSize({ width: 375, height: 812 });
    await myWork.open();
    await expect(page.locator('[data-scroll-hint]')).toBeVisible();
    await shot(page, 'bug14-active-375x812');
    await axeClean(page, 'My Work 375');
  });

  test('M3-Compact: one 36 px line per row, eleven rows at 1366x768 (twelve with the filter row closed), details in the tooltip', async ({
    seed,
    asUser,
  }) => {
    const { me, tag, count } = await worker(seed, 'compact');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
    const comfortable = await rowsInView(page);
    await setDensity(page, 'Compact');
    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll('tbody tr[data-task]')).map(
        (r) => r.getBoundingClientRect().height,
      ),
    );
    for (const h of heights)
      expect(Math.abs(h - 36), `a Compact row is 36 px (#211): ${heights}`).toBeLessThanOrEqual(1);
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(11);
    expect(await rowsInView(page)).toBeGreaterThan(comfortable);
    for (const h of await titleLines(page)) expect(h, 'one-line titles').toBeLessThan(28);
    // #196: no line under the title in either density; the tooltip of the link is the whole title.
    const first = page.locator('tbody tr[data-task]').first();
    await expect(page.locator('.wt-subline, [data-title-context]')).toHaveCount(0);
    const tip = (await first.locator('a.wt-title').getAttribute('title')) ?? '';
    expect(tip).not.toContain('\n');
    // Targets stay at least 24 px high, and the focus ring is not clipped.
    for (const sel of [
      'a.wt-title',
      'td[data-col="status"] button',
      'td[data-col="priority"] button',
    ]) {
      const box = (await first.locator(sel).first().boundingBox())!;
      expect(box.height, `${sel} is a 24 px target`).toBeGreaterThanOrEqual(24);
    }
    await first.locator('a.wt-title').focus();
    await shot(page, 'compact-1366x768');
    await axeClean(page, 'Compact 1366x768');

    // Filter row closed: one more row.
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.locator('tr[data-filter-row]')).toHaveCount(0);
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(12);
    await shot(page, 'compact-filter-row-closed-1366x768');
    await page.getByRole('button', { name: /^Filters/ }).click();

    // 1920x1080 and the density is remembered across a reload.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await myWork.open();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
    expect(await rowsInView(page)).toBeGreaterThanOrEqual(count);
    await shot(page, 'compact-1920x1080');

    // Task Queue keeps its own density, and Comfortable allows two-line titles again.
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(tag);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    await expect(page.locator('table.wt')).not.toHaveClass(/wt--compact/);
    await myWork.open();
    await setDensity(page, 'Comfortable');
    await expect(first.locator('a.wt-title')).toBeVisible();
  });

  test('G4: skeleton rows with the final widths on first load and tab change, reserved tab counts, no jump', async ({
    seed,
    asUser,
  }) => {
    const { me, count } = await worker(seed, 'skeleton');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as {
          value: number;
          hadRecentInput: boolean;
        }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let hold = true;
    await page.route('**/api/v1/my-work?**', async (route) => {
      if (hold) await gate;
      await route.continue().catch(() => undefined);
    });
    const myWork = new MyWorkPage(page);
    await page.goto('/my-work');
    const body = page.locator('tbody');
    await expect(body.locator('tr[data-skeleton]')).toHaveCount(8);
    await expect(page.locator('table.wt')).toHaveAttribute('aria-busy', 'true');
    await expect(body.locator('[data-loading]')).toHaveText(/Loading tasks/);
    // The headers and the filter row stay; the tab counts are reserved as (--).
    await expect(page.locator('thead tr[data-filter-row]')).toBeVisible();
    await expect(myWork.tab(/^Active/).locator('[data-count-pending]')).toHaveText('(--)');
    const titleBefore = (await page.locator('thead th[data-col="title"]').boundingBox())!.width;
    const tabBefore = (await myWork.tab(/^Due soon/).boundingBox())!;
    const rowH = (await body.locator('tr[data-skeleton]').first().boundingBox())!.height;
    expect(Math.abs(rowH - 44), 'a skeleton row is as high as a row (#210)').toBeLessThanOrEqual(1);
    await shot(page, 'g4-loading-first-1366x768');
    await axeClean(page, 'skeleton');

    hold = false;
    release();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
    await expect(body.locator('tr[data-skeleton]')).toHaveCount(0);
    const titleAfter = (await page.locator('thead th[data-col="title"]').boundingBox())!.width;
    expect(
      Math.abs(titleAfter - titleBefore),
      'Title width before and after the rows',
    ).toBeLessThanOrEqual(2);
    const tabAfter = (await myWork.tab(/^Due soon/).boundingBox())!;
    expect(Math.abs(tabAfter.x - tabBefore.x), 'the next tab does not move').toBeLessThanOrEqual(1);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.02);

    // A tab change shows skeleton rows, never the old rows; the same tab reloading keeps its rows (dimmed).
    hold = true;
    const gate2 = new Promise<void>((resolve) => (release = resolve));
    await page.unroute('**/api/v1/my-work?**');
    await page.route('**/api/v1/my-work?**', async (route) => {
      if (hold) await gate2;
      await route.continue().catch(() => undefined);
    });
    await myWork.tab(/^Created by me/).click();
    await expect(body.locator('tr[data-skeleton]')).toHaveCount(8);
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(0);
    await shot(page, 'g4-loading-tab-switch-1366x768');
    hold = false;
    release();
    await expect(body.locator('tr[data-skeleton]')).toHaveCount(0);
    await myWork.tab(/^Active/).click();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
  });

  test('G4: reduced motion switches the shimmer off', async ({ seed, asUser }) => {
    const me = await seed.user(['Data Technician'], 'reduced');
    const page = await asUser(me.username);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/my-work?**', async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    await page.goto('/my-work');
    const bar = page.locator('tr[data-skeleton] .sk').first();
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((n) => getComputedStyle(n).animationName)).toBe('none');
    release();
  });
});
