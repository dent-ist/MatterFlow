import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { Json } from '../support/api';
import { mmWorld } from '../support/my-matters-fixtures';
import { uid } from '../support/seed';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';

/**
 * Bulk re-assign and re-prioritise inside one matter (epic #667, #699): selection mode in the matter's Tasks grid, the dialog with the count and
 * the no-undo note, the result list ("12 changed, 2 could not be changed"), focus back on the grid, the permission variants, the limit of 100
 * and the phone, where the tasks are cards.
 */
const tick = (page: Page, taskNumberOrTitle: string) =>
  page.getByRole('checkbox', { name: new RegExp(`^Select .*${taskNumberOrTitle}`) });

async function openTasks(page: Page, matterId: number): Promise<void> {
  await page.goto(`/matters/${matterId}?tab=tasks`);
  await expect(page.locator('[data-select-mode]')).toBeVisible();
}

async function makeTasks(
  w: Awaited<ReturnType<typeof mmWorld>>,
  matter: Awaited<ReturnType<Awaited<ReturnType<typeof mmWorld>>['matter']>>,
  titles: string[],
): Promise<Json[]> {
  const out: Json[] = [];
  for (const title of titles) out.push(await w.task(matter, { title }));
  return out;
}

test.describe('Bulk change in the matter grid', () => {
  test('re-assign three tasks: the dialog says how many, the result lists the outcome, focus returns to the grid', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const token = uid().slice(0, 5);
    const w = await mmWorld(seed, personas, 'bulk1');
    const m = await w.matter('Bulk target');
    const tech = await personas.create({
      label: 'bulk1-tech',
      roles: ['Data Technician'],
      displayName: `Bulk Technician ${token}`,
    });
    const tasks = await makeTasks(w, m, ['Bulk A', 'Bulk B', 'Bulk C', 'Bulk D', 'Bulk E']);
    const page = await asUser(w.pm.username);
    await openTasks(page, m.matterId);
    await page.locator('[data-select-mode]').click();
    await expect(page.locator('[data-selection-count]')).toHaveText('0 selected');
    await expect(page.getByRole('button', { name: 'Re-assign...' })).toBeDisabled();
    await tick(page, 'Bulk A').check();
    await tick(page, 'Bulk B').check();
    await tick(page, 'Bulk C').check();
    await expect(page.locator('[data-selection-count]')).toHaveText('3 selected');
    await page.getByRole('button', { name: 'Re-assign...' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('[data-bulk-count]')).toContainText('3 tasks selected');
    await expect(dialog.locator('[data-bulk-undo]')).toContainText(
      'This can’t be undone in one step',
    );
    // Nothing chosen: the dialog asks, and changes nothing.
    await dialog.getByRole('button', { name: 'Re-assign 3 tasks' }).click();
    await expect(dialog.locator('[data-confirm-error]')).toContainText('Choose a person or a pod.');
    await dialog.getByRole('combobox', { name: 'Assign to' }).fill(`Bulk Technician ${token}`);
    await dialog.getByRole('option', { name: new RegExp(`Bulk Technician ${token}`) }).click();
    await dialog.getByRole('button', { name: 'Re-assign 3 tasks' }).click();
    await expect(dialog.locator('[data-bulk-summary]')).toContainText('3 tasks changed.');
    await shot(page, 'bulk-result');
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(dialog).toBeHidden();
    // Focus is on the grid, the changed tasks left the selection, the rows show the new assignee.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase()))
      .toBe('mf-task-select-list');
    await expect(page.locator('[data-selection-count]')).toHaveText('0 selected');
    await expect(page.locator('[data-task]', { hasText: 'Bulk A' })).toContainText(
      'Bulk Technician',
    );
    const after = await Promise.all(tasks.map((t) => admin.get<Json>(`/api/v1/tasks/${t.taskId}`)));
    expect(after.map((t) => t.assignedUser?.userId ?? null)).toEqual([
      tech.userId,
      tech.userId,
      tech.userId,
      null,
      null,
    ]);
    // Done leaves selection mode and the normal grid is back.
    await page.locator('[data-selection-done]').click();
    await expect(page.locator('[data-select-row]')).toHaveCount(0);
  });

  test('a task that cannot be changed is listed with the reason, the others change, and the failed one stays selected', async ({
    seed,
    personas,
    asUser,
    admin,
  }) => {
    const token = uid().slice(0, 5);
    const w = await mmWorld(seed, personas, 'bulk2');
    const m = await w.matter('Bulk partial');
    const tech = await personas.create({
      label: 'bulk2-tech',
      roles: ['Data Technician'],
      displayName: `Partial Technician ${token}`,
    });
    const [a, b, c] = await makeTasks(w, m, ['Part A', 'Part B', 'Part C']);
    const page = await asUser(w.pm.username);
    await openTasks(page, m.matterId);
    await page.locator('[data-select-mode]').click();
    for (const t of ['Part A', 'Part B', 'Part C']) await tick(page, t).check();
    // Somebody cancels Part B meanwhile.
    await admin.post(`/api/v1/tasks/${b.taskId}/cancel`, {
      rowVersion: b.rowVersion,
      comment: 'Cancelled for the test',
    });
    await page.getByRole('button', { name: 'Re-assign...' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Assign to' }).fill(`Partial Technician ${token}`);
    await dialog.getByRole('option', { name: new RegExp(`Partial Technician ${token}`) }).click();
    await dialog.getByRole('button', { name: 'Re-assign 3 tasks' }).click();
    await expect(dialog.locator('[data-bulk-summary]')).toContainText(
      '2 changed, 1 could not be changed.',
    );
    await expect(dialog.locator('[data-bulk-failed-row]')).toContainText(
      `${b.taskNumber} Part B: it is completed or cancelled`,
    );
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.locator('[data-selection-count]')).toHaveText('1 selected');
    expect((await admin.get<Json>(`/api/v1/tasks/${a.taskId}`)).assignedUser.userId).toBe(
      tech.userId,
    );
    expect((await admin.get<Json>(`/api/v1/tasks/${c.taskId}`)).assignedUser.userId).toBe(
      tech.userId,
    );
    expect((await admin.get<Json>(`/api/v1/tasks/${b.taskId}`)).assignedUser).toBeNull();
  });

  test('set the priority of the selected tasks', async ({ seed, personas, asUser, admin }) => {
    const w = await mmWorld(seed, personas, 'bulk3');
    const m = await w.matter('Bulk priority');
    const tasks = await makeTasks(w, m, ['Prio A', 'Prio B']);
    const priorities =
      await admin.get<{ id: number; label: string; isActive: boolean }[]>('/api/v1/priorities');
    const target = priorities.filter((p) => p.isActive)[0];
    const page = await asUser(w.pm.username);
    await openTasks(page, m.matterId);
    await page.locator('[data-select-mode]').click();
    await page.locator('[data-select-all]').check();
    await expect(page.locator('[data-selection-count]')).toHaveText('2 selected');
    await page.getByRole('button', { name: 'Set priority...' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Priority').selectOption({ label: target.label });
    await dialog.getByRole('button', { name: 'Set priority on 2 tasks' }).click();
    await expect(dialog.locator('[data-bulk-summary]')).toContainText('2 tasks changed.');
    await dialog.getByRole('button', { name: 'Close' }).last().click();
    for (const t of tasks) {
      expect((await admin.get<Json>(`/api/v1/tasks/${t.taskId}`)).priority.priorityId).toBe(
        target.id,
      );
    }
  });

  test('Select is hidden without Task.Assign or Task.SetPriority and each action is hidden without its permission', async ({
    seed,
    personas,
    asUser,
  }) => {
    const w = await mmWorld(seed, personas, 'bulk4');
    const m = await w.matter('Bulk permissions');
    await makeTasks(w, m, ['Perm A']);
    const base = ['Client.View', 'Matter.View', 'Task.View'];
    const cases = [
      { label: 'bulk4-observer', permissions: base, select: false, assign: false, priority: false },
      {
        label: 'bulk4-assign',
        permissions: [...base, 'Task.Assign'],
        select: true,
        assign: true,
        priority: false,
      },
      {
        label: 'bulk4-prio',
        permissions: [...base, 'Task.SetPriority'],
        select: true,
        assign: false,
        priority: true,
      },
    ];
    for (const c of cases) {
      const who = await personas.create({ label: c.label, permissions: c.permissions });
      const page = await asUser(who.username);
      await page.goto(`/matters/${m.matterId}?tab=tasks`);
      await expect(page.getByRole('tab', { name: /Tasks/ })).toBeVisible();
      await expect(page.locator('[data-task]').first()).toBeVisible();
      await expect(page.locator('[data-select-mode]'), c.label).toHaveCount(c.select ? 1 : 0);
      if (!c.select) continue;
      await page.locator('[data-select-mode]').click();
      await expect(page.getByRole('button', { name: 'Re-assign...' }), c.label).toHaveCount(
        c.assign ? 1 : 0,
      );
      await expect(page.getByRole('button', { name: 'Set priority...' }), c.label).toHaveCount(
        c.priority ? 1 : 0,
      );
    }
    // The Read-Only Observer role, too.
    const observer = await personas.named('readOnlyObserver');
    const page = await asUser(observer.username);
    await page.goto(`/matters/${m.matterId}?tab=tasks`);
    await expect(page.locator('[data-task]').first()).toBeVisible();
    await expect(page.locator('[data-select-mode]')).toHaveCount(0);
  });

  test('at most 100 tasks can be selected at once, across pages', async ({
    seed,
    personas,
    asUser,
  }) => {
    test.setTimeout(240_000);
    const w = await mmWorld(seed, personas, 'bulk5');
    const m = await w.matter('Bulk cap');
    const batch = 15;
    for (let i = 0; i < 105; i += batch) {
      await Promise.all(
        Array.from({ length: Math.min(batch, 105 - i) }, (_, k) =>
          w.task(m, { title: `Cap ${i + k}` }),
        ),
      );
    }
    const page = await asUser(w.pm.username);
    await openTasks(page, m.matterId);
    await page.locator('[data-select-mode]').click();
    for (let p = 1; p <= 4; p++) {
      await page.locator('[data-select-all]').check();
      await expect(page.locator('[data-selection-count]')).toHaveText(`${p * 25} selected`);
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.locator('[data-page]')).toContainText(`Page ${p + 1} of`);
      // The rows of the next page are there when the select-all box is empty again.
      await expect(page.locator('[data-select-all]')).not.toBeChecked();
    }
    await page.locator('[data-select-row]').first().check();
    await expect(page.locator('[data-selection-note]')).toContainText(
      'You can select at most 100 tasks at once.',
    );
    await expect(page.locator('[data-selection-count]')).toHaveText('100 selected');
  });

  test('on a phone the tasks are cards you can tick, and the dialogs have no accessibility violations at four sizes', async ({
    seed,
    personas,
    asUser,
  }) => {
    expect(axeAvailable(), 'set E2E_AXE_PATH to axe.min.js').toBe(true);
    const token = uid().slice(0, 5);
    const w = await mmWorld(seed, personas, 'bulk6');
    const m = await w.matter('Bulk phone');
    const tech = await personas.create({
      label: 'bulk6-tech',
      roles: ['Data Technician'],
      displayName: `Phone Technician ${token}`,
    });
    await makeTasks(w, m, ['Phone A', 'Phone B']);
    const page = await asUser(w.pm.username);
    await page.setViewportSize({ width: 375, height: 812 });
    await openTasks(page, m.matterId);
    await page.locator('[data-select-mode]').click();
    await expect(page.locator('[data-select-cards]')).toBeVisible();
    await tick(page, 'Phone A').check();
    await tick(page, 'Phone B').check();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await expect(page.locator('[data-selection-count]')).toHaveText('2 selected');
      await page.getByRole('button', { name: 'Re-assign...' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.locator('[data-bulk-count]')).toBeVisible();
      expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width === 375) await shot(page, 'bulk-dialog');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'Re-assign...' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Assign to' }).fill(`Phone Technician ${token}`);
    await dialog.getByRole('option', { name: new RegExp(`Phone Technician ${token}`) }).click();
    await dialog.getByRole('button', { name: 'Re-assign 2 tasks' }).click();
    await expect(dialog.locator('[data-bulk-summary]')).toContainText('2 tasks changed.');
    expect(await axeViolations(page), 'result at 375').toEqual([]);
    void tech;
  });
});
