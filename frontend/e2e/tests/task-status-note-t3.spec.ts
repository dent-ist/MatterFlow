import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Task Detail T3 "Status note" (#301, #302): one neutral note under the header says who, when and why for a Completed, Cancelled or On Hold
 * task (no banners, no Workflow notices, no step lines), the Due tile of a closed task reads "Was due Oct 14", and Reopen task / Resume stay the
 * header's actions. Checked at four widths with axe and no sideways scroll, for Completed, Cancelled, On Hold, Overdue, ASAP and Sensitive
 * combinations. Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/t3).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const LONG_REASON =
  'The custodian has not returned the signed collection authorisation yet, and the vendor cannot start imaging until it arrives. ' +
  'Legal asked us to wait for the second request to be clarified before any further processing. We will check again on Friday and resume then if both are settled.';
const STAMP =
  /(Completed|Cancelled|On hold since) [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M by \S+/;

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

/** The page at every size: axe finds nothing, no sideways scroll, one status note, and a screenshot is kept. */
async function atEverySize(page: Page, detail: TaskDetailPage, taskId: number, name: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await detail.open(taskId);
    await expect(page.locator('[data-status-note]')).toHaveCount(1);
    await expect(page.locator('[data-toast]')).toHaveCount(0, { timeout: 12_000 });
    if (axeAvailable()) expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
    await noHorizontalScroll(page);
    await shot(page, name);
  }
}

/** The old banners and notices are gone from every state. */
async function noOldBanners(page: Page): Promise<void> {
  await expect(page.locator('[data-closed-banner], [data-status-reason]')).toHaveCount(0);
  await expect(page.locator('[data-workflow-notice], [data-blocked-reason]')).toHaveCount(0);
  await expect(page.locator('[data-workflow-tab]')).not.toContainText(/This task is /);
  await expect(page.locator('[data-workflow-tab]')).not.toContainText('Resume it');
}

async function seeded(
  seed: Seeder,
  admin: Api,
  opts: { sensitive?: boolean; task?: Json } = {},
): Promise<{ task: Json; api: TaskApi; world: Awaited<ReturnType<Seeder['world']>> }> {
  const world = await seed.world({ sensitive: opts.sensitive });
  const task = await seed.task(world, { dueDate: dateInZone(FIRM_ZONE, -3), ...opts.task });
  return { task, api: new TaskApi(admin, task.taskId), world };
}

const noteHeight = (page: Page) =>
  page.locator('[data-status-note]').evaluate((el) => el.getBoundingClientRect().height);

