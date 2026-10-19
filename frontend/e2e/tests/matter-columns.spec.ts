import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Matter Number and Matter Name columns (#348): the old Matter column is now "Matter Number" (the reference only, one line; storage key
 * `matter` unchanged), and "Matter Name" is a column of its own (one line, ellipsis, tooltip, link with Matter.View, server sort `matterName`).
 * Both are in the defaults of the Task Queue, every My Work tab and Pod Work; a user who never customised the columns gets Matter Name through
 * a one-time migration, a customised set is left alone. Every test seeds its own tagged data. Screenshots go to E2E_SCREENSHOTS when set
 * (docs/ux/task-queue-review/fixes/matter-name).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

const SIZES = [
  [375, 812],
  [768, 1024],
  [1366, 768],
  [1920, 1080],
] as const;

const RIGHTS = ['Task.View', 'Task.Create', 'Task.Assign', 'Matter.View', 'Pod.View'];

const headers = (page: Page): Promise<string[]> =>
  page
    .locator('thead tr')
    .first()
    .locator('th')
    .allTextContents()
    .then((t) => t.map((x) => x.trim()));

const th = (page: Page, key: string): Locator =>
  page.locator(`thead tr:first-child th[data-col="${key}"]`);
const sortButton = (page: Page, key: string): Locator => th(page, key).locator('button').first();
const columnsButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Columns', exact: true });
const width = async (page: Page, key: string): Promise<number> =>
  Math.round((await th(page, key).boundingBox())!.width);
const noPageScroll = (page: Page): Promise<boolean> =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
const columnText = async (page: Page, key: string): Promise<string[]> =>
  (await page.locator(`[data-task] td[data-col="${key}"]`).allTextContents()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );

const NAMES = (tag: string) => [`Zebra case ${tag}`, `apple case ${tag}`, `Éclair case ${tag}`];

/** Three matters of one client (names chosen so case and accents decide the order) and `perMatter` tasks on each, assigned to `me`. */
async function world(seed: Seeder, label: string, perMatter = 3, extraRights: string[] = []) {
  const tag = uid();
  const names = NAMES(tag);
  const role = await seed.role([...RIGHTS, ...extraRights], `E2E mc ${uid()}`);
  const me = await seed.user([role.name], label);
  const pod = await seed.pod(undefined, [me.userId]);
  const client = await seed.client({ name: `Matter cols client ${tag}` });
  const matters = [];
  for (const [i, name] of names.entries())
    matters.push(await seed.matter({ client, name, number: `0000${i + 1}` }));
  const base = await seed.world();
  const api = await Api.as(me.username);
  const tasks: { taskId: number; taskNumber: string; title: string; matter: number }[] = [];
  try {
    for (let n = 0; n < perMatter; n++) {
      for (const [i, matter] of matters.entries()) {
        const title = `Cols ${String(n * 3 + i).padStart(2, '0')} ${tag}`;
        const t = await seed.task(
          { ...base, matter },
          { title, assignedUserId: me.userId, assignedPodId: pod.podId },
          api,
        );
        tasks.push({
          taskId: Number(t['taskId']),
          taskNumber: String(t['taskNumber']),
          title,
          matter: i,
        });
      }
    }
  } finally {
    await api.dispose();
  }
  return { tag, names, me, pod, client, matters, tasks };
}

