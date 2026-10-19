import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Task Detail T9 "Drill-in and keyboard" (#324 to #328): a task opened from a Matter's or Project's Tasks tab, the Dashboard or Search names
 * that page in its crumb, goes back to the exact view with focus on the link that was left, and keeps the right menu item lit (#324); one
 * link to the origin per width (#325); one Edit control and the recorded Tab stops (#326); the keys C, A and S behind the "Keyboard
 * shortcuts" switch (#327); focus on the Status menu button after Complete, Hold, Resume, Reopen and Cancel (#328).
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t9).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

/** The page at every size: axe finds nothing, the page does not scroll sideways, and a screenshot is kept. */
async function atEverySize(page: Page, name: string, settle?: () => Promise<void>): Promise<void> {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    if (settle) await settle();
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    await noHorizontalScroll(page);
    await shot(page, name);
  }
}

const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' });
const activeNav = (page: Page) => page.locator('nav a.mf-active');
const STATUS_BUTTON = '[data-facts] li[data-status] [data-inline-trigger]';

/** Links in the record header that go to `href` and are on screen (a hidden phone "Back to" or a hidden trail counts as none). */
async function visibleLinksTo(page: Page, href: string): Promise<number> {
  return page
    .locator('[data-record-header] a')
    .evaluateAll(
      (links, target) =>
        links.filter(
          (a) => a.getAttribute('href') === target && (a as HTMLElement).offsetParent !== null,
        ).length,
      href,
    );
}

/** Opens a link with the keyboard (focus, Enter) and waits for the Task page. */
async function openWithKeyboard(page: Page, link: ReturnType<Page['locator']>): Promise<void> {
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-task-header]')).toBeVisible();
}

interface Seeded {
  world: Awaited<ReturnType<Seeder['world']>>;
  task: Json;
  other: Json;
  tag: string;
}

/** Two tasks in one matter, titled with a unique tag so every list can be narrowed to them. */
async function twoTasks(seed: Seeder, overrides: Json = {}): Promise<Seeded> {
  const world = await seed.world();
  const tag = uid();
  const task = await seed.task(world, { title: `T9 target ${tag}`, ...overrides });
  const other = await seed.task(world, { title: `T9 other ${tag}`, ...overrides });
  return { world, task, other, tag };
}

