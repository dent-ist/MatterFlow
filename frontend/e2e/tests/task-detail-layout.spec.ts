import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { expect, test } from '../support/fixtures';
import { seedBusyTask } from '../support/busy-task';
import { TaskApi } from '../support/tasks';

const FIVE_STEPS = [
  { title: 'Intake' },
  { title: 'Validate' },
  { title: 'Load' },
  { title: 'Report' },
  { title: 'Handover' },
];

/** The Task page is one page: the tabs Workflow, Assets and Comments on the left (60 %, #347; stacked sections before that), Details on the right (40 %, resizable) (docs/ux/task-detail-v2). */
test.describe('Task detail: single page layout', () => {
  const noHorizontalScroll = async (page: Page): Promise<void> => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  };

  const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!;

  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
  ] as const) {
    test(`${width} px: the tabs Workflow, Assets and Comments, each pane the full width of the left column (60 %), Details on the right (40 %), nothing clipped`, async ({
      page,
      seed,
      admin,
    }) => {
      const task = await seedBusyTask(seed, admin);
      await page.setViewportSize({ width, height });
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await detail.ensureCommentsOpen();
      await expect(detail.commentItems.first()).toBeVisible();

      await expect(page.getByRole('tab')).toHaveText([
        /^\s*Workflow/,
        /^\s*Assets\s*\(8\)$/,
        /^\s*Comments\s*\(12\)$/,
      ]);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(task.title);
      // The pane on screen has its heading (for screen readers); Details has its own.
      await expect(
        page.getByRole('heading', { level: 2, name: /^(Workflow|Comments|Details|Assets)/ }),
      ).toHaveText([/Comments/, /Details/]);

      const aside = page.getByRole('complementary', { name: 'Details' });
      await expect(aside.locator('[data-view]')).toBeVisible();
      // The panel has no Edit of its own: the header's Edit is the one entry point (K1, #326).
      await expect(aside.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
      await expect(aside.locator('[data-section="assets"]')).toHaveCount(0);

      const side = await box(aside);
      const layout = await box(page.locator('[data-detail-layout]'));
      await detail.selectTab('Workflow');
      const workflow = await box(detail.section('Workflow'));
      // Assets first, Comments after it (the tab order); each pane is as wide as the left column and starts at the same place under the
      // strip (owner request: Assets before Comments; #347: tabs instead of stacked sections).
      for (const name of ['Assets', 'Comments'] as const) {
        await detail.selectTab(name);
        const pane = await box(detail.section(name));
        expect(Math.abs(pane.width - workflow.width), name).toBeLessThanOrEqual(2);
        expect(Math.abs(pane.x - workflow.x), name).toBeLessThanOrEqual(1);
        expect(Math.abs(pane.y - workflow.y), name).toBeLessThanOrEqual(2);
      }
      // Left column about 60 % of the layout, Details about 40 % and to its right.
      expect(side.x).toBeGreaterThan(workflow.x + workflow.width - 1);
      expect(workflow.width / layout.width).toBeGreaterThan(0.56);
      expect(workflow.width / layout.width).toBeLessThan(0.61);
      expect(side.width / layout.width).toBeGreaterThan(0.36);
      expect(side.width / layout.width).toBeLessThan(0.41);
      await expect(page.getByRole('tablist', { name: 'Task sections' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);

      // Nothing clipped: no sideways scroll, every step row inside its box, the status badge inside the row.
      await detail.selectTab('Workflow');
      await noHorizontalScroll(page);
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-step-id], [data-comment-id]'))
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.getAttribute('data-step-id') ?? el.getAttribute('data-comment-id')),
      );
      expect(clipped).toEqual([]);
      for (const state of await detail.page.locator('[data-step-id] [data-state]').all()) {
        const row = await box(state.locator('xpath=ancestor::*[@data-step-id]'));
        const badge = await box(state);
        expect(badge.x + badge.width).toBeLessThanOrEqual(row.x + row.width + 1);
      }

      // The Details panel stays in view while the page scrolls.
      await page.mouse.wheel(0, 600);
      await expect.poll(async () => (await box(aside)).y).toBeLessThan(120);
      await noHorizontalScroll(page);
    });
  }

  test('the Details panel scrolls by itself when it is taller than the window', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 600 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const aside = page.getByRole('complementary', { name: 'Details' });
    // A long description is cut at about 12 lines (T6, #314): the panel is taller than the window once it is opened.
    const more = page.locator('[data-description-more]');
    if ((await more.count()) > 0) await more.click();
    const scrolls = await aside.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
    expect(await aside.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  });

  test('step rows adapt to the width of the Workflow column: the date moves under the status when it is narrow', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const firstStep = page.locator('[data-step-id]').first();
    const when = firstStep.locator('[data-resolved-at]');
    const state = firstStep.locator('[data-state]');
    // At 60 % the date and the status sit on one line, the status at the right.
    expect(Math.abs((await box(when)).y - (await box(state)).y)).toBeLessThan(12);

    await detail.splitter.focus();
    await page.keyboard.press('Home'); // left column at its minimum: a narrow Workflow
    await expect(detail.splitter).toHaveAttribute('aria-valuenow', '35');
    expect((await box(state)).y).toBeGreaterThan((await box(firstStep.getByRole('heading'))).y);
    await noHorizontalScroll(page);
    await detail.splitter.dblclick();
  });

  test('the splitter: drag (mouse), keyboard, double click, Reset layout, remembered per user', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const handle = detail.splitter;
    await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    await expect(handle).toHaveAttribute('aria-valuenow', '60');
    await expect(handle).toHaveAttribute('aria-valuemin', '35');
    await expect(handle).toHaveAttribute('aria-valuemax', '70');
    expect(await handle.evaluate((el) => getComputedStyle(el).cursor)).toBe('col-resize');

    const layout = page.locator('[data-detail-layout]');
    const leftShare = async () =>
      (await box(page.locator('[data-detail-left]'))).width / (await box(layout)).width;

    // Drag to about 40 %: the left column shrinks, text selection is off while dragging and back afterwards.
    const g = await box(layout);
    const h = await box(handle);
    const y = h.y + 60;
    await page.mouse.move(h.x + h.width / 2, y);
    await page.mouse.down();
    expect(await page.evaluate(() => document.body.style.userSelect)).toBe('none');
    await page.mouse.move(g.x + 8 + (g.width - 16) * 0.5, y, { steps: 4 });
    await page.mouse.move(g.x + 8 + (g.width - 16) * 0.4, y, { steps: 4 });
    await page.mouse.up();
    expect(await page.evaluate(() => document.body.style.userSelect)).toBe('');
    await expect(handle).toHaveAttribute('aria-valuenow', '40');
    expect(await leftShare()).toBeLessThan(0.42);
    await expect(page.getByRole('button', { name: 'Reset layout' })).toBeVisible();

    // Remembered: a reload opens at 40 % without a jump.
    await page.reload();
    await expect(detail.header).toBeVisible();
    await expect(handle).toHaveAttribute('aria-valuenow', '40');

    // Keyboard.
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '42');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '52');
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    await page.keyboard.press('End');
    await expect(handle).toHaveAttribute('aria-valuenow', '70');
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '35');
    await page.keyboard.press('Enter');
    await expect(handle).toHaveAttribute('aria-valuenow', '60');
    expect(await leftShare()).toBeGreaterThan(0.57);

    // Double click and the Reset layout button.
    await page.keyboard.press('End');
    await handle.dblclick();
    await expect(handle).toHaveAttribute('aria-valuenow', '60');
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect(handle).toHaveAttribute('aria-valuenow', '60');
    await expect(page.getByRole('button', { name: 'Reset layout' })).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test('the splitter is hidden below 1100 px', async ({ page, seed }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1024, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(detail.splitter).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Task sections' })).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('Comments: only the latest 3 by default, Show all / Show latest 3 is remembered, the sort orders inside the window, search covers all, a new comment stays visible', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 900 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Comments');
    await expect(detail.commentItems).toHaveCount(3);
    await expect(detail.tab('Comments')).toHaveText(/^\s*Comments\s*\(12\)\s*$/);
    await expect(page.getByText('Showing latest 3 of 12.')).toBeVisible();
    await expect(detail.commentItems.last()).toContainText('load template agreed');
    await expect(detail.commentItems.first()).toContainText('Vendor re-sent B-003');

    // The sort order only orders inside the window.
    await page.getByLabel('Sort comments').selectOption('newest');
    await expect(detail.commentItems).toHaveCount(3);
    await expect(detail.commentItems.first()).toContainText('load template agreed');
    await page.getByLabel('Sort comments').selectOption('oldest');

    await detail.showAllComments.click();
    await expect(detail.commentItems).toHaveCount(12);
    await expect(page.getByText('Showing all 12.')).toBeVisible();
    await expect(page.getByText(/Showing latest/)).toHaveCount(0);

    // Remembered: after a reload the whole thread is back, and "Show latest 3" returns to the short view.
    await page.reload();
    await detail.showSection('Comments');
    await expect(detail.commentItems).toHaveCount(12);
    await detail.showLatestComments.click();
    await expect(detail.commentItems).toHaveCount(3);
    await detail.showAllComments.click();
    await expect(detail.commentItems).toHaveCount(12);
    await detail.showLatestComments.click();

    // Search ignores the limit and shows the match count.
    await page.getByRole('searchbox', { name: 'Search comments' }).fill('Kicked off');
    await expect(detail.commentItems).toHaveCount(1);
    await expect(page.getByText('1 of 12 comments match')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search comments' }).fill('');
    await expect(detail.commentItems).toHaveCount(3);

    // A new comment is the latest, so it stays visible.
    await detail.composer();
    await page.keyboard.type('Brand new comment');
    await detail.section('Comments').locator('[data-post]').click();
    await expect(detail.commentItems.last()).toContainText('Brand new comment');
    await expect(detail.commentItems).toHaveCount(3);
    await expect(page.getByText('Showing latest 3 of 13.')).toBeVisible();
  });

  test('Assets and Comments are labelled scroll regions with their own maximum height (about 60vh)', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await detail.showSection('Assets');

    const assets = page.getByRole('region', { name: 'Linked assets, scrollable' });
    await expect(assets).toBeVisible();
    await expect(assets).toHaveAttribute('tabindex', '0');
    await expect(assets.locator('li[data-asset-id]')).toHaveCount(8);
    const info = await assets.evaluate((el) => ({
      scrolls: el.scrollHeight > el.clientHeight,
      max: parseFloat(getComputedStyle(el).maxHeight),
      height: el.clientHeight,
    }));
    expect(info.max).toBeCloseTo(768 * 0.6, 0);
    expect(info.height).toBeLessThanOrEqual(Math.ceil(info.max));
    // The list scrolls by itself, the page does not move with it.
    expect(info.scrolls).toBe(true);
    const pageY = await page.evaluate(() => window.scrollY);
    await assets.evaluate((el) => (el.scrollTop = 200));
    expect(await page.evaluate(() => window.scrollY)).toBe(pageY);
    // The actions are all there: change role, unlink, link, inside the panel.
    const last = assets.locator('li[data-asset-id]').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('[data-role-select]')).toBeVisible();
    await expect(last.locator('[data-unlink]')).toBeVisible();
    await expect(detail.section('Assets').locator('[data-link-open]')).toBeVisible();

    await assets.focus();
    await expect(assets).toBeFocused();
    const a = await box(detail.section('Assets'));
    // The Comments tab: its thread is a scroll region too (the pane is as wide as the Assets pane and starts where it did: tabs, never
    // stacked or side by side; owner request: Assets before Comments).
    await detail.showSection('Comments');
    const comments = page.getByRole('region', { name: 'Comment thread, scrollable' });
    await expect(comments).toHaveAttribute('tabindex', '0');
    const c = await box(detail.section('Comments'));
    expect(Math.abs(c.y - a.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.width - c.width)).toBeLessThanOrEqual(1);
  });

  test('rich-text tables scroll inside their own box and never widen the page', async ({
    page,
    seed,
    admin,
  }) => {
    const task = await seedBusyTask(seed, admin);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    // A wide 12-column table is put into the rich-text container, so the stylesheet is checked on a shape no seed data has.
    const result = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('[data-description]')!;
      host.insertAdjacentHTML(
        'beforeend',
        '<table id="wide"><thead><tr>' +
          Array.from({ length: 12 }, (_, i) => `<th>Column ${i + 1}</th>`).join('') +
          '</tr></thead><tbody>' +
          Array.from(
            { length: 3 },
            () =>
              '<tr>' +
              Array.from(
                { length: 12 },
                () => '<td>Some long cell text that must wrap nicely</td>',
              ).join('') +
              '</tr>',
          ).join('') +
          '</tbody></table>',
      );
      const table = document.getElementById('wide')!;
      const cs = getComputedStyle(table);
      const td = getComputedStyle(table.querySelector('td')!);
      const th = getComputedStyle(table.querySelector('th')!);
      const rows = table.querySelectorAll('tbody tr');
      return {
        display: cs.display,
        overflowX: cs.overflowX,
        scrolls: table.scrollWidth > table.clientWidth,
        tableWidth: table.getBoundingClientRect().width,
        hostWidth: host.getBoundingClientRect().width,
        border: td.borderTopWidth,
        fontRatio: parseFloat(td.fontSize) / parseFloat(getComputedStyle(host).fontSize),
        headerBg: th.backgroundColor,
        zebra:
          getComputedStyle(rows[1].querySelector('td')!).backgroundColor !==
          getComputedStyle(rows[0].querySelector('td')!).backgroundColor,
      };
    });
    expect(result.display).toBe('block');
    expect(result.overflowX).toBe('auto');
    expect(result.scrolls).toBe(true);
    expect(result.tableWidth).toBeLessThanOrEqual(result.hostWidth + 1);
    expect(result.border).toBe('1px');
    expect(result.fontRatio).toBeLessThan(1);
    expect(result.zebra).toBe(true);
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

  test('375 px: the tabs, the selected pane, then Details (collapsed) in one column and no sideways scroll', async ({
    page,
    seed,
  }) => {
    const world = await seed.world({ steps: FIVE_STEPS });
    const task = await seed.task(world);
    await page.setViewportSize({ width: 375, height: 800 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const toggle = page.locator('[data-detail-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByRole('complementary', { name: 'Details' }).locator('[data-view]'),
    ).toBeHidden();
    await noHorizontalScroll(page);

    const y = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y;
    const details = await y(page.getByRole('complementary', { name: 'Details' }));
    const strip = await y(page.getByRole('tablist', { name: 'Task sections' }));
    for (const name of ['Workflow', 'Assets', 'Comments'] as const) {
      await detail.selectTab(name);
      const pane = await y(detail.section(name));
      expect(strip, `tabs above the ${name} pane`).toBeLessThan(pane);
      expect(pane, `${name} pane above Details`).toBeLessThan(details);
      await noHorizontalScroll(page);
    }
    await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByRole('complementary', { name: 'Details' }).locator('[data-view]'),
    ).toBeVisible();
    await noHorizontalScroll(page);

    await page.setViewportSize({ width: 768, height: 1024 });
    await noHorizontalScroll(page);
  });

  test('?tab= links: assets and comments show their tab, workflow and no tab the Workflow, activity opens the drawer, details just shows the page', async ({
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
      await expect(detail.tab(name)).toHaveAttribute('aria-selected', 'true');
      await expect(detail.section(name)).toBeVisible();
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

  test('the header Edit opens the form in a dialog and saves back to the same page', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const task = await seed.task(world);
    await page.setViewportSize({ width: 1280, height: 900 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);

    const open = page.locator('[data-task-header] [data-action="edit"]');
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Edit task details' });
    await expect(dialog).toBeVisible();
    const requestor = dialog.getByLabel('Requestor name (required)');
    await requestor.fill('Rita Panel');
    await expect(requestor).toHaveValue('Rita Panel');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}$`));
    await expect(detail.detailsPanel).toContainText('Rita Panel');
    await expect(open).toBeFocused();
  });

  test('a person without Asset.View sees a note in the Assets tab instead of a gap', async ({
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
    // The Assets tab stays (T10 matrix), without a count; its pane carries the sentence.
    await expect(detail.tab('Assets')).toHaveText(/^\s*Assets\s*$/);
    await detail.ensureAssetsOpen();
    await expect(detail.section('Assets')).toContainText("don't have permission to view assets");
    await expect(page.locator('[data-view-only]')).toContainText('View only');
  });
});
