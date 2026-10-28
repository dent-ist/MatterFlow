import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My Matters tabs (epic #758, WP-PX4: #776 to #781): Overview with "Since your last visit", Deadlines, Trends and Activity. Every test
 * builds the matters and tasks it needs in a world of its own, so the numbers on the page are written down here instead of read back.
 */
const tab = (page: Page, key: string) => page.locator(`[role=tab][data-tab="${key}"]`);
const panel = (page: Page, name: string) => page.locator(`[data-panel="${name}"]`);

/** A first visit to the Activity tab creates the person's marker at the newest event (nothing is unread yet); the Overview no longer reads the events (#909). */
async function prime(page: Page): Promise<void> {
  await page.goto('/my-matters?tab=activity');
  await expect(
    panel(page, 'activity-tab').locator('[data-activity-row], [data-empty]').first(),
  ).toBeVisible();
}

test.describe('My Matters: the tab shell', () => {
  test('four tabs, Overview first, the filters shared and kept in the address, Back brings the tab back with focus', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'shell');
    const m = await w.matter('Alpha');
    await w.matter('Beta', w.other, w.pm); // Primary on one, Secondary on the other: the Role filter is offered
    await w.task(m, { dueDate: inDays(3) });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    // The Activity tab may carry a small badge (the changes since the last visit): the label is the words before it.
    await expect(page.getByRole('tab')).toHaveText([
      /^\s*Overview\s*$/,
      /^\s*Deadlines\s*$/,
      /^\s*Breakdown\s*$/,
      /^\s*Data\s*$/,
      /^\s*Activity(\s+\d+)?\s*$/,
      /^\s*Trends\s*$/,
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
    await tab(page, 'trends').click();
    await expect(panel(page, 'trends')).toBeVisible();
    await expect(page.locator('[data-filter=range]')).toHaveCount(0); // the dates belong to the Deadlines tab (#906)

    // Back returns to the earlier tab and puts focus on its tab.
    await page.goBack();
    await expect(tab(page, 'deadlines')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'deadlines')).toBeFocused();

    // Keyboard only, with the keys the app has: Right and Left move between tabs, Home goes to Overview.
    await tab(page, 'deadlines').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'breakdown')).toHaveAttribute('aria-selected', 'true');
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
    await page.goto('/my-matters?scope=all&tab=trends');
    await expect(panel(page, 'trends')).toBeVisible();
    await expect(page.locator('[data-scope="all"]')).toHaveAttribute('aria-pressed', 'true');
    await tab(page, 'activity').click();
    await expect(panel(page, 'activity-tab')).toBeVisible();
    await expect(page).toHaveURL(/scope=all/);
  });
});

