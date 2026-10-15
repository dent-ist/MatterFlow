import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * Dashboard > Trends with task types and due dates. Three task types of one workflow get 3, 2 and 1 tasks today (some completed, some
 * overdue); the database is shared with the other tests, so everything is checked for these types only (by their names and ids).
 */
let tag: string;
let types: { id: number; name: string }[] = [];
let titles: string[][] = [];
let world: Awaited<ReturnType<import('../support/seed').Seeder['world']>>;

test.beforeAll(async ({ admin, seed }) => {
  test.setTimeout(240_000);
  tag = uid();
  world = await seed.world();
  types = [{ id: world.taskType.id, name: world.taskType.name }];
  for (let i = 1; i < 3; i++) {
    const t = await seed.taskType({
      name: `Trend ${tag} type ${i + 1}`,
      workflows: [world.workflow],
    });
    types.push({ id: t.id, name: t.name });
  }
  const counts = [3, 2, 1];
  titles = [];
  // Completed tasks are assigned to their own user, so that the admin's My Work (other tests look at its empty tabs) is left alone.
  const worker = await seed.user(['Data Technician'], 'trendworker');
  for (let t = 0; t < 3; t++) {
    titles.push([]);
    for (let n = 0; n < counts[t]; n++) {
      const title = `Trend ${tag} t${t + 1} n${n + 1}`;
      const created = await seed.task(
        { ...world, taskType: { ...world.taskType, id: types[t].id } },
        {
          title,
          // Assigning starts a task, which is what a task needs before it can be completed.
          ...(t < 2 && n === counts[t] - 1 ? { assignedUserId: worker.userId } : {}),
          // The first task of every type is overdue (due yesterday); the rest are due next week.
          dueDate: dateInZone(FIRM_ZONE, n === 0 ? -1 : 7),
        },
      );
      titles[t].push(title);
      // The last task of the first two types is completed today.
      if (t < 2 && n === counts[t] - 1) {
        const api = new TaskApi(admin, created.taskId);
        await api.completeSteps(1, 2, 3);
        const done = await api.complete();
        if (done.status >= 300)
          throw new Error(`complete -> ${done.status} ${JSON.stringify(done.body)}`);
      }
    }
  }
});

const TREND = '/dashboard?tab=trends';
const lines = (page: Page) => page.locator('[data-plot] polyline.series:not(.partial)');
const box = (page: Page, id: number) => page.locator(`[data-type-box="${id}"]`);
const row = (page: Page, id: number) => page.locator(`[data-type="${id}"]`);

/** Narrows a legend that other tests' types may have made long to the task types whose names contain `text`. */
async function search(page: Page, text: string): Promise<void> {
  const field = page.getByRole('searchbox', { name: 'Search task types' });
  if (await field.count()) await field.fill(text);
}

