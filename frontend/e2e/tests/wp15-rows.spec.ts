import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Rows and skeleton (TQ-WP15, #210 and #212): every Comfortable row of the shared work grid is exactly 44 px whatever it holds (a one-line
 * title, a two-line title, the 170-character title, a 90-character token, an On Hold row with its reason, a closed row, the wide column
 * set with a 47-character client name); group header rows stay 36 px; the skeleton rows have the final row height and column widths, so
 * the first paint does not shift (CLS under 0.02, Title width within 2 px). Every test seeds its own tagged tasks and filters on the tag
 * or on its own user, so nothing depends on global counts or order. Screenshots go to E2E_SCREENSHOTS when set
 * (docs/ux/task-queue-review/fixes/wp-rows).
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

interface Boxes {
  heights: number[];
  groups: number[];
  /** Cells whose content is taller than the cell (it would grow the row). */
  spill: string[];
}

/** Heights of the data rows and of the group header rows on the page. */
function boxes(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('tbody tr[data-task]')).filter(
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

/** Asserts that every row is 44 px (within 1 px) and that no cell is taller than its row. */
async function expect44(page: Page, what: string, count: number): Promise<void> {
  await expect(page.locator('tbody tr[data-task]:not([hidden])')).toHaveCount(count);
  const m = await boxes(page);
  for (const h of m.heights)
    expect(Math.abs(h - 44), `${what}: row heights ${m.heights}`).toBeLessThanOrEqual(1);
  expect(m.spill, `${what}: no cell is taller than its row`).toEqual([]);
}

/** Data rows that lie completely inside the scrolling box of the grid, below the sticky header. */
function visibleRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const wrap = document.querySelector('.wt-wrap')!.getBoundingClientRect();
    const head = document.querySelector('thead')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLElement>('tbody tr[data-task]')).filter((r) => {
      const b = r.getBoundingClientRect();
      return !r.hidden && b.top >= head.bottom - 1 && b.bottom <= wrap.bottom + 1;
    }).length;
  });
}

const WIDE = [
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
];

/** Tagged tasks of every kind of row, assigned to a new worker; the client name has 47 characters. */
async function seedRows(seed: Seeder, admin: Api, tag: string) {
  const client = await seed.client({
    name: `Meridian Pharmaceuticals International ${tag}`.padEnd(47, 'x').slice(0, 47),
  });
  const matter = await seed.matter({ client });
  const workflow = await seed.workflow({});
  const taskType = await seed.taskType({ workflows: [workflow] });
  const world = { client, matter, workflow, taskType };
  const me = await seed.user(['Data Technician'], 'wp15-rows');
  const make = (title: string, extra: Record<string, unknown> = {}) =>
    seed.task(world, { title, assignedUserId: me.userId, ...extra });
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
  return { me, active: 6, closed: 1, matterId: matter.matterId as number };
}

