import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { expect, test } from '../support/fixtures';
import type { Seeder } from '../support/seed';
import { atEverySize } from '../support/screens';
import { uid } from '../support/seed';

/**
 * One toast API, copy rule (S16 callers, #617): an Undo toast is a short sentence, at most one more line, and the long explanation is the tooltip
 * of the Undo button. The assignment that starts a New task used to run to four lines ("Assigned to you. Task moved to In Progress. Undo puts
 * the assignee back; the status stays.").
 */
test.describe('Toast copy rule (#617)', () => {
  test.setTimeout(240_000);

  /** A technician in a Pod and a New task of it, opened in the Task Queue and assigned to the technician through the Assignee menu. */
  async function assignToMe(
    seed: Seeder,
    asUser: (username: string) => Promise<Page>,
    size: { width: number; height: number },
  ) {
    const token = uid();
    const tech = await seed.user(['Data Technician'], `sh5c-${token}`);
    const pod = await seed.pod(undefined, [tech.userId]);
    const world = await seed.world();
    const title = `Rule ${token}`;
    const task = await seed.task(world, { title, assignedPodId: pod.podId });
    const page = await asUser(tech.username);
    await page.setViewportSize(size);
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(title);
    const row = queue.row(task.taskNumber);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /change assignee of/ }).click();
    await page
      .locator('.im-pop')
      .getByRole('button', { name: `Assign ${task.taskNumber} to me`, exact: true })
      .click();
    return { page, row, task, toast: page.locator('[data-undo-toast]') };
  }

  test('assigning a New task to yourself: two short lines, the explanation in the Undo tooltip, Undo works from the keyboard', async ({
    seed,
    admin,
    asUser,
  }) => {
    const { page, row, task, toast } = await assignToMe(seed, asUser, { width: 1366, height: 768 });
    await expect(toast.locator('[data-undo-message]')).toHaveText('Assigned to you.');
    await expect(toast.locator('[data-toast-detail]')).toHaveText('Task moved to In Progress.');
    await expect(toast).not.toContainText('Undo puts the assignee back');
    await expect(toast.getByRole('button', { name: 'Undo' })).toHaveAttribute(
      'title',
      /Undo puts the assignee back; the status stays\./,
    );
    // At most two lines of text beside the Undo button (about 2 x 20 px plus padding).
    const box = (await toast.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(84);
    // Keyboard only: Undo takes focus (which also holds the countdown) and Enter puts the assignee back.
    await toast.getByRole('button', { name: 'Undo' }).focus();
    await page.keyboard.press('Enter');
    await expect(row).toContainText('Unassigned');
    const stored = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(stored.assignedUser ?? null).toBeNull();
  });

  test('the two-line Undo toast is axe clean and does not scroll the page sideways at four sizes', async ({
    seed,
    asUser,
  }) => {
    const { page, toast } = await assignToMe(seed, asUser, { width: 1366, height: 768 });
    await expect(toast).toBeVisible();
    // Focus on the toast holds its countdown, so it is still there at every size.
    await toast.getByRole('button', { name: 'Undo' }).focus();
    await atEverySize(page, 'toast-assign-two-lines');
  });
});
