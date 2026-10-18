import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, World, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Task Detail T2 "Header and facts strip" (#296 to #300): the shared record header (crumb, one-line 22 px title with a two-line clamp,
 * the muted context line, the one-line Sensitive note), the six-tile facts strip, Complete task / Reopen task as the header primary action
 * with the overflow (Put on hold or Resume, Copy link, Cancel task last) and the phone arrangement. Every test seeds its own records.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t2).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const LONG_TITLE =
  'Process and load the supplemental custodian collections for the Meridian second-request response, including Q3 mobile device images, Slack exports, shared network drives and the legacy archive restore'
    .slice(0, 200)
    .trim();
const LONG_MATTER =
  'In re Meridian Pharmaceuticals Securities Litigation - Consolidated Multidistrict Class Action Proceedings, Second Request for Production of Documents, Custodial Collections, Privilege Review'
    .padEnd(205, ' and Rolling Productions')
    .slice(0, 205);

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

/** Top of the Workflow heading in the window with the page scrolled to the top (the review's measure: "Workflow starts at y"). */
async function workflowTop(page: Page): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 0));
  return page
    .locator('[data-workflow-tab] [data-section-heading]')
    .evaluate((el) => Math.round(el.getBoundingClientRect().top));
}

/** The Status tile (the badge inside it carries `data-status` too). */
const STATUS = '[data-facts] li[data-status]';

/** The toast of the last action fades in and out; axe must not read it half transparent. */
async function waitForToastsToGo(page: Page): Promise<void> {
  await expect(page.locator('.p-toast-message')).toHaveCount(0, { timeout: 12_000 });
}

/** Opens the overflow menu if it is not open (at a new size it may still be open from the last one). */
function openOverflow(page: Page): () => Promise<void> {
  return async () => {
    const trigger = page.locator('[data-overflow]');
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    await expect(page.getByRole('menuitem').first()).toBeVisible();
  };
}

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

interface Fixture {
  world: World;
  pod: Json;
  tech: { username: string; userId: number };
  task: Json;
}

/** A task with a Pod and an assignee; `overrides` go to the create call. */
async function seeded(
  seed: Seeder,
  admin: Api,
  opts: {
    matter?: Json;
    sensitive?: boolean;
    task?: Json;
    stepCount?: number;
    assign?: boolean;
  } = {},
): Promise<Fixture> {
  const base = await seed.world({ sensitive: opts.sensitive, stepCount: opts.stepCount });
  const world = opts.matter
    ? {
        ...base,
        matter: await seed.matter({ client: base.client, number: '00002', ...opts.matter }),
      }
    : base;
  const role = await seed.role(
    [
      'Task.View',
      'Task.Edit',
      'Task.Complete',
      'Task.Reopen',
      'Workflow.Execute',
      'Matter.View',
      'Client.View',
      'Asset.View',
    ],
    'E2E technician',
  );
  const tech = await seed.user([role.name], 'tech');
  const pod = await seed.pod(`E2E Pod ${uid()}`, [tech.userId]);
  const task = await seed.task(world, { dueDate: dateInZone(FIRM_ZONE, -3), ...opts.task });
  if (opts.assign !== false) await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
  return { world, pod, tech, task };
}

