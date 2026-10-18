import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Compact density (TQ-WP19, #211): every Compact row of the shared work grid is exactly 36 px whatever it holds, with one line per cell
 * (no wrapping, no subline, hold reason in the tooltip only), on My Work, Task Queue and Pod Work at 1366 and 1920; the skeleton rows are
 * 36 px and shift nothing (CLS under 0.02); the interactive targets are at least 24 px; the focus ring shows (also with forced colours) and
 * is not clipped. Every test seeds its own tagged tasks and filters on the tag or on its own user, so nothing depends on global counts or
 * order. Screenshots go to E2E_SCREENSHOTS when set (docs/ux/task-queue-review/fixes/wp-compact).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES: [number, number][] = [
  [1366, 768],
  [1920, 1080],
];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

/** Stores the Compact preference of every work page for the user before the app starts. */
async function compactFor(page: Page, userId: number): Promise<void> {
  await page.addInitScript((id) => {
    for (const p of ['queue', 'my-work', 'pod-work'])
      localStorage.setItem(`mf.work-table.v3.${p}.${id}`, JSON.stringify({ density: 'compact' }));
  }, userId);
}

interface Boxes {
  heights: number[];
  groups: number[];
  /** Cells whose content is taller or wider than the cell, or text on a second line. */
  spill: string[];
}

function boxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-task]')).filter(
      (r) => !r.hidden,
    );
    return {
      heights: rows.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10),
      groups: Array.from(document.querySelectorAll<HTMLElement>('tbody tr.wt-group')).map(
        (r) => r.getBoundingClientRect().height,
      ),
      spill: rows.flatMap((r) =>
        Array.from(r.querySelectorAll<HTMLElement>('td'))
          .filter((td) => td.scrollHeight > td.clientHeight + 1)
          .map(
            (td) =>
              `${r.dataset['task']} ${td.dataset['col']} ${td.scrollHeight}>${td.clientHeight}`,
          ),
      ),
    };
  });
}

async function expect36(page: Page, what: string, count: number): Promise<void> {
  await expect(page.locator('[data-task]:not([hidden])')).toHaveCount(count);
  await expect(page.locator('table.wt')).toHaveClass(/wt--compact/);
  const m = await boxes(page);
  for (const h of m.heights)
    expect(Math.abs(h - 36), `${what}: row heights ${m.heights}`).toBeLessThanOrEqual(1);
  expect(m.spill, `${what}: no cell is taller than its row`).toEqual([]);
  // One line per cell: every text-bearing element in a row is no taller than a line of the cell (24 px), and no pill wraps.
  const tall = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-task]:not([hidden]) td *'))
      .filter((e) => e.children.length === 0 && (e.textContent ?? '').trim().length > 0)
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.height > 28 && b.width > 0;
      })
      .map((e) => `${e.tagName}.${e.className} ${e.getBoundingClientRect().height}`),
  );
  expect(tall, `${what}: no text element wraps to a second line`).toEqual([]);
}

function visibleRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const wrap = document.querySelector('.wt-wrap')!.getBoundingClientRect();
    const head = document.querySelector('thead')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLElement>('[data-task]')).filter((r) => {
      const b = r.getBoundingClientRect();
      return !r.hidden && b.top >= head.bottom - 1 && b.bottom <= wrap.bottom + 1;
    }).length;
  });
}

