import { CreateTaskPage } from '../pages/create-task.page';
import { TaskQueuePage } from '../pages/queues.pages';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { TaskApi } from '../support/tasks';

test.describe('Status changes and closed tasks', () => {
  test('Start moves a new task to In Progress and the status menu follows the lifecycle', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.expectStatus('New');

    await detail.chooseAction('START');
    await detail.expectStatus('In Progress');
    await detail.statusMenu.click();
    await expect(page.locator('[data-option="START"]')).toHaveCount(0);
    for (const action of ['HOLD', 'COMPLETE', 'CANCEL']) {
      await expect(page.locator(`[data-option="${action}"]`)).toBeVisible();
    }
  });

  test('On Hold needs a reason, blocks the workflow and shows who held it and why', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await detail.chooseAction('HOLD');
    await detail.dialog.getByRole('button', { name: 'Put on hold' }).click();
    await expect(detail.dialog.locator('[data-reason-error]')).toHaveText(
      'Add a reason for putting this task on hold.',
    );
    await detail.expectStatus('In Progress');

    await detail.submitReason(
      'Put on hold',
      'Waiting for the client to confirm the custodian list',
    );
    await expect(detail.dialog).toBeHidden();
    await detail.expectStatus('On Hold');
    await expect(page.locator('[data-status-reason]')).toContainText('Waiting for the client');
    await expect(page.locator('[data-status-reason]')).toContainText('ke\\kekim');

    await detail.showSection('Workflow');
    await expect(page.locator('[data-workflow-notice]')).toContainText('This task is On Hold');
    const first = detail.step(world.workflow.stepTitles[0]);
    await first.expand();
    await expect(first.completeButton).toHaveCount(0);
    const blocked = await api.stepAction(1, 'complete');
    expect(blocked.status).toBe(409);

    await detail.chooseAction('RESUME');
    await detail.expectStatus('In Progress');
    await expect(first.completeButton).toBeVisible();
  });

  test('the server also refuses On Hold and Cancel without a comment', async ({ seed, admin }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();

    const hold = await api.changeStatus('ON_HOLD', '   ');
    expect(hold.status).toBe(400);
    const cancel = await api.cancel('   ');
    expect(cancel.status).toBe(400);
    expect((await api.get()).status).toBe('IN_PROGRESS');
  });

  test('Cancel needs a reason, is not blocked by unresolved steps and can be undone by reopening', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 3 });
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await detail.chooseAction('CANCEL');
    await detail.dialog.getByRole('button', { name: 'Cancel task' }).click();
    await expect(detail.dialog.locator('[data-reason-error]')).toHaveText(
      "Add a reason explaining why you're cancelling.",
    );
    await detail.expectStatus('New');

    await detail.submitReason('Cancel task', 'Wrong task type, recreated as another task');
    await expect(detail.dialog).toBeHidden();
    await detail.expectStatus('Cancelled');
    await expect(page.locator('[data-status-reason]')).toContainText('Wrong task type');
    expect(await new TaskApi(admin, task.taskId).stepStatuses()).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
    ]);

    // The comment is kept with the task.
    await detail.showSection('Comments');
    await expect(page.getByRole('region', { name: 'Comments' })).toContainText('Wrong task type');

    await page.locator('[data-reopen-task]').click();
    await detail.dialog.getByRole('button', { name: 'Reopen' }).click();
    await detail.expectStatus('In Progress');
    await expect(page.locator('[data-closed-banner]')).toHaveCount(0);
  });

  test('a completed task cannot be edited until it is reopened', async ({ page, seed, admin }) => {
    const world = await seed.world({ stepCount: 1 });
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    await api.completeSteps(1);
    expect((await api.complete()).status).toBe(200);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.expectStatus('Completed');
    await expect(page.locator('[data-closed-banner]')).toContainText('Reopen it to edit');
    await expect(page.locator('[data-readonly-note]')).toHaveCount(0);
    await expect(page.locator('[data-task-header] [data-edit]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

    const refused = await admin.raw('PUT', `/api/v1/tasks/${task.taskId}`, {
      rowVersion: (await api.get()).rowVersion,
      title: 'Edited while completed',
      requestorName: task.requestorName,
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await api.get()).title).toBe(task.title);

    await page.locator('[data-reopen-task]').click();
    await detail.dialog.getByRole('button', { name: 'Reopen' }).click();
    await detail.expectStatus('In Progress');
    await page.locator('[data-task-header] [data-edit]').click();
    await page.getByLabel('Title (required)').fill('Edited after reopening');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(detail.titleText).toHaveText('Edited after reopening');
  });

  test('matter, task type and workflow are shown as fixed and the title can be edited', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await page.locator('[data-task-header] [data-edit]').click();
    await expect(page.locator('[data-locked-fields]')).toContainText(
      "Can't be changed after creation",
    );
    await expect(page.getByRole('combobox', { name: /^(Matter|Task type|Workflow)/ })).toHaveCount(
      0,
    );
    await page.getByLabel('Title (required)').fill('Renamed by the requestor');
    await page.getByLabel('Requestor name (required)').fill('Rita Renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(detail.titleText).toHaveText('Renamed by the requestor');
    await expect(page.locator('[data-view]')).toContainText('Rita Renamed');
  });
});

test.describe('Sensitive matter banner', () => {
  test('the banner appears on create task, task detail and matter pages and the queue marks the matter', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ sensitive: true });
    const task = await seed.task(world);

    const create = new CreateTaskPage(page);
    await create.open();
    await create.chooseTaskType(world.taskType.name);
    await expect(create.sensitiveBanner).toHaveCount(0);
    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    await expect(create.sensitiveBanner).toContainText('Sensitive matter.');
    await expect(create.sensitiveBanner).toContainText('warning only');

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page.locator('[data-sensitive-banner]')).toContainText(
      'does not restrict who can see it',
    );

    await page.goto(`/matters/${world.matter.matterId}`);
    await expect(page.locator('[data-sensitive-banner]')).toContainText('Sensitive matter.');

    const queue = new TaskQueuePage(page);
    await queue.open(`?matter=${world.matter.matterId}`);
    await expect(
      queue.row(task.taskNumber).getByRole('img', { name: 'Sensitive matter' }),
    ).toBeVisible();
  });

  test('an ordinary matter shows no banner', async ({ page, seed }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page.locator('[data-sensitive-banner]')).toHaveCount(0);
  });
});