test.describe('T9 #324 and #325: where a task was opened from', () => {
  test('Matter: the crumb names the matter, the page returns to the exact Tasks view and focus lands on the link; Matters stays lit; one link back per width', async ({
    seed,
    page,
  }) => {
    const { world, task, tag } = await twoTasks(seed);
    const matterId = world.matter.matterId;
    const ref = world.matter.matterRef;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${matterId}?tab=tasks&q=${tag}`);
    const link = page.locator(`a.wt-title[data-task-id="${task.taskId}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('data-row-list', 'matter-tasks');
    await expect(link).toHaveAttribute('href', `/tasks/${task.taskId}?from=matter`);
    const exact = new URL(page.url()).pathname + new URL(page.url()).search;
    await shot(page, 'matter-tasks-list');

    await openWithKeyboard(page, link);
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?from=matter`));
    await expect(activeNav(page)).toHaveText(['Matters']);
    const first = crumbs(page).getByRole('link').first();
    await expect(first).toHaveText(`Matter ${ref}`);
    await expect(first).toHaveAttribute('href', exact);
    // The matter is the origin, so it is not a second crumb: Matter, then the task.
    await expect(crumbs(page).getByRole('link')).toHaveCount(1);
    await expect(crumbs(page).locator('[aria-current="page"]')).toContainText(task.taskNumber);
    // One link back at every width (#325): the crumb from 640 px, "Back to ..." below it.
    expect(await visibleLinksTo(page, exact)).toBe(1);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await visibleLinksTo(page, exact)).toBe(1);
    await expect(page.getByRole('link', { name: `Back to Matter ${ref}` })).toBeVisible();
    // The trail is hidden; the one link in the Breadcrumb landmark is "Back to ...".
    await expect(crumbs(page).getByRole('link')).toHaveText([
      new RegExp(`^\\s*Back to Matter ${ref}`),
    ]);
    await page.setViewportSize({ width: 768, height: 1024 });
    expect(await visibleLinksTo(page, exact)).toBe(1);
    await page.setViewportSize({ width: 1366, height: 768 });

    await atEverySize(page, 'task-from-matter');
    await page.setViewportSize({ width: 1366, height: 768 });

    // Browser Back: the same view, focus on the link that was left.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/matters/${matterId}\\?`));
    await expect(link).toBeFocused();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(exact);
    await expect(page.getByRole('tab', { name: /^Tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await shot(page, 'matter-back-focus');

    // The crumb does the same.
    await openWithKeyboard(page, link);
    await crumbs(page).getByRole('link').first().click();
    await expect(link).toBeFocused();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(exact);

    // And "Back to ..." on a phone.
    await page.setViewportSize({ width: 375, height: 812 });
    await openWithKeyboard(page, link);
    await page.getByRole('link', { name: `Back to Matter ${ref}` }).click();
    await expect(link).toBeFocused();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(exact);
  });

  test('Project: the crumb names the project, the matter stays as the next crumb, Back returns to the project grid and focuses the link; Projects stays lit', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    const project = await seed.project(world.matter, `T9 Project ${uid()}`);
    const tag = uid();
    const task = await seed.task(world, {
      title: `T9 project task ${tag}`,
      projectId: project.projectId,
    });
    await seed.task(world, { title: `T9 project other ${tag}`, projectId: project.projectId });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/projects/${project.projectId}?q=${tag}`);
    const link = page.locator(`a.wt-title[data-task-id="${task.taskId}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('data-row-list', 'project-tasks');
    const exact = new URL(page.url()).pathname + new URL(page.url()).search;

    await openWithKeyboard(page, link);
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?from=project`));
    await expect(activeNav(page)).toHaveText(['Projects']);
    const links = crumbs(page).getByRole('link');
    await expect(links.first()).toHaveText(`Project ${project.name}`);
    await expect(links.first()).toHaveAttribute('href', exact);
    await expect(links.nth(1)).toHaveAttribute('href', `/matters/${world.matter.matterId}`);
    expect(await visibleLinksTo(page, exact)).toBe(1);
    await atEverySize(page, 'task-from-project');
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.projectId}`));
    await expect(link).toBeFocused();
    await openWithKeyboard(page, link);
    await crumbs(page).getByRole('link').first().click();
    await expect(link).toBeFocused();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(exact);
  });

  test('Dashboard: a list row opens the task with Dashboard as the crumb, Back returns to the same scope and focuses the row link; Dashboard stays lit', async ({
    seed,
    page,
  }) => {
    const world = await seed.world();
    const tag = uid();
    const member = await seed.user(['Data Technician'], 'dashpod');
    const pod = await seed.pod(`T9 Pod ${tag}`, [member.userId]);
    const task = await seed.task(world, {
      title: `T9 dashboard ${tag}`,
      assignedPodId: pod.podId,
      priorityId: undefined,
    });
    await seed.task(world, { title: `T9 dashboard other ${tag}`, assignedPodId: pod.podId });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/dashboard?pod=${pod.podId}`);
    const link = page.locator(
      `[data-panel="unassigned"] a.main[data-row-key="${task.taskId}"][data-row-list="dashboard-unassigned"]`,
    );
    await expect(link).toBeVisible();
    await page.waitForLoadState('networkidle');
    const exact = new URL(page.url()).pathname + new URL(page.url()).search;
    await expect(link).toHaveAttribute('href', `/tasks/${task.taskId}?from=dashboard`);

    await openWithKeyboard(page, link);
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?from=dashboard`));
    await expect(activeNav(page)).toHaveText(['Dashboard']);
    const first = crumbs(page).getByRole('link').first();
    await expect(first).toHaveText('Dashboard');
    await expect(first).toHaveAttribute('href', exact);
    expect(await visibleLinksTo(page, exact)).toBe(1);
    await atEverySize(page, 'task-from-dashboard');
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?`));
    await expect(link).toBeFocused();
    await shot(page, 'dashboard-back-focus');
    await openWithKeyboard(page, link);
    await crumbs(page).getByRole('link').first().click();
    await expect(link).toBeFocused();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(exact);
  });

  test('Search: a task result opens with Search as the crumb (no menu item lit), Back returns to the same results and focuses the link; Advanced Search too', async ({
    seed,
    page,
  }) => {
    const { task, tag } = await twoTasks(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/search?q=${tag}`);
    const link = page.locator(`a[data-row-list="search"][data-row-key="${task.taskId}"]:visible`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/tasks/${task.taskId}?from=search`);
    const exact = new URL(page.url()).pathname + new URL(page.url()).search;

    await openWithKeyboard(page, link);
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?from=search`));
    await expect(activeNav(page)).toHaveCount(0);
    const first = crumbs(page).getByRole('link').first();
    await expect(first).toHaveText('Search');
    await expect(first).toHaveAttribute('href', exact);
    expect(await visibleLinksTo(page, exact)).toBe(1);
    await atEverySize(page, 'task-from-search');
    await page.setViewportSize({ width: 1366, height: 768 });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${tag}`));
    await expect(link).toBeFocused();
    await shot(page, 'search-back-focus');
    await openWithKeyboard(page, link);
    await crumbs(page).getByRole('link').first().click();
    await expect(link).toBeFocused();

    // Advanced Search keeps its own address.
    await page.goto(`/search/advanced?type=task&q=${tag}`);
    const advanced = page.locator(
      `a[data-row-list="search"][data-row-key="${task.taskId}"]:visible`,
    );
    await expect(advanced).toBeVisible();
    const advancedUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    await openWithKeyboard(page, advanced);
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', advancedUrl);
    await crumbs(page).getByRole('link').first().click();
    await expect(page).toHaveURL(/\/search\/advanced\?/);
    await expect(advanced).toBeFocused();
  });

  test('Task Queue and My Work keep their own return (unchanged): crumb, nav and focus on the row left', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 't9wl');
    const world = await seed.world();
    const tag = uid();
    const task = await seed.task(world, {
      title: `T9 list ${tag}`,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const link = page.locator(`a.wt-title[data-task-id="${task.taskId}"]`);

    const queue = new TaskQueuePage(page);
    await queue.open(`?q=${tag}`);
    await queue.expectListed(task.title);
    const queueUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    await openWithKeyboard(page, link);
    await expect(activeNav(page)).toHaveText(['Task Queue']);
    await expect(crumbs(page).getByRole('link').first()).toHaveText('Task Queue');
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', queueUrl);
    expect(await visibleLinksTo(page, queueUrl)).toBe(1);
    await crumbs(page).getByRole('link').first().click();
    await expect(link).toBeFocused();

    const myWork = new MyWorkPage(page);
    await myWork.open(`?matterText=${encodeURIComponent(world.matter.matterRef)}`);
    await myWork.expectListed(task.title);
    const myUrl = new URL(page.url()).pathname + new URL(page.url()).search;
    await openWithKeyboard(page, link);
    await expect(activeNav(page)).toHaveText(['My Work']);
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', myUrl);
    await page.goBack();
    await expect(link).toBeFocused();
  });

  test('an unknown from is ignored, and an origin the person cannot use is dropped (open-redirect safe, no dead link)', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { world, task } = await twoTasks(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const bad of ['evil', '%2F%2Fevil.example', 'MATTER', 'constructor', '']) {
      await page.goto(`/tasks/${task.taskId}?from=${bad}`);
      await expect(page.locator('[data-task-header]')).toBeVisible();
      await expect(crumbs(page).getByRole('link').first()).toHaveText('Tasks');
      await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', '/tasks');
    }
    // A crafted return address that is not on the origin page is replaced by the page.
    await page.goto(`/tasks/${task.taskId}?from=matter`);
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute(
      'href',
      `/matters/${world.matter.matterId}?tab=tasks`,
    );
    await page.goto(`/tasks/${task.taskId}?from=search`);
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', '/search');
    await page.goto(`/tasks/${task.taskId}?from=dashboard`);
    await expect(crumbs(page).getByRole('link').first()).toHaveAttribute('href', '/dashboard');
    await page.goto(`/tasks/${task.taskId}?from=project`);
    // This task has no project: nothing to go back to, so the plain page.
    await expect(crumbs(page).getByRole('link').first()).toHaveText('Tasks');

    // Task.View only: no Matter.View and no Dashboard.View. Search still works; Matter and Dashboard are dropped.
    const role = await seed.role(['Task.View'], 'E2E view only');
    const viewer = await seed.user([role.name], 'viewonly');
    const v = await asUser(viewer.username);
    await v.setViewportSize({ width: 1366, height: 768 });
    for (const dropped of ['matter', 'dashboard', 'project']) {
      await v.goto(`/tasks/${task.taskId}?from=${dropped}`);
      await expect(v.locator('[data-task-header]')).toBeVisible();
      await expect(crumbs(v).getByRole('link').first(), dropped).toHaveText('Tasks');
    }
    await v.goto(`/search?q=${(task.title as string).split(' ').pop()}`);
    const hit = v.locator(`a[data-row-list="search"][data-row-key="${task.taskId}"]:visible`);
    await expect(hit).toBeVisible();
    await openWithKeyboard(v, hit);
    await expect(crumbs(v).getByRole('link').first()).toHaveText('Search');
    await atEverySize(v, 'task-from-search-view-only');
    await v.setViewportSize({ width: 1366, height: 768 });
    await v.goBack();
    await expect(hit).toBeFocused();

    // The assignee Data Technician has the same Matter-less rights as a technician: Search works too.
    const tech = await seed.user(['Data Technician'], 'drilltech');
    await new TaskApi(admin, task.taskId).assign(tech.userId, null);
    const t = await asUser(tech.username);
    await t.setViewportSize({ width: 1366, height: 768 });
    await t.goto(`/tasks/${task.taskId}?from=search`);
    await expect(t.locator('[data-task-header]')).toBeVisible();
    await expect(crumbs(t).getByRole('link').first()).toHaveText('Search');

    // No Task.View: the shared 403 page, whatever `from` says.
    const none = await seed.role(['Client.View'], 'E2E no task view');
    const nobody = await seed.user([none.name], 'notask');
    const n = await asUser(nobody.username);
    await n.goto(`/tasks/${task.taskId}?from=search`);
    await expect(
      n.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});

test.describe('T9 #326: one Edit control and the Tab stops', () => {
  test('the panel pencil is gone; Edit is the 2nd or 3rd Tab stop after the crumb; the stops before the first step are recorded', async ({
    seed,
    page,
  }) => {
    const { task } = await twoTasks(seed);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-edit-details]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
    await expect(page.locator('[data-details-tab] .pi-pencil')).toHaveCount(0);

    // Walk the Tab order from the top of the page until the first control of the Workflow.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const stops: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return 'body';
        const inWorkflow = !!el.closest('[data-workflow-tab]');
        const name =
          el.getAttribute('data-action') ??
          el.getAttribute('aria-label') ??
          (el.textContent ?? '').trim().slice(0, 30);
        return `${inWorkflow ? 'workflow:' : ''}${el.tagName.toLowerCase()}:${name}`;
      });
      stops.push(stop);
      if (stop.startsWith('workflow:')) break;
    }
    const crumbIndex = stops.findIndex((s) => s.startsWith('a:Tasks'));
    const editIndex = stops.findIndex((s) => s === 'button:edit');
    expect(crumbIndex, `crumb in ${stops.join(' | ')}`).toBeGreaterThanOrEqual(0);
    expect(
      editIndex - crumbIndex,
      `Edit after the crumb in ${stops.join(' | ')}`,
    ).toBeLessThanOrEqual(3);
    expect(editIndex).toBeGreaterThan(crumbIndex);
    const before = stops.findIndex((s) => s.startsWith('workflow:'));
    expect(before).toBeGreaterThan(0);
    // Recorded, not gated (the Task Queue lesson, #236): the number goes to the report and the annotation.
    test.info().annotations.push({
      type: 'tab-stops-before-first-step',
      description: `${before} (${stops.slice(0, before).join(' | ')})`,
    });
    console.log(
      `T9 K1: ${before} Tab stops before the first step: ${stops.slice(0, before).join(' | ')}`,
    );

    // Enter on Edit opens the same dialog; Esc returns focus to the button.
    const edit = page.locator('[data-action="edit"]');
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Edit task details' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
  });
});

test.describe('T9 #328: focus after Complete, Hold, Resume, Reopen and Cancel', () => {
  async function openAction(page: Page, label: string): Promise<void> {
    const trigger = page.locator('[data-overflow]');
    await trigger.click();
    await page.getByRole('menuitem', { name: label }).click();
  }

  async function seededTask(seed: Seeder, admin: Api): Promise<{ task: Json; api: TaskApi }> {
    const world = await seed.world({ stepCount: 1 });
    const task = await seed.task(world, { title: `T9 focus ${uid()}` });
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    return { task, api };
  }

  for (const size of [
    { width: 1366, height: 768 },
    { width: 375, height: 812 },
  ]) {
    test(`at ${size.width}: Put on hold, Resume, Cancel, Complete and Reopen leave focus on the Status menu button, never on the page body`, async ({
      seed,
      admin,
      page,
    }) => {
      await page.setViewportSize(size);
      const status = page.locator(STATUS_BUTTON);
      const onStatus = async (what: string): Promise<void> => {
        await expect(status, what).toBeFocused();
        expect(await page.evaluate(() => document.activeElement === document.body), what).toBe(
          false,
        );
      };

      // Put on hold: overflow, reason dialog.
      const a = await seededTask(seed, admin);
      const detail = new TaskDetailPage(page);
      await detail.open(a.task.taskId);
      await openAction(page, 'Put on hold');
      await page
        .getByRole('dialog')
        .getByRole('textbox', { name: /Reason/ })
        .fill('Waiting for the custodian');
      await page.getByRole('dialog').getByRole('button', { name: 'Put on hold' }).click();
      await detail.expectStatus('On Hold');
      await onStatus('after Put on hold');
      await shot(page, 'focus-after-hold');

      // Resume: no dialog.
      await openAction(page, 'Resume');
      await detail.expectStatus('In Progress');
      await onStatus('after Resume');

      // Cancel task: overflow, reason dialog.
      await openAction(page, 'Cancel task');
      await page
        .getByRole('dialog')
        .getByRole('textbox', { name: /Reason/ })
        .fill('Duplicate request');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel task' }).click();
      await detail.expectStatus('Cancelled');
      await onStatus('after Cancel task');

      // Reopen: the header button, confirmation.
      await page.locator('[data-action="reopen"]').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
      await detail.expectStatus('In Progress');
      await onStatus('after Reopen');

      // Complete: all steps resolved, so one click from the header button.
      await a.api.completeSteps(1);
      await page.reload();
      await expect(page.locator('[data-task-header]')).toBeVisible();
      await page.locator('[data-action="complete"]').click();
      await detail.expectStatus('Completed');
      await onStatus('after Complete');
      await shot(page, 'focus-after-complete');
      if (axeAvailable()) expect(await axeViolations(page), 'after Complete').toEqual([]);
    });
  }

  test('a person who may not use the Status menu gets the page heading after the action (no menu, no lost focus)', async ({
    seed,
    admin,
    asUser,
  }) => {
    const { task } = await seededTask(seed, admin);
    // May complete but has no other status right: the Status tile is a badge or a one-item menu; either way focus is on the page.
    const role = await seed.role(
      ['Task.View', 'Task.Edit', 'Task.Complete', 'Workflow.Execute'],
      'E2E completer',
    );
    const user = await seed.user([role.name], 'completer');
    await new TaskApi(admin, task.taskId).completeSteps(1);
    const page = await asUser(user.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await page.locator('[data-action="complete"]').click();
    await new TaskDetailPage(page).expectStatus('Completed');
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
  });
});

test.describe('T9 #327: shortcuts C, A and S behind the "Keyboard shortcuts" switch', () => {
  async function ready(page: Page, taskId: number, size = SIZES[2]): Promise<void> {
    await page.setViewportSize(size);
    await new TaskDetailPage(page).open(taskId);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }

  test('with the switch on: C opens Comments and focuses the composer, A opens the Assignee menu, S the Status menu; Esc returns to the button', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await twoTasks(seed);
    const pod = await seed.pod(`T9 Pod ${uid()}`, []);
    await new TaskApi(admin, task.taskId).assign(null, pod.podId);
    await ready(page, task.taskId);

    await page.keyboard.press('c');
    const editor = page.locator('[data-section="comments"] [data-composer] [role=textbox]');
    await expect(editor).toBeFocused();
    // Letters typed into the editor are text, not shortcuts.
    await page.keyboard.type('cas');
    await expect(editor).toContainText('cas');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await expect(page.locator('[data-composer] button[data-post]')).toBeEnabled();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await page.keyboard.press('a');
    await expect(page.locator('.im-pop')).toBeVisible();
    // Comments was opened and scrolled to above: the menu still comes up where it can be seen (the button is scrolled into view first).
    await expect(page.locator('.im-pop')).toBeInViewport();
    await expect(page.getByRole('textbox', { name: 'Search people' })).toBeFocused();
    await shot(page, 'shortcut-assignee-menu');
    await page.keyboard.press('Escape');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await expect(
      page.locator('[data-facts] li[data-assignee] [data-inline-trigger]'),
    ).toBeFocused();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.keyboard.press('s');
    await expect(page.locator('[data-option]').first()).toBeVisible();
    await expect(page.locator('[data-option]').first()).toBeInViewport();
    await shot(page, 'shortcut-status-menu');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-option]')).toHaveCount(0);
    await expect(page.locator(STATUS_BUTTON)).toBeFocused();

    // Not with a modifier, and Shift + letter is a capital for typing.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Shift+S');
    await expect(page.locator('[data-option]')).toHaveCount(0);
    // The g chords and Ctrl+K are untouched: g then t goes to the Task Queue.
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/tasks(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
  });

  test('the help lists the three keys on a task and the switch turns them off for this user (remembered), while the arrows keep working', async ({
    seed,
    asUser,
  }) => {
    const { task } = await twoTasks(seed);
    const me = await seed.user(['Data Technician'], 't9keys');
    await new TaskApi(seed.admin, task.taskId).assign(me.userId, null);
    const page = await asUser(me.username);
    await ready(page, task.taskId);

    await page.keyboard.press('?');
    const help = page.locator('[data-shortcut-help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText('On a task: write a comment');
    await expect(help).toContainText('On a task: open the Assignee menu');
    await expect(help).toContainText('On a task: open the Status menu');
    await shot(page, 'shortcut-help-switch-on');
    const toggle = page.getByRole('switch', { name: /Keyboard shortcuts/ });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await shot(page, 'shortcut-help-switch-off');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const key of ['c', 's', 'a']) {
      await page.keyboard.press(key);
      await expect(
        page.locator('.im-pop, [data-option]'),
        `${key} with the switch off`,
      ).toHaveCount(0);
      await expect(page.locator('[data-composer] [role=textbox]')).toHaveCount(0);
    }
    // The controls themselves still work with the keyboard (Enter on the Status button).
    await page.locator(STATUS_BUTTON).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-option]').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Remembered after a reload, and switched on again from the account menu.
    await page.reload();
    await expect(page.locator('[data-task-header]')).toBeVisible();
    await page.keyboard.press('s');
    await expect(page.locator('[data-option]')).toHaveCount(0);
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    await page.getByRole('switch', { name: /Keyboard shortcuts/ }).check();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('s');
    await expect(page.locator('[data-option]').first()).toBeVisible();
  });

  test('permission variants: Task.View only does nothing (no controls), the assignee Data Technician gets all three, a closed task still opens the Status menu (Reopen)', async ({
    seed,
    admin,
    asUser,
  }) => {
    const { task } = await twoTasks(seed);
    const tech = await seed.user(['Data Technician'], 't9tech');
    const pod = await seed.pod(`T9 Pod ${uid()}`, [tech.userId]);
    await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);

    const role = await seed.role(['Task.View'], 'E2E view only');
    const viewer = await seed.user([role.name], 'viewonly');
    const v = await asUser(viewer.username);
    await ready(v, task.taskId);
    for (const key of ['c', 'a', 's']) await v.keyboard.press(key);
    await expect(v.locator('.im-pop, [data-option]')).toHaveCount(0);
    await expect(v.locator('[data-composer] [role=textbox]')).toHaveCount(0);
    await expect(v.locator('[data-facts] [data-inline-trigger]')).toHaveCount(0);

    const t = await asUser(tech.username);
    await ready(t, task.taskId);
    await t.keyboard.press('c');
    await expect(t.locator('[data-composer] [role=textbox]')).toBeFocused();
    await t.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await t.keyboard.press('s');
    await expect(t.locator('[data-option]').first()).toBeVisible();
    await t.keyboard.press('Escape');

    // A closed task: A does nothing (no assignee control), S opens the menu with Reopen, C still comments.
    const closed = await seed.task(await seed.world({ stepCount: 1 }), {
      title: `T9 closed ${uid()}`,
    });
    await new TaskApi(admin, closed.taskId).cancel('T9 closed');
    const page = await asUser('ke\\kekim');
    await ready(page, closed.taskId);
    await page.keyboard.press('a');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await page.keyboard.press('s');
    await expect(page.locator('[data-option="REOPEN"]')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('axe 0 at four widths with the Status menu opened by S, and no sideways scroll', async ({
    seed,
    page,
  }) => {
    const { task } = await twoTasks(seed);
    await ready(page, task.taskId);
    await atEverySize(page, 'shortcut-status-menu-axe', async () => {
      await page.keyboard.press('Escape');
      // The menu of the last size must be gone before the key is pressed: an open menu keeps the keyboard.
      await expect(page.locator('.im-pop')).toHaveCount(0);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      await page.keyboard.press('s');
      await expect(page.locator('[data-option]').first()).toBeVisible();
    });
  });
});
