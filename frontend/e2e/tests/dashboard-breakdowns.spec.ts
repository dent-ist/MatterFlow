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

/** Pads or cuts the by-task-type rows of the summary the page reads to `count` rows (copies of the first row). */
async function withTaskTypes(page: Page, count: number) {
  await page.route(/\/api\/v1\/dashboard\?/, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const first = json.byTaskType[0];
    if (first)
      json.byTaskType = Array.from({ length: count }, (_, i) => ({
        ...first,
        label: `Height type ${i + 1} with a rather long descriptive name`,
        id: 91000 + i,
      }));
    await route.fulfill({ response, json });
  });
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

  test('one title per card: a hidden "Open Tasks" H2 and the cards as H3, no "Open by" headings', async ({
    page,
  }) => {
    const section = await openBreakdowns(page);
    await expect(section.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Open Tasks');
    await expect(section.getByRole('heading', { level: 3 })).toHaveText([
      'Priority',
      'Status',
      'Task Type',
      'Age',
    ]);
    await expect(section.getByRole('heading', { name: /^Open (by|tasks by)/ })).toHaveCount(0);
    await expect(page.locator('[data-bd-caption]')).toContainText(
      'Open tasks, now. Not affected by the period.',
    );
    await expect(page.getByRole('link', { name: /^0-2 days: \d+ tasks/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^More than 60 days: \d+ tasks/ })).toBeVisible();
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
      for (const toggle of await section.locator('[data-view="pie"]').all()) await toggle.click();
      await expect(section.locator('[data-pie]')).toHaveCount(4);
      expect(await axeViolations(page), `${width} pies`).toEqual([]);
      for (const toggle of await section.locator('[data-view="table"]').all()) await toggle.click();
      await expect(section.locator('table')).toHaveCount(4);
      expect(await axeViolations(page), `${width} tables`).toEqual([]);
      // Back to bars (the choice is remembered per card).
      for (const toggle of await section.locator('[data-view="bars"]').all()) await toggle.click();
      await expect(section.locator('.bars, .stack')).toHaveCount(4);
    }
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

  test('the Bars | Pie | Table switch; the pie legend equals the bars and the queue links, and the choice is remembered', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `BD pie ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -2) });
    const section = await openBreakdowns(page);
    const priority = section.locator('mf-bar-list').first();
    const view = (mode: string) => priority.locator(`[data-view="${mode}"]`);
    await expect(view('bars')).toHaveAttribute('aria-pressed', 'true');
    const bars = await priority.locator('li').evaluateAll((lis) =>
      lis.map((li) => ({
        label: li.querySelector('.name')!.textContent!.trim(),
        count: Number(li.querySelector('.count')!.textContent),
        href: li.querySelector('a.rowlink')?.getAttribute('href') ?? null,
        od: li.querySelector('.od-text')?.getAttribute('href') ?? null,
      })),
    );
    await view('pie').click();
    await expect(priority.locator('[data-pie]')).toBeVisible();
    await expect(view('pie')).toHaveAttribute('aria-pressed', 'true');
    const pie = await priority.locator('[data-pie-legend] li').evaluateAll((lis) =>
      lis.map((li) => ({
        label: li.querySelector('.name')!.textContent!.trim(),
        count: Number(li.querySelector('.count')!.textContent),
        href: li.querySelector('a.rowlink')?.getAttribute('href') ?? null,
        od: li.querySelector('.od-text')?.getAttribute('href') ?? null,
      })),
    );
    // The pie keeps at most eight slices: the seven largest in their order and the rest added up as "Other" (groupSlices). The suite adds
    // priorities as it runs (the Labels specs), so on a used database there can be more than eight bars.
    const keep = new Set(
      bars
        .map((b, i) => ({ i, c: b.count }))
        .sort((a, b) => b.c - a.c || a.i - b.i)
        .slice(0, 7)
        .map((x) => x.i),
    );
    const expectedPie =
      bars.length <= 8
        ? bars
        : [
            ...bars.filter((_, i) => keep.has(i)),
            {
              label: 'Other',
              count: bars.filter((_, i) => !keep.has(i)).reduce((n, b) => n + b.count, 0),
              href: null,
              od: null,
            },
          ];
    if (bars.length > 8 && bars.length - keep.size === 1) {
      // A single left-over row stays as it is (not grouped).
      expectedPie.splice(
        expectedPie.length - 1,
        1,
        bars.find((_, i) => !keep.has(i))!,
      );
    }
    expect(pie).toEqual(expectedPie);
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
    await section.locator('mf-bar-list').first().locator('[data-view="table"]').click();
    await expect(section.locator('mf-bar-list').first().locator('table')).toBeVisible();
    await section.locator('mf-bar-list').first().locator('[data-view="bars"]').click();
    await expect(section.locator('mf-bar-list').first().locator('.bars')).toBeVisible();
  });

  test('pie view: nothing moves on hover or focus of a legend row, and the caption shows the same text', async ({
    page,
  }) => {
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      const section = await openBreakdowns(page);
      const priority = section.locator('mf-bar-list').first();
      if ((await priority.locator('[data-pie]').count()) === 0)
        await priority.locator('[data-view="pie"]').click();
      await expect(priority.locator('[data-pie]')).toBeVisible();
      const snap = () =>
        priority.evaluate((host) => {
          // Relative to the card: hovering a legend row below the fold scrolls the page (more rows than fit at 375), which moves every box
          // on the screen together and is not what this test is about. A box that moves inside the card still shows.
          const origin = host.getBoundingClientRect();
          const r = (e: Element | null) => {
            const b = e!.getBoundingClientRect();
            return [b.x - origin.x, b.y - origin.y, b.width, b.height];
          };
          return {
            svg: r(host.querySelector('svg')),
            tip: r(host.querySelector('[data-pie-tip]')),
            legend: r(host.querySelector('[data-pie-legend]')),
            rows: Array.from(host.querySelectorAll('[data-pie-legend] li')).map((li) => r(li)),
          };
        });
      const same = (a: number[], b: number[], what: string) => {
        for (const [i, v] of a.entries()) expect(Math.abs(v - b[i]), what).toBeLessThanOrEqual(0.5);
      };
      const check = (
        a: Awaited<ReturnType<typeof snap>>,
        b: Awaited<ReturnType<typeof snap>>,
        what: string,
      ) => {
        same(a.svg, b.svg, `${what} donut`);
        same(a.tip, b.tip, `${what} caption`);
        same(a.legend, b.legend, `${what} legend`);
        expect(b.rows.length).toBe(a.rows.length);
        for (const [i, row] of a.rows.entries()) same(row, b.rows[i], `${what} row ${i}`);
      };
      await page.mouse.move(0, 0);
      const before = await snap();
      const rows = priority.locator('[data-pie-legend] li');
      const tip = priority.locator('[data-pie-tip]');
      for (let i = 0; i < (await rows.count()); i++) {
        await rows.nth(i).hover();
        await expect(tip).not.toHaveText('');
        check(before, await snap(), `${width}px hover row ${i}`);
        const hovered = (await tip.innerText()).trim();
        await page.mouse.move(0, 0);
        await expect(tip).toHaveText('');
        check(before, await snap(), `${width}px after row ${i}`);
        const link = rows.nth(i).locator('a.rowlink');
        if ((await link.count()) > 0) {
          await link.focus();
          await expect(tip).toHaveText(hovered);
          check(before, await snap(), `${width}px focus row ${i}`);
          await link.evaluate((e) => (e as HTMLElement).blur());
          await expect(tip).toHaveText('');
        }
      }
      // Back to bars for the next size.
      while ((await priority.locator('.bars').count()) === 0)
        await priority.locator('[data-view="pie"]').click();
    }
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

  test.describe('Breakdowns restyle (DB-11)', () => {
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
    ]) {
      test(`${width}x${height}: the cards fill the tab, the page does not scroll, no empty area under the cards`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height });
        const section = await openBreakdowns(page);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollHeight <= window.innerHeight + 1,
          ),
        ).toBe(true);
        const cards = await section
          .locator('.card')
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
        expect(cards).toHaveLength(4);
        // The top three cards share one row and one height; Task Type sits under them across the width.
        expect(Math.abs(cards[0].height - cards[1].height)).toBeLessThanOrEqual(1);
        expect(Math.abs(cards[0].height - cards[3].height)).toBeLessThanOrEqual(1);
        expect(cards[2].top).toBeGreaterThan(cards[0].bottom - 1);
        const tab = (await section.locator('[data-bd-scroll]').boundingBox())!;
        expect(tab.y + tab.height - cards[2].bottom).toBeLessThan(24);
      });
    }

    test('rows are 36 px, the type has its coloured chip and name, priority and status have coloured tiles', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      const section = await openBreakdowns(page);
      const row = await section.locator('mf-bar-list li .row').first().boundingBox();
      expect(row!.height).toBeGreaterThanOrEqual(36);
      await expect(
        section.locator('mf-bar-list').first().locator('[data-row-tile]').first(),
      ).toBeVisible();
      await expect(
        section.locator('mf-bar-list').nth(1).locator('[data-row-tile]').first(),
      ).toBeVisible();
      await expect(
        section.locator('mf-bar-list').nth(2).locator('[data-type-chip]').first(),
      ).toBeVisible();
    });
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
        for (const t of await section.locator(`[data-view="${view}"]`).all()) await t.click();
        await expect(section.locator(view === 'pie' ? '[data-pie]' : 'table')).toHaveCount(4);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS!, `${view}-${width}.png`), fullPage: true });
      }
      for (const t of await section.locator('[data-view="bars"]').all()) await t.click();
    }
    // A wide window with a long Task type list: the card is capped at the tab and its list scrolls inside.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await withTaskTypes(page, 30);
    await openBreakdowns(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS!, 'bars-1920-long-list.png') });
    await page.unroute(/\/api\/v1\/dashboard\?/);
    await page.setViewportSize({ width: 1366, height: 900 });
    const section = await openBreakdowns(page);
    await page.addStyleTag({ content: 'html{filter:grayscale(1)}' });
    await section.screenshot({ path: path.join(SHOTS!, 'breakdowns-greyscale-1366.png') });
    await page.emulateMedia({ forcedColors: 'active' });
    await section.screenshot({ path: path.join(SHOTS!, 'breakdowns-forced-colors-1366.png') });
  });
});
