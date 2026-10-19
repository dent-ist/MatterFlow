import { CreateTaskPage } from '../pages/create-task.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

const FIELD = [{ key: 'workspace', label: 'Workspace', control: 'TEXT' as const }];

test.describe('Task type icons and the type-first Create Task', () => {
  test('the chooser shows each usable type as a card, the form appears with a type chip and Change type goes back', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const create = new CreateTaskPage(page);
    await create.open();

    await expect(create.title).toHaveCount(0);
    const card = create.typeCard(world.taskType.name);
    await expect(card).toBeVisible();
    await expect(card.locator('svg[aria-hidden="true"]')).toBeVisible();

    await create.chooseTaskType(world.taskType.name);
    await expect(create.chooser).toHaveCount(0);
    await expect(create.typeChip).toContainText(world.taskType.name);
    await expect(create.typeChip.locator('svg')).toBeVisible();

    await create.title.fill(`Chooser ${uid()}`);
    await create.changeType.click();
    await expect(create.chooser).toBeVisible();
    await create.chooseTaskType(world.taskType.name);
    await expect(create.title).toHaveValue(/^Chooser /);

    await create.pickMatter(world.matter.matterRef, world.matter.matterRef);
    await create.requestorName.fill('Rita Requestor');
    const taskId = await create.create();
    const task = await admin.get(`/api/v1/tasks/${taskId}`);
    expect(task.taskType.taskTypeId).toBe(world.taskType.id);
  });

  test('cards are one radio group: arrows move, Enter chooses', async ({ page, seed }) => {
    const first = await seed.world();
    await seed.world();
    const create = new CreateTaskPage(page);
    await create.open();
    const cards = create.chooser.getByRole('radio');
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(create.typeChip).toBeVisible();
    expect(first.taskType.name).toBeTruthy();
  });

  test('?taskType=<id> skips the chooser; changing the type after entering request details asks first', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ fields: FIELD });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await expect(create.chooser).toHaveCount(0);
    await expect(create.typeChip).toContainText(world.taskType.name);

    await create.field('workspace').getByRole('textbox').fill('WS-1');
    await create.changeType.click();
    const dialog = page.getByRole('dialog', { name: 'Change task type' });
    await expect(dialog).toContainText('clears the request details');
    await dialog.getByRole('button', { name: 'Keep' }).click();
    await expect(create.typeChip).toBeVisible();
    await expect(create.field('workspace').getByRole('textbox')).toHaveValue('WS-1');

    await create.changeType.click();
    await page
      .getByRole('dialog', { name: 'Change task type' })
      .getByRole('button', { name: 'Change' })
      .click();
    await expect(create.chooser).toBeVisible();
  });

  test('the search box appears only above twelve types', async ({ page, seed }) => {
    // The starter configuration already provides 15 types, so the box is expected here.
    const world = await seed.world({ fields: FIELD });
    const create = new CreateTaskPage(page);
    await create.open();
    await expect(create.typeSearch).toBeVisible();
    await create.typeSearch.fill(world.taskType.name);
    await expect(create.chooser.getByRole('radio')).toHaveCount(1);
    await create.typeSearch.fill('zzzz-no-such-type');
    await expect(page.locator('[data-type-none]')).toBeVisible();
  });

  test('an admin picks an icon for a task type; it shows in the list, the chooser and on tasks', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.goto(`/admin/task-types/${world.taskType.id}`);
    await expect(page.getByRole('heading', { name: world.taskType.name, level: 1 })).toBeVisible();
    await expect(page.locator('[data-icon-current]')).toHaveText('Document');

    await page.locator('[data-icon-trigger]').click();
    const dialog = page.getByRole('dialog', { name: 'Choose an icon' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search icons' }).fill('email');
    await dialog.getByRole('radio', { name: 'Email', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-icon-current]')).toHaveText('Email');
    await page.locator('[data-save]').click();
    await expect(page.getByText('Saved.').first()).toBeVisible();

    await page.goto(`/admin/task-types?name=${encodeURIComponent(world.taskType.name)}`);
    await expect(
      page.locator(`[data-row="${world.taskType.name}"] svg[data-icon="mail"]`),
    ).toBeVisible();

    const create = new CreateTaskPage(page);
    await create.open();
    await expect(
      create.typeCard(world.taskType.name).locator('svg[data-icon="mail"]'),
    ).toBeVisible();

    await page.goto(`/tasks/${task.taskId}`);
    await expect(page.locator('[data-title-icon] svg[data-icon="mail"]')).toBeVisible();
    await page.goto(`/tasks?q=${encodeURIComponent(task.title)}`);
    await expect(page.locator('[data-type-icon] svg[data-icon="mail"]').first()).toBeVisible();
  });

  test('the API refuses an icon that is not in the library', async ({ admin, seed }) => {
    const world = await seed.world();
    const type = await admin.get(`/api/v1/task-types/${world.taskType.id}`);
    const result = await admin.raw('PUT', `/api/v1/task-types/${world.taskType.id}`, {
      name: type.name,
      iconKey: 'not-in-the-library',
      isActive: true,
      eligibleWorkflowIds: type.eligibleWorkflowIds,
      defaultWorkflowDefinitionId: type.defaultWorkflowDefinitionId,
      rowVersion: type.rowVersion,
    });
    expect(result.status).toBe(400);
  });
});
