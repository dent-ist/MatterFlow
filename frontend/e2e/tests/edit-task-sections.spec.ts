import { Locator, Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { FieldSpec, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Edit task sections (#350): the Edit dialog has the same three sections as Create task (#349): Task (Title, Description, Project),
 * Input (requestor and the request-form fields) and "Priority, due date and assignment" (collapsed, one summary line, opens by itself on
 * an error). Matter, Task type and Workflow stay in the locked block. Screenshots: E2E_SCREENSHOTS=docs/ux/task-detail-review/fixes/
 * edit-sections (otherwise none are written).
 */
const SIZES = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '375x812', width: 375, height: 812 },
] as const;

const FIELDS: FieldSpec[] = [
  { key: 'alpha', label: 'Alpha request', control: 'TEXT', required: true },
  { key: 'beta', label: 'Beta request', control: 'TEXT' },
  { key: 'gamma', label: 'Gamma request', control: 'TEXT' },
];

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

async function checkPage(page: Page, label: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), `axe: ${label}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal scroll: ${label}`).toBeLessThanOrEqual(0);
  const body = await page
    .locator('.p-dialog-content')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(body, `dialog body sideways: ${label}`).toBeLessThanOrEqual(0);
}

const dialogOf = (page: Page): Locator => page.getByRole('dialog', { name: 'Edit task details' });
const whenToggle = (page: Page): Locator => page.locator('[data-when-toggle]');
const whenSummary = (page: Page): Locator => page.locator('[data-when-summary]');
const inputToggle = (page: Page): Locator => page.locator('[data-request-toggle]');
const top = async (loc: Locator): Promise<number> => (await loc.boundingBox())!.y;

async function openEdit(page: Page): Promise<void> {
  const edit = page.locator('[data-task-header] [data-action="edit"]');
  if (await edit.isVisible()) await edit.click();
  else {
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /^Edit/ }).click();
  }
  await expect(dialogOf(page)).toBeVisible();
  await expect(page.locator('#td-title')).toBeFocused();
}

