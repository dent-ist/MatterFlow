import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { TaskApi } from '../support/tasks';

const FIVE_STEPS = [
  { title: 'Intake' },
  { title: 'Validate' },
  { title: 'Load' },
  { title: 'Report' },
  { title: 'Handover' },
];

/** The Task page is one page: Workflow and Comments on the left, Details and Assets in the side panel (docs/ux/task-detail). */
test.describe('Task detail: single page layout', () => {
  const noHorizontalScroll = async (page: Page): Promise<void> => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  };

  test('1280 px: Workflow and Comments in the main column, Details and Assets in the side panel, no tabs', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1280, height: 900 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(task.title);
    await expect(
      page.getByRole('heading', { level: 2, name: /^(Workflow|Comments|Details|Assets)/ }),
    ).toHaveText([/Workflow/, /Comments/, /Details/, /Assets/]);

    const aside = page.getByRole('complementary', { name: 'Details' });
    await expect(aside).toBeVisible();
    await expect(aside.locator('[data-section="assets"]')).toBeVisible();
    await expect(aside.getByRole('button', { name: 'Edit details' })).toBeVisible();

    const workflow = await detail.section('Workflow').boundingBox();
    const comments = await detail.section('Comments').boundingBox();
    const side = await aside.boundingBox();
    expect(side!.x).toBeGreaterThan(workflow!.x + workflow!.width - 1);
    expect(side!.width).toBeGreaterThan(330);
    expect(side!.width).toBeLessThan(350);
    expect(comments!.y).toBeGreaterThan(workflow!.y);
    await expect(page.getByRole('navigation', { name: 'Jump to' })).toBeHidden();

    // The side panel stays in view while the page scrolls.
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => (await aside.boundingBox())!.y).toBeLessThan(120);
    await noHorizontalScroll(page);
  });

  test('only the current step is expanded; resolving it folds it and opens the next one', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const [intake, validate, load] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    await api.completeSteps(1);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Workflow');

    await expect(detail.step(intake).toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(detail.step(intake).state).toHaveText('Completed');
    await expect(detail.step(validate).toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.step(load).toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-step-id] .step__body')).toHaveCount(1);

    // Any step can be opened by hand, and stays open next to the current one.
    await detail.step(load).toggle.click();
    await expect(detail.step(load).toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.step(validate).toggle).toHaveAttribute('aria-expanded', 'true');

    await detail.step(validate).completeButton.click();
    await expect(detail.step(validate).state).toHaveText('Completed');
    await expect(detail.step(validate).toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(detail.step(load).root.locator('[data-current]')).toBeVisible();
  });

  test('375 px: Details (collapsed), Workflow, Comments, Assets in one column with a Jump to row and no sideways scroll', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const task = await seed.task(world);
    await page.setViewportSize({ width: 375, height: 800 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const toggle = page.getByRole('button', { name: 'Details', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeHidden();
    await noHorizontalScroll(page);

    const y = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y;
    const details = await y(page.getByRole('complementary', { name: 'Details' }));
    const workflow = await y(detail.section('Workflow'));
    const comments = await y(detail.section('Comments'));
    const assets = await y(detail.section('Assets'));
    expect(details).toBeLessThan(workflow);
    expect(workflow).toBeLessThan(comments);
    expect(comments).toBeLessThan(assets);

    const jump = page.getByRole('navigation', { name: 'Jump to' });
    await expect(jump.getByRole('link')).toHaveText(['Workflow', 'Comments', 'Assets']);
    await jump.getByRole('link', { name: 'Assets' }).click();
    await expect(detail.section('Assets').locator('[data-section-heading]')).toBeFocused();
    await jump.getByRole('link', { name: 'Comments' }).click();
    await expect(detail.section('Comments').locator('[data-section-heading]')).toBeFocused();
    await noHorizontalScroll(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 768, height: 1024 });
    await noHorizontalScroll(page);
  });

  test('old ?tab= links: sections take focus, activity opens the drawer, details just shows the page', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);

    const sections = { workflow: 'Workflow', comments: 'Comments', assets: 'Assets' } as const;
    for (const [param, name] of Object.entries(sections)) {
      await page.goto(`/tasks/${task.taskId}?tab=${param}`);
      await expect(detail.header).toBeVisible();
      await expect(detail.section(name).locator('[data-section-heading]')).toBeFocused();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }

    await page.goto(`/tasks/${task.taskId}?tab=details`);
    await expect(detail.header).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto(`/tasks/${task.taskId}?tab=activity`);
    const drawer = page.getByRole('dialog', { name: /^Activity: / });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('region', { name: 'Activity' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/tab=activity/);
  });

  test('the step deep link ?step= opens that step and focuses it', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const [, , load] = world.workflow.stepTitles;
    const task = await seed.task(world);
    const target = await new TaskApi(admin, task.taskId).step(3);
    const detail = new TaskDetailPage(page);
    await page.goto(`/tasks/${task.taskId}?step=${target.stepInstanceId}`);
    await expect(detail.step(load).toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.step(load).toggle).toBeFocused();
  });

  test('Activity button opens the drawer; Esc returns focus to the button', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1280, height: 900 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const button = detail.header.getByRole('button', { name: 'Activity' });
    await button.click();
    const drawer = page.getByRole('dialog', { name: `Activity: ${task.taskNumber} ${task.title}` });
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    expect(box!.x + box!.width).toBeGreaterThan(1270);
    await expect(drawer.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('Edit details in the side panel opens the form in a dialog and saves back to the same page', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1280, height: 900 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const open = page.getByRole('button', { name: 'Edit details' });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Edit task details' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Requestor name (required)').fill('Rita Panel');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}$`));
    await expect(detail.detailsPanel).toContainText('Rita Panel');
    await expect(open).toBeFocused();
  });

  test('a person without Asset.View sees a note in the Assets section instead of a gap', async ({
    seed,
    asUser,
  }) => {
    const role = await seed.role(['Task.View', 'Matter.View', 'Client.View'], 'E2E no assets');
    const user = await seed.user([role.name], 'noassets');
    const world = await seed.world();
    const task = await seed.task(world);
    const page = await asUser(user.username);
    await page.setViewportSize({ width: 1280, height: 900 });

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.section('Assets')).toContainText("don't have permission to view assets");
    await expect(page.locator('[data-view-only]')).toContainText('View only');
  });
});
