import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

test.describe('Assignment by a technician (SCN-006)', () => {
  test('SCN-006: a technician takes an unassigned Pod task with Assign to me and it starts', async ({
    seed,
    admin,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'tech');
    const pod = await seed.pod(undefined, [tech.userId]);
    const world = await seed.world();
    const task = await seed.task(world, { assignedPodId: pod.podId, title: `Take me ${uid()}` });

    const page = await asUser(tech.username);
    const podWork = new PodWorkPage(page);
    await podWork.open();
    await podWork.choosePod(pod.name);
    await expect(podWork.row(task.taskNumber)).toBeVisible();
    await expect(podWork.row(task.taskNumber)).toContainText('Unassigned');
    await podWork.assignToMe(task.taskNumber).click();
    await expect(podWork.row(task.taskNumber)).toHaveCount(0);

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.expectStatus('In Progress');
    await expect(detail.assignee).toContainText(tech.username);

    const stored = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(stored.status).toBe('IN_PROGRESS');
    expect(stored.assignedUser.userId).toBe(tech.userId);
  });

  test('SCN-006: the technician can hand the task to another person without a manager', async ({
    seed,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'tech');
    const colleague = await seed.user(['Data Technician'], 'colleague');
    const pod = await seed.pod(undefined, [tech.userId, colleague.userId]);
    const world = await seed.world();
    const task = await seed.task(world, { assignedUserId: tech.userId, assignedPodId: pod.podId });

    const page = await asUser(tech.username);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.expectStatus('In Progress');

    await page.locator('[data-task-header] [data-edit]').click();
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('combobox', { name: 'Assignee' }).fill(colleague.username);
    await page.getByRole('option', { name: colleague.username }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(detail.assignee).toContainText(colleague.username);
    await detail.expectStatus('In Progress');
    await detail.openActivity();
    await expect(page.getByRole('region', { name: 'Activity' })).toContainText(/assign/i);
  });
});

test.describe('Known application defects (docs/qa/e2e-findings.md)', () => {
  test('E2E-F2: a technician can reassign a task without a Pod to a colleague from Edit', async ({
    seed,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'tech');
    const colleague = await seed.user(['Data Technician'], 'colleague');
    const world = await seed.world();
    const task = await seed.task(world, { assignedUserId: tech.userId });

    const page = await asUser(tech.username);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await page.locator('[data-task-header] [data-edit]').click();
    // Any active user can be chosen (the same lookup as Create Task), not only members of the task's Pod.
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('combobox', { name: 'Assignee' }).fill(colleague.username);
    await page.getByRole('option', { name: colleague.username }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(detail.assignee).toContainText(colleague.username);
  });
});

test.describe('My Work and Pod Work across Pods (SCN-007)', () => {
  test('SCN-007: My Work lists my tasks from every Pod and none of anybody else', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'multi');
    const other = await seed.user(['Data Technician'], 'other');
    const podA = await seed.pod(undefined, [me.userId, other.userId]);
    const podB = await seed.pod(undefined, [me.userId]);
    const world = await seed.world();
    const mk = (title: string, extra: object) =>
      seed.task(world, { title: `${title} ${uid()}`, ...extra });
    const inA = await mk('Mine in A', { assignedUserId: me.userId, assignedPodId: podA.podId });
    const inB = await mk('Mine in B', { assignedUserId: me.userId, assignedPodId: podB.podId });
    const noPod = await mk('Mine no pod', { assignedUserId: me.userId });
    const others = await mk('Colleague in A', {
      assignedUserId: other.userId,
      assignedPodId: podA.podId,
    });

    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(myWork.tab(/^Active/)).toContainText('(3)');
    await myWork.expectListed(inA.title, inB.title, noPod.title);
    await myWork.expectNotListed(others.title);
  });

  test('My Work: the tabs have their own row, the sort note, Columns and Filters share one bar above the grid, new tasks stay marked for the whole visit', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'toolbar');
    const world = await seed.world();
    const first = await seed.task(world, { title: `First ${uid()}`, assignedUserId: me.userId });

    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await myWork.expectListed(first.title);
    const y = async (loc: ReturnType<typeof page.locator>) => (await loc.boundingBox())!.y;
    const tab = myWork.tab(/^Active/);
    const filters = page.getByRole('button', { name: /^Filters/ });
    const columns = page.getByRole('button', { name: 'Columns' });
    const head = page.locator('table thead').first();
    // Tabs first; under them one bar holds Columns and Filters (same line); then the grid with its filter row.
    expect(await y(columns)).toBeGreaterThan(await y(tab));
    expect(Math.abs((await y(filters)) - (await y(columns)))).toBeLessThan(24);
    expect(await y(columns)).toBeLessThan(await y(head));
    await expect(page.getByRole('textbox', { name: 'Filter by Title or Ref' })).toBeVisible();
    await expect(page.locator('[data-sort-note]')).toContainText('Sorted by Priority');
    await expect(page.locator('[data-near-empty]')).toContainText(
      "That's everything on your plate.",
    );
    await expect(page.locator('[data-new-dot]')).toHaveCount(0);

    // A task assigned after the visit began is marked New, and stays marked for the whole visit (the first use itself marks nothing:
    // here the visit is set to begin between the two tasks; the 30 minute rule is covered by the unit tests).
    await new Promise((r) => setTimeout(r, 1100));
    const since = Date.now();
    await new Promise((r) => setTimeout(r, 1100));
    const second = await seed.task(world, { title: `Second ${uid()}`, assignedUserId: me.userId });
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [
        `mf.my-work.visit.v2.${me.userId}`,
        JSON.stringify({ lastActiveAt: Date.now(), visitSince: since }),
      ],
    );
    await myWork.open();
    await expect(myWork.row(second.title).locator('[data-new-dot]')).toHaveAttribute(
      'aria-label',
      'New',
    );
    await expect(myWork.row(first.title).locator('[data-new-dot]')).toHaveCount(0);
    await myWork.open();
    await expect(myWork.row(second.title).locator('[data-new-dot]')).toHaveAttribute(
      'aria-label',
      'New',
    );
  });

  test('SCN-007: Pod Work shows only the chosen Pod and includes colleagues work', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Data Technician'], 'multi');
    const other = await seed.user(['Data Technician'], 'other');
    const podA = await seed.pod(undefined, [me.userId, other.userId]);
    const podB = await seed.pod(undefined, [me.userId]);
    const world = await seed.world();
    const mk = (title: string, extra: object) =>
      seed.task(world, { title: `${title} ${uid()}`, ...extra });
    const inA = await mk('Mine in A', { assignedUserId: me.userId, assignedPodId: podA.podId });
    const inB = await mk('Mine in B', { assignedUserId: me.userId, assignedPodId: podB.podId });
    const noPod = await mk('Mine no pod', { assignedUserId: me.userId });
    const colleague = await mk('Colleague in A', {
      assignedUserId: other.userId,
      assignedPodId: podA.podId,
    });
    const pooled = await mk('Pooled in B', { assignedPodId: podB.podId });

    const page = await asUser(me.username);
    const podWork = new PodWorkPage(page);
    await podWork.open();

    await podWork.choosePod(podA.name);
    await podWork.tab(/^All pod tasks/).click();
    await expect(podWork.tab(/^All pod tasks/)).toHaveAttribute('aria-selected', 'true');
    await podWork.expectListed(inA.title, colleague.title);
    await podWork.expectNotListed(inB.title, noPod.title, pooled.title);

    await podWork.choosePod(podB.name);
    await podWork.expectListed(inB.title, pooled.title);
    await podWork.expectNotListed(inA.title, colleague.title, noPod.title);
  });

  test('the Task Queue shows everything to anyone with Task.View and filters by Title or Ref', async ({
    seed,
    asUser,
  }) => {
    const viewer = await seed.user(['Data Scientist'], 'viewer');
    const world = await seed.world();
    const task = await seed.task(world, { title: `Queue visible ${uid()}` });

    const page = await asUser(viewer.username);
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(task.title);
    await queue.expectListed(task.title);
    await queue.search(`nothing-matches-${uid()}`);
    await expect(page.locator('tbody [data-empty]')).toContainText('No tasks match these filters');
  });
});
