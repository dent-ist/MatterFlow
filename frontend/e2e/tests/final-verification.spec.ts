import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Final verification of the Task Queue epic (TQ-WP29, #240): the checks that cut across the pages after every package landed.
 *
 *  1. The owner's three requirements on every grid: no client or matter line under a Title, widths resizable (a handle on every column but
 *     the Title), the relative Due text on a second line, every row at most two lines (44 px, nothing taller than its row). Task Queue, My
 *     Work, Pod Work, a Matter's Tasks tab and a Project.
 *  2. The row-height histogram: one value per density over three pages of seed data, and the column widths do not move across the pages.
 *  3. The review's drill-through check on the Dashboard: every count of the Summary tiles and of the Breakdowns (priorities, statuses, ages,
 *     task types) equals the grid total behind its link, in one pod's scope so the numbers are this test's own.
 *  4. The Tab stops before the first row are counted and recorded (annotation and console).
 *  5. Axe at 1366, 1920, 768 and 375 on the six screens, and (with E2E_SCREENSHOTS) the screenshots of docs/ux/task-queue-review/fixes/final.
 *
 * Every test seeds its own tagged data and asserts nothing about global counts.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES: [number, number][] = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

interface Scenario {
  tag: string;
  client: Json;
  matter: Json;
  project: Json;
  me: { username: string; userId: number };
  pod: Json;
  titles: string[];
}

/** A pod lead with three tasks (overdue, due today, due tomorrow) on a matter and a project whose names are easy to recognise. */
async function scenario(seed: Seeder): Promise<Scenario> {
  const tag = uid();
  const client = await seed.client({ name: `Zenith Client ${tag}` });
  const matter = await seed.matter({ client, name: `Zenith Matter ${tag}` });
  const project = await seed.project(matter, `Zenith Project ${tag}`);
  const workflow = await seed.workflow({});
  const taskType = await seed.taskType({ workflows: [workflow] });
  const world = { client, matter, workflow, taskType };
  const me = await seed.user(['Pod Lead', 'Data Technician'], 'final');
  const pod = await seed.pod(undefined, [me.userId]);
  const titles: string[] = [];
  for (const [i, days] of [-2, 0, 1].entries()) {
    const title = `Owner ${i} ${tag}`;
    titles.push(title);
    await seed.task(world, {
      title,
      projectId: project.projectId,
      assignedUserId: me.userId,
      assignedPodId: pod.podId,
      dueDate: dateInZone(FIRM_ZONE, days),
    });
  }
  return { tag, client, matter, project, me, pod, titles };
}

interface Grid {
  name: string;
  open: (page: Page, s: Scenario) => Promise<void>;
  /** The grid that holds the rows (a scoped one lives inside its own host). */
  root: string;
}

const GRIDS: Grid[] = [
  {
    name: 'Task Queue',
    root: 'main',
    open: async (page, s) => new TaskQueuePage(page).open(`?q=${s.tag}`),
  },
  {
    name: 'My Work',
    root: 'main',
    open: async (page) => new MyWorkPage(page).open(),
  },
  {
    name: 'Pod Work',
    root: 'main',
    open: async (page, s) => {
      const podWork = new PodWorkPage(page);
      await podWork.open();
      await podWork.choosePod(s.pod.name);
      await podWork.tab(/^All open/).click();
      await podWork.search(s.tag);
    },
  },
  {
    name: 'Matter Tasks tab',
    root: 'mf-scoped-tasks',
    open: async (page, s) => {
      await page.goto(`/matters/${s.matter.matterId}?tab=tasks`);
    },
  },
  {
    name: 'Project tasks',
    root: 'mf-scoped-tasks',
    open: async (page, s) => {
      await page.goto(`/projects/${s.project.projectId}`);
    },
  },
];

/** How many Tab presses from the top of the page until a row title has focus (the skip link not used). */
async function tabsToFirstRow(page: Page): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let n = 1; n <= 80; n++) {
    await page.keyboard.press('Tab');
    const onTitle = await page.evaluate(
      () => !!document.activeElement?.matches('tbody a.wt-title'),
    );
    if (onTitle) return n;
  }
  return 81;
}

