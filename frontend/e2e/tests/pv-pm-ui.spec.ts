import { Page } from '@playwright/test';
import { openHeaderOptions } from '../support/mm-header';
import { mmWorld } from '../support/my-matters-fixtures';
import { axeAvailable, axeBestPractice } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder } from '../support/seed';
import { TaskDetailPage } from '../pages/task-detail.page';

/**
 * PM v2 lanes B, C and F (epic #851): the on-hold reason in the UI (#877), At risk (#878), the Breakdown tab (#862), Focus (#858), the Overview
 * first screen (#859) and the demoted Trends tab (#863). Numbers are written down, not read back: each test builds its own matters and tasks.
 */
const SIZES = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function clean(page: Page, what: string): Promise<void> {
  expect(axeAvailable(), 'axe must really run').toBe(true);
  const violations = await axeBestPractice(page);
  expect(
    violations.map((v) => `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map((n) => n.target))}`),
    what,
  ).toEqual([]);
}

async function noSidewaysScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `no sideways scroll: ${what}`).toBe(false);
}

test.describe('On-hold reason (#877)', () => {
  test('the dialog asks for a reason, the lists and the task page say it, the queue filters by it', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const other = await seed.task(world);
    const reasons = await admin.get('/api/v1/on-hold-reasons');
    const waiting = reasons.find((r: { name: string }) => r.name === 'Waiting for client data');
    expect(waiting).toBeTruthy();

    await page.goto(`/tasks/${task.taskId}`);
    const detail = new TaskDetailPage(page);
    await detail.chooseAction('HOLD');
    const select = page.locator('#task-hold-reason');
    await expect(select).toBeVisible();
    await expect(page.locator('[data-hold-reason-field] label')).toContainText('(optional)');
    await expect(select.locator('option')).toContainText(['Choose a reason', waiting.name]);
    await select.selectOption({ label: waiting.name });
    await detail.submitReason('Put on hold', 'Waiting for the vendor');
    await detail.expectStatus('On Hold');
    await expect(page.locator('[data-note-reason-name]')).toHaveText(waiting.name);

    const saved = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(saved.onHoldReason.name).toBe(waiting.name);

    // A hold without a reason is allowed by default, and says so.
    await admin.post(`/api/v1/tasks/${other.taskId}/status`, {
      status: 'ON_HOLD',
      comment: 'Blocked',
      rowVersion: other.rowVersion,
    });

    await page.goto(`/tasks?matter=${world.matter.matterId}&status=ON_HOLD`);
    const row = page.locator(`tr[data-task="${saved.taskNumber}"]`);
    await expect(row.locator('[data-hold-reason]')).toHaveText(waiting.name);
    await expect(row.locator('td[data-col="status"] > div')).toHaveAttribute(
      'title',
      /On hold (since today|for \d+ days?) because Waiting for client data/,
    );

    await page.goto(
      `/tasks?matter=${world.matter.matterId}&status=ON_HOLD&onHoldReason=${waiting.id}`,
    );
    await expect(page.locator(`tr[data-task="${saved.taskNumber}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-task="${other.taskNumber}"]`)).toHaveCount(0);
    await expect(page.getByText(waiting.name).first()).toBeVisible();

    await page.goto(`/tasks?matter=${world.matter.matterId}&status=ON_HOLD&onHoldReason=0`);
    await expect(page.locator(`tr[data-task="${other.taskNumber}"]`)).toBeVisible();
    await expect(page.locator(`tr[data-task="${saved.taskNumber}"]`)).toHaveCount(0);
  });

  for (const size of SIZES) {
    test(`the hold dialog and the held list are clean at ${size.name}`, async ({ page, seed }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const world = await seed.world();
      const task = await seed.task(world);
      await page.goto(`/tasks/${task.taskId}`);
      const detail = new TaskDetailPage(page);
      await detail.chooseAction('HOLD');
      await expect(page.locator('#task-hold-reason')).toBeVisible();
      await clean(page, `hold dialog at ${size.name}`);
      await noSidewaysScroll(page, `hold dialog at ${size.name}`);
    });
  }
});

