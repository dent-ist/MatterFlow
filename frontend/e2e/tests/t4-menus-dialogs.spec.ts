import { Locator, Page } from '@playwright/test';
import { MyWorkPage } from '../pages/queues.pages';
import { TaskDetailPage } from '../pages/task-detail.page';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Task Detail review, package T4 "Menus and dialogs" (#303 M1, #304 M2, #305 M3, #306 M4): the status menu has one label per item with
 * Cancel task last behind a divider; Complete stays usable while steps need information, says so, and its dialog's primary button goes to
 * the first blocked step; the Hold and Cancel dialogs use "Close"/"Keep task" and "Reason"; the assignee menu starts with "Assign to me"
 * and shows each candidate's open load. Every test builds its own users and tasks. Screenshots:
 * E2E_SCREENSHOTS=docs/ux/task-detail-review/fixes/t4 (otherwise none are written).
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

/** Axe (WCAG 2.2 AA) over the whole page, with whatever menu or dialog is open, and no page-level sideways scroll. */
async function checkPage(page: Page, label: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), `axe: ${label}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `page-level horizontal scroll: ${label}`).toBeLessThanOrEqual(0);
}

const assigneeTrigger = (page: Page): Locator =>
  page.locator('[data-task-header] [data-assignee] [data-inline-trigger]');

/** The visible labels of the open menu's items, in order. */
async function itemLabels(page: Page): Promise<string[]> {
  const texts = await page.locator('.im-pop [role=menuitemradio] .im-text').allTextContents();
  return texts.map((t) => t.replace(/\s+/g, ' ').trim());
}

test.describe('T4: status menu (M1, #303)', () => {
  test('one label per item for every status, Cancel task last behind a divider in the danger style; the status is only the tooltip', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const fresh = await seed.task(world, { title: `New ${uid()}` });
    const working = await seed.task(world, { title: `Working ${uid()}` });
    await new TaskApi(admin, working.taskId).start();
    const held = await seed.task(world, { title: `Held ${uid()}` });
    const heldApi = new TaskApi(admin, held.taskId);
    await heldApi.start();
    expect((await heldApi.changeStatus('ON_HOLD', 'Waiting')).status).toBeLessThan(300);
    const done = await seed.task(world, { title: `Done ${uid()}` });
    const doneApi = new TaskApi(admin, done.taskId);
    await doneApi.completeSteps(1, 2);
    expect((await doneApi.complete()).status).toBeLessThan(300);
    const cancelled = await seed.task(world, { title: `Cancelled ${uid()}` });
    expect((await new TaskApi(admin, cancelled.taskId).cancel('Not needed')).status).toBeLessThan(
      300,
    );

    const detail = new TaskDetailPage(page);
    const expected: [number, string, string[]][] = [
      [fresh.taskId, 'New', ['Start', 'Put on hold', 'Complete', 'Cancel task']],
      [working.taskId, 'In Progress', ['Put on hold', 'Complete', 'Cancel task']],
      [held.taskId, 'On Hold', ['Resume', 'Cancel task']],
      [done.taskId, 'Completed', ['Reopen']],
      [cancelled.taskId, 'Cancelled', ['Reopen']],
    ];
    for (const [id, status, labels] of expected) {
      await detail.open(id);
      await detail.expectStatus(status);
      await detail.statusMenu.click();
      expect(await itemLabels(page), status).toEqual(labels);
      // No second, repeated label: the target status is the tooltip only.
      await expect(page.locator('.im-pop .im-hint'), status).toHaveCount(0);
      const first = page.locator('.im-pop [role=menuitemradio]').first();
      await expect(first, status).toHaveAttribute('title', /\S/);
      const cancel = page.locator('[data-option="CANCEL"]');
      if (labels.includes('Cancel task')) {
        await expect(cancel).toHaveClass(/im-danger/);
        await expect(cancel).toHaveClass(/im-sep/);
        const items = page.locator('.im-pop [role=menuitemradio]');
        await expect(items.last(), `${status}: Cancel task is last`).toHaveAttribute(
          'data-option',
          'CANCEL',
        );
        const top = await cancel.evaluate((el) => getComputedStyle(el).borderTopWidth);
        expect(top, `${status}: divider`).toBe('1px');
      } else {
        await expect(cancel).toHaveCount(0);
      }
      await page.keyboard.press('Escape');
    }
    await detail.open(fresh.taskId);
    await detail.statusMenu.click();
    await shot(page, 'status-menu-new-1366x768');
  });

  test('keyboard only: the menu opens with Enter, Arrow keys move, Escape closes and focus returns; Cancel task is reached last', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Keys ${uid()}` });
    await new TaskApi(admin, task.taskId).start();
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await detail.statusMenu.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.im-pop')).toBeVisible();
    await expect(page.locator('[data-option="HOLD"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-option="COMPLETE"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-option="CANCEL"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await expect(detail.statusMenu).toBeFocused();
  });

  for (const size of SIZES) {
    test(`axe and no sideways scroll with the status menu open at ${size.name}`, async ({
      page,
      seed,
      admin,
    }) => {
      const world = await seed.world({ stepCount: 2 });
      const task = await seed.task(world, { title: `Menu ${uid()}` });
      await new TaskApi(admin, task.taskId).start();
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await detail.statusMenu.click();
      await expect(page.locator('.im-pop')).toBeVisible();
      await shot(page, `status-menu-${size.name}`);
      await checkPage(page, `status menu ${size.name}`);
    });
  }

  test('the same vocabulary in the work lists: My Work shows one label per item and Cancel task last', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `t4l-${token}`);
    const world = await seed.world({ stepCount: 2 });
    await seed.task(world, { title: `Mine ${token}`, assignedUserId: me.userId });
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await myWork
      .row(`Mine ${token}`)
      .getByRole('button', { name: /change status of/ })
      .click();
    expect(await itemLabels(page)).toEqual(expect.arrayContaining(['Put on hold', 'Cancel task']));
    await expect(page.locator('.im-pop .im-hint')).toHaveCount(0);
    await expect(page.locator('.im-pop [role=menuitemradio]').last()).toHaveAttribute(
      'data-option',
      'CANCEL',
    );
  });
});

