import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My Matters tabs (epic #758, WP-PX4: #776 to #781): Overview with "Since your last visit", Deadlines, Workload, Trends and Activity. Every test
 * builds the matters and tasks it needs in a world of its own, so the numbers on the page are written down here instead of read back.
 */
const tab = (page: Page, key: string) => page.locator(`[role=tab][data-tab="${key}"]`);
const panel = (page: Page, name: string) => page.locator(`[data-panel="${name}"]`);

/** A first visit: Recent activity creates the person's marker at the newest event (nothing is unread yet). */
async function prime(page: Page): Promise<void> {
  await page.goto('/my-matters');
  await expect(
    panel(page, 'activity').locator('[data-activity-row], [data-empty]').first(),
  ).toBeVisible();
}

test.describe('My Matters: the tab shell', () => {
  test('five tabs, Overview first, the filters shared and kept in the address, Back brings the tab back with focus', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'shell');
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: inDays(3) });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.getByRole('tab')).toHaveText([
      'Overview',
      'Deadlines',
      'Workload',
      'Trends',
      'Activity',
    ]);
    await expect(tab(page, 'overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-mm-tabpanel]')).toHaveAttribute(
      'aria-labelledby',
      'mm-tab-overview',
    );
    await expect(panel(page, 'health')).toBeVisible();

    await page.locator('[data-filter=role]').selectOption('primary');
    await tab(page, 'deadlines').click();
    await expect(page).toHaveURL(/tab=deadlines/);
    await expect(page).toHaveURL(/role=primary/);
    await expect(panel(page, 'deadlines-tab')).toBeVisible();
    await expect(page.locator('[data-filter=role]')).toHaveValue('primary');
    await tab(page, 'workload').click();
    await expect(panel(page, 'workload-tab')).toBeVisible();
    await expect(page.locator('[data-filter=range]')).toHaveCount(0); // the dates belong to Overview and Deadlines

    // Back returns to the earlier tab and puts focus on its tab.
    await page.goBack();
    await expect(tab(page, 'deadlines')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'deadlines')).toBeFocused();

    // Keyboard only, with the keys the app has: Right and Left move between tabs, Home goes to Overview.
    await tab(page, 'deadlines').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'workload')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(tab(page, 'overview')).toHaveAttribute('aria-selected', 'true');
    expect(page.url()).not.toContain('tab=');
    expect(page.url()).toContain('role=primary');
  });

  test('a PM without Task.View, the Director and a technician have no My Matters; a holder of Matter.AssignManagers has the tabs in the All scope', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'perm');
    await w.matter('Alpha');
    const noTask = await personas.create({
      label: 'px4-notask',
      permissions: ['Client.View', 'Matter.View', 'Matter.BeManager', 'Matter.AssignManagers'],
    });
    for (const who of [
      noTask,
      await personas.named('director'),
      await personas.named('technician'),
    ]) {
      const page = await asUser(who.username);
      await page.goto('/my-matters?tab=trends');
      await expect(page.locator('[role=tab]')).toHaveCount(0);
    }
    const page = await asUser(w.pm.username); // the Project Manager role holds Matter.AssignManagers
    await page.goto('/my-matters?scope=all&tab=workload');
    await expect(panel(page, 'workload-tab')).toBeVisible();
    await expect(page.locator('[data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
    await tab(page, 'activity').click();
    await expect(panel(page, 'activity-tab')).toBeVisible();
    await expect(page).toHaveURL(/scope=all/);
  });
});

