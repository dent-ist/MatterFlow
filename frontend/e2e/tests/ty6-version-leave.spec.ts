import { Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { SIZES, draftWorld, expectNoViolations, rowMenu, shoot } from '../support/version-page';

/**
 * Task Types UX epic #352, WP-TY6, VP8 (#398): leaving a dirty draft offers Stay (the default), Leave and Save draft and leave.
 * Screenshots go to the folder in E2E_SCREENSHOTS (docs/ux/task-types-review/fixes/ty6-version) when it is set.
 */
const titlesOf = (page: Page) =>
  page.locator('[data-step-row] [data-step-title]').allTextContents();

test.describe('Version editor: leaving a dirty draft (VP8, #398)', () => {
  async function makeDirty(page: Page, title: string): Promise<void> {
    await rowMenu(page, title).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('[data-dirty]')).toBeVisible();
  }
  const crumb = (page: Page, name: string) =>
    page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name });
  const ask = (page: Page) => page.getByRole('dialog', { name: 'Leave without saving?' });

  test('a breadcrumb offers Stay (default), Leave and Save draft and leave; Save draft and leave saves, then goes', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 3);
    const [a, b] = world.wf.stepTitles;
    await page.goto(world.url);
    await makeDirty(page, a);
    await crumb(page, 'Workflows').click();
    await expect(ask(page)).toBeVisible();
    await expect(ask(page).getByRole('button', { name: 'Stay' })).toBeFocused();
    const buttons = await ask(page).getByRole('button').allTextContents();
    expect(buttons.map((t) => t.trim()).filter((t) => t && t !== 'Close dialog')).toEqual([
      'Stay',
      'Leave',
      'Save draft and leave',
    ]);
    await expectNoViolations(page, 'leave dialog');
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.w, height: size.h });
      await shoot(page, 'leave-dialog', size);
    }
    // Stay: the page and the unsaved work are kept.
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(ask(page)).toHaveCount(0);
    await expect(page.locator('[data-dirty]')).toBeVisible();
    expect((await titlesOf(page)).slice(0, 2)).toEqual([b, a]);
    // Save draft and leave: the order is saved and the Workflows page opens.
    await crumb(page, 'Workflows').click();
    await ask(page).getByRole('button', { name: 'Save draft and leave' }).click();
    await expect(page).toHaveURL(/\/admin\/(workflows|task-types)/);
    await expect(page).not.toHaveURL(/versions/);
    const saved = await admin.get(
      `/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`,
    );
    expect(saved.steps.map((s: { title: string }) => s.title).slice(0, 2)).toEqual([b, a]);
  });

  test('Leave goes without saving; the draft on the server is unchanged', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await draftWorld(seed, admin, 3);
    await page.goto(world.url);
    await makeDirty(page, world.wf.stepTitles[0]);
    await crumb(page, 'Workflows').click();
    await ask(page).getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).not.toHaveURL(/versions/);
    const saved = await admin.get(
      `/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`,
    );
    expect(saved.steps[0].title).toBe(world.wf.stepTitles[0]);
  });

  test('a failed save keeps the page open and shows why; the browser Back button asks too', async ({
    page,
    seed,
    admin,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 3);
    // Arrive from the Workflow page, so Back has an in-app page to go to.
    await page.goto(`/admin/workflows/${world.wf.workflowDefinitionId}`);
    await page.getByRole('link', { name: /^Open draft v2/ }).click();
    await expect(page.locator('[data-step-row]')).toHaveCount(3);
    await makeDirty(page, world.wf.stepTitles[0]);
    await page.route(
      `**/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`,
      (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: '{"status":500,"title":"Boom"}',
            })
          : route.continue(),
    );
    await crumb(page, 'Workflows').click();
    await ask(page).getByRole('button', { name: 'Save draft and leave' }).click();
    await expect(page).toHaveURL(/versions/);
    await expect(ask(page)).toHaveCount(0);
    await expect(page.locator('[data-summary]')).toContainText('We could not save the draft');
    await expect(page.locator('[data-dirty]')).toBeVisible();
    await page.unroute(
      `**/api/v1/workflows/${world.wf.workflowDefinitionId}/versions/${world.draftId}`,
    );
    // Back from this page (the browser button) is guarded as well.
    await page.goBack();
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/versions/);
  });

  test('closing the tab with unsaved changes asks the browser; a saved or untouched draft does not', async ({
    page,
    seed,
    admin,
  }) => {
    const world = await draftWorld(seed, admin, 3);
    await page.goto(world.url);
    const asks = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await asks()).toBe(false);
    await makeDirty(page, world.wf.stepTitles[0]);
    expect(await asks()).toBe(true);
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.locator('[data-dirty]')).toHaveCount(0);
    expect(await asks()).toBe(false);
  });

  test('permissions: Workflow.Manage with Task.View edits rows; TaskType.Manage only gets the 403 page', async ({
    seed,
    admin,
    asUser,
  }) => {
    test.setTimeout(120_000);
    const world = await draftWorld(seed, admin, 3);
    const wfRole = await seed.role(['Workflow.Manage', 'Task.View'], 'Workflow admin');
    const wfUser = await seed.user([wfRole.name], 'wf-only');
    const wfPage = await asUser(wfUser.username);
    await wfPage.goto(world.url);
    await expect(wfPage.locator('[data-step-row]')).toHaveCount(3);
    await expect(rowMenu(wfPage, world.wf.stepTitles[0])).toBeVisible();
    await expect(wfPage.getByRole('button', { name: /^Execution mode/ })).toBeVisible();
    await expect(wfPage.getByRole('region', { name: 'Library steps, scrollable' })).toBeVisible();

    const ttRole = await seed.role(['TaskType.Manage', 'Task.View'], 'Type only');
    const ttUser = await seed.user([ttRole.name], 'tt-only');
    const ttPage = await asUser(ttUser.username);
    await ttPage.goto(world.url);
    await expect(
      ttPage.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
    await expect(ttPage.locator('[data-step-row]')).toHaveCount(0);
  });
});
