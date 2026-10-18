import { Locator, Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { TaskApi } from '../support/tasks';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { dateInZone, FIRM_ZONE } from '../support/time';

/**
 * My Work review, work package 7 (#148, #158, #166, #167): a row that left its tab goes after 4 seconds and the counts follow, toasts sit
 * above the pager, the progress step is a link to the step, and Complete tells the truth about step inputs. Every test uses its own
 * user and tagged tasks, so nothing depends on counts or order in the shared database.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/my-work-review/fixes/wp7 (otherwise none are written).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function pageAxe(page: Page, label: string): Promise<void> {
  if (!axeAvailable()) return;
  expect(await axeViolations(page), label).toEqual([]);
}

const statusTrigger = (row: Locator) => row.getByRole('button', { name: /change status of/ });
const priorityTrigger = (row: Locator) => row.getByRole('button', { name: /change priority of/ });

/** The number in a tab label, "Active (3)". */
async function count(tab: Locator): Promise<number> {
  const text = (await tab.textContent()) ?? '';
  return Number(/\((\d+)\)/.exec(text)?.[1] ?? NaN);
}

async function cancelInline(page: Page, row: Locator, expectClosed = true): Promise<void> {
  await statusTrigger(row).click();
  await page.locator('[data-option="CANCEL"]').click();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-reason-body]') });
  await dialog.getByLabel(/Comment/).fill('No longer needed');
  await dialog.getByRole('button', { name: 'Cancel task' }).click();
  if (expectClosed) await expect(dialog).toHaveCount(0);
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

test.describe('WP7: inline row actions', () => {
  test('BUG-9: a cancelled row leaves Active after 4 seconds; the counts and the pager follow (#148)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7a-${token}`);
    const world = await seed.world();
    const titles = [1, 2, 3].map((n) => `Row${n} ${token}`);
    for (const title of titles) await seed.task(world, { title, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(myWork.tab(/^Active/)).toContainText('(3)');
    await expect(myWork.tab(/^Closed/)).toContainText('(0)');
    await expect(page.locator('[data-range]')).toContainText('of 3');

    const row = myWork.row(titles[1]);
    await cancelInline(page, row);

    // At once: the counts. The row stays, muted, in its new state.
    await expect(myWork.tab(/^Active/)).toContainText('(2)');
    await expect(myWork.tab(/^Closed/)).toContainText('(1)');
    await expect(row).toHaveAttribute('data-leaving', 'true');
    await expect(row).toContainText('Cancelled');
    await shot(page, 'bug9-row-stays-muted-1366x768');

    // After 4 seconds the row is gone, the pager text is right and focus is on a row (or the table).
    await expect(row).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('[data-range]')).toContainText('of 2');
    expect(await count(myWork.tab(/^Active/))).toBe(2);
    await expect(
      page.getByRole('status').filter({ hasText: 'cancelled. Removed from Active.' }).first(),
    ).toBeAttached();
    const focusInRows = await page.evaluate(
      () => !!document.activeElement?.closest('tr[data-task], [role="region"]'),
    );
    expect(focusInRows).toBe(true);
    await shot(page, 'bug9-row-removed-1366x768');
    await pageAxe(page, 'after removal');

    // The truth survives a reload.
    await page.reload();
    await expect(myWork.tab(/^Active/)).toContainText('(2)');
    await expect(myWork.tab(/^Closed/)).toContainText('(1)');
  });

  test('BUG-9: on Due soon and overdue the count updates too, and a failed cancel keeps the row (#148)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7b-${token}`);
    const world = await seed.world();
    const soon = `Soon ${token}`;
    const keep = `Keep ${token}`;
    await seed.task(world, {
      title: soon,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    await seed.task(world, {
      title: keep,
      assignedUserId: me.userId,
      dueDate: dateInZone(FIRM_ZONE, 1),
    });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=dueSoon');
    await expect(myWork.tab(/^Due soon/)).toContainText('(2)');

    // A failing save puts the row back and shows the error; nothing leaves.
    let fail = true;
    await page.route('**/api/v1/tasks/*/cancel', (route) =>
      fail ? route.abort() : route.continue(),
    );
    await cancelInline(page, myWork.row(keep), false);
    await page.getByRole('dialog').getByRole('button', { name: 'Keep task' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(myWork.row(keep)).not.toHaveAttribute('data-leaving', 'true');
    await page.waitForTimeout(4500);
    await expect(myWork.row(keep)).toHaveCount(1);
    await expect(myWork.tab(/^Due soon/)).toContainText('(2)');

    fail = false;
    await cancelInline(page, myWork.row(soon));
    await expect(myWork.tab(/^Due soon/)).toContainText('(1)');
    await expect(myWork.tab(/^Active/)).toContainText('(1)');
    await expect(myWork.row(soon)).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('[data-range]')).toContainText('of 1');
  });

  test('BUG-9: a reopened task leaves Closed; Created by me keeps its rows (#148)', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7c-${token}`);
    const world = await seed.world();
    const task = await seed.task(world, { title: `Reopen ${token}`, assignedUserId: me.userId });
    expect((await new TaskApi(admin, task.taskId).cancel('setup')).status).toBeLessThan(300);
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open('?view=completed');
    const row = myWork.row(`Reopen ${token}`);
    await expect(row).toHaveCount(1);
    await statusTrigger(row).click();
    await page.locator('[data-option="REOPEN"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
    await expect(myWork.tab(/^Closed/)).toContainText('(0)');
    await expect(myWork.tab(/^Active/)).toContainText('(1)');
    await expect(row).toHaveCount(0, { timeout: 8000 });
  });

  test('BUG-9: the row waits while its menu is open, then leaves (#148)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7d-${token}`);
    const world = await seed.world();
    await seed.task(world, { title: `Hold ${token}`, assignedUserId: me.userId });
    await seed.task(world, { title: `Menu ${token}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    const row = myWork.row(`Hold ${token}`);
    await cancelInline(page, row);
    // Open the menu of the leaving row: it stays past the 4 seconds.
    await statusTrigger(row).click();
    await expect(page.locator('[data-option="REOPEN"]')).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(row).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(row).toHaveCount(0, { timeout: 4000 });
  });

  for (const size of SIZES) {
    test(`A10: toasts and the Undo toast stay clear of the pager at ${size.name} (#158)`, async ({
      seed,
      asUser,
    }) => {
      const token = uid();
      const me = await seed.user(['Data Technician'], `wp7t-${token}`);
      const world = await seed.world();
      await seed.task(world, { title: `Toast ${token}`, assignedUserId: me.userId });
      const page = await asUser(me.username);
      await page.setViewportSize({ width: size.width, height: size.height });
      const myWork = new MyWorkPage(page);
      await myWork.open();
      const row = myWork.row(`Toast ${token}`);
      await expect(row).toHaveCount(1);
      const pager = page.getByRole('navigation', { name: 'Pagination' });
      await expect(pager).toBeVisible();

      // The Undo toast (priority change).
      await priorityTrigger(row).scrollIntoViewIfNeeded();
      await priorityTrigger(row).click();
      await page.getByRole('menuitemradio', { name: 'Low' }).click();
      const undo = page.locator('[data-undo-toast]');
      await expect(undo).toBeVisible();
      await expectClear(undo, pager, size.name);
      await expect(pager.getByRole('button', { name: 'Previous' })).toBeVisible();
      await expect(page.locator('[data-range]')).toBeVisible();
      await shot(page, `toast-undo-${size.name}`);
      await pageAxe(page, `undo toast ${size.name}`);
      await page.locator('[data-undo-dismiss]').click();

      // The plain toast (Hold). The row may still be moving after the Undo toast went (the table scrolls sideways at 375 px) and a scroll closes
      // an open inline menu by design, so the trigger is brought into view first, as the priority trigger above.
      await statusTrigger(row).scrollIntoViewIfNeeded();
      await statusTrigger(row).click();
      await page.locator('[data-option="HOLD"]').click();
      const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-reason-body]') });
      await dialog.getByLabel(/Reason/).fill('Waiting');
      await dialog.getByRole('button', { name: 'Put on hold' }).click();
      const toast = page.locator('.p-toast-message').first();
      await expect(toast).toBeVisible();
      await expectClear(toast, pager, size.name);
      await shot(page, `toast-plain-${size.name}`);
      await pageAxe(page, `plain toast ${size.name}`);
    });
  }

  test('A10: the Task Queue keeps its toast above the pager too (#158)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7q-${token}`);
    const world = await seed.world();
    await seed.task(world, { title: `Queue ${token}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(`Queue ${token}`);
    const row = queue.row(`Queue ${token}`);
    await expect(row).toHaveCount(1);
    await priorityTrigger(row).click();
    await page.getByRole('menuitemradio', { name: 'Low' }).click();
    const undo = page.locator('[data-undo-toast]');
    await expect(undo).toBeVisible();
    await expectClear(undo, page.getByRole('navigation', { name: 'Pagination' }), 'queue');
  });

  test('M12.3: the current step is a link to the Workflow section at that step (#166)', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7s-${token}`);
    const world = await seed.world({ steps: [{ title: 'First' }, { title: 'Second' }] });
    const task = await seed.task(world, { title: `Step ${token}`, assignedUserId: me.userId });
    const api = new TaskApi(admin, task.taskId);
    await api.doStep(1, 'start');
    await api.doStep(1, 'complete');
    const current = await api.step(2);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    const row = myWork.row(`Step ${token}`);
    const link = row.locator('[data-step-link]');
    await expect(link).toHaveText(world.workflow.stepTitles[1]);
    await expect(link).toHaveAttribute(
      'aria-label',
      `Workflow progress: 1 of 2 done, current step ${world.workflow.stepTitles[1]}. Open step.`,
    );
    await expect(link).toHaveAttribute('href', new RegExp(`step=${current.stepInstanceId}`));
    await shot(page, 'step-link-1920x1080');
    await pageAxe(page, 'step link');
    await link.click();
    await expect(page).toHaveURL(new RegExp(`tab=workflow&step=${current.stepInstanceId}`));
    const toggle = page
      .getByRole('button', { name: new RegExp(world.workflow.stepTitles[1]) })
      .first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toBeFocused();
  });

  test('M12.3: at 375 the step is a link in the title line; a task with every step resolved shows text (#166)', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7p-${token}`);
    const world = await seed.world({ steps: [{ title: 'Only' }] });
    await seed.task(world, { title: `Open ${token}`, assignedUserId: me.userId });
    const done = await seed.task(world, { title: `Done ${token}`, assignedUserId: me.userId });
    const api = new TaskApi(admin, done.taskId);
    await api.doStep(1, 'start');
    await api.doStep(1, 'complete');
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 375, height: 812 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(myWork.row(`Open ${token}`).locator('[data-step-link]')).toBeVisible();
    await expect(myWork.row(`Done ${token}`).locator('[data-step-link]')).toHaveCount(0);
    await expect(myWork.row(`Done ${token}`)).toContainText('All steps resolved');
    await shot(page, 'step-link-375x812');
    await pageAxe(page, 'step link 375');
  });

  test('A6: Complete reads "needs step inputs" and opens the task at the blocked step; a ready task confirms (#167)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp7i-${token}`);
    const blocked = await seed.world({
      steps: [{ title: 'Needs input', requiredInput: true }, { title: 'Plain' }],
    });
    const ready = await seed.world({ steps: [{ title: 'Plain A' }, { title: 'Plain B' }] });
    const t1 = await seed.task(blocked, { title: `Blocked ${token}`, assignedUserId: me.userId });
    await seed.task(ready, { title: `Ready ${token}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();

    const blockedRow = myWork.row(`Blocked ${token}`);
    await statusTrigger(blockedRow).click();
    const complete = page.locator('[data-option="COMPLETE"]');
    await expect(complete).toContainText('Complete... (needs step inputs)');
    await shot(page, 'complete-needs-inputs-1366x768');
    await pageAxe(page, 'status menu with the check result');
    await page.keyboard.press('Escape');

    await statusTrigger(blockedRow).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-option="COMPLETE"]')).toContainText('needs step inputs');
    await page.locator('[data-option="COMPLETE"]').press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks/${t1.taskId}\\?tab=workflow&step=\\d+`));
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await myWork.open();
    const readyRow = myWork.row(`Ready ${token}`);
    await statusTrigger(readyRow).click();
    await expect(page.locator('[data-option="COMPLETE"]')).not.toContainText('needs step inputs');
    await page.locator('[data-option="COMPLETE"]').click();
    await expect(page.getByRole('dialog')).toContainText('Mark all completed and finish task');
  });
});

async function expectClear(toast: Locator, pager: Locator, label: string): Promise<void> {
  const t = await toast.boundingBox();
  const p = await pager.boundingBox();
  expect(t, `${label} toast`).not.toBeNull();
  expect(p, `${label} pager`).not.toBeNull();
  expect(
    intersects(t!, p!),
    `${label}: toast ${JSON.stringify(t)} over pager ${JSON.stringify(p)}`,
  ).toBe(false);
}
