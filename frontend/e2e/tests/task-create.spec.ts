import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { FieldSpec, uid } from '../support/seed';

const OCR_FIELDS: FieldSpec[] = [
  { key: 'requires_ocr', label: 'Requires OCR', control: 'CHECKBOX' },
  {
    key: 'ocr_language',
    label: 'OCR language',
    control: 'TEXT',
    showWhen: { op: 'isTrue', field: 'requires_ocr' },
    requiredWhen: { op: 'isTrue', field: 'requires_ocr' },
  },
];

test.describe('Create task: project, workflow and form rules (SCN-004, SCN-005, SCN-008, SCN-009)', () => {
  test('SCN-004: a task without a project starts New with every workflow step pending', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 3 });
    const title = `No project ${uid()}`;
    const create = new CreateTaskPage(page);
    await create.open();
    await create.fillBasics({
      matterRef: world.matter.matterRef,
      taskType: world.taskType.name,
      title,
    });
    await expect(create.project).toHaveValue('');
    const taskId = await create.create();

    const detail = new TaskDetailPage(page);
    await expect(detail.titleText).toHaveText(title);
    await detail.expectStatus('New');
    await expect(detail.progress).toContainText('0 of 3 resolved');
    await expect(detail.detailsPanel).toContainText('No project');

    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.project).toBeNull();
    expect(task.status).toBe('NEW');
    expect(task.workflow.steps).toHaveLength(3);
    expect(task.workflow.steps.every((s: { status: string }) => s.status === 'PENDING')).toBe(true);
  });

  test('SCN-004: a task can be created inside a project of the same matter', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const project = await seed.project(world.matter, `Project ${uid()}`);
    const create = new CreateTaskPage(page);
    await create.open();
    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    await create.project.selectOption({ label: project.name });
    await create.title.fill(`In project ${uid()}`);
    await create.chooseTaskType(world.taskType.name);
    await create.requestorName.fill('Rita Requestor');
    const taskId = await create.create();

    await expect(new TaskDetailPage(page).detailsPanel).toContainText(project.name);
    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.project.projectId).toBe(project.projectId);
  });

  test('SCN-005: the project list only offers projects of the chosen matter and clears when the matter changes', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const other = await seed.matter();
    const mine = await seed.project(world.matter, `Mine ${uid()}`);
    const foreign = await seed.project(other, `Foreign ${uid()}`);
    const create = new CreateTaskPage(page);
    await create.open();
    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);

    await expect(create.project.getByRole('option', { name: mine.name })).toBeAttached();
    await expect(create.project.getByRole('option', { name: foreign.name })).toHaveCount(0);

    await create.project.selectOption({ label: mine.name });
    await page.locator('[data-chosen]').first().getByRole('button', { name: 'Change' }).click();
    await create.pickMatter(other.matterRef, other.matterRef);
    await expect(create.project).toHaveValue('');
    await expect(create.project.getByRole('option', { name: mine.name })).toHaveCount(0);
    await expect(create.project.getByRole('option', { name: foreign.name })).toBeAttached();
  });

  test('SCN-005: the API rejects a project from another matter and creates no task', async ({
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const other = await seed.matter();
    const foreign = await seed.project(other);
    const title = `Cross matter ${uid()}`;

    const rejected = await admin.raw('POST', '/api/v1/tasks', {
      matterId: world.matter.matterId,
      projectId: foreign.projectId,
      taskTypeId: world.taskType.id,
      workflowDefinitionId: world.workflow.workflowDefinitionId,
      title,
      requestorName: 'Rita Requestor',
    });
    expect([400, 409]).toContain(rejected.status);
    expect(rejected.body.code).toBe('CROSS_MATTER_REFERENCE');

    const found = await admin.get(`/api/v1/tasks?matterId=${world.matter.matterId}`);
    expect(found.items).toHaveLength(0);

    const own = await seed.project(world.matter);
    const task = await seed.task(world, { title: `Move ${uid()}` });
    const moved = await admin.raw('PUT', `/api/v1/tasks/${task.taskId}`, {
      rowVersion: task.rowVersion,
      title: task.title,
      requestorName: task.requestorName,
      projectId: foreign.projectId,
    });
    expect([400, 409]).toContain(moved.status);
    expect(moved.body.code).toBe('CROSS_MATTER_REFERENCE');
    const accepted = await admin.put(`/api/v1/tasks/${task.taskId}`, {
      rowVersion: task.rowVersion,
      title: task.title,
      requestorName: task.requestorName,
      projectId: own.projectId,
    });
    expect(accepted.project.projectId).toBe(own.projectId);
    expect(accepted.matter.matterId).toBe(world.matter.matterId);
  });

  test('SCN-009: with two eligible workflows the user picks one and the task gets exactly that workflow', async ({
    page,
    seed,
    admin,
  }) => {
    const client = await seed.client();
    const matter = await seed.matter({ client });
    const a = await seed.workflow({ name: `Workflow A ${uid()}`, stepCount: 2 });
    const b = await seed.workflow({ name: `Workflow B ${uid()}`, stepCount: 4 });
    const taskType = await seed.taskType({ workflows: [a, b], defaultIndex: 0 });

    const create = new CreateTaskPage(page);
    await create.open();
    await create.fillBasics({
      matterRef: matter.matterRef,
      taskType: taskType.name,
      title: `Pick ${uid()}`,
    });
    await expect(create.workflowChoice(a.name)).toBeVisible();
    await expect(create.workflowChoice(b.name)).toBeVisible();
    await create.workflowChoice(b.name).check();
    await expect(page.locator('[data-summary-card]')).toContainText(b.name);
    const taskId = await create.create();

    const detail = new TaskDetailPage(page);
    await expect(detail.header.locator('[data-workflow]')).toContainText(b.name);
    await expect(detail.progress).toContainText('0 of 4 resolved');
    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.workflow.workflowDefinitionId).toBe(b.workflowDefinitionId);
  });

  test('SCN-009: a workflow that is not linked to the task type is refused by the API', async ({
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const unlinked = await seed.workflow({ stepCount: 1 });
    const result = await admin.raw('POST', '/api/v1/tasks', {
      matterId: world.matter.matterId,
      taskTypeId: world.taskType.id,
      workflowDefinitionId: unlinked.workflowDefinitionId,
      title: `Unlinked ${uid()}`,
      requestorName: 'Rita Requestor',
    });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('WORKFLOW_NOT_ELIGIBLE');

    const missing = await admin.raw('POST', '/api/v1/tasks', {
      matterId: world.matter.matterId,
      taskTypeId: world.taskType.id,
      title: `No workflow ${uid()}`,
      requestorName: 'Rita Requestor',
    });
    expect(missing.status).toBe(400);
  });

  test('SCN-008: a conditional field appears when its checkbox is ticked and the task needs the language', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ fields: OCR_FIELDS });
    const create = new CreateTaskPage(page);
    await create.open();
    await create.fillBasics({
      matterRef: world.matter.matterRef,
      taskType: world.taskType.name,
      title: `OCR ${uid()}`,
    });

    await expect(create.field('ocr_language')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Requires OCR' }).check();
    await expect(create.field('ocr_language')).toBeVisible();
    await expect(create.field('ocr_language')).toContainText('(required)');

    await create.submit.click();
    await expect(page).toHaveURL(/\/tasks\/new$/);
    await expect(create.field('ocr_language').getByRole('alert')).toBeVisible();

    await create.field('ocr_language').getByRole('textbox').fill('English');
    await create.create();
    await expect(page.locator('[data-request-form]')).toContainText('English');
  });

  test('SCN-008: the server enforces the conditional required field', async ({ seed, admin }) => {
    const world = await seed.world({ fields: OCR_FIELDS });
    const post = (formValues: Record<string, unknown>) =>
      admin.raw('POST', '/api/v1/tasks', {
        matterId: world.matter.matterId,
        taskTypeId: world.taskType.id,
        workflowDefinitionId: world.workflow.workflowDefinitionId,
        title: `Form rules ${uid()}`,
        requestorName: 'Rita Requestor',
        formValues,
      });

    const missing = await post({ requires_ocr: true });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('FORM_VALIDATION_FAILED');
    expect(missing.body.errors['form:ocr_language'][0].code).toBe('REQUIRED');

    expect((await post({ requires_ocr: false })).status).toBe(201);
    expect((await post({ requires_ocr: true, ocr_language: 'German' })).status).toBe(201);
  });

  test('the create page names what is missing instead of submitting', async ({ page, seed }) => {
    const world = await seed.world();
    const create = new CreateTaskPage(page);
    await create.open();
    await create.submit.click();

    await expect(create.summary).toContainText('Select a matter.');
    await expect(create.summary).toContainText('Enter a title.');
    await expect(create.summary).toContainText('Select a task type.');
    await expect(create.summary).toContainText("Enter the requestor's name.");
    await expect(page).toHaveURL(/\/tasks\/new$/);

    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    await expect(create.summary).toContainText('Enter a title.');
  });
});
