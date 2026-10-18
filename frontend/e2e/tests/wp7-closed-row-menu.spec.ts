import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { TaskApi } from '../support/tasks';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Task Queue review BUG-TQ4 / TQ26 (#235): the Status menu of a Completed or Cancelled row offers only Reopen, and the server refuses
 * to cancel a Completed task. Every test uses its own user and tagged tasks.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/task-queue-review/fixes/wp-actions (otherwise none are written).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

test.describe('#235: a closed row is only reopened', () => {
  for (const size of SIZES) {
    test(`My Work: Completed and Cancelled rows offer only Reopen, axe clean at ${size.name}`, async ({
      seed,
      asUser,
      admin,
    }) => {
      const token = uid();
      const me = await seed.user(['Data Technician'], `tq4-${token}`);
      const world = await seed.world();
      const done = await seed.task(world, { title: `Done ${token}`, assignedUserId: me.userId });
      const gone = await seed.task(world, { title: `Gone ${token}`, assignedUserId: me.userId });
      const doneApi = new TaskApi(admin, done.taskId);
      await doneApi.completeSteps(1, 2, 3);
      expect((await doneApi.complete()).status).toBeLessThan(300);
      expect((await new TaskApi(admin, gone.taskId).cancel('setup')).status).toBeLessThan(300);
      const page = await asUser(me.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      const myWork = new MyWorkPage(page);
      await myWork.open('?view=completed');

      for (const title of [`Done ${token}`, `Gone ${token}`]) {
        const row = myWork.row(title);
        await expect(row).toHaveCount(1);
        await row.getByRole('button', { name: /change status of/ }).click();
        await expect(page.locator('[data-option]')).toHaveCount(1);
        await expect(page.locator('[data-option="REOPEN"]')).toBeVisible();
        await expect(page.locator('[data-option="CANCEL"]')).toHaveCount(0);
        if (axeAvailable()) expect(await axeViolations(page), title).toEqual([]);
        if (title.startsWith('Done')) await shot(page, `tq-closed-row-status-menu-${size.name}`);
        await page.keyboard.press('Escape');
      }
    });
  }

  test('Task Queue: a Completed row offers only Reopen; an open row still offers Cancel; the API refuses to cancel a Completed task', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `tq4q-${token}`);
    const world = await seed.world();
    const done = await seed.task(world, { title: `QDone ${token}`, assignedUserId: me.userId });
    await seed.task(world, { title: `QOpen ${token}`, assignedUserId: me.userId });
    const api = new TaskApi(admin, done.taskId);
    await api.completeSteps(1, 2, 3);
    expect((await api.complete()).status).toBeLessThan(300);

    const refused = await api.cancel('Cancel after completion');
    expect(refused.status).toBe(409);
    expect(refused.body?.code).toBe('INVALID_STATUS_TRANSITION');

    const page = await asUser(me.username);
    const queue = new TaskQueuePage(page);
    await queue.open('?status=COMPLETED');
    await queue.titleFilter.fill(`QDone ${token}`);
    const row = queue.row(`QDone ${token}`);
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: /change status of/ }).click();
    await expect(page.locator('[data-option]')).toHaveCount(1);
    await expect(page.locator('[data-option="REOPEN"]')).toBeVisible();
    await page.keyboard.press('Escape');

    await queue.open('?status=IN_PROGRESS');
    await queue.titleFilter.fill(`QOpen ${token}`);
    const open = queue.row(`QOpen ${token}`);
    await expect(open).toHaveCount(1);
    await open.getByRole('button', { name: /change status of/ }).click();
    await expect(page.locator('[data-option="CANCEL"]')).toBeVisible();
  });
});
