import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * My Matters tabs (epic #758, WP-PX4: #776 to #781): Overview, Breakdown, Data and Activity (the Deadlines tab became the Calendar, #929, and the Trends tab was removed, #947). Every test
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
      /^\s*Breakdown\s*$/,
      /^\s*Data\s*$/,
      /^\s*Activity(\s+\d+)?\s*$/,
    ]);
    await expect(tab(page, 'overview')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-mm-tabpanel]')).toHaveAttribute(
      'aria-labelledby',
      'mm-tab-overview',
    );
    await expect(panel(page, 'tasks')).toBeVisible();

    await page.locator('[data-filter=role]').selectOption('primary');
    await tab(page, 'breakdown').click();
    await expect(page).toHaveURL(/tab=breakdown/);
    await expect(page).toHaveURL(/role=primary/);
    await expect(panel(page, 'breakdown')).toBeVisible();
    await expect(page.locator('[data-filter=role]')).toHaveValue('primary');
    await tab(page, 'activity').click();
    await expect(panel(page, 'activity-tab')).toBeVisible();
    await expect(page.locator('[data-filter=range]')).toHaveCount(0); // no Dates choice anywhere (#944)
    await expect(page.locator('[role=tab][data-tab=trends]')).toHaveCount(0); // the Trends tab is gone (#947)

    // Back returns to the earlier tab and puts focus on its tab.
    await page.goBack();
    await expect(tab(page, 'breakdown')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'breakdown')).toBeFocused();

    // Keyboard only, with the keys the app has: Right and Left move between tabs, Home goes to Overview.
    await tab(page, 'breakdown').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'data')).toHaveAttribute('aria-selected', 'true');
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
      await page.goto('/my-matters?tab=breakdown');
      await expect(page.locator('[role=tab]')).toHaveCount(0);
    }
    const page = await asUser(w.pm.username); // the Project Manager role holds Matter.AssignManagers
    await page.goto('/my-matters?scope=all&tab=breakdown');
    await expect(panel(page, 'breakdown')).toBeVisible();
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

test.describe('My Matters: Calendar (the Deadlines tab moved to the Overview, #929; one month, #944)', () => {
  test('the Deadlines tab address opens the Overview; the Calendar button shows one month with its tasks on their own dates, overdue ones marked, Previous and Next; a phone gets the list by day', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'dl');
    const a = await w.matter('Alpha');
    const b = await w.matter('Bravo');
    const near = inDays(3);
    await w.task(a, { dueDate: near, title: 'A near one' });
    await w.task(a, { dueDate: near, title: 'A near two' });
    await w.task(b, { dueDate: '2000-01-05', title: 'B overdue' }); // overdue work is on its own date, in its own month
    const page = await asUser(w.pm.username);

    // The old address opens the Overview (the address is replaced, so Back does not return to it).
    await page.goto('/my-matters?tab=deadlines');
    await expect(page.getByRole('tab', { selected: true })).toHaveText(/Overview/);
    await expect(page).not.toHaveURL(/tab=deadlines/);
    await expect(page.getByRole('tab', { name: 'Deadlines' })).toHaveCount(0);

    // The Calendar button swaps the grid for the calendar.
    await page.getByRole('button', { name: 'Show calendar' }).click();
    await expect(page).toHaveURL(/view=calendar/);
    const cal = panel(page, 'calendar');
    await expect(cal.locator('[data-calendar]')).toBeVisible();
    await expect(panel(page, 'tasks')).toHaveCount(0);
    // The month of the near tasks: both are on their date, a cell says "2 tasks due".
    await page.goto(`/my-matters?view=calendar&month=${near.slice(0, 7)}`);
    const cell = cal.locator(`td[data-day="${near}"]`);
    await expect(cell.locator('[data-deadline-row]')).toHaveCount(2);
    await expect(cell).toHaveAttribute('aria-label', /2 tasks due/);
    await expect(cell.locator('[data-overdue-icon]')).toHaveCount(0);
    // Past months show the overdue task on its own date, with the warning icon and the word Overdue for screen readers.
    await page.goto('/my-matters?view=calendar&month=2000-01');
    const late = cal.locator('td[data-day="2000-01-05"]');
    await expect(late.locator('[data-overdue-icon]')).toHaveCount(1);
    await expect(late.locator('.mf-sr-only')).toContainText('Overdue');
    await expect(late).toHaveAttribute('aria-label', /1 overdue/);
    // Previous and Next walk the months, and the title follows.
    await page.locator('[data-cal-next]').click();
    await expect(page).toHaveURL(/month=2000-02/);
    await expect(cal.locator('[data-cal-month]')).toHaveText('February 2000');
    await page.locator('[data-cal-prev]').click();
    await expect(cal.locator('[data-cal-month]')).toHaveText('January 2000');

    // A phone gets the same tasks as a list by day, not a calendar.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(cal.locator('[data-calendar]')).toHaveCount(0);
    await expect(cal.locator('[data-list-day]')).toHaveCount(1);
    await expect(cal.locator('[data-deadline-row]')).toHaveCount(1);
    await expect(cal.locator('[data-overdue-icon]')).toHaveCount(1);

    // "Show list" brings the grid back.
    await page.getByRole('button', { name: 'Show list' }).click();
    await expect(panel(page, 'tasks')).toBeVisible();
    await expect(panel(page, 'calendar')).toHaveCount(0);
  });
});