test.describe('Matter Number and Matter Name: defaults on every list (#348)', () => {
  test('Task Queue, My Work (four tabs) and Pod Work show Matter Number and Matter Name, the number cell has no name, axe at four sizes', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'mc-default', 2);
    // One task for each My Work tab: due soon, and one closed (needs the SQL container of run-local.sh).
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const api = await Api.as(w.me.username);
    try {
      const soon = await seed.task(
        { ...(await seed.world()), matter: w.matters[0] },
        { title: `Soon ${w.tag}`, assignedUserId: w.me.userId, dueDate: tomorrow },
        api,
      );
      if (Seeder.canWriteLegacyText()) {
        const done = await seed.task(
          { ...(await seed.world()), matter: w.matters[1] },
          { title: `Done ${w.tag}`, assignedUserId: w.me.userId },
          api,
        );
        seed.ageTask(Number(done['taskId']), { createdDaysAgo: 7, completedDaysAgo: 3 });
      }
      expect(soon['taskId']).toBeTruthy();
    } finally {
      await api.dispose();
    }

    const page = await asUser(w.me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Matter Number',
      'Matter Name',
      'Priority',
      'Assignee',
      'Due',
      'Status',
    ]);
    // The number cell holds the reference and nothing else; the name is in its own column (link with Matter.View, tooltip = the name).
    const row = page.locator(`[data-task="${w.tasks[0].taskNumber}"]`);
    const numberCell = row.locator('td[data-col="matter"]');
    await expect(numberCell.locator('a.mf-ref')).toHaveText(String(w.matters[0].matterRef));
    await expect(numberCell.locator('[data-matter-name]')).toHaveCount(0);
    await expect(numberCell).not.toContainText('Zebra');
    const nameLink = row.locator('td[data-col="matterName"] a');
    await expect(nameLink).toHaveText(w.names[0]);
    await expect(nameLink).toHaveAttribute('href', `/matters/${w.matters[0].matterId}`);
    await expect(nameLink).toHaveAttribute('title', w.names[0]);
    expect((await row.boundingBox())!.height).toBeCloseTo(44, 0);
    await shot(page, 'task-queue-1920x1080');

    const mw = new MyWorkPage(page);
    await mw.open();
    const active = [
      'Ref',
      'Title',
      'Matter Number',
      'Matter Name',
      'Workflow progress',
      'Priority',
      'Due',
      'Status',
    ];
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await headers(page)).toEqual(active);
    await shot(page, 'my-work-active-1920x1080');
    await mw.tab(/^Due soon and overdue/).click();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await headers(page)).toEqual(active);
    await mw.tab(/^Created by me/).click();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Matter Number',
      'Matter Name',
      'Priority',
      'Assignee',
      'Due',
      'Status',
      'Age',
    ]);
    await shot(page, 'my-work-created-by-me-1920x1080');
    if (Seeder.canWriteLegacyText()) {
      await mw.tab(/^Closed/).click();
      await expect(page.locator('[data-task]').first()).toBeVisible();
      expect(await headers(page)).toEqual([
        'Ref',
        'Title',
        'Matter Number',
        'Matter Name',
        'Status',
        'Closed',
      ]);
      await shot(page, 'my-work-closed-1920x1080');
    }

    const pod = new PodWorkPage(page);
    await pod.open();
    await pod.choosePod(String(w.pod['name']));
    await pod.tab(/^All pod tasks/).click();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Matter Number',
      'Matter Name',
      'Priority',
      'Assignee',
      'Due',
      'Status',
    ]);
    await shot(page, 'pod-work-1920x1080');

    for (const [wd, ht] of SIZES) {
      await page.setViewportSize({ width: wd, height: ht });
      await queue.open(`?q=${w.tag}`);
      await expect(page.locator('[data-task]').first()).toBeVisible();
      expect(await noPageScroll(page), `no page scroll at ${wd}`).toBe(true);
      await axeClean(page, `Task Queue ${wd}`);
      await mw.open();
      await expect(page.locator('[data-task]').first()).toBeVisible();
      expect(await noPageScroll(page), `My Work no page scroll at ${wd}`).toBe(true);
      await axeClean(page, `My Work ${wd}`);
      await pod.open();
      await pod.choosePod(String(w.pod['name']));
      await pod.tab(/^All pod tasks/).click();
      await expect(page.locator('[data-task]').first()).toBeVisible();
      expect(await noPageScroll(page), `Pod Work no page scroll at ${wd}`).toBe(true);
      await axeClean(page, `Pod Work ${wd}`);
    }
  });

  test('without Matter.View the number and the name are plain text; the name is still shown', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'mc-noview', 1);
    const role = await seed.role(['Task.View'], `E2E mc nv ${uid()}`);
    const viewer = await seed.user([role.name], 'mc-noview-v');
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new TaskQueuePage(page).open(`?q=${w.tag}`);
    const row = page.locator(`[data-task="${w.tasks[0].taskNumber}"]`);
    await expect(row.locator('td[data-col="matter"] a')).toHaveCount(0);
    await expect(row.locator('td[data-col="matter"] .mf-ref')).toHaveText(
      String(w.matters[0].matterRef),
    );
    await expect(row.locator('td[data-col="matterName"] a')).toHaveCount(0);
    await expect(row.locator('td[data-col="matterName"]')).toContainText(w.names[0]);
    await axeClean(page, 'no Matter.View');
  });

  test('the narrow-box rule: Matter Name drops out first, Matter Number never does, and the Title keeps 200 px', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'mc-narrow', 1);
    const page = await asUser(w.me.username);
    // 1366 px: the box is 1098 px, the Task Queue default needs 1140: Matter Name drops, nothing else.
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await headers(page)).toEqual([
      'Ref',
      'Title',
      'Matter Number',
      'Priority',
      'Assignee',
      'Due',
      'Status',
    ]);
    expect(await width(page, 'title')).toBeGreaterThanOrEqual(200);
    await shot(page, 'task-queue-narrow-1366x768');
    // 1440 px: the box is 1172 px and holds it with a Title of at least 200 px.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(th(page, 'matterName')).toBeVisible();
    expect(await width(page, 'title')).toBeGreaterThanOrEqual(200);
    await shot(page, 'task-queue-1440x900');
    // My Work at 1366 keeps Workflow progress (it was there before) and drops Matter Name.
    await page.setViewportSize({ width: 1366, height: 768 });
    const mw = new MyWorkPage(page);
    await mw.open();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    const keys = await headers(page);
    expect(keys).toContain('Matter Number');
    expect(keys).toContain('Workflow progress');
    expect(keys).not.toContain('Matter Name');
    expect(await width(page, 'title')).toBeGreaterThanOrEqual(200);
    await axeClean(page, 'narrow My Work');
    // 768 px: the Matter Number is still there, whatever the grid does with the rest.
    await page.setViewportSize({ width: 768, height: 1024 });
    await new TaskQueuePage(page).open(`?q=${w.tag}`);
    await expect(th(page, 'matter')).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    await axeClean(page, 'narrow 768');
  });
});

