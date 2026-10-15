import { TaskQueuePage } from '../pages/queues.pages';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

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
    await expect(yourWork.getByRole('link', { name: /^My open tasks\s*3\b/ })).toBeVisible();
    await expect(yourWork.getByRole('link', { name: /^My overdue\s*1\b/ })).toBeVisible();

    await yourWork.getByRole('link', { name: /^My overdue\s*1\b/ }).click();
    await expect(page).toHaveURL(/\/tasks\?.*overdue=true/);
    await expect(page).toHaveURL(new RegExp(`assignee=${me.userId}`));
    const queue = new TaskQueuePage(page);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await queue.expectListed(late.title);
    await queue.expectNotListed(asap.title, later.title);

    await page.goto('/dashboard');
    await page
      .getByRole('region', { name: 'Your work' })
      .getByRole('link', { name: /^My open tasks\s*3\b/ })
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
    await expect(department.getByRole('link', { name: /^Open\s*\d+\b/ })).toBeVisible();

    await department.getByRole('link', { name: /^ASAP open\s*\d+\b/ }).click();
    await expect(page).toHaveURL(/asap=true/);
    const queue = new TaskQueuePage(page);
    await queue.search(unassigned.title);
    await queue.expectListed(unassigned.title);
    await queue.search(dated.title);
    await queue.expectNotListed(dated.title);

    await page.goto('/dashboard');
    await page
      .getByRole('region', { name: 'Department' })
      .getByRole('link', { name: /^Unassigned\s*\d+\b/ })
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

