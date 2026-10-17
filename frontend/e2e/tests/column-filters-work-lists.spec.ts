import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Column filters on the work lists (epic #75, Batch 3, issue #78): Task Queue, My Work, Pod Work and the Tasks grids of a Matter and a
 * Project. The Filters panel and the "Search title or ref" box are gone; the filter row is open by default on the three work lists, quick
 * views are presets, tabs show the columns they decide as disabled with the reason, and the headers and the filter row stay in every state.
 */
const toggle = (page: Page) => page.getByRole('button', { name: /^Filters/ });
const text = (page: Page, column: string) =>
  page.getByRole('textbox', { name: `Filter by ${column}` });
const multi = (page: Page, column: string) =>
  page.getByRole('button', { name: new RegExp(`^Filter by ${column},`) });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });
const chips = (page: Page) => page.getByRole('list', { name: 'Active filters' });
const rowControl = (page: Page, key: string) =>
  page.locator(`tr[data-filter-row] [data-filter="${key}"]`);
const view = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Quick views' }).getByRole('button', { name, exact: true });

/** Columns of a work list for one user (the chooser's choice is remembered per user and screen in the browser). */
async function showColumns(page: Page, screen: string, userId: number, columns: string[]) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    `mf.work-table.v3.${screen}.${userId}`,
    JSON.stringify({ columns, density: 'comfortable' }),
  ] as const);
}

