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
    // The header shows the shared Due cell (#214): later dates are date only, the time in the viewer's zone is in its tooltip.
    await expect(newYork.due.locator('.dc')).toHaveAttribute('title', /2:30 PM/);

    const tokyo = new TaskDetailPage(await asUser('ke\\kekim', { timezoneId: 'Asia/Tokyo' }));
    await tokyo.open(taskId);
    // 14:30 in New York is 3:30 AM or 4:30 AM the next day in Tokyo, depending on whether New York is on daylight saving time that day
    // (it ends on the first Sunday of November, which falls inside the ten days this test looks ahead).
    const nyOffsetHours = Number(
      /GMT([+-]\d+)/.exec(
        new Intl.DateTimeFormat('en-US', { timeZone: FIRM_ZONE, timeZoneName: 'shortOffset' })
          .formatToParts(new Date(`${day}T12:00:00Z`))
          .find((p) => p.type === 'timeZoneName')!.value,
      )![1],
    );
    const tokyoMinutes = (14 * 60 + 30 + (9 - nyOffsetHours) * 60) % (24 * 60);
    const tokyoTime = `${Math.floor(tokyoMinutes / 60) % 12 || 12}:30 ${tokyoMinutes < 720 ? 'AM' : 'PM'}`;
    await expect(tokyo.due.locator('.dc')).toHaveAttribute('title', new RegExp(tokyoTime));
    await expect(tokyo.due).not.toContainText('Overdue');
  });
});
