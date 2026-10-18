import { TaskDetailPage } from '../pages/task-detail.page';
import { TaskQueuePage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE, ZONE_AHEAD, ZONE_BEHIND } from '../support/time';

const dueCell = (queue: TaskQueuePage, taskNumber: string) =>
  queue.row(taskNumber).locator('[data-col="due"]');

test.describe('ASAP and overdue (SCN-015)', () => {
  test('SCN-015: a task without a due date is ASAP and is never overdue', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const asap = await seed.task(world);
    const late = await seed.task(world, { dueDate: dateInZone(FIRM_ZONE, -3) });

    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${world.matter.matterId}`);
    await queue.expectListed(asap.taskNumber, late.taskNumber);
    await expect(dueCell(queue, asap.taskNumber).locator('.dc-l1')).toHaveText('ASAP');
    await expect(dueCell(queue, asap.taskNumber)).not.toContainText('Overdue');
    await expect(dueCell(queue, late.taskNumber)).toContainText('Overdue');

    await queue.open(`?matter=${world.matter.matterId}&overdue=true`);
    await queue.expectListed(late.taskNumber);
    await queue.expectNotListed(asap.taskNumber);

    const overdue = await admin.get(
      `/api/v1/task-queue?matter=${world.matter.matterId}&overdue=true`,
    );
    expect(overdue.items.map((t: { taskNumber: string }) => t.taskNumber)).toEqual([
      late.taskNumber,
    ]);
    expect((await admin.get(`/api/v1/tasks/${asap.taskId}`)).isOverdue).toBe(false);
  });

  test('SCN-015: the task header says ASAP without a due date and flags a past date as overdue', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const asap = await seed.task(world);
    const late = await seed.task(world, { dueDate: dateInZone(FIRM_ZONE, -3) });
    const detail = new TaskDetailPage(page);

    await detail.open(asap.taskId);
    await expect(detail.due).toContainText('ASAP');
    await expect(detail.due).not.toContainText('Overdue');

    await detail.open(late.taskId);
    await expect(detail.due).toContainText('Overdue');
  });

  test('SCN-015: the same date-only due date is overdue for a viewer far ahead and not for one far behind', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const dueToday = dateInZone(ZONE_BEHIND);
    const task = await seed.task(world, { dueDate: dueToday });

    for (const [zone, overdue] of [
      [ZONE_BEHIND, false],
      [ZONE_AHEAD, true],
    ] as const) {
      const page = await asUser('ke\\kekim', { timezoneId: zone });
      const queue = new TaskQueuePage(page);
      await queue.open(`?matter=${world.matter.matterId}`);
      await queue.expectListed(task.taskNumber);
      if (overdue) {
        await expect(dueCell(queue, task.taskNumber)).toContainText('Overdue');
      } else {
        await expect(dueCell(queue, task.taskNumber)).not.toContainText('Overdue');
      }

      const viewer = await Api.as('ke\\kekim', { timeZone: zone });
      try {
        const rows = await viewer.get(
          `/api/v1/task-queue?matter=${world.matter.matterId}&overdue=true`,
        );
        expect(rows.items).toHaveLength(overdue ? 1 : 0);
        expect((await viewer.get(`/api/v1/tasks/${task.taskId}`)).isOverdue).toBe(overdue);
      } finally {
        await viewer.dispose();
      }
    }
  });

  test('SCN-015: a due time is shown in the viewer local time zone', async ({ seed, asUser }) => {
    const world = await seed.world();
    const day = dateInZone(FIRM_ZONE, 10);
    const creator = await Api.as('ke\\kekim', { timeZone: FIRM_ZONE });
    let taskId: number;
    try {
      taskId = (await seed.task(world, { dueDate: day, dueTime: '14:30' }, creator)).taskId;
    } finally {
      await creator.dispose();
    }

    const newYork = new TaskDetailPage(await asUser('ke\\kekim', { timezoneId: FIRM_ZONE }));
    await newYork.open(taskId);
    await expect(newYork.due).toContainText('2:30 PM');

    const tokyo = new TaskDetailPage(await asUser('ke\\kekim', { timezoneId: 'Asia/Tokyo' }));
    await tokyo.open(taskId);
    await expect(tokyo.due).toContainText('3:30 AM');
    await expect(tokyo.due).not.toContainText('Overdue');
  });
});
