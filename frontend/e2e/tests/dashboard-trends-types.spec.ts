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
    await expect(lines(page)).toHaveCount(4); // Created and Completed + Open and Overdue
    await expect(page.getByRole('checkbox', { name: 'All task types' })).toBeChecked();
    await expect(page.locator('input:disabled, select:disabled')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Created and completed' })).toBeChecked();

    // The first type is the seeded world's own; search by its name when the list is long.
    await search(page, types[0].name);
    await box(page, types[0].id).check();
    await expect(lines(page)).toHaveCount(2); // the type in each panel; All task types is hidden for scale
    await expect(page.getByRole('checkbox', { name: /All task types/ })).not.toBeChecked();
    await expect(page).toHaveURL(new RegExp(`types=${types[0].id}`));
    await expect(page.getByRole('heading', { name: 'Created and completed' })).toHaveCount(1);
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
    // The id is compared with the ids of the `types` parameter, not searched for in the whole address: the port and any other number in it
    // would match a bare id (5391 contains 391), and the ids of a long-lived database reach every number.
    await expect
      .poll(() => (new URL(page.url()).searchParams.get('types') ?? '').split(','))
      .not.toContain(String(types[1].id));

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
    // Picking types turns the backlog panel's "Open and overdue" into Open; Overdue per task type is one click away.
    await expect(page.locator('[data-measure="backlog"] input:checked')).toHaveAttribute(
      'data-measure-option',
      'open',
    );
    await page.locator('[data-measure="backlog"] [data-measure-option="overdue"]').check();
    await expect(page).toHaveURL(/bmetric=overdue/);
    await page.getByRole('radio', { name: 'On time' }).check();
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

  test('the chart uses its card: wide, panels share the window height (at least 160 px each), legend beside it from 1000 px', async ({
    page,
  }) => {
    const flows = page.locator('[data-panel="flows"] svg');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openTrends(page);
    let b = (await flows.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(640);
    // Fixed-height Dashboard (#137): the two panels share what the window leaves (flows 1.6 : backlog 1), each at least 160 px.
    expect(b.height).toBeGreaterThanOrEqual(160);
    const backlog = (await page.locator('[data-panel="backlog"] svg').boundingBox())!;
    expect(backlog.height).toBeGreaterThanOrEqual(160);
    expect(b.height).toBeGreaterThan(backlog.height);
    expect(Math.abs(backlog.width - b.width)).toBeLessThan(1);
    // The legend column is 300 to 340 px between 1000 and 1599 px.
    const side = (await page.locator('mf-trend-legend').boundingBox())!;
    expect(side.width).toBeGreaterThanOrEqual(300);
    expect(side.width).toBeLessThanOrEqual(345);

    await page.setViewportSize({ width: 1920, height: 1080 });
    // The chart fills its column (at least 1000 px wide at 1920: the width cap is lifted for Trends, #93) and the legend column is 360 px from 1600 px.
    const main = page.locator('mf-dash-trends-tab .main');
    await expect
      .poll(async () => (await main.boundingBox())!.width - (await flows.boundingBox())!.width)
      .toBeLessThan(2);
    expect((await flows.boundingBox())!.width).toBeGreaterThanOrEqual(1000);
    const wide = (await page.locator('mf-trend-legend').boundingBox())!;
    expect(wide.width).toBeGreaterThanOrEqual(360);
    expect(wide.width).toBeLessThanOrEqual(400);

    // The drawing follows the window (no fixed viewBox scaling) and stacks below 1000 px.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(async () => (await flows.boundingBox())!.width).toBeLessThan(800);
    b = (await flows.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(160);
    await page.setViewportSize({ width: 375, height: 812 });
    // Below 768 px the page scrolls; on a phone (480 px and below) the panels are the full width of the card, 16:9 and at least 220 px (#121).
    await expect.poll(async () => (await flows.boundingBox())!.height).toBeGreaterThanOrEqual(220);
    expect((await flows.boundingBox())!.width).toBeGreaterThanOrEqual(250);
    expect((await flows.boundingBox())!.width).toBeLessThan(375);
    expect(
      (await page.locator('[data-panel="backlog"] svg').boundingBox())!.height,
    ).toBeGreaterThanOrEqual(160);
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
    await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('group', { name: /tasks over time/i })).toBeVisible();
    await expect(lines(page)).toHaveCount(4);
    expect((await page.request.get('/api/v1/dashboard/trend?periodDays=7')).status()).toBe(200);

    const summaryOnly = await seed.user(
      [(await seed.role(['Dashboard.View', 'Dashboard.ViewSummary'], 'E2E summary only')).name],
      'summaryonly',
    );
    const other = await asUser(summaryOnly.username);
    expect((await other.request.get('/api/v1/dashboard/trend')).status()).toBe(403);
  });
});

