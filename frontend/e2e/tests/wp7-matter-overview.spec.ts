import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Clients UX epic, WP7 (#263 Matter Overview, #264 task summary strip above the Matter and Project Tasks grids, #265 Project column).
 *
 * Matter A (a client with two projects), seeded so the numbers are known without asking the API:
 *   5 open far away (one in project 1), 2 overdue (one in project 1), 1 ASAP, 1 due in 1 day (project 1), 1 on hold, 1 completed
 *   so Open 10, Overdue 2, Due soon 1, ASAP 1, On hold 1; project 1 has 3 open (1 overdue, 1 due soon).
 * Matter B has no project and three open tasks (one overdue, one ASAP); matter C has a 150-character name and one task; matter D is empty.
 *
 * The consistency check follows each strip number into the Task Queue (the same scope and filters) and into the matter's own grid and
 * compares the totals, for three people with different permissions. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/clients-review/fixes/wp7).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [768, 1024],
  [375, 812],
] as const;

const KEYS = ['open', 'overdue', 'dueSoon', 'asap', 'onHold'] as const;
type Key = (typeof KEYS)[number];
const VIEW_PARAM: Record<Key, string | null> = {
  open: null,
  overdue: 'overdue',
  dueSoon: 'dueSoon',
  asap: 'asap',
  onHold: 'onHold',
};
const LABEL: Record<Key, string> = {
  open: 'Open',
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  asap: 'ASAP',
  onHold: 'On hold',
};
const A_NUMBERS: Record<Key, number> = { open: 10, overdue: 2, dueSoon: 1, asap: 1, onHold: 1 };
const P1_NUMBERS: Record<Key, number> = { open: 3, overdue: 1, dueSoon: 1, asap: 0, onHold: 0 };
const B_NUMBERS: Record<Key, number> = { open: 3, overdue: 1, dueSoon: 0, asap: 1, onHold: 0 };

const NAME_150 =
  'Regulatory Response Matter for the Second Wave of Custodian Interviews, Document Collection, Privilege Review and Production Across All Subsidiaries Q4';
const PROJECT_LONG = 'Demo Custodian wave 1 and the associated privilege review workstream';

interface Data {
  world: Awaited<ReturnType<Seeder['world']>>;
  a: Json;
  b: Json;
  c: Json;
  d: Json;
  e: Json;
  p1: Json;
  p2: Json;
}
let data: Data;

const day = (offset: number) => dateInZone(FIRM_ZONE, offset);

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const e = document.scrollingElement!;
    return { sw: e.scrollWidth, cw: e.clientWidth };
  });
  expect(m.sw, 'page scrolls sideways').toBeLessThanOrEqual(m.cw);
}

/** BUG-4 / BUG-5 class: no column is cut off by the grid's box unless the scroll hint says there is more. */
async function noSilentClipping(page: Page, what: string): Promise<void> {
  const wrap = page.locator('.wt-wrap').first();
  const overflowing = await wrap.evaluate((e) => e.scrollWidth - e.clientWidth > 1);
  if (overflowing) {
    await expect(page.locator('[data-scroll-hint].wt-hint--show'), `${what}: hint`).toBeVisible();
    return;
  }
  const clipped = await page.evaluate(() => {
    const box = document.querySelector('.wt-wrap')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.wt-wrap thead th'))
      .filter((th) => {
        const r = th.getBoundingClientRect();
        return r.width > 0 && (r.left < box.left - 1 || r.right > box.right + 1);
      })
      .map((th) => th.textContent?.trim());
  });
  expect(clipped, `${what}: clipped headers without the hint`).toEqual([]);
}

async function stripNumbers(page: Page, scope: string): Promise<Record<Key, number> | null> {
  const strip = page.locator(`${scope} [data-strip]`);
  if ((await strip.count()) === 0) return null;
  await expect(strip.locator('.n', { hasText: '--' }), 'numbers still loading').toHaveCount(0);
  const out = {} as Record<Key, number>;
  for (const key of KEYS) {
    out[key] = Number(await strip.locator(`[data-strip-item="${key}"] .n`).textContent());
  }
  return out;
}

