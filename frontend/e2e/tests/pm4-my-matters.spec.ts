import { Page } from '@playwright/test';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { atEverySize, shot } from '../support/screens';
import { Seeder } from '../support/seed';
import { axeAvailable } from '../support/axe';

/**
 * My Matters (epic #667, WP-PM4): the page shell and its filters (#692), Needs my attention and Next 7 days (#693, #896), the matters list
 * with the "+ New task" of its row menu (#695, reworked in epic #893 issue #908), the activity events (#697; they moved to the Activity tab in
 * issue #909; Workload and capacity, #696, was removed for Project Managers, #826). Each test builds the matters and tasks it needs in a
 * world of its own, so the numbers on the page are written down here instead of read back from the page.
 */
const total = async (page: Page): Promise<number> => {
  const text = await page.locator('[data-range]').first().innerText();
  const m = /of (\d+)/.exec(text);
  return m ? Number(m[1]) : -1;
};

const cell = (page: Page, key: string) => page.locator(`[data-strip-item="${key}"]`);
/** A chip's number: its accessible name starts with the count ("9 overdue"). */
const cellCount = async (page: Page, key: string): Promise<number> =>
  Number(((await cell(page, key).getAttribute('aria-label')) ?? '').split(' ')[0]);

test.describe('My Matters: shell, filters and the count strip', () => {
  test('every strip cell opens a list whose total equals the cell, and the numbers are the world written down', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'strip');
    const a = await w.matter('Alpha');
    const b = await w.matter('Bravo', w.pm, w.other);
    await w.matter('Not mine', w.other, null);
    await w.matter('No manager', null, null);
    await w.task(a, { dueDate: '2000-01-01' }); // overdue
    await w.task(a, { dueDate: inDays(2) }); // due in 3 days
    await w.task(b, { dueDate: inDays(6) }); // due in 7 days, not in 3
    await w.task(b); // ASAP, unassigned
    await w.task(b, { assignedUserId: w.other.userId, dueDate: inDays(40) });
    const hold = await w.task(b, { assignedUserId: w.other.userId, dueDate: inDays(40) });
    await seed.admin.post(`/api/v1/tasks/${hold.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting',
      rowVersion: hold.rowVersion,
    });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.getByRole('heading', { name: 'My Matters', level: 1 })).toBeVisible();
    await expect.poll(() => cellCount(page, 'open')).toBe(6);
    expect(await cellCount(page, 'overdue')).toBe(1);
    expect(await cellCount(page, 'due7')).toBe(2);
    expect(await cellCount(page, 'unassigned')).toBe(4);
    expect(await cellCount(page, 'onHold')).toBe(1);
    // "Matters I manage" and "Due in 3 days" are gone from the strip; the open count says how many matters it is on.
    await expect(page.locator('[data-strip-item="matters"], [data-strip-item="due3"]')).toHaveCount(
      0,
    );
    await expect(page.locator('button[data-strip-item=open]')).toContainText(/\b6\s+Open/);
    // The name carries the count and, for On hold, the oldest hold after it (#821).
    await expect(cell(page, 'onHold')).toHaveAttribute('aria-label', '1 on hold, oldest 0 days');
    await expect(cell(page, 'onHold')).toHaveText(/^\s*1\s+On hold\s*$/);

    const label = await page.locator('[data-mm-strip]').getAttribute('aria-label');
    expect(label).toContain('your matters');
    await shot(page, 'my-matters-strip');

    for (const key of ['open', 'overdue', 'due7', 'unassigned', 'onHold']) {
      await page.goto('/my-matters');
      await expect.poll(() => cellCount(page, key)).not.toBeNaN();
      const n = await cellCount(page, key);
      await cell(page, key).click();
      await expect(page).toHaveURL(/\/tasks\?/);
      await expect.poll(() => total(page), { message: `list total for ${key}` }).toBe(n);
    }
    // The Matters list is one link in the matters list of the page.
    await page.goto('/my-matters');
    await page.locator('[data-all-matters]').click();
    await expect(page).toHaveURL(/\/matters\?/);
    await expect.poll(() => total(page), { message: 'list total for the matters' }).toBe(2);
  });

  test('Role, Client and Dates are in the address, change every panel and survive Back', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'filters');
    const asPrimary = await w.matter('As primary');
    const asSecondary = await w.matter('As secondary', w.other, w.pm);
    await w.task(asPrimary, { dueDate: inDays(30) });
    await w.task(asSecondary, { dueDate: inDays(30) });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect.poll(() => cellCount(page, 'open')).toBe(2);
    await expect(page.locator('[data-health-row]')).toHaveCount(2);
    await page.locator('[data-filter=role]').selectOption('primary');
    await expect(page).toHaveURL(/role=primary/);
    await expect.poll(() => cellCount(page, 'open')).toBe(1);
    // One matter is left: there is nothing to compare, so the matters list is not drawn.
    await expect(page.locator('[data-panel=health]')).toHaveCount(0);
    await expect(page.locator('[data-mm-strip]')).toHaveAttribute(
      'aria-label',
      /primary manager only/,
    );
    await page.locator('[data-filter=role]').selectOption('secondary');
    await expect(page).toHaveURL(/role=secondary/);
    await expect.poll(() => cellCount(page, 'open')).toBe(1);
    // The Dates control belongs to the Deadlines tab (PV-08).
    await page.locator('[data-tab=deadlines]').click();
    await page.locator('[data-filter=range]').selectOption('2w');
    await expect(page).toHaveURL(/range=2w/);
    await page.locator('[data-filter=range]').selectOption('custom');
    await expect(page.locator('[data-filter=from]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-filter=range]')).toHaveValue('2w');
    await expect(page.locator('[data-filter=role]')).toHaveValue('secondary');
    await page.goBack();
    await expect(page.locator('[data-filter=range]')).toHaveValue('4w');
    await expect(page.locator('[data-filter=role]')).toHaveValue('secondary');
    await page.goBack(); // the Deadlines tab was chosen after this: back to Overview
    await page.goBack();
    await expect(page.locator('[data-filter=role]')).toHaveValue('primary');
    await expect.poll(() => cellCount(page, 'open')).toBe(1);
    // Clear filters
    await page.locator('[data-clear-filters]').first().click();
    await expect(page).toHaveURL(/\/my-matters$/);
    await expect.poll(() => cellCount(page, 'open')).toBe(2);
    // the client filter by the address
    await page.goto(`/my-matters?clientId=${w.world.client.clientId}`);
    await expect.poll(() => cellCount(page, 'open')).toBe(2);
    await expect(page.locator('#mm-client')).toHaveValue(new RegExp(w.world.client.name));
    await page.goto('/my-matters?clientId=99999999');
    await expect(page.locator('[data-mm-strip]')).toHaveCount(0); // nothing counted: no strip of zeros (#920)
    await expect(page.locator('[data-panel=health] [data-empty-kind=filtered]')).toContainText(
      'No matters match these filters.',
    );
  });

  test('a manager with no matters sees a positive empty state and no scolding', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'empty');
    // A manager without Matter.AssignManagers (the starter role has it): the way out is to ask a director.
    const plain = await personas.create({
      label: 'empty-plain',
      permissions: ['Client.View', 'Matter.View', 'Matter.BeManager', 'Task.View', 'Task.Create'],
    });
    void w;
    const page = await asUser(plain.username);
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=health] [data-no-matters]')).toContainText(
      'You are not the project manager of any matter yet.',
    );
    await expect(page.locator('[data-panel=health]')).toContainText(
      'Ask a director to assign you.',
    );
    // Nothing else is drawn: no strip of zeros, no empty cards (#920).
    await expect(page.locator('[data-mm-strip]')).toHaveCount(0);
    await expect(page.locator('[data-panel=attention]')).toBeHidden();
    await page.locator('[data-to-my-work]').click();
    await expect(page).toHaveURL(/\/my-work/);
  });

  test('panels fail and load on their own: one panel failing leaves the page and the others working', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'fail');
    const m = await w.matter('Alpha');
    await w.matter('Beta');
    await w.task(m, { dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    await page.route('**/api/v1/my-matters/attention**', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=attention] [data-panel-error]')).toContainText(
      "Couldn't load needs my attention.",
    );
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(2);
    await expect(page.locator('[data-mm-strip]')).toBeVisible();
    await page.unroute('**/api/v1/my-matters/attention**');
    await page.locator('[data-panel=attention] [data-panel-retry]').click();
    await expect(
      page.locator('[data-panel=attention] [data-attention-item]').first(),
    ).toBeVisible();
  });
});

test.describe('My Matters: Needs my attention and Next 7 days', () => {
  test('one ranked list, rows that open the task and Back, one View all with its total, and no item about a matter nobody manages', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'attn');
    const mine = await w.matter('Mine');
    const nobody = await w.matter('Nobody', null, null);
    const od = await w.task(mine, { dueDate: '2000-01-01', title: 'Late filing' });
    await w.task(mine, { dueDate: inDays(1), title: 'Soon filing' });
    await w.task(mine, { title: 'Nobody holds this' });
    await w.task(nobody, { dueDate: '2000-01-01', title: 'On a matter without manager' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const attention = page.locator('[data-panel=attention]');
    // The overdue task is also unassigned: it is listed once, as overdue (no tags, no "also listed" notes). The unassigned task with a date is next.
    // The unassigned task with no date is not attention yet.
    await expect(attention.locator('[data-attention-item]')).toHaveCount(2);
    await expect(attention.locator('[data-attention-item]').first()).toHaveAttribute(
      'data-reason',
      'overdue',
    );
    await expect(attention.locator('[data-attention-item]').nth(1)).toHaveAttribute(
      'data-reason',
      'unassigned',
    );
    await expect(attention.locator('[data-fact]').first()).toContainText('overdue');
    // An unassigned task's reason is the assignee column ("Unassigned"); its time text is the day it is due (issue #901).
    await expect(
      attention.locator('[data-attention-item]').nth(1).locator('[data-row-who]'),
    ).toHaveText('Unassigned');
    await expect(attention.locator('[data-fact]').nth(1)).toHaveText(/^due |^ASAP$/);
    await expect(attention.locator('[data-group], [data-also-tag], [data-repeated]')).toHaveCount(
      0,
    );
    await expect(attention).not.toContainText('Nobody holds this');
    await expect(attention).not.toContainText('On a matter without manager');
    await expect(attention).not.toContainText(nobody.name);
    // The row opens the task; Back returns to the page with its filters.
    await page.goto('/my-matters?role=primary');
    await attention
      .locator('[data-attention-item][data-reason=overdue] [data-attention-row]')
      .click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${od.taskId}\\?from=my-matters`));
    await expect(page.getByRole('link', { name: /My Matters/ }).first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/my-matters\?role=primary/);
    // One View all, with the total of the list it opens.
    await expect(attention.locator('[data-view-all]')).toHaveText('View all 2');
    await attention.locator('[data-view-all]').click();
    await expect(page).toHaveURL(/needsAttention=true/);
    await expect.poll(() => total(page)).toBe(2);
  });

  test('Next 7 days lists what falls due within a week with its day first, no range control, and All deadlines opens the Deadlines tab, which owns the range', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'dead');
    const m = await w.matter('Alpha');
    // Assigned: an unassigned task due within a week is listed in Needs my attention and, being listed once, not here.
    const mine = { assignedUserId: w.other.userId };
    await w.task(m, { dueDate: inDays(3), title: 'Within a week', ...mine });
    await w.task(m, { dueDate: inDays(3), title: 'Same day', ...mine });
    await w.task(m, { dueDate: inDays(20), title: 'Within four weeks', ...mine });
    await w.task(m, { dueDate: '2000-01-01', title: 'Long overdue' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const panel = page.locator('[data-panel=deadlines]');
    await expect(panel.locator('h2')).toHaveText('Next 7 days');
    await expect(panel.locator('[data-deadline-row]')).toHaveCount(2);
    await expect(panel.locator('[data-row-who]')).toHaveCount(2);
    await expect(panel).not.toContainText('Long overdue');
    await expect(panel).not.toContainText('Within four weeks');
    // The list has no toolbar: no 2 / 4 week buttons, no Views, no Sort, no Task types, no Options.
    await expect(panel.locator('[data-range], select, details, button')).toHaveCount(0);
    await panel.locator('[data-view-all]').click();
    await expect(page).toHaveURL(/tab=deadlines/);
    // The Deadlines tab owns the range: its window holds the task due in 20 days as well.
    await expect(page.locator('[data-panel=deadlines-tab] [data-deadline-row]')).toHaveCount(3);
    // "Today" is a due-date range of one day: nothing is due today here, and the empty text is positive.
    await page.locator('[data-filter=range]').selectOption('today');
    await expect(page.locator('[data-panel=deadlines-tab] [data-empty]')).toContainText(
      'No deadlines in this period.',
    );
  });

  test('a stuck hold shows with its age and the group links to the held tasks', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container of run-local.sh');
    const w = await mmWorld(seed, personas, 'hold');
    const m = await w.matter('Alpha');
    const held = await w.task(m, { title: 'Waiting on client' });
    await seed.admin.post(`/api/v1/tasks/${held.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting',
      rowVersion: held.rowVersion,
    });
    seed.sql(
      `UPDATE dbo.Task SET StatusChangedAt = DATEADD(DAY, -10, SYSUTCDATETIME()) WHERE TaskId = ${Number(held.taskId)}`,
    );
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const row = page.locator('[data-panel=attention] [data-attention-item][data-reason=onHold]');
    await expect(row.locator('[data-fact]')).toHaveText('on hold 10 d');
    await expect(row).toContainText('Waiting on client');
    await expect(cell(page, 'onHold')).toHaveAttribute('aria-label', '1 on hold, oldest 10 days');
    // The one View all counts it, and opens the Task Queue with the same tasks.
    await page.locator('[data-panel=attention] [data-view-all]').click();
    await expect(page).toHaveURL(/needsAttention=true/);
    await expect.poll(() => total(page)).toBe(1);
  });
});

test.describe('My Matters: the matters list', () => {
  test('rows with counts, the worst first, no flag words, the matter link, and the rule behind the info button', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'health');
    const red = await w.matter('Reddish');
    const amber = await w.matter('Amberish');
    const green = await w.matter('Greenish');
    await w.matter('Quiet');
    await w.task(red, { dueDate: '2000-01-01' });
    await w.task(amber, { dueDate: inDays(30), assignedUserId: w.other.userId });
    await w.task(amber, { dueDate: inDays(30) }); // unassigned
    await w.task(green, { dueDate: inDays(30), assignedUserId: w.other.userId });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const row = (name: string) => page.locator('[data-health-row]', { hasText: name });
    await expect(page.locator('[data-health-row]')).toHaveCount(4);
    // Worst first: the overdue matter, then the one with an unassigned task, then the one with a deadline, then the one with none.
    await expect(page.locator('[data-health-row] [data-matter-link]')).toHaveText([
      new RegExp('Reddish'),
      new RegExp('Amberish'),
      new RegExp('Greenish'),
      new RegExp('Quiet'),
    ]);
    await expect(row('Reddish').locator('[data-overdue]')).toHaveText('1 overdue');
    await expect(row('Greenish').locator('[data-overdue]')).toHaveText('0 overdue');
    await expect(row('Amberish').locator('[data-unassigned]')).toHaveText('1 unassigned');
    await expect(row('Reddish').locator('[data-at-risk]')).toHaveCount(0);
    await expect(row('Greenish').locator('[data-unassigned], [data-at-risk]')).toHaveCount(0);
    // No Red / Amber / Green word anywhere in the list, no table, no sort controls.
    await expect(page.locator('[data-panel=health]')).not.toContainText(/\b(Red|Amber|Green)\b/);
    await expect(page.locator('[data-panel=health] [data-sort], [data-health-table]')).toHaveCount(
      0,
    );
    // The rule is stated once, behind the info button.
    await expect(page.locator('[data-rule]')).toHaveCount(0);
    await page.locator('[data-how]').click();
    await expect(page.locator('[data-rule]')).toContainText('Worst first');
    await expect(page.locator('[data-rule]')).toContainText('never changes the order');
    // The matter cell is the link.
    await row('Reddish').locator('[data-matter-link]').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${red.matterId}`));
    await page.goBack();
    await expect(page).toHaveURL(/\/my-matters$/);
    await expect(page.locator('[data-health-row]')).toHaveCount(4);
  });

  test('a matter nobody manages is never flagged, listed or counted on the page of someone who manages others', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'nomgr');
    const mine = await w.matter('Mine alone');
    const orphan = await w.matter('Orphaned', null, null);
    await w.task(mine, { dueDate: inDays(30), assignedUserId: w.other.userId });
    await w.task(orphan, { dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=health]')).toHaveCount(0); // one matter: no list
    await expect(page.locator('main')).not.toContainText('Orphaned');
    // Nothing is overdue: the Overdue tile stays, muted and not red (issue #927).
    await expect(cell(page, 'overdue')).toHaveClass(/tile--zero/);
    await expect(cell(page, 'overdue')).not.toHaveClass(/tile--danger/);
    await expect(page.locator('main')).not.toContainText(
      /no (project )?manager|unmanaged|not managed/i,
    );
  });

  for (const size of [
    { width: 1366, height: 768 },
    { width: 375, height: 812 },
  ]) {
    test(`+ New task in the row menu opens Create task with the matter and creating the task returns to My Matters (${size.width})`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const w = await mmWorld(seed, personas, 'newtask');
      const m = await w.matter('Target');
      await w.matter('Other');
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      await page.goto('/my-matters?role=primary');
      const menu = page
        .locator('[data-health-row]', { hasText: m.matterRef })
        .locator('[data-row-actions] button');
      await menu.scrollIntoViewIfNeeded();
      if (size.width < 640) {
        const box = await menu.boundingBox();
        expect(box!.height, 'touch target').toBeGreaterThanOrEqual(43.5);
      }
      await menu.click();
      await page.getByRole('menuitem', { name: '+ New task' }).click();
      await expect(page).toHaveURL(new RegExp(`/tasks/new\\?matterId=${m.matterId}`));
      await expect(page.getByRole('heading', { name: 'Create task', level: 1 })).toBeVisible();
      // Task type first, then the form; the matter is already chosen.
      await page.getByRole('radio', { name: new RegExp(w.world.taskType.name) }).click();
      await expect(page.locator('[data-chosen]').first()).toContainText(m.matterRef);
      const title = `From My Matters ${size.width}`;
      await page.getByRole('textbox', { name: 'Title (required)' }).fill(title);
      await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Rita Requestor');
      await page.getByRole('button', { name: 'Create task', exact: true }).click();
      await expect(page).toHaveURL(/\/my-matters\?role=primary$/);
      const made = await seed.admin.get<{
        items: { title: string; matterId: number }[];
      }>(`/api/v1/tasks?matterId=${m.matterId}&q=${encodeURIComponent(title)}`);
      expect(made.items.map((t) => t.matterId)).toEqual([m.matterId]);
      await expect(page.locator('[data-health-row], [data-record-card]').first()).toBeVisible();
    });
  }

  test('Cancel on Create task returns to My Matters too', async ({ seed, personas, asUser }) => {
    const w = await mmWorld(seed, personas, 'cancel');
    const m = await w.matter('Target');
    await w.matter('Other');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await page
      .locator('[data-health-row]', { hasText: m.matterRef })
      .locator('[data-row-actions] button')
      .click();
    await page.getByRole('menuitem', { name: '+ New task' }).click();
    await page.getByRole('radio', { name: new RegExp(w.world.taskType.name) }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/my-matters$/);
  });

  test('a returnTo that is not My Matters is ignored (no open redirect)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'redirect');
    const page = await asUser(w.pm.username);
    for (const bad of [
      'https://example.org/',
      '//example.org/my-matters',
      '/my-matters/../admin',
      '/tasks',
    ]) {
      await page.goto(`/tasks/new?returnTo=${encodeURIComponent(bad)}`);
      await page.getByRole('radio', { name: new RegExp(w.world.taskType.name) }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      // The Task Queue names the project manager's scope in its address (epic #758).
      await expect(page, bad).toHaveURL(/\/tasks(\?scope=mine)?$/);
    }
  });
});