test.describe('Task status note T3 (#301, #302)', () => {
  test('Cancelled: one note with who, when and why (two lines at most), no other banner, Reopen task in the header; axe 0 at four widths', async ({
    seed,
    admin,
    page,
  }) => {
    const { task, api } = await seeded(seed, admin);
    expect((await api.cancel('Duplicate of an earlier request')).status).toBeLessThan(300);
    const detail = new TaskDetailPage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);
    const note = page.locator('[data-status-note]');
    await expect(note).toHaveAttribute('data-status', 'CANCELLED');
    await expect(note).toContainText(STAMP);
    await expect(note).toContainText('by ke\\kekim');
    await expect(note).toContainText('Duplicate of an earlier request');
    // The tooltip has the full date with the zone and the whole reason.
    await expect(page.locator('[data-note-text]')).toHaveAttribute(
      'title',
      /^Cancelled [A-Z][a-z]{2} \d{1,2}, \d{4}, .* by ke\\kekim\nDuplicate of an earlier request$/,
    );
    expect(await noteHeight(page), 'note height at 1366').toBeLessThanOrEqual(56);
    await noOldBanners(page);
    await expect(note.locator('button')).toHaveCount(0);
    await expect(page.locator('[data-action="reopen"]')).toBeVisible();
    await expect(page.locator('[data-facts] [data-due]')).toContainText(/Was due /);
    await atEverySize(page, detail, task.taskId, 'cancelled');
  });

  test('On Hold with a three-sentence reason: clamped to two lines with Show more / Show less; "On hold" is said once; Resume is in the overflow, not in the note', async ({
    seed,
    admin,
    page,
  }) => {
    const { task, api } = await seeded(seed, admin);
    expect((await api.changeStatus('ON_HOLD', LONG_REASON)).status).toBeLessThan(300);
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      const note = page.locator('[data-status-note]');
      await expect(note).toContainText(/On hold since [A-Z][a-z]{2} \d{1,2}, .* by ke\\kekim/);
      const more = note.locator('[data-note-more]');
      // The reason is three sentences: it needs more than two lines at 375 and at 768, and may fit two at the wide sizes.
      if (size.width <= 768) {
        await expect(more).toHaveText('Show more');
        expect(await noteHeight(page), `folded at ${size.width}`).toBeLessThanOrEqual(80);
        const folded = await noteHeight(page);
        await more.click();
        await expect(more).toHaveText('Show less');
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        expect(await noteHeight(page)).toBeGreaterThan(folded);
        if (axeAvailable()) expect(await axeViolations(page), `open at ${size.width}`).toEqual([]);
        await shot(page, 'on-hold-open');
        await more.click();
        await expect(more).toHaveText('Show more');
      }
      await expect(page.locator('[data-note-text]')).toHaveAttribute(
        'title',
        new RegExp(LONG_REASON.slice(0, 40)),
      );
      await noOldBanners(page);
      await expect(note.locator('button:not([data-note-more])')).toHaveCount(0);
      await noHorizontalScroll(page);
      if (axeAvailable()) expect(await axeViolations(page), `on hold at ${size.width}`).toEqual([]);
      await shot(page, 'on-hold');
    }
    // "On hold" appears in the status tile and the note only, never in the Workflow.
    await expect(page.locator('[data-workflow-tab]')).not.toContainText(/on hold/i);
    // Resume is the header's action (overflow) and works from there.
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /Resume/ }).click();
    await expect(page.locator('[data-status-note]')).toHaveCount(0);
  });

  test('Completed: "Completed <date> by <name>" and "Was due Oct 14" in the Due tile; a Completed task with no due date keeps the dash', async ({
    seed,
    admin,
    page,
  }) => {
    const { task, api } = await seeded(seed, admin, { task: { dueDate: '2026-10-14' } });
    await api.completeSteps(1, 2, 3);
    expect((await api.complete()).status).toBeLessThan(300);
    const detail = new TaskDetailPage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(task.taskId);
    const note = page.locator('[data-status-note]');
    await expect(note).toHaveAttribute('data-status', 'COMPLETED');
    await expect(note).toContainText(STAMP);
    await expect(note).toContainText('by ke\\kekim');
    await expect(page.locator('[data-facts] [data-due]')).toContainText('Was due Oct 14');
    await noOldBanners(page);
    await expect(page.locator('[data-action="reopen"]')).toBeVisible();
    await atEverySize(page, detail, task.taskId, 'completed');

    // No due date: the Due tile keeps its dash.
    const world = await seed.world();
    const asap = await seed.task(world, { dueDate: null });
    const asapApi = new TaskApi(admin, asap.taskId);
    await asapApi.completeSteps(1, 2, 3);
    expect((await asapApi.complete()).status).toBeLessThan(300);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(asap.taskId);
    await expect(page.locator('[data-facts] [data-due]')).not.toContainText('Was due');
    await expect(page.locator('[data-facts] [data-due]')).toContainText('-');
    await expect(page.locator('[data-status-note]')).toContainText(STAMP);
  });

  test('Sensitive + Overdue + ASAP combinations: Sensitive and Cancelled shows the Sensitive line and the note; Overdue and ASAP open tasks have no note; ASAP + On Hold; axe 0 at four widths', async ({
    seed,
    admin,
    page,
  }) => {
    const detail = new TaskDetailPage(page);
    const sensitive = await seeded(seed, admin, { sensitive: true });
    expect((await sensitive.api.cancel('Client withdrew the request')).status).toBeLessThan(300);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(sensitive.task.taskId);
    await expect(page.locator('[data-sensitive-banner]')).toBeVisible();
    await expect(page.locator('[data-status-note]')).toContainText('Client withdrew the request');
    await atEverySize(page, detail, sensitive.task.taskId, 'sensitive-cancelled');

    // Overdue (due 3 days ago) and open: no note at all, the Due tile says overdue.
    const overdue = await seeded(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.open(overdue.task.taskId);
    await expect(page.locator('[data-status-note]')).toHaveCount(0);
    await expect(page.locator('[data-facts] [data-due]')).toContainText(/Overdue/);

    // ASAP (no due date) and open: no note; then On Hold: the note and the ASAP tile together.
    const world = await seed.world();
    const asap = await seed.task(world, { dueDate: null });
    await detail.open(asap.taskId);
    await expect(page.locator('[data-status-note]')).toHaveCount(0);
    await expect(page.locator('[data-facts] [data-due]')).toContainText('ASAP');
    expect(
      (await new TaskApi(admin, asap.taskId).changeStatus('ON_HOLD', 'Waiting for the client'))
        .status,
    ).toBeLessThan(300);
    await detail.open(asap.taskId);
    await expect(page.locator('[data-facts] [data-due]')).toContainText('ASAP');
    await atEverySize(page, detail, asap.taskId, 'asap-on-hold');
  });

  test('permissions: Task.View only sees the same note (no buttons); the assignee Data Technician sees it and Reopen task; no Task.View gets the 403 page', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task, api } = await seeded(seed, admin);
    const role = await seed.role(
      ['Task.View', 'Task.Edit', 'Task.Complete', 'Task.Reopen', 'Workflow.Execute'],
      'E2E technician',
    );
    const tech = await seed.user([role.name], 'tech');
    const pod = await seed.pod(`E2E Pod ${uid()}`, [tech.userId]);
    await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
    expect((await api.cancel('Duplicate of an earlier request')).status).toBeLessThan(300);

    // System Admin.
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await expect(page.locator('[data-status-note]')).toContainText(
      'Duplicate of an earlier request',
    );

    const techPage = await asUser(tech.username);
    await techPage.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(techPage).open(task.taskId);
    await expect(techPage.locator('[data-status-note]')).toContainText('by ke\\kekim');
    await expect(techPage.locator('[data-action="reopen"]')).toBeVisible();
    await expect(techPage.locator('[data-status-note] button')).toHaveCount(0);

    const viewRole = await seed.role(['Task.View'], 'E2E view only');
    const viewer = await seed.user([viewRole.name], 'viewonly');
    const v = await asUser(viewer.username);
    for (const size of SIZES) {
      await v.setViewportSize(size);
      await new TaskDetailPage(v).open(task.taskId);
      await expect(v.locator('[data-status-note]')).toContainText(
        'Duplicate of an earlier request',
      );
      await expect(v.locator('[data-status-note] button')).toHaveCount(0);
      await expect(v.locator('[data-view-only]')).toBeVisible();
      if (axeAvailable()) expect(await axeViolations(v), `view only at ${size.width}`).toEqual([]);
      await noHorizontalScroll(v);
    }
    await shot(v, 'view-only-cancelled');

    const none = await seed.role(['Client.View'], 'E2E no task view');
    const nobody = await seed.user([none.name], 'notask');
    const n = await asUser(nobody.username);
    await n.goto(`/tasks/${task.taskId}`);
    await expect(
      n.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(n.locator('[data-status-note]')).toHaveCount(0);
  });
});
