import { Page } from '@playwright/test';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { atEverySize, shot } from '../support/screens';
import { Seeder } from '../support/seed';
import { axeAvailable } from '../support/axe';

/**
 * My Matters (epic #667, WP-PM4): the page shell and its filters (#692), Needs my attention and Upcoming deadlines (#693), the matter health
 * table with "+ New task" (#695), Recent activity (#697; Workload and capacity, #696, was removed for Project Managers, #826). Each test builds the matters and tasks it needs in a
 * world of its own, so the numbers on the page are written down here instead of read back from the page.
 */
const total = async (page: Page): Promise<number> => {
  const text = await page.locator('[data-range]').first().innerText();
  const m = /of (\d+)/.exec(text);
  return m ? Number(m[1]) : -1;
};

const cell = (page: Page, key: string) => page.locator(`[data-strip-item="${key}"]`);
const cellCount = async (page: Page, key: string): Promise<number> =>
  Number((await cell(page, key).locator('strong').innerText()).trim());

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
    await expect(cell(page, 'matters').locator('strong')).toHaveText('2');
    await expect(cell(page, 'open').locator('strong')).toHaveText('6');
    await expect(cell(page, 'overdue').locator('strong')).toHaveText('1');
    await expect(cell(page, 'due3').locator('strong')).toHaveText('1');
    await expect(cell(page, 'due7').locator('strong')).toHaveText('2');
    await expect(cell(page, 'unassigned').locator('strong')).toHaveText('4');
    await expect(cell(page, 'onHold').locator('strong')).toHaveText('1');
    // The label names what it counts and never carries the age before the count (#821); the age is the tooltip.
    await expect(cell(page, 'onHold')).toHaveText(/^\s*On hold\s+1\s*$/);
    await expect(cell(page, 'onHold')).toHaveAttribute('title', 'oldest 0 days');

    const label = await page.locator('[data-strip]').getAttribute('aria-label');
    expect(label).toContain('your matters');
    await shot(page, 'my-matters-strip');

    for (const key of ['open', 'overdue', 'due3', 'due7', 'unassigned', 'onHold', 'matters']) {
      await page.goto('/my-matters');
      await expect(cell(page, key).locator('strong')).not.toHaveText('--');
      const n = await cellCount(page, key);
      await cell(page, key).click();
      await expect(page).toHaveURL(key === 'matters' ? /\/matters\?/ : /\/tasks\?/);
      await expect.poll(() => total(page), { message: `list total for ${key}` }).toBe(n);
    }
  });

  test('Role, Client and Dates are in the address, change every panel and survive Back', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'filters');
    await w.matter('As primary');
    await w.matter('As secondary', w.other, w.pm);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(cell(page, 'matters').locator('strong')).toHaveText('2');
    await page.locator('[data-filter=role]').selectOption('primary');
    await expect(page).toHaveURL(/role=primary/);
    await expect(cell(page, 'matters').locator('strong')).toHaveText('1');
    await expect(page.locator('[data-health-row]')).toHaveCount(1);
    await expect(page.locator('[data-strip]')).toHaveAttribute(
      'aria-label',
      /primary manager only/,
    );
    await page.locator('[data-filter=role]').selectOption('secondary');
    await expect(page.locator('[data-health-row]')).toContainText('As secondary');
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
    await page.goBack();
    await expect(page.locator('[data-filter=role]')).toHaveValue('primary');
    await expect(cell(page, 'matters').locator('strong')).toHaveText('1');
    // Clear filters
    await page.locator('[data-clear-filters]').first().click();
    await expect(page).toHaveURL(/\/my-matters$/);
    await expect(cell(page, 'matters').locator('strong')).toHaveText('2');
    // the client filter by the address
    await page.goto(`/my-matters?clientId=${w.world.client.clientId}`);
    await expect(cell(page, 'matters').locator('strong')).toHaveText('2');
    await expect(page.locator('[data-chosen]')).toContainText(w.world.client.name);
    await page.goto('/my-matters?clientId=99999999');
    await expect(cell(page, 'matters').locator('strong')).toHaveText('0');
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
    await expect(page.locator('[data-panel=attention] [data-empty]')).toContainText(
      'Nothing needs your attention.',
    );
    await expect(cell(page, 'matters').locator('strong')).toHaveText('0');
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
    await w.task(m, { dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    await page.route('**/api/v1/my-matters/activity**', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=activity] [data-panel-error]')).toContainText(
      "Couldn't load recent activity.",
    );
    await expect(page.locator('[data-panel=health] [data-health-row]')).toHaveCount(1);
    await expect(
      page.locator('[data-panel=attention] [data-group=overdue] [data-attention-row]'),
    ).toHaveCount(1);
    await page.unroute('**/api/v1/my-matters/activity**');
    await page.locator('[data-panel=activity] [data-panel-retry]').click();
    await expect(page.locator('[data-panel=activity] [data-activity-row]').first()).toBeVisible();
  });
});