test.describe('Task header T2: record header, 200-character title, targets (#296)', () => {
  test('a 200-character title on a 205-character matter: two title lines, one-line crumb, Workflow within the review target, axe 0 at four widths (drawer and Comments open too)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task, world } = await seeded(seed, admin, {
      matter: { name: LONG_MATTER },
      sensitive: true,
      task: { title: LONG_TITLE },
    });
    void world;
    const detail = new TaskDetailPage(page);
    const tops: Record<number, number> = {};
    const bottoms: Record<number, number> = {};
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await expect(page.locator('[data-task-header] [data-ref]')).toHaveText(task.taskNumber);
      // One h1 with the whole title in the document; the tooltip carries it too.
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toContainText(LONG_TITLE);
      await expect(page.locator('[data-task-header] [data-name]')).toHaveAttribute(
        'title',
        LONG_TITLE,
      );
      // 22 px at the H2 token (18 px on a phone), two lines at most.
      const title = await page.locator('[data-task-header] [data-name]').evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          font: cs.fontSize,
          lh: parseFloat(cs.lineHeight),
          h: el.getBoundingClientRect().height,
        };
      });
      expect(title.font).toBe(size.width < 640 ? '18px' : '22px');
      expect(title.h, `title height at ${size.width}`).toBeLessThanOrEqual(title.lh * 2 + 1);
      // The crumb is one line: the matter step is cut at 40 characters with the full text as its tooltip.
      if (size.width >= 640) {
        const crumbs = await box(page, 'nav[aria-label="Breadcrumb"] .rh__trail');
        expect(crumbs.height, `crumb height at ${size.width}`).toBeLessThanOrEqual(30);
      }
      const matter = page.locator('.rh__trail a[href*="/matters/"]');
      await expect(matter).toHaveAttribute('title', new RegExp(`^${world.matter.matterRef}`));
      await expect(page.locator('[data-crumb-current]')).toHaveAttribute('aria-current', 'page');
      tops[size.width] = await workflowTop(page);
      const strip = await box(page, '[data-facts]');
      bottoms[size.width] = Math.round(strip.y + strip.height);
    }
    // The review measured y 519 (1366) and 1230 (375) for this task; the targets are #296 (y <= 300) and #300 (y <= 480).
    expect(tops[1366], 'Workflow y at 1366').toBeLessThanOrEqual(300);
    expect(tops[1920], 'Workflow y at 1920').toBeLessThanOrEqual(300);
    // At 375 the Details disclosure and the Jump to row still sit between the strip and the Workflow (#307 moves them): the header's own
    // share is the strip's bottom edge plus one gap.
    expect(bottoms[375] + 16, 'Workflow y at 375 without Details and Jump to').toBeLessThanOrEqual(
      480,
    );
    console.log(
      'T2 long task Workflow y',
      JSON.stringify(tops),
      'strip bottom',
      JSON.stringify(bottoms),
    );

    await atEverySize(page, 'header-long', async () => {
      await detail.open(task.taskId);
    });
    // With the Activity drawer and Comments open.
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);
    await detail.ensureCommentsOpen();
    await page.locator('[data-action="activity"]').click();
    await expect(page.getByRole('dialog', { name: /^Activity:/ })).toBeVisible();
    await atEverySize(page, 'header-long-drawer', async () => {
      await expect(page.getByRole('dialog', { name: /^Activity:/ })).toBeVisible();
    });
  });

  test('a typical overdue task: Workflow at y <= 235 at 1366 and 1920 (as in the review, with the strip added)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    const detail = new TaskDetailPage(page);
    const tops: Record<number, number> = {};
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      tops[size.width] = await workflowTop(page);
    }
    console.log('T2 typical task Workflow y', JSON.stringify(tops));
    // The review measured 235 at 1366 for this task (header 223 px); the strip replaces the three-line block, so it does not get lower.
    expect(tops[1366]).toBeLessThanOrEqual(235);
    expect(tops[1920]).toBeLessThanOrEqual(235);
    await atEverySize(page, 'header-overdue', async () => {
      await detail.open(task.taskId);
    });
  });

  test('the crumb names the list the task was opened from; Back to <list> is the phone link; no old page header remains', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/tasks/${task.taskId}?from=my-work`);
    await expect(page.locator('[data-record-header][data-kind="task"]')).toBeVisible();
    await expect(page.locator('.rh__trail li a').first()).toHaveText('My Work');
    await expect(page.locator('[data-back-link]')).toHaveAttribute('href', '/my-work');
    await expect(page.locator('[data-back-link]')).toBeHidden();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('[data-back-link]')).toBeVisible();
    await expect(page.locator('[data-back-link]')).toContainText('Back to My Work');
    await expect(page.locator('.rh__trail')).toBeHidden();
    await page.locator('[data-back-link]').click();
    await expect(page).toHaveURL(/\/my-work/);
  });

  test('the crumb links keep a 24 px target and axe target-size passes on the long task (BUG-2)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      matter: { name: LONG_MATTER },
      task: { title: LONG_TITLE },
    });
    for (const size of SIZES.slice(1)) {
      await page.setViewportSize(size);
      await new TaskDetailPage(page).open(task.taskId);
      for (const link of await page.locator('.rh__trail a').all()) {
        const b = (await link.boundingBox())!;
        expect(b.height, `crumb link height at ${size.width}`).toBeGreaterThanOrEqual(23.5);
      }
      if (axeAvailable()) {
        const v = await axeViolations(page);
        expect(v.filter((x) => x.id === 'target-size')).toEqual([]);
      }
    }
  });
});

test.describe('Task header T2: facts strip, context line, Details trimmed (#297)', () => {
  test('six tiles in order; each of Type, Pod, Due and the Workflow name appears once; the layout follows the width (6 / 2 rows of 3 / 2x3)', async ({
    seed,
    admin,
    page,
  }) => {
    const { task, world, pod } = await seeded(seed, admin);
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      const labels = page.locator('[data-facts] .mf-facts__label');
      await expect(labels).toHaveText(['Status', 'Priority', 'Due', 'Assignee', 'Pod', 'Workflow']);
      const tops = await page
        .locator('[data-facts] .mf-facts__tile')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      const rows = new Set(tops).size;
      const columns = tops.filter((t) => t === tops[0]).length;
      if (size.width >= 1100) expect([rows, columns], `at ${size.width}`).toEqual([1, 6]);
      else if (size.width >= 640) expect([rows, columns], `at ${size.width}`).toEqual([2, 3]);
      else expect([rows, columns], `at ${size.width}`).toEqual([3, 2]);

      // Each fact once on the page (the Details panel and the Workflow head no longer repeat them).
      for (const once of [world.taskType.name, world.workflow.name, pod.name]) {
        await expect(
          page.getByText(once, { exact: false }),
          `${once} at ${size.width}`,
        ).toHaveCount(1);
      }
      await expect(page.locator('[data-section="details"]')).not.toContainText('Task type');
      await expect(page.locator('[data-facts] [data-due]')).toContainText('Overdue');
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);
    // The Due tooltip carries the full date and time zone (it left the Details panel).
    await expect(page.locator('[data-facts] [data-due] .dc')).toHaveAttribute('title', /20\d\d/);
    await atEverySize(page, 'facts-strip', async () => {
      await detail.open(task.taskId);
    });
  });

  test('the context line is one muted line with Matter, Client, Type and Workflow; links need Matter.View and Client.View', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task, world } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    const ctx = page.locator('[data-record-context]');
    await expect(ctx).toContainText(world.matter.matterRef);
    await expect(ctx).toContainText(world.taskType.name);
    await expect(ctx).toContainText(world.workflow.name);
    await expect(ctx.locator(`a[href="/matters/${world.matter.matterId}"]`)).toBeVisible();
    await expect(ctx.locator(`a[href="/clients/${world.client.clientId}"]`)).toBeVisible();
    expect((await ctx.boundingBox())!.height).toBeLessThanOrEqual(24);

    const role = await seed.role(['Task.View'], 'E2E view only');
    const user = await seed.user([role.name], 'viewonly');
    const view = await asUser(user.username);
    await view.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(view).open(task.taskId);
    const vctx = view.locator('[data-record-context]');
    await expect(vctx).toContainText(world.matter.matterRef);
    await expect(view.locator('main a[href^="/matters/"], main a[href^="/clients/"]')).toHaveCount(
      0,
    );
    await expect(view.locator('.rh__trail a')).toHaveCount(1);
  });

  test('Status, Priority and Assignee are the same inline menus with their accessible names; Details keeps Project, Requestor, Created', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { task: { dueDate: undefined } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(
      page.getByRole('button', { name: new RegExp(`change status of ${task.taskNumber}`) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`change priority of ${task.taskNumber}`) }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: new RegExp(`change assignee of ${task.taskNumber}`) }),
    ).toBeVisible();
    const details = page.locator('[data-section="details"]');
    await expect(details).toContainText('Requestor');
    await expect(details).toContainText('Created');
    await expect(details).toContainText('Project');
    await expect(page.locator('[data-facts] [data-due]')).toContainText('ASAP');
  });

  test('an unassigned task without a Pod shows an en dash and "Unassigned"; ASAP shows the bolt word', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { assign: false, task: { dueDate: undefined } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-facts] [data-pod]')).toContainText('–');
    await expect(page.locator('[data-facts] [data-pod] .mf-sr-only')).toHaveText('No pod');
    await expect(page.locator('[data-facts] [data-assignee]')).toContainText('Unassigned');
    await expect(page.locator('[data-facts] [data-due]')).toContainText('ASAP');
    await atEverySize(page, 'facts-unassigned-asap');
  });
});

test.describe('Task header T2: Sensitive note on one line (#299)', () => {
  test('a sensitive matter adds at most 40 px above the Workflow at 1366 and 375, and the sentence is in the tooltip and for screen readers', async ({
    seed,
    admin,
    page,
  }) => {
    const plain = await seeded(seed, admin);
    const sensitive = await seeded(seed, admin, { sensitive: true });
    for (const size of [SIZES[2], SIZES[0]]) {
      await page.setViewportSize(size);
      await new TaskDetailPage(page).open(plain.task.taskId);
      const before = await workflowTop(page);
      await new TaskDetailPage(page).open(sensitive.task.taskId);
      const after = await workflowTop(page);
      expect(after - before, `note height at ${size.width}`).toBeLessThanOrEqual(40);
    }
    const note = page.locator('[data-sensitive-banner]');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveAttribute('role', 'note');
    await expect(note).toHaveAttribute(
      'title',
      /Sensitive matter\..*does not restrict who can see them/,
    );
    await expect(note).toContainText('Sensitive matter.');
    await atEverySize(page, 'sensitive-note', async () => {
      await new TaskDetailPage(page).open(sensitive.task.taskId);
    });
  });
});

test.describe('Task header T2: primary action and overflow (#298)', () => {
  test('an open task: Edit, Activity and Complete task in the header, Put on hold, Copy link and Cancel task (last, set apart) in the overflow; keyboard like the Client and Matter menus', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { stepCount: 2 });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-page-actions] > button')).toHaveText([
      'Edit',
      /Activity/,
      /Complete task/,
    ]);
    await expect(page.locator('[data-action="complete"]')).toHaveClass(/mf-btn--primary/);
    // Nothing of that is left in the Workflow section or in a banner.
    await expect(page.locator('[data-workflow-tab] [data-complete-task-button]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete task' })).toHaveCount(1);

    const trigger = page.locator('[data-overflow]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem');
    await expect(items).toHaveText([/Put on hold/, /Copy link/, /Cancel task/]);
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await expect(items.last()).toHaveClass(/am__item--danger/);
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await shot(page, 'overflow-open');
    await page.keyboard.press('Escape');
    await expect(items).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await atEverySize(page, 'overflow-open', openOverflow(page));
  });

  test('Complete task from the header completes a task whose steps are done; Reopen task from the header brings it back', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { stepCount: 2 });
    await new TaskApi(admin, task.taskId).completeSteps(1, 2);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await page.locator('[data-action="complete"]').click();
    await expect(page.locator(STATUS)).toContainText('Completed');
    await expect(page.locator('[data-page-actions] > button')).toHaveText([
      /Activity/,
      /Reopen task/,
    ]);
    await expect(page.locator('[data-action="complete"]')).toHaveCount(0);
    // No Reopen/Complete/Cancel button in the Workflow section or in a banner.
    await expect(
      page.locator('[data-closed-banner] button, [data-workflow-tab] [data-reopen-task]'),
    ).toHaveCount(0);
    await waitForToastsToGo(page);
    await atEverySize(page, 'completed', async () => {
      await expect(page.locator('[data-action="reopen"]')).toBeVisible();
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator('[data-action="reopen"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
    await expect(page.locator(STATUS)).toContainText('In Progress');
    await expect(page.locator('[data-action="complete"]')).toBeVisible();
  });

  test('Cancel task from the overflow asks for a reason; a cancelled task offers Reopen task as the primary', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /Cancel task/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('Duplicate of an earlier request');
    await dialog.getByRole('button', { name: 'Cancel task' }).click();
    await expect(page.locator(STATUS)).toContainText('Cancelled');
    await expect(page.locator('[data-action="reopen"]')).toBeVisible();
    await waitForToastsToGo(page);
    await atEverySize(page, 'cancelled');
  });

  test('an On Hold task: Resume in the overflow and no primary button; Resume works from there', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    expect(
      (await new TaskApi(admin, task.taskId).changeStatus('ON_HOLD', 'Waiting for the custodian'))
        .status,
    ).toBeLessThan(300);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-page-actions] > button')).toHaveText(['Edit', /Activity/]);
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem')).toHaveText([/Resume/, /Copy link/, /Cancel task/]);
    await atEverySize(page, 'on-hold', openOverflow(page));
    await page.setViewportSize({ width: 1366, height: 768 });
    await openOverflow(page)();
    await page.getByRole('menuitem', { name: /Resume/ }).click();
    await expect(page.locator(STATUS)).toContainText('In Progress');
  });

  test('Copy link puts the task address on the clipboard and says so', async ({
    seed,
    admin,
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /Copy link/ }).click();
    await expect(page.locator('.p-toast-message')).toContainText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      new RegExp(`/tasks/${task.taskId}$`),
    );
  });

  test('Edit opens the Details form and returns focus to the Edit button', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    const edit = page.locator('[data-action="edit"]');
    await edit.click();
    await expect(page.getByRole('dialog', { name: 'Edit task details' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Edit task details' })).toHaveCount(0);
    await expect(edit).toBeFocused();
  });

  test('permissions: System Admin, assignee Data Technician, Task.View only without Matter, Client and Asset rights, and no Task.View', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task, tech } = await seeded(seed, admin);
    // System Admin
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-page-actions] > button')).toHaveText([
      'Edit',
      /Activity/,
      /Complete task/,
    ]);

    // The assignee Data Technician: may edit, complete and reopen, but not cancel or put on hold (no Task.ChangeStatus / Task.Cancel).
    const techPage = await asUser(tech.username);
    await techPage.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(techPage).open(task.taskId);
    await expect(techPage.locator('[data-page-actions] > button')).toHaveText([
      'Edit',
      /Activity/,
      /Complete task/,
    ]);
    await techPage.locator('[data-overflow]').click();
    await expect(techPage.getByRole('menuitem')).toHaveText([/Copy link/]);
    await techPage.keyboard.press('Escape');
    await expect(
      techPage.locator('[data-facts] [data-status] [data-inline-trigger]'),
    ).toBeVisible();

    // Task.View only, no Matter.View, Client.View or Asset.View: Activity only (plus Copy link), plain text instead of links, the View-only line.
    const role = await seed.role(['Task.View'], 'E2E view only');
    const viewer = await seed.user([role.name], 'viewonly');
    const v = await asUser(viewer.username);
    await v.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(v).open(task.taskId);
    await expect(v.locator('[data-page-actions] > button')).toHaveText([/Activity/]);
    await v.locator('[data-overflow]').click();
    await expect(v.getByRole('menuitem')).toHaveText([/Copy link/]);
    await v.keyboard.press('Escape');
    await expect(v.locator('[data-view-only]')).toBeVisible();
    await expect(v.locator('[data-facts] [data-inline-trigger]')).toHaveCount(0);
    await expect(v.locator('main a[href^="/matters/"], main a[href^="/clients/"]')).toHaveCount(0);
    await expect(v.locator('.p-toast-message')).toHaveCount(0);
    await atEverySize(v, 'permissions-view-only', async () => {
      await v.keyboard.press('Escape');
    });

    // No Task.View: the shared 403 page, no header.
    const none = await seed.role(['Client.View'], 'E2E no task view');
    const nobody = await seed.user([none.name], 'notask');
    const n = await asUser(nobody.username);
    await n.goto(`/tasks/${task.taskId}`);
    await expect(
      n.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(n.locator('[data-task-header]')).toHaveCount(0);
  });
});

test.describe('Task header T2: phone header (#300)', () => {
  test('at 375: Back to the list, the primary action and the overflow share one row of 44 px targets; Edit and Activity are in the overflow; the title is two lines of 18 px', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { task: { title: LONG_TITLE } });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/tasks/${task.taskId}?from=task-queue`);
    await expect(page.locator('[data-task-header] [data-ref]')).toBeVisible();
    const back = await box(page, '[data-back-link]');
    const primary = await box(page, '[data-action="complete"]');
    const menu = await box(page, '[data-overflow]');
    expect(Math.abs(primary.y - back.y), 'one row').toBeLessThan(30);
    expect(Math.abs(menu.y - primary.y)).toBeLessThan(10);
    expect(primary.height).toBeGreaterThanOrEqual(43.5);
    expect(menu.height).toBeGreaterThanOrEqual(43.5);
    expect(menu.width).toBeGreaterThanOrEqual(43.5);
    await expect(page.locator('[data-page-actions] > button')).toHaveText([/Complete task/]);
    await page.locator('[data-overflow]').click();
    await expect(page.getByRole('menuitem')).toHaveText([
      /Edit/,
      /Activity/,
      /Put on hold/,
      /Copy link/,
      /Cancel task/,
    ]);
    for (const item of await page.getByRole('menuitem').all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }
    if (axeAvailable()) expect(await axeViolations(page)).toEqual([]);
    await shot(page, 'phone-overflow');
    // Activity from the overflow opens the drawer.
    await page.getByRole('menuitem', { name: /Activity/ }).click();
    await expect(page.getByRole('dialog', { name: /^Activity:/ })).toBeVisible();
  });

  test('at 375 the header and strip end early enough for the Workflow to start at y <= 380 (typical) and <= 480 (200-character, sensitive); Details and Jump to still sit between until #307', async ({
    seed,
    admin,
    page,
  }) => {
    const typical = await seeded(seed, admin);
    const long = await seeded(seed, admin, {
      matter: { name: LONG_MATTER },
      sensitive: true,
      task: { title: LONG_TITLE },
    });
    await page.setViewportSize({ width: 375, height: 812 });
    const measure = async (taskId: number, name: string) => {
      await new TaskDetailPage(page).open(taskId);
      const workflow = await workflowTop(page);
      const strip = await box(page, '[data-facts]');
      await shot(page, name);
      return { workflow, stripBottom: Math.round(strip.y + strip.height) };
    };
    const a = await measure(typical.task.taskId, 'phone-typical');
    const b = await measure(long.task.taskId, 'phone-long');
    console.log('T2 phone (typical, long)', JSON.stringify({ a, b }));
    // Workflow would start one gap (16 px) under the strip. Today the Details disclosure and the Jump to row (#307 moves them) sit between.
    expect(a.stripBottom + 16, 'typical').toBeLessThanOrEqual(380);
    expect(b.stripBottom + 16, 'long').toBeLessThanOrEqual(480);
  });
});
