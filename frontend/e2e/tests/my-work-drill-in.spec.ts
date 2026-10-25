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
 * Drill-in keeps its place (M7 #160) and "Open in Task Queue" (M10 #163). Every test has its own user and tagged tasks and asserts nothing
 * about global counts. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/my-work-review/fixes/wp11).
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

const nav = (page: Page) => page.locator('nav a.mf-active');
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' });

test.describe('Drill-in keeps its place', () => {
  test('M7: from My Work the nav, crumb and Back link follow the list, and Back focuses the row left', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'drill');
    const world = await seed.world();
    const tag = uid();
    const tasks = [];
    for (let i = 1; i <= 3; i++) {
      tasks.push(
        await seed.task(world, {
          title: `Drill ${i} ${tag}`,
          assignedUserId: me.userId,
          dueDate: dateInZone(FIRM_ZONE, 1),
        }),
      );
    }
    const target = tasks[1];
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    const listPath = `?view=dueSoon&sort=due&dir=asc&matterText=${encodeURIComponent(world.matter.matterRef)}`;
    await myWork.open(listPath);
    await myWork.expectListed(...tasks.map((t) => t.title));
    const exact = new URL(page.url()).search;

    // Open with the keyboard: Tab to the link, Enter.
    const link = page.locator(`a.wt-title[data-task-id="${target.taskId}"]`);
    await expect(link).toHaveAttribute('href', `/tasks/${target.taskId}?from=my-work`);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks/${target.taskId}\\?from=my-work`));
    await expect(page.locator('[data-task-header]')).toBeVisible();

    await expect(nav(page)).toHaveText(['My Work']);
    const crumb = crumbs(page).getByRole('link').first();
    await expect(crumb).toHaveText('My Work');
    await expect(crumb).toHaveAttribute('href', `/my-work${exact}`);
    // The record header's "Back to My Work" link is the phone form of the crumb (hidden from 640 px); it goes to the same view.
    const back = page.getByRole('link', { name: 'Back to My Work', includeHidden: true });
    await expect(back).toBeHidden();
    await expect(back).toHaveAttribute('href', `/my-work${exact}`);
    await shot(page, 'm7-task-from-my-work-1366x768');
    if (axeAvailable()) expect(await axeViolations(page), 'task page').toEqual([]);

    // Browser Back: same list, focus on the title link of the row that was left.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp('/my-work\\?'));
    await expect(link).toBeFocused();
    expect(new URL(page.url()).search).toBe(exact);
    await expect(myWork.tab(/^Due soon and overdue/)).toHaveAttribute('aria-selected', 'true');
    await shot(page, 'm7-back-focus-row-1366x768');

    // The first crumb does the same, and leaves a row that is gone to the heading.
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-task-header]')).toBeVisible();
    await crumbs(page).getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp('/my-work\\?'));
    await expect(link).toBeFocused();
    expect(new URL(page.url()).search).toBe(exact);
  });

  test('M7: Task Queue and Pod Work keep their own place', async ({ seed, asUser }) => {
    const me = await seed.user(['Data Technician'], 'qdrill');
    const world = await seed.world();
    const pod = await seed.pod(undefined, [me.userId]);
    const tag = uid();
    const task = await seed.task(world, {
      title: `Queue ${tag}`,
      assignedUserId: me.userId,
      assignedPodId: pod.podId,
    });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });

    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${tag}`);
    await queue.expectListed(task.title);
    const queueSearch = new URL(page.url()).search;
    await page.locator(`a.wt-title[data-task-id="${task.taskId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?from=task-queue`));
    await expect(nav(page)).toHaveText(['Task Queue']);
    await expect(crumbs(page).getByRole('link').first()).toHaveText('Task Queue');
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute(
      'href',
      `/tasks${queueSearch}`,
    );
    await crumbs(page).getByRole('link').first().click();
    await expect(page.locator(`a.wt-title[data-task-id="${task.taskId}"]`)).toBeFocused();

    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    await podWork.tab(/^All open/).click();
    await podWork.expectListed(task.title);
    await page.locator(`a.wt-title[data-task-id="${task.taskId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?from=pod-work`));
    await expect(nav(page)).toHaveText(['Pod Work']);
    await expect(crumbs(page).getByRole('link').first()).toHaveText('Pod Work');
    await page.goBack();
    await expect(page.locator(`a.wt-title[data-task-id="${task.taskId}"]`)).toBeFocused();
  });

  test('M7: a new tab links to the plain list, an unknown from is ignored, and a plain visit does not steal focus', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'newtab');
    const world = await seed.world();
    const task = await seed.task(world, { title: `Tab ${uid()}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goto(`/tasks/${task.taskId}?from=my-work`);
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', '/my-work');
    await expect(nav(page)).toHaveText(['My Work']);

    await page.goto(`/tasks/${task.taskId}?from=nowhere`);
    await expect(page.locator('[data-task-header]')).toBeVisible();
    await expect(crumbs(page).getByRole('link').first()).toHaveText('Tasks');
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', '/tasks');
    await expect(page.getByRole('link', { name: /^Back to/ })).toHaveCount(0);
    await expect(nav(page)).toHaveText(['Task Queue']);

    // Reaching the list from the menu after a drill-in does not move focus to a row.
    await new MyWorkPage(page).open('?view=active');
    await page.locator('a.wt-title').first().click();
    await expect(page.locator('[data-task-header]')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'My Work', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
    await expect(page.locator('a.wt-title').first()).toBeVisible();
    await expect(page.locator('a.wt-title:focus')).toHaveCount(0);
  });

  test('M7: task page at every size has no axe violations and no sideways scroll', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'sizes');
    const world = await seed.world();
    const task = await seed.task(world, { title: `Sizes ${uid()}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/tasks/${task.taskId}?from=my-work`);
      // A phone has "Back to My Work"; from 640 px the crumb names the list.
      if (w < 640) await expect(page.getByRole('link', { name: 'Back to My Work' })).toBeVisible();
      else await expect(crumbs(page).getByRole('link').first()).toHaveText('My Work');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow, `no sideways scroll at ${w}`).toBe(false);
      await shot(page, `m7-task-back-link-${w}x${h}`);
      if (axeAvailable()) expect(await axeViolations(page), `task at ${w}`).toEqual([]);
    }
  });
});

test.describe('Open in Task Queue', () => {
  async function world(seed: Seeder) {
    const me = await seed.user(['Data Technician'], 'toqueue');
    const w = await seed.world();
    const admin = seed.admin;
    const page = await admin.get<Json>('/api/v1/priorities');
    const list: Json[] = (Array.isArray(page) ? page : page.items)
      .filter((p: Json) => p.isActive)
      .sort((a: Json, b: Json) => a.sortOrder - b.sortOrder);
    const tag = uid();
    const mk = (name: string, extra: Record<string, unknown>) =>
      seed.task(w, { title: `${name} ${tag}`, ...extra });
    // Active and Due soon and overdue: assigned to me.
    await mk('Over', { assignedUserId: me.userId, dueDate: dateInZone(FIRM_ZONE, -3) });
    await mk('Soon', {
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
      priorityId: list[0].id,
    });
    await mk('Far', { assignedUserId: me.userId, dueDate: dateInZone(FIRM_ZONE, 30) });
    await mk('Asap', { assignedUserId: me.userId });
    // Closed: assigned to me, then cancelled.
    const done = await mk('Done', { assignedUserId: me.userId });
    expect((await new TaskApi(admin, done.taskId).cancel('Not needed')).status).toBeLessThan(300);
    // Created by me, assigned to someone else, one of them closed.
    const mine = await Api.as(me.username);
    await seed.task(w, { title: `Made ${tag}`, assignedUserId: undefined }, mine);
    const madeDone = await seed.task(w, { title: `Made done ${tag}` }, mine);
    expect((await new TaskApi(admin, madeDone.taskId).cancel('Not needed')).status).toBeLessThan(
      300,
    );
    return { me, priorityId: list[0].id as number };
  }

  const TABS = [
    ['Active', /^Active/, 'active'],
    ['Due soon and overdue', /^Due soon and overdue/, 'dueSoon'],
    ['Closed', /^Closed/, 'completed'],
    ['Created by me', /^Created by me/, 'createdByMe'],
  ] as const;

  async function tabCount(page: Page, tab: RegExp): Promise<number> {
    const text = (await new MyWorkPage(page).tab(tab).textContent()) ?? '';
    return Number(/\((\d+)\)/.exec(text)?.[1]);
  }

  async function queueTotal(page: Page): Promise<number> {
    // The pager's range ("Showing 1-4 of 4"); the polite live region now reads "4 tasks, showing 1 to 4" (#227) and has no "of".
    // An empty list has no pager: the empty row says so.
    const range = page.locator('[data-range]');
    if ((await range.count()) === 0) return 0;
    const text = (await range.first().textContent()) ?? '';
    const m = /of (\d+)/.exec(text);
    return m ? Number(m[1]) : 0;
  }

  test('M10: the Task Queue total equals the tab count on all four tabs, with and without a filter', async ({
    seed,
    asUser,
  }) => {
    const { me, priorityId } = await world(seed);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    for (const filtered of [false, true]) {
      for (const [name, tab, view] of TABS) {
        await myWork.open(`?view=${view}${filtered ? `&priority=${priorityId}` : ''}`);
        await expect(myWork.tab(tab)).toHaveAttribute('aria-selected', 'true');
        await expect(myWork.tab(tab)).toContainText(/\(\d+\)/);
        const count = await tabCount(page, tab);
        const open = page.getByRole('link', { name: 'Open in Task Queue' });
        await expect(open).toHaveAttribute(
          'title',
          'Same tasks, in the shared queue with all columns',
        );
        await open.click();
        await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
        await expect(page.getByText(/Showing|No tasks/).first()).toBeVisible();
        await expect
          .poll(() => queueTotal(page), { message: `${name} filtered=${filtered}` })
          .toBe(count);
        if (!filtered && view === 'active') {
          await shot(page, 'm10-task-queue-from-active-1366x768');
        }
        const query = new URL(page.url()).searchParams;
        if (view === 'createdByMe') expect(query.get('creator')).toMatch(/^\d+$/);
        else expect(query.get('assignee')).toMatch(/^\d+$/);
        if (filtered) expect(query.get('priority')).toBe(String(priorityId));
        if (filtered && view === 'active') {
          // The row under the headers shows the carried filters.
          await expect(page.locator('tr[data-filter-row], thead tr').last()).toContainText('Me');
        }
        // Back returns to My Work with the same tab.
        await page.goBack();
        await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
      }
    }
  });

  test('M10: the link is a real link, in the toolbar on wide windows and in the Filters sheet at 375', async ({
    seed,
    asUser,
  }) => {
    const { me } = await world(seed);
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await myWork.open('?view=active');
      const open = page.getByRole('link', { name: 'Open in Task Queue' });
      if (w >= 1366) {
        await expect(open).toBeVisible();
        await expect(open).toHaveAttribute('href', /^\/tasks\?.*assignee=\d+/);
        await expect(open).toHaveAttribute('href', /status=NEW/);
        await expect(open.locator('i.pi')).toBeVisible();
        await expect(open.locator('.mw-qtext')).toBeVisible();
      } else {
        await expect(open).toHaveCount(0);
        await page.getByRole('button', { name: /^Filters/ }).click();
        const sheet = page.locator('[data-filter-sheet]');
        await expect(sheet.getByRole('link', { name: 'Open in Task Queue' })).toBeVisible();
        await shot(page, `m10-filters-sheet-link-${w}x${h}`);
        if (axeAvailable()) expect(await axeViolations(page), `sheet at ${w}`).toEqual([]);
        await sheet.getByRole('link', { name: 'Open in Task Queue' }).click();
        await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
      }
      await shot(page, `m10-toolbar-${w}x${h}`);
      if (w >= 1366 && axeAvailable())
        expect(await axeViolations(page), `toolbar at ${w}`).toEqual([]);
    }
  });
});
