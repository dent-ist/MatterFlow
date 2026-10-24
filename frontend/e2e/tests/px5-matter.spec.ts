import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { inDays, mmWorld } from '../support/my-matters-fixtures';
import { pmFixtures } from '../support/pm-fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { toasts } from '../support/toasts';

/**
 * The matter record Overview, enriched, and the quick actions per matter (epic #758, WP-PX5: #782 and #783), against the real API. Each test builds
 * the matters and tasks it needs in a world of its own (`mmWorld`), so the numbers are written down here and not read back.
 */
const section = (page: Page, key: string) => page.locator(`[data-section="${key}"]`);
const FORBIDDEN =
  /no project manager|without a (project )?manager|not managed|unmanaged|needs? a (project )?manager|missing (project )?manager|assign a (project )?manager|warning/i;

test.describe('Matter Overview: the matter at a glance', () => {
  test('health in words, tasks by status, next deadlines, who works on it, linked assets, recent activity; every count equals its list', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'ov');
    const away = await personas.create({
      label: 'ov-away',
      roles: ['Data Technician'],
      displayName: 'Away Technician',
    });
    await seed.outOfOffice(away.userId);
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: '2000-01-01', title: 'Late filing', assignedUserId: away.userId });
    await w.task(m, { dueDate: inDays(3), title: 'Soon filing', assignedUserId: away.userId });
    await w.task(m, { dueDate: inDays(9), title: 'Later filing' });
    await w.task(m, { title: 'Nobody holds this' });
    await seed.asset(m, 'Custodian laptop');
    const page = await asUser(w.pm.username);
    await page.goto(`/matters/${m.matterId}`);

    const health = section(page, 'health');
    await expect(health.locator('[data-flag]')).toContainText('Red');
    await expect(health.locator('[data-reasons]')).toContainText('1 task is overdue');
    await expect(health.locator('[data-reasons]')).toContainText('nobody assigned');

    const status = section(page, 'status');
    await expect(status.locator('a').first()).toContainText('2'); // New: the two nobody holds yet
    await status.locator('a').first().click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page.locator('[data-range]').first()).toContainText('of 2');
    await page.goBack();

    const deadlines = section(page, 'deadlines');
    await expect(deadlines.locator('[data-deadline]')).toHaveCount(2); // the overdue one is not a deadline
    await expect(deadlines.locator('[data-deadline]').first()).toContainText('Soon filing');

    const people = section(page, 'people');
    await expect(people.locator('[data-person]', { hasText: 'Away Technician' })).toContainText(
      '2 open, 1 overdue',
    );
    await expect(people.locator('[data-away]')).toContainText(/^Away/);
    await expect(people.locator('[data-unassigned]')).toContainText(
      '2 open tasks have nobody assigned',
    );

    const assets = section(page, 'assets');
    await expect(assets).toContainText('Linked assets (1)');
    await expect(assets).toContainText('Custodian laptop');
    await assets.locator('[data-open-assets]').click();
    await expect(page).toHaveURL(/tab=assets/);
    await page.goBack();

    await expect(section(page, 'activity').locator('[data-event]').first()).toBeVisible();
    // The Project Manager role has no Audit.View: no link to the drawer. A Director opens it.
    await expect(section(page, 'activity').locator('[data-open-activity]')).toHaveCount(0);
    const director = await asUser((await personas.named('director')).username);
    await director.goto(`/matters/${m.matterId}`);
    await director.locator('[data-section="activity"] [data-open-activity]').click();
    await expect(director.getByRole('dialog', { name: /Activity/ })).toBeVisible();
  });

  test('a matter with no manager is normal: nothing warns, nothing is red for it; the details list and the tabs are still there', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'nomgr');
    const none = await w.matter('Orphan', null, null);
    await w.task(none, {
      dueDate: inDays(30),
      title: 'Quiet work',
      assignedUserId: w.other.userId,
    });
    const page = await asUser(w.pm.username);
    await page.goto(`/matters/${none.matterId}`);
    await expect(section(page, 'health')).toBeVisible();
    await expect(section(page, 'health').locator('[data-flag]')).toContainText('Green');
    expect(await page.locator('main').innerText()).not.toMatch(FORBIDDEN);
    await expect(page.locator('[data-matter-overview] .pg-dl')).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText([/Overview/, /Tasks/, /Projects/, /Assets/]);
  });

  test('sections appear only for what the person may use, and nothing is asked for without Task.View and Asset.View', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'perm');
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: inDays(3) });
    await seed.asset(m, 'Custodian laptop');
    const noAssets = await personas.create({
      label: 'ov-noasset',
      permissions: ['Client.View', 'Matter.View', 'Task.View', 'Project.View'],
    });
    let page = await asUser(noAssets.username);
    await page.goto(`/matters/${m.matterId}`);
    await expect(section(page, 'status')).toBeVisible();
    await expect(section(page, 'assets')).toHaveCount(0);

    const noTasks = await personas.create({
      label: 'ov-notask',
      permissions: ['Client.View', 'Matter.View', 'Project.View'],
    });
    page = await asUser(noTasks.username);
    const asked: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/overview')) asked.push(r.url());
    });
    await page.goto(`/matters/${m.matterId}`);
    await expect(page.locator('[data-matter-overview] .pg-dl')).toBeVisible();
    await expect(page.locator('[data-section]')).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test.describe('Quick actions per matter', () => {
  test("the matter header: bulk (the Tasks tab in selection mode), add comment on a chosen open task, open the matter's tasks", async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'qa');
    const m = await w.matter('Alpha');
    await w.task(m, { title: 'First open task' });
    const second = await w.task(m, { title: 'Second open task' });
    const page = await asUser(w.pm.username);
    await page.goto(`/matters/${m.matterId}`);
    await page.locator('mf-record-header [data-overflow]').click();
    await expect(page.locator('[role=menuitem]')).toContainText([
      /Bulk re-assign/,
      /Add comment/,
      /Open the matter's tasks/,
    ]);

    // Add comment: choose the task, write, post through the task comment API.
    await page.locator('[data-action=add-comment]').click();
    const dialog = page.locator('p-dialog');
    await expect(dialog.locator('[data-task-list] label')).toHaveCount(2);
    await dialog.locator('[data-task-list] label', { hasText: 'Second open task' }).click();
    await dialog.locator('[data-comment-text]').fill('Quick note from the project manager');
    await dialog.getByRole('button', { name: 'Add comment' }).click();
    await expect(toasts(page).first()).toContainText('Comment posted.');
    await page.goto(`/tasks/${second.taskId}`);
    await expect(page.locator('main')).toContainText('Quick note from the project manager');

    // Bulk: the Tasks tab opens in selection mode.
    await page.goto(`/matters/${m.matterId}`);
    await page.locator('mf-record-header [data-overflow]').click();
    await page.locator('[data-action=bulk-tasks]').click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(page.locator('[data-selection-bar]')).toBeVisible();
    await page.goto(`/matters/${m.matterId}`);

    // Open the matter's tasks: the Task Queue filtered to the matter, all of its tasks.
    await page.locator('mf-record-header [data-overflow]').click();
    await page.locator('[data-action=open-tasks]').click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?matter=${m.matterId}`));
    await expect(page.locator('[data-range]').first()).toContainText('of 2');
  });

  test('the Matters list and My Matters rows: one menu button per row, only what the person may use, Esc and Cancel return focus', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'row');
    const m = await w.matter('Alpha');
    await w.task(m, { title: 'Row task' });
    const page = await asUser(w.pm.username);

    await page.goto(`/matters?name=Alpha row`);
    const rowMenu = page.locator('tbody tr', { hasText: m.matterRef }).locator('[data-overflow]');
    await expect(rowMenu).toHaveAttribute(
      'aria-label',
      `More actions for ${m.matterRef} ${m.name}`,
    );
    await rowMenu.click();
    await expect(page.locator('[role=menuitem]')).toHaveText([
      /New task/,
      /Bulk re-assign/,
      /Add comment/,
      /Open the matter's tasks/,
    ]);
    await page.keyboard.press('Escape');
    await expect(rowMenu).toBeFocused();

    // Add comment from the row; Cancel returns focus to the row's menu button.
    await rowMenu.click();
    await page.locator('[data-action=add-comment]').click();
    await expect(page.locator('p-dialog [data-task-list] label')).toHaveCount(1);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-comment-text]')).toHaveCount(0);
    await expect(rowMenu).toBeFocused();

    // My Matters: the health row has + New task and the same menu.
    await page.goto('/my-matters');
    const health = page.locator('[data-health-row]', { hasText: m.matterRef });
    await expect(health.locator('[data-new-task]')).toBeVisible();
    await health.locator('[data-overflow]').click();
    await expect(page.locator('[role=menuitem]')).toHaveText([
      /Bulk re-assign/,
      /Add comment/,
      /Open the matter's tasks/,
    ]);
  });

  test('a person without Task.Comment or Task.Assign does not get those actions (absent, not greyed); without Task.View there is no menu', async ({
    seed,
    personas,
    asUser,
  }) => {
    const fx = await pmFixtures(seed, personas);
    const viewer = await personas.create({
      label: 'qa-viewer',
      permissions: ['Client.View', 'Matter.View', 'Task.View'],
    });
    let page = await asUser(viewer.username);
    await page.goto(`/matters?name=${fx.token}`);
    const rowMenu = page.locator('tbody tr').first().locator('[data-overflow]');
    await rowMenu.click();
    await expect(page.locator('[role=menuitem]')).toHaveText([/Open the matter's tasks/]);
    await expect(page.locator('[role=menuitem][aria-disabled=true]')).toHaveCount(0);

    page = await asUser(fx.pmNoTask.username); // Matter.View without Task.View
    await page.goto(`/matters?name=${fx.token}`);
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('[data-row-actions]')).toHaveCount(0);
  });

  test('every size: the Overview and the row menu are clean (axe 0, no sideways scroll)', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.skip(!axeAvailable(), 'axe-core is not installed');
    const w = await mmWorld(seed, personas, 'sz');
    const m = await w.matter('Alpha');
    await w.task(m, { dueDate: inDays(3), title: 'Sized' });
    await w.task(m, { dueDate: '2000-01-01', title: 'Sized late' });
    await seed.asset(m, 'Sized asset');
    const page = await asUser(w.pm.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/matters/${m.matterId}`);
      await expect(section(page, 'activity')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await axeViolations(page), `overview at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'px5-overview');
      await page.goto(`/matters?name=Alpha sz`);
      const row = page.locator('tbody tr, [data-record-card]').first();
      await expect(row).toBeVisible();
      await row.locator('[data-overflow]').click();
      await expect(page.locator('[role=menuitem]').first()).toBeVisible();
      expect(await axeViolations(page), `row menu at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await page
        .locator('mf-fixed-page, main')
        .first()
        .click({ position: { x: 2, y: 2 }, force: true });
      await row.locator('[data-overflow]').click();
      await page.locator('[data-action=add-comment]').click();
      await expect(page.locator('p-dialog [data-task-list] label').first()).toBeVisible();
      expect(await axeViolations(page), `comment dialog at ${size.width}`).toEqual([]);
      await page.getByRole('button', { name: 'Cancel' }).click();
    }
  });
});

