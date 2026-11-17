import { Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Persona, Personas } from '../support/personas';
import { Seeder, uid, World } from '../support/seed';
import { BROAD_PERMISSIONS } from '../support/sensitive-universe';

/**
 * Task Type access, write side (epic #1397, issue #1401): what a person sees and can do when the type of a task has role lists.
 *   - the Create Task chooser lists only the types the person may create tasks of (Can Edit);
 *   - a task the person may see but not edit is read-only: the "View only" line, no Edit button, no status actions;
 *   - the assignee picker offers only the people the type's Can Be Assigned list allows;
 *   - a bulk re-assign keeps going: the open task changes, the read-only one is listed with the reason.
 * Every screen is checked with axe at 1366x768 and 1920x1080.
 *
 * Needs `Features__TaskTypeAccess=true` (run-local.sh switches it on for tasktype-access-*.spec.ts); the tests skip themselves when it is off.
 */
const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

interface Scene {
  tag: string;
  world: World;
  secretTypeName: string;
  secretTask: Json;
  openTask: Json;
  reviewer: Persona;
  editor: Persona;
  assigner: Persona;
  outsider: Persona;
  enforced: boolean;
}

async function roleId(admin: Api, name: string): Promise<number> {
  const roles = await admin.get<Json[]>('/api/v1/roles');
  return roles.find((r) => r.name === name)!.roleId;
}

async function buildScene(admin: Api, seed: Seeder, personas: Personas): Promise<Scene> {
  const tag = uid()
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 6);
  const world = await seed.world();
  const secretTypeName = `Privileged ${tag}`;
  const secretType = await seed.taskType({ name: secretTypeName, workflows: [world.workflow] });
  const person = (label: string, name: string) =>
    personas.create({
      label: `tta-${label}`,
      permissions: [...BROAD_PERMISSIONS],
      displayName: `${name} ${tag}`,
    });
  const reviewer = await person('reviewer', 'TT Reviewer');
  const editor = await person('editor', 'TT Editor');
  const assigner = await person('assigner', 'TT Assigner');
  const outsider = await person('outsider', 'TT Outsider');

  const access = await admin.get<Json>(`/api/v1/task-types/${secretType.id}/access`);
  const saved = await admin.put<Json>(`/api/v1/task-types/${secretType.id}/access`, {
    canView: [await roleId(admin, reviewer.roleNames[0])],
    canEdit: [await roleId(admin, editor.roleNames[0])],
    canAssign: [await roleId(admin, assigner.roleNames[0])],
    rowVersion: access.rowVersion,
  });
  const secretTask = await seed.task(
    { matter: world.matter, taskType: secretType, workflow: world.workflow },
    { title: `Secret task ${tag}` },
  );
  const openTask = await seed.task(world, { title: `Open task ${tag}` });
  return {
    tag,
    world,
    secretTypeName,
    secretTask,
    openTask,
    reviewer,
    editor,
    assigner,
    outsider,
    enforced: saved.enforced === true,
  };
}

async function axeAtEverySize(page: Page, what: string, ready: () => Promise<void>): Promise<void> {
  expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await ready();
    expect(await axeViolations(page), `${what} at ${size.width}x${size.height}`).toEqual([]);
  }
}