test.describe('Trends by task type', () => {
  test('starts as the All task types chart and draws a line for every type that is checked', async ({
    page,
  }) => {
    await page.goto(TREND);
    await expect(page.getByRole('group', { name: /created and completed per day/i })).toBeVisible();
    await expect(lines(page)).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: 'All task types' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Created' })).toBeDisabled();

    // The first type is the seeded world's own; search by its name when the list is long.
    await search(page, types[0].name);
    await box(page, types[0].id).check();
    await expect(lines(page)).toHaveCount(2); // All task types + the type
    await expect(page).toHaveURL(new RegExp(`types=${types[0].id}`));
    await expect(page.getByRole('heading', { name: 'Tasks created per day' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Created' })).toBeEnabled();

    // The legend total is the number of tasks and opens the queue filtered by the task type.
    await expect(row(page, types[0].id).locator('[data-total]')).toHaveText('3');
    await row(page, types[0].id).locator('[data-total]').click();
    await expect(page).toHaveURL(new RegExp(`type=${types[0].id}`));
    for (const title of titles[0]) await expect(page.getByText(title)).toBeVisible();
    await expect(page.getByText(titles[1][0])).toHaveCount(0);
  });

  test('keeps the chosen types in the address and in this browser, and a shared address opens the same view', async ({
    page,
    browser,
  }) => {
    await page.goto(`${TREND}&types=${types[0].id},${types[1].id}&metric=completed`);
    await expect(box(page, types[0].id)).toBeChecked();
    await expect(box(page, types[1].id)).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Completed', exact: true })).toBeChecked();
    await expect(lines(page)).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Tasks completed per day' })).toBeVisible();

    // Leave and come back by the plain tab link: the selection is remembered for this user in this browser.
    await page.goto('/dashboard');
    await page.getByRole('tab', { name: 'Trends' }).click();
    await expect(box(page, types[0].id)).toBeChecked();
    await expect(page).toHaveURL(
      new RegExp(`types=${types[0].id}%2C${types[1].id}|types=${types[0].id},${types[1].id}`),
    );

    // Unchecking a type removes its line and its part of the address.
    await box(page, types[1].id).uncheck();
    await expect(lines(page)).toHaveCount(2);
    await expect(page).not.toHaveURL(new RegExp(`${types[1].id}`));

    // A fresh browser (no memory) opens the shared address as it was.
    const context = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      extraHTTPHeaders: { 'X-Dev-User': 'ke\\kekim' },
    });
    const other = await context.newPage();
    await other.goto(`${TREND}&types=${types[0].id},${types[2].id}`);
    await expect(box(other, types[2].id)).toBeChecked();
    await expect(lines(other)).toHaveCount(3);
    await context.close();
  });

  test('refuses a ninth task type politely and lists every visible line in the tooltip', async ({
    page,
    seed,
  }) => {
    // Eight more types so that nine can be offered.
    const more: { id: number; name: string }[] = [];
    for (let i = 0; i < 8; i++) {
      const t = await seed.taskType({
        name: `Trend ${tag} extra ${i + 1}`,
        workflows: [world.workflow],
      });
      more.push({ id: t.id, name: t.name });
    }
    await page.goto(TREND);
    await search(page, tag);
    // Ten task types with this test's tag in their names: two from the setup and eight more.
    const mine = [types[1], types[2], ...more];
    for (const t of mine.slice(0, 8)) await box(page, t.id).check();
    await expect(lines(page)).toHaveCount(9);
    await box(page, mine[8].id).click();
    await expect(box(page, mine[8].id)).not.toBeChecked();
    await expect(page.locator('[data-limit-msg]')).toHaveText(
      'Pick up to 8 task types to keep the chart readable',
    );
    await expect(lines(page)).toHaveCount(9);

    // Tooltip: the keyboard moves through the days and the live read-out lists every line.
    await page.locator('[data-plot]').focus();
    await expect(page.locator('[data-tip]')).toContainText('All task types');
    for (const t of mine.slice(0, 3))
      await expect(page.locator('[data-tip]')).toContainText(t.name);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-readout]')).toContainText('All task types');
    await expect(page.locator('[data-readout]')).toContainText(mine[1].name);

    // Table view: a column for every visible line.
    await page.getByRole('button', { name: /View as table/ }).click();
    await expect(page.locator('thead th')).toHaveCount(10);
    await expect(page.getByRole('columnheader', { name: mine[0].name })).toBeVisible();
    // Today's cell of the first type links to the queue for that day and type.
    await page.locator(`tbody tr:last-child td:nth-child(3) a`).first().click();
    await expect(page).toHaveURL(/createdFrom=.*createdTo=.*type=\d+/);
  });

  test('the metric selector switches every line; Overdue and On time use the due dates', async ({
    page,
  }) => {
    await page.goto(`${TREND}&types=${types[0].id},${types[1].id}`);
    await expect(lines(page)).toHaveCount(3);
    await page.getByRole('radio', { name: 'Overdue' }).check();
    await expect(
      page.getByRole('heading', { name: 'Overdue tasks at the end of each day' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/metric=overdue/);
    // Overdue now per type: the first task of every type was due yesterday and is still open (types 1 and 2 completed their last task).
    await expect(row(page, types[0].id).locator('[data-total]')).toHaveText('1');
    await expect(row(page, types[1].id).locator('[data-total]')).toHaveText('1');
    // The total opens the queue's overdue filter for that type, and it lists exactly that many tasks.
    await row(page, types[0].id).locator('[data-total]').click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.getByText(titles[0][0])).toBeVisible();
    await page.goBack();
    await page.getByRole('radio', { name: 'On time' }).check();
    await expect(page).toHaveURL(/metric=onTime/);
  });

  test('the Due dates group adds Overdue, On time and Completed late lines to the default chart', async ({
    page,
  }) => {
    await page.goto(TREND);
    const group = page.getByRole('group', { name: 'Due dates' });
    await expect(group).toContainText("Uses each task's current due date");
    await group.getByRole('checkbox', { name: 'Overdue' }).check();
    await group.getByRole('checkbox', { name: 'On time' }).check();
    await expect(lines(page)).toHaveCount(4);
    await expect(page).toHaveURL(/due=overdue(,|%2C)ontime/);
    // Picking a task type hands the choice to the Show selector: the Due dates are off while it is used.
    await page
      .getByRole('searchbox', { name: 'Search task types' })
      .fill(types[0].name)
      .catch(() => undefined);
    await box(page, types[0].id).check();
    await expect(group.getByRole('checkbox', { name: 'Overdue' })).toBeDisabled();
    await expect(lines(page)).toHaveCount(2);
  });

  test('has no axe violations with task types selected, in the table and with the due dates lines', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(120_000);
    await page.goto(`${TREND}&types=${types[0].id},${types[1].id},${types[2].id}&due=overdue`);
    await expect(lines(page)).toHaveCount(4);
    expect(await axeViolations(page)).toEqual([]);
    await page.getByRole('button', { name: /View as table/ }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.goto(`${TREND}&due=overdue,late`);
    await expect(lines(page)).toHaveCount(4);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('needs Dashboard.View and Dashboard.ViewTrends: a Trends-only user sees just that tab, others get 403 from the endpoint', async ({
    seed,
    asUser,
  }) => {
    const trendsOnly = await seed.user(
      [(await seed.role(['Dashboard.View', 'Dashboard.ViewTrends'], 'E2E trends only')).name],
      'trendsonly',
    );
    const page = await asUser(trendsOnly.username);
    await page.goto('/dashboard');
    await expect(page.getByRole('tab', { name: 'Trends' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Summary' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: /created and completed per day/i })).toBeVisible();
    await expect(lines(page)).toHaveCount(2);
    expect((await page.request.get('/api/v1/dashboard/trend?periodDays=7')).status()).toBe(200);

    const summaryOnly = await seed.user(
      [(await seed.role(['Dashboard.View', 'Dashboard.ViewSummary'], 'E2E summary only')).name],
      'summaryonly',
    );
    const other = await asUser(summaryOnly.username);
    expect((await other.request.get('/api/v1/dashboard/trend')).status()).toBe(403);
  });
});
