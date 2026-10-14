import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

test.describe('Workflow version snapshot (SCN-014)', () => {
  test('SCN-014: a task keeps the steps of the version it was created on after a new version is published', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({
      steps: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
    });
    const [alpha, beta, gamma] = world.workflow.stepTitles;
    const oldTask = await seed.task(world, { title: `On v1 ${uid()}` });

    // v2: another order and a new fourth step.
    const delta = (await seed.step({ title: 'Delta' })).id;
    await seed.publishNextVersion(world.workflow, [
      world.workflow.stepIds[2],
      world.workflow.stepIds[0],
      world.workflow.stepIds[1],
      delta,
    ]);

    const detail = new TaskDetailPage(page);
    await detail.open(oldTask.taskId);
    await expect(detail.header.locator('[data-workflow]')).toContainText(
      `${world.workflow.name} v1`,
    );
    await detail.showTab('Workflow');
    await expect(page.locator('#wf-h')).toContainText(`${world.workflow.name} v1`);
    await expect(page.locator('[data-step-id]')).toHaveCount(3);
    await expect(page.locator('[data-step-id] h3')).toContainText([alpha, beta, gamma]);
    await expect(detail.progress).toContainText('0 of 3');
  });

  test('SCN-014: a task created afterwards gets the new version and the old version stays readable', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({
      steps: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
    });
    const [alpha, , gamma] = world.workflow.stepTitles;
    const delta = (await seed.step({ title: 'Delta' })).id;
    const v2 = await seed.publishNextVersion(world.workflow, [
      world.workflow.stepIds[2],
      world.workflow.stepIds[0],
      world.workflow.stepIds[1],
      delta,
    ]);

    const create = new CreateTaskPage(page);
    await create.open();
    await create.fillBasics({
      matterRef: world.matter.matterRef,
      taskType: world.taskType.name,
      title: `On v2 ${uid()}`,
    });
    await expect(create.workflowLabel(world.workflow.name)).toContainText('v2');
    await expect(create.workflowLabel(world.workflow.name)).toContainText('4 steps');
    await create.create();

    const detail = new TaskDetailPage(page);
    await detail.showTab('Workflow');
    await expect(page.locator('#wf-h')).toContainText(`${world.workflow.name} v2`);
    await expect(page.locator('[data-step-id] h3')).toContainText([gamma, alpha]);
    await expect(page.locator('[data-step-id]')).toHaveCount(4);

    const versions = await admin.get(`/api/v1/workflows/${world.workflow.workflowDefinitionId}`);
    const byNo = Object.fromEntries(
      versions.versions.map((v: { versionNo: number; status: string }) => [v.versionNo, v.status]),
    );
    expect(byNo[1]).toBe('Retired');
    expect(byNo[2]).toBe('Published');
    const v1 = await admin.get(
      `/api/v1/workflows/${world.workflow.workflowDefinitionId}/versions/${world.workflow.versionId}`,
    );
    expect(v1.steps).toHaveLength(3);
    expect(v2).not.toBe(world.workflow.versionId);
  });
});