/**
 * The rows of the matter or project grid (the data stays under one page of 25, so this is the grid total). A press starts a new load a
 * moment later, so the count is read once the requests are done and has stopped changing.
 */
async function gridTotal(page: Page): Promise<number> {
  await expect(page.locator('mf-scoped-tasks mf-task-table')).toBeVisible();
  const rows = page.locator('mf-scoped-tasks .wt-wrap tbody tr[data-task]');
  let last = -1;
  await expect
    .poll(
      async () => {
        await page.waitForLoadState('networkidle');
        const now = await rows.count();
        const settled = now === last;
        last = now;
        return settled;
      },
      { intervals: [250] },
    )
    .toBe(true);
  return last;
}

/** The total the Task Queue's pager reports ("Showing 1-25 of 9"); a queue with nothing to list has no pager and no row. */
async function queueTotal(page: Page): Promise<number> {
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  try {
    await expect(pager).toContainText(/of [\d,]+/, { timeout: 5000 });
  } catch {
    await page.waitForLoadState('networkidle');
    await expect(page.locator('mf-task-table')).toBeVisible();
    expect(await page.locator('.wt-wrap tbody tr[data-task]').count(), 'rows without a pager').toBe(
      0,
    );
    return 0;
  }
  const text = (await pager.textContent()) ?? '';
  return Number(text.match(/of ([\d,]+)/)![1].replace(/,/g, ''));
}

/** The Task Queue address of a strip item for a matter or a project (the Dashboard's queries with the scope). */
function queueUrl(scope: 'matter' | 'project', id: number, key: Key): string {
  const open = 'status=NEW&status=IN_PROGRESS&status=ON_HOLD';
  const s = `${scope}=${id}`;
  switch (key) {
    case 'open':
      return `/tasks?${s}&${open}`;
    case 'overdue':
      return `/tasks?${s}&${open}&overdue=true`;
    case 'dueSoon':
      return `/tasks?${s}&${open}&asap=false&overdue=false&dueTo=${day(2)}`;
    case 'asap':
      return `/tasks?${s}&${open}&asap=true`;
    case 'onHold':
      return `/tasks?${s}&status=ON_HOLD`;
  }
}

async function task(
  seed: Seeder,
  world: { taskType: Json; workflow: Json },
  matter: Json,
  due: number | null,
  title: string,
  project?: Json,
): Promise<Json> {
  return seed.task({ matter, taskType: world.taskType, workflow: world.workflow } as never, {
    title: `${title} ${uid()}`,
    ...(due === null ? {} : { dueDate: day(due) }),
    ...(project ? { projectId: project.projectId } : {}),
  });
}

test.beforeAll(async ({ seed }: { seed: Seeder }) => {
  const world = await seed.world({ stepCount: 1 });
  const client = world.client;
  const a = world.matter;
  const p1 = await seed.project(a, PROJECT_LONG);
  const p2 = await seed.project(a, `Second project ${uid()}`);
  for (let i = 1; i <= 4; i++) await task(seed, world, a, 10, `A far ${i}`);
  await task(seed, world, a, 10, 'A far 5', p1);
  await task(seed, world, a, -3, 'A late 1', p1);
  await task(seed, world, a, -5, 'A late 2');
  await task(seed, world, a, null, 'A asap');
  await task(seed, world, a, 1, 'A soon', p1);
  const held = await task(seed, world, a, 20, 'A held');
  expect(
    (await new TaskApi(seed.admin, held.taskId).changeStatus('ON_HOLD', 'Waiting')).status,
  ).toBe(200);
  const done = await task(seed, world, a, 5, 'A done');
  const doneApi = new TaskApi(seed.admin, done.taskId);
  await doneApi.completeSteps(1);
  expect((await doneApi.complete()).status).toBe(200);

  const b = await seed.matter({ client, number: '00002', name: `No projects ${uid()}` });
  await task(seed, world, b, 10, 'B far');
  await task(seed, world, b, -2, 'B late');
  await task(seed, world, b, null, 'B asap');

  const c = await seed.matter({ client, number: '00003', name: NAME_150 });
  await task(seed, world, c, 3, 'C only');
  const d = await seed.matter({ client, number: '00004', name: `Nothing yet ${uid()}` });
  const e = await seed.matter({ client, number: '00005', name: `Inline edits ${uid()}` });
  for (let i = 1; i <= 3; i++) await task(seed, world, e, 10, `E row ${i}`);
  data = { world, a, b, c, d, e, p1, p2 };
});