test.describe('My Matters: Since your last visit', () => {
  test('counts that are links, the marker moves only on Mark as read, and the first visit shows the last 7 days', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'since');
    const m = await w.matter('Alpha');
    await w.task(m, { title: 'Before the first visit' });
    const page = await asUser(w.pm.username);

    // First ever visit: no marker yet, so the card covers the last 7 days.
    await page.goto('/my-matters');
    const card = panel(page, 'since');
    await expect(card.locator('[data-since-period]')).toContainText('last 7 days');
    await expect(card.locator('[data-figure=newTasks]')).toContainText('1 new task');
    // Recent activity waited for the card, then created a starting point for its unread dots (issue #815): that is not a last visit.
    await expect(
      panel(page, 'activity').locator('[data-activity-row], [data-empty]').first(),
    ).toBeVisible();

    // Looking at the Activity tab and coming back, or reloading, changes nothing the card says.
    await page.reload();
    await expect(card.locator('[data-figure=newTasks]')).toContainText('1 new task');
    await tab(page, 'activity').click();
    await expect(panel(page, 'activity-tab').locator('[data-activity-row]').first()).toBeVisible();
    await tab(page, 'overview').click();
    await expect(card.locator('[data-figure=newTasks]')).toContainText('1 new task');
    await page.reload();
    await expect(card.locator('[data-since-period]')).toContainText('last 7 days');
    await expect(card.locator('[data-figure=newTasks]')).toContainText('1 new task');
    await expect(card.locator('[data-since-empty]')).toHaveCount(0);

    // Mark as read is what moves it.
    await card.locator('[data-mark-read]').click();
    await expect(card.locator('[data-since-empty]')).toContainText(
      'Nothing has changed since your last visit.',
    );
    await page.reload();
    await expect(card.locator('[data-since-empty]')).toContainText(
      'Nothing has changed since your last visit.',
    );

    // Something happens: two new tasks and one put on hold.
    await w.task(m, { title: 'News one' });
    const held = await w.task(m, { title: 'News two' });
    await seed.admin.post(`/api/v1/tasks/${held.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting for the client',
      rowVersion: held.rowVersion,
    });
    await page.reload();
    await expect(card.locator('[data-figure=newTasks]')).toContainText('2 new tasks');
    await expect(card.locator('[data-figure=putOnHold]')).toContainText('1 put on hold');
    await expect(card.locator('[data-since-item]').first()).toContainText('News two');
    await expect(card.locator('[data-since-period]')).toContainText(/^Since /);
    await shot(page, 'px4-since');

    // Opening the page again does not move the marker.
    await page.reload();
    await expect(card.locator('[data-figure=newTasks]')).toContainText('2 new tasks');

    // A count opens the Activity tab on exactly those events.
    await card.locator('[data-figure=newTasks]').click();
    await expect(page).toHaveURL(/tab=activity/);
    await expect(page).toHaveURL(/kind=TASK_CREATED/);
    await expect(panel(page, 'activity-tab').locator('[data-activity-row]')).toHaveCount(2);
    await page.goBack();

    // Mark as read is the one thing that moves it; the Recent activity panel follows.
    await card.locator('[data-mark-read]').click();
    await expect(card.locator('[data-since-empty]')).toBeVisible();
    await expect(page.locator('[data-since-announce]')).toHaveText('Marked as read.');
    await expect(panel(page, 'activity').locator('[data-unread-word]')).toHaveCount(0);
    await page.reload();
    await expect(card.locator('[data-since-empty]')).toBeVisible();
  });
});

test.describe('My Matters: Deadlines', () => {
  test('a list by matter, a calendar of week rows, the range, and every count equals the Task Queue it opens', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'dl');
    const a = await w.matter('Alpha');
    const b = await w.matter('Bravo');
    await w.task(a, { dueDate: inDays(3), title: 'A near one' });
    await w.task(a, { dueDate: inDays(3), title: 'A near two' });
    await w.task(a, { dueDate: inDays(20), title: 'A far' });
    await w.task(b, { dueDate: inDays(5), title: 'B middle' });
    await w.task(b, { dueDate: '2000-01-01', title: 'B overdue' }); // overdue work is not a deadline
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=deadlines');
    const tabPanel = panel(page, 'deadlines-tab');

    // List by matter, 4 weeks: A has three, B has one.
    await expect(tabPanel.locator('[data-matter-group]')).toHaveCount(2);
    await expect(tabPanel.locator('[data-matter-group]').first()).toContainText('(3)');
    await expect(tabPanel.locator('[data-deadline-row]')).toHaveCount(4);
    // 2 weeks leaves out the task due in 20 days.
    await tabPanel.locator('[data-range="2w"]').click();
    await expect(page).toHaveURL(/range=2w/);
    await expect(tabPanel.locator('[data-deadline-row]')).toHaveCount(3);
    await expect(tabPanel.locator('[data-matter-group]').first()).toContainText('(2)');
    await tabPanel.locator('[data-range="4w"]').click();

    // The calendar: week rows, today in words, a count per day that opens the Task Queue with the same tasks.
    await tabPanel.locator('[data-view="calendar"]').click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(tabPanel.locator('[data-calendar]')).toBeVisible();
    await expect(tabPanel.getByText('Today', { exact: true })).toBeVisible();
    const day = tabPanel.locator('[data-day-count]').filter({ hasText: /^2$/ });
    await expect(day).toHaveCount(1);
    await day.click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page.locator('[data-range]').first()).toContainText('of 2');
    await page.goBack();
    await expect(tabPanel.locator('[data-calendar]')).toBeVisible();

    // A phone gets the grouped list: no calendar, no view toggle.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(tabPanel.locator('[data-calendar]')).toHaveCount(0);
    await expect(tabPanel.locator('[data-view]')).toHaveCount(0);
    await expect(tabPanel.locator('[data-matter-group]')).toHaveCount(2);
  });
});

test.describe('My Matters: Workload', () => {
  test('open work per person on my matters, who is away, the matters behind a person, a name opens the Task Queue', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'wl');
    const away = await personas.create({
      label: 'wl-away',
      roles: ['Data Technician'],
      displayName: 'Away Technician',
    });
    await seed.outOfOffice(away.userId);
    const here = await personas.create({
      label: 'wl-here',
      roles: ['Data Technician'],
      displayName: 'Here Technician',
    });
    const pod = await seed.pod(undefined, [away.userId, here.userId]);
    const a = await w.matter('Alpha');
    const b = await w.matter('Bravo');
    const elsewhere = await w.matter('Other pm', w.other, null);
    await w.task(a, {
      assignedUserId: away.userId,
      assignedPodId: pod.podId,
      dueDate: '2000-01-01',
    });
    await w.task(a, { assignedUserId: away.userId, assignedPodId: pod.podId, dueDate: inDays(30) });
    await w.task(b, { assignedUserId: away.userId, assignedPodId: pod.podId, dueDate: inDays(2) });
    await w.task(a, { assignedUserId: here.userId, assignedPodId: pod.podId, dueDate: inDays(30) });
    await w.task(elsewhere, { assignedUserId: here.userId, assignedPodId: pod.podId });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=workload');
    const table = panel(page, 'workload-tab');
    const person = (name: string) => table.locator('[data-person]', { hasText: name });
    await expect(person('Away Technician')).toContainText('Away');
    await expect(person('Away Technician').locator('[data-away]')).toContainText(/^Away/);
    await expect(person('Away Technician').locator('td.num').nth(0)).toContainText('3'); // open
    await expect(person('Away Technician').locator('td.num').nth(1)).toHaveText('1'); // overdue
    await expect(person('Away Technician').locator('td.num').nth(2)).toHaveText('1'); // due this week
    await expect(person('Here Technician').locator('td.num').nth(0)).toContainText('1'); // not the other PM's matter
    await expect(person('Here Technician').locator('[data-away]')).toHaveCount(0);
    // Away and holding overdue work sorts first inside the pod; nothing is ranked or coloured.
    await expect(table.locator('[data-person]').first()).toContainText('Away Technician');
    await expect(table).not.toContainText(/overload/i);

    await person('Away Technician').locator('[data-matters-toggle]').click();
    await expect(table.locator('[data-matters] li')).toHaveCount(2);
    await person('Away Technician').getByRole('link', { name: 'Away Technician' }).click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page.locator('[data-range]').first()).toContainText('of 3');
  });
});

test.describe('My Matters: Trends', () => {
  test('charts with a text summary and a table, the approximate note on the screen, weeks 8, 12 and 26, and tables on a phone', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'tr');
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a);
    const held = await w.task(a);
    await seed.admin.post(`/api/v1/tasks/${held.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting',
      rowVersion: held.rowVersion,
    });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=trends');
    const trends = panel(page, 'trends');
    await expect(trends.locator('[data-approximate]')).toContainText('Approximate');
    await expect(trends.locator('[data-limitations] li').first()).toBeVisible();
    await expect(trends.locator('svg[role=img]')).toHaveCount(2);
    await expect(trends.locator('[data-chart=flow] [data-summary]')).toContainText(
      '3 tasks were created',
    );
    await expect(trends.locator('[data-hold]')).toHaveText('1');
    await expect(trends.locator('[data-chart=overdue] [data-table]')).toHaveCount(0);
    await trends.locator('[data-chart=overdue] [data-show-table]').click();
    await expect(trends.locator('[data-table=overdue] tbody tr')).toHaveCount(12);
    await trends.locator('[data-weeks="26"]').click();
    await expect(page).toHaveURL(/weeks=26/);
    await expect(trends.locator('[data-table=overdue] tbody tr')).toHaveCount(26);
    await trends.locator('[data-weeks="8"]').click();
    await expect(trends.locator('[data-table=overdue] tbody tr')).toHaveCount(8);
    await trends.locator('[data-how] summary').click();
    await expect(trends.locator('[data-how]')).toContainText('Monday to Sunday');
    // The age is a number with a link to the tasks it averages.
    await trends.getByRole('link', { name: /open tasks/ }).click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await page.goBack();

    // Below 480 px the tables replace the charts.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(trends.locator('svg')).toHaveCount(0);
    await expect(trends.locator('[data-table=flow]')).toBeVisible();
  });
});

