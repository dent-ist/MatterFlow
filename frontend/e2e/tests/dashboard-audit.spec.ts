import { axeAvailable, axeViolations } from '../support/axe';
import { TaskQueuePage } from '../pages/queues.pages';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';
import { assignToMeByKeyboard } from '../support/summary-lists';
import { TaskApi } from '../support/tasks';

test.describe('Dashboard drill-through', () => {
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
    const overview = page.getByRole('group', { name: 'Overview', exact: true });
    await expect(overview.getByRole('link', { name: /^Open\s*\d+\b/ })).toBeVisible();

    await page
      .getByRole('group', { name: 'Needs attention' })
      .getByRole('link', { name: /^ASAP open\s*\d+\b/ })
      .click();
    await expect(page).toHaveURL(/asap=true/);
    const queue = new TaskQueuePage(page);
    await queue.search(unassigned.title);
    await queue.expectListed(unassigned.title);
    await queue.search(dated.title);
    await queue.expectNotListed(dated.title);

    await page.goto('/dashboard');
    await page
      .getByRole('group', { name: 'Needs attention' })
      .getByRole('link', { name: /^Unassigned\s*\d+\b/ })
      .click();
    await expect(page).toHaveURL(/unassigned=true/);
    await queue.search(unassigned.title);
    await queue.expectListed(unassigned.title);
  });

  test('a person with Dashboard.View but no tab permission sees only a note with a link to My Work', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(
      ['Task.View', 'Matter.View', 'Client.View', 'Dashboard.View'],
      'E2E dash no tabs',
    );
    const user = await seed.user([role.name], 'dashnotabs');
    const page = await asUser(user.username);
    await page.goto('/dashboard?tab=trends');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expect(page.locator('[data-no-tabs-note]')).toContainText(
      'No Dashboard tab is turned on for your role',
    );
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Needs attention' })).toHaveCount(0);
    await page.locator('[data-no-tabs-note]').getByRole('link', { name: 'My Work' }).click();
    await expect(page).toHaveURL(/\/my-work/);
  });
});

