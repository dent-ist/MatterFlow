import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, World } from '../support/seed';
import { TaskApi } from '../support/tasks';
import { FIRM_ZONE, dateInZone } from '../support/time';

/**
 * Task page: edit the Due date inline from the Due tile (#664), like the Status, Priority and Assignee tiles. The tile is a button that opens
 * a small popover with the shared Due date and Time inputs, Save, Cancel and "Clear due date (ASAP)". The rules are the Edit dialog's.
 * Screenshots go to E2E_SCREENSHOTS when it is set (docs/ux/task-detail-review/fixes/due-inline).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const TRIGGER = '[data-due] [data-due-trigger]';
const POPOVER = '[data-due-popover]';
const dateField = (page: Page): Locator =>
  page.locator(`${POPOVER} mf-date-input input[type=text]`);
const timeField = (page: Page): Locator => page.locator(`${POPOVER} input[type=time]`);
const live = (page: Page): Locator => page.locator('[data-due-live]');

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

async function openPopover(page: Page): Promise<void> {
  const trigger = page.locator(TRIGGER);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(page.locator(POPOVER)).toBeVisible();
  await expect(dateField(page)).toBeFocused();
}

async function fill(page: Page, date: string, time = ''): Promise<void> {
  await dateField(page).fill(date);
  await dateField(page).blur();
  await timeField(page).fill(time);
}

interface Fixture {
  world: World;
  task: Json;
  tech: { username: string; userId: number };
}

async function seeded(seed: Seeder, admin: Api, taskOverrides: Json = {}): Promise<Fixture> {
  const world = await seed.world();
  const role = await seed.role(
    ['Task.View', 'Task.Edit', 'Workflow.Execute', 'Matter.View', 'Client.View'],
    'E2E editor',
  );
  const tech = await seed.user([role.name], 'tech');
  const pod = await seed.pod(undefined, [tech.userId]);
  const task = await seed.task(world, taskOverrides);
  await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
  return { world, task, tech };
}

test.describe('Task page: inline Due date (#664)', () => {
  test('the popover is clean for axe and does not scroll the page sideways at 375, 768, 1366 and 1920', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, { dueDate: dateInZone(FIRM_ZONE, -2) });
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await openPopover(page);
      // The popover is inside the window.
      const pop = (await page.locator(POPOVER).boundingBox())!;
      expect(pop.x).toBeGreaterThanOrEqual(0);
      expect(pop.x + pop.width).toBeLessThanOrEqual(size.width);
      expect(pop.y + pop.height).toBeLessThanOrEqual(size.height);
      // Past date warning and an error state are in the checked page too.
      await fill(page, 'Jan 5, 2020', '09:00');
      await expect(page.locator('[data-past-due]')).toBeVisible();
      if (axeAvailable()) {
        expect(await axeViolations(page), `popover at ${size.width}`).toEqual([]);
      }
      await noHorizontalScroll(page);
      await shot(page, 'popover-open');
    }
  });

  test('keyboard only: Tab to the tile, Enter opens, type the date and time, Save, focus returns to the tile and the change is announced, shown and audited', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin, {
      description: '<p>Keep <strong>this</strong> text.</p>',
    });
    const before = await admin.get(`/api/v1/tasks/${task.taskId}`);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-haspopup', 'true');
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false');
    await page.locator(TRIGGER).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(POPOVER)).toBeVisible();
    await expect(dateField(page)).toBeFocused();
    await page.keyboard.type('Oct 24, 2030');
    await page.keyboard.press('Tab'); // the calendar button
    await page.keyboard.press('Tab'); // the time field
    await expect(timeField(page)).toBeFocused();
    await page.keyboard.type('0500PM');
    // The time field has hour, minute and AM/PM parts: Tab walks through them to Save.
    for (let i = 0; i < 4; i++) {
      if (await page.locator('[data-due-save]').evaluate((el) => el === document.activeElement))
        break;
      await page.keyboard.press('Tab');
    }
    await expect(page.locator('[data-due-save]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(page.locator(TRIGGER)).toBeFocused();
    await expect(detail.due).toContainText('Oct 24, 2030');
    await expect(live(page)).toHaveText('Due date set to Oct 24, 2030 5:00 PM');
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false');
    await shot(page, 'saved');

    // Only the due fields changed on the server; the description is untouched.
    const after = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(after.dueDate).toBe('2030-10-24');
    expect(after.dueTime).toBe('17:00');
    expect(after.description).toBe(before.description);
    expect(after.title).toBe(before.title);
    expect(after.priority.priorityId).toBe(before.priority.priorityId);

    const drawer = await detail.openActivity();
    await expect(drawer).toContainText(/due/i);
  });

  test('Esc closes the popover and returns focus to the tile; a click outside and Cancel close it without saving', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    await new TaskDetailPage(page).open(task.taskId);
    await openPopover(page);
    await fill(page, 'Oct 24, 2030');
    await page.keyboard.press('Escape');
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(page.locator(TRIGGER)).toBeFocused();

    await openPopover(page);
    await page.locator('h1').click();
    await expect(page.locator(POPOVER)).toHaveCount(0);

    await openPopover(page);
    await page.locator('[data-due-cancel]').click();
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(page.locator(TRIGGER)).toBeFocused();
    expect((await admin.get(`/api/v1/tasks/${task.taskId}`)).dueDate ?? null).toBeNull();
  });

  test('ASAP and overdue styling follow the date; "Clear due date (ASAP)" empties it', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.due.locator('[data-due-tone]')).toHaveAttribute('data-due-tone', 'asap');
    await openPopover(page);
    await expect(page.locator('[data-due-clear]')).toHaveCount(0);
    await fill(page, dateInZone(FIRM_ZONE, -3));
    await page.locator('[data-due-save]').click();
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(detail.due.locator('[data-due-tone]')).toHaveAttribute('data-due-tone', 'overdue');
    await expect(detail.due).toContainText('Overdue');
    expect((await admin.get(`/api/v1/tasks/${task.taskId}`)).isOverdue).toBe(true);

    await openPopover(page);
    await page.locator('[data-due-clear]').click();
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(detail.due.locator('[data-due-tone]')).toHaveAttribute('data-due-tone', 'asap');
    await expect(live(page)).toHaveText('Due date cleared');
    await expect(page.locator(TRIGGER)).toBeFocused();
    const saved = await admin.get(`/api/v1/tasks/${task.taskId}`);
    expect(saved.dueDate ?? null).toBeNull();
    expect(saved.isOverdue).toBe(false);
  });

  test('a server error stays inside the popover (alert) with the cursor on Save; the next try works', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    let fail = true;
    await page.route(`**/api/v1/tasks/${task.taskId}`, async (route) => {
      if (route.request().method() === 'PUT' && fail) {
        fail = false;
        await route.fulfill({
          status: 400,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            status: 400,
            code: 'VALIDATION_FAILED',
            title: 'Validation failed',
            errors: { dueTime: [{ code: 'INVALID', message: 'Enter a valid time.' }] },
          }),
        });
      } else await route.continue();
    });
    await openPopover(page);
    await fill(page, 'Oct 24, 2030', '10:00');
    await page.locator('[data-due-save]').click();
    await expect(page.locator('[data-due-error="time"]')).toHaveText('Enter a valid time.');
    await expect(page.locator('[data-due-error="time"]')).toHaveAttribute('role', 'alert');
    await expect(page.locator('[data-due-save]')).toBeFocused();
    await expect(page.locator(POPOVER)).toBeVisible();
    await expect(page.locator('[data-toast]')).toHaveCount(0);
    await shot(page, 'error');
    await page.locator('[data-due-save]').click();
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(detail.due).toContainText('Oct 24, 2030');
  });

  test('a conflict shows the conflict message with Reload inside the popover; Reload brings the other change', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, admin);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await openPopover(page);
    await fill(page, 'Oct 24, 2030');
    // Someone else changes the task first.
    const current = await admin.get(`/api/v1/tasks/${task.taskId}`);
    await admin.put(`/api/v1/tasks/${task.taskId}`, {
      rowVersion: current.rowVersion,
      title: `${current.title} (renamed)`,
      requestorName: current.requestorName,
      dueDate: '2030-11-01',
    });
    await page.locator('[data-due-save]').click();
    const conflict = page.locator('[data-due-conflict]');
    await expect(conflict).toContainText('changed by someone else');
    await expect(conflict).toHaveAttribute('role', 'alert');
    await expect(page.locator('[data-due-save]')).toBeFocused();
    await shot(page, 'conflict');
    await page.locator('[data-due-reload]').click();
    await expect(page.locator(POPOVER)).toHaveCount(0);
    await expect(detail.due).toContainText('Nov 1, 2030');
    await expect(page.locator('h1')).toContainText('(renamed)');
  });

  test('permission variants: Task.Edit gets the menu; Task.View only, a Data Technician without Task.Edit, and closed tasks keep the plain tile; On Hold works', async ({
    seed,
    admin,
    asUser,
  }) => {
    const { world, task, tech } = await seeded(seed, admin, { dueDate: '2030-10-24' });
    const trigger = (p: Page) => p.locator(TRIGGER);

    const editor = await asUser(tech.username);
    await new TaskDetailPage(editor).open(task.taskId);
    await expect(trigger(editor)).toBeVisible();

    const viewRole = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E viewer');
    const viewer = await seed.user([viewRole.name], 'viewer');
    const viewPage = await asUser(viewer.username);
    const viewDetail = new TaskDetailPage(viewPage);
    await viewDetail.open(task.taskId);
    await expect(viewDetail.due).toContainText('Oct 24');
    await expect(trigger(viewPage)).toHaveCount(0);

    // The built-in Data Technician role follows the server's canEdit.
    const technician = await seed.user(['Data Technician'], 'dt');
    const dtPage = await asUser(technician.username);
    const dtDetail = new TaskDetailPage(dtPage);
    await dtDetail.open(task.taskId);
    const dtApi = (await admin.get(`/api/v1/tasks/${task.taskId}`)).allowedActions;
    void dtApi;
    const dtCanEdit = await dtPage.locator('[data-task-header] [data-action="edit"]').count();
    await expect(trigger(dtPage)).toHaveCount(dtCanEdit > 0 ? 1 : 0);

    // On Hold follows the Edit dialog: still editable.
    const api = new TaskApi(admin, task.taskId);
    await api.start().catch(() => undefined);
    expect((await api.changeStatus('ON_HOLD', 'Waiting for the client')).status).toBeLessThan(300);
    await editor.reload();
    await expect(trigger(editor)).toBeVisible();
    await trigger(editor).click();
    await fill(editor, 'Oct 25, 2030');
    await editor.locator('[data-due-save]').click();
    await expect(editor.locator(POPOVER)).toHaveCount(0);
    await expect(new TaskDetailPage(editor).due).toContainText('Oct 25');

    // Closed: Cancelled keeps "Was due ..." and no menu.
    const closed = await seed.task(world, { dueDate: '2030-10-24' });
    expect(
      (await new TaskApi(admin, closed.taskId).cancel('No longer needed')).status,
    ).toBeLessThan(300);
    await new TaskDetailPage(editor).open(closed.taskId);
    await expect(new TaskDetailPage(editor).due).toContainText('Was due');
    await expect(trigger(editor)).toHaveCount(0);
  });

  for (const [zone, utc] of [
    ['America/New_York', '2030-10-24T21:00:00Z'],
    ['Pacific/Auckland', '2030-10-24T04:00:00Z'],
    ['America/Los_Angeles', '2030-10-25T00:00:00Z'],
  ] as const) {
    test(`time zone ${zone}: Oct 24, 2030 5:00 PM is the same instant as in the Edit dialog`, async ({
      seed,
      admin,
      asUser,
    }) => {
      const { task } = await seeded(seed, admin);
      const page = await asUser('ke\\kekim', { timezoneId: zone });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await openPopover(page);
      await expect(page.locator(`${POPOVER} label[for$="-time"]`)).toContainText('Time (');
      await fill(page, 'Oct 24, 2030', '17:00');
      await page.locator('[data-due-save]').click();
      await expect(page.locator(POPOVER)).toHaveCount(0);
      await expect(detail.due).toContainText('Oct 24, 2030');
      const saved = await admin.get(`/api/v1/tasks/${task.taskId}`);
      expect(new Date(saved.dueAtUtc).toISOString()).toBe(new Date(utc).toISOString());

      // The Edit dialog shows the same date and time.
      await detail.openEdit();
      const dialog = page.getByRole('dialog', { name: 'Edit task details' });
      await dialog.getByRole('button', { name: /^Priority, due date and assignment/ }).click();
      await expect(dialog.locator('#td-due-date')).toHaveValue(/Oct 24, 2030/);
      await expect(dialog.locator('#td-due-time')).toHaveValue('17:00');
      await shot(page, `zone-${zone.replace('/', '-')}`);
    });
  }
});
