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

/**
 * Opens the Trends tab and reads it fresh. The server keeps a trend for a few seconds and every test loads it as the same user, so a plain
 * visit can be served the legend of another test's read, from before this file's task types existed; Refresh bypasses that cache.
 */
async function openTrends(page: Page): Promise<void> {
  await page.goto(TREND);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('[data-dash-live]')).toContainText('Dashboard refreshed');
}

/** Narrows a legend that other tests' types may have made long to the task types whose names contain `text`. */
async function search(page: Page, text: string): Promise<void> {
  const field = page.getByRole('searchbox', { name: 'Search task types' });
  if (await field.count()) await field.fill(text);
}

test.describe('Trends by task type', () => {
  test('starts with two panels and no disabled control; a type switches to Created, hides All for scale and draws a line per panel', async ({
    page,
  }) => {
    await openTrends(page);
    await expect(page.getByRole('group', { name: /tasks over time/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Backlog at end of day' })).toBeVisible();
    await expect(lines(page)).toHaveCount(3); // Created and Completed + Overdue
    await expect(page.getByRole('checkbox', { name: 'All task types' })).toBeChecked();
    await expect(page.locator('input:disabled, select:disabled')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Created and completed' })).toBeChecked();

    // The first type is the seeded world's own; search by its name when the list is long.
    await search(page, types[0].name);
    await box(page, types[0].id).check();
    await expect(lines(page)).toHaveCount(2); // the type in each panel; All task types is hidden for scale
    await expect(page.getByRole('checkbox', { name: /All task types/ })).not.toBeChecked();
    await expect(page).toHaveURL(new RegExp(`types=${types[0].id}`));
    await expect(page.getByRole('heading', { name: 'Tasks created per day' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Created', exact: true })).toBeChecked();
    await expect(page.locator('[data-trend-live]')).toHaveText(/Showing Created/);

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
    await expect(lines(page)).toHaveCount(4); // two types in each of the two panels
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
    await expect(lines(other)).toHaveCount(4);
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
    await openTrends(page);
    await search(page, tag);
    // Ten task types with this test's tag in their names: two from the setup and eight more.
    const mine = [types[1], types[2], ...more];
    for (const t of mine.slice(0, 8)) await box(page, t.id).check();
    // All task types is hidden for scale while types are compared; tick it for the tooltip and the table below.
    await page.getByRole('checkbox', { name: /All task types/ }).check();
    await expect(lines(page)).toHaveCount(18); // nine lines in each of the two panels
    await box(page, mine[8].id).click();
    await expect(box(page, mine[8].id)).not.toBeChecked();
    await expect(page.locator('[data-limit-msg]')).toHaveText(
      'Pick up to 8 task types to keep the chart readable',
    );
    await expect(lines(page)).toHaveCount(18);

    // Tooltip: the keyboard moves through the days and the live read-out lists every line.
    await page.locator('[data-plot]').focus();
    await expect(page.locator('[data-tip]')).toContainText('All task types');
    await expect(page.locator('[data-tip]')).toContainText('Backlog at end of day');
    for (const t of mine.slice(0, 3))
      await expect(page.locator('[data-tip]')).toContainText(t.name);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-readout]')).toContainText('All task types');
    await expect(page.locator('[data-readout]')).toContainText(mine[1].name);

    // Table view: a column for every visible line.
    await page.getByRole('button', { name: /View as table/ }).click();
    await expect(page.locator('thead th[data-col]')).toHaveCount(18);
    await expect(page.locator('thead th[scope=colgroup]')).toHaveCount(2);
    await expect(page.getByRole('columnheader', { name: mine[0].name }).first()).toBeVisible();
    // Today's cell of the first type links to the queue for that day and type.
    await page.locator(`tbody tr:last-child td:nth-child(3) a`).first().click();
    await expect(page).toHaveURL(/createdFrom=.*createdTo=.*type=\d+/);
  });

  test('the segmented control switches the measure; the backlog panel compares Overdue per task type', async ({
    page,
  }) => {
    await page.goto(`${TREND}&types=${types[0].id},${types[1].id}`);
    await expect(lines(page)).toHaveCount(4);
    await page.getByRole('radio', { name: 'On time' }).check();
    await expect(
      page.getByRole('heading', { name: 'Tasks completed on time per day' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/metric=ontime/);
    // Overdue per task type is drawn in the backlog panel: today's value links to the queue's overdue filter for that type (the first task
    // of every type was due yesterday and is still open).
    await page.getByRole('button', { name: /View as table/ }).click();
    const cell = page.locator(`thead th[data-col="backlog-type-${types[0].id}"]`);
    await expect(cell).toBeVisible();
    const index = await page
      .locator('thead th[data-col]')
      .evaluateAll(
        (els, id) => els.findIndex((e) => e.getAttribute('data-col') === id),
        `backlog-type-${types[0].id}`,
      );
    await page.locator('tbody tr:last-child td').nth(index).locator('a').click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.getByText(titles[0][0])).toBeVisible();
  });

  test('a legacy address keeps working: due=overdue,ontime and metric=overdue with types', async ({
    page,
  }) => {
    await page.goto(`${TREND}&due=overdue,ontime`);
    await expect(page.getByRole('radio', { name: 'On time' })).toBeChecked();
    await expect(page.locator('[data-panel="backlog"]')).toBeVisible();
    await expect(lines(page)).toHaveCount(2); // On time (flows) and Overdue (backlog)
    await page.goto(`${TREND}&types=${types[0].id},${types[1].id}&metric=overdue`);
    await expect(page.locator('[data-panel="backlog"] polyline.series:not(.partial)')).toHaveCount(
      2,
    );
    await expect(page.getByRole('radio', { name: 'Created', exact: true })).toBeChecked();
  });

  test('hides the backlog panel, remembered for the user but not in the address', async ({
    page,
  }) => {
    await openTrends(page);
    await page.getByRole('button', { name: 'Hide backlog' }).click();
    await expect(page.locator('[data-panel="backlog"]')).toHaveCount(0);
    await expect(lines(page)).toHaveCount(2);
    await expect(page).not.toHaveURL(/backlog/);
    await page.reload();
    await expect(page.locator('[data-panel="backlog"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show backlog' }).click();
    await expect(page.locator('[data-panel="backlog"]')).toBeVisible();
  });

  test('the chart uses its card: wide, at least 320 px tall, sticky beside the panel and not above 1000 px', async ({
    page,
  }) => {
    const flows = page.locator('[data-panel="flows"] svg');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openTrends(page);
    let b = (await flows.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(640);
    expect(b.height).toBeGreaterThanOrEqual(320);
    const backlog = (await page.locator('[data-panel="backlog"] svg').boundingBox())!;
    expect(backlog.height).toBeGreaterThanOrEqual(200);
    expect(Math.abs(backlog.width - b.width)).toBeLessThan(1);
    const position = () =>
      page.locator('mf-dash-trends-tab .sticky').evaluate((e) => getComputedStyle(e).position);
    expect(await position()).toBe('sticky');
    // The legend column is 300 to 340 px between 1000 and 1599 px.
    const side = (await page.locator('mf-trend-legend').boundingBox())!;
    expect(side.width).toBeGreaterThanOrEqual(300);
    expect(side.width).toBeLessThanOrEqual(345);

    await page.setViewportSize({ width: 1920, height: 1080 });
    // The chart fills its column (the page itself stops at 1360 px until the page chrome package lifts the cap, so the absolute width of
    // 1000 px at 1920 is not reachable yet) and the legend column is 360 px from 1600 px.
    const main = page.locator('mf-dash-trends-tab .main');
    await expect
      .poll(async () => (await main.boundingBox())!.width - (await flows.boundingBox())!.width)
      .toBeLessThan(2);
    const wide = (await page.locator('mf-trend-legend').boundingBox())!;
    expect(wide.width).toBeGreaterThanOrEqual(360);
    expect(wide.width).toBeLessThanOrEqual(400);

    // The drawing follows the window (no fixed viewBox scaling) and stacks below 1000 px.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(async () => (await flows.boundingBox())!.width).toBeLessThan(800);
    expect(await position()).toBe('static');
    b = (await flows.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(320);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect.poll(async () => (await flows.boundingBox())!.width).toBeLessThan(375);
    await expect(page.locator('[data-measure-select="flows"]')).toBeVisible();
    await expect(page.locator('[data-measure="flows"]')).toBeHidden();
  });

  test('has no axe violations with task types selected, in the table and with the due dates lines', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(120_000);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${TREND}&types=${types[0].id},${types[1].id},${types[2].id}`);
      await expect(lines(page)).toHaveCount(6);
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole('button', { name: /View as table/ }).click();
      await expect(page.locator('tbody tr').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    }
    await page.goto(`${TREND}&due=overdue,late`);
    await expect(lines(page)).toHaveCount(2);
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
    await expect(page.getByRole('group', { name: /tasks over time/i })).toBeVisible();
    await expect(lines(page)).toHaveCount(3);
    expect((await page.request.get('/api/v1/dashboard/trend?periodDays=7')).status()).toBe(200);

    const summaryOnly = await seed.user(
      [(await seed.role(['Dashboard.View', 'Dashboard.ViewSummary'], 'E2E summary only')).name],
      'summaryonly',
    );
    const other = await asUser(summaryOnly.username);
    expect((await other.request.get('/api/v1/dashboard/trend')).status()).toBe(403);
  });
});
