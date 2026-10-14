import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { TaskApi } from '../support/tasks';

const FOUR_STEPS = [
  { title: 'Intake', isSkippable: true, skipCommentRequired: true },
  { title: 'Validate' },
  { title: 'Load' },
  { title: 'Report' },
];

test.describe('Ordered workflow rules (SCN-010, SCN-011, SCN-012, SCN-013)', () => {
  test('SCN-010: later steps are locked until the earlier ones are resolved, in the UI and on the server', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: FOUR_STEPS });
    const [intake, validate, load, report] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');

    await expect(detail.step(intake).state).toHaveText('Pending');
    for (const title of [validate, load, report]) {
      await expect(detail.step(title).locked).toContainText(
        'Locked. Complete or skip step 1 first.',
      );
      await expect(detail.step(title).completeButton).toHaveCount(0);
    }

    await detail.step(intake).complete();
    await expect(detail.step(intake).state).toHaveText('Completed');
    await expect(detail.step(validate).root.locator('[data-current]')).toBeVisible();
    await expect(detail.step(load).locked).toContainText('Locked. Complete or skip step 2 first.');
    await expect(detail.progress).toContainText('1 of 4 resolved');

    // Step 3 cannot be completed out of order even by calling the API directly.
    const early = await api.stepAction(3, 'complete');
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('STEP_ORDER_VIOLATION');
    expect(await api.stepStatuses()).toEqual(['COMPLETED', 'PENDING', 'PENDING', 'PENDING']);

    await detail.step(validate).complete();
    await expect(detail.step(validate).state).toHaveText('Completed');
    await expect(detail.step(load).root.locator('[data-current]')).toBeVisible();
    expect((await api.stepAction(3, 'complete')).status).toBe(200);
  });

  test('SCN-011: skipping a step that requires a comment needs a real comment', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: FOUR_STEPS });
    const [intake, validate] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');

    const step = detail.step(intake);
    await step.expand();
    await step.skipButton.click();
    const dialog = detail.dialog;
    await dialog.getByRole('button', { name: 'Skip step' }).click();
    await expect(dialog.locator('[data-skip-error]')).toHaveText(
      'Add a comment to skip this step.',
    );

    await dialog.getByRole('textbox', { name: /Comment/ }).fill('   ');
    await dialog.getByRole('button', { name: 'Skip step' }).click();
    await expect(dialog.locator('[data-skip-error]')).toHaveText(
      'Add a comment to skip this step.',
    );

    await dialog.getByRole('textbox', { name: /Comment/ }).fill('Data already validated upstream');
    await dialog.getByRole('button', { name: 'Skip step' }).click();
    await expect(dialog).toBeHidden();
    await expect(step.state).toHaveText('Skipped');
    await expect(step.root.locator('[data-skip-comment]')).toContainText(
      'Data already validated upstream',
    );
    await expect(detail.step(validate).root.locator('[data-current]')).toBeVisible();

    const stored = await new TaskApi(admin, task.taskId).step(1);
    expect(stored.status).toBe('SKIPPED');
    expect(stored.skipComment).toBe('Data already validated upstream');
  });

  test('SCN-011: the server rejects a skip without a comment', async ({ seed, admin }) => {
    const world = await seed.world({ steps: FOUR_STEPS });
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    for (const comment of [undefined, '   ']) {
      const result = await api.stepAction(1, 'skip', { comment });
      expect(result.status).toBe(400);
      expect(result.body.code).toBe('SKIP_COMMENT_REQUIRED');
    }
    expect((await api.stepAction(1, 'skip', { comment: 'Not needed' })).status).toBe(200);
    expect((await api.step(1)).skipComment).toBe('Not needed');
  });

  test('SCN-012: a non-skippable step offers no way to skip, and the server refuses it', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: FOUR_STEPS });
    const [, validate] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.completeSteps(1);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');
    const step = detail.step(validate);
    await step.expand();
    await expect(step.skipButton).toBeDisabled();
    await expect(step.root.locator('[data-no-skip]')).toHaveText(
      "This step is required and can't be skipped.",
    );

    const result = await api.stepAction(2, 'skip', { comment: 'try anyway' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('STEP_NOT_SKIPPABLE');
    expect((await api.step(2)).status).toBe('PENDING');
  });

  test('SCN-013: reopening a step keeps later steps completed and flags the reopened one', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: FOUR_STEPS });
    const [, validate, load, report] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    await api.completeSteps(1, 2, 3, 4);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');
    await detail.step(validate).reopen();

    await expect(detail.step(validate).state).toHaveText('In progress');
    await expect(detail.step(validate).reopenedFlag).toBeVisible();
    await expect(detail.step(validate).root.locator('[data-reopened-note]')).toContainText(
      'Later steps are unchanged',
    );
    await expect(detail.step(load).state).toHaveText('Completed');
    await expect(detail.step(report).state).toHaveText('Completed');
    expect(await api.stepStatuses()).toEqual([
      'COMPLETED',
      'IN_PROGRESS',
      'COMPLETED',
      'COMPLETED',
    ]);

    await detail.step(validate).complete();
    await expect(detail.step(validate).state).toHaveText('Completed');
    await expect(detail.step(validate).reopenedFlag).toHaveCount(0);
  });

  test('SCN-013: a never-resolved later step stays blocked until the reopened step is resolved again', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({
      steps: [
        { title: 'One' },
        { title: 'Two' },
        { title: 'Three' },
        { title: 'Four' },
        { title: 'Five' },
      ],
    });
    const five = world.workflow.stepTitles[4];
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    await api.completeSteps(1, 2, 3, 4);
    await api.doStep(2, 'reopen');

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');
    await expect(detail.step(five).locked).toContainText('Locked. Complete or skip step 2 first.');

    const blocked = await api.stepAction(5, 'complete');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('STEP_ORDER_VIOLATION');

    await detail.step(world.workflow.stepTitles[1]).complete();
    await expect(detail.step(five).locked).toHaveCount(0);
    await detail.step(five).complete();
    await expect(detail.step(five).state).toHaveText('Completed');
  });

  test('an unordered workflow lets the steps be done in any order', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({
      ordered: false,
      steps: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
    });
    const [, , gamma] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');

    await expect(page.locator('[data-mode]')).toContainText('Unordered');
    await expect(detail.step(gamma).locked).toHaveCount(0);
    await detail.step(gamma).complete();
    await expect(detail.step(gamma).state).toHaveText('Completed');
    expect(await new TaskApi(admin, task.taskId).stepStatuses()).toEqual([
      'PENDING',
      'PENDING',
      'COMPLETED',
    ]);
  });
});

