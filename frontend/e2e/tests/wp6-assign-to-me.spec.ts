import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * "Assign to me" (WP6: #234, #199): the first item of the Assignee menu in the work grids, and in Pod Work a link-button next to
 * "Unassigned" instead of an Actions column. One implementation: same call, an Undo toast ("Assigned to you."), the row refreshed.
 * Every test uses its own users, Pod and tagged tasks, so nothing depends on counts or order in the shared database.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-queue-review/fixes/wp-assign).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function axeClean(page: Page, what: string, include?: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page, include), what).toEqual([]);
}

const assigneeTrigger = (row: Locator) => row.getByRole('button', { name: /change assignee of/ });

async function setDensity(page: Page, name: 'Compact' | 'Comfortable'): Promise<void> {
  await page.getByRole('button', { name: 'Columns', exact: true }).click();
  await page.getByRole('radio', { name }).check();
  await page.keyboard.press('Escape');
}

test.describe('WP6: Assign to me', () => {
  test('#234: a technician outside the Pod gets "Assign to me" first in the Assignee menu; it assigns, and Undo puts the row back', async ({
    seed,
    admin,
    asUser,
  }) => {
    const token = uid();
    const tech = await seed.user(['Data Technician'], `wp6a-${token}`);
    const other = await seed.user(['Data Technician'], `wp6o-${token}`);
    const pod = await seed.pod(undefined, [other.userId]);
    const world = await seed.world();
    const title = `Take ${token}`;
    const task = await seed.task(world, { title, assignedPodId: pod.podId });

    const page = await asUser(tech.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(title);
    const row = queue.row(task.taskNumber);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Unassigned');

    const trigger = assigneeTrigger(row);
    await trigger.click();
    const pop = page.locator('.im-pop');
    const lead = pop.getByRole('button', { name: `Assign ${task.taskNumber} to me`, exact: true });
    await expect(lead).toBeVisible();
    // First in the menu: above the search box and the Pod's members, and where the keyboard starts from Arrow Up.
    const search = pop.getByRole('textbox', { name: 'Search people' });
    const lb = (await lead.boundingBox())!;
    const sb = (await search.boundingBox())!;
    expect(lb.y + lb.height).toBeLessThanOrEqual(sb.y);
    await expect(search).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(lead).toBeFocused();
    await shot(page, 'task-queue-assignee-menu-technician-1366x768');

    await lead.click();
    await expect(row).toContainText(tech.username);
    const toast = page.getByRole('button', { name: 'Undo' });
    await expect(toast).toBeVisible();
    await expect(page.locator('[data-undo-toast]')).toContainText('Assigned to you.');
    const stored = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(stored.assignedUser.userId).toBe(tech.userId);
    await shot(page, 'task-queue-assigned-undo-toast-1366x768');

    await toast.click();
    await expect(row).toContainText('Unassigned');
    await expect(row).not.toContainText(tech.username);
    const undone = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(undone.assignedUser ?? null).toBeNull();

    // Already the user's own task: the item is not offered.
    await assigneeTrigger(row).click();
    await page
      .locator('.im-pop')
      .getByRole('button', { name: /to me$/ })
      .click();
    await expect(row).toContainText(tech.username);
    await assigneeTrigger(row).click();
    await expect(page.locator('.im-pop')).toBeVisible();
    await expect(page.locator('.im-pop [data-lead]')).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`#234: the open Assignee menu has no axe violations at ${size.name}`, async ({
      seed,
      asUser,
    }) => {
      const token = uid();
      const tech = await seed.user(['Data Technician'], `wp6x-${token}`);
      const world = await seed.world();
      const title = `Menu ${token}`;
      const task = await seed.task(world, { title });
      const page = await asUser(tech.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      const queue = new TaskQueuePage(page);
      // The column filter row moves into a sheet on narrow windows, so the title is searched through the address.
      await queue.open(`?q=${encodeURIComponent(title)}`);
      const row = queue.row(task.taskNumber);
      await expect(row).toBeVisible();
      const trigger = assigneeTrigger(row);
      await trigger.scrollIntoViewIfNeeded();
      // The rows with the menu closed, then the open menu itself (a floating menu partly covers header buttons on a phone, and the
      // sideways-scrolled header of the Task Queue at 375 px already has a target-size finding of its own, outside this package).
      await axeClean(page, `Task Queue rows ${size.name}`, 'tbody, ul.tc-list');
      await trigger.click();
      await expect(
        page.getByRole('button', { name: `Assign ${task.taskNumber} to me`, exact: true }),
      ).toBeVisible();
      await shot(page, `task-queue-assignee-menu-open-${size.name}`);
      await axeClean(page, `Task Queue menu open ${size.name}`, '.im-pop');
    });
  }

  test('#234: a Read-Only Observer gets no Assignee menu and no Assign to me', async ({
    seed,
    personas,
    asUser,
  }) => {
    const token = uid();
    const observer = await personas.named('readOnlyObserver', { label: `wp6r-${token}` });
    const world = await seed.world();
    const title = `Watch ${token}`;
    const task = await seed.task(world, { title });
    const page = await asUser(observer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(title);
    const row = queue.row(task.taskNumber);
    await expect(row).toBeVisible();
    await expect(assigneeTrigger(row)).toHaveCount(0);
    await expect(row.getByRole('button', { name: /to me/ })).toHaveCount(0);
    await expect(row).toContainText('Unassigned');
  });

  test('#199: Pod Work has no Actions column; "Assign to me" sits next to Unassigned and assigns with an Undo toast', async ({
    seed,
    admin,
    asUser,
  }) => {
    const token = uid();
    const lead = await seed.user(['Pod Lead'], `wp6l-${token}`);
    const pod = await seed.pod(undefined, [lead.userId]);
    const world = await seed.world();
    const title = `Pod take ${token}`;
    const task = await seed.task(world, { title, assignedPodId: pod.podId });

    const page = await asUser(lead.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    await podWork.search(title);
    const row = podWork.row(task.taskNumber);
    await expect(row).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);

    const link = podWork.assignToMe(task.taskNumber);
    await expect(link).toBeVisible();
    await expect(link).toHaveText('Assign to me');
    // One line: the "Unassigned" menu trigger and the link share a row, in both densities.
    for (const density of ['Comfortable', 'Compact'] as const) {
      await setDensity(page, density);
      const a = (await assigneeTrigger(row).boundingBox())!;
      const b = (await link.boundingBox())!;
      expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)), density).toBeLessThan(4);
      expect(b.x, density).toBeGreaterThanOrEqual(a.x + a.width - 1);
      const cell = (await row.locator('td[data-col="assignee"]').boundingBox())!;
      expect(cell.height, density).toBeLessThanOrEqual(density === 'Compact' ? 40 : 56);
      await shot(page, `pod-work-link-${density.toLowerCase()}-1366x768`);
    }
    await setDensity(page, 'Comfortable');

    await link.click();
    await expect(row).toContainText(lead.username);
    await expect(page.locator('[data-undo-toast]')).toContainText('Assigned to you.');
    const stored = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(stored.assignedUser.userId).toBe(lead.userId);
    await shot(page, 'pod-work-assigned-undo-toast-1366x768');

    // Undo (inside the 4 seconds the row stays) puts it back as Unassigned with its link.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toContainText('Unassigned');
    await expect(link).toBeVisible();
    const undone = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(undone.assignedUser ?? null).toBeNull();

    // Taken again, the row leaves the Unassigned tab and the tab count follows.
    await link.click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  });

  for (const size of SIZES) {
    test(`#199: Pod Work with the link has no axe violations at ${size.name}`, async ({
      seed,
      asUser,
    }) => {
      const token = uid();
      const lead = await seed.user(['Pod Lead'], `wp6p-${token}`);
      const pod = await seed.pod(undefined, [lead.userId]);
      const world = await seed.world();
      const title = `Pod axe ${token}`;
      const task = await seed.task(world, { title, assignedPodId: pod.podId });
      const page = await asUser(lead.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      const podWork = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}&q=${encodeURIComponent(title)}`);
      await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
      await expect(podWork.row(task.taskNumber)).toBeVisible();
      const link = podWork.assignToMe(task.taskNumber);
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      await shot(page, `pod-work-link-${size.name}`);
      await axeClean(page, `Pod Work ${size.name}`);
      // And the menu of the same cell, open.
      await assigneeTrigger(podWork.row(task.taskNumber)).click();
      await expect(page.locator('.im-pop [data-lead]')).toBeVisible();
      await axeClean(page, `Pod Work menu open ${size.name}`, '.im-pop');
    });
  }

  test('#199: a Read-Only Observer sees no Assign to me in Pod Work', async ({
    seed,
    personas,
    asUser,
  }) => {
    const token = uid();
    const observer = await personas.named('readOnlyObserver', { label: `wp6q-${token}` });
    const pod = await seed.pod(undefined, [observer.userId]);
    const world = await seed.world();
    const title = `Pod watch ${token}`;
    const task = await seed.task(world, { title, assignedPodId: pod.podId });
    const page = await asUser(observer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    await podWork.search(title);
    await expect(podWork.row(task.taskNumber)).toBeVisible();
    await expect(podWork.assignToMe(task.taskNumber)).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  });
});