test.describe('Edit task sections (#350)', () => {
  for (const size of SIZES) {
    test(`sections and order, collapsed and expanded, Due date and Time aligned at ${size.name}`, async ({
      page,
      seed,
    }) => {
      const world = await seed.world({ stepCount: 2, fields: FIELDS });
      const task = await seed.task(world, {
        title: `Sections ${uid()}`,
        formValues: { alpha: 'a1', beta: 'b1' },
        dueDate: '2030-10-24',
        dueTime: '17:00',
      });
      await page.setViewportSize({ width: size.width, height: size.height });
      await new TaskDetailPage(page).open(task.taskId);
      await openEdit(page);
      const dialog = dialogOf(page);

      // Three sections, in this order; the old names are gone.
      await expect(dialog.locator('[data-section] h3')).toHaveText([
        /^Task$/,
        /^Input\s*3 fields/,
        /^Priority, due date and assignment/,
      ]);
      await expect(dialog.getByText('Request details')).toHaveCount(0);
      await expect(dialog.locator('[data-section="assignment"]')).toHaveCount(0);

      // Task: Title, Description, Project in that order.
      const order = [
        await top(page.locator('#td-title')),
        await top(page.locator('[data-description-editor]')),
        await top(page.locator('#td-project')),
      ];
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // Input: requestor first, then the form fields in form order; the 3-field form starts open.
      await expect(inputToggle(page)).toHaveAttribute('aria-expanded', 'true');
      const input = dialog.locator('[data-section="input"]');
      const tops = [
        await top(page.locator('#td-req-name')),
        await top(input.getByRole('textbox', { name: /^Alpha request/ })),
        await top(input.getByRole('textbox', { name: /^Beta request/ })),
        await top(input.getByRole('textbox', { name: /^Gamma request/ })),
      ];
      expect([...tops].sort((a, b) => a - b)).toEqual(tops);
      await expect(dialog.locator('[data-section="when"]').getByLabel(/Alpha request/)).toHaveCount(
        0,
      );

      // Collapsed by default, with the current values in one line.
      await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(whenToggle(page)).toHaveAttribute('aria-controls', 'td-when-body');
      await expect(whenSummary(page)).toHaveText(
        /^\w+ priority, due Oct 24, 2030 at 5:00 PM, (Unassigned|assigned to .+)$/,
      );
      await expect(page.locator('#td-when-body')).toBeHidden();
      await shot(page, `collapsed-${size.name}`);
      await checkPage(page, `collapsed ${size.name}`);

      // Expanded: Due date and Time aligned like Create task.
      await whenToggle(page).click();
      await expect(page.locator('#td-when-body')).toBeVisible();
      const d = (await page.locator('#td-due-date').boundingBox())!;
      const t = (await page.locator('#td-due-time').boundingBox())!;
      if (size.width >= 640) {
        expect(Math.abs(d.y - t.y), 'top of Due date and Time').toBeLessThanOrEqual(1);
        expect(Math.abs(d.y + d.height - (t.y + t.height)), 'bottom').toBeLessThanOrEqual(1);
        const labels = [
          await top(page.locator('label[for="td-due-date"]')),
          await top(page.locator('label[for="td-due-time"]')),
        ];
        expect(Math.abs(labels[0] - labels[1]), 'label baseline').toBeLessThanOrEqual(1);
      } else {
        expect(t.y).toBeGreaterThan(d.y + d.height - 1); // stacked
      }
      await shot(page, `expanded-${size.name}`);
      await checkPage(page, `expanded ${size.name}`);

      // Input closed and the priority section open still validates and fits.
      await inputToggle(page).click();
      await expect(page.locator('[data-request-body]')).toBeHidden();
      await checkPage(page, `input closed ${size.name}`);
    });
  }

  test('Input follows the 6-field rule: closed above 6 fields, open at 6 or fewer', async ({
    page,
    seed,
  }) => {
    const many: FieldSpec[] = Array.from({ length: 8 }, (_, i) => ({
      key: `m${i + 1}`,
      label: `Many field ${i + 1}`,
      control: 'TEXT',
    }));
    const long = await seed.world({ stepCount: 2, fields: many });
    const longTask = await seed.task(long, { title: `Long ${uid()}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(longTask.taskId);
    await openEdit(page);
    await expect(inputToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(inputToggle(page)).toContainText('8 fields');
    // Requestor sits inside Input, so it is hidden with it but still part of the form.
    await expect(page.locator('#td-req-name')).toBeHidden();
    await inputToggle(page).click();
    await expect(page.locator('#td-req-name')).toBeVisible();
  });

  test('the summary follows the values; the header is a button that Enter and Space toggle', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const task = await seed.task(world, { title: `Summary ${uid()}`, formValues: { alpha: 'x' } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await openEdit(page);
    await whenToggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await page.locator('#td-due-date').fill('Oct 30, 2030');
    await page.locator('#td-due-date').blur();
    await page.locator('#td-due-time').fill('09:15');
    await page.locator('#td-priority').selectOption({ label: 'High' });
    await whenToggle(page).focus();
    await page.keyboard.press('Space');
    await expect(whenSummary(page)).toContainText('High priority, due Oct 30, 2030 at 9:15 AM');
    // Cancel and reopen: the section starts collapsed again and shows the saved values.
    await page.locator('[data-cancel]').click();
    await page.keyboard.press('Escape');
    await openEdit(page);
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(whenSummary(page)).not.toContainText('High priority');
  });

  test('keyboard only: a task is edited and saved without the mouse', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const task = await seed.task(world, { title: `Keys ${uid()}`, formValues: { alpha: 'x' } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    const edit = page.locator('[data-task-header] [data-action="edit"]');
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#td-title')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Edited with the keyboard');
    await page.locator('#td-req-name').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Kay Board');
    await whenToggle(page).focus();
    await page.keyboard.press('Enter');
    await page.locator('#td-priority').focus();
    await page.keyboard.press('Tab'); // on to Due date
    await expect(page.locator('#td-due-date')).toBeFocused();
    await page.keyboard.type('Oct 30, 2030');
    await page.keyboard.press('Tab');
    await page.locator('#td-due-time').focus();
    await page.keyboard.type('0930AM');
    await page.locator('[data-save]').focus();
    await page.keyboard.press('Enter');
    await expect(dialogOf(page)).toHaveCount(0);
    const saved = await new TaskApi(admin, task.taskId).get();
    expect(saved.title).toBe('Edited with the keyboard');
    expect(saved.requestorName).toBe('Kay Board');
    expect(saved.dueDate).toBe('2030-10-30');
    await expect(edit).toBeFocused();
  });

  test('a collapsed section opens by itself when it holds an error: a page error, a server error, and Input', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const task = await seed.task(world, { title: `Errors ${uid()}`, formValues: { alpha: 'x' } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await openEdit(page);

    // 1. A due time without a date (checked by the page): the priority section opens and the date takes the cursor.
    await whenToggle(page).click();
    await page.locator('#td-due-time').fill('10:00');
    await whenToggle(page).click();
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.locator('[data-save]').click();
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-error-summary]')).toContainText('Choose a date');
    await expect(page.locator('#td-due-date')).toBeFocused();
    await shot(page, 'opened-on-error-1366');
    await checkPage(page, 'opened on error');
    await page.locator('#td-due-time').fill('');
    await whenToggle(page).click();
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'false');

    // 2. A server error on a field of that section opens it too.
    await page.route('**/api/v1/tasks/*', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      return route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'urn:matterflow:error:validation-failed',
          title: 'Validation failed',
          status: 400,
          code: 'VALIDATION_FAILED',
          errors: { dueDate: [{ code: 'INVALID', message: 'The server rejects this date.' }] },
        }),
      });
    });
    await page.locator('[data-save]').click();
    await expect(whenToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#td-when-body [role=alert]')).toContainText('server rejects');
    await expect(page.locator('#td-due-date')).toBeFocused();
    await page.unroute('**/api/v1/tasks/*');

    // 3. A requestor error opens Input (closed here by the person) and a fix saves.
    await inputToggle(page).click();
    await expect(inputToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#td-req-name').evaluate((el: HTMLInputElement) => {
      el.value = '';
      el.dispatchEvent(new Event('input'));
    });
    await page.locator('[data-save]').click();
    await expect(inputToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#td-req-name')).toBeFocused();
    await page.locator('#td-req-name').fill('Rita');
    await page.locator('[data-save]').click();
    await expect(dialogOf(page)).toHaveCount(0);
    expect((await new TaskApi(admin, task.taskId).get()).requestorName).toBe('Rita');
  });

  test('permission variants: Task.Edit without Assign or Set priority, Task.View only, a closed task', async ({
    page,
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const world = await seed.world({ stepCount: 2, fields: FIELDS });
    const tech = await seed.user(['Data Technician'], `es-${token}`);
    const task = await seed.task(world, {
      title: `Perm ${token}`,
      formValues: { alpha: 'x' },
      assignedUserId: tech.userId,
    });

    // System Admin: all three sections, the assignment fields inside the third.
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await openEdit(page);
    await whenToggle(page).click();
    await expect(page.locator('#td-priority')).toBeEnabled();
    await expect(page.locator('#td-pod')).toBeVisible();
    await expect(page.locator('#td-assignee-change')).toBeVisible(); // the task already has an assignee
    await page.locator('[data-cancel]').click();

    // Task.Edit only: no Pod, no assignee, no priority control; the summary still states who it is assigned to.
    const editRole = await seed.role(['Task.View', 'Task.Edit'], `E2E ES editor ${token}`);
    const editor = await seed.user([editRole.name], `ese-${token}`);
    const editorPage = await asUser(editor.username);
    await editorPage.setViewportSize({ width: 375, height: 812 });
    await new TaskDetailPage(editorPage).open(task.taskId);
    await openEdit(editorPage);
    await expect(editorPage.locator('[data-when-summary]')).toContainText('assigned to ');
    await editorPage.locator('[data-when-toggle]').click();
    await expect(editorPage.locator('#td-pod')).toHaveCount(0);
    await expect(editorPage.locator('#td-assignee, #td-assignee-change')).toHaveCount(0);
    await expect(editorPage.locator('#td-priority')).toHaveCount(0);
    await expect(editorPage.locator('#td-due-date')).toBeVisible();
    await checkPage(editorPage, 'Task.Edit without Assign 375');
    await editorPage.locator('[data-cancel]').click();

    // Task.View only: no Edit control, so no dialog.
    const viewRole = await seed.role(['Task.View'], `E2E ES viewer ${token}`);
    const viewer = await seed.user([viewRole.name], `esv-${token}`);
    const viewerPage = await asUser(viewer.username);
    await new TaskDetailPage(viewerPage).open(task.taskId);
    await expect(viewerPage.locator('[data-view-only]')).toBeVisible();
    await expect(viewerPage.locator('[data-task-header] [data-action="edit"]')).toHaveCount(0);

    // A closed task is not editable at all.
    const closed = await seed.task(world, { title: `Closed ${token}`, formValues: { alpha: 'x' } });
    expect((await new TaskApi(admin, closed.taskId).cancel('Not needed')).status).toBeLessThan(300);
    await new TaskDetailPage(page).open(closed.taskId);
    await expect(page.locator('[data-task-header] [data-action="edit"]')).toHaveCount(0);
    await expect(page.locator('[data-edit-form]')).toHaveCount(0);
  });
});