test.describe('Dashboard actions and click-through', () => {
  const chips = (page: import('@playwright/test').Page) =>
    page.getByRole('list', { name: 'Active filters' });

  test('Needs attention counts open the Task Queue and the filter arrives as a chip; ASAP is an overview tile', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Attn ${uid()}` });
    // A tile that counts zero is plain text, so give each linked tile something to count.
    await seed.task(world, { title: `Attn late ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -3) });
    const held = await seed.task(world, { title: `Attn held ${uid()}` });
    const heldApi = new TaskApi(admin, held.taskId);
    await heldApi.start();
    const hold = await heldApi.changeStatus('ON_HOLD', 'Waiting for the client');
    expect(hold.status, JSON.stringify(hold.body)).toBeLessThan(300);
    await page.goto('/dashboard');
    // The server caches a dashboard for a few seconds (other tests load it as the same user): Refresh reads it fresh.
    await page.getByRole('button', { name: 'Refresh' }).click();

    const attention = page.getByRole('group', { name: 'Needs attention' });
    await expect(attention.getByRole('link')).toHaveCount(3);
    await attention.getByRole('link', { name: /^Overdue\s*\d+\b/ }).click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(chips(page)).toContainText('Overdue only');

    await page.goBack();
    await attention.getByRole('link', { name: /^Unassigned\s*\d+\b/ }).click();
    await expect(chips(page)).toContainText('Assignee: Unassigned');

    await page.goBack();
    await page
      .getByRole('group', { name: 'Overview', exact: true })
      .getByRole('link', { name: /^ASAP open\s*\d+\b/ })
      .click();
    await expect(chips(page)).toContainText('ASAP only');

    await page.goBack();
    await attention.getByRole('link', { name: /^On hold\s*\d+\b/ }).click();
    await expect(page).toHaveURL(/status=ON_HOLD/);
    await expect(chips(page)).toContainText('Status: On Hold');
  });

  test('"No pod" in the pod chart opens the queue filtered to tasks without a pod', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { title: `No pod ${uid()}` });
    await page.goto('/dashboard');
    const pods = page.locator('mf-bar-list', { hasText: 'Open by pod' });
    await pods.getByRole('link', { name: /^No pod/ }).click();
    await expect(page).toHaveURL(/noPod=true/);
    await expect(chips(page)).toContainText('Pod: No pod');
    const queue = new TaskQueuePage(page);
    await queue.search(task.title);
    await queue.expectListed(task.title);
  });

  test('age bands, priority bars and the trend legend open the filtered queue with chips', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Age ${uid()}` });
    await page.goto('/dashboard');

    await page.getByRole('link', { name: /^0-2 days: \d+ tasks/ }).click();
    await expect(page).toHaveURL(/createdFrom=.*createdTo=/);
    await expect(chips(page)).toContainText('Created:');

    await page.goBack();
    const priorityBars = page.locator('mf-bar-list', { hasText: 'Open by priority' });
    await priorityBars.getByRole('link').first().click();
    await expect(page).toHaveURL(/priority=\d+/);
    await expect(chips(page)).toContainText('Priority:');

    await page.goBack();
    await page
      .getByRole('link', { name: /^Created \d+/ })
      .first()
      .click();
    await expect(page).toHaveURL(/createdFrom=/);
    await expect(chips(page)).toContainText('Created: from');
  });

  test('taking a task from the unassigned queue removes it at once, keeps focus in the list, announces it, and Undo brings it back', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Take ${uid()}` });
    await page.goto('/dashboard');

    const panel = page.locator('[data-panel="unassigned"]');
    await expect(panel.locator('li').first()).toBeVisible();
    const first = panel.locator('li').first();
    const number = (await first.getAttribute('data-task'))!;
    const total = Number(await panel.locator('[data-total]').textContent());
    const recount = page.waitForRequest(
      (r) => r.url().includes('/api/v1/dashboard') && r.url().includes('fresh=true'),
    );
    const button = first.getByRole('button', { name: `Assign to me, ${number}` });
    await button.focus();
    await page.keyboard.press('Enter');

    // The row leaves the queue at once and the header count follows.
    await expect(panel.locator(`li[data-task="${number}"]`)).toHaveCount(0);
    await expect(panel.locator('[data-total]')).toHaveText(String(total - 1));
    // Focus is on a link of the list (not the page body) and the change is announced politely.
    await expect(panel.locator(':focus')).toHaveCount(1);
    await expect(page.locator('[data-dash-live]')).toContainText(`${number} assigned to`);
    // The toast names the assignment ("Task moved to In Progress" too when the task was New; covered by the unit tests).
    await expect(page.locator('[data-undo-message]')).toContainText(`${number} assigned to`);
    await recount;

    // Alt+Z (the toast's Undo) puts it back and the list is read again.
    await page.keyboard.press('Alt+z');
    await expect(page.getByText(/assignee back to Unassigned/)).toBeVisible();
    await expect(panel.locator(`li[data-task="${number}"]`)).toHaveCount(1);
  });

  test('Refresh keeps keyboard focus on the button and announces when it is done', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const refresh = page.getByRole('button', { name: 'Refresh' });
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-dash-live]')).toContainText('Dashboard refreshed');
    await expect(refresh).toBeFocused();
    await expect(refresh).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('the trend chart shows the values of a day with the keyboard', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Trend keys ${uid()}` });
    await page.goto('/dashboard');
    const plot = page.locator('[data-plot]');
    await plot.focus();
    await expect(page.locator('[data-tip]')).toContainText('created');
    await expect(page.locator('[data-tip]')).toContainText('Today so far');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-readout]')).toContainText('completed');
    await expect(page.locator('[data-tip]')).not.toContainText('Today so far');
  });

  test('a technician sees their own overdue and due-soon lists and, with Task.Assign, the unassigned queue', async ({
    seed,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'dashtech');
    const world = await seed.world();
    const late = await seed.task(world, {
      title: `Mine late ${uid()}`,
      assignedUserId: tech.userId,
      dueDate: dateInZone(FIRM_ZONE, -2),
    });
    await seed.task(world, { title: `Pool ${uid()}` });

    const page = await asUser(tech.username);
    await page.goto('/dashboard');
    const overdue = page.locator('[data-panel="overdue"]');
    await expect(overdue.getByRole('heading', { name: 'My overdue' })).toBeVisible();
    await expect(overdue.locator(`li[data-task="${late.taskNumber}"]`)).toBeVisible();
    await expect(page.locator('[data-panel="dueSoon"]')).toBeVisible();
    await expect(page.locator('[data-panel="unassigned"]')).toBeVisible();
    // The period control is where "Created by me" is, once.
    await expect(page.locator('select[data-period]')).toHaveCount(1);
  });

  test('a person with nothing to act on has no period control', async ({ seed, asUser }) => {
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E dash idle');
    const user = await seed.user([role.name], 'dashidle');
    const page = await asUser(user.username);
    await page.goto('/dashboard');
    await expect(page.getByText('Nothing assigned to you.')).toBeVisible();
    await expect(page.locator('select[data-period]')).toHaveCount(0);
  });

  test('overdue and due-soon lists link to the sorted queue', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Late ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -3) });
    await page.goto('/dashboard');

    const overdue = page.locator('[data-panel="overdue"]');
    await expect(overdue.locator('li').first()).toContainText('Overdue');
    await overdue.getByRole('link', { name: /View all overdue tasks/ }).click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page).toHaveURL(/sort=due/);
    await expect(chips(page)).toContainText('Overdue only');
  });

  test('the period presets drive created and completed only, and the choice sticks', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const week = page.waitForRequest(
      (r) => /periodDays=\d+/.test(r.url()) && r.url().includes('/api/v1/dashboard'),
    );
    await page.getByLabel('Created and completed in').selectOption({ label: 'This week' });
    await week;
    await expect(
      page
        .getByRole('group', { name: 'Overview', exact: true })
        .locator('.caption', { hasText: 'This week' })
        .first(),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator('select[data-period]')).toHaveValue('week');
  });

  test('a section can be collapsed and stays collapsed after a reload', async ({ page }) => {
    await page.goto('/dashboard');
    const lists = page.getByRole('region', { name: 'Tasks to act on' });
    await expect(lists.locator('[data-panel="unassigned"]')).toBeVisible();
    await lists.getByRole('button', { name: /^Hide/ }).click();
    await expect(lists.locator('[data-panel="unassigned"]')).toHaveCount(0);

    await page.reload();
    const again = page.getByRole('region', { name: 'Tasks to act on' });
    await expect(again.getByRole('button', { name: /^Show/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await again.getByRole('button', { name: /^Show/ }).click();
    await expect(again.locator('[data-panel="unassigned"]')).toBeVisible();
  });

  test('the trend has a chart and a table of the same days', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Trend ${uid()}` });
    await page.goto('/dashboard');
    const trend = page.getByRole('region', { name: 'Created and completed', exact: true });
    await expect(
      trend.getByRole('group', { name: /created and completed per day/i }),
    ).toBeVisible();
    await trend.getByRole('button', { name: /View as table/ }).click();
    await expect(trend.getByRole('table')).toBeVisible();
    await expect(trend.getByRole('table').getByRole('link').first()).toBeVisible();
  });

  test('someone with nothing assigned sees a clear message and a way to find work', async ({
    seed,
    asUser,
  }) => {
    const user = await seed.user(['Director'], 'idle');
    const page = await asUser(user.username);
    await page.goto('/dashboard');
    const mine = page.getByRole('region', { name: 'Your work' });
    await expect(mine.getByText('Nothing assigned to you.')).toBeVisible();
    await expect(
      mine.getByRole('link', { name: /Browse (Pod Work|the Task Queue)/ }),
    ).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
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
    await expect(auditorPage.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    await expect(auditorPage.locator('tr[data-event]').first()).toBeVisible();

    const tech = await seed.user(['Data Technician'], 'nolog');
    const techPage = await asUser(tech.username);
    await techPage.goto('/admin/audit');
    await expect(
      techPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
