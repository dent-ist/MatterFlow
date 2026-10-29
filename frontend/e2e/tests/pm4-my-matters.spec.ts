import { Page } from '@playwright/test';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { expect, test } from '../support/fixtures';
import { atEverySize, shot } from '../support/screens';
import { Seeder } from '../support/seed';
import { axeAvailable } from '../support/axe';

/**
 * My Matters (epic #667, WP-PM4): the page shell and its filters (#692), the one grid of open tasks with its pre-filter dropdown (#693, #896, and the owner's
 * rework of 2026-10-29: #942, #943), "New task" with the chosen matter (#695, #941; the Matters section of #908 is gone, #945), the activity events (#697; they
 * moved to the Activity tab in issue #909; Workload and capacity, #696, was removed for Project Managers, #826). Each test builds the matters and tasks it needs
 * in a world of its own, so the numbers on the page are written down here instead of read back from the page.
 */
/** An option of the pre-filter dropdown, and the number in its words ("Overdue (9)"). */
const option = (page: Page, key: string) => page.locator(`option[data-prefilter-option="${key}"]`);
const optionCount = async (page: Page, key: string): Promise<number> => {
  const text = (await option(page, key).textContent()) ?? '';
  const m = /\((\d+)\)\s*$/.exec(text.trim());
  return m ? Number(m[1]) : Number.NaN;
};

test.describe('My Matters: shell, filters and the pre-filter counts', () => {
  test('every option of the pre-filter filters the grid to a total that equals its count, and the numbers are the world written down', async ({
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
    await expect.poll(() => optionCount(page, 'open')).toBe(6);
    expect(await optionCount(page, 'overdue')).toBe(1);
    expect(await optionCount(page, 'dueSoon')).toBe(2);
    expect(await optionCount(page, 'unassigned')).toBe(4);
    expect(await optionCount(page, 'onHold')).toBe(1);
    // No tiles, no "Matters I manage": the dropdown is the one place of the counts.
    await expect(page.locator('[data-strip-item], [data-mm-strip], .tile')).toHaveCount(0);
    await expect(option(page, 'open')).toHaveText('All open (6)');
    await shot(page, 'my-matters-prefilter');

    // Each choice filters the grid in place; the grid's total (the Task Queue's answer) is the count in the option.
    for (const key of ['overdue', 'dueSoon', 'unassigned', 'onHold', 'open']) {
      const n = await optionCount(page, key);
      const [queue] = await Promise.all([
        page.waitForResponse((r) => /\/api\/v1\/task-queue\?/.test(r.url()) && r.ok()),
        page.locator('select[data-prefilter]').selectOption(key),
      ]);
      await expect(page).toHaveURL(/\/my-matters/);
      expect(((await queue.json()) as { total: number }).total, `grid total for ${key}`).toBe(n);
      await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(n);
    }
  });

  test('Role, Client and Matter are in the address, change the grid and the counts and survive Back', async ({
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
    await expect.poll(() => optionCount(page, 'open')).toBe(2);
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(2);
    await page.locator('[data-filter=role]').selectOption('primary');
    await expect(page).toHaveURL(/role=primary/);
    await expect.poll(() => optionCount(page, 'open')).toBe(1);
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(1);
    await page.locator('[data-filter=role]').selectOption('secondary');
    await expect(page).toHaveURL(/role=secondary/);
    await expect.poll(() => optionCount(page, 'open')).toBe(1);
    // The Calendar replaces the address (PV-08, #929), so Back skips it.
    await page.getByRole('button', { name: 'Show calendar' }).click();
    await expect(page.locator('[data-panel=calendar]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-filter=role]')).toHaveValue('primary');
    await expect.poll(() => optionCount(page, 'open')).toBe(1);
    // Clear filters
    await page.locator('[data-clear-filters]').first().click();
    await expect(page).toHaveURL(/\/my-matters$/);
    await expect.poll(() => optionCount(page, 'open')).toBe(2);
    // The Calendar choice is remembered for the next visit: leave it off, so the pages below open on the grid.
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    // The Matter filter by the address (issue #941): the grid and the counts follow, and the box shows the matter.
    await page.goto(`/my-matters?matterId=${asSecondary.matterId}`);
    await expect.poll(() => optionCount(page, 'open')).toBe(1);
    await expect(page.locator('#mm-matter')).toHaveValue(new RegExp(asSecondary.name));
    await expect(page.locator('[data-panel=tasks] tr[data-task]')).toHaveCount(1);
    // The client filter by the address
    await page.goto(`/my-matters?clientId=${w.world.client.clientId}`);
    await expect.poll(() => optionCount(page, 'open')).toBe(2);
    await expect(page.locator('#mm-client')).toHaveValue(new RegExp(w.world.client.name));
    await page.goto('/my-matters?clientId=99999999');
    await expect(page.locator('[data-panel=tasks] [data-empty]')).toContainText('No open tasks.');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(1);
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
    await expect(page.locator('[data-no-matters]')).toContainText(
      'You are not the project manager of any matter yet.',
    );
    await expect(page.locator('[data-empty-kind=none]')).toContainText(
      'Ask a director to assign you.',
    );
    // Nothing else is drawn: no dropdown of counts, no grid, no empty cards (#920).
    await expect(page.locator('[data-prefilter]')).toHaveCount(0);
    await expect(page.locator('[data-panel=tasks]')).toHaveCount(0);
    await page.locator('[data-to-my-work]').click();
    await expect(page).toHaveURL(/\/my-work/);
  });

  test('the grid fails and loads on its own: the failure stays in the grid, with its own Retry, and the tabs keep working', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'fail');
    const m = await w.matter('Alpha');
    await w.matter('Beta');
    await w.task(m, { dueDate: '2000-01-01' });
    const page = await asUser(w.pm.username);
    // The grid is over the Task Queue (issue #929): its call fails.
    await page.route('**/api/v1/task-queue*', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );
    await page.goto('/my-matters');
    await expect(page.locator('[data-panel=tasks] [data-panel-error]')).toContainText(
      "Couldn't load open tasks.",
    );
    // The pre-filter and its counts are part of the grid's header: they wait for the grid, and the page around them (tabs, filters) stays.
    await expect(page.locator('select[data-prefilter]')).toHaveCount(0);
    await expect(page.locator('#mm-tab-overview')).toBeVisible();
    await page.unroute('**/api/v1/task-queue*');
    await page.locator('[data-panel=tasks] [data-panel-retry]').click();
    await expect(page.locator('[data-panel=tasks] tr[data-task]').first()).toBeVisible();
    await expect(option(page, 'open')).toHaveText(/\(1\)\s*$/);
  });
});