test.describe('Sorting by Matter Name (#348)', () => {
  test('server sort: ascending and descending, accents and case ignored, ties by matter number then id, stable across pages; Matter Number sort unchanged', async ({
    seed,
    asUser,
  }) => {
    // 27 tasks: three pages of 25 would be too many; two pages of 25 prove paging.
    const w = await world(seed, 'mc-sort', 9);
    const page = await asUser(w.me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const queue = new TaskQueuePage(page);

    const all = async (dir: 'asc' | 'desc'): Promise<{ names: string[]; titles: string[] }> => {
      const names: string[] = [];
      const titles: string[] = [];
      for (const p of [1, 2]) {
        await queue.open(`?q=${w.tag}&sort=matterName&dir=${dir}&pageSize=25&page=${p}`);
        await expect(page.locator('[data-task]').first()).toBeVisible();
        names.push(...(await columnText(page, 'matterName')));
        titles.push(...(await page.locator('[data-task] a.wt-title').allTextContents()));
      }
      return { names, titles };
    };

    const [zebra, apple, eclair] = w.names;
    const group = (name: string) => Array(9).fill(name);
    const asc = await all('asc');
    expect(asc.names).toEqual([...group(apple), ...group(eclair), ...group(zebra)]);
    // Ties fall back to the unique task id, in the direction of the sort.
    const byMatter = (m: number) => w.tasks.filter((t) => t.matter === m).map((t) => t.title);
    expect(asc.titles).toEqual([...byMatter(1), ...byMatter(2), ...byMatter(0)]);
    expect(new Set(asc.titles).size, 'no row repeats across the pages').toBe(27);

    const desc = await all('desc');
    expect(desc.names).toEqual([...group(zebra), ...group(eclair), ...group(apple)]);
    expect(desc.titles).toEqual([
      ...byMatter(0).reverse(),
      ...byMatter(2).reverse(),
      ...byMatter(1).reverse(),
    ]);

    // The header: first click ascending, second descending; aria-sort, URL and the "Sorted by" note say so.
    await queue.open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await sortButton(page, 'matterName').click();
    await expect(page).toHaveURL(/sort=matterName/);
    await expect(th(page, 'matterName')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Matter Name');
    await expect.poll(async () => (await columnText(page, 'matterName'))[0]).toBe(apple);
    await sortButton(page, 'matterName').click();
    await expect(th(page, 'matterName')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(async () => (await columnText(page, 'matterName'))[0]).toBe(zebra);
    await shot(page, 'sort-matter-name-desc-1920x1080');

    // Matter Number: by reference, as before (Zebra is 00001, apple 00002, Éclair 00003).
    await sortButton(page, 'matter').click();
    await expect(page).toHaveURL(/sort=matter(&|$)/);
    await expect(th(page, 'matter')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Matter Number');
    await expect.poll(async () => (await columnText(page, 'matterName'))[0]).toBe(zebra);
    const refs = await page.locator('[data-task] td[data-col="matter"]').allTextContents();
    expect(refs.map((r) => r.trim())).toEqual([...refs.map((r) => r.trim())].sort());

    // My Work and Pod Work take the same sort key.
    const mw = new MyWorkPage(page);
    await mw.open(`?sort=matterName&dir=asc`);
    await expect(th(page, 'matterName')).toHaveAttribute('aria-sort', 'ascending');
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Matter Name');
    const mine = await columnText(page, 'matterName');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]).toBe(apple);
    const pod = new PodWorkPage(page);
    await page.goto(`/pods/work?sort=matterName&dir=desc`);
    await pod.choosePod(String(w.pod['name']));
    await expect(th(page, 'matterName')).toHaveAttribute('aria-sort', 'descending');

    // Unknown keys are still a 400.
    const bad = await page.request.get('/api/v1/task-queue?sort=matterNam');
    expect(bad.status()).toBe(400);
  });
});

/** Seeds the stored column choice of a scope before the app starts (not over a value the app already wrote). */
async function store(page: Page, key: string, columns: string[]): Promise<void> {
  // Once per tab: the app removes a migrated key, and the next navigation must not put the old set back.
  await page.addInitScript(
    ([k, v]) => {
      if (sessionStorage.getItem(`seeded.${k}`)) return;
      sessionStorage.setItem(`seeded.${k}`, '1');
      if (!localStorage.getItem(k)) localStorage.setItem(k, v);
    },
    [key, JSON.stringify(columns)],
  );
}

test.describe('Migration of stored column choices (#348)', () => {
  const OLD_QUEUE = ['ref', 'title', 'matter', 'priority', 'assignee', 'due', 'status'];

  test('a stored set equal to the old default gets Matter Name; a customised set is left alone and Matter Name is in the Columns panel', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'mc-migrate', 1);
    const stored = await seed.user(['Data Technician'], 'mc-mig-default');
    const custom = await seed.user(['Data Technician'], 'mc-mig-custom');

    // Never customised: the stored set is the old default (written by an older release).
    const a = await asUser(stored.username);
    await a.setViewportSize({ width: 1920, height: 1080 });
    await store(a, `mf.work-columns.v2.taskQueue.${stored.userId}`, OLD_QUEUE);
    await store(a, `mf.work-columns.v2.myWork.${stored.userId}`, [
      'ref',
      'title',
      'matter',
      'priority',
      'progress',
      'due',
      'status',
    ]);
    await new TaskQueuePage(a).open(`?q=${w.tag}`);
    await expect(a.locator('[data-task]').first()).toBeVisible();
    await expect(th(a, 'matterName')).toBeVisible();
    expect((await headers(a)).slice(2, 4)).toEqual(['Matter Number', 'Matter Name']);
    await new MyWorkPage(a).open();
    await expect(th(a, 'matterName')).toBeVisible();
    // Another tab of the same page is untouched by the other scope: it shows its default (with Matter Name).
    await new TaskQueuePage(a).open(`?q=${w.tag}`);
    await expect(th(a, 'matterName')).toBeVisible();
    // The migration ran once: taking Matter Name out sticks across a reload.
    await columnsButton(a).click();
    await a.getByLabel('Matter Name', { exact: true }).uncheck();
    await expect(th(a, 'matterName')).toHaveCount(0);
    await a.reload();
    await expect(a.locator('[data-task]').first()).toBeVisible();
    await expect(th(a, 'matterName')).toHaveCount(0);

    // Customised: Client added to the old default. Nothing changes; the column is one click away.
    const b = await asUser(custom.username);
    await b.setViewportSize({ width: 1920, height: 1080 });
    await store(b, `mf.work-columns.v2.taskQueue.${custom.userId}`, [...OLD_QUEUE, 'client']);
    await new TaskQueuePage(b).open(`?q=${w.tag}`);
    await expect(b.locator('[data-task]').first()).toBeVisible();
    expect(await headers(b)).toEqual([
      'Ref',
      'Title',
      'Matter Number',
      'Client',
      'Priority',
      'Assignee',
      'Due',
      'Status',
    ]);
    await columnsButton(b).click();
    const name = b.getByLabel('Matter Name', { exact: true });
    await expect(name).not.toBeChecked();
    await name.check();
    await expect(th(b, 'matterName')).toBeVisible();
    await b.reload();
    await expect(b.locator('[data-task]').first()).toBeVisible();
    await expect(th(b, 'matterName')).toBeVisible();
    await shot(b, 'migration-customised-then-added-1920x1080');
  });
});

