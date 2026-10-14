import { TaskQueuePage } from '../pages/queues.pages';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';

test.describe('Dashboard drill-through', () => {
  test('my tiles count my open, overdue and ASAP work and open the matching queue', async ({
    seed,
    asUser,
  }) => {
    const me = await seed.user(['Director'], 'dash');
    const world = await seed.world();
    const mine = (title: string, extra: object = {}) =>
      seed.task(world, { title: `${title} ${uid()}`, assignedUserId: me.userId, ...extra });
    const asap = await mine('Dash ASAP');
    const late = await mine('Dash overdue', { dueDate: dateInZone(FIRM_ZONE, -4) });
    const later = await mine('Dash later', { dueDate: dateInZone(FIRM_ZONE, 20) });

    const page = await asUser(me.username);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

    const yourWork = page.getByRole('region', { name: 'Your work' });
    await expect(yourWork.getByRole('link', { name: /^My open tasks: 3\./ })).toBeVisible();
    await expect(yourWork.getByRole('link', { name: /^My overdue: 1\./ })).toBeVisible();

    await yourWork.getByRole('link', { name: /^My overdue: 1\./ }).click();
    await expect(page).toHaveURL(/\/tasks\?.*overdue=true/);
    await expect(page).toHaveURL(new RegExp(`assignee=${me.userId}`));
    const queue = new TaskQueuePage(page);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await queue.expectListed(late.title);
    await queue.expectNotListed(asap.title, later.title);

    await page.goto('/dashboard');
    await page
      .getByRole('region', { name: 'Your work' })
      .getByRole('link', { name: /^My open tasks: 3\./ })
      .click();
    await queue.expectListed(asap.title, late.title, later.title);
  });

  test('department tiles drill into the queue with the same filter and the ASAP tile excludes dated work', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const unassigned = await seed.task(world, { title: `Dept unassigned ${uid()}` });
    const dated = await seed.task(world, {
      title: `Dept dated ${uid()}`,
      dueDate: dateInZone(FIRM_ZONE, 30),
    });

    await page.goto('/dashboard');
    const department = page.getByRole('region', { name: 'Department' });
    await expect(department.getByRole('link', { name: /^Open: \d+\./ })).toBeVisible();

    await department.getByRole('link', { name: /^ASAP open: \d+\./ }).click();
    await expect(page).toHaveURL(/asap=true/);
    const queue = new TaskQueuePage(page);
    await queue.search(unassigned.title);
    await queue.expectListed(unassigned.title);
    await queue.search(dated.title);
    await queue.expectNotListed(dated.title);

    await page.goto('/dashboard');
    await page
      .getByRole('region', { name: 'Department' })
      .getByRole('link', { name: /^Unassigned: \d+\./ })
      .click();
    await expect(page).toHaveURL(/unassigned=true/);
    await queue.search(unassigned.title);
    await queue.expectListed(unassigned.title);
  });

  test('a person without the department permission sees only their own section', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E dash viewer');
    const user = await seed.user([role.name], 'dashviewer');
    const page = await asUser(user.username);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your work' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Department' })).toHaveCount(0);
  });
});

test.describe('Audit log browser (smoke)', () => {
  test('the audit log lists the events of one task and shows the details of an event', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { title: `Audited ${uid()}` });

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible();
    await page.getByLabel('Object type').selectOption('Task');
    await page.getByLabel('Object id').fill(String(task.taskId));
    await page.getByRole('button', { name: 'Apply filters' }).click();

    const created = page
      .locator('tr[data-event]')
      .filter({ hasText: `${task.taskNumber} created` });
    await expect(created).toHaveCount(1);
    await expect(created).toContainText('ke\\kekim');
    await created.getByRole('button', { name: /^Show details of event/ }).click();
    await expect(page.locator('tr.au-detail')).toContainText('TASK_CREATED');
    await created.getByRole('link', { name: new RegExp(task.taskNumber) }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}$`));
  });

  test('filtering by event type and text narrows the list and Reset clears it', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();

    await page.goto('/admin/audit');
    await page.getByLabel('Event type').selectOption('CLIENT_CREATED');
    await page.getByLabel('Search summary or field').fill(client.clientNumber);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    const rows = page.locator('tr[data-event]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Client ${client.clientNumber} created`);

    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByLabel('Event type')).toHaveValue('');
  });

  test('the log is read only: there is no export, edit or delete action', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /export|download|delete|edit/i })).toHaveCount(0);
    await expect(page.getByText("can't be exported")).toBeVisible();
  });

  test('a compliance auditor can read the log and a technician cannot', async ({
    seed,
    asUser,
  }) => {
    const auditor = await seed.user(['Compliance Auditor'], 'auditor');
    const auditorPage = await asUser(auditor.username);
    await auditorPage.goto('/admin/audit');
    await expect(auditorPage.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible();
    await expect(auditorPage.locator('tr[data-event]').first()).toBeVisible();

    const tech = await seed.user(['Data Technician'], 'nolog');
    const techPage = await asUser(tech.username);
    await techPage.goto('/admin/audit');
    await expect(
      techPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
