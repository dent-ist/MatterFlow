import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { TaskQueuePage } from '../pages/queues.pages';
import { Api } from '../support/api';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

test.describe('Access Pending and role grant', () => {
  test('a user without roles sees Access Pending and gets in after an administrator grants a role', async ({
    page,
    seed,
    asUser,
  }) => {
    const newcomer = await seed.user([], 'newcomer');
    const pendingPage = await asUser(newcomer.username);
    await pendingPage.goto('/');
    await expect(pendingPage).toHaveURL(/\/access-pending$/);
    await expect(
      pendingPage.getByRole('heading', { name: 'Your access is pending' }),
    ).toBeVisible();
    await expect(pendingPage.locator('main')).toContainText(newcomer.username);
    await pendingPage.goto('/tasks');
    await expect(pendingPage).toHaveURL(/\/access-pending$/);
    await pendingPage.getByRole('button', { name: 'Check again' }).click();
    await expect(
      pendingPage.getByRole('status').filter({ hasText: 'Still pending' }),
    ).toBeVisible();

    // The administrator finds the user under Pending access and grants a role.
    await page.goto('/admin/users');
    await page.getByRole('searchbox', { name: 'Search users' }).fill(newcomer.username);
    await page.getByRole('searchbox', { name: 'Search users' }).press('Enter');
    const row = page.locator(`tr[data-user="${newcomer.userId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Grant access' }).click();
    const panel = page.getByRole('complementary', { name: 'User details' });
    await panel.getByRole('checkbox', { name: 'Data Technician' }).check();
    await panel.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(panel.locator('[data-permissions-stale]')).toHaveCount(0);
    await expect(row).toHaveCount(0);

    await pendingPage.getByRole('button', { name: 'Check again' }).click();
    await expect(pendingPage).not.toHaveURL(/access-pending/);
    await expect(pendingPage.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await pendingPage.goto('/tasks');
    await expect(pendingPage.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
  });

  test('a disabled account is told so instead of being offered a way in', async ({
    seed,
    asUser,
    admin,
  }) => {
    const user = await seed.user(['Data Technician'], 'disabled');
    const detail = await admin.get(`/api/v1/users/${user.userId}`);
    await admin.put(`/api/v1/users/${user.userId}/status`, {
      isActive: false,
      rowVersion: detail.rowVersion,
    });

    const page = await asUser(user.username);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your account is disabled' })).toBeVisible();
    const disabled = await Api.as(user.username);
    try {
      expect((await disabled.raw('GET', '/api/v1/tasks')).status).toBeGreaterThanOrEqual(401);
    } finally {
      await disabled.dispose();
    }
  });
});

test.describe('Permission denial in the UI and the API (SCN-019)', () => {
  test('SCN-019: a technician has no administration menu and a direct link ends on the denied page', async ({
    seed,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'tech');
    const page = await asUser(tech.username);

    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Task Queue' }),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Administration' })).toHaveCount(0);

    for (const url of ['/admin/task-types', '/admin/workflows', '/admin/users', '/admin/audit']) {
      await page.goto(url);
      await expect(
        page.getByRole('heading', { name: "You don't have permission to view this." }),
      ).toBeVisible();
    }
  });

  test('SCN-019: every task type and workflow management call is refused with PERMISSION_DENIED and changes nothing', async ({
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const tech = await seed.user(['Data Technician'], 'tech');
    const asTech = await Api.as(tech.username);
    try {
      const typesBefore = (await admin.get('/api/v1/task-types')).length;
      const workflowsBefore = (await admin.get('/api/v1/workflows')).items.length;
      const step = world.workflow.stepIds[0];
      const wfId = world.workflow.workflowDefinitionId;
      const attempts: [string, string, unknown][] = [
        ['POST', '/api/v1/task-types', { name: `Denied ${uid()}`, description: null }],
        [
          'PUT',
          `/api/v1/task-types/${world.taskType.id}`,
          { name: 'Renamed', rowVersion: 'AAAAAAAAAAA=' },
        ],
        ['POST', '/api/v1/step-definitions', { title: `Denied step ${uid()}` }],
        [
          'PUT',
          `/api/v1/step-definitions/${step}`,
          { title: 'Renamed step', rowVersion: 'AAAAAAAAAAA=' },
        ],
        ['POST', `/api/v1/step-definitions/${step}/deactivate`, { rowVersion: 'AAAAAAAAAAA=' }],
        ['POST', '/api/v1/workflows', { name: `Denied wf ${uid()}`, isOrdered: true }],
        ['POST', `/api/v1/workflows/${wfId}/versions`, {}],
        [
          'POST',
          `/api/v1/workflows/${wfId}/versions/${world.workflow.versionId}/retire`,
          { rowVersion: 'AAAAAAAAAAA=' },
        ],
        ['POST', '/api/v1/priorities', { label: `Denied ${uid()}`, color: '#000000' }],
        [
          'POST',
          '/api/v1/roles',
          { name: `Denied role ${uid()}`, description: null, permissionCodes: [] },
        ],
        ['PUT', `/api/v1/users/${tech.userId}/roles`, { roleIds: [1], rowVersion: 'AAAAAAAAAAA=' }],
        ['POST', '/api/v1/pods', { name: `Denied pod ${uid()}` }],
        ['POST', '/api/v1/asset-types', { name: `Denied type ${uid()}` }],
      ];
      for (const [method, url, body] of attempts) {
        const result = await asTech.raw(method, url, body);
        expect(result.status, `${method} ${url}`).toBe(403);
        expect(result.body.code, `${method} ${url}`).toBe('PERMISSION_DENIED');
      }

      expect((await admin.get('/api/v1/task-types')).length).toBe(typesBefore);
      expect((await admin.get('/api/v1/workflows')).items.length).toBe(workflowsBefore);
      const stored = await admin.get(`/api/v1/task-types/${world.taskType.id}`);
      expect(stored.name).toBe(world.taskType.name);
      const me = await admin.get(`/api/v1/users/${tech.userId}`);
      expect(
        me.roles.map((r: { name: string } | string) => (typeof r === 'string' ? r : r.name)),
      ).toEqual(['Data Technician']);
    } finally {
      await asTech.dispose();
    }
  });

  test('SCN-019: a view-only role cannot create tasks and the UI does not offer it', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E viewer');
    const viewer = await seed.user([role.name], 'viewer');
    const page = await asUser(viewer.username);

    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.getByRole('button', { name: 'Create task' })).toHaveCount(0);

    await page.goto('/tasks/new');
    await expect(
      page.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();

    const asViewer = await Api.as(viewer.username);
    try {
      const world = await seed.world();
      const denied = await asViewer.raw('POST', '/api/v1/tasks', {
        matterId: world.matter.matterId,
        taskTypeId: world.taskType.id,
        workflowDefinitionId: world.workflow.workflowDefinitionId,
        title: `Denied ${uid()}`,
        requestorName: 'Nobody',
      });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('PERMISSION_DENIED');
    } finally {
      await asViewer.dispose();
    }
  });

  test('SCN-019: without Task.Assign the UI offers no assignment and the API names the missing permission', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      [
        'Task.View',
        'Task.Create',
        'Task.Edit',
        'Matter.View',
        'Client.View',
        'Project.View',
        'Pod.View',
      ],
      'E2E no-assign',
    );
    const user = await seed.user([role.name], 'noassign');
    const world = await seed.world();
    const task = await seed.task(world);
    const page = await asUser(user.username);

    const create = new CreateTaskPage(page);
    await create.open();
    await expect(page.locator('[data-no-assign]')).toContainText("You can't assign tasks");
    await expect(create.assignee).toHaveCount(0);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await page.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.getByLabel('Assignee', { exact: true })).toHaveCount(0);

    const asUserApi = await Api.as(user.username);
    try {
      const result = await asUserApi.raw('POST', `/api/v1/tasks/${task.taskId}/assignment`, {
        rowVersion: task.rowVersion,
        userId: user.userId,
      });
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('PERMISSION_DENIED');
      expect(JSON.stringify(result.body)).toContain('Task.Assign');
    } finally {
      await asUserApi.dispose();
    }
  });

  test('a person with only Task.View can read a task but sees no edit, status or workflow actions', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E reader');
    const reader = await seed.user([role.name], 'reader');
    const world = await seed.world();
    const task = await seed.task(world);
    const page = await asUser(reader.username);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.titleText).toHaveText(task.title);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(detail.statusMenu).toHaveCount(0);
    await detail.showTab('Workflow');
    await expect(page.locator('[data-start], [data-complete], [data-skip]')).toHaveCount(0);
    await expect(detail.completeTaskButton).toBeDisabled();
  });
});
