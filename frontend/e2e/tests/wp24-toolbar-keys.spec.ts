import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Quick views toolbar keys and the Closed-instead-of-Due suggestion (TQ-WP24, #236, #231). Screenshots go to E2E_SCREENSHOTS when set
 * (docs/ux/task-queue-review/fixes/wp-keyboard).
 */
const OUT = process.env['E2E_SCREENSHOTS'];
const SIZES = [
  [1366, 768],
  [768, 1024],
  [375, 812],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function axeClean(page: Page, what: string): Promise<void> {
  if (axeAvailable()) expect(await axeViolations(page), what).toEqual([]);
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Quick views' });
const stops = (page: Page) =>
  toolbar(page)
    .locator('> button')
    .evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).tabIndex === 0).length);

/** Tab presses from the top of the page until a row title has focus (the skip link not used), and how many of them landed in the Quick views. */
async function walkToFirstRow(page: Page): Promise<{ presses: number; inToolbar: number }> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let inToolbar = 0;
  for (let n = 1; n <= 80; n++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => ({
      title: !!document.activeElement?.matches('tbody a.wt-title'),
      toolbar: !!document.activeElement?.closest('[role="toolbar"][aria-label="Quick views"]'),
    }));
    if (at.toolbar) inToolbar++;
    if (at.title) return { presses: n, inToolbar };
  }
  return { presses: 81, inToolbar };
}