test.describe('My Matters: what changed, one line on the Activity tab with its count as a badge (#909, owner decision of 2026-10-28)', () => {
  test('counts that are links, the marker moves only on Mark as read, and the first visit shows the last 7 days', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'since');
    const m = await w.matter('Alpha');
    await w.task(m, { title: 'Before the first visit' });
    const page = await asUser(w.pm.username);

    // The Overview does not draw the line; the Activity tab carries its count as a small badge (one new unassigned task) and shows the line when opened.
    await page.goto('/my-matters');
    await expect(page.locator('#mm-tab-overview')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'activity').locator('[data-tab-badge]')).toHaveText('1');
    await expect(panel(page, 'since')).toHaveCount(0);

    // First ever visit: no marker yet, so the line covers the last 7 days. Only what needs a decision is counted: the new unassigned task.
    await tab(page, 'activity').click();
    await expect(page).toHaveURL(/tab=activity/);
    const line = panel(page, 'since');
    await expect(line.locator('[data-since-period]')).toContainText('In the last 7 days:');
    await expect(line.locator('[data-figure=newUnassigned]')).toContainText('1 new unassigned');
    await expect(line.locator('[data-figure=newTasks], [data-figure=comments]')).toHaveCount(0);

    // Looking at the Activity tab and coming back, or reloading, changes nothing the line says.
    await page.reload();
    await expect(line.locator('[data-figure=newUnassigned]')).toContainText('1 new unassigned');
    await expect(panel(page, 'activity-tab').locator('[data-activity-row]').first()).toBeVisible();
    await tab(page, 'overview').click();
    await expect(tab(page, 'activity').locator('[data-tab-badge]')).toHaveText('1');
    await tab(page, 'activity').click();
    await expect(line.locator('[data-figure=newUnassigned]')).toContainText('1 new unassigned');
    await page.reload();
    await expect(line.locator('[data-since-period]')).toContainText('In the last 7 days:');

    // Mark as read is what moves it: the line goes away, and so does the badge.
    await line.locator('[data-mark-read]').click();
    await expect(panel(page, 'since')).toHaveCount(0);
    await expect(tab(page, 'activity').locator('[data-tab-badge]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('#mm-tab-activity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(panel(page, 'since')).toHaveCount(0);

    // Something happens: two new unassigned tasks and one of them put on hold.
    await w.task(m, { title: 'News one' });
    const held = await w.task(m, { title: 'News two' });
    await seed.admin.post(`/api/v1/tasks/${held.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting for the client',
      rowVersion: held.rowVersion,
    });
    await page.reload();
    await expect(tab(page, 'activity').locator('[data-tab-badge]')).toHaveText('3'); // 2 new unassigned + 1 put on hold
    await expect(line.locator('[data-figure=newUnassigned]')).toContainText('2 new unassigned');
    await expect(line.locator('[data-figure=putOnHold]')).toContainText('1 put on hold');
    await expect(line.locator('[data-since-period]')).toContainText(/^Since your last visit:/);
    await shot(page, 'px4-since');

    // Opening the page again does not move the marker.
    await page.reload();
    await expect(line.locator('[data-figure=newUnassigned]')).toContainText('2 new unassigned');

    // A count of events opens the Activity tab on exactly those events.
    await line.locator('[data-figure=putOnHold]').click();
    await expect(page).toHaveURL(/tab=activity/);
    await expect(page).toHaveURL(/kind=ON_HOLD/);
    await expect(panel(page, 'activity-tab').locator('[data-activity-row]')).toHaveCount(1);
    await page.goBack();

    // A count of tasks opens the Task Queue with exactly those tasks.
    const [queue] = await Promise.all([
      page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
      line.locator('[data-figure=newUnassigned]').click(),
    ]);
    // The count is to the second, the list starts at the day of the period (like "became overdue"): the task made earlier the same day is in the list too.
    expect(((await queue.json()) as { total: number }).total).toBeGreaterThanOrEqual(2);
    await page.goBack();

    // Mark as read is the one thing that moves it.
    await line.locator('[data-mark-read]').click();
    await expect(panel(page, 'since')).toHaveCount(0);
    await expect(page.locator('[data-since-announce]')).toHaveText('Marked as read.');
    await page.reload();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(panel(page, 'since')).toHaveCount(0);
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
    await page.locator('#mm-range').selectOption('2w'); // the Dates control of the tab (#906: the 2 / 4 week buttons are gone)
    await expect(page).toHaveURL(/range=2w/);
    await expect(tabPanel.locator('[data-deadline-row]')).toHaveCount(3);
    await expect(tabPanel.locator('[data-matter-group]').first()).toContainText('(2)');
    await page.locator('#mm-range').selectOption('4w');

    // The calendar: week rows, today in words, a count per day that opens the Task Queue with the same tasks.
    // The List / Calendar choice is behind the tab's Options menu (issue #894).
    await tabPanel.locator('[data-options-trigger]').click();
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
    // One line while closed (PV-12): the limitations open under it.
    await expect(trends.locator('[data-limitations] li').first()).toBeHidden();
    await trends.locator('[data-approximate] summary').click();
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

test.describe('My Matters: the first screen on a phone, and the skip links', () => {
  test('375x812: the Overview has no "what changed" line (a badge on the Activity tab), where it is one 44 px row, and Needs my attention starts in the first screen (#818, #909)', async ({
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
    // Nothing of the line on the Overview, and no events behind a button: the Activity tab carries the number.
    await expect(panel(page, 'since')).toHaveCount(0);
    await expect(page.locator('[data-since-toggle], [data-since-item]')).toHaveCount(0);
    await expect(tab(page, 'activity').locator('[data-tab-badge]')).toBeVisible();
    // The Overdue chip is in the first screen, whole.
    const overdue = (await page.locator('[data-strip-item=overdue]').boundingBox())!;
    expect(overdue.x + overdue.width).toBeLessThanOrEqual(375);
    expect(overdue.y + overdue.height).toBeLessThanOrEqual(812);
    // Needs my attention starts in the first screen.
    const attention = (await panel(page, 'attention').locator('h2').boundingBox())!;
    expect(attention.y + attention.height).toBeLessThanOrEqual(812);
    expect(await axeViolations(page), 'phone').toEqual([]);
    await noHorizontalScroll(page);
    // On the Activity tab the line is one row of 44 px targets that scrolls sideways.
    await tab(page, 'activity').click();
    const line = panel(page, 'since');
    await expect(line.locator('[data-since-figures]')).toBeVisible();
    expect((await line.boundingBox())!.height).toBeLessThanOrEqual(48);
    expect(await axeViolations(page), 'phone, activity').toEqual([]);
  });

  test('skip links: the first stops after the tab strip, each moves focus to its panel heading, the Tab order of the panels is unchanged (#820)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'skip');
    const m = await w.matter('Alpha');
    await w.matter('Beta'); // two matters: the matters list is on the page
    await w.task(m, { dueDate: inDays(-2), title: 'Fell due' });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await expect(panel(page, 'health').locator('[data-health-row]').first()).toBeVisible();
    await expect(page.locator('[data-skip-links]')).toBeAttached();

    const keys = ['attention', 'deadlines', 'health'];
    await page.locator('[role=tab][aria-selected=true]').focus();
    await page.keyboard.press('Tab');
    for (const key of keys) {
      await expect(page.locator(`[data-skip-to=${key}]`), key).toBeFocused();
      await expect(page.locator('[data-skip-links]')).toBeVisible(); // shown while a link has the focus
      await page.keyboard.press('Tab');
    }
    // After the skip links the Tab order is what it was: the first control of Needs my attention (the "since" line is on the Activity tab now).
    await expect(page.locator('[data-panel=attention] [data-view-all]')).toBeFocused();

    // Enter moves focus to the panel heading, with a visible ring; Tab goes on into that panel.
    for (const key of keys) {
      await page.locator('[role=tab][aria-selected=true]').focus();
      await page.keyboard.press('Tab');
      for (let i = 0; i < keys.indexOf(key); i++) await page.keyboard.press('Tab');
      await expect(page.locator(`[data-skip-to=${key}]`)).toBeFocused();
      await page.keyboard.press('Enter');
      const heading = page.locator(`#mm-${key}-h`);
      await expect(heading, key).toBeFocused();
      expect(
        await heading.evaluate((e) => getComputedStyle(e).outlineStyle !== 'none'),
        `${key}: a visible focus ring`,
      ).toBe(true);
      await expect(page).toHaveURL(/\/my-matters/);
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        (k) => !!document.activeElement?.closest(`[data-panel=${k}]`),
        key,
      );
      // A panel that has rows continues with them; one with nothing to focus hands the focus on, never back to the top.
      if (key === 'attention' || key === 'health')
        expect(inside, `${key}: Tab continues`).toBe(true);
    }
    // axe counts a control under the sticky header as obscured; the focus walk leaves the page scrolled, so look from the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await axeViolations(page)).toEqual([]);
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
