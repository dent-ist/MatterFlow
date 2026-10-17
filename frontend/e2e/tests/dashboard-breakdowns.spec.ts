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
      'Status',
      'Task type',
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
      const expected = wide >= 1300 ? 3 : wide >= 700 ? 2 : 1;
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
      // (The Task type card of the wide layout is as tall as the tab and scrolls its list inside; it is checked in its own test.)
      for (const [i, gap] of gaps.entries()) {
        if (wide >= 1300 && i === 2) continue;
        expect(gap, `${width}px`).toBeLessThanOrEqual(40);
      }

      // Tab order = reading order: Priority, Status, Task type, Age.
      const order = await grid.evaluate((g) => {
        const focusables = Array.from(g.querySelectorAll<HTMLElement>('a[href], button')).filter(
          (e) => e.tabIndex >= 0,
        );
        return focusables.map(
          (e) => e.closest('mf-bar-list, mf-stacked-bar')!.querySelector('h3')!.textContent,
        );
      });
      const firstSeen = [...new Set(order)];
      expect(firstSeen).toEqual(['Priority', 'Status', 'Task type', 'Age']);
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
    // Bars -> pie -> table.
    await priority.getByRole('button', { name: /View as pie/ }).click();
    await priority.getByRole('button', { name: /View as table/ }).click();
    await expect(priority.locator('thead th')).toHaveText([
      'Priority',
      'Tasks',
      'Overdue',
      'Share',
    ]);
    await expect(priority.locator('tbody .marker')).not.toHaveCount(0);
  });

  test('axe is clean at 1366, 1920, 768 and 375 (bars, pie and table views)', async ({ page }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(240_000);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      const section = await openBreakdowns(page);
      expect(await axeViolations(page), `${width} bars`).toEqual([]);
      for (const toggle of await section.locator('.toggle').all()) await toggle.click();
      await expect(section.locator('[data-pie]')).toHaveCount(4);
      expect(await axeViolations(page), `${width} pies`).toEqual([]);
      for (const toggle of await section.locator('.toggle').all()) await toggle.click();
      await expect(section.locator('table')).toHaveCount(4);
      expect(await axeViolations(page), `${width} tables`).toEqual([]);
      // Back to bars (the choice is remembered per card).
      for (const toggle of await section.locator('.toggle').all()) await toggle.click();
      await expect(section.locator('.bars, .stack')).toHaveCount(4);
    }
  });

  test('wide layout: Priority above Status in the left column, Task type in the middle, Age on the right, equal widths', async ({
    page,
  }) => {
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      const section = await openBreakdowns(page);
      const box = async (name: string) =>
        (await section
          .locator('mf-bar-list, mf-stacked-bar')
          .filter({ has: page.getByRole('heading', { name, exact: true }) })
          .boundingBox())!;
      const [priority, status, type, age] = [
        await box('Priority'),
        await box('Status'),
        await box('Task type'),
        await box('Age'),
      ];
      expect(Math.abs(priority.x - status.x), `${width} same column`).toBeLessThan(2);
      expect(status.y, `${width} Priority above Status`).toBeGreaterThan(
        priority.y + priority.height - 1,
      );
      expect(type.x).toBeGreaterThan(priority.x + priority.width - 1);
      const tab = (await section.locator('[data-grid="breakdowns"]').boundingBox())!.width;
      if (tab >= 1300) {
        // Three equal columns.
        expect(age.x, `${width} Age in the third column`).toBeGreaterThan(type.x + type.width - 1);
        expect(Math.abs(priority.width - type.width), `${width} equal columns`).toBeLessThan(3);
        expect(Math.abs(type.width - age.width)).toBeLessThan(3);
      } else {
        // The tab is narrower than 1300 px (a 1366 px window has a 1122 px tab): two columns, Task type and Age on the right.
        expect(Math.abs(age.x - type.x), `${width} two columns`).toBeLessThan(2);
      }
      // The Task type card is as tall as the tab; its title stays and the list scrolls inside it when it is long.
      const body = section.locator('mf-bar-list').nth(2).locator('[data-bd-body]');
      const m = await body.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
      if (m.sh > m.ch + 1) {
        await expect(body).toHaveAttribute('tabindex', '0');
        const title = (await section.locator('mf-bar-list').nth(2).locator('h3').boundingBox())!;
        await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
        expect((await section.locator('mf-bar-list').nth(2).locator('h3').boundingBox())!.y).toBe(
          title.y,
        );
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  });

  test('a long Task type list scrolls inside its card at 1920 under a pinned title, the page does not', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Thirty task types: the summary the page reads is padded with copies of its first task type row.
    await page.route(/\/api\/v1\/dashboard\?/, async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      const first = json.byTaskType[0];
      if (first)
        json.byTaskType = Array.from({ length: 30 }, (_, i) => ({
          ...first,
          label: `Long list type ${i + 1} with a rather long descriptive name`,
          id: 90000 + i,
        }));
      await route.fulfill({ response, json });
    });
    const section = await openBreakdowns(page);
    const card = section.locator('mf-bar-list').nth(2);
    const body = card.locator('[data-bd-body]');
    await expect(card.locator('li')).toHaveCount(30);
    await expect(body).toHaveAttribute('role', 'region');
    await expect(body).toHaveAttribute('tabindex', '0');
    const m = await body.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    expect(m.sh).toBeGreaterThan(m.ch + 50);
    const title = (await card.locator('h3').boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    const tab = (await page.locator('[data-bd-scroll]').boundingBox())!;
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(tab.y + tab.height + 1);
    await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
    expect((await card.locator('h3').boundingBox())!.y).toBe(title.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      ),
    ).toBe(true);
    // A mouse press inside the list shows no ring.
    await body.click({ position: { x: 2, y: 2 }, force: true });
    expect(await body.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('none');
  });

  test('Task type names wrap to at most two lines at 1366 and numbers never wrap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const section = await openBreakdowns(page);
    const lines = await section
      .locator('mf-bar-list')
      .nth(2)
      .locator('.name')
      .evaluateAll((els) =>
        els.map((e) =>
          Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)),
        ),
      );
    expect(lines.length).toBeGreaterThan(0);
    for (const n of lines) expect(n).toBeLessThanOrEqual(2);
    const numbers = await section
      .locator('mf-bar-list .count, mf-bar-list .pct')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height < 24));
    expect(numbers.every(Boolean)).toBe(true);
  });

  test('the toggle walks table, bars, pie; the pie legend equals the bars and the queue links, and the choice is remembered', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `BD pie ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -2) });
    const section = await openBreakdowns(page);
    const priority = section.locator('mf-bar-list').first();
    const toggle = priority.locator('[data-view-toggle]');
    await expect(toggle).toHaveText(/View as pie/);
    const bars = await priority.locator('li').evaluateAll((lis) =>
      lis.map((li) => ({
        label: li.querySelector('.name')!.textContent!.trim(),
        count: Number(li.querySelector('.count')!.textContent),
        href: li.querySelector('a.rowlink')?.getAttribute('href') ?? null,
        od: li.querySelector('.od-text')?.getAttribute('href') ?? null,
      })),
    );
    await toggle.click();
    await expect(priority.locator('[data-pie]')).toBeVisible();
    await expect(toggle).toHaveText(/View as table/);
    const pie = await priority.locator('[data-pie-legend] li').evaluateAll((lis) =>
      lis.map((li) => ({
        label: li.querySelector('.name')!.textContent!.trim(),
        count: Number(li.querySelector('.count')!.textContent),
        href: li.querySelector('a.rowlink')?.getAttribute('href') ?? null,
        od: li.querySelector('.od-text')?.getAttribute('href') ?? null,
      })),
    );
    expect(pie).toEqual(bars);
    const total = bars.reduce((n, b) => n + b.count, 0);
    await expect(priority.locator('[data-pie-centre]')).toHaveText(String(total));
    await expect(priority.locator('svg[role="img"]')).toHaveAttribute(
      'aria-label',
      new RegExp(`${total} tasks`),
    );
    // The queue agrees with the first legend row.
    const first = bars.find((b) => b.count > 0 && b.href)!;
    const queue = await seed.admin.get<{ total: number }>(
      `/api/v1/task-queue?pageSize=1&${new URL(first.href!, 'http://x').searchParams.toString()}`,
    );
    expect(queue.total).toBe(first.count);
    // Remembered per card: reload keeps the pie on Priority and bars elsewhere.
    await page.reload();
    await expect(section.locator('mf-bar-list').first().locator('[data-pie]')).toBeVisible();
    await expect(section.locator('mf-bar-list').nth(1).locator('[data-pie]')).toHaveCount(0);
    expect(page.url()).not.toMatch(/pie|view/);
    await section.locator('mf-bar-list').first().locator('[data-view-toggle]').click();
    await expect(section.locator('mf-bar-list').first().locator('table')).toBeVisible();
    await expect(section.locator('mf-bar-list').first().locator('[data-view-toggle]')).toHaveText(
      /View as bars/,
    );
    await section.locator('mf-bar-list').first().locator('[data-view-toggle]').click();
    await expect(section.locator('mf-bar-list').first().locator('.bars')).toBeVisible();
  });

  test('a mouse press on the cards area shows no focus ring; the keyboard still does', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const section = await openBreakdowns(page);
    const region = page.getByRole('region', { name: 'Open task breakdowns, scrollable' });
    const outline = () => region.evaluate((e) => getComputedStyle(e).outlineStyle);
    await section.locator('[data-grid="breakdowns"]').click({ position: { x: 2, y: 2 } });
    await region.click({ position: { x: 5, y: 5 }, force: true });
    expect(await outline()).toBe('none');
    await region.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await region.evaluate((e) => (e as HTMLElement).blur());
    await region.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await outline()).toBe('solid');
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
      const section = await openBreakdowns(page);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS!, `bars-${width}.png`), fullPage: true });
      for (const view of ['pie', 'table']) {
        for (const t of await section.locator('[data-view-toggle]').all()) await t.click();
        await expect(section.locator(view === 'pie' ? '[data-pie]' : 'table')).toHaveCount(4);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS!, `${view}-${width}.png`), fullPage: true });
      }
      for (const t of await section.locator('[data-view-toggle]').all()) await t.click();
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    const section = await openBreakdowns(page);
    await page.addStyleTag({ content: 'html{filter:grayscale(1)}' });
    await section.screenshot({ path: path.join(SHOTS!, 'breakdowns-greyscale-1366.png') });
    await page.emulateMedia({ forcedColors: 'active' });
    await section.screenshot({ path: path.join(SHOTS!, 'breakdowns-forced-colors-1366.png') });
  });
});