test.describe('Quick views are one toolbar (#236)', () => {
  test('one Tab stop, arrows, Home and End, Space and Enter keep aria-pressed; no trap; stops measured', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    const tag = uid();
    await seed.task(world, { title: `Keys task ${tag}` });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();

    await expect(toolbar(page)).toHaveAttribute('aria-orientation', 'horizontal');
    expect(await stops(page)).toBe(1);
    // The pressed view is the stop.
    await expect(toolbar(page).getByRole('button', { name: /^All open/ })).toHaveAttribute(
      'tabindex',
      '0',
    );

    const buttons = toolbar(page).locator('> button');
    const n = await buttons.count();
    await toolbar(page)
      .getByRole('button', { name: /^All open/ })
      .focus();
    await page.keyboard.press('ArrowRight');
    await expect(buttons.nth(1)).toBeFocused();
    expect(await stops(page)).toBe(1);
    await page.keyboard.press('End');
    await expect(buttons.nth(n - 1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(buttons.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(buttons.nth(n - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(buttons.nth(0)).toBeFocused();
    await shot(page, 'toolbar-focus-1366');

    // Space and Enter press the view; counts stay in the accessible names.
    await page.keyboard.press('ArrowRight');
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', /^Unassigned/);
    await page.keyboard.press('Space');
    await expect(buttons.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.nth(1)).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(buttons.nth(2)).toHaveAttribute('aria-pressed', 'true');

    // Tab leaves the toolbar (no trap) and Shift+Tab comes back to the pressed view.
    await page.keyboard.press('Tab');
    expect(await toolbar(page).evaluate((t) => t.contains(document.activeElement))).toBe(false);
    await page.keyboard.press('Shift+Tab');
    await expect(buttons.nth(2)).toBeFocused();

    // Measured: with the skip link two presses (Tab, Enter); without it the walk is recorded.
    await queue.open(`?q=${tag}`);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to task list' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('tbody a.wt-title').first()).toBeFocused();
    await queue.open(`?q=${tag}`);
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    const walk = await walkToFirstRow(page);
    // The quick views take one stop (nine buttons before). The whole walk is recorded: #236 asked for at most 25, which the toolbar alone
    // cannot reach (the side navigation, the filter row and the column sort buttons are the rest).
    test
      .info()
      .annotations.push({ type: 'tab-stops-without-skip-link', description: String(walk.presses) });
    expect(walk.inToolbar).toBe(1);
    expect(walk.presses).toBeLessThan(80);
  });

  test('the ? help lists the arrow keys in Quick views and the column menu key; J/K and g still work', async ({
    seed,
    asUser,
  }) => {
    const world = await seed.world();
    for (const t of ['One', 'Two']) await seed.task(world, { title: `Keys ${t}` });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open();
    await expect(page.locator('tbody tr[data-task]').first()).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const help = page.locator('[data-shortcut-help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Move between the Quick views');
    await expect(help).toContainText('Go to the first or last Quick view');
    await expect(help).toContainText('Open the column menu');
    await shot(page, 'help-1366');
    await page.keyboard.press('Escape');

    await page.locator('tbody a.wt-title').first().focus();
    await page.keyboard.press('j');
    await expect(page.locator('tbody a.wt-title').nth(1)).toBeFocused();
    await page.keyboard.press('k');
    await expect(page.locator('tbody a.wt-title').first()).toBeFocused();
    await page.keyboard.press('g');
    await page.keyboard.press('m');
    await expect(page).toHaveURL(/\/my-work/);
  });

  for (const [w, h] of SIZES) {
    test(`axe is clean with the toolbar focused at ${w}x${h}`, async ({ asUser }) => {
      const page = await asUser('ke\\kekim');
      await page.setViewportSize({ width: w, height: h });
      const queue = new TaskQueuePage(page);
      await queue.open();
      await expect(toolbar(page)).toBeVisible();
      await toolbar(page).locator('> button').first().focus();
      await page.keyboard.press('ArrowRight');
      await axeClean(page, `toolbar ${w}`);
      await shot(page, `toolbar-${w}`);
    });
  }
});

test.describe('Closed instead of Due suggestion (#231)', () => {
  const columnsButton = (page: Page) => page.getByRole('button', { name: 'Columns', exact: true });
  const suggest = (page: Page) => page.locator('[data-columns-suggest]');

  test('shows for Completed only, swaps on a click, restores, survives reload; not for Open; dismiss is remembered', async ({
    asUser,
  }) => {
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    const queue = new TaskQueuePage(page);
    await queue.open();
    await columnsButton(page).click();
    await expect(page.locator('[data-columns-panel]')).toBeVisible();
    await expect(suggest(page)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await queue.open('?status=COMPLETED');
    await expect(page.locator('thead th[data-col="due"]').first()).toBeVisible();
    await columnsButton(page).click();
    await expect(suggest(page)).toContainText('Showing finished tasks: show Closed instead of Due');
    await expect(page.locator('thead th[data-col="closed"]')).toHaveCount(0);
    await shot(page, 'closed-suggestion-1366');
    await page.getByRole('button', { name: 'Show Closed' }).click();
    await expect(page.locator('thead th[data-col="closed"]').first()).toBeVisible();
    await expect(page.locator('thead th[data-col="due"]')).toHaveCount(0);
    await expect(suggest(page)).toContainText('Restore Due');

    await page.reload();
    await expect(page.locator('thead th[data-col="closed"]').first()).toBeVisible();
    await columnsButton(page).click();
    await expect(suggest(page)).toHaveCount(0);

    // Put the set back, then dismiss: the line stays away after a reload.
    await page.getByRole('checkbox', { name: 'Due', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Closed', exact: true }).uncheck();
    await expect(suggest(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Dismiss the Closed suggestion' }).click();
    await expect(suggest(page)).toHaveCount(0);
    await page.reload();
    await columnsButton(page).click();
    await expect(suggest(page)).toHaveCount(0);
  });

  for (const [w, h] of SIZES) {
    test(`axe is clean with the suggestion at ${w}x${h}`, async ({ asUser }) => {
      const page = await asUser('ke\\kekim');
      await page.setViewportSize({ width: w, height: h });
      await new TaskQueuePage(page).open('?status=COMPLETED');
      await columnsButton(page).click();
      await expect(suggest(page)).toBeVisible();
      await axeClean(page, `suggestion ${w}`);
      await shot(page, `closed-suggestion-${w}`);
    });
  }
});