test.describe('Dashboard actions and click-through', () => {
  type Page = import('@playwright/test').Page;
  /** Chips of the filters that have no column in the grid (the filter row shows the others). */
  const chips = (page: Page) => page.getByRole('list', { name: 'Active filters' });
  /**
   * Since #221 a link that matches a quick view presses it, and a pressed view hides the chips of the filters it owns (so there is no "Overdue only"
   * chip). The view is a button in the strip, or the More button when the strip is narrow; its name carries the count ("Overdue, 12 tasks").
   * The list below it has the same total (the pager says "... of N"), and the address carries the filter of the Dashboard link.
   */
  async function expectPressedView(
    page: Page,
    key: string,
    label: string,
    href: string | null,
  ): Promise<void> {
    const pressed = page
      .locator(
        `.qv [data-view="${key}"][aria-pressed="true"], .qv [data-view-in-more="${key}"][aria-pressed="true"]`,
      )
      .first();
    await expect(pressed).toBeVisible();
    await expect(pressed).toHaveAttribute('aria-label', new RegExp(`^${label}, [\\d,]+ tasks?$`));
    // The list is the view: its total is the view's count.
    const count = Number(
      ((await pressed.getAttribute('aria-label')) ?? '')
        .match(/, ([\d,]+) task/)![1]
        .replace(/,/g, ''),
    );
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager).toContainText(new RegExp(`of ${count}(?!\\d)`));
    // Same filter as the Dashboard link: every parameter of the link is in the address.
    if (href) {
      const wanted = new URL(href, 'http://x').searchParams;
      const got = new URL(page.url()).searchParams;
      for (const [k, v] of wanted) expect(got.getAll(k), `parameter ${k}`).toContain(v);
    }
    await expect(
      chips(page).getByText(label === 'ASAP' ? 'ASAP only' : 'Overdue only'),
    ).toHaveCount(0);
  }

  /** The control of a filter in the Task Queue's filter row, which is open when a link brings filters. */
  const control = (page: Page, key: string) =>
    page.locator(`tr[data-filter-row] [data-filter="${key}"]`);

  test('Needs attention counts open the Task Queue and the filter arrives as a chip; ASAP open is the quiet fourth tile', async ({
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
    await expect(attention.getByRole('link')).toHaveCount(4);
    const overdueLink = attention.getByRole('link', { name: /^Overdue\s*\d+\b/ });
    const overdueHref = await overdueLink.getAttribute('href');
    await overdueLink.click();
    await expect(page).toHaveURL(/overdue=true/);
    await expectPressedView(page, 'overdue', 'Overdue', overdueHref);

    await page.goBack();
    await attention.getByRole('link', { name: /^Unassigned\s*\d+\b/ }).click();
    await expect(control(page, 'assignee')).toContainText('Unassigned');

    await page.goBack();
    const asapLink = attention.getByRole('link', { name: /^ASAP open\s*\d+\b/ });
    const asapHref = await asapLink.getAttribute('href');
    await asapLink.click();
    await expect(page).toHaveURL(/asap=true/);
    await expectPressedView(page, 'asap', 'ASAP', asapHref);

    await page.goBack();
    await attention.getByRole('link', { name: /^On hold\s*\d+\b/ }).click();
    await expect(page).toHaveURL(/status=ON_HOLD/);
    await expect(control(page, 'status')).toContainText('On Hold');
  });

  test('the Task Queue still filters to tasks without a pod (noPod) and shows a chip', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { title: `No pod ${uid()}` });
    await page.goto('/tasks?noPod=true');
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
    await page.goto('/dashboard?tab=breakdowns');

    await page.getByRole('link', { name: /^0-2 days: \d+ tasks/ }).click();
    await expect(page).toHaveURL(/createdFrom=.*createdTo=/);
    await expect(chips(page)).toContainText('Created:');

    await page.goBack();
    const priorityBars = page.locator('mf-bar-list', { hasText: 'Priority' });
    await priorityBars.getByRole('link').first().click();
    await expect(page).toHaveURL(/priority=\d+/);
    await expect(control(page, 'priority')).not.toHaveText('All');

    await page.goto('/dashboard?tab=trends');
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
    await assignToMeByKeyboard(first, number);

    // The row leaves the queue at once and the header count follows.
    await expect(panel.locator(`li[data-task="${number}"]`)).toHaveCount(0);
    await expect(panel.locator('[data-total]')).toHaveText(String(total - 1));
    // Focus is on a link of the list (not the page body) and the change is announced politely.
    await expect(panel.locator(':focus')).toHaveCount(1);
    await expect(page.locator('[data-dash-live]')).toContainText(`${number} assigned to`);
    // The toast is the shared "Assign to me" one (#234): "Assigned to you." ("Task moved to In Progress" too when the task was New; covered by the unit tests).
    await expect(page.locator('[data-undo-message]')).toContainText('Assigned to you.');
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
    await page.goto('/dashboard?tab=trends');
    const plot = page.locator('[data-plot]');
    await plot.focus();
    // The navigation rail also uses data-tip for its labels; the chart's tooltip is the one inside the plot's panel.
    const tip = page.locator('main [data-tip]');
    await expect(tip).toContainText('created');
    await expect(tip).toContainText('Today so far');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-readout]')).toContainText('completed');
    await expect(tip).not.toContainText('Today so far');
  });

  test('a technician has the Summary tab only, with the unassigned queue (no other tabs)', async ({
    seed,
    asUser,
  }) => {
    const tech = await seed.user(['Data Technician'], 'dashtech');
    const world = await seed.world();
    await seed.task(world, { title: `Pool ${uid()}` });

    const page = await asUser(tech.username);
    await page.goto('/dashboard');
    // One permitted tab and only the queue: no tab list, the heading names the content (R3, #100, S9).
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Unassigned work' })).toBeVisible();
    await expect(page.locator('[data-panel="unassigned"]')).toBeVisible();
    await expect(page.locator('[data-no-tabs-note]')).toHaveCount(0);
    await page.goto('/dashboard?tab=swimlane');
    await expect(page).toHaveURL(/tab=summary/);
  });

  test('overdue and due-soon lists link to the sorted queue', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Late ${uid()}`, dueDate: dateInZone(FIRM_ZONE, -3) });
    await page.goto('/dashboard');

    const overdue = page.locator('[data-panel="overdue"]');
    await expect(overdue.locator('li').first()).toContainText('Overdue');
    const viewAll = overdue.getByRole('link', { name: /View all overdue tasks/ });
    const href = await viewAll.getAttribute('href');
    await viewAll.click();
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page).toHaveURL(/sort=priority&dir=asc/);
    await expectPressedView(page, 'overdue', 'Overdue', href);
  });

  test.describe('overdue list by priority (dashboard review 2, recommendation 1)', () => {
    const RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };

    async function seedOverdue(seed: import('../support/seed').Seeder) {
      const world = await seed.world();
      const page = await seed.admin.get<Record<string, unknown>>('/api/v1/priorities');
      const list = (Array.isArray(page) ? page : (page['items'] as unknown[])) as {
        id: number;
        label: string;
      }[];
      const id = (label: string) => list.find((p) => p.label === label)!.id;
      // The Normal task is far more overdue than the Critical one: a due-date order would put it first.
      await seed.task(world, {
        title: `Late normal ${uid()}`,
        priorityId: id('Normal'),
        dueDate: dateInZone(FIRM_ZONE, -30),
      });
      await seed.task(world, {
        title: `Late critical ${uid()}`,
        priorityId: id('Critical'),
        dueDate: dateInZone(FIRM_ZONE, -1),
      });
    }

    test('lists Critical first, names the rule, shows the severity in the tile and opens the queue in the same order', async ({
      page,
      seed,
    }) => {
      await seedOverdue(seed);
      await page.goto('/dashboard');
      await page.getByRole('button', { name: 'Refresh' }).click();

      const overdue = page.locator('[data-panel="overdue"]');
      await expect(overdue.locator('[data-order]')).toHaveText(
        'Critical first, then longest overdue.',
      );
      await expect(overdue.locator('li').first()).toBeVisible();
      const labels = await overdue.locator('li mf-priority-badge').allInnerTexts();
      const ranks = labels.map((l) => RANK[l.trim()] ?? 9);
      expect(ranks.length).toBeGreaterThan(0);
      expect(ranks[0]).toBe(0);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
      // Each row keeps its days overdue next to the priority.
      await expect(overdue.locator('li').first().locator('[data-due]')).toContainText(
        /Overdue \d+d/,
      );

      // The tile names the Critical count in words with an icon, and opens the queue in the list's order.
      const tile = page.getByRole('link', { name: /^Overdue\s*\d+\b/ });
      const detail = tile.locator('[data-detail]');
      await expect(detail).toContainText(/\d+ Critical/);
      await expect(detail.locator('.pi')).toHaveCount(1);
      const tileHref = await tile.getAttribute('href');
      await tile.click();
      await expect(page).toHaveURL(/overdue=true/);
      await expect(page).toHaveURL(/sort=priority&dir=asc/);
      await expectPressedView(page, 'overdue', 'Overdue', tileHref);
    });

    for (const size of [
      { width: 1366, height: 768 },
      { width: 375, height: 812 },
    ]) {
      test(`axe is clean on the Summary tab with the severity line at ${size.width}`, async ({
        page,
        seed,
      }) => {
        test.skip(
          !axeAvailable(),
          'axe-core is not installed (npm ci) and E2E_AXE_PATH is not set',
        );
        await seedOverdue(seed);
        await page.setViewportSize(size);
        await page.goto('/dashboard');
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(page.locator('[data-panel="overdue"] li').first()).toBeVisible();
        await expect(page.locator('[data-detail]').first()).toBeVisible();
        expect(await axeViolations(page)).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
      });
    }
  });

  test('the period list drives created and completed only, is in the address and sticks', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const week = page.waitForRequest(
      (r) => /[?&]period=7d/.test(r.url()) && r.url().includes('/api/v1/dashboard'),
    );
    await page.getByLabel('Period', { exact: true }).selectOption({ label: '7 days' });
    await week;
    await expect(page).toHaveURL(/\/dashboard\?period=7d$/);
    // The tile captions read the resolved range ("Oct 10 to Oct 16").
    await expect(
      page
        .getByRole('group', { name: 'Overview', exact: true })
        .locator('.caption', { hasText: / to / })
        .first(),
    ).toBeVisible();

    await page.reload();
    await expect(page.locator('select[data-period]')).toHaveValue('7d');
    // Without the parameter the remembered choice applies, and the address stays clean.
    await page.goto('/dashboard');
    await expect(page.locator('select[data-period]')).toHaveValue('7d');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('tabs: the address, reload and a shared link keep the tab, and a plain /dashboard link opens Summary', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    // A plain link is not rewritten (P9): the first permitted tab is the default and needs no parameter.
    await expect(page).toHaveURL(/\/dashboard$/);
    const tabs = page.getByRole('tablist', { name: 'Dashboard views' });
    await expect(tabs.getByRole('tab')).toHaveText([
      'Summary',
      'Breakdowns',
      'Trends',
      'Swimlane',
      'Users',
    ]);
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await tabs.getByRole('tab', { name: 'Breakdowns' }).click();
    await expect(page).toHaveURL(/tab=breakdowns/);
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Priority', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open by pod' })).toHaveCount(0);

    await page.reload();
    await expect(tabs.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // No ?tab= in the address: Summary, whatever tab was used last.
    await page.goto('/dashboard');
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/\/dashboard$/);
    // A tab change is a history entry: Back returns to the previous tab.
    await tabs.getByRole('tab', { name: 'Trends' }).click();
    await expect(page).toHaveURL(/tab=trends/);
    await page.goBack();
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // A link with ?tab= wins.
    await page.goto('/dashboard?tab=trends');
    await expect(page.getByRole('heading', { name: 'Created and completed' })).toBeVisible();
    // An unknown tab falls back to a valid one.
    await page.goto('/dashboard?tab=nonsense');
    await expect(page).toHaveURL(/tab=summary$/);
  });

  test('tabs work with the keyboard: arrows move and select, Home and End jump, only the selected tab is a tab stop', async ({
    page,
  }) => {
    await page.goto('/dashboard?tab=summary');
    const tabs = page.getByRole('tablist', { name: 'Dashboard views' });
    // Wait until the page has rendered and the Summary tab is the selected, roving tab stop; arrow keys pressed before the
    // component is live (parallel load) would go nowhere.
    await expect(page.locator('[data-group="attention"]')).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute('tabindex', '0');
    await tabs.getByRole('tab', { name: 'Summary' }).focus();
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Breakdowns' })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute('tabindex', '0');
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute('tabindex', '-1');
    await expect(page).toHaveURL(/tab=breakdowns/);
    // Each key moves the selection through the address; wait for it before the next key (a tab that renders a lot, such as Users, would
    // otherwise still be the selected one when the next arrow is read).
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: 'Users' })).toBeFocused();
    await expect(page).toHaveURL(/tab=users/);
    await expect(tabs.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toBeFocused();
    await expect(page).toHaveURL(/tab=summary/);
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: 'Users' })).toBeFocused();
    await expect(page).toHaveURL(/tab=users/);
    await expect(tabs.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tabs.getByRole('tab', { name: 'Summary' })).toBeFocused();
    await expect(page).toHaveURL(/tab=summary/);
    // Tab leaves the tab list into the panel (the next tab stop is not another tab).
    await page.keyboard.press('Tab');
    await expect(tabs.getByRole('tab', { name: 'Breakdowns' })).not.toBeFocused();
  });

  test('switching tabs does not repeat the dashboard request, and the period control shows only on Summary and Trends', async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      // The summary only: the Trends tab reads its own series (/api/v1/dashboard/trend) when it is shown.
      if (r.url().includes('/api/v1/dashboard') && !r.url().includes('/api/v1/dashboard/')) {
        calls.push(r.url());
      }
    });
    await page.goto('/dashboard');
    await expect(page.locator('[data-group="attention"]')).toBeVisible();
    await expect(page.locator('select[data-period]')).toHaveCount(1);
    const tabs = page.getByRole('tablist', { name: 'Dashboard views' });
    await tabs.getByRole('tab', { name: 'Breakdowns' }).click();
    await expect(page.locator('select[data-period]')).toHaveCount(0);
    await tabs.getByRole('tab', { name: 'Trends' }).click();
    await expect(page.locator('select[data-period]')).toHaveCount(1);
    await tabs.getByRole('tab', { name: 'Summary' }).click();
    await expect(page.locator('[data-panel="unassigned"]')).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test('the trend has a chart and a table of the same days', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Trend ${uid()}` });
    await page.goto('/dashboard?tab=trends');
    const trend = page.getByRole('region', { name: 'Tasks over time', exact: true });
    await expect(trend.getByRole('group', { name: /created and completed/i })).toBeVisible();
    await trend.getByRole('button', { name: /View as table/ }).click();
    await expect(trend.getByRole('table')).toBeVisible();
    await expect(trend.getByRole('table').getByRole('link').first()).toBeVisible();
  });
});