/** Tagged tasks of every kind of row, all in the pod and assigned to the new worker. */
async function seedRows(seed: Seeder, admin: Api, tag: string) {
  const client = await seed.client({
    name: `Meridian Pharmaceuticals International ${tag}`.padEnd(47, 'x').slice(0, 47),
  });
  const matter = await seed.matter({ client });
  const workflow = await seed.workflow({});
  const taskType = await seed.taskType({ workflows: [workflow] });
  const world = { client, matter, workflow, taskType };
  const me = await seed.user(['Pod Lead', 'Data Technician'], 'wp19');
  const pod = await seed.pod(undefined, [me.userId]);
  const make = (title: string, extra: Record<string, unknown> = {}) =>
    seed.task(world, {
      title,
      assignedUserId: me.userId,
      assignedPodId: pod.podId,
      ...extra,
    });
  const two =
    'Reconcile the privileged documents against the custodian index before the hearing and report';
  await make(`One line ${tag}`, { dueDate: dateInZone(FIRM_ZONE, -3) });
  await make(`${two} ${tag}`, { dueDate: dateInZone(FIRM_ZONE, 0) });
  await make(`${tag} ${'Long title words '.repeat(10)}`.slice(0, 170));
  await make(`T${tag}${'x'.repeat(80)}`, { dueDate: dateInZone(FIRM_ZONE, 40) });
  const held = await make(`Held ${tag}`, { dueDate: dateInZone(FIRM_ZONE, 2) });
  await new TaskApi(admin, held.taskId).changeStatus(
    'ON_HOLD',
    'Waiting for the custodian to confirm the review set and the privilege log, which will take a while',
  );
  const heldLong = await make(`${two} paused ${tag}`);
  await new TaskApi(admin, heldLong.taskId).changeStatus('ON_HOLD', 'Waiting for the court');
  const done = await make(`Done ${tag}`);
  const doneApi = new TaskApi(admin, done.taskId);
  await doneApi.completeSteps(1, 2, 3);
  expect((await doneApi.complete()).status).toBeLessThan(300);
  return { me, pod, active: 6, closed: 1 };
}