test.describe('My Matters: Activity (a grid, issue #946)', () => {
  test('New in words, a grid of When / Who / What / Task / Matter, filters behind Options, mark all as read, comment text never shown', async ({
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
    await expect(act.locator('[data-activity-announce]')).toHaveText(
      /4 new events since your last visit/,
    );
    await expect(page.locator('main')).not.toContainText('SECRET PRIVILEGED WORDS');

    // The table: five columns (Matter because there are two matters), the newest first, the comment is only "Commented".
    await expect(act.getByRole('columnheader')).toHaveText([
      'When',
      'Who',
      'What',
      'Task',
      'Matter',
    ]);
    await expect(act.locator('[data-sort-when]')).toHaveAttribute('aria-sort', 'descending');
    const first = act.locator('[data-activity-row]').first();
    await expect(first.locator('[data-col=what]')).toHaveText('Commented');
    await expect(first.locator('[data-col=task]')).toContainText('Fresh alpha one');
    await expect(first.locator('[data-matter-link]')).toBeVisible();
    // The sort button: oldest first, and back.
    await act.locator('[data-sort-when] button').click();
    await expect(page).toHaveURL(/asort=when/);
    await expect(act.locator('[data-sort-when]')).toHaveAttribute('aria-sort', 'ascending');
    await expect(
      act.locator('[data-activity-row]').first().locator('[data-col=what]'),
    ).not.toHaveText('Commented');
    await act.locator('[data-sort-when] button').click();
    await expect(act.locator('[data-sort-when]')).toHaveAttribute('aria-sort', 'descending');

    // Filters live behind Options (the number on the button says how many are in force), in the address.
    await expect(act.locator('[data-filter=kind]')).toBeHidden();
    await act.locator('[data-options-trigger]').click();
    await act.locator('[data-filter=kind]').selectOption('TASK_CREATED');
    await expect(page).toHaveURL(/kind=TASK_CREATED/);
    await expect(act.locator('[data-activity-row]')).toHaveCount(4);
    await expect(act.locator('[data-options-count]')).toHaveText('1');
    await act.locator('[data-filter=unread]').check();
    await expect(act.locator('[data-activity-row]')).toHaveCount(3);
    await act.locator('[data-filter=kind]').selectOption('');
    await act.locator('[data-filter=unread]').uncheck();
    await expect(act.locator('[data-activity-row]')).toHaveCount(7);

    // Mark all as read: no New left, the button is gone, focus goes to the list.
    await act.locator('[data-mark-all-read]').click();
    await expect(act.locator('[data-new-word]')).toHaveCount(0);
    await expect(act.locator('[data-mark-all-read]')).toHaveCount(0);
    await expect(act.locator('[data-activity-list]')).toBeFocused();
    await page.reload();
    await expect(act.locator('[data-new-word]')).toHaveCount(0);
  });

  test('25 events a page with the pager, newest first; one line a row, 44 px; one matter has no Matter column', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'page');
    const a = await w.matter('Alpha');
    for (let i = 1; i <= 32; i++) await w.task(a, { title: `Paged ${String(i).padStart(2, '0')}` });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=activity');
    const act = panel(page, 'activity-tab');
    await expect(act.locator('[data-activity-row]')).toHaveCount(25);
    await expect(act.locator('[data-activity-row]').first()).toContainText('Paged 32');
    await expect(act.getByRole('columnheader')).toHaveText(['When', 'Who', 'What', 'Task']);
    await expect(act.locator('[data-range]')).toHaveText('Showing 1-25 of 33');
    for (const row of await act.locator('[data-activity-row]').all()) {
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeLessThan(60); // one line
    }
    await act.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/apage=2/);
    await expect(act.locator('[data-activity-row]')).toHaveCount(8); // 32 tasks and the manager set with the matter
    await expect(act.locator('[data-activity-announce]')).toHaveText('Page 2 of 2.');
    await expect(act.getByRole('button', { name: 'Next' })).toBeDisabled();
    // Changing the sort starts again on the first page.
    await act.locator('[data-sort-when] button').click();
    await expect(page).not.toHaveURL(/apage=/);
    await expect(act.locator('[data-activity-row]')).toHaveCount(25);
  });
});