const mUrl = (m: Json, query = '') => `/matters/${m.matterId}${query}`;
const pUrl = (p: Json, query = '') => `/projects/${p.projectId}${query}`;
const ready = (page: Page) =>
  expect(page.locator('[data-record-header] h1 [data-name]')).toBeVisible();
const press = (page: Page, key: Key): Locator =>
  page.locator(`mf-scoped-tasks [data-strip-item="${key}"]`);

test.describe('WP7: Matter Overview (#263)', () => {
  test('the first tab is Overview: the strip comes first, then only the rows that are not in the header', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(mUrl(data.a));
    await ready(page);
    const overview = page.locator('[data-matter-overview]');
    await expect(overview.locator('[data-strip]')).toBeVisible();

    const tabs = (await page.getByRole('tab').allTextContents()).map((t) =>
      t.replace(/\s+/g, ' ').trim(),
    );
    expect(tabs).toEqual(['Overview', 'Tasks (10)', 'Projects (2)', 'Assets']);
    await expect(page.getByRole('tab', { name: /^Overview/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).not.toHaveURL(/tab=/);
    await expect(page).toHaveTitle(/Overview - MatterFlow$/);

    expect(await stripNumbers(page, '[data-matter-overview]')).toEqual(A_NUMBERS);
    expect(
      await overview
        .locator('[data-strip-item]')
        .evaluateAll((e) => e.map((x) => x.textContent!.replace(/\s+/g, ' ').trim())),
    ).toEqual(['Open 10', 'Overdue 2', 'Due soon 1', 'ASAP 1', 'On hold 1']);
    await expect(overview.locator('[data-strip-item="overdue"] .pi')).toBeVisible();

    // The reference, the matter number and the name are in the header; the rows are the rest.
    expect((await overview.locator('dt').allTextContents()).map((t) => t.trim())).toEqual([
      'Client',
      'Status',
      'Sensitive',
      'Created',
    ]);
    await expect(overview.getByText('Matter reference')).toHaveCount(0);
    await expect(overview.getByText('Matter number')).toHaveCount(0);

    // The strip is above the rows.
    const strip = (await overview.locator('[data-strip]').boundingBox())!;
    const dl = (await overview.locator('dl').boundingBox())!;
    expect(strip.y + strip.height).toBeLessThanOrEqual(dl.y);
    await shot(page, 'matter-overview');
  });

  test('a strip item opens the matter own Tasks tab on the view and the grid total equals the number; Back returns', async ({
    page,
  }) => {
    await page.goto(mUrl(data.a));
    await ready(page);
    for (const key of KEYS) {
      await page.goto(mUrl(data.a));
      const link = page.locator(`[data-matter-overview] [data-strip-item="${key}"]`);
      expect(await link.evaluate((e) => e.tagName)).toBe('A');
      await expect(link).not.toHaveAttribute('aria-pressed', /.*/);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/matters/${data.a.matterId}\\?tab=tasks`));
      const view = VIEW_PARAM[key];
      if (view) await expect(page).toHaveURL(new RegExp(`view=${view}$`));
      else await expect(page).not.toHaveURL(/view=/);
      await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(press(page, key)).toHaveAttribute('aria-pressed', 'true');
      expect(await gridTotal(page), `${key}: grid total`).toBe(A_NUMBERS[key]);
      // Back lands on the Overview again.
      await page.goBack();
      await expect(page.locator('[data-matter-overview]')).toBeVisible();
    }
  });

  test('Enter on a strip link follows it', async ({ page }) => {
    await page.goto(mUrl(data.a));
    const overdue = page.locator('[data-matter-overview] [data-strip-item="overdue"]');
    await overdue.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=tasks&view=overdue/);
    await expect(press(page, 'overdue')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a matter with nothing open shows real zeros, muted, in place', async ({ page }) => {
    await page.goto(mUrl(data.d));
    await ready(page);
    expect(await stripNumbers(page, '[data-matter-overview]')).toEqual({
      open: 0,
      overdue: 0,
      dueSoon: 0,
      asap: 0,
      onHold: 0,
    });
    await expect(page.locator('[data-strip-item="open"]')).toHaveClass(/zero/);
    await shot(page, 'matter-overview-empty');
  });

  test('a 150-character matter name does not push the strip below the fold at 1366x768', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(mUrl(data.c));
    await ready(page);
    const strip = (await page.locator('[data-matter-overview] [data-strip]').boundingBox())!;
    console.log(`150-character matter: strip bottom at y ${Math.round(strip.y + strip.height)}`);
    expect(strip.y + strip.height).toBeLessThan(768);
    await shot(page, 'matter-overview-long-name');
  });
});

test.describe('WP7: strip above the Tasks grids (#264)', () => {
  test('pressing an item applies its view; the total equals the number; toggling off, replacing, sort and Back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(mUrl(data.a, '?tab=tasks'));
    await ready(page);
    await expect(page.locator('mf-scoped-tasks [data-strip]')).toBeVisible();
    expect(await stripNumbers(page, 'mf-scoped-tasks')).toEqual(A_NUMBERS);
    expect(await gridTotal(page)).toBe(10);
    // Open is the default and shows as pressed.
    await expect(press(page, 'open')).toHaveAttribute('aria-pressed', 'true');

    // Sort by Title first; a strip item leaves the sort alone.
    await page
      .getByRole('button', { name: /^Title/ })
      .first()
      .click();
    const sorted = page.locator('mf-scoped-tasks th[aria-sort]:not([aria-sort="none"])');
    await expect(sorted).toHaveCount(1);
    const sortedName = (await sorted.textContent())!.trim();

    for (const key of ['overdue', 'dueSoon', 'asap', 'onHold'] as const) {
      await press(page, key).click();
      await expect(page).toHaveURL(new RegExp(`view=${VIEW_PARAM[key]}`));
      await expect(press(page, key)).toHaveAttribute('aria-pressed', 'true');
      await expect(press(page, 'open')).toHaveAttribute('aria-pressed', 'false');
      expect(await gridTotal(page), `${key}: grid total`).toBe(A_NUMBERS[key]);
      await expect(
        page.locator('mf-scoped-tasks th[aria-sort]:not([aria-sort="none"])'),
      ).toHaveText(sortedName);
    }

    // The pressed item switches off (back to the open list); Open does too.
    await press(page, 'onHold').click();
    await expect(page).not.toHaveURL(/view=/);
    expect(await gridTotal(page)).toBe(10);
    await press(page, 'asap').click();
    await press(page, 'open').click();
    await expect(page).not.toHaveURL(/view=/);
    expect(await gridTotal(page)).toBe(10);

    // Back restores the previous state.
    await press(page, 'overdue').click();
    expect(await gridTotal(page)).toBe(2);
    await page.goBack();
    await expect(page).not.toHaveURL(/view=/);
    await expect(press(page, 'open')).toHaveAttribute('aria-pressed', 'true');
    expect(await gridTotal(page)).toBe(10);
    await shot(page, 'matter-tasks-strip');

    // The view's own filters are shown disabled (Status), not editable on top of it.
    await press(page, 'overdue').click();
    await expect(page.locator('mf-scoped-tasks [data-strip-item="overdue"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await shot(page, 'matter-tasks-strip-overdue');
  });

  test('a deep link with an unknown view is the open list', async ({ page }) => {
    await page.goto(mUrl(data.a, '?tab=tasks&view=nonsense'));
    await ready(page);
    await expect(press(page, 'open')).toHaveAttribute('aria-pressed', 'true');
    expect(await gridTotal(page)).toBe(10);
  });

  test('leaving the Tasks tab drops the view', async ({ page }) => {
    await page.goto(mUrl(data.a, '?tab=tasks&view=asap'));
    await ready(page);
    expect(await gridTotal(page)).toBe(1);
    await page.getByRole('tab', { name: /^Projects/ }).click();
    await expect(page).not.toHaveURL(/view=/);
    await page.getByRole('tab', { name: /^Tasks/ }).click();
    await expect(press(page, 'open')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a project grid has the same strip with the project numbers; the Tasks (n) tab agrees', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(pUrl(data.p1));
    await ready(page);
    expect(await stripNumbers(page, 'mf-scoped-tasks')).toEqual(P1_NUMBERS);
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveText('Tasks (3)');
    for (const key of KEYS) {
      await press(page, key).click();
      expect(await gridTotal(page), `${key}: project grid total`).toBe(P1_NUMBERS[key]);
    }
    // Pressing a view does not change the tab count (it is the open count).
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveText('Tasks (3)');
    await shot(page, 'project-tasks-strip');

    // The same deep link works on a project.
    await page.goto(pUrl(data.p1, '?view=dueSoon'));
    await expect(press(page, 'dueSoon')).toHaveAttribute('aria-pressed', 'true');
    expect(await gridTotal(page)).toBe(1);
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveText('Tasks (3)');
  });

  test('an inline edit in the grid refreshes the strip', async ({ page }) => {
    await page.goto(mUrl(data.e, '?tab=tasks'));
    await ready(page);
    await expect(page.locator('mf-scoped-tasks [data-strip-item="open"] .n')).toHaveText('3');
    const row = page.locator('mf-scoped-tasks tbody tr[data-task]').first();
    await row.getByRole('button', { name: /change status of/ }).click();
    await page.locator('[data-option="CANCEL"]').click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-reason-body]') });
    await dialog.getByLabel(/Reason/).fill('No longer needed');
    await dialog.getByRole('button', { name: 'Cancel task' }).click();
    await expect(page.locator('mf-scoped-tasks [data-strip-item="open"] .n')).toHaveText('2');
  });

  test('the strip is one 40 px line and eight rows stay in view at 1366x768', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(mUrl(data.a, '?tab=tasks'));
    await ready(page);
    await gridTotal(page);
    const strip = (await page.locator('mf-scoped-tasks [data-strip]').boundingBox())!;
    expect(strip.height, 'strip height').toBeLessThanOrEqual(40);
    const rows = page.locator('mf-scoped-tasks .wt-wrap tbody tr[data-task]');
    const eighth = (await rows.nth(7).boundingBox())!;
    console.log(
      `1366x768: strip ${strip.height}px, row 8 bottom at y ${Math.round(eighth.y + eighth.height)}`,
    );
    expect(eighth.y + eighth.height, 'row 8 bottom').toBeLessThanOrEqual(768);
    expect(eighth.height).toBeGreaterThanOrEqual(44 - 1);
  });
});

test.describe('WP7: Project column (#265)', () => {
  test('a matter without projects has no Project column or filter; a matter with projects has one-line names with tooltips', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(mUrl(data.b, '?tab=tasks'));
    await ready(page);
    expect(await gridTotal(page)).toBe(3);
    const headers = (await page.locator('mf-scoped-tasks .wt-wrap thead th').allTextContents()).map(
      (t) => t.trim(),
    );
    expect(headers.join('|')).not.toMatch(/Project/);
    await expect(page.getByRole('tab', { name: /^Projects/ })).toHaveText('Projects (0)');

    await page.goto(mUrl(data.a, '?tab=tasks'));
    await ready(page);
    await gridTotal(page);
    const withProject = (
      await page.locator('mf-scoped-tasks .wt-wrap thead th').allTextContents()
    ).map((t) => t.trim());
    expect(withProject.join('|')).toMatch(/Project/);
    const cells = page.locator('mf-scoped-tasks mf-project-cell a');
    await expect(cells.first()).toBeVisible();
    const link = cells.first();
    await expect(link).toHaveAttribute('title', PROJECT_LONG);
    await expect(link).toHaveAttribute('href', new RegExp(`/projects/${data.p1.projectId}$`));
    // One line: the cell is as tall as the text, and the ellipsis takes the rest.
    const box = (await link.boundingBox())!;
    expect(box.height).toBeLessThan(24);
    const row = (await page.locator('mf-scoped-tasks tbody tr[data-task]').first().boundingBox())!;
    expect(row.height).toBeLessThanOrEqual(45);
    await shot(page, 'matter-tasks-project-column');
  });
});

for (const [w, h] of SIZES) {
  test(`WP7: axe clean, no sideways scroll, no silent clipping at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(mUrl(data.a));
    await ready(page);
    await expect(page.locator('[data-matter-overview] [data-strip-item="open"] .n')).toHaveText(
      '10',
    );
    await axeClean(page, `matter overview ${w}x${h}`);
    await noSidewaysScroll(page);
    if (w < 480) {
      const open = (await page.locator('[data-strip-item="open"]').boundingBox())!;
      expect(open.height, '44 px target on a phone').toBeGreaterThanOrEqual(44);
    }
    await shot(page, 'matter-overview');

    await page.goto(mUrl(data.a, '?tab=tasks&view=overdue'));
    await ready(page);
    expect(await gridTotal(page)).toBe(2);
    await axeClean(page, `matter tasks ${w}x${h}`);
    await noSidewaysScroll(page);
    await noSilentClipping(page, `matter tasks ${w}`);
    await shot(page, 'matter-tasks-strip');

    await page.goto(mUrl(data.a, '?tab=tasks'));
    await ready(page);
    await gridTotal(page);
    await axeClean(page, `matter tasks open ${w}x${h}`);
    await noSilentClipping(page, `matter tasks open ${w}`);

    await page.goto(pUrl(data.p1));
    await ready(page);
    expect(await gridTotal(page)).toBe(3);
    await axeClean(page, `project tasks ${w}x${h}`);
    await noSidewaysScroll(page);
    await noSilentClipping(page, `project tasks ${w}`);
    await shot(page, 'project-tasks-strip');
  });
}

test.describe('WP7: strip numbers equal the Task Queue totals behind each link and the grid totals, for three people', () => {
  const FULL = [
    'Matter.View',
    'Client.View',
    'Project.View',
    'Asset.View',
    'Task.View',
    'Task.Create',
  ];
  const NO_PROJECTS = ['Matter.View', 'Client.View', 'Task.View'];
  const NO_TASKS = ['Matter.View', 'Client.View', 'Project.View', 'Asset.View'];

  for (const who of [
    { label: 'full access', permissions: FULL },
    { label: 'no Project.View', permissions: NO_PROJECTS },
  ]) {
    test(`${who.label}: Overview strip = Task Queue total = grid total for every item (matter A, matter B, project 1)`, async ({
      asUser,
      seed,
    }) => {
      test.setTimeout(180_000); // 30 page loads: slow on a loaded machine
      const role = await seed.role(who.permissions, 'E2E matter overview');
      const user = await seed.user([role.name], 'mo');
      const page = await asUser(user.username);
      const canProject = who.permissions.includes('Project.View');

      for (const [matter, expected] of [
        [data.a, A_NUMBERS],
        [data.b, B_NUMBERS],
      ] as const) {
        await page.goto(mUrl(matter));
        await expect(page.locator('[data-matter-overview] [data-strip]')).toBeVisible();
        const numbers = (await stripNumbers(page, '[data-matter-overview]'))!;
        expect(numbers).toEqual(expected);
        for (const key of KEYS) {
          await page.goto(queueUrl('matter', matter.matterId, key));
          expect(await queueTotal(page), `matter ${matter.matterId} ${key}: Task Queue`).toBe(
            numbers[key],
          );
          await page.goto(
            mUrl(matter, `?tab=tasks${VIEW_PARAM[key] ? `&view=${VIEW_PARAM[key]}` : ''}`),
          );
          expect(await gridTotal(page), `matter ${matter.matterId} ${key}: grid`).toBe(
            numbers[key],
          );
          await expect(press(page, key)).toHaveAttribute('aria-pressed', 'true');
        }
      }

      // The project: its strip, its Task Queue totals and its grid (the page itself needs Project.View).
      if (canProject) {
        await page.goto(pUrl(data.p1));
        await expect(page.locator('mf-scoped-tasks [data-strip]')).toBeVisible();
        const numbers = (await stripNumbers(page, 'mf-scoped-tasks'))!;
        expect(numbers).toEqual(P1_NUMBERS);
        for (const key of KEYS) {
          await page.goto(queueUrl('project', data.p1.projectId, key));
          expect(await queueTotal(page), `project ${key}: Task Queue`).toBe(numbers[key]);
          await page.goto(pUrl(data.p1, VIEW_PARAM[key] ? `?view=${VIEW_PARAM[key]}` : ''));
          expect(await gridTotal(page), `project ${key}: grid`).toBe(numbers[key]);
        }
      }

      // The Project column links only with Project.View; the name is there either way.
      await page.goto(mUrl(data.a, '?tab=tasks'));
      await gridTotal(page);
      const cell = page.locator('mf-scoped-tasks mf-project-cell').filter({ hasText: 'Demo' });
      await expect(cell.first()).toBeVisible();
      await expect(cell.first().locator('a')).toHaveCount(canProject ? 1 : 0);
      await expect(page.locator('[role=alert]')).toHaveCount(0);
    });
  }

  test('no Task.View: no strip and no numbers, the Overview rows stay, the Tasks tab says so; never an error', async ({
    asUser,
    seed,
  }) => {
    const role = await seed.role(NO_TASKS, 'E2E matter overview no tasks');
    const user = await seed.user([role.name], 'mon');
    const page = await asUser(user.username);
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(mUrl(data.a));
      await ready(page);
      await expect(page.locator('[data-matter-overview] dl')).toBeVisible();
      await expect(page.locator('[data-strip]')).toHaveCount(0);
      await expect(page.locator('[role=alert]')).toHaveCount(0);
      expect(
        (await page.getByRole('tab').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()),
      ).toEqual(['Overview', 'Tasks', 'Projects (2)', 'Assets']);
      await axeClean(page, `no Task.View overview ${w}x${h}`);
      await noSidewaysScroll(page);
      await shot(page, 'matter-overview-no-task-view');

      await page.goto(mUrl(data.a, '?tab=tasks&view=overdue'));
      await expect(page.locator('[data-no-access=tasks]')).toBeVisible();
      await expect(page.locator('[data-strip]')).toHaveCount(0);
      await expect(page.locator('[role=alert]')).toHaveCount(0);
      await axeClean(page, `no Task.View tasks ${w}x${h}`);

      await page.goto(pUrl(data.p1));
      await expect(page.locator('[data-strip]')).toHaveCount(0);
      await expect(page.locator('[role=alert]')).toHaveCount(0);
      // Nothing was asked for that the person may not have: no 403 on any of these pages.
      expect(failed, 'failed requests').toEqual([]);
    }
  });
});