test.describe('My Matters: Activity', () => {
  test('New in words, the divider, filters, mark as read up to here and for all, load more, comment text never shown', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'act');
    const a = await w.matter('Alpha');
    const b = await w.matter('Bravo');
    await w.task(a, { title: 'Old one' });
    const page = await asUser(w.pm.username);
    await prime(page);

    // The earlier events: one task and the two managers set when the matters were made. After the marker, unread: two new tasks on Alpha, one on
    // Bravo and a comment with text that must never show.
    const t1 = await w.task(a, { title: 'Fresh alpha one' });
    await w.task(a, { title: 'Fresh alpha two' });
    await w.task(b, { title: 'Fresh bravo' });
    await seed.admin.post(`/api/v1/tasks/${t1.taskId}/comments`, {
      bodyHtml: '<p>SECRET PRIVILEGED WORDS</p>',
    });
    await page.goto('/my-matters?tab=activity');
    const act = panel(page, 'activity-tab');
    await expect(act.locator('[data-activity-row]')).toHaveCount(7);
    await expect(act.locator('[data-new-word]')).toHaveCount(4);
    await expect(act.locator('[data-divider]')).toHaveText(['Since your last visit', 'Earlier']);
    await expect(act.locator('[data-activity-announce]')).toHaveText(
      /4 new events since your last visit/,
    );
    await expect(page.locator('main')).not.toContainText('SECRET PRIVILEGED WORDS');
    await expect(act.locator('[data-activity-row]').first()).toContainText('commented on');
    // Each event links to the task and the matter.
    await expect(act.locator('[data-matter-link]').first()).toBeVisible();

    // Filters: Kind and Matter live in the address; unread only.
    await act.locator('[data-filter=kind]').selectOption('TASK_CREATED');
    await expect(page).toHaveURL(/kind=TASK_CREATED/);
    await expect(act.locator('[data-activity-row]')).toHaveCount(4);
    await act.locator('[data-filter=unread]').check();
    await expect(act.locator('[data-activity-row]')).toHaveCount(3);
    await act.locator('[data-filter=kind]').selectOption('');
    await act.locator('[data-filter=unread]').uncheck();

    // Mark as read up to here: that event and the older ones; the newer stay New.
    const rows = act.locator('[data-activity-row][data-unread=true]');
    await expect(rows).toHaveCount(4);
    await rows.nth(1).locator('[data-mark-up-to]').click();
    await expect(act.locator('[data-new-word]')).toHaveCount(1);
    await expect(act.locator('[data-activity-announce]')).toHaveText('Marked as read up to here.');
    await expect(page.locator('[data-activity-link]:focus')).toHaveCount(1);
    // Mark all as read: no New left, the divider is gone, focus goes to the list.
    await act.locator('[data-mark-all-read]').click();
    await expect(act.locator('[data-new-word]')).toHaveCount(0);
    await expect(act.locator('[data-divider]')).toHaveCount(0);
    await expect(act.locator('[data-mark-all-read]')).toHaveCount(0);
    await expect(act.locator('[data-activity-list]')).toBeFocused();
    await page.reload();
    await expect(act.locator('[data-new-word]')).toHaveCount(0);
  });

  test('30 events at a time with Load more, newest first', async ({ seed, personas, asUser }) => {
    const w = await mmWorld(seed, personas, 'page');
    const a = await w.matter('Alpha');
    for (let i = 1; i <= 32; i++) await w.task(a, { title: `Paged ${String(i).padStart(2, '0')}` });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=activity');
    const act = panel(page, 'activity-tab');
    await expect(act.locator('[data-activity-row]')).toHaveCount(30);
    await expect(act.locator('[data-activity-row]').first()).toContainText('Paged 32');
    await act.locator('[data-show-more]').click();
    await expect(act.locator('[data-activity-row]')).toHaveCount(33); // 32 tasks and the manager set with the matter
    await expect(act.locator('[data-show-more]')).toHaveCount(0);
  });
});