test.describe('My Matters: the first screen on a phone, and the skip links', () => {
  test('375x812: the Overview has no "what changed" line (a badge on the Activity tab), where it is one 44 px row, and the grid starts in the first screen (#818, #909)', async ({
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
    // The pre-filter dropdown is in the first screen, whole.
    const select = (await page.locator('select[data-prefilter]').boundingBox())!;
    expect(select.x + select.width).toBeLessThanOrEqual(375);
    expect(select.y + select.height).toBeLessThanOrEqual(812);
    // The grid starts in the first screen.
    const heading = (await panel(page, 'tasks').locator('h2.mmp__title').boundingBox())!;
    expect(heading.y + heading.height).toBeLessThanOrEqual(812);
    expect(await axeViolations(page), 'phone').toEqual([]);
    await noHorizontalScroll(page);
    // On the Activity tab the line is one row of 44 px targets that scrolls sideways.
    await tab(page, 'activity').click();
    const line = panel(page, 'since');
    await expect(line.locator('[data-since-figures]')).toBeVisible();
    expect((await line.boundingBox())!.height).toBeLessThanOrEqual(48);
    expect(await axeViolations(page), 'phone, activity').toEqual([]);
  });

  test('there are no skip links (one grid): after the tab strip the Tab order goes straight to the pre-filter, the Calendar button, Urgency and the rows', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'skip');
    const m = await w.matter('Alpha');
    await w.matter('Beta');
    await w.task(m, { dueDate: inDays(-2), title: 'Fell due' });
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    await expect(panel(page, 'tasks').locator('tr[data-task]').first()).toBeVisible();
    await expect(page.locator('[data-skip-links], [data-skip-to]')).toHaveCount(0);
    await page.locator('[role=tab][aria-selected=true]').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('select[data-prefilter]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-panel=tasks] [data-calendar-toggle]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-panel=tasks] [data-sort-urgency]')).toHaveCount(0); // one task: no Urgency control
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
        ['calendar', '/my-matters?view=calendar'],
        ['breakdown', '/my-matters?tab=breakdown'],
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