/** WP8b (#120, #117, #118, #121): the Open backlog, weekly points for long periods, end labels, Monday ticks and the phone layout. */
test.describe('Trends backlog and labels', () => {
  const isMonday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
  const mondayOf = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  /** Boxes of the elements, and the pairs among them that touch. */
  async function overlaps(page: Page, selector: string): Promise<string[]> {
    return page.locator(selector).evaluateAll((els) => {
      const boxes = els.map((e) => ({
        t: e.textContent?.trim() ?? '',
        r: e.getBoundingClientRect(),
      }));
      const found: string[] = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r;
          const b = boxes[j].r;
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
            found.push(`${boxes[i].t} / ${boxes[j].t}`);
        }
      return found;
    });
  }

  test('draws Open beside Overdue with a name and value at the end of every line, markers only at the ends, and a Monday on the axis', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openTrends(page);
    await expect(page.locator('[data-panel="backlog"] polyline.series:not(.partial)')).toHaveCount(
      2,
    );
    await expect(page.locator('[data-measure="backlog"] input:checked')).toHaveAttribute(
      'data-measure-option',
      'both',
    );
    const labels = page.locator('[data-end-label]');
    await expect(labels).toHaveCount(4);
    const texts = (await labels.allTextContents()).map((t) => t.trim());
    expect(texts.map((t) => t.replace(/[\d,]+$/, '').trim())).toEqual([
      'Created',
      'Completed',
      'Open',
      'Overdue',
    ]);
    expect(await overlaps(page, '[data-end-label] text')).toEqual([]);
    // 30 daily points, 4 lines: a marker at each end of each line and nowhere else.
    await expect(page.locator('[data-plot] path.marker')).toHaveCount(8);
    // Labels sit in the right margin, inside the drawing.
    const svg = (await page.locator('[data-panel="flows"] svg').boundingBox())!;
    for (const box of await labels.evaluateAll((els) =>
      els.map((e) => e.querySelector('text')!.getBoundingClientRect().toJSON()),
    )) {
      expect(box.right).toBeLessThanOrEqual(svg.x + svg.width + 1);
    }
    // The read-out says the same numbers; the labels are aria-hidden duplicates.
    await expect(labels.first()).toHaveAttribute('aria-hidden', 'true');
    await page.locator('[data-plot]').focus();
    await expect(page.locator('[data-readout]')).toContainText('Backlog at end of day');
    await expect(page.locator('[data-readout]')).toContainText(
      new RegExp(`${texts[2].replace(/\D+/g, '')} open`),
    );
    // The caveat of the snapshot, once.
    await expect(page.locator('.foot')).toContainText(
      "Based on each task's creation and closing time; later changes are not replayed.",
    );

    // Axis: the first day, every Monday in between, and today at the end; month on every label.
    const ticks = page.locator('text[data-xtick]');
    const dates = await ticks.evaluateAll((els) => els.map((e) => e.getAttribute('data-date')!));
    expect(dates.length).toBeGreaterThanOrEqual(4);
    expect(dates[dates.length - 1]).toBe(dateInZone(FIRM_ZONE, 0));
    for (const d of dates.slice(1, -1)) expect(isMonday(d)).toBe(true);
    for (const t of await ticks.allTextContents())
      expect(t.trim()).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(await overlaps(page, 'text[data-xtick]')).toEqual([]);
  });

  test('compares Open per task type: the link of today opens the queue with the open tasks of that type', async ({
    page,
  }) => {
    await page.goto(`${TREND}&types=${types[0].id},${types[1].id},${types[2].id}&bmetric=open`);
    await expect(page.locator('[data-panel="backlog"] polyline.series:not(.partial)')).toHaveCount(
      3,
    );
    // No end labels with more than 4 lines in a panel; with 3 types they are there (3 lines).
    await expect(page.locator('[data-panel="backlog"] [data-end-label]')).toHaveCount(3);
    await page.getByRole('button', { name: /View as table/ }).click();
    const col = await page
      .locator('thead th[data-col]')
      .evaluateAll(
        (els, id) => els.findIndex((e) => e.getAttribute('data-col') === id),
        `backlog-type-${types[0].id}`,
      );
    // The first type has 3 tasks and one completed today: 2 are open.
    const cell = page.locator('tbody tr:last-child td').nth(col).locator('a');
    await expect(cell).toHaveText('2');
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`type=${types[0].id}`));
    await expect(page.getByText(titles[0][0])).toBeVisible();
    await expect(page.getByText(titles[0][1])).toBeVisible();
    await expect(page.getByText(titles[0][2])).toHaveCount(0);
  });

  test('a long period is weekly for every series: per week, Week of in the tooltip and the table, Mondays on the axis, no weekend shading', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${TREND}&period=90d`);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.locator('[data-per-week]')).toHaveCount(2);
    await expect(page.locator('[data-plot] rect.weekend')).toHaveCount(0);
    await expect(page.locator('.foot')).toContainText('Each point is a week, Monday to Sunday');
    const dates = await page
      .locator('text[data-xtick]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-date')!));
    expect(dates.length).toBeLessThanOrEqual(8);
    expect(dates.length).toBeGreaterThanOrEqual(3);
    for (const d of dates) expect(isMonday(d)).toBe(true);
    expect(dates[dates.length - 1]).toBe(mondayOf(dateInZone(FIRM_ZONE, 0)));
    expect(await overlaps(page, 'text[data-xtick]')).toEqual([]);

    // The keyboard reads weeks: the last one is the current week (so far).
    await page.locator('[data-plot]').focus();
    await expect(page.locator('[data-tip-heading]')).toHaveText(/^Week of [A-Z][a-z]{2} \d+$/);
    await expect(page.locator('[data-tip]')).toContainText('This week so far');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-readout]')).toContainText(/^Week of /);
    await page.keyboard.press('Home');
    await expect(page.locator('[data-readout]')).toContainText(/^Week of /);

    await page.getByRole('button', { name: /View as table/ }).click();
    await expect(page.locator('thead th').first()).toHaveText('Week');
    await expect(page.locator('tbody tr').first().locator('th')).toHaveText(/^Week of /);
    const rows = await page.locator('tbody tr').count();
    expect(rows).toBeGreaterThanOrEqual(12);
    expect(rows).toBeLessThanOrEqual(15);
    // The same period at 30 days is daily again.
    await page.goto(`${TREND}&period=30d`);
    await expect(page.locator('[data-per-week]')).toHaveCount(0);
    await expect(page.locator('[data-plot] rect.weekend').first()).toBeVisible();
  });

  test('a custom range of 366 days has at most 54 weekly points and 8 axis labels', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const from = dateInZone(FIRM_ZONE, -365);
    const to = dateInZone(FIRM_ZONE, 0);
    await page.goto(`${TREND}&period=custom&from=${from}&to=${to}`);
    await expect(page.locator('[data-per-week]')).toHaveCount(2);
    expect(await page.locator('text[data-xtick]').count()).toBeLessThanOrEqual(8);
    await page.getByRole('button', { name: /View as table/ }).click();
    expect(await page.locator('tbody tr').count()).toBeLessThanOrEqual(54);
  });

  test('has no axe violations in the default view and the weekly view, at 1366, 1920 and 375', async ({
    page,
  }) => {
    test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
    test.setTimeout(150_000);
    for (const [width, height] of [
      [1366, 768],
      [1920, 1080],
      [375, 812],
    ]) {
      await page.setViewportSize({ width, height });
      for (const url of [TREND, `${TREND}&period=90d`]) {
        await page.goto(url);
        await expect(page.locator('[data-end-label]').first()).toBeVisible();
        expect(await axeViolations(page), `${url} at ${width}`).toEqual([]);
        await page.locator('[data-plot]').focus();
        await expect(page.locator('[data-tip]')).toBeVisible();
        expect(await axeViolations(page), `${url} with the tooltip at ${width}`).toEqual([]);
      }
    }
  });
});

test.describe('Trends on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

  test('shows the chart at full width and 16:9, folds Compare task types behind a 44 px button, and a tap reads a day', async ({
    page,
  }) => {
    await openTrends(page);
    const flows = page.locator('[data-panel="flows"] svg');
    const chart = (await flows.boundingBox())!;
    // The full width the page leaves: the app shell keeps a 56 px navigation rail at 375 px, so that is 271 px, not 343 px.
    const host = (await page.locator('mf-dash-trends-tab').boundingBox())!;
    expect(chart.width).toBeGreaterThanOrEqual(host.width - 4);
    expect(chart.width).toBeGreaterThanOrEqual(260);
    expect(chart.height).toBeGreaterThanOrEqual(193);
    expect(chart.height).toBeGreaterThanOrEqual(220);
    // The default is the chart, not the table; the table is one tap away.
    await expect(page.locator('[data-plot]')).toBeVisible();
    await expect(page.getByRole('button', { name: /View as table/ })).toBeVisible();

    // Compare task types: collapsed by default, a 44 px target.
    const toggle = page.locator('[data-compare-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('mf-trend-legend')).toHaveCount(0);
    // The page is short: the chart, the backlog and the folded button are under 1.5 screens.
    const total = await page.evaluate(() => document.scrollingElement!.scrollHeight);
    expect(total).toBeLessThan(812 * 1.5);

    // One title each; the old sentence is gone.
    await expect(page.getByRole('heading', { name: 'Created and completed' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Backlog at end of day' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /per day/ })).toHaveCount(0);

    // A tap on a day shows the tooltip with the values, and it stays after the finger lifts.
    const plot = (await page.locator('[data-panel-plot="flows"]').boundingBox())!;
    await page.touchscreen.tap(plot.x + plot.width * 0.4, plot.y + plot.height / 2);
    await expect(page.locator('[data-tip]')).toBeVisible();
    await expect(page.locator('[data-tip]')).toContainText('Created');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-tip]')).toBeVisible();

    // Opening the list and picking a task type changes the count on the button; the identity of the line is in the list and the tooltip.
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('mf-trend-legend')).toBeVisible();
    await search(page, types[0].name);
    await box(page, types[0].id).check();
    await expect(toggle).toContainText('Compare task types (1)');
  });

  test('has no horizontal scroll at 375 and 320 px', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`${TREND}&types=${types[0].id},${types[1].id}`);
      await expect(page.locator('[data-plot]')).toBeVisible();
      // Nothing inside the Trends tab reaches past the window (the tab strip above it is its own scroller and is not part of this tab).
      const beyond = await page.evaluate(() =>
        [...document.querySelectorAll('mf-dash-trends-tab, mf-dash-trends-tab *')]
          .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5)
          .map((e) => `${e.tagName}.${e.className}`),
      );
      expect(beyond, `at ${width}`).toEqual([]);
      const svg = (await page.locator('[data-panel="flows"] svg').boundingBox())!;
      expect(svg.width).toBeGreaterThanOrEqual(width - 56 - 60); // the navigation rail and the page gutters
      expect(svg.x + svg.width).toBeLessThanOrEqual(width);
    }
  });
});