test.describe('My Matters: the first screen on a phone', () => {
  test('375x812: Since shows its counts line and a "Show events" expander, and Needs my attention starts in the first screen (#818)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'phone1');
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: inDays(-2), title: 'Fell due two days ago' });
    await w.task(m, { title: 'Nobody has this' });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/my-matters');
    const card = panel(page, 'since');
    await expect(card.locator('[data-since-figures]')).toBeVisible();
    // The Overdue count is in the first screen, whole.
    const overdue = (await page.locator('[data-strip-item=overdue]').boundingBox())!;
    expect(overdue.x + overdue.width).toBeLessThanOrEqual(375);
    expect(overdue.y + overdue.height).toBeLessThanOrEqual(812);
    // Needs my attention starts in the first screen.
    const attention = (await panel(page, 'attention').locator('h2').boundingBox())!;
    expect(attention.y + attention.height).toBeLessThanOrEqual(812);

    // The events are behind a button; focus stays on it and aria-expanded says which way it is.
    const toggle = card.locator('[data-since-toggle]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('Show events');
    await expect(card.locator('[data-since-items]')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
    await expect(toggle).toContainText('Hide events');
    await expect(card.locator('[data-since-item]').first()).toBeVisible();
    await expect(card.locator('[data-since-item]').first()).toContainText('Fell due two days ago');
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(card.locator('[data-since-items]')).toBeHidden();
    expect(await axeViolations(page), 'collapsed').toEqual([]);
    await toggle.click();
    expect(await axeViolations(page), 'expanded').toEqual([]);
    await noHorizontalScroll(page);

    // From 640 px there is no button and the events always show.
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(toggle).toBeHidden();
    await expect(card.locator('[data-since-item]').first()).toBeVisible();
  });
});