test.describe('My Matters: the events of the Activity tab (they left the Overview in #909)', () => {
  test('first visit marks nothing new; a change by someone else is new until Mark all as read, which survives a reload', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'act');
    const m = await w.matter('Alpha');
    await w.task(m, { title: 'Before the first visit' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=activity');
    const panel = page.locator('[data-panel=activity-tab]');
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await expect(panel.locator('[data-new-word]')).toHaveCount(0);
    await expect(panel.locator('[data-mark-all-read]')).toHaveCount(0);
    // Somebody else creates a task and changes a status: both are new; the viewer's own action is never.
    const fresh = await w.task(m, { title: 'Created by the admin' });
    await seed.admin.post(`/api/v1/tasks/${fresh.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting for the client',
      rowVersion: fresh.rowVersion,
    });
    await page.reload();
    await expect(panel.locator('[data-new-word]')).toHaveCount(2);
    await expect(panel.locator('[data-activity-row][data-unread=true]').first()).toContainText(
      'New',
    );
    await expect(panel).toContainText('moved "Created by the admin" to On Hold');
    await expect(panel).toContainText('created "Created by the admin"');
    await expect(panel).not.toContainText('Waiting for the client'); // the status note is never shown
    // Looking at the tab does not move the marker.
    await page.reload();
    await expect(panel.locator('[data-new-word]')).toHaveCount(2);
    await panel.locator('[data-mark-all-read]').click();
    await expect(panel.locator('[data-new-word]')).toHaveCount(0);
    await expect(panel.locator('[data-activity-announce]')).toHaveText(
      'All activity marked as read.',
    );
    await page.reload();
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await expect(panel.locator('[data-new-word]')).toHaveCount(0);
  });

  test('opening an event opens the task and marks it read; comments show only "commented on"', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'actopen');
    const m = await w.matter('Alpha');
    const t = await w.task(m, { title: 'Commented task' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters?tab=activity');
    // The first visit creates the marker: wait until the tab has it before somebody else comments.
    const panel = page.locator('[data-panel=activity-tab]');
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await seed.admin.post(`/api/v1/tasks/${t.taskId}/comments`, {
      bodyHtml: '<p>Privileged secret words</p>',
    });
    await page.reload();
    await expect(panel).not.toContainText('Privileged secret words');
    const unread = panel
      .locator('[data-activity-row][data-unread=true] [data-activity-link]')
      .first();
    await expect(unread).toBeVisible();
    await unread.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${t.taskId}`));
    await page.goBack();
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await expect(panel.locator('[data-new-word]')).toHaveCount(0);
  });
});

test.describe('My Matters: layout and accessibility', () => {
  test('no sideways scroll and axe finds nothing at four sizes (page with data)', async ({
    seed,
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const w = await mmWorld(seed, personas, 'axe');
    const m = await w.matter('Alpha');
    await w.matter('Bravo', w.pm, w.other);
    await w.task(m, { dueDate: '2000-01-01' });
    await w.task(m, { dueDate: inDays(3) });
    await w.task(m);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await atEverySize(page, 'my-matters', async () => {
      await expect(page.locator('[data-health-row], [data-record-card]').first()).toBeVisible();
    });
  });
});
