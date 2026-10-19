import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskDetailPage } from '../pages/task-detail.page';
import { Api, Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { seedBusyTask } from '../support/busy-task';
import { expect, test } from '../support/fixtures';
import { Seeder, World, uid } from '../support/seed';
import { TaskApi } from '../support/tasks';

/**
 * Task page tabs (#347, epic #288): Workflow | Assets | Comments replace the stacked Assets and Comments sections and the section nav.
 * Counts on the labels are live; `?tab=` and `?step=` deep links, the Activity excerpt links, the C / A / S shortcuts and the Back
 * behaviour keep working. Every test seeds its own records. Screenshots go to E2E_SCREENSHOTS when it is set
 * (docs/ux/task-detail-review/fixes/tabs).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

const SIZES = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

type Pane = 'Workflow' | 'Assets' | 'Comments';
const PANES: readonly Pane[] = ['Workflow', 'Assets', 'Comments'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}x${size.height}.png`) });
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

/** axe finds nothing, the page does not scroll sideways, and a screenshot is kept. */
async function check(page: Page, name: string): Promise<void> {
  if (axeAvailable()) {
    expect(await axeViolations(page), `${name} at ${page.viewportSize()!.width}`).toEqual([]);
  }
  await noHorizontalScroll(page);
  await shot(page, name);
}

const ROLE = [
  'Task.View',
  'Task.Edit',
  'Task.Comment',
  'Task.Complete',
  'Task.Reopen',
  'Workflow.Execute',
  'Matter.View',
  'Client.View',
  'Asset.View',
  'Asset.Link',
];

interface Fixture {
  world: World;
  task: Json;
}

async function seeded(
  seed: Seeder,
  opts: { stepCount?: number; task?: Json } = {},
): Promise<Fixture> {
  const world = await seed.world({ stepCount: opts.stepCount ?? 3 });
  const task = await seed.task(world, opts.task ?? {});
  return { world, task };
}

async function addComments(admin: Api, taskId: number, count: number): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await admin.post(`/api/v1/tasks/${taskId}/comments`, {
      bodyHtml: `<p>Comment number ${i}</p>`,
    });
  }
}

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Task sections' });
const tabOf = (page: Page, name: Pane) =>
  tabs(page).getByRole('tab', { name: new RegExp(`^\\s*${name}`) });
const selected = (page: Page) => tabs(page).getByRole('tab', { selected: true });

test.describe('Task tabs: structure, accessibility and every width', () => {
  test('three tabs in the order Workflow, Assets, Comments; the panel is named by the selected tab; axe 0 and no sideways scroll on each pane at 375, 768, 1024, 1366 and 1920', async ({
    seed,
    admin,
    page,
  }) => {
    test.setTimeout(240_000);
    const task = await seedBusyTask(seed, admin);
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await expect(tabs(page).getByRole('tab')).toHaveText([
        /^\s*Workflow\s*\(2\/6\)$/,
        /^\s*Assets\s*\(8\)$/,
        /^\s*Comments\s*\(12\)$/,
      ]);
      await expect(page.getByRole('tabpanel')).toHaveAttribute(
        'aria-labelledby',
        'task-tab-workflow',
      );
      // Exactly one tab is a tab stop; the others are reached with the arrows.
      await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
      await expect(page.locator('[role="tab"][tabindex="-1"]')).toHaveCount(2);
      await expect(page.locator('[data-section-nav], mf-section-nav')).toHaveCount(0);
      for (const name of PANES) {
        await detail.selectTab(name);
        if (name === 'Comments') await expect(detail.commentItems.first()).toBeVisible();
        await expect(page.getByRole('tabpanel')).toHaveAttribute(
          'aria-labelledby',
          `task-tab-${name.toLowerCase()}`,
        );
        await expect(tabOf(page, name)).toHaveAttribute('aria-controls', 'task-panel');
        await page.evaluate(() => window.scrollTo(0, 0));
        await check(page, `tab-${name.toLowerCase()}`);
      }
      // Details stays a side panel (from 1100 px) or a closed disclosure, never a tab.
      await expect(page.locator('[role="tab"][data-tab="details"]')).toHaveCount(0);
      await expect(page.locator('[data-detail-toggle]')).toHaveCount(size.width >= 1100 ? 0 : 1);
    }
  });

  test('the Workflow heading y: the tab strip is shorter than the old section nav row, so the Workflow starts higher than before (typical task)', async ({
    seed,
    page,
  }) => {
    const { task } = await seeded(seed);
    const detail = new TaskDetailPage(page);
    const y: Record<string, number> = {};
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await page.evaluate(() => window.scrollTo(0, 0));
      y[`${size.width}`] = await page
        .locator('[data-workflow-tab] [data-section-heading]')
        .evaluate((el) => Math.round(el.getBoundingClientRect().top));
    }
    console.log('Tabs: Workflow heading y (typical task)', JSON.stringify(y));
    // The T5 / T6 targets: 380 at 375, 420 at 768, 300 at 1366.
    expect(y['375']).toBeLessThanOrEqual(380);
    expect(y['768']).toBeLessThanOrEqual(420);
    expect(y['1366']).toBeLessThanOrEqual(300);
    test.info().annotations.push({ type: 'workflow-heading-y', description: JSON.stringify(y) });
  });

  test('a 320 px window: the strip scrolls on its own (edge cue), the page does not', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed);
    await addComments(admin, task.taskId, 112);
    await page.setViewportSize({ width: 320, height: 700 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(tabOf(page, 'Comments')).toHaveText(/112/);
    await noHorizontalScroll(page);
    const strip = tabs(page);
    const scrolls = await strip.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (scrolls) {
      await expect(page.locator('[data-tab-cue="end"]')).toBeVisible();
      await detail.selectTab('Comments');
      await expect(tabOf(page, 'Comments')).toBeInViewport({ ratio: 0.99 });
    }
    await check(page, 'tabs-320');
  });
});