test.describe('My Matters tabs: four sizes', () => {
  for (const size of SIZES) {
    test(`every tab at ${size.width}x${size.height}: axe 0, no sideways scroll, the tab strip scrolls inside itself`, async ({
      seed,
      personas,
      asUser,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not installed');
      const w = await mmWorld(seed, personas, `size${size.width}`);
      const a = await w.matter('Alpha');
      await w.task(a, { dueDate: inDays(3), title: 'Sized one' });
      await w.task(a, { dueDate: '2000-01-01', title: 'Sized overdue' });
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      const urls: [string, string][] = [
        ['overview', '/my-matters'],
        ['deadlines', '/my-matters?tab=deadlines'],
        ['calendar', '/my-matters?tab=deadlines&view=calendar'],
        ['workload', '/my-matters?tab=workload'],
        ['trends', '/my-matters?tab=trends'],
        ['activity', '/my-matters?tab=activity'],
      ];
      for (const [name, url] of urls) {
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expect(page.locator('[data-mm-tabpanel] [role=status][data-loading]')).toHaveCount(0);
        expect(await axeViolations(page), `${name} at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
        await shot(page, `px4-${name}`);
      }
      if (size.width < 640) {
        // The strip scrolls inside itself; the page does not.
        const strip = page.locator('[role=tablist]');
        expect(await strip.evaluate((el) => el.scrollWidth >= el.clientWidth)).toBe(true);
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
        expect(await axeViolations(page), 'menu open').toEqual([]);
      }
    });
  }
});