test.describe('Completing a task with open steps (addendum K)', () => {
  test('the bulk-complete dialog lists the unfinished steps and completes them with the task', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 3 });
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.completeSteps(1);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');
    await expect(page.locator('#wf-complete-note')).toContainText('2 steps are not completed');
    await detail.completeTaskButton.click();

    await expect(detail.dialog.locator('[data-bulk-body]')).toContainText(
      'You have 2 steps not completed',
    );
    await expect(detail.dialog.locator('[data-bulk-steps] li')).toHaveCount(2);
    await detail.dialog.getByRole('button', { name: 'Mark all completed and finish task' }).click();

    await expect(detail.dialog).toBeHidden();
    await detail.expectStatus('Completed');
    expect(await api.stepStatuses()).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);
    expect((await api.get()).completedAtUtc).not.toBeNull();
  });

  test('declining the bulk-complete dialog changes nothing', async ({ page, seed, admin }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');
    await detail.completeTaskButton.click();
    await detail.dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(detail.dialog).toBeHidden();

    await detail.expectStatus('New');
    expect(await new TaskApi(admin, task.taskId).stepStatuses()).toEqual(['PENDING', 'PENDING']);
  });

  test('steps that still need required inputs block completion and the dialog points at them', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({
      steps: [{ title: 'Plain' }, { title: 'Needs input', requiredInput: true }],
    });
    const needs = world.workflow.stepTitles[1];
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showTab('Workflow');
    await detail.completeTaskButton.click();

    await expect(detail.dialog.locator('[data-blocked-body]')).toContainText(
      'These steps need required information first',
    );
    await expect(detail.dialog.locator('[data-blocked-steps]')).toContainText(needs);
    await expect(
      detail.dialog.getByRole('button', { name: 'Mark all completed and finish task' }),
    ).toHaveCount(0);
    await detail.expectStatus('New');
    expect(await api.stepStatuses()).toEqual(['PENDING', 'PENDING']);

    const direct = await api.complete(true);
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect((await api.get()).status).toBe('NEW');

    // Follow the link in the dialog, fill the input and the task can be finished.
    await detail.dialog.getByRole('button', { name: new RegExp(needs) }).click();
    await expect(detail.dialog).toBeHidden();
    await detail.step('Plain').complete();
    const step = detail.step(needs);
    await step.expand();
    await step.root.getByRole('textbox', { name: /Result/ }).fill('All good');
    await step.complete();
    await expect(step.state).toHaveText('Completed');
    await detail.completeTaskButton.click();
    await detail.expectStatus('Completed');
  });
});
