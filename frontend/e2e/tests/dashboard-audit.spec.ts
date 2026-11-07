import { axeAvailable, axeViolations } from '../support/axe';
import { TaskQueuePage } from '../pages/queues.pages';
import { expect, test } from '../support/fixtures';
import { dateInZone, FIRM_ZONE } from '../support/time';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { filterDropdown, labelledDropdown } from '../support/dropdown';

test.describe('Dashboard drill-through', () => {
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
    await expect(page.getByRole('group', { name: 'Needs Attention' })).toHaveCount(0);
    await page.locator('[data-no-tabs-note]').getByRole('link', { name: 'My Work' }).click();
    await expect(page).toHaveURL(/\/my-work/);
  });
});

test.describe('Dashboard actions and click-through', () => {
  type Page = import('@playwright/test').Page;
  /** Chips of the filters that have no column in the grid (the filter row shows the others). */
  const chips = (page: Page) => page.getByRole('list', { name: 'Active filters' });
  /**
   * Since #221 a link that matches a quick view presses it, and a pressed view hides the chips of the filters it owns (so there is no "Overdue Only"
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
      chips(page).getByText(label === 'ASAP' ? 'ASAP Only' : 'Overdue Only'),
    ).toHaveCount(0);
  }

  /** The control of a filter in the Task Queue's filter row, which is open when a link brings filters. */
  const control = (page: Page, key: string) =>
    page.locator(`tr[data-filter-row] [data-filter="${key}"]`);

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
      'Calendar',
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
    await expect(page.getByRole('heading', { name: 'Created and Completed' })).toBeVisible();
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
    await expect(page.locator('[data-dash-cards]')).toBeVisible();
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

  test('the trend has a chart and a table of the same days', async ({ page, seed }) => {
    const world = await seed.world();
    await seed.task(world, { title: `Trend ${uid()}` });
    await page.goto('/dashboard?tab=trends');
    const trend = page.getByRole('region', { name: 'Tasks Over Time', exact: true });
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
    await filterDropdown(page, 'Object Type').selectOption('Task');
    await page.getByRole('textbox', { name: 'Filter by Object ID' }).fill(String(task.taskId));
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
    await page.locator('tr.au-detail').getByRole('button', { name: 'Technical Details' }).click();
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
    await filterDropdown(page, 'Event Type').selectOption('CLIENT_CREATED');
    await page
      .getByRole('textbox', { name: 'Filter by Summary or Field' })
      .fill(client.clientNumber);
    const rows = page.locator('tr[data-event]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`Client ${client.clientNumber} created`);

    await page.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(filterDropdown(page, 'Event Type')).toHaveAttribute('data-value', '');
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
    await expect(techPage.getByRole('heading', { name: "You don't have access." })).toBeVisible();
  });
});