test.describe('Notifications of a project manager lead to the matter in one click', () => {
  test('a task created on my matter: the task opens with the matter in the crumb; being named manager opens the matter itself', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(150_000);
    const w = await mmWorld(seed, personas, 'ntf');
    const m = await w.matter('Alpha');
    const later = await w.matter('Later', null, null);
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    await expect(page.getByTestId('notification-bell')).toBeVisible();
    // The first poll never announces what is there; what happens now arrives as new notifications.
    const created = await w.task(m, { title: 'Created for the PM' });
    await seed.admin.put(`/api/v1/matters/${later.matterId}/managers`, {
      primaryManagerId: w.pm.userId,
      secondaryManagerId: null,
      rowVersion: (
        await seed.admin.get<{ rowVersion: string }>(`/api/v1/matters/${later.matterId}`)
      ).rowVersion,
    });
    await page.reload();
    await page.getByTestId('notification-bell').click();
    const items = page.locator('[data-notification-panel] [data-notification-item]');
    await expect(items).toHaveCount(3); // being named manager of Alpha, of Later, and the new task

    // MatterManagerSet: the matter page directly.
    await items.filter({ hasText: later.name }).first().click();
    await expect(page).toHaveURL(new RegExp(`/matters/${later.matterId}$`));

    // MatterTaskCreated: the task, and the matter is one click away in the crumb.
    await page.getByTestId('notification-bell').click();
    await page
      .locator('[data-notification-panel] [data-notification-item]', {
        hasText: 'Created for the PM',
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${created.taskId}`));
    await page
      .locator('nav[aria-label="Breadcrumb"]')
      .getByRole('link', { name: new RegExp(m.matterRef) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/matters/${m.matterId}`));
  });
});