test.describe('Fixed 44 px rows (#210)', () => {
  test('every state is 44 px at 1366 and 1920: one line, two lines, 170 characters, token, On Hold, closed; groups stay 36 px', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const tag = uid();
    const { me, active, closed } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    const queue = new TaskQueuePage(page);
    const myWork = new MyWorkPage(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await queue.open(`?q=${tag}`);
      // The Task Queue lists open tasks only (the Closed task is on My Work's Closed tab).
      await expect44(page, `Task Queue at ${width}`, active + closed);
      await shot(page, `task-queue-44px-${width}x${height}`);

      await myWork.open();
      await expect44(page, `My Work at ${width}`, active);
      await shot(page, `my-work-44px-${width}x${height}`);

      await myWork.open('?group=due');
      await expect44(page, `My Work grouped at ${width}`, active);
      const m = await boxes(page);
      expect(m.groups.length).toBeGreaterThan(0);
      for (const g of m.groups) expect(Math.round(g), 'group header rows are 36 px').toBe(36);
      await shot(page, `my-work-grouped-${width}x${height}`);

      await myWork.open();
      await myWork.tab(/^Closed/).click();
      await expect44(page, `Closed at ${width}`, closed);
      await shot(page, `my-work-closed-${width}x${height}`);
    }
  });

  test('the wide column set (Client with 47 characters, Task type, Workflow, Pod, Created, Updated) keeps every row at 44 px', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const { me, active } = await seedRows(seed, admin, uid());
    const page = await asUser(me.username);
    await page.addInitScript(
      ([k, v]) => localStorage.setItem(k, v),
      [`mf.work-columns.v2.myWork.active.${me.userId}`, JSON.stringify(WIDE)],
    );
    const myWork = new MyWorkPage(page);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await myWork.open();
      // The narrow-box rule drops Client below 1920; the wide window shows it with its 47 characters cut to one line.
      if (width >= 1920) await expect(page.locator('thead th[data-col="client"]')).toBeVisible();
      await expect44(page, `wide set at ${width}`, active);
      await shot(page, `my-work-wide-columns-${width}x${height}`);
    }
  });

  test('the On Hold row keeps its pause marker, the reason beside the pill and the full text as tooltip, in 44 px', async ({
    seed,
    admin,
    asUser,
  }) => {
    const tag = uid();
    const { me } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new MyWorkPage(page).open();
    const row = page.locator('tr[data-task]').filter({ hasText: new RegExp(`Held ${tag}`) });
    await expect(row.locator('[data-hold-mark]')).toHaveAccessibleName('On hold');
    const reason = row.locator('[data-hold-reason]');
    await expect(reason).toHaveText(/^Waiting for the custodian/);
    await expect(reason).toHaveAttribute('title', /privilege log, which will take a while$/);
    const box = (await row.boundingBox())!;
    expect(Math.abs(box.height - 44)).toBeLessThanOrEqual(1);
    const pill = (await row.locator('td[data-col="status"] .im-trigger').boundingBox())!;
    const line = (await reason.boundingBox())!;
    expect(line.y + line.height, 'the reason stays inside the row').toBeLessThanOrEqual(
      box.y + box.height,
    );
    expect(pill.height, 'the pill keeps its 26 px').toBeGreaterThanOrEqual(24);
  });

  test('rows visible: Task Queue at least 11 at 1366x768, My Work Active at least 9 (and report)', async ({
    seed,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const world = await seed.world();
    const me = await seed.user(['Data Technician'], 'wp15-visible');
    for (let i = 0; i < 16; i++)
      await seed.task(world, { title: `Row ${i} ${tag}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    // The default Task Queue (no filter, so no "Clear filters" line in the toolbar); the shared database holds more than 11 open tasks.
    await new TaskQueuePage(page).open();
    await expect(page.locator('tbody tr[data-task]').nth(11)).toBeVisible();
    const queue = await visibleRows(page);
    await shot(page, 'task-queue-rows-visible-1366x768');
    await new MyWorkPage(page).open();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(16);
    const mine = await visibleRows(page);
    await shot(page, 'my-work-rows-visible-1366x768');
    console.log(`ROWS VISIBLE 1366x768: Task Queue ${queue}, My Work ${mine}`);
    expect(queue, 'Task Queue rows visible').toBeGreaterThanOrEqual(11);
    expect(mine, 'My Work rows visible').toBeGreaterThanOrEqual(9);
  });

  test('axe: the grid with every kind of row has no violations at 1366, 1920, 768 and 375', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const { me, active, closed } = await seedRows(seed, admin, tag);
    const page = await asUser(me.username);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await new MyWorkPage(page).open();
      await expect(page.locator('tbody tr[data-task]')).toHaveCount(active);
      const m = await boxes(page);
      // Every width, the phone included (the hold reason sits under a one-line title there): no row is taller than 44 px.
      for (const h of m.heights)
        expect(Math.abs(h - 44), `rows at ${width}: ${m.heights}`).toBeLessThanOrEqual(1);
      await axeClean(page, `My Work ${width}`);
      await shot(page, `my-work-axe-${width}x${height}`);
      await new TaskQueuePage(page).open(`?q=${tag}`);
      await expect(page.locator('tbody tr[data-task]')).toHaveCount(active + closed);
      await axeClean(page, `Task Queue ${width}`);
    }
  });
});

test.describe('Skeleton rows (#212)', () => {
  test('the skeleton has the final row height and widths; CLS stays under 0.02 on a delayed first load of two lists', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const tag = uid();
    const { me, active, closed, matterId } = await seedRows(seed, admin, tag);
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
    let gate = new Promise<void>((resolve) => (release = resolve));
    let hold = true;
    await page.route(/\/api\/v1\/(my-work|task-queue)\?/, async (route) => {
      if (hold) await gate;
      await route.continue().catch(() => undefined);
    });
    const widths = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('thead tr:first-child th')).map(
          (t) => Math.round(t.getBoundingClientRect().width * 10) / 10,
        ),
      );
    const cells = (selector: string) =>
      page.evaluate(
        (sel) =>
          Array.from(document.querySelectorAll<HTMLElement>(`${sel} td`)).map(
            (t) => Math.round(t.getBoundingClientRect().width * 10) / 10,
          ),
        selector,
      );
    for (const [url, count, name] of [
      ['/my-work', active, 'my-work'],
      [`/tasks?q=${tag}`, active + closed, 'task-queue'],
      [`/matters/${matterId}?tab=tasks`, active, 'matter-tasks'],
    ] as const) {
      hold = true;
      gate = new Promise<void>((resolve) => (release = resolve));
      await page.goto(url);
      const body = page.locator('tbody');
      await expect(body.locator('tr[data-skeleton]')).toHaveCount(8);
      await expect(body.locator('[data-loading]'), url).toHaveText(/Loading tasks/);
      const before = await widths();
      const skeleton = await cells('tbody tr[data-skeleton]:nth-of-type(2)');
      const rowHeight = (await body.locator('tr[data-skeleton]').first().boundingBox())!.height;
      expect(Math.abs(rowHeight - 44), 'skeleton rows are 44 px').toBeLessThanOrEqual(1);
      expect(skeleton.length).toBe(before.length);
      skeleton.forEach((w, i) =>
        expect(
          Math.abs(w - before[i]),
          `skeleton cell ${i} has the column width`,
        ).toBeLessThanOrEqual(1),
      );
      await shot(page, `skeleton-${name}-1366x768`);
      await axeClean(page, `skeleton ${name}`);
      hold = false;
      release();
      await expect(page.locator('tbody tr[data-task]')).toHaveCount(count);
      await expect(body.locator('tr[data-skeleton]')).toHaveCount(0);
      const after = await widths();
      before.forEach((w, i) =>
        expect(Math.abs(w - after[i]), `column ${i} before and after the rows`).toBeLessThanOrEqual(
          2,
        ),
      );
      const title = before[1];
      expect(Math.abs(title - after[1]), 'Title width').toBeLessThanOrEqual(2);
      const rowAfter = (await page.locator('tbody tr[data-task]').first().boundingBox())!.height;
      expect(Math.abs(rowAfter - rowHeight), 'row height before and after').toBeLessThanOrEqual(1);
    }
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, 'cumulative layout shift').toBeLessThan(0.02);
  });

  test('reduced motion switches the shimmer off', async ({ seed, asUser }) => {
    const world = await seed.world();
    const me = await seed.user(['Data Technician'], 'wp15-motion');
    await seed.task(world, { title: `Motion ${uid()}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/v1\/my-work\?/, async (route) => {
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