test.describe('Final verification (#240)', () => {
  test('owner requirements on Task Queue, My Work, Pod Work, a Matter and a Project: no context line, resizable, Due on two lines, at most two lines per row', async ({
    seed,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const s = await scenario(seed);
    const page = await asUser(s.me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const report: string[] = [];
    for (const grid of GRIDS) {
      await grid.open(page, s);
      const rows = page.locator(`${grid.root} [data-task]:not([hidden])`);
      await expect(rows, grid.name).toHaveCount(3);
      const m = await page.evaluate(
        ({ root }) => {
          const scope = document.querySelector(root)!;
          const rows = Array.from(scope.querySelectorAll<HTMLElement>('[data-task]'));
          const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
          return {
            titles: rows.map((r) => norm(r.querySelector('td[data-col="title"]')?.textContent)),
            heights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
            spill: rows.flatMap((r) =>
              Array.from(r.querySelectorAll<HTMLElement>('td'))
                .filter((td) => td.scrollHeight > td.clientHeight + 1)
                .map((td) => `${r.dataset['task']} ${td.dataset['col']}`),
            ),
            handles: Array.from(scope.querySelectorAll('thead span.wt-resize')).length,
            titleHandles: scope.querySelectorAll('thead th[data-col="title"] .wt-resize').length,
            due: rows.map((r) => {
              const l1 = r.querySelector<HTMLElement>('td[data-col="due"] .dc-l1');
              const l2 = r.querySelector<HTMLElement>('td[data-col="due"] .dc-l2');
              return {
                l1: !!l1,
                l2: !!l2,
                below:
                  l1 && l2
                    ? l2.getBoundingClientRect().top >= l1.getBoundingClientRect().bottom - 1
                    : false,
              };
            }),
          };
        },
        { root: grid.root },
      );
      // 1. The Title cell holds the title and nothing else: neither the client nor the matter (nor the project) is named under it.
      expect(
        [...m.titles].sort(),
        `${grid.name}: the Title cell holds the title and nothing else`,
      ).toEqual([...s.titles].sort());
      for (const t of m.titles)
        expect(t, `${grid.name}: no client or matter line under the Title`).not.toContain('Zenith');
      // 2. Widths are resizable: a handle on the columns, none on the Title.
      expect(m.handles, `${grid.name}: resize handles`).toBeGreaterThanOrEqual(3);
      expect(m.titleHandles, `${grid.name}: the Title has no handle`).toBe(0);
      // 3. The Due cell has the date on line 1 and the relative text on line 2 (all three tasks have a due date).
      for (const [i, d] of m.due.entries())
        expect(d, `${grid.name}: Due cell of row ${i} has two lines`).toEqual({
          l1: true,
          l2: true,
          below: true,
        });
      // 4. Every row is at most two lines: exactly 44 px and no cell taller than its row.
      for (const h of m.heights)
        expect(Math.abs(h - 44), `${grid.name}: row heights ${m.heights}`).toBeLessThanOrEqual(1);
      expect(m.spill, `${grid.name}: no cell taller than its row`).toEqual([]);
      report.push(`${grid.name}: ${m.handles} handles, rows ${m.heights.join('/')} px`);
    }
    console.log(`OWNER REQUIREMENTS OK: ${report.join('; ')}`);
  });

  test('row heights have one value per density over three pages, and no column width moves between the pages', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(300_000);
    const tag = uid();
    const client = await seed.client({ name: `Pages Client ${tag}` });
    const matter = await seed.matter({ client, name: `Pages Matter ${tag}` });
    const workflow = await seed.workflow({});
    const taskType = await seed.taskType({ workflows: [workflow] });
    const world = { client, matter, workflow, taskType };
    const me = await seed.user(['Data Technician'], 'final-pages');
    const long =
      'Reconcile the privileged documents against the custodian index before the hearing';
    const made: Json[] = [];
    for (let i = 0; i < 58; i++) {
      const title =
        i % 7 === 0
          ? `${long} ${i} ${tag}`
          : i % 11 === 0
            ? `T${tag}${'x'.repeat(80)}${i}`
            : `Task ${i} ${tag}`;
      made.push(
        await seed.task(world, {
          title,
          assignedUserId: i % 2 === 0 ? me.userId : undefined,
          dueDate: i % 3 === 0 ? dateInZone(FIRM_ZONE, i - 20) : undefined,
        }),
      );
    }
    await new TaskApi(admin, made[5].taskId).changeStatus('ON_HOLD', 'Waiting for the court');
    await new TaskApi(admin, made[8].taskId).changeStatus(
      'ON_HOLD',
      'Waiting for the custodian to confirm the review set and the privilege log, which will take a while',
    );

    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const density of ['comfortable', 'compact'] as const) {
      if (density === 'compact') {
        await page.addInitScript((id) => {
          localStorage.setItem(
            `mf.work-table.v3.queue.${id}`,
            JSON.stringify({ density: 'compact' }),
          );
        }, me.userId);
      }
      const expected = density === 'compact' ? 36 : 44;
      const widths: string[] = [];
      const all: number[] = [];
      for (const n of [1, 2, 3]) {
        await page.goto(`/tasks?matter=${matter.matterId}&pageSize=25&page=${n}`);
        await expect(page.locator('[data-task]:not([hidden])')).toHaveCount(n === 3 ? 8 : 25);
        await expect(page.locator('table.wt')).toHaveClass(
          density === 'compact' ? /wt--compact/ : /^(?!.*wt--compact)/,
        );
        const m = await page.evaluate(() => ({
          heights: Array.from(
            document.querySelectorAll<HTMLElement>('[data-task]:not([hidden])'),
          ).map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10),
          head: Array.from(
            document.querySelectorAll<HTMLElement>('table.wt thead th[data-col]'),
          ).map((c) => `${c.dataset['col']}:${Math.round(c.getBoundingClientRect().width)}`),
        }));
        all.push(...m.heights);
        widths.push(m.head.join(' '));
      }
      expect(all.length, `${density}: rows over three pages`).toBe(58);
      expect(
        Math.max(...all) - Math.min(...all),
        `${density}: heights ${[...new Set(all)]}`,
      ).toBeLessThanOrEqual(1);
      expect(Math.abs(all[0] - expected)).toBeLessThanOrEqual(1);
      expect(new Set(widths).size, `${density}: column widths across the pages ${widths}`).toBe(1);
      console.log(
        `ROW HEIGHT HISTOGRAM ${density}: ${[...new Set(all)].join(', ')} px over 3 pages (58 rows)`,
      );
    }
  });

  test('the record grids resize too: a drag on a Matter Tasks tab and on a Project list persists in its own scope and reaches no other screen', async ({
    seed,
    asUser,
  }) => {
    test.setTimeout(180_000);
    const s = await scenario(seed);
    const page = await asUser(s.me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const widthOf = async (key: string) =>
      (await page.locator(`thead tr:first-child th[data-col="${key}"]`).first().boundingBox())!
        .width;
    const stored = () =>
      page.evaluate(() => {
        const out: Record<string, Record<string, number>> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          if (k.startsWith('mf.work-widths.v1.')) out[k] = JSON.parse(localStorage.getItem(k)!).w;
        }
        return out;
      });
    for (const [name, url, scope] of [
      ['Matter', `/matters/${s.matter.matterId}?tab=tasks`, 'matterTasks'],
      ['Project', `/projects/${s.project.projectId}`, 'projectTasks'],
    ] as const) {
      await page.goto(url);
      await expect(page.locator('mf-scoped-tasks [data-task]')).toHaveCount(3);
      const handle = page.locator('mf-scoped-tasks thead .wt-resize[data-resize="due"]');
      const before = await widthOf('due');
      const side = await handle.getAttribute('data-side');
      const box = (await handle.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (side === 'end' ? 40 : -40), y, { steps: 8 });
      await page.mouse.up();
      expect(
        Math.abs((await widthOf('due')) - (before + 40)),
        `${name}: Due grows by the drag`,
      ).toBeLessThanOrEqual(1);
      const keys = Object.keys(await stored());
      expect(
        keys.some((k) => k.includes(`.${scope}.`)),
        `${name}: stored in ${scope} (${keys})`,
      ).toBe(true);
      expect(keys.length, 'only the scope of this grid is written').toBe(1);
      await page.reload();
      await expect(page.locator('mf-scoped-tasks [data-task]')).toHaveCount(3);
      expect(
        Math.abs((await widthOf('due')) - (before + 40)),
        `${name}: kept after a reload`,
      ).toBeLessThanOrEqual(1);
      // Task Queue is another scope: its Due column keeps the default width.
      await new TaskQueuePage(page).open(`?q=${s.tag}`);
      await expect(page.locator('[data-task]')).toHaveCount(3);
      expect(Math.round(await widthOf('due')), 'Task Queue keeps its own width').toBe(136);
      await page.evaluate(() => {
        for (const k of Object.keys(localStorage))
          if (k.startsWith('mf.work-widths.v1.')) localStorage.removeItem(k);
      });
    }
  });

  test('Dashboard drill-through: every tile and every breakdown row equals the grid total behind its link', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(300_000);
    if (!Seeder.canWriteLegacyText())
      test.skip(true, 'needs the run-local.sh SQL container (task ages)');
    const tag = uid();
    const world = await seed.world();
    const workflow2 = await seed.workflow({});
    const typeB = await seed.taskType({ workflows: [workflow2] });
    const worldB = { ...world, taskType: typeB, workflow: workflow2 };
    const director = await seed.user(['Director'], 'final-dash');
    const tech = await seed.user(['Data Technician'], 'final-dash-tech');
    const pod = await seed.pod(undefined, [tech.userId]);
    // Active ones only: the Labels specs leave deactivated priorities behind, and a task cannot be filed on one.
    const priorities = (
      await admin.get<{ id: number; label: string; isActive: boolean }[]>('/api/v1/priorities')
    ).filter((p) => p.isActive);
    const mk = (w: typeof world, title: string, extra: Record<string, unknown> = {}) =>
      seed.task(w, { title: `${title} ${tag}`, assignedPodId: pod.podId, ...extra });
    const ids: number[] = [];
    // Open, unassigned, assigned, overdue, ASAP, due soon, on hold, completed, in four priorities and two task types, of different ages.
    for (const [i, p] of priorities.entries()) {
      const t = await mk(i % 2 ? worldB : world, `Prio ${p.label}`, {
        priorityId: p.id,
        assignedUserId: i % 2 ? tech.userId : undefined,
        dueDate: dateInZone(FIRM_ZONE, i === 0 ? -3 : i === 1 ? 1 : 10),
      });
      ids.push(t.taskId);
    }
    const asap = await mk(world, 'Asap', { assignedUserId: tech.userId });
    const held = await mk(worldB, 'Held', { assignedUserId: tech.userId });
    await new TaskApi(admin, held.taskId).changeStatus('ON_HOLD', 'Waiting');
    const done = await mk(world, 'Done', { assignedUserId: tech.userId });
    const doneApi = new TaskApi(admin, done.taskId);
    await doneApi.completeSteps(1, 2, 3);
    await doneApi.complete();
    for (const [i, id] of ids.entries())
      seed.ageTask(id, { createdDaysAgo: [0, 5, 20, 45][i % 4] });
    seed.ageTask(asap.taskId, { createdDaysAgo: 100 });

    const page = await asUser(director.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const total = async (href: string): Promise<number> => {
      await page.goto(href);
      const text = page.getByText(/^Showing (\d+-\d+|0) of \d+$/).first();
      const empty = page.locator('td[data-empty]').first();
      await expect(text.or(empty), href).toBeVisible();
      if (await empty.isVisible()) return 0;
      return Number((await text.textContent())!.match(/of (\d+)/)![1]);
    };
    const checked: string[] = [];

    await page.goto(`/dashboard?pod=${pod.podId}`);
    await expect(page.locator('a.tile').first()).toBeVisible();
    const tiles = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a.tile')).map((a) => ({
        href: a.getAttribute('href')!,
        value: Number(a.querySelector('.value')?.textContent?.trim()),
        label: a.querySelector('.label-text')?.textContent?.trim() ?? '',
      })),
    );
    expect(tiles.length, 'Summary tiles with a count').toBeGreaterThanOrEqual(5);
    for (const t of tiles) {
      expect(await total(t.href), `tile ${t.label} (${t.href})`).toBe(t.value);
      checked.push(`tile ${t.label}=${t.value}`);
    }

    await page.goto(`/dashboard?tab=breakdowns&pod=${pod.podId}`);
    await expect(page.locator('mf-bar-list').first()).toBeVisible();
    await expect(page.locator('mf-stacked-bar').first()).toBeVisible();
    // Every card starts as bars; the toggle walks bars, pie, table: stop at the table (its toggle then offers "View as bars").
    const toggles = page.locator('[data-view-toggle]');
    for (let i = 0; i < (await toggles.count()); i++) {
      for (
        let k = 0;
        k < 3 && !/View as bars/.test((await toggles.nth(i).textContent()) ?? '');
        k++
      )
        await toggles.nth(i).click();
    }
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('mf-bar-list, mf-stacked-bar')).flatMap((card) =>
        Array.from(card.querySelectorAll('tbody tr'))
          .map((tr) => ({
            card: card.querySelector('h3')?.textContent?.trim() ?? '',
            link: tr.querySelector('th a')?.getAttribute('href') ?? null,
            label: tr.querySelector('th')?.textContent?.trim() ?? '',
            count: Number(tr.querySelector('td.num')?.textContent?.trim()),
            // The "N overdue" link of the row (a plain number when there is none).
            overdueLink:
              tr.querySelectorAll('td.num')[1]?.querySelector('a')?.getAttribute('href') ?? null,
            overdue: Number(tr.querySelectorAll('td.num')[1]?.textContent?.trim()),
          }))
          .filter((r) => r.link),
      ),
    );
    expect(rows.length, 'Breakdown rows with a link').toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(await total(r.link!), `${r.card}: ${r.label} (${r.link})`).toBe(r.count);
      checked.push(`${r.card} ${r.label}=${r.count}`);
      if (r.overdueLink) {
        expect(await total(r.overdueLink), `${r.card}: ${r.label} overdue`).toBe(r.overdue);
        checked.push(`${r.card} ${r.label} overdue=${r.overdue}`);
      }
    }
    console.log(
      `DRILL-THROUGH: ${checked.length} links checked, totals equal: ${checked.join('; ')}`,
    );
  });

  test('Tab stops before the first row are counted on the three work lists (recorded)', async ({
    seed,
    asUser,
  }) => {
    const s = await scenario(seed);
    const page = await asUser(s.me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const stops: Record<string, number> = {};
    for (const grid of GRIDS.slice(0, 3)) {
      await grid.open(page, s);
      await expect(page.locator('main [data-task]')).toHaveCount(3);
      // With the skip link: one Tab and Enter (from the top of a freshly loaded page).
      await page.reload();
      await expect(page.locator('main [data-task]')).toHaveCount(3);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to task list' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('tbody a.wt-title').first()).toBeFocused();
      await page.reload();
      await expect(page.locator('main [data-task]')).toHaveCount(3);
      stops[grid.name] = await tabsToFirstRow(page);
      expect(stops[grid.name], `${grid.name}: Tab stops to the first row`).toBeLessThan(80);
    }
    const text = Object.entries(stops)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    test.info().annotations.push({ type: 'tab-stops-without-skip-link', description: text });
    console.log(`TAB STOPS to the first row (skip link not used; with it: 1 Tab + Enter): ${text}`);
  });

  test('the six screens at four sizes: axe has no violations, and the screenshots are taken when E2E_SCREENSHOTS is set', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(420_000);
    const s = await scenario(seed);
    const page = await asUser(s.me.username);
    // Cards for the swimlane need a lane with tasks of this pod.
    const screens: { name: string; open: (p: Page) => Promise<void>; ready: string }[] = [
      {
        name: 'task-queue',
        open: (p) => new TaskQueuePage(p).open(`?q=${s.tag}`),
        ready: '[data-task]',
      },
      { name: 'my-work', open: (p) => new MyWorkPage(p).open(), ready: '[data-task]' },
      {
        name: 'pod-work',
        open: async (p) => {
          const podWork = new PodWorkPage(p);
          await podWork.open();
          await podWork.choosePod(s.pod.name);
          await podWork.tab(/^All open/).click();
        },
        ready: '[data-task]',
      },
      {
        name: 'matter-tasks',
        open: async (p) => {
          await p.goto(`/matters/${s.matter.matterId}?tab=tasks`);
        },
        ready: 'mf-scoped-tasks [data-task]',
      },
      {
        name: 'dashboard-lists',
        open: async (p) => {
          await p.goto(`/dashboard?pod=${s.pod.podId}`);
        },
        ready: 'a.tile',
      },
      {
        name: 'swimlane',
        open: async (p) => {
          await p.goto(`/dashboard?tab=swimlane&q=${s.tag}`);
        },
        ready: '[data-lane], [role="tablist"]',
      },
    ];
    void admin;
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      for (const screen of screens) {
        await screen.open(page);
        await expect(page.locator(screen.ready).first(), `${screen.name} at ${w}`).toBeVisible();
        await page.waitForTimeout(400);
        await axeClean(page, `${screen.name} at ${w}x${h}`);
        await shot(page, `${screen.name}-${w}x${h}`);
      }
    }
  });
});

export type { Api };