test.describe('My Matters: Needs my attention and Upcoming deadlines', () => {
  test('groups, rows that open the task and Back, View all totals, and no item about a matter nobody manages', async ({
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
    await expect(attention.locator('[data-group=overdue] [data-attention-row]')).toHaveCount(1);
    await expect(attention.locator('[data-group=dueSoon] [data-attention-row]')).toHaveCount(1);
    await expect(attention.locator('[data-group=unassigned] [data-attention-row]')).toHaveCount(3);
    await expect(attention.locator('[data-group=overdue] [data-fact]')).toContainText('overdue');
    await expect(attention).not.toContainText('On a matter without manager');
    await expect(attention).not.toContainText(nobody.name);
    // The row opens the task; Back returns to the page with its filters.
    await page.goto('/my-matters?role=primary');
    await attention.locator('[data-group=overdue] [data-attention-row]').click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${od.taskId}\\?from=my-matters`));
    await expect(page.getByRole('link', { name: /My Matters/ }).first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/my-matters\?role=primary/);
    // View all opens the Task Queue with the group's total.
    await attention.locator('[data-group=unassigned] [data-view-all]').click();
    await expect.poll(() => total(page)).toBe(3);
  });

  test('Upcoming deadlines are grouped by day, the 2 / 4 week toggle changes the window and overdue work is not in it', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'dead');
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: inDays(3), title: 'Within two weeks' });
    await w.task(m, { dueDate: inDays(3), title: 'Same day' });
    await w.task(m, { dueDate: inDays(20), title: 'Within four weeks' });
    await w.task(m, { dueDate: '2000-01-01', title: 'Long overdue' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const panel = page.locator('[data-panel=deadlines]');
    await expect(panel.locator('[data-deadline-row]')).toHaveCount(3);
    await expect(panel.locator('[data-day]')).toHaveCount(2);
    await expect(panel).not.toContainText('Long overdue');
    await panel.locator('[data-range="2w"]').click();
    await expect(page).toHaveURL(/range=2w/);
    await expect(panel.locator('[data-deadline-row]')).toHaveCount(2);
    await expect(panel.locator('[data-range="2w"]')).toHaveAttribute('aria-pressed', 'true');
    await panel.locator('[data-view-all]').click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect.poll(() => total(page)).toBe(2);
    await page.goBack();
    await expect(page.locator('[data-panel=deadlines] [data-range="2w"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // "Today" is a due-date range of one day: nothing is due today here, and the empty text is positive.
    await page.locator('[data-filter=range]').selectOption('today');
    await expect(page.locator('[data-panel=deadlines] [data-empty]')).toContainText(
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
    const group = page.locator('[data-panel=attention] [data-group=stuckOnHold]');
    await expect(group.locator('[data-fact]')).toContainText('on hold 10 d');
    await expect(group).toContainText('On hold more than 7 days');
    await expect(cell(page, 'onHold')).toHaveAttribute('title', 'oldest 10 days');
  });
});

test.describe('My Matters: Matter health', () => {
  test('rows, flag text, sort with aria-sort, the matter link, and the rule is spelled out', async ({
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
    await expect(row('Reddish').locator('[data-flag]')).toHaveText('Red');
    await expect(row('Amberish').locator('[data-flag]')).toHaveText('Amber');
    await expect(row('Greenish').locator('[data-flag]')).toHaveText('Green');
    await expect(row('Quiet').locator('[data-flag]')).toHaveText('Green');
    await expect(row('Quiet').locator('[data-flag-cell]')).toHaveAttribute(
      'title',
      /no open tasks/,
    );
    await expect(row('Reddish').locator('[data-flag-cell]')).toHaveAttribute(
      'title',
      /a task is overdue/,
    );
    await expect(row('Amberish').locator('[data-flag-cell]')).toHaveAttribute(
      'title',
      /nobody assigned/,
    );
    await expect(row('Amberish')).toContainText('0%');
    // The default is the next deadline, soonest first, and not the flag: Red does not come first because it is red.
    await expect(page.locator('th[aria-sort=ascending] [data-sort=nextDeadline]')).toBeVisible();
    // The viewer sorts: Open ascending then descending; the order and aria-sort follow, the address keeps it.
    await page.locator('[data-panel=health] [data-sort=open]').click();
    await expect(page).toHaveURL(/sort=open/);
    await expect(
      page.locator('[data-panel=health] th[aria-sort=ascending] [data-sort=open]'),
    ).toBeVisible();
    await page.locator('[data-panel=health] [data-sort=open]').click();
    await expect(page).toHaveURL(/dir=desc/);
    await expect(
      page.locator('[data-panel=health] th[aria-sort=descending] [data-sort=open]'),
    ).toBeVisible();
    await expect(page.locator('[data-health-row]').first()).toContainText('Amberish');
    // How is this decided?
    await page.locator('[data-how]').click();
    await expect(page.locator('[data-rule]')).toContainText(
      'Red: at least one open task is overdue.',
    );
    await expect(page.locator('[data-rule]')).toContainText('never changes the flag');
    // The matter cell is the link.
    await row('Reddish').locator('[data-matter-link]').click();
    await expect(page).toHaveURL(new RegExp(`/matters/${red.matterId}`));
    await page.goBack();
    await expect(page).toHaveURL(/\/my-matters\?sort=open&dir=desc/);
    await expect(
      page.locator('[data-panel=health] th[aria-sort=descending] [data-sort=open]'),
    ).toBeVisible();
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
    await expect(page.locator('[data-health-row]')).toHaveCount(1);
    await expect(page.locator('main')).not.toContainText('Orphaned');
    await expect(cell(page, 'overdue').locator('strong')).toHaveText('0');
    await expect(page.locator('main')).not.toContainText(
      /no (project )?manager|unmanaged|not managed/i,
    );
  });

  for (const size of [
    { width: 1366, height: 768 },
    { width: 375, height: 812 },
  ]) {
    test(`+ New task opens Create task with the matter and creating the task returns to My Matters (${size.width})`, async ({
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
      const button = page.getByRole('button', { name: `New task for ${m.matterRef}`, exact: true });
      await button.scrollIntoViewIfNeeded();
      if (size.width < 640) {
        const box = await button.boundingBox();
        expect(box!.height, 'touch target').toBeGreaterThanOrEqual(44);
      }
      await button.click();
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
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await page.getByRole('button', { name: `New task for ${m.matterRef}`, exact: true }).click();
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

test.describe('My Matters: Recent activity', () => {
  test('first visit marks nothing unread; a change by someone else is unread until Mark all as read, which survives a reload', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'act');
    const m = await w.matter('Alpha');
    await w.task(m, { title: 'Before the first visit' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const panel = page.locator('[data-panel=activity]');
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await expect(panel.locator('[data-unread-word]')).toHaveCount(0);
    await expect(panel.locator('[data-mark-all-read]')).toHaveCount(0);
    // Somebody else creates a task and changes a status: both are unread; the viewer's own action is never.
    const fresh = await w.task(m, { title: 'Created by the admin' });
    await seed.admin.post(`/api/v1/tasks/${fresh.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Waiting for the client',
      rowVersion: fresh.rowVersion,
    });
    await page.reload();
    await expect(panel.locator('[data-unread-word]')).toHaveCount(2);
    await expect(panel.locator('[data-activity-row][data-unread=true]').first()).toContainText(
      'unread',
    );
    await expect(panel).toContainText('moved "Created by the admin" to On Hold');
    await expect(panel).toContainText('created "Created by the admin"');
    await expect(panel).not.toContainText('Waiting for the client'); // the status note is never shown
    // Looking at the panel does not move the marker.
    await page.reload();
    await expect(panel.locator('[data-unread-word]')).toHaveCount(2);
    await panel.locator('[data-mark-all-read]').click();
    await expect(panel.locator('[data-unread-word]')).toHaveCount(0);
    await expect(panel.locator('[data-activity-announce]')).toHaveText(
      'All activity marked as read.',
    );
    await page.reload();
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await expect(panel.locator('[data-unread-word]')).toHaveCount(0);
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
    await page.goto('/my-matters');
    // The first visit creates the marker: wait until the panel has it before somebody else comments.
    await expect(page.locator('[data-panel=activity] [data-activity-row]').first()).toBeVisible();
    await seed.admin.post(`/api/v1/tasks/${t.taskId}/comments`, {
      bodyHtml: '<p>Privileged secret words</p>',
    });
    await page.reload();
    const panel = page.locator('[data-panel=activity]');
    await expect(panel).not.toContainText('Privileged secret words');
    const unread = panel
      .locator('[data-activity-row][data-unread=true] [data-activity-link]')
      .first();
    await expect(unread).toBeVisible();
    await unread.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${t.taskId}`));
    await page.goBack();
    await expect(panel.locator('[data-activity-row]').first()).toBeVisible();
    await expect(panel.locator('[data-unread-word]')).toHaveCount(0);
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
      await expect(page.locator('[data-panel=activity] [data-activity-row]').first()).toBeVisible();
    });
  });
});