test.describe('Task tabs: keyboard only', () => {
  test('Tab reaches the strip, the arrows and Home/End select, Tab enters the visible pane only; C, A and S still work from any tab', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed);
    const pod = await seed.pod(`Tabs Pod ${uid()}`, []);
    await new TaskApi(admin, task.taskId).assign(null, pod.podId);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    await tabOf(page, 'Workflow').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabOf(page, 'Assets')).toBeFocused();
    await expect(selected(page)).toHaveText(/^\s*Assets/);
    await expect(detail.section('Assets')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(tabOf(page, 'Comments')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabOf(page, 'Workflow')).toBeFocused();
    await page.keyboard.press('End');
    await expect(tabOf(page, 'Comments')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabOf(page, 'Workflow')).toBeFocused();
    await page.keyboard.press('Tab');
    // The first stop in the pane is a Workflow step, not something in a hidden pane.
    await expect(page.locator('[data-section="workflow"]').locator(':focus')).toHaveCount(1);

    // C shows the Comments tab with the cursor in the composer; typing letters there is text.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('c');
    await expect(selected(page)).toHaveText(/^\s*Comments/);
    const editor = page.locator('[data-section="comments"] [data-composer] [role=textbox]');
    await expect(editor).toBeFocused();
    await page.keyboard.type('cas');
    await expect(editor).toContainText('cas');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // A and S open their menus on the Comments tab (the buttons are in the facts strip above the tabs).
    await page.keyboard.press('a');
    await expect(page.locator('.im-pop')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.im-pop')).toHaveCount(0);
    await page.keyboard.press('s');
    await expect(page.locator('[data-option]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-option]')).toHaveCount(0);

    // C from the Assets tab too.
    await detail.selectTab('Assets');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('c');
    await expect(selected(page)).toHaveText(/^\s*Comments/);
    await expect(editor).toBeFocused();
  });

  test('a typed comment survives a visit to another tab; Link asset works with the keyboard', async ({
    seed,
    page,
  }) => {
    const { world, task } = await seeded(seed);
    const asset = await seed.asset(world.matter, `Tabs ${uid()}`);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    const editor = await detail.composer();
    await page.keyboard.type('A draft that is not posted yet');
    await tabOf(page, 'Comments').focus();
    await page.keyboard.press('Home');
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
    await page.keyboard.press('ArrowRight');
    await expect(selected(page)).toHaveText(/^\s*Assets/);
    await page.keyboard.press('Tab');
    await expect(
      detail.section('Assets').getByRole('button', { name: 'Link asset' }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    const picker = detail.section('Assets').getByRole('combobox', { name: 'Asset to link' });
    await expect(picker).toBeFocused();
    await picker.fill(asset.displayName);
    await page.getByRole('option', { name: new RegExp(asset.displayName) }).click();
    await detail.section('Assets').locator('[data-link-submit]').click();
    await expect(tabOf(page, 'Assets')).toHaveText(/\(1\)/);
    await detail.selectTab('Comments');
    await expect(editor).toContainText('A draft that is not posted yet');
  });
});

test.describe('Task tabs: deep links and the address', () => {
  test('?tab=assets, ?tab=comments, ?tab=workflow, no tab and an unknown tab; choosing a tab replaces the address, so Back leaves the task', async ({
    seed,
    page,
  }) => {
    const { task } = await seeded(seed);
    const detail = new TaskDetailPage(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const [query, pane] of [
      ['?tab=assets', 'Assets'],
      ['?tab=comments', 'Comments'],
      ['?tab=workflow', 'Workflow'],
      ['', 'Workflow'],
      ['?tab=nonsense', 'Workflow'],
      ['?tab=activity', 'Workflow'],
    ] as const) {
      await page.goto(`/tasks/${task.taskId}${query}`);
      await expect(detail.header).toBeVisible();
      await expect(selected(page), query).toHaveText(new RegExp(`^\\s*${pane}`));
      await expect(detail.section(pane)).toBeVisible();
    }
    // ?tab=activity opened the drawer; closing it leaves the Workflow tab.
    await expect(page.getByRole('dialog', { name: /^Activity:/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /^Activity:/ })).toHaveCount(0);

    // The default is not written to the address; the others are.
    await page.goto(`/tasks/${task.taskId}`);
    await detail.selectTab('Comments');
    await expect(page).toHaveURL(/\?tab=comments$/);
    await detail.selectTab('Assets');
    await expect(page).toHaveURL(/\?tab=assets$/);
    await detail.selectTab('Workflow');
    await expect(page).not.toHaveURL(/tab=/);
    // A reload keeps the tab the address names.
    await detail.selectTab('Comments');
    await page.reload();
    await expect(selected(page)).toHaveText(/^\s*Comments/);
  });

  test('?tab=details opens the Details disclosure below 1100 px (and shows the page on the Workflow tab); the tab choice is not remembered', async ({
    seed,
    page,
  }) => {
    const { task } = await seeded(seed);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/tasks/${task.taskId}?tab=details`);
    await expect(page.locator('[data-detail-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
    await page.goto(`/tasks/${task.taskId}?tab=comments`);
    await expect(selected(page)).toHaveText(/^\s*Comments/);
    await page.goto(`/tasks/${task.taskId}`);
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
    // Old keys of the stacked layout are ignored.
    await page.evaluate(() => {
      localStorage.setItem('mf.task-detail.comments.open.1', '1');
      localStorage.setItem('mf.task-detail.assets.open.1', '1');
    });
    await page.reload();
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
  });

  test('?step= opens that step and focuses it on the Workflow tab', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed, { stepCount: 3 });
    const steps = await new TaskApi(admin, task.taskId).steps();
    const second = steps[1];
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/tasks/${task.taskId}?step=${second.stepInstanceId}`);
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
    await expect(page.locator(`#step-btn-${second.stepInstanceId}`)).toBeFocused();
    await expect(page.locator(`#step-btn-${second.stepInstanceId}`)).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('an Activity excerpt link shows the Comments tab, loads and highlights the comment and focuses it; the tab is in the address', async ({
    seed,
    admin,
    page,
  }) => {
    const { task } = await seeded(seed);
    await addComments(admin, task.taskId, 24);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
    const drawer = await detail.openActivity();
    await expect(drawer.locator('[data-comment-link], [data-group-toggle]').first()).toBeVisible();
    const group = drawer.locator('[data-group-toggle]');
    if (await group.count()) await group.first().click();
    await drawer.locator('[data-comment-link]').first().click();
    await expect(page.getByRole('dialog', { name: /^Activity:/ })).toHaveCount(0);
    await expect(selected(page)).toHaveText(/^\s*Comments/);
    const hit = page.locator('[data-comment-id].tc__item--hit');
    await expect(hit).toBeVisible();
    await expect(hit).toBeFocused();
    await expect(page).toHaveURL(/tab=comments/);
    await shot(page, 'activity-link-comments-tab');
  });

  test('Back from the task goes to the list it was opened from, whatever tabs were visited (the address is replaced); focus returns to the link', async ({
    seed,
    page,
  }) => {
    const { world, task } = await seeded(seed, { task: { title: `Tabs back ${uid()}` } });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/matters/${world.matter.matterId}?tab=tasks`);
    const link = page.locator(`a.wt-title[data-task-id="${task.taskId}"]`);
    await expect(link).toBeVisible();
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks/${task.taskId}`));
    const detail = new TaskDetailPage(page);
    await expect(detail.header).toBeVisible();
    await detail.selectTab('Assets');
    await detail.selectTab('Comments');
    await detail.selectTab('Workflow');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/matters/${world.matter.matterId}`));
    await expect(link).toBeFocused();
  });
});

test.describe('Task tabs: live counts', () => {
  test('Workflow n/m, Assets and Comments change without a reload, from any tab', async ({
    seed,
    admin,
    page,
  }) => {
    const { world, task } = await seeded(seed, { stepCount: 3 });
    const asset = await seed.asset(world.matter, `Live ${uid()}`);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await expect(tabOf(page, 'Workflow')).toHaveText(/^\s*Workflow\s*\(0\/3\)$/);
    await expect(tabOf(page, 'Workflow')).toHaveAttribute(
      'aria-label',
      'Workflow, 0 of 3 steps resolved',
    );
    await expect(tabOf(page, 'Assets')).toHaveText(/^\s*Assets\s*\(0\)$/);
    await expect(tabOf(page, 'Comments')).toHaveText(/^\s*Comments\s*\(0\)$/);

    // A step completed on the Workflow tab changes its own count.
    const first = detail.step(((await new TaskApi(admin, task.taskId).steps())[0] as Json).title);
    await first.complete();
    await expect(tabOf(page, 'Workflow')).toHaveText(/^\s*Workflow\s*\(1\/3\)$/);

    // A comment posted on the Comments tab, and an asset linked on the Assets tab, change theirs while the other tabs are hidden.
    const editor = await detail.composer();
    await page.keyboard.type('Counted');
    await page.keyboard.press('Control+Enter');
    await expect(tabOf(page, 'Comments')).toHaveText(/^\s*Comments\s*\(1\)$/);
    await expect(editor).toBeHidden();
    await detail.selectTab('Assets');
    await detail.section('Assets').getByRole('button', { name: 'Link asset' }).click();
    const picker = detail.section('Assets').getByRole('combobox', { name: 'Asset to link' });
    await picker.fill(asset.displayName);
    await page.getByRole('option', { name: new RegExp(asset.displayName) }).click();
    await detail.section('Assets').locator('[data-link-submit]').click();
    await expect(tabOf(page, 'Assets')).toHaveText(/^\s*Assets\s*\(1\)$/);
    await expect(tabOf(page, 'Comments')).toHaveText(/^\s*Comments\s*\(1\)$/);
    await detail.selectTab('Workflow');
    await expect(tabOf(page, 'Workflow')).toHaveText(/^\s*Workflow\s*\(1\/3\)$/);
    await shot(page, 'live-counts');
  });
});

test.describe('Task tabs: permission variants', () => {
  test('no Asset.View: the Assets tab stays with no count and the sentence; no Asset request is made', async ({
    seed,
    asUser,
  }) => {
    const { task } = await seeded(seed);
    const role = await seed.role(
      ['Task.View', 'Task.Comment', 'Matter.View', 'Client.View'],
      'E2E no assets',
    );
    const user = await seed.user([role.name], 'noassets');
    const page = await asUser(user.username);
    const assetCalls: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/v1\/(tasks\/\d+\/assets|assets)/.test(r.url())) assetCalls.push(r.url());
    });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await expect(tabOf(page, 'Assets')).toHaveText(/^\s*Assets\s*$/);
      await detail.selectTab('Assets');
      await expect(detail.section('Assets')).toContainText("don't have permission to view assets");
      await expect(detail.section('Assets').locator('[data-asset-id]')).toHaveCount(0);
      await check(page, 'no-asset-view');
    }
    expect(assetCalls).toEqual([]);
  });

  test('Task.View only: the tabs and counts show, nothing to change (no composer, no Link asset), C does nothing; axe at four sizes', async ({
    seed,
    admin,
    asUser,
  }) => {
    const { task } = await seeded(seed);
    await addComments(admin, task.taskId, 2);
    const role = await seed.role(['Task.View', 'Asset.View'], 'E2E view only');
    const user = await seed.user([role.name], 'viewonly');
    const page = await asUser(user.username);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const detail = new TaskDetailPage(page);
      await detail.open(task.taskId);
      await expect(tabs(page).getByRole('tab')).toHaveText([
        /^\s*Workflow\s*\(0\/3\)$/,
        /^\s*Assets\s*\(0\)$/,
        /^\s*Comments\s*\(2\)$/,
      ]);
      await detail.selectTab('Assets');
      await expect(detail.section('Assets').locator('[data-link-open]')).toHaveCount(0);
      await detail.selectTab('Comments');
      await expect(detail.commentItems).toHaveCount(2);
      await expect(detail.section('Comments').locator('[data-composer]')).toHaveCount(0);
      await expect(detail.section('Comments').locator('[data-internal-note]')).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Home');
      await detail.selectTab('Workflow');
      await page.keyboard.press('c');
      await expect(selected(page)).toHaveText(/^\s*Workflow/);
      await detail.selectTab('Comments');
      await check(page, 'view-only');
    }
  });

  test('no Task.Comment but Task.View + Asset.View: the Comments tab reads, there is no composer, C changes nothing', async ({
    seed,
    asUser,
  }) => {
    const { task } = await seeded(seed);
    const role = await seed.role(
      ['Task.View', 'Task.Edit', 'Asset.View', 'Asset.Link'],
      'E2E no comment',
    );
    const user = await seed.user([role.name], 'nocomment');
    const page = await asUser(user.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const detail = new TaskDetailPage(page);
    await detail.open(task.taskId);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('c');
    await expect(selected(page)).toHaveText(/^\s*Workflow/);
    await detail.selectTab('Comments');
    await expect(
      detail.section('Comments').locator('[data-composer], [data-composer-quick]'),
    ).toHaveCount(0);
    await detail.selectTab('Assets');
    await expect(detail.section('Assets').locator('[data-link-open]')).toBeVisible();
  });

  test('System Admin and the assignee Data Technician see the same tabs', async ({
    seed,
    admin,
    page,
    asUser,
  }) => {
    const { task } = await seeded(seed);
    const role = await seed.role(ROLE, 'E2E technician');
    const tech = await seed.user([role.name], 'tech');
    const pod = await seed.pod(`Tabs Pod ${uid()}`, [tech.userId]);
    await new TaskApi(admin, task.taskId).assign(tech.userId, pod.podId);
    const techPage = await asUser(tech.username);
    for (const p of [page, techPage]) {
      await p.setViewportSize({ width: 768, height: 1024 });
      await new TaskDetailPage(p).open(task.taskId);
      await expect(tabs(p).getByRole('tab')).toHaveCount(3);
      await check(p, 'roles');
    }
  });
});

test.describe('Task tabs: 112 comments and a closed task', () => {
  test('112 comments: the tab says 112 at once from the Workflow tab, the thread opens on demand, Show all keeps the pane scrolling by itself', async ({
    seed,
    admin,
    page,
  }) => {
    test.setTimeout(300_000);
    const { task } = await seeded(seed);
    await addComments(admin, task.taskId, 112);
    const detail = new TaskDetailPage(page);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await detail.open(task.taskId);
      await expect(tabOf(page, 'Comments')).toHaveText(/^\s*Comments\s*\(112\)$/);
      await detail.selectTab('Comments');
      await expect(detail.commentItems).toHaveCount(3);
      await check(page, 'comments-112');
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await detail.showAllComments.click();
    await expect(detail.commentItems).toHaveCount(112);
    const scroller = detail.section('Comments').locator('[data-comments-scroll]');
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await check(page, 'comments-112-all');
  });

  test('Completed and Cancelled tasks: the same tabs; Assets is read-only with its note, Comments still takes comments', async ({
    seed,
    admin,
    page,
  }) => {
    const done = await seeded(seed, { stepCount: 2 });
    const doneApi = new TaskApi(admin, done.task.taskId);
    await doneApi.start();
    await doneApi.completeSteps(1, 2);
    expect((await doneApi.complete()).status).toBe(200);
    expect((await doneApi.get()).status).toBe('COMPLETED');
    const cancelled = await seeded(seed);
    await new TaskApi(admin, cancelled.task.taskId).cancel('Not needed any more');
    const detail = new TaskDetailPage(page);
    for (const [name, fx] of [
      ['completed', done],
      ['cancelled', cancelled],
    ] as const) {
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await detail.open(fx.task.taskId);
        await detail.selectTab('Assets');
        await expect(detail.section('Assets').locator('[data-closed-note]')).toBeVisible();
        await expect(detail.section('Assets').locator('[data-link-open]')).toHaveCount(0);
        await detail.selectTab('Comments');
        await expect(
          detail.section('Comments').locator('[data-composer], [data-composer-quick]').first(),
        ).toBeVisible();
        await check(page, `closed-${name}`);
      }
    }
  });
});