test.describe('Fixed 36 px Compact rows (#211)', () => {
  test('every state is 36 px at 1366 and 1920 on My Work, Task Queue and Pod Work; groups stay 36 px; nothing wraps', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const tag = uid();
    const { me, pod, active, closed } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
    const queue = new TaskQueuePage(page);
    const myWork = new MyWorkPage(page);
    const podWork = new PodWorkPage(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await queue.open(`?q=${tag}`);
      await expect36(page, `Task Queue at ${width}`, active + closed);
      await shot(page, `task-queue-compact-${width}x${height}`);

      await myWork.open();
      await expect36(page, `My Work at ${width}`, active);
      await shot(page, `my-work-compact-${width}x${height}`);

      await myWork.open('?group=due');
      await expect36(page, `My Work grouped at ${width}`, active);
      const m = await boxes(page);
      expect(m.groups.length).toBeGreaterThan(0);
      for (const g of m.groups) expect(Math.round(g), 'group header rows are 36 px').toBe(36);
      await shot(page, `my-work-grouped-compact-${width}x${height}`);

      await myWork.open();
      await myWork.tab(/^Closed/).click();
      await expect36(page, `Closed at ${width}`, closed);

      await podWork.open();
      await podWork.choosePod(pod.name);
      await podWork.tab(/^All pod tasks/).click();
      await podWork.search(tag);
      await expect36(page, `Pod Work at ${width}`, active);
      await shot(page, `pod-work-compact-${width}x${height}`);
    }
  });

  test('the wide column set keeps every Compact row at 36 px; the hold reason is in the tooltip only', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const { me, active } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
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
          'pod',
          'priority',
          'assignee',
          'due',
          'status',
          'created',
          'updated',
        ]),
      ],
    );
    const myWork = new MyWorkPage(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await myWork.open();
      await expect36(page, `wide set at ${width}`, active);
      await shot(page, `my-work-compact-wide-${width}x${height}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await myWork.open();
    const row = page.locator('[data-task]').filter({ hasText: new RegExp(`Held ${tag}`) });
    // The pause marker stays; the reason is not drawn but the status cell tooltip and the accessible text carry it.
    await expect(row.locator('[data-hold-mark]')).toHaveAccessibleName('On hold');
    await expect(row.locator('td[data-col="status"] > div')).toHaveAttribute(
      'title',
      /privilege log, which will take a while/,
    );
    const drawn = await row.locator('[data-hold-reason]').evaluate((n) => {
      const b = n.getBoundingClientRect();
      return b.width > 2 && b.height > 2;
    });
    expect(drawn, 'the hold reason line is not drawn in Compact').toBe(false);
  });

  test('targets are at least 24 px and the focus ring shows (also with forced colours) and is not clipped; J moves between rows', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const { me, active } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect36(page, 'My Work', active);

    const small = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-task] a, [data-task] button, [data-task] input',
        ),
      )
        .map((e) => ({ e, b: e.getBoundingClientRect() }))
        .filter(({ b }) => b.width > 2 && b.height > 2)
        .filter(({ b }) => b.height < 24 || (b.width < 24 && b.height < 24))
        .map(({ e, b }) => `${e.tagName}.${e.className} ${b.width}x${b.height}`),
    );
    expect(small, 'every target in a Compact row is at least 24 px high').toEqual([]);

    for (const forced of [false, true]) {
      await page.emulateMedia({ forcedColors: forced ? 'active' : 'none' });
      const row = page.locator('[data-task]').first();
      for (const sel of [
        'a.wt-title',
        'td[data-col="status"] button',
        'td[data-col="priority"] button',
      ]) {
        const el = row.locator(sel).first();
        await el.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const ring = await el.evaluate((n) => {
          const cs = getComputedStyle(n);
          const b = n.getBoundingClientRect();
          const grow = parseFloat(cs.outlineWidth) + Math.max(0, parseFloat(cs.outlineOffset));
          const td = n.closest('td')!.getBoundingClientRect();
          const wrap = document.querySelector('.wt-wrap')!.getBoundingClientRect();
          const visible =
            (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) ||
            cs.boxShadow !== 'none';
          return {
            visible,
            style: cs.outlineStyle,
            width: cs.outlineWidth,
            inside: b.top - grow >= td.top - 1 && b.bottom + grow <= td.bottom + 1,
            inWrap: b.top - grow >= wrap.top && b.bottom + grow <= wrap.bottom + 1,
          };
        });
        expect(
          ring.visible,
          `${sel} focus ring (forced colours ${forced}): ${JSON.stringify(ring)}`,
        ).toBe(true);
        expect(
          ring.inside,
          `${sel} ring inside its cell (forced ${forced}) ${JSON.stringify(ring)}`,
        ).toBe(true);
        if (sel === 'a.wt-title')
          await shot(page, `focus-${forced ? 'forced-colours' : 'normal'}-title-1366x768`);
      }
    }
    await page.emulateMedia({ forcedColors: 'none' });

    // J / K behave as in Comfortable: the next row takes focus and shows its ring.
    await page.locator('[data-task] a.wt-title').first().focus();
    await page.keyboard.press('j');
    const second = page.locator('[data-task]').nth(1);
    await expect(second.locator('a.wt-title')).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.locator('[data-task]').first().locator('a.wt-title')).toBeFocused();
  });

  test('rows visible at 1366x768: Task Queue 13 and My Work 11 (14 and 12 with the filter row closed), 23 at 1920 (and report)', async ({
    seed,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const world = await seed.world();
    const me = await seed.user(['Data Technician'], 'wp19-visible');
    for (let i = 0; i < 18; i++)
      await seed.task(world, { title: `Row ${i} ${tag}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open();
    await expect(page.locator('[data-task]').nth(15)).toBeVisible();
    const queue = await visibleRows(page);
    await shot(page, 'task-queue-rows-visible-1366x768');
    await new MyWorkPage(page).open();
    await expect(page.locator('[data-task]')).toHaveCount(18);
    const mine = await visibleRows(page);
    await shot(page, 'my-work-rows-visible-1366x768');
    await new TaskQueuePage(page).open();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.locator('tr[data-filter-row]')).toHaveCount(0);
    const queueClosed = await visibleRows(page);
    await shot(page, 'task-queue-rows-visible-filter-row-closed-1366x768');
    await new MyWorkPage(page).open();
    await expect(page.locator('[data-task]')).toHaveCount(18);
    if ((await page.locator('tr[data-filter-row]').count()) > 0)
      await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.locator('tr[data-filter-row]')).toHaveCount(0);
    const mineClosed = await visibleRows(page);
    await shot(page, 'my-work-rows-visible-filter-row-closed-1366x768');
    console.log(
      `ROWS VISIBLE Compact 1366x768 filter row closed: Task Queue ${queueClosed}, My Work ${mineClosed}`,
    );
    expect(
      queueClosed,
      'Task Queue rows visible with the filter row closed',
    ).toBeGreaterThanOrEqual(14);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new TaskQueuePage(page).open();
    await expect(page.locator('[data-task]').nth(15)).toBeVisible();
    const queue1920 = await visibleRows(page);
    console.log(
      `ROWS VISIBLE Compact 1366x768: Task Queue ${queue}, My Work ${mine}; 1920x1080 Task Queue ${queue1920}`,
    );
    expect(queue, 'Task Queue rows visible with the filter row open').toBeGreaterThanOrEqual(13);
    expect(queue, 'Task Queue rows visible with the filter row open').toBeGreaterThanOrEqual(13);
    expect(mine, 'My Work rows visible with the filter row open').toBeGreaterThanOrEqual(11);
    expect(mineClosed, 'My Work rows visible with the filter row closed').toBeGreaterThanOrEqual(
      12,
    );
    expect(queue1920, 'Task Queue rows visible at 1920').toBeGreaterThanOrEqual(22);
  });

  test('axe: Compact grids have no violations at 1366, 1920, 768 and 375', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const { me, pod, active, closed } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await new MyWorkPage(page).open();
      await expect(page.locator('[data-task]')).toHaveCount(active);
      await axeClean(page, `My Work ${width}`);
      await shot(page, `my-work-compact-axe-${width}x${height}`);
      await new TaskQueuePage(page).open(`?q=${tag}`);
      await expect(page.locator('[data-task]')).toHaveCount(active + closed);
      await axeClean(page, `Task Queue ${width}`);
      const podWork = new PodWorkPage(page);
      await podWork.open();
      await podWork.choosePod(pod.name);
      await podWork.tab(/^All pod tasks/).click();
      await expect(page.locator('[data-task]').filter({ hasText: tag })).toHaveCount(active);
      await axeClean(page, `Pod Work ${width}`);
    }
  });

  test('forced colours: the Compact grid keeps its focus ring, pills and row separators', async ({
    seed,
    admin,
    asUser,
  }) => {
    const { me } = await seedRows(seed, admin, uid());
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
    await page.emulateMedia({ forcedColors: 'active' });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new MyWorkPage(page).open();
    await page.locator('[data-task] a.wt-title').first().focus();
    await shot(page, 'forced-colours-compact-1366x768');
    await axeClean(page, 'forced colours');
  });
});

