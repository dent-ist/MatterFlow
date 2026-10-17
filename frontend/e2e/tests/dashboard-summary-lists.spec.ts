import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';
import { assignToMeFromRow } from '../support/summary-lists';

/**
 * Dashboard Summary lists (review 2, WP5: S1 one-line rows and first screen, S4 Due soon wording, S5 captions at 375, S6 toast position,
 * S7 row content, S8 section names). Boxes are measured, not eyeballed.
 * With E2E_SCREENSHOTS set to a folder the run also writes the screenshots of docs/ux/dashboard-review-2/fixes/wp5.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function seedLists(seed: import('../support/seed').Seeder) {
  const world = await seed.world();
  const tag = uid();
  for (let i = 0; i < 6; i++) {
    await seed.task(world, {
      title: `Overdue sample ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, -(2 + i)),
    });
    await seed.task(world, {
      title: `Due soon sample ${i + 1} ${tag}`,
      dueDate: dateInZone(FIRM_ZONE, i % 3),
    });
    await seed.task(world, { title: `Unassigned sample ${i + 1} ${tag}` });
  }
  return world;
}

async function openSummary(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/dashboard');
  for (const kind of ['unassigned', 'overdue', 'dueSoon'])
    await expect(page.locator(`[data-panel="${kind}"] li`).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

async function shoot(page: Page, name: string, fullPage = false) {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

test.describe('dashboard summary lists', () => {
  test.beforeAll(async ({ seed }) => {
    await seedLists(seed);
  });

  for (const { w, h, rows } of [
    { w: 1366, h: 768, rows: 3 },
    { w: 1920, h: 1080, rows: 5 },
  ]) {
    test(`${w}x${h}: the three headings and ${rows} one-line rows of each list are in the first screen (S1, S7, S8)`, async ({
      page,
    }) => {
      await openSummary(page, w, h);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const names: Record<string, string> = {
        unassigned: 'Unassigned',
        overdue: 'Overdue',
        dueSoon: 'Due soon',
      };
      for (const kind of Object.keys(names)) {
        const panel = page.locator(`[data-panel="${kind}"]`);
        await expect(panel.getByRole('heading', { level: 3 })).toHaveText(names[kind]);
        const heading = (await panel.locator('h3').boundingBox())!;
        expect(heading.y + heading.height, `${kind} heading`).toBeLessThanOrEqual(h);
        const items = panel.locator('li');
        expect(await items.count()).toBeLessThanOrEqual(5);
        expect(await items.count()).toBeGreaterThanOrEqual(rows);
        for (let i = 0; i < rows; i++) {
          const li = (await items.nth(i).boundingBox())!;
          expect(li.y + li.height, `${kind} row ${i + 1} bottom`).toBeLessThanOrEqual(h);
          // One line: 44 px (plus the 1px divider), down to the 32 px floor where the panel is short.
          expect(li.height, `${kind} row ${i + 1} height`).toBeGreaterThanOrEqual(32);
          expect(li.height, `${kind} row ${i + 1} height`).toBeLessThanOrEqual(46);
          // Everything of the row sits inside it: nothing wrapped under it or out of it.
          const inside = await items.nth(i).evaluate((el) => {
            const box = el.getBoundingClientRect();
            return Array.from(el.querySelectorAll('a, button, [data-type], [data-client]'))
              .filter((n) => (n as HTMLElement).offsetParent !== null)
              .every((n) => {
                const r = n.getBoundingClientRect();
                return (
                  r.right <= box.right + 1 && r.bottom <= box.bottom + 1 && r.top >= box.top - 1
                );
              });
          });
          expect(inside, `${kind} row ${i + 1} contents`).toBe(true);
        }
      }
      // No old section names anywhere (S8).
      await expect(page.getByText('Tasks to act on')).toHaveCount(0);
      await expect(page.getByText('Deadlines')).toHaveCount(0);
      // Row content (S7): type icon with the name, client, due chip; "Assign to..." instead of "Unassigned" on every row (just "Assign" since the owner's feedback on the lists).
      const first = page.locator('[data-panel="unassigned"] li').first();
      await expect(first.locator('[data-type]')).toHaveAttribute('aria-label', /.+/);
      await expect(first.locator('[data-client]')).not.toBeEmpty();
      await expect(first.locator('mf-row-edit [data-inline-trigger]')).toHaveText('Assign');
      await expect(first.getByRole('button', { name: /^Assign TSK-\d+$/ })).toBeVisible();
      // "Assign to me" is not a link of its own any more: it is the first choice of the menu.
      await expect(first.locator('[data-assign-me]')).toHaveCount(0);
      await expect(first.getByText('Assign to me')).toHaveCount(0);
      await expect(
        page
          .locator('[data-panel="unassigned"] mf-row-edit')
          .getByText('Unassigned', { exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('[data-panel="overdue"] li').first()).toContainText(/Overdue \d+d/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await shoot(page, `after-summary-${w}`);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${w}`).toEqual([]);
    });
  }

  for (const { w, h } of [
    { w: 1920, h: 1080 },
    { w: 2560, h: 1440 },
  ]) {
    test(`${w}x${h}: the three lists fit their rows exactly, with no vertical and no horizontal scrollbar (owner feedback on #101, #106, #107)`, async ({
      page,
    }) => {
      await openSummary(page, w, h);
      for (const kind of ['unassigned', 'overdue', 'dueSoon']) {
        const panel = page.locator(`[data-panel="${kind}"]`);
        // Data is present: five rows (the seed above tags six per list), so the fit is measured with full lists.
        await expect(panel.locator('li')).toHaveCount(5);
        for (const sel of ['[data-rows]', 'ul']) {
          const m = await panel
            .locator(sel)
            .first()
            .evaluate((el) => ({
              sh: el.scrollHeight,
              ch: el.clientHeight,
              sw: el.scrollWidth,
              cw: el.clientWidth,
            }));
          expect(m.sh, `${kind} ${sel} vertical scroll`).toBeLessThanOrEqual(m.ch);
          expect(m.sw, `${kind} ${sel} horizontal scroll`).toBeLessThanOrEqual(m.cw);
        }
        // The last row ends inside the panel and rows keep the 32 px floor.
        const box = (await panel.boundingBox())!;
        const last = (await panel.locator('li').last().boundingBox())!;
        expect(last.y + last.height, `${kind} last row inside`).toBeLessThanOrEqual(
          box.y + box.height,
        );
        for (const li of await panel.locator('li').all()) {
          expect((await li.boundingBox())!.height).toBeGreaterThanOrEqual(31.5);
        }
      }
      await shoot(page, `after-summary-${w}-fit`);
      if (axeAvailable()) expect(await axeViolations(page), `axe fit ${w}`).toEqual([]);
    });
  }

  test('1366x768: a window too short for the 32 px rows still scrolls inside the panel (region, heading pinned)', async ({
    page,
  }) => {
    await openSummary(page, 1366, 768);
    let scrolls = 0;
    for (const kind of ['unassigned', 'overdue', 'dueSoon']) {
      const rows = page.locator(`[data-panel="${kind}"] [data-rows]`);
      await expect(rows).toHaveAttribute('role', 'region');
      const m = await rows.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
      if (m.sh > m.ch + 1) scrolls++;
      // No horizontal scrollbar even here.
      expect(await rows.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(scrolls).toBeGreaterThan(0);
    await shoot(page, 'after-summary-1366-scroll');
  });

  test('the three lists share one column order and grid: the Assign menu sits before the client in Unassigned, and the client, priority and due columns line up', async ({
    page,
  }) => {
    await openSummary(page, 1920, 1080);
    const xs = async (kind: string) =>
      page
        .locator(`[data-panel="${kind}"] li`)
        .first()
        .evaluate((li) => {
          const left = (sel: string) => {
            const n = li.querySelector(sel);
            return n ? Math.round(n.getBoundingClientRect().left) : null;
          };
          return {
            ref: left('.ref'),
            type: left('[data-type]'),
            title: left('.title'),
            assign: left('.assign'),
            client: left('[data-client]'),
            prio: left('mf-priority-badge'),
            when: left('.when'),
          };
        });
    const [u, o, d] = [await xs('unassigned'), await xs('overdue'), await xs('dueSoon')];
    // Order: ref, type, title, [assign], client, priority, due/age.
    expect(u.ref!).toBeLessThan(u.type!);
    expect(u.type!).toBeLessThan(u.title!);
    expect(u.title!).toBeLessThan(u.assign!);
    expect(u.assign!).toBeLessThan(u.client!);
    expect(u.client!).toBeLessThan(u.prio!);
    expect(u.prio!).toBeLessThan(u.when!);
    expect(o.assign).toBeNull();
    // Same x positions for the shared columns.
    expect(o.ref).toBe(u.ref);
    expect(o.type).toBe(u.type);
    expect(o.title).toBe(u.title);
    expect(o.client).toBe(u.client);
    expect(o.prio).toBe(u.prio);
    expect(o.when).toBe(u.when);
    expect(d).toEqual(o);
    // The title does not collide with the Assign menu or the client.
    const gap = await page
      .locator('[data-panel="unassigned"] li')
      .first()
      .evaluate((li) => {
        const title = li.querySelector('a.main')!.getBoundingClientRect();
        const assign = li.querySelector('.assign')!.getBoundingClientRect();
        return assign.left - title.right;
      });
    expect(gap).toBeGreaterThanOrEqual(8);
  });

  test('the Assign menu offers "Assign to me" first, above the search box and the people; Escape closes it and returns focus', async ({
    page,
  }) => {
    await openSummary(page, 1366, 768);
    const first = page.locator('[data-panel="unassigned"] li').first();
    const number = (await first.getAttribute('data-task'))!;
    const trigger = first.getByRole('button', { name: `Assign ${number}`, exact: true });
    await trigger.click();
    const pop = page.locator('.im-pop');
    const lead = pop.getByRole('button', { name: `Assign ${number} to me`, exact: true });
    await expect(lead).toBeVisible();
    await expect(pop.getByRole('textbox', { name: 'Search people' })).toBeVisible();
    const lb = (await lead.boundingBox())!;
    const sb = (await pop.getByRole('textbox', { name: 'Search people' }).boundingBox())!;
    expect(lb.y + lb.height).toBeLessThanOrEqual(sb.y);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  for (const { w, h } of [
    { w: 1024, h: 768 },
    { w: 768, h: 1024 },
  ]) {
    test(`${w}x${h}: the stacked lists keep the grid and show no horizontal scroll`, async ({
      page,
    }) => {
      await openSummary(page, w, h);
      for (const kind of ['unassigned', 'overdue', 'dueSoon']) {
        const rows = page.locator(`[data-panel="${kind}"] [data-rows]`);
        expect(await rows.evaluate((el) => el.scrollWidth <= el.clientWidth), kind).toBe(true);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await shoot(page, `after-summary-${w}`);
      if (axeAvailable()) expect(await axeViolations(page), `axe ${w}`).toEqual([]);
    });
  }

  test('target size: row links and buttons are at least 24px high (WCAG 2.5.8)', async ({
    page,
  }) => {
    await openSummary(page, 1366, 768);
    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '[data-panel] li a.main, [data-panel] li button, [data-panel] [data-view-all]',
        ),
      )
        .filter((n) => (n as HTMLElement).offsetParent !== null)
        .map((n) => ({
          text: n.textContent?.trim().slice(0, 30),
          h: n.getBoundingClientRect().height,
        }))
        .filter((n) => n.h < 23.5),
    );
    expect(small).toEqual([]);
  });

  for (const w of [320, 375, 480]) {
    test(`${w}px: tile captions are not cut and the page has no horizontal scroll (S5, S4)`, async ({
      page,
    }) => {
      await openSummary(page, w, 812);
      const cut = await page.evaluate(() =>
        Array.from(document.querySelectorAll('mf-stat-tile .caption, mf-stat-tile .label-text'))
          .filter((n) => n.scrollWidth > n.clientWidth + 1)
          .map((n) => n.textContent),
      );
      expect(cut).toEqual([]);
      const captions = await page.locator('mf-stat-tile .caption').allTextContents();
      expect(captions.map((c) => c.trim())).toEqual(
        expect.arrayContaining([
          'Excludes ASAP tasks',
          'Today and the next 2 days, not overdue, not ASAP',
          'No due date',
          'Waiting on client, custodian or internal',
        ]),
      );
      // Each caption is at most four lines at 480 and below: the Due soon wording of #151 ("not overdue, not ASAP") takes four lines in the two-column
      // tile grid beside the navigation rail, and wraps (never cut) as the Decision (PM) asks.
      const tall = await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('mf-stat-tile .caption')).filter((n) => {
            const lh = parseFloat(getComputedStyle(n).lineHeight) || 16;
            return n.getBoundingClientRect().height > lh * 4 + 1;
          }).length,
      );
      expect(tall).toBe(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      // Rows wrap to a title line and a meta line; the title is not cut below two lines.
      const row = page.locator('[data-panel="unassigned"] li').first();
      expect((await row.boundingBox())!.width).toBeLessThanOrEqual(w);
      if (w === 375) {
        await shoot(page, 'after-summary-375', true);
        if (axeAvailable()) expect(await axeViolations(page), 'axe 375').toEqual([]);
      }
      if (w === 320) await shoot(page, 'after-summary-320', true);
    });
  }

  test('the Due soon tile says "Today and the next 2 days" and counts what the queue counts (S4)', async ({
    page,
  }) => {
    await openSummary(page, 1366, 768);
    const tile = page.locator('mf-stat-tile', { hasText: 'Due soon' }).first();
    await expect(tile.locator('.caption')).toHaveText(
      'Today and the next 2 days, not overdue, not ASAP',
    );
    const hint = (await tile.locator('[data-hint]').textContent())!;
    const through = dateInZone(FIRM_ZONE, 2);
    const day = new Date(`${through}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    expect(hint).toContain(`through ${day}`);
    // The queue opens with the same filter and finds the same tasks. Other tests create tasks in parallel, so a read that raced with one is repeated.
    let counts: { tile: number; queue: number } = { tile: -1, queue: -2 };
    for (let attempt = 0; attempt < 4 && counts.tile !== counts.queue; attempt++) {
      await openSummary(page, 1366, 768);
      const value = page.locator('mf-stat-tile', { hasText: 'Due soon' }).first();
      const tileCount = Number((await value.locator('.value').textContent())!.trim());
      const queue = page.waitForResponse(
        (r) => r.url().includes('/api/v1/task-queue') && r.url().includes('dueTo='),
      );
      await value.getByRole('link').click();
      const body = (await (await queue).json()) as { total: number };
      counts = { tile: tileCount, queue: body.total };
    }
    await expect(page).toHaveURL(/dueTo=/);
    expect(counts.queue).toBe(counts.tile);
  });

  for (const { w, h } of [
    { w: 1366, h: 768 },
    { w: 1920, h: 1080 },
    { w: 375, h: 812 },
  ]) {
    test(`${w}x${h}: the Assign to me toast covers no control of any list row (S6)`, async ({
      page,
    }) => {
      await openSummary(page, w, h);
      const panel = page.locator('[data-panel="unassigned"]');
      const first = panel.locator('li').first();
      const number = (await first.getAttribute('data-task'))!;
      await assignToMeFromRow(first, number);
      const toast = page.locator('[data-undo-toast]');
      await expect(toast).toBeVisible();
      await expect(page.locator('[data-undo-message]')).toContainText(`${number} assigned to`);
      await page.waitForTimeout(300);
      const t = (await toast.boundingBox())!;
      // Bottom left of the main column from 1024px; the full width at the bottom below.
      if (w >= 1024) expect(t.x).toBeGreaterThanOrEqual(220);
      else {
        expect(t.x).toBeGreaterThanOrEqual(15);
        expect(t.x + t.width).toBeLessThanOrEqual(w - 15);
        expect(t.width).toBeGreaterThan(w - 40);
      }
      if (w >= 1024) {
        const hits = await page.evaluate(
          ({ t }) => {
            const overlaps = (r: DOMRect) =>
              r.left < t.x + t.width && r.right > t.x && r.top < t.y + t.height && r.bottom > t.y;
            return Array.from(document.querySelectorAll('[data-panel] li'))
              .flatMap((li) => Array.from(li.querySelectorAll('a, button, input, select')))
              .filter((n) => overlaps(n.getBoundingClientRect()))
              .map((n) => n.textContent?.trim());
          },
          { t },
        );
        expect(hits).toEqual([]);
      } else {
        // Full width at the bottom: the last row of the page can still be scrolled above the toast.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const last = (await page.locator('[data-panel="dueSoon"] li').last().boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(t.y);
      }
      await shoot(page, `after-toast-${w}`);
      if (axeAvailable()) expect(await axeViolations(page), `axe toast ${w}`).toEqual([]);
      // Undo puts the row back.
      await page.keyboard.press('Alt+z');
      await expect(panel.locator(`li[data-task="${number}"]`)).toHaveCount(1);
    });
  }
});
