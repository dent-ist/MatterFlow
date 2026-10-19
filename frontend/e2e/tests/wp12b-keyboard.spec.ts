import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { Seeder, uid } from '../support/seed';

/**
 * Keyboard on the work lists (WP12b, #181): "Skip to task list" as the first Tab stop, J / K and the arrows between rows, S and P for
 * the Status and Priority menus, `g` then `m` / `t` / `p` between the work pages, and the per-user "Keyboard shortcuts" switch in the help
 * (WCAG 2.1.4). Every test has its own user and tagged tasks, so nothing depends on global counts. Screenshots go to E2E_SCREENSHOTS
 * when it is set (docs/ux/my-work-review/fixes/wp12b).
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

const PERMS = ['Task.View', 'Task.ChangeStatus', 'Task.SetPriority', 'Matter.View'];

/** A user with `count` assigned tasks titled "<tag> 01" ... (so the order of the rows is known by title). */
async function worker(seed: Seeder, count: number, permissions = PERMS, extraPod = false) {
  const role = await seed.role(permissions, 'E2E keys');
  const me = await seed.user([role.name], 'keys');
  const world = await seed.world();
  const tag = uid();
  const pod = extraPod ? await seed.pod(undefined, [me.userId]) : null;
  for (let i = 1; i <= count; i++) {
    await seed.task(world, {
      title: `${tag} task ${String(i).padStart(2, '0')}`,
      assignedUserId: me.userId,
      ...(pod ? { assignedPodId: pod.podId } : {}),
    });
  }
  return { me, tag, pod };
}

const titles = (page: Page) => page.locator('[data-task] a.wt-title');
const focusedTitle = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '');
const focusedRowIndex = (page: Page) =>
  page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-task]'));
    return rows.indexOf(document.activeElement?.closest('[data-task]') as Element);
  });

/** How many Tab presses from the top of the page until a row title has focus (the skip link not used). */
async function tabsToFirstRow(page: Page): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let n = 1; n <= 80; n++) {
    await page.keyboard.press('Tab');
    const onTitle = await page.evaluate(
      () => !!document.activeElement?.matches('tbody a.wt-title'),
    );
    if (onTitle) return n;
  }
  return 81;
}