test.describe('Columns panel, header menu, resize and fit for Matter Name (#348)', () => {
  test('hide and show in the Where group, Reset columns, widths panel (default 160, min 112, max 360), Fit, header menu by keyboard, resize handle, persistence', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'mc-panel', 2);
    const page = await asUser(w.me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();

    await columnsButton(page).focus();
    await page.keyboard.press('Enter');
    const panel = page.locator('[data-columns-panel]');
    await expect(panel).toBeVisible();
    // The Where group: Matter Number, Matter Name, Client, Project in that order.
    const where = panel.getByRole('group', { name: 'Where' });
    await expect(where.locator('label')).toHaveText([
      /Matter Number/,
      /Matter Name/,
      /Client/,
      /Project/,
    ]);
    await shot(page, 'columns-panel-1920x1080');
    const check = panel.getByLabel('Matter Name', { exact: true });
    await expect(check).toBeChecked();
    await check.uncheck();
    await expect(th(page, 'matterName')).toHaveCount(0);
    await expect(th(page, 'matter')).toBeVisible();
    await check.check();
    await expect(th(page, 'matterName')).toBeVisible();
    // Reset columns after hiding returns the default.
    await check.uncheck();
    await panel.getByRole('button', { name: /Reset columns/ }).click();
    await expect(th(page, 'matterName')).toBeVisible();

    // Column widths: the numbers of the contract.
    const row = page.locator('[data-width-row="matterName"]');
    const field = row.locator('[data-width-input]');
    await expect(field).toHaveValue('160');
    await expect(page.locator('[data-width-row="matter"] [data-width-input]')).toHaveValue('144');
    await row.getByRole('button', { name: 'Widen Matter Name' }).click();
    await expect(field).toHaveValue('168');
    expect(await width(page, 'matterName')).toBe(168);
    await field.fill('50');
    await field.press('Enter');
    await expect(field).toHaveValue('112');
    await field.fill('999');
    await field.press('Enter');
    await expect(field).toHaveValue('360');
    // Fit: the long matter name fits, and the number is not clipped.
    await row.getByRole('button', { name: 'Fit Matter Name to content' }).click();
    const fitted = Number(await field.inputValue());
    expect(fitted).toBeGreaterThanOrEqual(112);
    expect(fitted).toBeLessThanOrEqual(360);
    expect(await width(page, 'matterName')).toBe(fitted);
    await page.keyboard.press('Escape');
    await expect(columnsButton(page)).toBeFocused();
    const clipped = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-task] td[data-col="matterName"] .mn'),
      )
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.textContent),
    );
    expect(clipped, 'fitted: no matter name is cut').toEqual([]);
    // Persisted under the scope, sparse.
    const widths = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith('mf.work-widths.v1.')) out[k] = JSON.parse(localStorage.getItem(k)!).w;
      }
      return out;
    });
    expect(Object.values(widths)[0]).toEqual({ matterName: fitted });
    await page.reload();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    expect(await width(page, 'matterName')).toBe(fitted);

    // Header menu from the keyboard: Shift+F10 on the sort button, Widen, Reset, Hide (the live region names the column).
    await sortButton(page, 'matterName').focus();
    await page.keyboard.press('Shift+F10');
    const menu = page.locator('[data-column-menu]');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-label', 'Matter Name column options');
    await shot(page, 'header-menu-matter-name-1920x1080');
    await menu.locator('[data-item="reset"]').focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    expect(await width(page, 'matterName')).toBe(160);
    await expect(page.locator('[data-width-note]')).toHaveText('Matter Name column 160 pixels');
    await sortButton(page, 'matterName').focus();
    await page.keyboard.press('Shift+F10');
    await menu.locator('[data-item="widen"]').focus();
    await page.keyboard.press('Enter');
    expect(await width(page, 'matterName')).toBe(168);
    // The drag handle: double-click fits, a drag resizes.
    const handle = page.locator('thead .wt-resize[data-resize="matterName"]');
    await handle.dblclick();
    await expect.poll(() => width(page, 'matterName')).not.toBe(168);
    const box = (await handle.boundingBox())!;
    const before = await width(page, 'matterName');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    // The handle moves the border it sits on: the width changes by the distance dragged (either way, by the side of the handle).
    expect(Math.abs((await width(page, 'matterName')) - before)).toBeGreaterThanOrEqual(15);
    // Hide from the menu.
    await sortButton(page, 'matterName').focus();
    await page.keyboard.press('Shift+F10');
    await menu.locator('[data-item="hide"]').focus();
    await page.keyboard.press('Enter');
    await expect(th(page, 'matterName')).toHaveCount(0);
    await expect(page.locator('[data-width-note]')).toHaveText('Matter Name column hidden');
    await axeClean(page, 'after hide');
  });

  test('the Matter Number header and its filter keep working (storage key unchanged)', async ({
    seed,
    asUser,
  }) => {
    const w = await world(seed, 'mc-filter', 1);
    const page = await asUser(w.me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new TaskQueuePage(page).open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]')).toHaveCount(3);
    await expect(page.getByLabel('Filter by Matter Number')).toBeVisible();
    await expect(page.getByLabel('Filter by Matter Name')).toHaveCount(0);
    await page.getByLabel('Filter by Matter Number').fill(String(w.matters[1].matterRef));
    await page.getByLabel('Filter by Matter Number').press('Enter');
    await expect(page.locator('[data-task]')).toHaveCount(1);
    await expect(columnsButton(page)).toBeVisible();
  });
});

