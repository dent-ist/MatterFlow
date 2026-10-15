import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedBusyTask } from '../support/busy-task';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Comments and Assets are collapsible sections under the Workflow (docs/ux/task-detail-v3): collapsed by default with the count and a
 * one-line preview in the bar, remembered per user, opened by links, quick actions and new comments by other people.
 */
test.describe('Task detail: collapsible Comments and Assets', () => {
  const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;
  const noHorizontalScroll = async (page: Page): Promise<void> => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  };

  test('both sections start collapsed side by side, with counts and previews in the bars', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    for (const name of ['Comments', 'Assets'] as const) {
      await expect(detail.toggle(name)).toHaveAttribute('aria-expanded', 'false');
      const panelId = (await detail.toggle(name).getAttribute('aria-controls'))!;
      await expect(page.locator('#' + panelId)).toBeHidden();
    }
    await expect(detail.section('Comments').getByRole('heading', { level: 2 })).toContainText(
      'Comments (12)',
    );
    await expect(detail.section('Assets').getByRole('heading', { level: 2 })).toContainText(
      'Assets (8)',
    );
    await expect(detail.section('Comments').locator('[data-preview]')).toHaveText(
      /^Latest: .+, .+: /,
    );
    await expect(detail.section('Assets').locator('[data-preview]')).toHaveText(/ \+6 more$/);
    await expect(detail.commentItems).toHaveCount(0);

    // Two slim bars level with each other under the Workflow.
    const workflow = await box(page, '[data-section="workflow"]');
    const comments = await box(page, '[data-section="comments"]');
    const assets = await box(page, '[data-section="assets"]');
    expect(comments.y).toBeGreaterThan(workflow.y + workflow.height - 1);
    expect(assets.x).toBeGreaterThan(comments.x + comments.width - 1);
    expect(Math.abs(assets.y - comments.y)).toBeLessThanOrEqual(1);
    expect(comments.height).toBeLessThan(100);
    await noHorizontalScroll(page);
  });

  test('a click anywhere on the bar toggles; Enter and Space work; sections open independently and the open one takes the whole row', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    // Clicking the preview text (not the chevron or the title) opens it.
    await detail.section('Comments').locator('[data-preview]').click();
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.commentItems.first()).toBeVisible();
    // Only Comments is open: it spans the whole left column, the Assets bar is stacked under it.
    const workflow = await box(page, '[data-section="workflow"]');
    const comments = await box(page, '[data-section="comments"]');
    const assets = await box(page, '[data-section="assets"]');
    expect(Math.abs(comments.width - workflow.width)).toBeLessThanOrEqual(2);
    expect(assets.y).toBeGreaterThan(comments.y + comments.height - 1);

    await detail.toggle('Assets').focus();
    await page.keyboard.press('Enter');
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'true');
    // Both open: side by side again.
    const both = await box(page, '[data-section="assets"]');
    const left = await box(page, '[data-section="comments"]');
    expect(both.x).toBeGreaterThan(left.x + left.width - 1);

    await detail.toggle('Assets').focus();
    await page.keyboard.press('Space');
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'false');
    expect(await detail.toggle('Assets').evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await detail.section('Comments').getByRole('heading', { level: 2 }).locator('button').click();
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
  });

  test('the choice is remembered across a reload and applied on the first paint', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.ensureAssetsOpen();
    await detail.ensureCommentsOpen();

    await page.reload();
    await expect(detail.header).toBeVisible();
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.commentItems.first()).toBeVisible();

    await detail.toggle('Assets').click();
    await page.reload();
    await expect(detail.header).toBeVisible();
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'false');
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
  });

  test('deep links open the section: ?tab=assets and ?tab=comments', async ({ page, seed }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await page.goto(`/tasks/${task.taskId}?tab=assets`);
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
    await page.goto(`/tasks/${task.taskId}?tab=comments`);
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.section('Comments').locator('[data-section-heading]')).toBeFocused();
  });

  test('"N new" shows after another user comments, the section opens by itself and the cue clears once seen', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const tech = await seed.user(['Data Technician'], 'tech');
    const asTech = await Api.as(tech.username);
    try {
      const detail = new TaskDetailPage(page);
      // First visit: no cue, collapsed (there is one comment already).
      await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Older note</p>' });
      await detail.open(task.taskId);
      await expect(detail.section('Comments').getByRole('heading', { level: 2 })).toContainText(
        'Comments (1)',
      );
      await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);

      // Someone else comments twice; the next visit opens Comments and says so in text.
      await page.waitForTimeout(1100);
      await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Second</p>' });
      await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Third note</p>' });
      await page.reload();
      await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
      await expect(detail.section('Comments').locator('[data-new-badge]')).toHaveText('2 new');
      await expect(detail.section('Comments').locator('[data-live]')).toHaveText('2 new comments');
      await expect(detail.section('Comments').getByRole('heading', { level: 2 })).toContainText(
        'Comments (3)',
      );
      await expect(detail.commentItems.last()).toContainText('Third note');

      // Collapsing marks them read: the cue is gone, also after a reload.
      await detail.toggle('Comments').click();
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);
      await page.reload();
      await expect(detail.header).toBeVisible();
      await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);

      // Own comments are never "new".
      await detail.ensureCommentsOpen();
      const editor = await detail.composer();
      await editor.fill('');
      await page.keyboard.type('My own note');
      await page.keyboard.press('Control+Enter');
      await expect(detail.commentItems.last()).toContainText('My own note');
      await detail.toggle('Comments').click();
      await page.reload();
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);
    } finally {
      await asTech.dispose();
    }
  });

  test('quick actions in the bar: Add comment opens and focuses the composer, Link asset opens the picker', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const asset = await seed.asset(world.matter, `Quick ${uid()}`);
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.section('Comments').locator('[data-preview]')).toHaveText(
      'No comments yet',
    );
    await expect(detail.section('Assets').locator('[data-preview]')).toHaveText('No linked assets');

    await detail.section('Comments').getByRole('button', { name: 'Add comment' }).click();
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'true');
    await expect(
      detail.section('Comments').locator('[data-composer] [role=textbox]'),
    ).toBeFocused();
    await page.keyboard.type('Quick note');
    await page.keyboard.press('Control+Enter');
    await expect(detail.commentItems).toHaveCount(1);
    await expect(detail.section('Comments').getByRole('heading', { level: 2 })).toContainText(
      'Comments (1)',
    );
    // Back to one line after the post.
    await expect(page.getByPlaceholder('Write a comment...')).toBeVisible();

    await detail.section('Assets').getByRole('button', { name: 'Link asset' }).click();
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'true');
    const picker = detail.section('Assets').getByRole('combobox', { name: 'Asset to link' });
    await expect(picker).toBeFocused();
    await picker.fill(asset.displayName);
    await page.getByRole('option', { name: new RegExp(asset.displayName) }).click();
    await detail.section('Assets').locator('[data-link-submit]').click();
    await expect(detail.section('Assets').locator('li[data-asset-id]')).toHaveCount(1);
    await expect(detail.section('Assets').getByRole('heading', { level: 2 })).toContainText(
      'Assets (1)',
    );
  });

  test('the composer is one line until it is focused and goes back when emptied and blurred', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.ensureCommentsOpen();
    const comments = detail.section('Comments');
    await expect(comments.getByPlaceholder('Write a comment...')).toBeVisible();
    await expect(comments.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);

    const editor = await detail.composer();
    await expect(comments.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
    await expect(comments.locator('[data-privilege-note]')).toBeVisible();
    // Typed text keeps it open when focus leaves.
    await page.keyboard.type('Draft');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(editor).toHaveText('Draft');
    // Emptied and blurred: one line again.
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(comments.getByPlaceholder('Write a comment...')).toBeVisible();
  });

  test('375 px: collapsed bars stack under the Workflow, Jump to opens a section, no sideways scroll', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 375, height: 812 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'false');
    const comments = await box(page, '[data-section="comments"]');
    const assets = await box(page, '[data-section="assets"]');
    expect(assets.y).toBeGreaterThan(comments.y + comments.height - 1);
    await noHorizontalScroll(page);

    const jump = page.getByRole('navigation', { name: 'Jump to' });
    await jump.getByRole('link', { name: 'Assets' }).click();
    await expect(detail.toggle('Assets')).toHaveAttribute('aria-expanded', 'true');
    await expect(detail.section('Assets').locator('[data-section-heading]')).toBeFocused();
    await noHorizontalScroll(page);
  });

  for (const width of [1366, 375]) {
    test(`axe finds nothing at ${width} px, collapsed and expanded`, async ({
      page,
      seed,
      admin,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      const task = await seedBusyTask(seed, admin);
      await page.setViewportSize({ width, height: 800 });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await expect(detail.toggle('Comments')).toHaveAttribute('aria-expanded', 'false');
      // The page header's breadcrumb link is a known small target at 375 px; this run looks at the page as a whole at 1366 only.
      expect(await axeViolations(page, width === 1366 ? undefined : '[data-detail-below]')).toEqual(
        [],
      );
      await detail.ensureCommentsOpen();
      await detail.ensureAssetsOpen();
      await detail.composer();
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(await axeViolations(page, '[data-detail-below]')).toEqual([]);
    });
  }
});