test.describe('Skeleton rows in Compact', () => {
  test('36 px skeleton rows with the final row height; CLS stays under 0.02', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const { me, active, closed } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    await compactFor(page, me.userId);
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
    let gate = new Promise<void>((resolve) => (release = resolve));
    let hold = true;
    await page.route(/\/api\/v1\/(my-work|task-queue|pods\/[^?]*work)\?/, async (route) => {
      if (hold) await gate;
      await route.continue().catch(() => undefined);
    });
    for (const [url, count, name] of [
      ['/my-work', active, 'my-work'],
      [`/tasks?q=${tag}`, active + closed, 'task-queue'],
    ] as const) {
      hold = true;
      gate = new Promise<void>((resolve) => (release = resolve));
      await page.goto(url);
      const body = page.locator('tbody');
      await expect(body.locator('tr[data-skeleton]')).toHaveCount(8);
      const heights = await body
        .locator('tr[data-skeleton]')
        .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
      for (const h of heights)
        expect(Math.abs(h - 36), `skeleton rows are 36 px: ${heights}`).toBeLessThanOrEqual(1);
      await shot(page, `skeleton-compact-${name}-1366x768`);
      await axeClean(page, `skeleton ${name}`);
      hold = false;
      release();
      await expect(page.locator('[data-task]')).toHaveCount(count);
      await expect(body.locator('tr[data-skeleton]')).toHaveCount(0);
      const rowAfter = (await page.locator('[data-task]').first().boundingBox())!.height;
      expect(Math.abs(rowAfter - heights[0]), 'row height before and after').toBeLessThanOrEqual(1);
    }
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.02);
  });
});
