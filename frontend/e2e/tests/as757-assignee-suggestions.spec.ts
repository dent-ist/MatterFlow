import { Locator, Page } from '@playwright/test';
import { CreateTaskPage } from '../pages/create-task.page';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { axeAvailable, axeViolations } from '../support/axe';
import { SIZES, noHorizontalScroll } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assignee picker (#757): the inline picker, the Edit task dialog and Create task share one rule. A task in a Pod lists the Pod's members by
 * load with "Search all users"; a task without a Pod lists the Suggested people (available, fewest open tasks first) and searches all
 * eligible users (25 shown). The order comes from the server, so these checks read the counts the pickers show, not fixed positions: the
 * stack is shared with other specs, so other people with no tasks may also be in the Suggested list.
 */
const assigneeTrigger = (page: Page): Locator =>
  page.locator('[data-task-header] [data-assignee] [data-inline-trigger]');

/** The open-task counts shown in the open inline menu, in order. */
async function shownCounts(pop: Locator): Promise<number[]> {
  const hints = await pop.locator('[data-option] .im-hint').allTextContents();
  return hints.map((h) => Number(h.replace(/\D/g, '')));
}

/** axe (WCAG 2.2 AA) over the page with the list open, and no sideways scroll. */
async function checkPage(page: Page, label: string): Promise<void> {
  expect(axeAvailable(), 'axe must really run').toBe(true);
  expect(await axeViolations(page), `axe: ${label}`).toEqual([]);
  await noHorizontalScroll(page);
}

async function openEdit(page: Page): Promise<void> {
  const edit = page.locator('[data-task-header] [data-action="edit"]');
  if (await edit.isVisible()) await edit.click();
  else {
    await page.locator('[data-overflow]').click();
    await page.getByRole('menuitem', { name: /^Edit/ }).click();
  }
  await expect(page.locator('#td-title')).toBeFocused();
  await page.locator('[data-when-toggle]').click();
}

test.describe('#757: assignee picker suggestions', () => {
  test('no Pod: the inline picker opens on Suggested (counts, no unavailable people) and searching finds the out-of-office person greyed with the return date', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const busy = await seed.user(['Data Technician'], `as-busy-${token}`);
    const away = await seed.user(['Data Technician'], `as-away-${token}`);
    await seed.outOfOffice(away.userId, { until: '2099-10-20' });
    const world = await seed.world({ stepCount: 2 });
    for (let i = 0; i < 3; i++)
      await seed.task(world, { title: `Load ${i} ${token}`, assignedUserId: busy.userId });
    const task = await seed.task(world, { title: `Target ${token}` });
    await new TaskDetailPage(page).open(task.taskId);

    await assigneeTrigger(page).click();
    const pop = page.locator('.im-pop');
    await expect(pop.locator('[data-menu-group]')).toHaveText('Suggested');
    await expect(pop.locator('[data-option]').first()).toBeVisible();
    const options = await pop.locator('[data-option]').count();
    expect(options).toBeLessThanOrEqual(6);
    const counts = await shownCounts(pop);
    expect(counts.length).toBe(options);
    expect(counts, 'fewest open tasks first').toEqual([...counts].sort((a, b) => a - b));
    // Out-of-office people are not suggested.
    await expect(pop.locator(`[data-option="${away.userId}"]`)).toHaveCount(0);

    // Search covers everyone eligible: the busy person with the count, the absent one flagged with the return date.
    const search = pop.getByRole('textbox', { name: 'Search people' });
    await search.fill(`as-busy-${token}`);
    await expect(pop.locator(`[data-option="${busy.userId}"] .im-hint`)).toHaveText('3 open');
    await expect(pop.locator('[data-menu-group]')).toHaveCount(0);
    await search.fill(`as-away-${token}`);
    await expect(pop.locator(`[data-option="${away.userId}"] [data-option-flag]`)).toContainText(
      'Out of office until Oct 20, 2099',
    );
    // Still selectable.
    await pop.locator(`[data-option="${away.userId}"]`).click();
    await expect(page.locator('[data-undo-message]')).toBeVisible();
    expect(
      (await admin.get<{ assignedUser: { userId: number } }>(`/api/v1/tasks/${task.taskId}`))
        .assignedUser.userId,
    ).toBe(away.userId);
  });

  test('Pod: members by load with their counts and an out-of-office marker, then "Search all users" reaches an outsider', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const loaded = await seed.user(['Data Technician'], `as-loaded-${token}`);
    const free = await seed.user(['Data Technician'], `as-free-${token}`);
    const away = await seed.user(['Data Technician'], `as-pa-${token}`);
    const outsider = await seed.user(['Data Technician'], `as-outsider-${token}`);
    await seed.outOfOffice(away.userId, { until: '2099-10-20' });
    const pod = await seed.pod(`AS Pod ${token}`, [loaded.userId, free.userId, away.userId]);
    const world = await seed.world({ stepCount: 2 });
    for (let i = 0; i < 2; i++)
      await seed.task(world, {
        title: `PodLoad ${i} ${token}`,
        assignedPodId: pod.podId,
        assignedUserId: loaded.userId,
      });
    const task = await seed.task(world, { title: `PodTarget ${token}`, assignedPodId: pod.podId });
    await new TaskDetailPage(page).open(task.taskId);

    await assigneeTrigger(page).click();
    const pop = page.locator('.im-pop');
    // The list is read from the server after the menu opens: wait for this test's own members (and their counts) before reading it.
    for (const member of [loaded, free, away]) {
      await expect(pop.locator(`[data-option="${member.userId}"] .im-hint`)).toBeVisible();
    }
    const ids = await pop
      .locator('[data-option]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-option')));
    expect(ids, 'only the Pod members').toEqual(
      expect.arrayContaining([String(loaded.userId), String(free.userId), String(away.userId)]),
    );
    expect(ids).not.toContain(String(outsider.userId));
    // Fewest open first: the loaded member (2 open) is after the two with none.
    expect(ids.indexOf(String(loaded.userId))).toBeGreaterThan(ids.indexOf(String(free.userId)));
    expect(ids.indexOf(String(loaded.userId))).toBeGreaterThan(ids.indexOf(String(away.userId)));
    await expect(pop.locator(`[data-option="${loaded.userId}"] .im-hint`)).toHaveText('2 open');
    await expect(pop.locator(`[data-option="${free.userId}"] .im-hint`)).toHaveText('0 open');
    await expect(pop.locator(`[data-option="${away.userId}"] [data-option-flag]`)).toContainText(
      'Out of office',
    );
    await expect(pop.locator('[data-menu-note]')).toContainText('members of AS Pod');

    await pop.getByRole('button', { name: 'Search all users' }).click();
    await expect(pop.getByRole('textbox', { name: 'Search people' })).toBeFocused();
    await expect(pop.locator('[data-menu-group]')).toHaveText('Suggested');
    await pop.getByRole('textbox', { name: 'Search people' }).fill(`as-outsider-${token}`);
    await expect(pop.locator(`[data-option="${outsider.userId}"]`)).toBeVisible();
  });

  test('typing finds users beyond the first 8 ("User 1" case): a dozen people with one name stem are all listed, and the list scrolls', async ({
    page,
    seed,
    personas,
  }) => {
    const token = uid();
    const stem = `Zq${token} Person`;
    for (let i = 1; i <= 12; i++)
      await personas.create({
        label: `as-many-${i}`,
        roles: ['Data Technician'],
        displayName: `${stem} ${String(i).padStart(2, '0')}`,
      });
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Many ${token}` });
    await new TaskDetailPage(page).open(task.taskId);

    await assigneeTrigger(page).click();
    const pop = page.locator('.im-pop');
    await pop.getByRole('textbox', { name: 'Search people' }).fill(stem);
    await expect(pop.locator('[data-option]')).toHaveCount(12);
    // The list scrolls inside the menu when it is taller than the space.
    const scrolls = await pop.evaluate((el) => el.scrollHeight >= el.clientHeight);
    expect(scrolls).toBe(true);
    await pop.getByRole('textbox', { name: 'Search people' }).fill(`${stem} 12`);
    await expect(pop.locator('[data-option]')).toHaveCount(1);
  });

  test('Edit task: a Pod task lists its members first; "Search all users" and typing reach everyone; the choice is saved', async ({
    page,
    seed,
    admin,
  }) => {
    const token = uid();
    const member = await seed.user(['Data Technician'], `as-em-${token}`);
    const other = await seed.user(['Data Technician'], `as-eo-${token}`);
    const pod = await seed.pod(`AS Edit Pod ${token}`, [member.userId]);
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world, { title: `Edit ${token}`, assignedPodId: pod.podId });
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskDetailPage(page).open(task.taskId);
    await openEdit(page);

    const box = page.getByRole('combobox', { name: 'Assignee', exact: true });
    await box.focus();
    const list = page.locator('[data-assignee-list]');
    await expect(
      list.getByRole('option', { name: new RegExp(`e2e-as-em-${token}`) }),
    ).toBeVisible();
    await expect(list.getByRole('option', { name: new RegExp(`e2e-as-eo-${token}`) })).toHaveCount(
      0,
    );
    await expect(list.getByRole('option', { name: 'Search all users' })).toBeVisible();
    await list.getByRole('option', { name: 'Search all users' }).click();
    await expect(page.locator('[data-assignee-heading]')).toHaveText('Suggested');

    await box.fill(`as-eo-${token}`);
    const option = list.getByRole('option', { name: new RegExp(`e2e-as-eo-${token}`) });
    await expect(option).toBeVisible();
    await expect(option).toContainText('0 open');
    await option.click();
    await expect(page.locator('[data-chosen]')).toContainText(`e2e-as-eo-${token}`);
    await expect(page.locator('[data-pod-warning]')).toBeVisible(); // not in the Pod: warned, not blocked
    await page.locator('[data-save]').click();
    await expect(page.locator('#td-title')).toHaveCount(0);
    const saved = await admin.get<{
      assignedUser: { userId: number };
      assignedPod: { podId: number };
    }>(`/api/v1/tasks/${task.taskId}`);
    expect(saved.assignedUser.userId).toBe(other.userId);
    expect(saved.assignedPod.podId).toBe(pod.podId);
  });

  test('Create task: without a Pod the field opens on Suggested with counts, with the keyboard only', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const busy = await seed.user(['Data Technician'], `as-cb-${token}`);
    const world = await seed.world({ stepCount: 2 });
    for (let i = 0; i < 2; i++)
      await seed.task(world, { title: `CLoad ${i} ${token}`, assignedUserId: busy.userId });
    const create = new CreateTaskPage(page);
    await create.open(`?taskType=${world.taskType.id}`);
    await create.openWhen();

    await create.assignee.focus();
    await expect(page.locator('[data-assignee-heading]')).toHaveText('Suggested');
    const hints = await page.locator('[data-assignee-list] [data-option-hint]').allTextContents();
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.length).toBeLessThanOrEqual(6);
    const counts = hints.map((h) => Number(h.replace(/\D/g, '')));
    expect(counts).toEqual([...counts].sort((a, b) => a - b));

    await create.assignee.fill(`as-cb-${token}`);
    await expect(page.locator('[data-assignee-list] [role=option]')).toHaveCount(1);
    await expect(page.locator('[data-assignee-list] [data-option-hint]')).toHaveText('2 open');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-chosen]')).toContainText(`e2e-as-cb-${token}`);
  });

  test('axe finds nothing at the four sizes with the inline picker, the Edit task list and the Create task list open', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const member = await seed.user(['Data Technician'], `as-ax-${token}`);
    const pod = await seed.pod(`AS Axe Pod ${token}`, [member.userId]);
    const world = await seed.world({ stepCount: 2 });
    const podTask = await seed.task(world, { title: `Axe pod ${token}`, assignedPodId: pod.podId });
    const plainTask = await seed.task(world, { title: `Axe plain ${token}` });

    // A resize closes an open menu, so each size opens its own.
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const label = `${size.width}x${size.height}`;

      await new TaskDetailPage(page).open(plainTask.taskId);
      await assigneeTrigger(page).click();
      await expect(page.locator('.im-pop [data-menu-group]')).toHaveText('Suggested');
      await checkPage(page, `inline Suggested at ${label}`);

      await new TaskDetailPage(page).open(podTask.taskId);
      await assigneeTrigger(page).click();
      await expect(page.locator('.im-pop [data-foot-action]')).toBeVisible();
      await checkPage(page, `inline Pod at ${label}`);

      await openEdit(page);
      await page.getByRole('combobox', { name: 'Assignee', exact: true }).focus();
      await expect(page.locator('[data-assignee-list]')).toBeVisible();
      await checkPage(page, `Edit task list at ${label}`);
      await page.locator('[data-cancel]').click();
    }
  });
});