test.describe('Audit Logs browser (smoke)', () => {
  test('the audit log lists the events of one task and shows the details of an event', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world, { title: `Audited ${uid()}` });

    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit Logs', level: 1 })).toBeVisible();
    // The filter row is open from the start (AD7, #646).
    await page.getByRole('combobox', { name: 'Filter by Object type' }).selectOption('Task');
    await page.getByRole('textbox', { name: 'Filter by Object id' }).fill(String(task.taskId));
    // The id applies live after a pause and reloads the list, which closes an opened row: wait for that load before opening one.
    await expect(page).toHaveURL(new RegExp(`objectId=${task.taskId}(&|$)`));
    await expect(page.locator('tr[data-event]')).toHaveCount(1); // only this task's own event is left once the id has applied

    const created = page
      .locator('tr[data-event]')
      .filter({ hasText: `${task.taskNumber} created` });
    await expect(created).toHaveCount(1);
    await expect(created).toContainText('ke\\kekim');
    await created.getByRole('button', { name: /^Show details: / }).click();
    // The event code is a technical detail, behind its own disclosure (#652).
    await page.locator('tr.au-detail').getByRole('button', { name: 'Technical details' }).click();
    await expect(page.locator('tr.au-detail')).toContainText('TASK_CREATED');
    await created.getByRole('link', { name: new RegExp(task.taskNumber) }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}$`));
  });

  test('filtering by event type and text narrows the list, live, and Clear filters clears it', async ({
    page,
    seed,
  }) => {
    const client = await seed.client();

    await page.goto('/admin/audit');
    await page
      .getByRole('combobox', { name: 'Filter by Event type' })
      .selectOption('CLIENT_CREATED');
    await page
      .getByRole('textbox', { name: 'Filter by Summary or field' })
      .fill(client.clientNumber);
    const rows = page.locator('tr[data-event]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Client ${client.clientNumber} created`);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('combobox', { name: 'Filter by Event type' })).toHaveValue('');
  });

  test('the log is read only: there is no export, edit or delete action', async ({ page }) => {
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit Logs', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /export|download|delete|edit/i })).toHaveCount(0);
    await expect(page.getByText('Every recorded change, newest first. Read only.')).toBeVisible();
  });

  test('a compliance auditor can read the log and a technician cannot', async ({
    seed,
    asUser,
  }) => {
    const auditor = await seed.user(['Compliance Auditor'], 'auditor');
    const auditorPage = await asUser(auditor.username);
    await auditorPage.goto('/admin/audit');
    await expect(auditorPage.getByRole('heading', { name: 'Audit Logs', level: 1 })).toBeVisible();
    await expect(auditorPage.locator('tr[data-event]').first()).toBeVisible();

    const tech = await seed.user(['Data Technician'], 'nolog');
    const techPage = await asUser(tech.username);
    await techPage.goto('/admin/audit');
    await expect(
      techPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });
});