test.describe('Task Type access: edit, assign and create', () => {
  test.describe.configure({ timeout: 240_000, mode: 'serial' });
  let scene: Scene;

  test.beforeAll(async ({ admin, seed, personas }) => {
    scene = await buildScene(admin, seed, personas);
  });
  test.beforeEach(() =>
    test.skip(
      !scene.enforced,
      'The Task Type access rule is off: start the API with Features__TaskTypeAccess=true (run-local.sh does it for tasktype-access-*.spec.ts).',
    ),
  );

  test('the Create Task chooser lists only the types the person may create tasks of', async ({
    asUser,
  }) => {
    const reviewer = await asUser(scene.reviewer.username);
    const create = new CreateTaskPage(reviewer);
    await create.open();
    // The reviewer sees the type (Can View) but may not create tasks of it: only the open type is offered.
    await expect(create.typeCard(scene.world.taskType.name)).toBeVisible();
    await expect(create.typeCard(scene.secretTypeName)).toHaveCount(0);
    await axeAtEverySize(reviewer, 'Create Task chooser (reviewer)', async () => {
      await expect(create.chooser).toBeVisible();
    });

    const editor = await asUser(scene.editor.username);
    const editorCreate = new CreateTaskPage(editor);
    await editorCreate.open();
    await expect(editorCreate.typeCard(scene.secretTypeName)).toBeVisible();

    // A person with no role of the type does not see it either.
    const outsider = await asUser(scene.outsider.username);
    const outsiderCreate = new CreateTaskPage(outsider);
    await outsiderCreate.open();
    await expect(outsiderCreate.typeCard(scene.secretTypeName)).toHaveCount(0);
  });

  test('a task the person may see but not edit shows the View only line and offers no edit controls', async ({
    asUser,
  }) => {
    const id = scene.secretTask.taskId;
    const reviewer = await asUser(scene.reviewer.username);
    await reviewer.goto(`/tasks/${id}`);
    await expect(reviewer.getByRole('heading', { level: 1 })).toContainText(
      scene.secretTask.taskNumber,
    );
    await expect(reviewer.locator('[data-view-only]')).toContainText(
      'you can see this task but not change it',
    );
    await expect(reviewer.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(reviewer.getByRole('button', { name: 'Complete Task' })).toHaveCount(0);
    await axeAtEverySize(reviewer, 'read-only task page', async () => {
      await expect(reviewer.locator('[data-view-only]')).toBeVisible();
    });

    // The editor of the type has the controls, and no View only line.
    const editor = await asUser(scene.editor.username);
    await editor.goto(`/tasks/${id}`);
    await expect(editor.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(editor.locator('[data-view-only]')).toHaveCount(0);

    // A person without any role of the type gets the page of a task that does not exist.
    const outsider = await asUser(scene.outsider.username);
    await outsider.goto(`/tasks/${id}`);
    await expect(outsider.getByText(scene.secretTask.title)).toHaveCount(0);
  });

  test('the assignee picker offers only the people the type allows', async ({ asUser }) => {
    const editor = await asUser(scene.editor.username);
    await editor.goto(`/tasks/${scene.secretTask.taskId}`);
    await editor.getByRole('button', { name: 'Edit', exact: true }).click();
    // The Priority, due date and assignment section of the Edit Task dialog starts collapsed.
    await editor
      .getByRole('dialog')
      .getByRole('button', { name: /^Priority, due date and assignment/ })
      .click();
    const assignee = editor.getByRole('combobox', { name: 'Assignee' });
    await assignee.fill(`${scene.tag}`);
    await expect(
      editor.getByRole('option', { name: new RegExp(`TT Assigner ${scene.tag}`) }),
    ).toBeVisible();
    await expect(
      editor.getByRole('option', { name: new RegExp(`TT Reviewer ${scene.tag}`) }),
    ).toHaveCount(0);
    await expect(
      editor.getByRole('option', { name: new RegExp(`TT Outsider ${scene.tag}`) }),
    ).toHaveCount(0);
    await axeAtEverySize(editor, 'Edit Task with the assignee list', async () => {
      await expect(
        editor.getByRole('option', { name: new RegExp(`TT Assigner ${scene.tag}`) }),
      ).toBeVisible();
    });
  });

  test('a bulk re-assign changes the open task and lists the read-only one with the reason', async ({
    asUser,
    admin,
  }) => {
    const reviewer = await asUser(scene.reviewer.username);
    await reviewer.goto(`/matters/${scene.world.matter.matterId}?tab=tasks`);
    await reviewer.locator('[data-select-mode]').click();
    const tick = (title: string) =>
      reviewer.locator('[data-task]', { hasText: title }).locator('[data-select-row]');
    await tick(`Open task ${scene.tag}`).check();
    await tick(`Secret task ${scene.tag}`).check();
    await reviewer.getByRole('button', { name: 'Re-assign...' }).click();
    const dialog = reviewer.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Assign To' }).fill(`TT Assigner ${scene.tag}`);
    await dialog.getByRole('option', { name: new RegExp(`TT Assigner ${scene.tag}`) }).click();
    await dialog.getByRole('button', { name: 'Re-assign 2 tasks' }).click();
    await expect(dialog.locator('[data-bulk-summary]')).toContainText(
      '1 changed, 1 could not be changed.',
    );
    await expect(dialog.locator('[data-bulk-failed-row]')).toContainText(
      'you can see it but not change it',
    );
    await axeAtEverySize(reviewer, 'bulk result', async () => {
      await expect(dialog.locator('[data-bulk-failed]')).toBeVisible();
    });
    const open = await admin.get<Json>(`/api/v1/tasks/${scene.openTask.taskId}`);
    const secret = await admin.get<Json>(`/api/v1/tasks/${scene.secretTask.taskId}`);
    expect(open.assignedUser?.userId).toBe(scene.assigner.userId);
    expect(secret.assignedUser ?? null).toBeNull();
  });
});