test.describe('My Matters: the one grid of open tasks', () => {
  test('rows that open the task and Back, paging instead of View all, and no item about a matter nobody manages', async ({
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
    const grid = page.locator('[data-panel=tasks]');
    // Every open task of the person's matters is in the one grid, in the urgency order: the overdue one, the unassigned one with a date, then the rest.
    const rows = grid.locator('tr[data-task]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Late filing');
    await expect(rows.nth(1)).toContainText('Soon filing');
    await expect(rows.nth(2)).toContainText('Nobody holds this');
    await expect(rows.first().locator('td[data-col=due]')).toContainText(/overdue/i);
    // An unassigned task says so in the Assignee column.
    for (const i of [0, 1, 2])
      await expect(rows.nth(i).locator('td[data-col=assignee]')).toHaveText(/Unassigned/);
    await expect(grid.locator('[data-group], [data-also-tag], [data-repeated]')).toHaveCount(0);
    await expect(grid).not.toContainText('On a matter without manager');
    await expect(grid).not.toContainText(nobody.name);
    await expect(grid.locator('[data-view-all]')).toHaveCount(0);
    // The row opens the task; Back returns to the page with its filters.
    await page.goto('/my-matters?role=primary');
    await grid.locator('tr[data-task]').first().locator('a.wt-title').click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${od.taskId}\\?from=my-matters`));
    await expect(page.getByRole('link', { name: /My Matters/ }).first()).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/my-matters\?role=primary/);
  });

  test('"Due soon" lists what falls due within a week, in place, with no range control; the Calendar shows the task of another week in its month', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'dead');
    const m = await w.matter('Alpha');
    const mine = { assignedUserId: w.other.userId };
    await w.task(m, { dueDate: inDays(3), title: 'Within a week', ...mine });
    await w.task(m, { dueDate: inDays(3), title: 'Same day', ...mine });
    await w.task(m, { dueDate: inDays(20), title: 'Within four weeks', ...mine });
    await w.task(m, { dueDate: '2000-01-01', title: 'Long overdue' });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const grid = page.locator('[data-panel=tasks]');
    await expect(grid.locator('tr[data-task]')).toHaveCount(4);
    await page.locator('select[data-prefilter]').selectOption('dueSoon');
    await expect(grid.locator('tr[data-task]')).toHaveCount(2);
    await expect(grid).not.toContainText('Long overdue');
    await expect(grid).not.toContainText('Within four weeks');
    await expect(grid.locator('[data-grid-status]')).toContainText('2 tasks due within 7 days');
    // The grid has no 2 / 4 week buttons and no Views or Task types of its own.
    await expect(grid.locator('[data-range], [data-views], [data-types-trigger]')).toHaveCount(0);
    // The Calendar is a month: the task due in 20 days is on its own date, in its month. (The pre-filter is kept and the Calendar follows it, so "All open" is asked for.)
    await page.goto(`/my-matters?view=calendar&show=open&month=${inDays(20).slice(0, 7)}`);
    await expect(page.locator('[data-panel=calendar]')).toContainText('Within four weeks');
    // The old "Dates" choices are gone.
    await expect(page.locator('[data-filter=range], #mm-range')).toHaveCount(0);
  });

  test('a stuck hold shows with its status, the On hold option counts it and filters to it', async ({
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
    const row = page.locator('[data-panel=tasks] tr[data-task]');
    await expect(row.locator('td[data-col=status]')).toContainText(/On Hold/i);
    await expect(row).toContainText('Waiting on client');
    await expect.poll(() => optionCount(page, 'onHold')).toBe(1);
    await page.locator('select[data-prefilter]').selectOption('onHold');
    await expect(page.locator('[data-grid-status]')).toContainText('1 task on hold');
    await expect(row).toHaveCount(1);
  });
});

test.describe('My Matters: no Matters section, and New task with the chosen matter', () => {
  test('a matter nobody manages is never listed or counted on the page of someone who manages others', async ({
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
    await expect(page.locator('[data-panel=health]')).toHaveCount(0); // no Matters section any more (#945)
    await expect(page.locator('main')).not.toContainText('Orphaned');
    // Nothing is overdue: the Overdue option says (0), muted.
    await expect.poll(() => optionCount(page, 'overdue')).toBe(0);
    await expect(option(page, 'overdue')).toHaveClass(/pf__zero/);
    await expect(page.locator('main')).not.toContainText(
      /no (project )?manager|unmanaged|not managed/i,
    );
  });

  for (const size of [
    { width: 1366, height: 768 },
    { width: 375, height: 812 },
  ]) {
    test(`New task with a matter chosen in the Matter filter opens Create task with it and creating the task returns to My Matters (${size.width})`, async ({
      seed,
      personas,
      asUser,
    }) => {
      const w = await mmWorld(seed, personas, 'newtask');
      const m = await w.matter('Target');
      await w.matter('Other');
      const page = await asUser(w.pm.username);
      await page.setViewportSize(size);
      await page.goto(`/my-matters?role=primary&matterId=${m.matterId}`);
      let go;
      if (size.width < 640) {
        // On a phone the button sits inside the title row's Options menu.
        await page.locator('[data-header-options] [data-options-trigger]').click();
        go = page.locator('[data-new-task-inline] [data-new-task-go]');
        const box = await go.boundingBox();
        expect(box!.height, 'touch target').toBeGreaterThanOrEqual(43.5);
      } else {
        go = page.locator('[data-header-new-task] [data-new-task-go]');
      }
      await expect(go).toHaveAccessibleName(`New task for ${m.matterRef} ${m.name}`);
      await go.click();
      await expect(page).toHaveURL(new RegExp(`/tasks/new\\?matterId=${m.matterId}`));
      await expect(page.getByRole('heading', { name: 'Create task', level: 1 })).toBeVisible();
      // Task type first, then the form; the matter is already chosen.
      await page.getByRole('radio', { name: new RegExp(w.world.taskType.name) }).click();
      await expect(page.locator('[data-chosen]').first()).toContainText(m.matterRef);
      const title = `From My Matters ${size.width}`;
      await page.getByRole('textbox', { name: 'Title (required)' }).fill(title);
      await page.getByRole('textbox', { name: 'Requestor name (required)' }).fill('Rita Requestor');
      await page.getByRole('button', { name: 'Create task', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/my-matters\\?.*matterId=${m.matterId}`));
      const made = await seed.admin.get<{
        items: { title: string; matterId: number }[];
      }>(`/api/v1/tasks?matterId=${m.matterId}&q=${encodeURIComponent(title)}`);
      expect(made.items.map((t) => t.matterId)).toEqual([m.matterId]);
      await expect(page.locator('[data-panel=tasks] [data-task]').first()).toBeVisible();
    });
  }

  test('with no matter chosen New task asks for the matter itself; Cancel on Create task returns to My Matters', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'cancel');
    await w.matter('Target');
    await w.matter('Other');
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const go = page.locator('[data-header-new-task] [data-new-task-go]');
    await expect(go).toHaveAccessibleName('New task');
    await go.click();
    await expect(page).toHaveURL(/\/tasks\/new\?/);
    await expect(page).not.toHaveURL(/matterId=/);
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
    // One row per event: the What column says it in a short phrase, the Task column names the task (issue #946).
    const about = panel.locator('[data-activity-row]').filter({ hasText: 'Created by the admin' });
    await expect(about.locator('[data-col=what]')).toHaveText(['Put on hold', 'Created']);
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
      await expect(page.locator('[data-panel=tasks] [data-task]').first()).toBeVisible();
    });
  });
});