test.describe('Keyboard: skip link, rows and sequences (#181)', () => {
  test('Tab then Enter on "Skip to task list" lands on the first row; J 19 times is row 20; Enter opens it with from=', async ({
    seed,
    asUser,
  }) => {
    const { me, tag } = await worker(seed, 22);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(titles(page)).toHaveCount(22);

    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to task list' });
    await expect(skip).toBeFocused();
    await shot(page, 'skip-link-focused-1366');
    await page.keyboard.press('Enter');
    await expect(titles(page).first()).toBeFocused();
    expect(await focusedRowIndex(page)).toBe(0);
    await shot(page, 'first-row-after-skip-1366');

    // The skip link stays ahead of "Skip to main content": two Tab stops before anything else.
    await page.reload();
    await expect(titles(page)).toHaveCount(22);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

    // J 19 times from the first row.
    await myWork.open();
    await expect(titles(page)).toHaveCount(22);
    await titles(page).first().focus();
    for (let i = 0; i < 19; i++) await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(19);
    const row20 = await focusedTitle(page);
    expect(row20).toMatch(/task \d\d$/);
    await shot(page, 'row-20-after-19-j-1366');
    // K and the arrows move back and forth; the ends do not wrap.
    await page.keyboard.press('k');
    expect(await focusedRowIndex(page)).toBe(18);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await focusedRowIndex(page)).toBe(20);
    await page.keyboard.press('ArrowUp');
    expect(await focusedRowIndex(page)).toBe(19);
    await titles(page).first().focus();
    await page.keyboard.press('k');
    expect(await focusedRowIndex(page)).toBe(0);
    for (let i = 0; i < 25; i++) await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(21);

    // Enter opens the task with the list it came from; Back returns to the same row.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/\d+\?from=my-work/);
    await page.goBack();
    await expect(titles(page)).toHaveCount(22);
    await expect(titles(page).nth(21)).toBeFocused();
    expect(tag).toBeTruthy();
  });

  test('Tab stops before the first row are measured: one with the skip link, and the page without it', async ({
    seed,
    asUser,
  }) => {
    const { me } = await worker(seed, 3);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(page);
    await myWork.open();
    await expect(titles(page)).toHaveCount(3);
    // With the skip link: Tab, Enter. (The target of the issue is at most three Tab stops.)
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to task list' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(titles(page).first()).toBeFocused();
    // Without it, the number is recorded in the test report (it depends on the rail and the toolbar, not on this package).
    await myWork.open();
    await expect(titles(page)).toHaveCount(3);
    const walk = await tabsToFirstRow(page);
    test
      .info()
      .annotations.push({ type: 'tab-stops-without-skip-link', description: String(walk) });
    expect(walk).toBeGreaterThan(3);
    expect(walk).toBeLessThan(80);
  });

  test('S and P open the Status and Priority menus of the row; Esc returns to the row; P needs the permission', async ({
    seed,
    asUser,
  }) => {
    const { me } = await worker(seed, 4);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new MyWorkPage(page).open();
    await expect(titles(page)).toHaveCount(4);
    await titles(page).nth(1).focus();

    await page.keyboard.press('s');
    const rowOne = page.locator('[data-task]').nth(1);
    await expect(rowOne.getByRole('menu')).toBeVisible();
    await shot(page, 'status-menu-via-s-1366');
    await page.keyboard.press('Escape');
    await expect(rowOne.getByRole('menu')).toBeHidden();
    await expect(titles(page).nth(1)).toBeFocused();
    // J keeps working from there.
    await page.keyboard.press('j');
    await expect(titles(page).nth(2)).toBeFocused();

    await page.keyboard.press('p');
    await expect(page.locator('[data-task]').nth(2).getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(titles(page).nth(2)).toBeFocused();

    // Keys inside an open menu belong to the menu: J does not move the row.
    await page.keyboard.press('s');
    await expect(page.locator('[data-task]').nth(2).getByRole('menu')).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('Escape');
    await expect(titles(page).nth(2)).toBeFocused();

    // Without Task.SetPriority the P key does nothing (and the cell is plain text).
    const viewer = await seed.user(
      [(await seed.role(['Task.View', 'Task.ChangeStatus', 'Matter.View'], 'E2E nopri')).name],
      'keys-nopri',
    );
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `${tag} only`, assignedUserId: viewer.userId });
    const other = await asUser(viewer.username);
    await new MyWorkPage(other).open();
    await expect(titles(other)).toHaveCount(1);
    await titles(other).first().focus();
    await other.keyboard.press('p');
    await expect(other.getByRole('menu')).toHaveCount(0);
    await expect(titles(other).first()).toBeFocused();
    await other.keyboard.press('s');
    await expect(other.getByRole('menu')).toBeVisible();
  });

  test('g then m, t, p go between the work pages (Pod Work only with Pod.View); a late second key and typing do nothing', async ({
    seed,
    asUser,
  }) => {
    const { me } = await worker(seed, 2, [...PERMS, 'Pod.View'], true);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open();
    await expect(titles(page).first()).toBeVisible();
    await titles(page).first().focus();

    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/my-work/);
    await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/tasks(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Task Queue', level: 1 })).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/pods\/work/);
    await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();

    // A second key after more than 1.5 s starts nothing.
    await page.keyboard.press('g');
    await page.waitForTimeout(1800);
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/pods\/work/);

    // In a text field the keys are text.
    await new MyWorkPage(page).open();
    const filter = page.getByRole('textbox', { name: 'Filter by Title or Ref' });
    await filter.focus();
    await page.keyboard.type('gt');
    await expect(filter).toHaveValue('gt');
    await expect(page).toHaveURL(/\/my-work/);

    // Without Pod.View: g p stays put, and the help does not list it.
    const plain = await seed.user(
      [(await seed.role(['Task.View', 'Matter.View'], 'E2E nopod')).name],
      'keys-nopod',
    );
    const other = await asUser(plain.username);
    await new MyWorkPage(other).open();
    await other.keyboard.press('g');
    await other.keyboard.press('p');
    await expect(other).toHaveURL(/\/my-work/);
    await other.keyboard.press('?');
    const help = other.locator('[data-shortcut-help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Go to My Work');
    await expect(help).toContainText('Go to Task Queue');
    await expect(help).not.toContainText('Go to Pod Work');
  });

  test('the "Keyboard shortcuts" switch in the help turns the character keys off for this user and is remembered', async ({
    seed,
    asUser,
  }) => {
    const { me } = await worker(seed, 4);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await new MyWorkPage(page).open();
    await expect(titles(page)).toHaveCount(4);
    await titles(page).first().focus();

    await page.keyboard.press('?');
    const help = page.locator('[data-shortcut-help]');
    await expect(help).toBeVisible();
    for (const text of [
      'Move to the next task in the list',
      'Move to the previous task in the list',
      'Open the task you are on',
      'Open the Status menu',
      'Open the Priority menu',
      'Go to My Work',
      'Go to Task Queue',
    ]) {
      await expect(help).toContainText(text);
    }
    const toggle = page.getByRole('switch', { name: /Keyboard shortcuts/ });
    await expect(toggle).toBeChecked();
    await shot(page, 'help-switch-on-1366');
    await toggle.uncheck();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('switch', { name: /Keyboard shortcuts: off/ })).toBeVisible();
    await shot(page, 'help-switch-off-1366');
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();

    // Off: J, S, G sequences and the help key do nothing; the arrows still move.
    await titles(page).first().focus();
    await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(0);
    await page.keyboard.press('s');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.keyboard.press('g');
    await page.keyboard.press('t');
    await expect(page).toHaveURL(/\/my-work/);
    await page.keyboard.press('?');
    await expect(help).toBeHidden();
    await page.keyboard.press('ArrowDown');
    expect(await focusedRowIndex(page)).toBe(1);

    // Remembered after a reload; the account menu still opens the list, and the switch turns them on again.
    await page.reload();
    await expect(titles(page)).toHaveCount(4);
    await titles(page).first().focus();
    await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(0);
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
    await expect(help).toBeVisible();
    await page.getByRole('switch', { name: /Keyboard shortcuts/ }).check();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await titles(page).first().focus();
    await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(1);

    // The choice belongs to the user: another user still has them on.
    const { me: someone } = await worker(seed, 2);
    const fresh = await asUser(someone.username);
    await new MyWorkPage(fresh).open();
    await expect(titles(fresh)).toHaveCount(2);
    await titles(fresh).first().focus();
    await fresh.keyboard.press('j');
    expect(await focusedRowIndex(fresh)).toBe(1);
  });

  test('Task Queue and Pod Work have the same skip link and row keys', async ({ seed, asUser }) => {
    const { me, pod } = await worker(seed, 5, [...PERMS, 'Pod.View'], true);
    const page = await asUser(me.username);
    await page.setViewportSize({ width: 1366, height: 768 });

    await new TaskQueuePage(page).open();
    await expect(titles(page).first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to task list' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(titles(page).first()).toBeFocused();
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(2);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/\d+\?from=task-queue/);

    await page.goto(`/pods/work?podId=${pod!.podId}&view=all`);
    await expect(page.getByRole('heading', { name: 'Pod Work', level: 1 })).toBeVisible();
    await expect(titles(page)).toHaveCount(5);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to task list' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(titles(page).first()).toBeFocused();
    await page.keyboard.press('j');
    expect(await focusedRowIndex(page)).toBe(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\/\d+\?from=pod-work/);
  });

  test('a page without a task list has only "Skip to main content"', async ({ seed, asUser }) => {
    const { me } = await worker(seed, 1);
    const page = await asUser(me.username);
    // Matters has its own "Skip to table" since #283; the account page has no list.
    await page.goto('/profile');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await expect(page.getByRole('link', { name: 'Skip to task list' })).toHaveCount(0);
  });

  for (const [width, height] of [
    [1366, 768],
    [1920, 1080],
    [768, 1024],
    [375, 812],
  ] as const) {
    test(`axe at ${width}: skip link visible on focus, row focused, help dialog open`, async ({
      seed,
      asUser,
    }) => {
      test.skip(!axeAvailable(), 'axe-core not installed (set E2E_AXE_PATH to axe.min.js)');
      const { me } = await worker(seed, 6);
      const page = await asUser(me.username);
      await page.setViewportSize({ width, height });
      await new MyWorkPage(page).open();
      await expect(titles(page)).toHaveCount(6);
      await page.keyboard.press('Tab');
      const skip = page.getByRole('link', { name: 'Skip to task list' });
      await expect(skip).toBeFocused();
      const box = (await skip.boundingBox())!;
      expect(box.y, 'the focused skip link is on screen').toBeGreaterThanOrEqual(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      await shot(page, `skip-link-${width}`);
      await axeClean(page, `skip link focused at ${width}`);
      await page.keyboard.press('Enter');
      await expect(titles(page).first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(titles(page).nth(1)).toBeFocused();
      await shot(page, `row-focus-${width}`);
      await axeClean(page, `row focused at ${width}`);

      // The header's help button is hidden under 480 px (UXR2-02); the key works at every width.
      await page.keyboard.press('?');
      await expect(page.locator('[data-shortcut-help]')).toBeVisible();
      await shot(page, `help-${width}`);
      await axeClean(page, `help dialog at ${width}`);
    });
  }
});
