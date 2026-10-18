import { Page } from '@playwright/test';
import { MyWorkPage, PodWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * My Work review, work package 1 (#139, #140, #141, #169): confirm dialogs wrap, one dismiss rule for popovers, one shortcut list,
 * the Columns panel. Data is tagged with a token per test, so the specs do not depend on counts or order in the shared database.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/my-work-review/fixes/wp1 (otherwise none are written).
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

async function pageAxe(page: Page, label: string): Promise<void> {
  if (!axeAvailable()) return;
  expect(await axeViolations(page), label).toEqual([]);
}

const columnsButton = (page: Page) => page.getByRole('button', { name: 'Columns', exact: true });
const columnsPanel = (page: Page) => page.locator('[data-columns-panel]');

test.describe('WP1: dialogs, popovers, shortcut list', () => {
  test('confirm dialogs wrap their text at every width and never scroll sideways (#139)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp1-${token}`);
    const world = await seed.world();
    const long = `Longtitle${token}${'x'.repeat(80)}`;
    await seed.task(world, { title: long, assignedUserId: me.userId });
    const mine = await asUser(me.username);

    for (const size of SIZES) {
      await mine.setViewportSize({ width: size.width, height: size.height });
      const myWork = new MyWorkPage(mine);
      await myWork.open();
      const row = myWork.row(`Longtitle${token}`);
      await expect(row).toHaveCount(1);

      const status = row.getByRole('button', { name: /change status of/ });
      await status.scrollIntoViewIfNeeded();
      await status.click();
      await mine.locator('[data-option="HOLD"]').click();
      const dialog = mine.getByRole('dialog').filter({ has: mine.locator('[data-reason-body]') });
      await expect(dialog).toBeVisible();
      const body = dialog.locator('[data-confirm-body]');
      await expect(body).toContainText("Workflow steps can't be changed while it is on hold.");
      const m = await body.evaluate((e) => ({
        sw: e.scrollWidth,
        cw: e.clientWidth,
        ws: getComputedStyle(e).whiteSpace,
        dialogRight: (e.closest('[role=dialog]') as HTMLElement).getBoundingClientRect().right,
        vw: window.innerWidth,
      }));
      expect(m.ws, size.name).not.toBe('nowrap');
      expect(m.sw, size.name).toBeLessThanOrEqual(m.cw);
      expect(m.dialogRight, size.name).toBeLessThanOrEqual(m.vw);
      await shot(mine, `inline-hold-dialog-${size.name}`);
      await pageAxe(mine, `hold dialog ${size.name}`);
      await mine.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
  });

  test('the Complete dialog is fully readable (#139)', async ({ seed, asUser }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp1c-${token}`);
    const world = await seed.world();
    await seed.task(world, { title: `Complete ${token}`, assignedUserId: me.userId });
    const mine = await asUser(me.username);
    for (const size of [SIZES[0], SIZES[3]]) {
      await mine.setViewportSize({ width: size.width, height: size.height });
      const myWork = new MyWorkPage(mine);
      await myWork.open();
      const row = myWork.row(`Complete ${token}`);
      await expect(row).toHaveCount(1);
      // Scrolled into view first: the table scrolls sideways at 375 px, and a scroll that lands just after the click closes the menu by design.
      const status = row.getByRole('button', { name: /change status of/ });
      await status.scrollIntoViewIfNeeded();
      await status.click();
      await mine.locator('[data-option="COMPLETE"]').click();
      const body = mine.locator('[data-confirm-body]').last();
      await expect(body).toBeVisible();
      const m = await body.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
      expect(m.sw, size.name).toBeLessThanOrEqual(m.cw);
      await shot(mine, `inline-complete-dialog-${size.name}`);
      await pageAxe(mine, `complete dialog ${size.name}`);
      await mine.keyboard.press('Escape');
    }
  });

  test('Columns: Esc and outside click close it, focus returns, other popovers replace it, scroll cue and footer visible (#140, #169)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp1p-${token}`);
    const world = await seed.world();
    await seed.task(world, { title: `Cols ${token}`, assignedUserId: me.userId });
    const mine = await asUser(me.username);

    for (const size of SIZES) {
      await mine.setViewportSize({ width: size.width, height: size.height });
      const myWork = new MyWorkPage(mine);
      await myWork.open();

      await columnsButton(mine).click();
      await expect(columnsPanel(mine)).toBeVisible();
      await expect(columnsButton(mine)).toHaveAttribute('aria-expanded', 'true');
      await expect(columnsButton(mine)).toHaveAttribute('aria-controls', 'cc-panel');

      // The footer is visible without scrolling and the panel stays inside the window.
      const box = await columnsPanel(mine).boundingBox();
      expect(box, size.name).not.toBeNull();
      expect(box!.y + box!.height, size.name).toBeLessThanOrEqual(size.height);
      await expect(mine.locator('[data-columns-close]')).toBeInViewport();
      // Every column is reachable: the list scrolls inside the panel when it is cut.
      const scroll = await mine
        .locator('[data-columns-scroll]')
        .evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
      if (scroll.sh > scroll.ch) {
        // The list is grouped (#230) and Column widths follow it (#206): the last choice, Status, is reached by scrolling.
        await mine.getByRole('checkbox', { name: /^Status/ }).scrollIntoViewIfNeeded();
        await expect(mine.getByRole('checkbox', { name: /^Status/ })).toBeInViewport();
        await mine.locator('[data-columns-scroll]').evaluate((e) => e.scrollTo(0, 0));
      }
      await shot(mine, `columns-panel-${size.name}`);
      await pageAxe(mine, `columns panel ${size.name}`);

      // Esc closes it and the button has focus.
      await mine.getByRole('checkbox', { name: /^Matter/ }).focus();
      await mine.keyboard.press('Escape');
      await expect(columnsPanel(mine)).toHaveCount(0);
      await expect(columnsButton(mine)).toBeFocused();

      // A click on the page closes it.
      await columnsButton(mine).click();
      await expect(columnsPanel(mine)).toBeVisible();
      await mine.getByRole('heading', { name: 'My Work', level: 1 }).click();
      await expect(columnsPanel(mine)).toHaveCount(0);

      // Opening another popover (the sort info) closes Columns; the trigger click toggles.
      const sortInfo = mine.getByRole('button', { name: 'How the default order works' });
      await columnsButton(mine).click();
      await expect(columnsPanel(mine)).toBeVisible();
      if (size.width > 480) {
        await sortInfo.click();
        await expect(columnsPanel(mine)).toHaveCount(0);
        await expect(mine.locator('[data-sort-rule]')).toBeVisible();
        await mine.keyboard.press('Escape');
        await expect(mine.locator('[data-sort-rule]')).toHaveCount(0);
        await columnsButton(mine).click();
        await expect(columnsPanel(mine)).toBeVisible();
      } else {
        // On a phone the Columns sheet covers the toolbar below the tabs (the needs-attention strip pushes it down), so the sort info cannot
        // be reached while it is open. The replacement is checked the other way round: Done, open the sort info, and the Columns button
        // (above the sheet) replaces it.
        await mine.locator('[data-columns-close]').click();
        await expect(columnsPanel(mine)).toHaveCount(0);
        await sortInfo.click();
        await expect(mine.locator('[data-sort-rule]')).toBeVisible();
        await columnsButton(mine).click();
        await expect(mine.locator('[data-sort-rule]')).toHaveCount(0);
        await expect(columnsPanel(mine)).toBeVisible();
      }
      // At 375 the panel is a bottom sheet over the button: Done closes it; wider, the button toggles.
      if (size.width > 480) await columnsButton(mine).click();
      else await mine.locator('[data-columns-close]').click();
      await expect(columnsPanel(mine)).toHaveCount(0);
    }
  });

  test('Esc closes only the popover when a text filter has text; the next Esc clears the filter (#140)', async ({
    seed,
    asUser,
  }) => {
    const token = uid();
    const me = await seed.user(['Data Technician'], `wp1e-${token}`);
    const world = await seed.world();
    await seed.task(world, { title: `Esc ${token}`, assignedUserId: me.userId });
    const mine = await asUser(me.username);
    await mine.setViewportSize({ width: 1366, height: 768 });
    const myWork = new MyWorkPage(mine);
    await myWork.open();
    await expect(myWork.row(`Esc ${token}`)).toHaveCount(1);
    await myWork.titleFilter.fill(`Esc ${token}`);
    await expect(myWork.row(`Esc ${token}`)).toHaveCount(1);

    await columnsButton(mine).click();
    await mine.getByRole('checkbox', { name: /^Matter/ }).focus();
    await mine.keyboard.press('Escape');
    await expect(columnsPanel(mine)).toHaveCount(0);
    await expect(myWork.titleFilter).toHaveValue(`Esc ${token}`);

    await myWork.titleFilter.focus();
    await mine.keyboard.press('Escape');
    await expect(myWork.titleFilter).toHaveValue('');
  });

  test('Other filters, the date range panel and an inline menu follow the same rule on Task Queue (#140)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const world = await seed.world();
    await seed.task(world, { title: `Rule ${token}` });
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await queue.search(`Rule ${token}`);

    const more = page.getByRole('button', { name: 'Other filters' });
    await more.click();
    await expect(page.getByRole('dialog', { name: 'Other filters' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Other filters' })).toHaveCount(0);
    await expect(more).toBeFocused();

    await more.click();
    await columnsButton(page).click();
    await expect(page.getByRole('dialog', { name: 'Other filters' })).toHaveCount(0);
    await expect(columnsPanel(page)).toBeVisible();
    await page.keyboard.press('Escape');

    const row = queue.row(`Rule ${token}`);
    const trigger = row.getByRole('button', { name: /change status of/ });
    await trigger.click();
    await expect(page.getByRole('menu').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole('heading', { name: 'Task Queue', level: 1 }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('the ? list shows "/" once under Work lists on the three work lists, and as the page shortcut elsewhere (#141)', async ({
    seed,
    asUser,
    page: admin,
  }) => {
    // A pod member, so Pod Work has a pod and its filter row (without one the page has nothing to filter and "/" is not offered).
    const tech = await seed.user(['Data Technician'], `wp1h-${uid()}`);
    await seed.pod(undefined, [tech.userId]);
    const page = await asUser(tech.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    const workLists = [
      { open: () => new MyWorkPage(page).open() },
      { open: () => new TaskQueuePage(page).open() },
      { open: () => new PodWorkPage(page).open() },
    ];
    for (const list of workLists) {
      await list.open();
      await page.locator('main').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('?');
      const help = page.locator('[data-shortcut-help]');
      await expect(help).toBeVisible();
      const group = help.locator('section').filter({
        has: page.getByRole('heading', { name: 'Work lists (Task Queue, My Work, Pod Work)' }),
      });
      await expect(group).toHaveCount(1);
      await expect(group).toContainText('Focus the Title or Ref filter');
      await expect(help.locator('kbd', { hasText: '/' })).toHaveCount(1);
      await expect(help.getByRole('heading', { name: 'Task Queue', exact: true })).toHaveCount(0);
      await pageAxe(page, 'shortcut help on a work list');
      await shot(page, 'keyboard-help-work-lists-1366x768');
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);
    }

    await admin.setViewportSize({ width: 1366, height: 768 });
    // A page without a text filter does not list "/".
    await admin.goto('/profile');
    await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
    await admin.keyboard.press('?');
    const help = admin.locator('[data-shortcut-help]');
    await expect(help).toBeVisible();
    await expect(help.locator('kbd', { hasText: '/' })).toHaveCount(0);
    await admin.keyboard.press('Escape');

    // Clients has a text filter: "/" is listed as that page's own shortcut, and works.
    await admin.goto('/clients');
    await expect(admin.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await admin.locator('main').click({ position: { x: 5, y: 5 } });
    await admin.keyboard.press('?');
    await expect(help).toBeVisible();
    await expect(help.getByRole('heading', { name: 'This page' })).toBeVisible();
    await expect(help.locator('kbd', { hasText: '/' })).toHaveCount(1);
    await admin.keyboard.press('Escape');
  });
});