test.describe('At risk, the Breakdown tab and Focus', () => {
  test('At risk is a badge, a strip count and a filter; the Breakdown tab shows matter by type and no average turnaround', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    test.slow(); // four sizes with axe on two views
    test.skip(!Seeder.canWriteLegacyText(), 'needs the SQL container to age tasks');
    const w = await mmWorld(seed, personas, 'bd');
    const slow = await seed.taskType({ workflows: [w.world.workflow] });
    const view = await admin.get(`/api/v1/task-types/${slow.id}`);
    await admin.put(`/api/v1/task-types/${slow.id}`, {
      name: view.name,
      description: view.description ?? null,
      isActive: true,
      eligibleWorkflowIds: view.eligibleWorkflowIds,
      defaultWorkflowDefinitionId: view.defaultWorkflowDefinitionId,
      iconKey: view.iconKey,
      colourKey: view.colourKey ?? undefined,
      targetDays: 5,
      rowVersion: view.rowVersion,
    });
    const a = await w.matter('Alpha');
    const risky = await w.task(a, { taskTypeId: slow.id });
    seed.ageTask(risky.taskId, { createdDaysAgo: 5 });
    await w.task(a, { taskTypeId: slow.id }); // young: not at risk
    await w.task(a, { dueDate: '2000-01-01' }); // overdue, other type
    const done = await w.task(a, { taskTypeId: slow.id });
    seed.ageTask(done.taskId, { createdDaysAgo: 10, completedDaysAgo: 6 });

    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const cell = page.locator('[data-strip-item="atRisk"]');
    await expect(cell).toHaveAttribute('aria-label', '1 at risk');
    await cell.click();
    await expect(page).toHaveURL(/atRisk=true/);
    const row = page.locator(`tr[data-task="${risky.taskNumber}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-at-risk]')).toContainText('At risk');
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(1);

    await page.goto('/my-matters?tab=breakdown');
    await expect(page).toHaveTitle(/My Matters: Breakdown - /);
    const table = page.locator('table[data-bd-table="matrix"]');
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toBeAttached(); // the caption is for screen readers (issue #911)
    const slowCell = table.locator(`tr[data-matter-id="${a.matterId}"] [data-bd-cell]`).first();
    // One matter: one row, no "All matters" row, no By matter / All together toggle (issue #911).
    await expect(table.locator('tfoot')).toHaveCount(0);
    await expect(page.locator('[data-bd-view]')).toHaveCount(0);
    // A cell opens exactly the tasks it counts.
    const href = await table
      .locator(`tr[data-matter-id="${a.matterId}"] a[data-bd-cell]`)
      .first()
      .getAttribute('href');
    expect(href).toContain('/tasks?');
    await slowCell.click();
    await expect(page).toHaveURL(/\/tasks\?/);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();

    // With a second matter the toggle and the All matters row appear, and the all-together view lists the task types.
    const b = await w.matter('Bravo');
    await w.task(b, {});
    await page.goto('/my-matters?tab=breakdown');
    await expect(page.locator('[data-bd-view]')).toHaveCount(2);
    await expect(table.locator('tfoot')).toContainText('All matters');
    await page.goto('/my-matters?tab=breakdown&bview=types');
    const typeRow = page.locator(`[data-bd-type][data-type-id="${slow.id}"]`);
    await expect(typeRow).toBeVisible();
    await expect(page.locator('[data-bd-turnaround]')).toHaveCount(0);
    await expect(page.getByText(/turnaround|average/i)).toHaveCount(0);

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters?tab=breakdown');
      if (size.width < 720) await expect(page.locator('[data-bd-cards="matrix"]')).toBeVisible();
      else await expect(page.locator('table[data-bd-table="matrix"]')).toBeVisible();
      await noSidewaysScroll(page, `Breakdown at ${size.name}`);
      await clean(page, `Breakdown at ${size.name}`);
      await page.goto('/my-matters?tab=breakdown&bview=types');
      await expect(page.locator('[data-bd-type]').first()).toBeVisible();
      await noSidewaysScroll(page, `Breakdown types at ${size.name}`);
      await clean(page, `Breakdown types at ${size.name}`);
    }
  });

  test('Focus is picked once, applies to sections without a filter of their own and stays after a reload', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow(); // four sizes with axe
    const w = await mmWorld(seed, personas, 'fc');
    const second = await seed.taskType({ workflows: [w.world.workflow] });
    const a = await w.matter('Alpha');
    await w.task(a, { dueDate: '2000-01-01' });
    await w.task(a, { dueDate: '2000-01-02' });
    await w.task(a, { dueDate: '2000-01-03', taskTypeId: second.id });
    const page = await asUser(w.pm.username);
    await page.goto('/my-matters');
    const rows = page.locator('[data-panel="attention"] a.wt-title');
    await expect(rows).toHaveCount(3);

    await openHeaderOptions(page);
    await page.locator(`[data-focus-option="${second.id}"]`).check();
    await page.locator('[data-focus-save]').click();
    await expect(page.locator('[data-focus-chip]')).toContainText(`Focus: ${second.name}`);
    await expect(rows).toHaveCount(1);

    await page.reload();
    await expect(page.locator('[data-focus-chip]')).toContainText(second.name);
    await expect(rows).toHaveCount(1);

    // The New task chooser offers the Focus type first.
    await page.goto('/tasks/new');
    await expect(page.locator(`[data-focus-type="${second.name}"]`)).toBeVisible();

    // The chip clears the Focus everywhere (there is no per-list filter to say "All types" in one section, issue #907).
    await page.goto('/my-matters');
    await expect(rows).toHaveCount(1);
    await expect(page.locator('[data-focus-chip]')).toBeVisible();
    await page.locator('[data-focus-remove]').click();
    await expect(page.locator('[data-focus-chip]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-focus-chip]')).toHaveCount(0);
    await expect(rows).toHaveCount(3);

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      // The Focus is inside the one Options menu of the title row at every width (issues #922, #900).
      await page.locator('[data-header-options] [data-options-trigger]').click();
      await expect(page.locator('[data-focus-save]')).toBeVisible();
      await noSidewaysScroll(page, `Focus at ${size.name}`);
      await clean(page, `Focus open at ${size.name}`);
    }
  });
});

test.describe('Overview first screen and Trends (#859, #863)', () => {
  test('Needs my attention is above the fold, nothing is listed twice, the flag says why, Trends is last and one line', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.slow(); // four sizes with axe on two tabs
    const w = await mmWorld(seed, personas, 'ov');
    const a = await w.matter('Alpha');
    const both = await w.task(a, { dueDate: '2000-01-01' }); // overdue and unassigned
    await w.task(a, { dueDate: '2000-01-02' });
    const page = await asUser(w.pm.username);

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters');
      const heading = page.locator('[data-panel="attention"] h2.mmp__title');
      await expect(heading).toBeVisible();
      const box = await heading.boundingBox();
      expect(
        box!.y + box!.height,
        `Needs my attention above the fold at ${size.name}`,
      ).toBeLessThan(size.height);
      await noSidewaysScroll(page, `Overview at ${size.name}`);
      await clean(page, `Overview at ${size.name}`);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/my-matters');
    const rowsOfBoth = page.locator(`a.wt-title[href^="/tasks/${both.taskId}"]`);
    await expect(rowsOfBoth).toHaveCount(1);
    await expect(page.locator('[data-panel="attention"] td[data-col=due]').first()).toContainText(
      /overdue/i,
    );
    // The Dates control is in the Calendar only (the Deadlines tab moved there, #929).
    await expect(page.locator('[data-filter="range"]')).toBeHidden();
    await page.goto('/my-matters?view=calendar');
    await expect(page.locator('[data-filter="range"]')).toBeVisible();

    const tabs = await page.locator('[role=tab]').allTextContents();
    // (The Activity tab may carry a small number: the changes since the last visit.)
    expect(tabs.map((t) => t.replace(/\s+\d+\s*$/, '').trim())).toEqual([
      'Overview',
      'Breakdown',
      'Data', // PM v2 (#870): needs Asset.View, which the Project Manager role holds
      'Activity',
      'Trends',
    ]);
    await page.goto('/my-matters?tab=trends');
    await expect(page).toHaveTitle(/My Matters: Trends - /);
    const approx = page.locator('[data-approximate]');
    await expect(approx).toContainText('Approximate');
    await expect(approx).not.toHaveAttribute('open', '');
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/my-matters?tab=trends');
      await expect(approx).toBeVisible();
      await noSidewaysScroll(page, `Trends at ${size.name}`);
      await clean(page, `Trends at ${size.name}`);
    }
  });
});