test.describe('Compact density and print (#348)', () => {
  test('Compact keeps both columns on one line in 36 px rows', async ({ seed, asUser }) => {
    const w = await world(seed, 'mc-compact', 1);
    const page = await asUser(w.me.username);
    await page.addInitScript((id) => {
      localStorage.setItem(`mf.work-table.v3.queue.${id}`, JSON.stringify({ density: 'compact' }));
      localStorage.setItem(
        `mf.work-table.v3.my-work.${id}`,
        JSON.stringify({ density: 'compact' }),
      );
    }, w.me.userId);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await new TaskQueuePage(page).open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]')).toHaveCount(3);
    for (const r of await page.locator('[data-task]').all())
      expect((await r.boundingBox())!.height).toBeCloseTo(36, 0);
    await expect(page.locator('td[data-col="matterName"] .mn').first()).toBeVisible();
    await expect(page.locator('td[data-col="matter"] [data-matter-name]')).toHaveCount(0);
    await shot(page, 'task-queue-compact-1920x1080');
    await axeClean(page, 'compact');
    await new MyWorkPage(page).open();
    await expect(page.locator('[data-task]').first()).toBeVisible();
    for (const r of await page.locator('[data-task]').all())
      expect((await r.boundingBox())!.height).toBeCloseTo(36, 0);
  });

  test('print: both headers and cells print on one line each', async ({ seed, asUser }) => {
    const w = await world(seed, 'mc-print', 2);
    const page = await asUser(w.me.username);
    await page.setViewportSize({ width: 1366, height: 900 });
    await new TaskQueuePage(page).open(`?q=${w.tag}`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('table.wt')).toBeVisible();
    const printed = await headers(page);
    expect(printed).toContain('Matter Number');
    const tableWidth = await page
      .locator('table.wt')
      .evaluate((t) => t.getBoundingClientRect().width);
    expect(tableWidth).toBeGreaterThan(0);
    // One line per cell: the row is not taller than in the screen layout (the cells have no name line any more).
    const heights = await page
      .locator('[data-task]')
      .evaluateAll((rs) => rs.map((r) => r.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeLessThanOrEqual(46);
    await shot(page, 'print-emulation-1366');
    await page.emulateMedia({ media: 'screen' });
  });
});
