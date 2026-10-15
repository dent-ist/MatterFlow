import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { TaskApi } from '../support/tasks';

const comments = (page: Page) => page.getByRole('region', { name: 'Comments' });
const activity = (page: Page) => page.getByRole('region', { name: 'Activity' });

test.describe('Comments and history (SCN-018)', () => {
  test('SCN-018: a rich text comment shows its author, time and formatting', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const panel = comments(page);
    await expect(panel.locator('[data-empty]')).toHaveText('No comments yet.');

    // The composer is one line until it gets focus.
    await expect(panel.getByPlaceholder('Write a comment...')).toBeVisible();
    const editor = await detail.composer();
    await expect(panel.locator('[data-post]')).toBeDisabled();
    await panel.getByRole('button', { name: 'Bold' }).click();
    await page.keyboard.type('Urgent');
    await panel.getByRole('button', { name: 'Bold' }).click();
    await page.keyboard.type(' see the ');
    await panel.getByRole('button', { name: 'Italic' }).click();
    await page.keyboard.type('load file');
    await panel.getByRole('button', { name: 'Italic' }).click();
    await page.keyboard.press('Enter');
    await panel.getByRole('button', { name: 'Bulleted list' }).click();
    await page.keyboard.type('first item');
    await panel.locator('[data-post]').click();

    const comment = panel.locator('[data-comment-id]');
    await expect(comment).toHaveCount(1);
    await expect(comment.locator('.tc__author')).toHaveText('ke\\kekim');
    await expect(comment.locator('time').first()).toHaveAttribute(
      'datetime',
      /^\d{4}-\d{2}-\d{2}T/,
    );
    await expect(comment.locator('[data-body] :is(b, strong)')).toHaveText('Urgent');
    await expect(comment.locator('[data-body] :is(i, em)')).toHaveText('load file');
    await expect(comment.locator('[data-body] li')).toHaveText('first item');
    await expect(panel.getByRole('heading', { name: 'Comments (1)' })).toBeVisible();
    // After a post the composer is one line again.
    await expect(panel.getByPlaceholder('Write a comment...')).toBeVisible();
    await expect(editor).toHaveCount(0);
  });

  test('SCN-018: editing keeps the earlier text in the edit history', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml: '<p>First draft of the note</p>',
    });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const panel = comments(page);

    await panel.locator('[data-edit]').click();
    const editor = panel.getByRole('textbox', { name: 'Edit comment' });
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Final wording of the note');
    await panel.locator('[data-save-edit]').click();

    await expect(panel.locator('[data-body]')).toHaveText('Final wording of the note');
    await expect(panel.locator('[data-edited]')).toContainText('Edited');
    await panel.locator('[data-history-toggle]').click();
    await expect(panel.locator('[data-history]')).toContainText('First draft of the note');
  });

  test('SCN-018: a comment can be deleted after confirming', async ({ page, seed, admin }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml: '<p>Remove me later</p>',
    });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const panel = comments(page);

    await panel.locator('[data-delete]').click();
    await expect(detail.dialog.locator('[data-delete-body]')).toBeVisible();
    await detail.dialog.getByRole('button', { name: 'Keep comment' }).click();
    await expect(panel.locator('[data-comment-id]')).toHaveCount(1);

    await panel.locator('[data-delete]').click();
    await detail.dialog.getByRole('button', { name: 'Delete comment' }).click();
    await expect(panel.locator('[data-empty]')).toBeVisible();
  });

  test('SCN-018: scripts and event handlers in a comment never reach the page', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml:
        '<p onclick="window.__pwned=1">Safe <b>text</b></p><script>window.__pwned=2</script><img src=x onerror="window.__pwned=3">',
    });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    const body = comments(page).locator('[data-body]');
    await expect(body).toContainText('Safe text');
    await expect(body.locator('script, img[onerror], [onclick]')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();
  });

  test('SCN-018: the activity feed lists comments, status and workflow events with who and when', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await seed.world({ stepCount: 2 });
    const task = await seed.task(world);
    const api = new TaskApi(admin, task.taskId);
    await api.start();
    await api.completeSteps(1);
    await admin.post(`/api/v1/tasks/${task.taskId}/comments`, {
      bodyHtml: '<p>Activity check</p>',
    });

    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.openActivity();
    const feed = activity(page);
    await expect(feed.getByRole('listitem').first()).toContainText('ke\\kekim');
    await expect(feed.getByText('Comment added')).toBeVisible();
    await expect(feed.getByText(/created/).first()).toBeVisible();
    await expect(feed.locator('time').first()).toHaveAttribute('datetime', /^\d{4}-/);

    await feed.getByRole('button', { name: 'Comments', exact: true }).click();
    await expect(feed.getByText('Comment added')).toBeVisible();
    await expect(feed.getByText(/created/)).toHaveCount(0);

    await feed.getByRole('button', { name: 'Workflow', exact: true }).click();
    await expect(feed.getByRole('listitem').first()).toContainText(/step/i);
    await expect(feed.getByText('Comment added')).toHaveCount(0);

    await feed.getByRole('button', { name: 'Status', exact: true }).click();
    await expect(feed.getByRole('listitem').first()).toContainText(/In Progress|status/i);
  });
});