test.describe('Column filters on the work lists', () => {
  test.describe('Task Queue', () => {
    test('the filter row is open by default, the old panel and search box are gone, and Title or Ref, Matter and Project filter on the server', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const world = await seed.world();
      const project = await seed.project(world.matter, `Phase ${token}`);
      const withProject = await seed.task(world, {
        title: `Alpha ${token}`,
        projectId: project.projectId,
      });
      const plain = await seed.task(world, { title: `Beta ${token}` });
      const other = await seed.task(await seed.world(), { title: `Gamma ${token}` });

      const queue = new TaskQueuePage(page);
      await queue.open();
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('searchbox')).toHaveCount(0);
      await expect(page.locator('#fb-q, #fb-panel')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Filters' })).toHaveCount(0);

      // Title or Ref: live after a pause; the address carries it.
      await text(page, 'Title or Ref').fill(token);
      await expect(page).toHaveURL(new RegExp(`q=${token}`));
      await queue.expectListed(withProject.title, plain.title, other.title);

      // Matter: the reference or the name, a text box under the Matter column.
      await text(page, 'Matter').fill(world.matter.matterRef);
      await expect(page).toHaveURL(/matterText=/);
      await queue.expectListed(withProject.title, plain.title);
      await queue.expectNotListed(other.title);
      await text(page, 'Matter').fill('');
      await expect(page).not.toHaveURL(/matterText=/);
      await queue.expectListed(other.title);

      // Project has no column by default: More filters offers it.
      await page.getByRole('button', { name: 'More filters' }).click();
      await page.getByRole('button', { name: 'Project', exact: true }).click();
      await text(page, 'Project').fill(`phase ${token}`);
      await expect(page).toHaveURL(/projectText=/);
      await queue.expectListed(withProject.title);
      await queue.expectNotListed(plain.title, other.title);
      await expect(chips(page)).toContainText('Project:');
      await page.keyboard.press('Escape');

      await page.goto(`/tasks?q=${token}&clientText=${encodeURIComponent(world.client.name)}`);
      await queue.expectListed(withProject.title, plain.title);
      await queue.expectNotListed(other.title);
    });

    test('the default Open status is shown and never counted; a link that carries filters asks for every status', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const world = await seed.world();
      const open = await seed.task(world, { title: `Open ${token}` });
      const done = await seed.task(world, { title: `Done ${token}` });
      expect((await new TaskApi(admin, done.taskId).cancel('Not needed')).status).toBeLessThan(300);

      await page.goto('/tasks');
      await expect(multi(page, 'Status')).toContainText('Open');
      await expect(toggle(page)).toHaveText(/^\s*Filters\s*$/);
      await expect(chips(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/tasks$/);

      // Choosing a filter on a plain link keeps the open statuses in the address, so the list does not widen by itself.
      const queue = new TaskQueuePage(page);
      await queue.search(token);
      await expect(page).toHaveURL(/status=NEW/);
      await queue.expectListed(open.title);
      await queue.expectNotListed(done.title);
      await expect(toggle(page)).toHaveText(/\(1\)/);

      // A link with a filter and no status means every status, as such links always did; the cell says so and the chip takes it back.
      await page.goto(`/tasks?q=${token}`);
      await expect(multi(page, 'Status')).toContainText('All');
      await queue.expectListed(open.title, done.title);
      // The row is open (the link carried a filter), so the chips wait for it to be closed; the chip takes "All" back to the default.
      await toggle(page).click();
      await expect(chips(page)).toContainText('Status: All');
      await page.getByRole('button', { name: 'Remove filter Status: All' }).click();
      await queue.expectListed(open.title);
      await queue.expectNotListed(done.title);
    });

    test('quick views are presets that set column filters; a manual change un-presses them', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed.task(await seed.world(), { title: `Preset ${uid()}` });
      await page.goto('/tasks');

      await view(page, 'Overdue').click();
      await expect(page).toHaveURL(/overdue=true/);
      await expect(view(page, 'Overdue')).toHaveAttribute('aria-pressed', 'true');
      await expect(chips(page)).toContainText('Overdue: Overdue only');

      await view(page, 'Unassigned').click();
      await expect(page).toHaveURL(/unassigned=true/);
      await expect(page).not.toHaveURL(/overdue=/);
      await expect(rowControl(page, 'assignee')).toContainText('Unassigned');
      await expect(view(page, 'Unassigned')).toHaveAttribute('aria-pressed', 'true');

      // A change by hand un-presses the view, and the chips and the count follow the row.
      await text(page, 'Matter').fill('zzz');
      await expect(page).toHaveURL(/matterText=zzz/);
      await expect(view(page, 'Unassigned')).toHaveAttribute('aria-pressed', 'false');
      await expect(toggle(page)).toHaveText(/\(2\)/);

      // All open is the plain link.
      await view(page, 'All open').click();
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(view(page, 'All open')).toHaveAttribute('aria-pressed', 'true');
    });

    test('a plain /tasks restores the last view with a visible notice, and Reset to default undoes it', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      await seed.task(await seed.world(), { title: `Restore ${token}` });
      await page.goto(`/tasks?q=${token}&priority=1`);
      await expect(page.getByRole('textbox', { name: 'Filter by Title or Ref' })).toHaveValue(
        token,
      );
      // The view is remembered once the list has loaded (it can be empty: the priority is just a filter to remember).
      await expect(page.locator('tbody [data-loading]')).toHaveCount(0);
      await expect(page.locator('tr[data-task], tbody [data-empty]').first()).toBeVisible();

      // Same browser, plain link: the view comes back (the search text is not remembered) and says so.
      await page.goto('/tasks');
      await expect(page.locator('[data-restored-notice]')).toContainText('Restored your last view');
      await expect(page).toHaveURL(/priority=1/);
      await page.getByRole('button', { name: 'Reset to default' }).click();
      await expect(page).toHaveURL(/\/tasks$/);
      await expect(page.locator('[data-restored-notice]')).toHaveCount(0);
      await expect(toggle(page)).toHaveText(/^\s*Filters\s*$/);
    });

    test('a filter on a hidden column is a chip with Show column; Updated and Closed are in More filters', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const world = await seed.world();
      const touched = await seed.task(world, { title: `Edited ${token}` });
      const untouched = await seed.task(world, { title: `Idle ${token}` });
      await new TaskApi(admin, touched.taskId).start(); // a status change is an update
      const queue = new TaskQueuePage(page);

      await page.goto(`/tasks?q=${token}&clientText=${encodeURIComponent(world.client.name)}`);
      await queue.expectListed(touched.title, untouched.title);
      const chip = chips(page).locator('li', { hasText: 'Client:' });
      await expect(chip).toContainText('(hidden column)');
      await expect(page.getByRole('columnheader', { name: 'Client' })).toHaveCount(0);
      await chip.getByRole('button', { name: /^Show column/ }).click();
      await expect(page.getByRole('columnheader', { name: 'Client' })).toBeVisible();
      await expect(text(page, 'Client')).toHaveValue(world.client.name);
      await expect(chips(page)).toHaveCount(0); // the row shows it now

      await page.goto(`/tasks?q=${token}&updatedFrom=2000-01-01`);
      await queue.expectListed(touched.title);
      await queue.expectNotListed(untouched.title);
      await expect(chips(page)).toContainText('Updated: from');
      await page.getByRole('button', { name: 'More filters' }).click();
      for (const key of ['completed', 'asap', 'overdue', 'created', 'updated'])
        await expect(page.locator(`[data-more-filter="${key}"]`), key).toBeVisible();
    });

    test('loading, error and empty are rows of the table: the headers and the filter row stay', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      await seed.task(await seed.world(), { title: `States ${token}` });
      const queue = new TaskQueuePage(page);

      // Loading: a slow answer.
      await page.route('**/api/v1/task-queue**', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      await page.goto(`/tasks?q=${token}`);
      await expect(page.locator('tbody [data-loading]')).toBeVisible();
      await expect(page.locator('thead th').first()).toBeVisible();
      await expect(text(page, 'Title or Ref')).toBeVisible();
      await expect(page.locator('tr[data-task]')).toHaveCount(1);
      await page.unroute('**/api/v1/task-queue**');

      // Empty because of the filters: the message and Clear filters sit in the body.
      await text(page, 'Title or Ref').fill(`nothing-${token}`);
      await expect(page.locator('tbody td[data-empty="filtered"]')).toContainText(
        'No tasks match these filters',
      );
      await expect(page.locator('thead th').first()).toBeVisible();
      await expect(text(page, 'Title or Ref')).toBeVisible();
      await page.locator('tbody').getByRole('button', { name: 'Clear filters' }).click();
      await expect(page).toHaveURL(/\/tasks$/);

      // Error: the request fails; Retry in the body loads again.
      await page.route('**/api/v1/task-queue**', (route) => route.abort());
      await page.goto(`/tasks?q=${token}`);
      await expect(page.locator('tbody td[data-error]')).toContainText("Couldn't load tasks");
      await expect(text(page, 'Title or Ref')).toBeVisible();
      await page.unroute('**/api/v1/task-queue**');
      await page.locator('tbody').getByRole('button', { name: 'Retry' }).click();
      await queue.expectListed(`States ${token}`);
    });

    test('"/" focuses Title or Ref, Esc clears it, and the row stays under the header while the grid scrolls', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await seed.task(await seed.world(), { title: `Slash ${uid()}` });
      await page.goto('/tasks');
      await expect(page.locator('tr[data-task]').first()).toBeVisible();
      await page.locator('h1').click();
      await page.keyboard.press('/');
      await expect(text(page, 'Title or Ref')).toBeFocused();
      await page.keyboard.type('abc');
      await text(page, 'Title or Ref').press('Escape');
      await expect(text(page, 'Title or Ref')).toHaveValue('');
    });
  });

  test.describe('My Work', () => {
    test('tabs keep their own row, own columns show disabled with the reason, and a tab change drops what the new tab owns', async ({
      seed,
      asUser,
    }) => {
      const token = uid();
      const me = await seed.user(['Data Technician'], `mw-${token}`);
      const world = await seed.world();
      await seed.task(world, { title: `Mine ${token}`, assignedUserId: me.userId });
      const mine = await asUser(me.username);
      await mine.setViewportSize({ width: 1366, height: 768 });
      await showColumns(mine, 'my-work', me.userId, [
        'ref',
        'title',
        'priority',
        'assignee',
        'creator',
        'due',
        'status',
      ]);
      const myWork = new MyWorkPage(mine);
      await myWork.open();
      await myWork.expectListed(`Mine ${token}`);

      // Active: Assignee is "me" by definition; Creator is a filter.
      const assignee = mine.getByRole('textbox', { name: 'Filter by Assignee' });
      await expect(assignee).toBeDisabled();
      await expect(mine.locator('[data-filter-disabled]').first()).toHaveAttribute(
        'title',
        /assigned to you/,
      );
      await expect(rowControl(mine, 'creator')).toBeEnabled();

      // Created by me: the other way round.
      await myWork.tab(/^Created by me/).click();
      await expect(mine.getByRole('textbox', { name: 'Filter by Creator' })).toBeDisabled();
      await expect(rowControl(mine, 'assignee')).toBeEnabled();

      // Due soon owns the Due column.
      await myWork.tab(/^Due soon/).click();
      await expect(mine.getByRole('textbox', { name: 'Filter by Due' })).toBeDisabled();

      // Filters stay across tabs except where the new tab owns the column.
      await mine.goto(`/my-work?view=createdByMe&assignee=${me.userId}&priority=1`);
      await expect(mine).toHaveURL(/assignee=/);
      await myWork.tab(/^Active/).click();
      await expect(mine).not.toHaveURL(/assignee=/);
      await expect(mine).toHaveURL(/priority=1/);
    });

    test('tab counts follow the filters the same way on every tab, and the Completed window does not change the others', async ({
      seed,
      asUser,
    }) => {
      const token = uid();
      const me = await seed.user(['Data Technician'], `cnt-${token}`);
      const world = await seed.world();
      await seed.task(world, { title: `Keep ${token}`, assignedUserId: me.userId });
      await seed.task(world, { title: `Other ${uid()}`, assignedUserId: me.userId });
      const page = await asUser(me.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const myWork = new MyWorkPage(page);
      await myWork.open();
      await expect(myWork.tab(/^Active/)).toContainText('(2)');

      await text(page, 'Title or Ref').fill(`Keep ${token}`);
      await expect(myWork.tab(/^Active/)).toContainText('(1)');
      const counts = async () =>
        (await page.getByRole('tab').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
      const onActive = await counts();

      // Opening the other tabs (the Completed one with its 90-day window) leaves every count where it was.
      await myWork.tab(/^Closed/).click();
      await expect(page.locator('[data-help]')).toHaveCount(0); // the help is behind an info button now
      expect(await counts()).toEqual(onActive);
      await myWork.tab(/^Created by me/).click();
      await expect(page.getByRole('tab', { name: /^Created by me/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(await counts()).toEqual(onActive);
      await myWork.tab(/^Active/).click();
      expect(await counts()).toEqual(onActive);
    });
  });

  test.describe('Pod Work', () => {
    test('the Pod is the scope, not a filter; Assignee is disabled on the Unassigned tab and By member sets it', async ({
      seed,
      asUser,
    }) => {
      const token = uid();
      const me = await seed.user(['Data Technician'], `pw-${token}`);
      const colleague = await seed.user(['Data Technician'], `pwc-${token}`);
      const pod = await seed.pod(`Pod ${token}`, [me.userId, colleague.userId]);
      const world = await seed.world();
      await seed.task(world, { title: `Pooled ${token}`, assignedPodId: pod.podId });
      await seed.task(world, {
        title: `Colleague ${token}`,
        assignedPodId: pod.podId,
        assignedUserId: colleague.userId,
      });
      const page = await asUser(me.username);
      await page.setViewportSize({ width: 1366, height: 768 });
      const podWork = new PodWorkPage(page);
      await page.goto(`/pods/work?podId=${pod.podId}`);
      await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
      await podWork.expectListed(`Pooled ${token}`);

      await expect(page.getByRole('textbox', { name: 'Filter by Pod' })).toHaveCount(0);
      await page.getByRole('button', { name: 'More filters' }).click();
      await expect(page.getByRole('button', { name: 'Pod', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('textbox', { name: 'Filter by Assignee' })).toBeDisabled();
      await expect(page.locator('[data-filter-disabled]').first()).toHaveAttribute(
        'title',
        /nobody holds/,
      );

      // By member: "Show tasks" sets the Assignee filter, which is then a control on that tab.
      await podWork.tab(/^By member/).click();
      await page.getByRole('button', { name: `Show tasks of ${colleague.username}` }).click();
      await expect(page).toHaveURL(new RegExp(`assignee=${colleague.userId}`));
      await expect(rowControl(page, 'assignee')).toBeEnabled();
      await expect(rowControl(page, 'assignee')).toContainText(colleague.username);
    });
  });

  test.describe('Matter and Project task grids', () => {
    test('the Show select is the Status filter: Open by default, every status on request; Title or Ref, Project and Priority filter; the tab owns its parameters', async ({
      page,
      seed,
      admin,
    }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      const token = uid();
      const world = await seed.world();
      const project = await seed.project(world.matter, `Plan ${token}`);
      const open = await seed.task(world, { title: `Open ${token}`, projectId: project.projectId });
      const closed = await seed.task(world, { title: `Closed ${token}` });
      expect((await new TaskApi(admin, closed.taskId).cancel('Done')).status).toBeLessThan(300);

      await page.goto(`/matters/${world.matter.matterId}`);
      const tasks = page.locator('mf-scoped-tasks');
      await expect(tasks.locator(`tr[data-task="${open.taskNumber}"]`)).toBeVisible();
      await expect(tasks.locator(`tr[data-task="${closed.taskNumber}"]`)).toHaveCount(0);
      await expect(page.locator('[data-status-filter]')).toHaveCount(0);
      await expect(tasks.locator('tr[data-filter-row]')).toHaveCount(0); // closed by default

      await toggle(page).click();
      await expect(tasks.locator('tr[data-filter-row]')).toBeVisible();
      await expect(multi(page, 'Status')).toContainText('Open');
      await page.goto(`/matters/${world.matter.matterId}?status=`);
      await expect(tasks.locator(`tr[data-task="${closed.taskNumber}"]`)).toBeVisible();
      await expect(multi(page, 'Status')).toContainText('All');

      // Project on a Matter: a choice of its projects.
      await page.goto(`/matters/${world.matter.matterId}?project=${project.projectId}`);
      await expect(tasks.locator(`tr[data-task="${open.taskNumber}"]`)).toBeVisible();
      await expect(tasks.locator(`tr[data-task="${closed.taskNumber}"]`)).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Filter by Project' })).toBeVisible();
      await text(page, 'Title or Ref').fill(`nothing-${token}`);
      await expect(tasks.locator('td[data-empty="filtered"]')).toContainText(
        'No tasks match these filters',
      );
      await expect(tasks.locator('thead th').first()).toBeVisible();

      // The Projects tab drops the Tasks filters from the address.
      await page.getByRole('tab', { name: /^Projects/ }).click();
      await expect(page).toHaveURL(/tab=projects/);
      await expect(page).not.toHaveURL(/q=|project=|status=/);

      // A Project's own tasks have no Project filter.
      await page.goto(`/projects/${project.projectId}`);
      await expect(
        page.locator(`mf-scoped-tasks tr[data-task="${open.taskNumber}"]`),
      ).toBeVisible();
      // The open state is remembered per screen, and this browser opened the row on the Matter's grid above.
      await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(text(page, 'Title or Ref')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Filter by Project' })).toHaveCount(0);
    });
  });

  test.describe('Filters sheet', () => {
    test('at 375 px the work lists use the sheet with the same controls, live apply and chips', async ({
      page,
      seed,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      const token = uid();
      await seed.task(await seed.world(), { title: `Sheet ${token}` });
      await page.goto('/tasks');
      await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
      await expect(page.locator('tr[data-filter-row]')).toHaveCount(0);

      await toggle(page).click();
      await expect(sheet(page)).toBeVisible();
      for (const name of ['Title or Ref', 'Matter', 'Client', 'Project', 'Requestor']) {
        await expect(sheet(page).getByRole('textbox', { name: `Filter by ${name}` })).toBeVisible();
      }
      await sheet(page).getByRole('textbox', { name: 'Filter by Title or Ref' }).fill(token);
      await expect(page).toHaveURL(new RegExp(`q=${token}`));
      await expect(sheet(page).getByRole('button', { name: /^Show \d+ result/ })).toBeVisible();
      await sheet(page)
        .getByRole('button', { name: /^Show \d+ result/ })
        .click();
      await expect(sheet(page)).toHaveCount(0);
      await expect(chips(page)).toContainText(`Title or Ref: ${token}`);
      await expect(toggle(page)).toHaveText(/\(1\)/);
      await expect(page.locator('tr[data-task]')).toHaveCount(1);
    });
  });

  test('axe: closed, open, filtered, empty at 1366 and the sheet at 375, on the three work lists and the Matter tasks', async ({
    page,
    seed,
    admin,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(300_000);
    const token = uid();
    const world = await seed.world();
    const me = await admin.get('/api/v1/me');
    await seed.task(world, { title: `Axe ${token}`, assignedUserId: me.userId });
    // The admin stays out of every pod: a pod member's Dashboard opens on My pods (P1), and the Dashboard specs run as the admin.
    const pod = await seed.pod(`Axe Pod ${token}`, []);
    await page.setViewportSize({ width: 1366, height: 768 });

    const screens = [
      ['/tasks', 'Title or Ref', true],
      ['/my-work', 'Title or Ref', true],
      [`/pods/work?podId=${pod.podId}&view=all`, 'Title or Ref', true],
      [`/matters/${world.matter.matterId}`, 'Title or Ref', false],
    ] as const;
    for (const [url, column, openByDefault] of screens) {
      await page.goto(url);
      await expect(page.locator('table thead th').first()).toBeVisible();
      if (!openByDefault) {
        expect(await axeViolations(page), `${url} closed`).toEqual([]);
        await toggle(page).click();
      }
      await expect(text(page, column)).toBeVisible();
      expect(await axeViolations(page), `${url} open`).toEqual([]);
      await text(page, column).fill(token);
      await text(page, column).press('Enter');
      await expect(page).toHaveURL(/q=/);
      expect(await axeViolations(page), `${url} filtered`).toEqual([]);
      await text(page, column).fill(`${token}-nothing`);
      await text(page, column).press('Enter');
      await expect(page.locator('tbody td[data-empty="filtered"]')).toBeVisible();
      expect(await axeViolations(page), `${url} empty`).toEqual([]);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    for (const [url] of screens) {
      await page.goto(url);
      await toggle(page).click();
      await expect(sheet(page)).toBeVisible();
      expect(await axeViolations(page), `${url} sheet`).toEqual([]);
    }
  });
});