test.describe('T4: Complete readiness (M2, #304)', () => {
  async function blockedTask(seed: import('../support/seed').Seeder, token: string) {
    const world = await seed.world({
      steps: [
        { title: 'Plain' },
        { title: 'Needs input A', requiredInput: true },
        { title: 'Needs input B', requiredInput: true },
      ],
    });
    const task = await seed.task(world, { title: `Blocked ${token}` });
    return { world, task };
  }

  test('Complete stays enabled and says "2 steps need information"; the dialog lists the steps and "Go to first step" opens and focuses the first one', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const { world, task } = await blockedTask(seed, token);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Workflow');

    const button = detail.completeTaskButton;
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute('title', '2 steps need information');
    await expect(page.locator('#wf-complete-note')).toHaveText('2 steps need information');
    await expect(button).toHaveAttribute('aria-describedby', 'wf-complete-note');

    // The status menu's Complete is not disabled either, and carries the same hint for assistive technology.
    await detail.statusMenu.click();
    const item = page.locator('[data-option="COMPLETE"]');
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    const describedBy = await item.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('2 steps need information');
    await shot(page, 'complete-hint-menu-1366x768');
    await page.keyboard.press('Escape');

    await button.click();
    const dialog = detail.dialog;
    await expect(dialog).toContainText('Steps need information first');
    await expect(dialog.locator('[data-blocked-steps] li')).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: 'Complete all steps and finish' })).toHaveCount(
      0,
    );
    await shot(page, 'complete-blocked-dialog-1366x768');
    await dialog.getByRole('button', { name: 'Go to first step' }).click();

    await expect(dialog).toBeHidden();
    const first = detail.step(world.workflow.stepTitles[1]);
    await expect(first.toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(first.toggle).toBeFocused();
    await expect(first.toggle).toBeInViewport();
    // Going to the step changes nothing: no step or task state moved.
    expect(await new TaskApi(admin, task.taskId).stepStatuses()).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
    await detail.expectStatus('New');
  });

  test('keyboard only: Tab to Complete, Enter, the dialog takes focus, Enter on "Go to first step" lands on the step; Escape closes the dialog and focus returns to Complete', async ({
    page,
    seed,
  }) => {
    const { world, task } = await blockedTask(seed, uid());
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Workflow');

    await detail.completeTaskButton.focus();
    await page.keyboard.press('Enter');
    await expect(detail.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail.dialog).toBeHidden();
    await expect(detail.completeTaskButton).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(detail.dialog).toBeVisible();
    await detail.dialog.getByRole('button', { name: 'Go to first step' }).focus();
    await page.keyboard.press('Enter');
    await expect(detail.step(world.workflow.stepTitles[1]).toggle).toBeFocused();
  });

  test('a ready task goes straight to the confirmation, worded "Complete all steps and finish"; no hint is shown', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 3 });
    const task = await seed.task(world, { title: `Ready ${uid()}` });
    await new TaskApi(admin, task.taskId).completeSteps(1);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Workflow');
    await expect(detail.completeTaskButton).not.toHaveAttribute('title', /.+/);
    await expect(page.locator('#wf-complete-note')).not.toContainText('need information');

    await detail.chooseAction('COMPLETE');
    await expect(detail.dialog.locator('[data-bulk-body]')).toBeVisible();
    await shot(page, 'complete-ready-dialog-1366x768');
    await detail.dialog.getByRole('button', { name: 'Complete all steps and finish' }).click();
    await expect(detail.dialog).toBeHidden();
    await detail.expectStatus('Completed');
  });

  test('a task with no steps that need information (all resolved) completes in one click', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 1 });
    const task = await seed.task(world, { title: `One ${uid()}` });
    await new TaskApi(admin, task.taskId).completeSteps(1);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.chooseAction('COMPLETE');
    await detail.expectStatus('Completed');
  });

  for (const size of SIZES) {
    test(`axe and no sideways scroll with the blocked Complete dialog open at ${size.name}`, async ({
      page,
      seed,
    }) => {
      const { task } = await blockedTask(seed, uid());
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await detail.statusMenu.click();
      await page.locator('[data-option="COMPLETE"]').click();
      await expect(detail.dialog).toContainText('Steps need information first');
      await shot(page, `complete-blocked-dialog-${size.name}`);
      await checkPage(page, `blocked Complete dialog ${size.name}`);
    });
  }

  test('from a list (My Work), a task whose status flow cannot decide ahead opens the Task at the step', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `t4m-${token}`);
    const { task } = await blockedTask(seed, token);
    await new TaskApi(admin, task.taskId).assign(me.userId);
    const page = await asUser(me.username);
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await myWork
      .row(`Blocked ${token}`)
      .getByRole('button', { name: /change status of/ })
      .click();
    await expect(page.locator('[data-option="COMPLETE"]')).toContainText('needs step inputs');
    await page.locator('[data-option="COMPLETE"]').click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}\\?tab=workflow&step=\\d+`));
  });
});

test.describe('T4: dialog wording (M3, #305)', () => {
  test('Put on hold: "Close" dismisses, the field is "Reason", the empty error is shown; Cancel task keeps "Keep task" and "Reason"', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Words ${uid()}` });
    await new TaskApi(admin, task.taskId).start();
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await detail.chooseAction('HOLD');
    const dialog = detail.dialog;
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: /^Reason/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Put on hold' }).click();
    await expect(dialog.locator('[data-reason-error]')).toHaveText(
      'Add a reason for putting this task on hold.',
    );
    await shot(page, 'dialog-hold-error-1366x768');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await detail.expectStatus('In Progress');
    await expect(detail.statusMenu).toBeFocused();

    await detail.chooseAction('CANCEL');
    await expect(dialog.getByRole('button', { name: 'Keep task' })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Reason/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel task' }).click();
    await expect(dialog.locator('[data-reason-error]')).toHaveText(
      "Add a reason explaining why you're cancelling.",
    );
    await shot(page, 'dialog-cancel-error-1366x768');
    await dialog.getByRole('button', { name: 'Keep task' }).click();
    await expect(dialog).toBeHidden();
    await detail.expectStatus('In Progress');
  });

  test('keyboard only: Put on hold with a reason, then Resume, without the mouse', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Hold ${uid()}` });
    await new TaskApi(admin, task.taskId).start();
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await detail.statusMenu.focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-option="HOLD"]').press('Enter');
    await expect(detail.dialog).toBeVisible();
    await detail.dialog.getByRole('textbox', { name: /^Reason/ }).fill('Waiting for the vendor');
    await detail.dialog.getByRole('button', { name: 'Put on hold' }).press('Enter');
    await expect(detail.dialog).toBeHidden();
    await detail.expectStatus('On Hold');
    await expect(detail.statusMenu).toBeFocused();

    await page.keyboard.press('Enter');
    await page.locator('[data-option="RESUME"]').press('Enter');
    await detail.expectStatus('In Progress');
  });

  test('Reopen keeps its wording: "No reason is needed"', async ({ page, seed, admin }) => {
    const world = await seed.world({ stepCount: 1 });
    const task = await seed.task(world, { title: `Reopen ${uid()}` });
    await new TaskApi(admin, task.taskId).cancel('Not needed');
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.chooseAction('REOPEN');
    await expect(detail.dialog.locator('[data-reopen-body]')).toContainText('No reason is needed');
    await expect(detail.dialog.getByRole('button', { name: 'Keep' })).toBeVisible();
    await detail.dialog.getByRole('button', { name: 'Reopen' }).click();
    await detail.expectStatus('In Progress');
  });

  for (const size of SIZES) {
    test(`axe and no sideways scroll with the Put on hold and Cancel task dialogs open at ${size.name}`, async ({
      page,
      seed,
      admin,
    }) => {
      const world = await seed.world({ stepCount: 2 });
      const task = await seed.task(world, { title: `Dlg ${uid()}` });
      await new TaskApi(admin, task.taskId).start();
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);

      await detail.chooseAction('HOLD');
      await expect(detail.dialog).toBeVisible();
      await detail.dialog.getByRole('button', { name: 'Put on hold' }).click();
      await shot(page, `dialog-hold-${size.name}`);
      await checkPage(page, `hold dialog ${size.name}`);
      await detail.dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(detail.dialog).toBeHidden();

      await detail.chooseAction('CANCEL');
      await expect(detail.dialog).toBeVisible();
      await shot(page, `dialog-cancel-${size.name}`);
      await checkPage(page, `cancel dialog ${size.name}`);
    });
  }
});

test.describe('T4: assignee menu (M4, #306)', () => {
  test('System Admin: "Assign to me" is the first item, the Pod members show their open load, one click assigns and focus returns to the Assignee control', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const colleague = await seed.user(['Data Technician'], `t4c-${token}`);
    const busy = await seed.user(['Data Technician'], `t4b-${token}`);
    // The admin is not put in the Pod: a Pod membership would change the Dashboard scope of every later test as that user.
    const me = (await admin.get<{ userId: number }>('/api/v1/me')).userId;
    const pod = await seed.pod(`T4 Pod ${token}`, [colleague.userId, busy.userId]);
    const world = await seed.world({ stepCount: 2 });
    // The colleague holds two open tasks in the Pod; the other member none.
    for (let i = 0; i < 2; i++) {
      await seed.task(world, {
        title: `Load ${i} ${token}`,
        assignedPodId: pod.podId,
        assignedUserId: colleague.userId,
      });
    }
    const task = await seed.task(world, { title: `Target ${token}`, assignedPodId: pod.podId });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const trigger = assigneeTrigger(page);
    await trigger.click();
    const pop = page.locator('.im-pop');
    await expect(pop).toBeVisible();
    const lead = pop.locator('[data-lead]');
    await expect(lead).toHaveText('Assign to me');
    await expect(lead).toHaveAccessibleName(`Assign ${task.taskNumber} to me`);
    // First in the menu: above the search box and the people.
    expect(
      await pop.evaluate(
        (el) => (el.firstElementChild as HTMLElement).dataset['lead'] !== undefined,
      ),
    ).toBe(true);
    await expect(pop.locator(`[data-option="${colleague.userId}"] .im-hint`)).toHaveText('2 open');
    await expect(pop.locator(`[data-option="${busy.userId}"] .im-hint`)).toHaveText('0 open');
    await shot(page, 'assignee-menu-load-1366x768');

    await lead.click();
    await expect(page.locator('[data-undo-message]')).toContainText('Assigned to you.');
    await expect(trigger).toBeFocused();
    expect((await new TaskApi(admin, task.taskId).get()).assignedUser.userId).toBe(me);

    // Already the assignee: the item is gone.
    await trigger.click();
    await expect(page.locator('.im-pop')).toBeVisible();
    await expect(page.locator('.im-pop [data-lead]')).toHaveCount(0);
  });

  test('assignee Data Technician: the item takes the task over from a colleague; keyboard only (Enter, Enter) and no item once it is theirs', async ({
    seed,
    asUser,
    admin,
  }) => {
    const token = uid();
    const tech = await seed.user(['Data Technician'], `t4t-${token}`);
    const other = await seed.user(['Data Technician'], `t4o-${token}`);
    const pod = await seed.pod(`T4 Pod ${token}`, [tech.userId, other.userId]);
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, {
      title: `Take over ${token}`,
      assignedPodId: pod.podId,
      assignedUserId: other.userId,
    });
    const page = await asUser(tech.username);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const trigger = assigneeTrigger(page);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const lead = page.locator('.im-pop [data-lead]');
    await expect(lead).toBeVisible();
    await lead.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-undo-message]')).toContainText('Assigned to you.');
    await expect(trigger).toBeFocused();
    expect((await new TaskApi(admin, task.taskId).get()).assignedUser.userId).toBe(tech.userId);

    await page.keyboard.press('Enter');
    await expect(page.locator('.im-pop')).toBeVisible();
    await expect(page.locator('.im-pop [data-lead]')).toHaveCount(0);
  });

  test('Task.View only (no Asset.View, Matter.View, Client.View): no menus, no Complete, no "Assign to me"; no Task.View: the page is refused', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Viewer ${token}` });
    const viewRole = await seed.role(['Task.View'], `E2E T4 viewer ${token}`);
    const viewer = await seed.user([viewRole.name], `t4v-${token}`);
    const none = await seed.role(['Matter.View'], `E2E T4 none ${token}`);
    const nobody = await seed.user([none.name], `t4n-${token}`);

    const page = await asUser(viewer.username);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(page.locator('[data-view-only]')).toBeVisible();
    await expect(page.locator('[data-task-header] [data-inline-trigger]')).toHaveCount(0);
    await expect(detail.completeTaskButton).toHaveCount(0);
    await expect(page.locator('[data-lead]')).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    await checkPage(page, 'Task.View only 375');

    const denied = await asUser(nobody.username);
    await denied.goto(`/tasks/${task.taskId}`);
    await expect(denied.locator('[data-task-header]')).toHaveCount(0);
    await expect(denied.getByRole('heading', { level: 1 })).toBeVisible();
  });

  for (const size of SIZES) {
    test(`axe and no sideways scroll with the assignee menu open at ${size.name}`, async ({
      page,
      seed,
    }) => {
      const token = uid();
      const colleague = await seed.user(['Data Technician'], `t4a-${token}`);
      const pod = await seed.pod(`T4 Pod ${token}`, [colleague.userId]);
      const world = await seed.world({ stepCount: 2 });
      const task = await seed.task(world, { title: `Axe ${token}`, assignedPodId: pod.podId });
      await page.setViewportSize({ width: size.width, height: size.height });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await assigneeTrigger(page).click();
      await expect(page.locator('.im-pop [data-lead]')).toBeVisible();
      await expect(page.locator('.im-pop .im-hint').first()).toBeVisible();
      await shot(page, `assignee-menu-${size.name}`);
      await checkPage(page, `assignee menu ${size.name}`);
    });
  }
});
