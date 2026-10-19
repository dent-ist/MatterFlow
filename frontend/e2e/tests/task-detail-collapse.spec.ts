import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedBusyTask } from '../support/busy-task';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Comments and Assets used to be collapsible sections under the Workflow (docs/ux/task-detail-v3); since #347 they are tabs next to the
 * Workflow. What is kept: the counts (now on the tab labels, live), the "N new" cue for comments by other people, the one-line composer, the
 * Link asset action and the 60vh scroll areas. What is gone: the bars, previews, the remembered open/closed choice and the stacking.
 */
test.describe('Task detail: Comments and Assets panes in the tabs', () => {
  const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;
  const noHorizontalScroll = async (page: Page): Promise<void> => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  };

  test('the tabs carry the counts; only the Workflow pane is on screen at first; no bars, previews or toggles remain', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(12\)$/);
    await expect(detail.tab('Assets')).toHaveText(/^\s*Assets\s*\(8\)$/);
    await expect(detail.tab('Workflow')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.section('Workflow')).toBeVisible();
    await expect(detail.section('Comments')).toBeHidden();
    await expect(detail.section('Assets')).toBeHidden();
    await expect(detail.commentItems.first()).toBeHidden();
    await expect(page.locator('[data-toggle], [data-preview], [data-add-comment]')).toHaveCount(0);

    // Each pane is as wide as the Workflow pane was, and starts right under the strip.
    const workflow = await box(page, '[data-section="workflow"]');
    for (const name of ['Assets', 'Comments'] as const) {
      await detail.selectTab(name);
      const pane = await box(page, `[data-section="${name.toLowerCase()}"]`);
      expect(Math.abs(pane.width - workflow.width), name).toBeLessThanOrEqual(2);
      expect(Math.abs(pane.y - workflow.y), name).toBeLessThanOrEqual(2);
    }
    await expect(detail.commentItems.first()).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('a click, Enter on the focused tab and the arrows show the panes; nothing is remembered between visits', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    await detail.tab('Comments').click();
    await expect(detail.commentItems.first()).toBeVisible();
    await detail.tab('Assets').focus();
    await page.keyboard.press('Enter');
    await expect(detail.tab('Assets')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.section('Assets').locator('li[data-asset-id]').first()).toBeVisible();
    expect(await detail.tab('Assets').evaluate((el) => el.matches(':focus-visible'))).toBe(true);

    // A reload opens on the Workflow unless the address names a tab: the choice is not remembered, and the old keys are not written.
    await page.goto(`/tasks/${task.taskId}`);
    await expect(detail.tab('Workflow')).toHaveAttribute('aria-selected', 'true');
    expect(
      await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('.open.'))),
    ).toEqual([]);
    // A key left by the old layout is read harmlessly.
    await page.evaluate(() => {
      localStorage.setItem('mf.task-detail.comments.open.1', '1');
      localStorage.setItem('mf.task-detail.assets.open.1', '1');
    });
    await page.reload();
    await expect(detail.tab('Workflow')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.section('Comments')).toBeHidden();
  });

  test('deep links show the tab: ?tab=assets and ?tab=comments (the address is kept while choosing tabs, Workflow is not written)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const detail = new TaskDetailPage(page);
    await page.goto(`/tasks/${task.taskId}?tab=assets`);
    await expect(detail.tab('Assets')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.section('Assets')).toBeVisible();
    await expect(detail.section('Comments')).toBeHidden();
    await page.goto(`/tasks/${task.taskId}?tab=comments`);
    await expect(detail.tab('Comments')).toHaveAttribute('aria-selected', 'true');
    await expect(detail.section('Comments')).toBeVisible();
    await detail.tab('Workflow').click();
    await expect(page).not.toHaveURL(/tab=/);
    await detail.tab('Assets').click();
    await expect(page).toHaveURL(/tab=assets/);
  });

  test('"N new" shows in the Comments pane after another user comments, and the cue clears once the person has seen them and left the tab', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    const tech = await seed.user(['Data Technician'], 'tech');
    const asTech = await Api.as(tech.username);
    try {
      const detail = new TaskDetailPage(page);
      // First visit: no cue (there is one comment already).
      await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Older note</p>' });
      await detail.open(task.taskId);
      await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(1\)$/);
      await detail.selectTab('Comments');
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);

      // Someone else comments twice; the next visit says so in the pane, and the tab count is live on the Workflow tab.
      await page.waitForTimeout(1100);
      await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Second</p>' });
      await asTech.post(`/api/v1/tasks/${task.taskId}/comments`, { bodyHtml: '<p>Third note</p>' });
      await page.reload();
      await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(3\)$/);
      await detail.selectTab('Comments');
      await expect(detail.section('Comments').locator('[data-new-badge]')).toHaveText('2 new');
      await expect(detail.section('Comments').locator('[data-live]')).toHaveText('2 new comments');
      await expect(detail.commentItems.last()).toContainText('Third note');

      // Leaving the tab marks them read: the cue is gone when the person comes back, also after a reload.
      await detail.selectTab('Workflow');
      await detail.selectTab('Comments');
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);
      await page.reload();
      await expect(detail.header).toBeVisible();
      await detail.selectTab('Comments');
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);

      // Own comments are never "new".
      const editor = await detail.composer();
      await editor.fill('');
      await page.keyboard.type('My own note');
      await page.keyboard.press('Control+Enter');
      await expect(detail.commentItems.last()).toContainText('My own note');
      await detail.selectTab('Workflow');
      await page.reload();
      await detail.selectTab('Comments');
      await expect(page.locator('[data-new-badge]')).toHaveCount(0);
    } finally {
      await asTech.dispose();
    }
  });

  test('the counts on the tabs are live: a comment and a linked asset change them without a reload, from any tab', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const asset = await seed.asset(world.matter, `Quick ${uid()}`);
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(0\)$/);
    await expect(detail.tab('Assets')).toHaveText(/^\s*Assets\s*\(0\)$/);

    // C shows the Comments tab with the cursor in the composer; the post changes the count on the tab.
    await detail.selectTab('Comments');
    await expect(detail.section('Comments').locator('[data-empty]')).toBeVisible();
    await expect(detail.section('Comments').getByPlaceholder('Write a comment...')).toBeVisible();
    const editor = await detail.composer();
    await page.keyboard.type('Quick note');
    await page.keyboard.press('Control+Enter');
    await expect(detail.commentItems).toHaveCount(1);
    await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(1\)$/);
    await expect(editor).toBeHidden(); // back to one line after the post
    await expect(page.getByPlaceholder('Write a comment...')).toBeVisible();

    await detail.selectTab('Assets');
    await expect(detail.section('Assets').locator('[data-empty]')).toBeVisible();
    await detail.section('Assets').getByRole('button', { name: 'Link asset' }).click();
    const picker = detail.section('Assets').getByRole('combobox', { name: 'Asset to link' });
    await expect(picker).toBeFocused();
    await picker.fill(asset.displayName);
    await page.getByRole('option', { name: new RegExp(asset.displayName) }).click();
    await detail.section('Assets').locator('[data-link-submit]').click();
    await expect(detail.section('Assets').locator('li[data-asset-id]')).toHaveCount(1);
    await expect(detail.tab('Assets')).toHaveText(/^\s*Assets\s*\(1\)$/);
    // Back on the Workflow tab the counts stay.
    await detail.selectTab('Workflow');
    await expect(detail.tab('Assets')).toHaveText(/^\s*Assets\s*\(1\)$/);
    await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(1\)$/);
  });

  test('the composer is one line until it is focused and goes back when emptied and blurred; a draft survives a visit to another tab', async ({
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
    // ... and when the person looks at another tab and comes back.
    await detail.selectTab('Workflow');
    await detail.selectTab('Comments');
    await expect(editor).toHaveText('Draft');
    // Emptied and blurred: one line again.
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(comments.getByPlaceholder('Write a comment...')).toBeVisible();
  });

  test('375 px: the strip holds the three tabs, a tab shows its pane under it, no sideways scroll', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 375, height: 812 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.tab('Workflow')).toHaveAttribute('aria-selected', 'true');
    await noHorizontalScroll(page);
    const strip = await box(page, '[role="tablist"]');
    await detail.selectTab('Assets');
    const assets = await box(page, '[data-section="assets"]');
    expect(assets.y).toBeGreaterThan(strip.y + strip.height - 1);
    await expect(detail.section('Assets').locator('[data-section-heading]')).toBeAttached();
    await noHorizontalScroll(page);
  });

  for (const width of [1366, 375]) {
    test(`axe finds nothing at ${width} px on every tab`, async ({ page, seed, admin }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      const task = await seedBusyTask(seed, admin);
      await page.setViewportSize({ width, height: 800 });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      for (const name of ['Workflow', 'Assets', 'Comments'] as const) {
        await detail.selectTab(name);
        if (name === 'Comments') await detail.composer();
        await page.evaluate(() => window.scrollTo(0, 0));
        expect(await axeViolations(page, '[data-detail-left]'), name).toEqual([]);
      }
    });
  }
});
