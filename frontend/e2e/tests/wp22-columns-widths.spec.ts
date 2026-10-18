import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { MyWorkPage, TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Columns panel: Column widths and the grouped list (TQ-WP22, #206, #230). The keyboard and single-pointer way to size a column (WCAG
 * 2.1.1, 2.5.7). Every test seeds its own tagged tasks. Screenshots go to E2E_SCREENSHOTS when set (docs/ux/task-queue-review/fixes/wp-columns).
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

const columnsButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Columns', exact: true });
const panel = (page: Page): Locator => page.locator('[data-columns-panel]');
const live = (page: Page): Locator => page.locator('[data-columns-live]');
const row = (page: Page, key: string): Locator => page.locator(`[data-width-row="${key}"]`);
const field = (page: Page, key: string): Locator => row(page, key).locator('[data-width-input]');
const th = (page: Page, key: string): Locator =>
  page.locator(`thead tr:first-child th[data-col="${key}"]`);
const gridWidth = async (page: Page, key: string): Promise<number> =>
  Math.round((await th(page, key).boundingBox())!.width);
const stored = (page: Page): Promise<Record<string, Record<string, number>>> =>
  page.evaluate(() => {
    const out: Record<string, Record<string, number>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('mf.work-widths.v1.')) out[k] = JSON.parse(localStorage.getItem(k)!).w;
    }
    return out;
  });

async function openQueue(page: Page, tag: string, rows: number): Promise<void> {
  await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
  await expect(page.locator('tbody tr[data-task]')).toHaveCount(rows);
}

/** Opens the panel the way a keyboard user does: focus on the button, Enter. */
async function openPanel(page: Page): Promise<void> {
  await columnsButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();
}

async function seedTasks(seed: Parameters<Parameters<typeof test>[2]>[0]['seed'], tag: string) {
  const world = await seed.world();
  const client = await seed.client({ name: `Wp22 client ${tag}` });
  const matter = await seed.matter({ client, name: `Merger review of ${tag}` });
  for (let i = 0; i < 3; i++) {
    await seed.task(
      { ...world, matter },
      {
        title: `Widths ${i} ${tag}`,
        dueDate: new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10),
      },
    );
  }
}

test.describe('Column widths in the Columns panel (#206)', () => {
  test('keyboard only: Columns > Column widths > Widen Due three times > Esc gives 160 px and focus returns to the button; persists', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedTasks(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 3);
    expect(await gridWidth(page, 'due')).toBe(136);

    await openPanel(page);
    await expect(page.locator('[data-widths-set] legend')).toHaveText('Column widths');
    await expect(row(page, 'title')).toContainText('Fills the space left');
    await expect(row(page, 'title').locator('input')).toHaveCount(0);

    // Tab from the field reaches Widen, Fit and Reset width in order.
    await field(page, 'due').focus();
    await page.keyboard.press('Tab');
    await expect(row(page, 'due').getByRole('button', { name: 'Widen Due' })).toBeFocused();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await expect(field(page, 'due')).toHaveValue('160');
    await expect(live(page)).toHaveText('Due column 160 pixels');
    expect(await gridWidth(page, 'due')).toBe(160);
    await page.keyboard.press('Tab');
    await expect(
      row(page, 'due').getByRole('button', { name: 'Fit Due to content' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(row(page, 'due').getByRole('button', { name: /^Reset width/ })).toBeFocused();
    await shot(page, 'widths-panel-1366x768');

    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(columnsButton(page)).toBeFocused();

    expect(Object.values(await stored(page))).toEqual([{ due: 160 }]);
    await page.reload();
    await expect(page.locator('tbody tr[data-task]')).toHaveCount(3);
    expect(await gridWidth(page, 'due')).toBe(160);
  });

  test('Shift steps 32 px, a typed number clamps and shows the clamped value, Up and Down step by 8', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedTasks(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 3);
    await openPanel(page);

    const widen = row(page, 'due').getByRole('button', { name: 'Widen Due' });
    await widen.focus();
    await page.keyboard.press('Shift+Enter');
    await expect(field(page, 'due')).toHaveValue('168');
    expect(await gridWidth(page, 'due')).toBe(168);
    await row(page, 'due')
      .getByRole('button', { name: 'Narrow Due' })
      .click({ modifiers: ['Shift'] });
    await expect(field(page, 'due')).toHaveValue('136');
    await expect(live(page)).toHaveText('Due column 136 pixels');

    await field(page, 'due').fill('999');
    await page.keyboard.press('Enter');
    await expect(field(page, 'due')).toHaveValue('200');
    expect(await gridWidth(page, 'due')).toBe(200);
    await expect(widen).toHaveAttribute('aria-disabled', 'true');
    await field(page, 'due').fill('5');
    await page.keyboard.press('Tab');
    await expect(field(page, 'due')).toHaveValue('120');
    expect(await gridWidth(page, 'due')).toBe(120);

    await field(page, 'due').focus();
    await page.keyboard.press('ArrowUp');
    await expect(field(page, 'due')).toHaveValue('128');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(field(page, 'due')).toHaveValue('120');
  });

  test('Fit, Reset width and Reset all widths; Reset columns leaves widths alone; the live region says what happened', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedTasks(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 3);
    await openPanel(page);

    const resetDue = row(page, 'due').getByRole('button', { name: /^Reset width/ });
    const resetAll = page.locator('[data-widths-reset]');
    await expect(resetDue).toHaveAttribute('aria-disabled', 'true');
    await expect(resetAll).toHaveAttribute('aria-disabled', 'true');

    // The matter name is longer than its default 160 px: Fit takes it to what the rows need.
    await row(page, 'matter').getByRole('button', { name: 'Fit Matter to content' }).click();
    await expect(live(page)).toHaveText(/^Matter column \d+ pixels$/);
    const fitted = Number(await field(page, 'matter').inputValue());
    expect(fitted).toBeGreaterThan(160);
    expect(await gridWidth(page, 'matter')).toBe(fitted);

    await row(page, 'due').getByRole('button', { name: 'Widen Due' }).click();
    await expect(resetDue).not.toHaveAttribute('aria-disabled', 'true');
    await resetDue.click();
    await expect(field(page, 'due')).toHaveValue('136');
    await expect(live(page)).toHaveText('Due column 136 pixels');
    expect(Object.values(await stored(page))[0]).toEqual({ matter: fitted });

    // Hiding and showing a column keeps its width; Reset columns does not touch widths.
    await page.getByRole('checkbox', { name: 'Status' }).uncheck();
    await expect(row(page, 'status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reset columns' }).click();
    await expect(row(page, 'status')).toHaveCount(1);
    expect(Object.values(await stored(page))[0]).toEqual({ matter: fitted });

    await expect(resetAll).not.toHaveAttribute('aria-disabled', 'true');
    await resetAll.click();
    await expect(live(page)).toHaveText('All column widths reset to the default.');
    await expect(field(page, 'matter')).toHaveValue('160');
    expect(await gridWidth(page, 'matter')).toBe(160);
    expect(await stored(page)).toEqual({});
    await expect(resetAll).toHaveAttribute('aria-disabled', 'true');
    await expect(resetAll).toBeFocused();
  });

  test('widths are kept per page and tab: Task Queue widths do not reach My Work', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedTasks(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 3);
    await openPanel(page);
    await row(page, 'due')
      .getByRole('button', { name: 'Widen Due' })
      .click({ modifiers: ['Shift'] });
    expect(await gridWidth(page, 'due')).toBe(168);
    await page.keyboard.press('Escape');

    await new MyWorkPage(page).open();
    await page.locator('table').first().waitFor();
    expect(await gridWidth(page, 'due')).toBe(136);
    await openPanel(page);
    await expect(field(page, 'due')).toHaveValue('136');
    await expect(page.locator('[data-widths-reset]')).toHaveAttribute('aria-disabled', 'true');
    expect(Object.keys(await stored(page))).toHaveLength(1);
  });
});

test.describe('Columns panel groups (#230)', () => {
  test('five labelled groups, every column once, Ref and Title locked with the reason', async ({
    asUser,
  }) => {
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await new TaskQueuePage(page).open();
    await openPanel(page);
    const legends = page.locator('[data-columns-group] legend');
    await expect(legends).toHaveText(['Task', 'Where', 'Who', 'When', 'State']);
    const boxes = page.locator('[data-columns-group] input[type=checkbox]');
    await expect(boxes).toHaveCount(19);
    await expect(page.locator('[data-columns-group] input[type=checkbox]:disabled')).toHaveCount(2);
    await expect(page.locator('[data-columns-group="Task"]')).toContainText('(always shown)');
    // The whole list is reachable: the scroll area scrolls and the footer stays in view.
    await page.locator('[data-columns-scroll]').evaluate((e) => (e.scrollTop = e.scrollHeight));
    await expect(page.getByRole('checkbox', { name: 'Status' })).toBeInViewport();
    await expect(page.locator('[data-columns-close]')).toBeInViewport();
    await shot(page, 'groups-1366x768');
  });
});

for (const size of [
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
]) {
  test(`axe: Columns panel with Column widths open at ${size.width}x${size.height}`, async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedTasks(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize(size);
    await openQueue(page, tag, 3);
    await openPanel(page);
    await expect(page.locator('[data-widths-set]')).toBeVisible();
    await row(page, 'due').getByRole('button', { name: 'Widen Due' }).click();
    await axeClean(page, `panel open ${size.width}`);
    await shot(page, `panel-${size.width}x${size.height}`);
  });
}

test('375 px: the panel is a bottom sheet with Columns and Density, without Column widths; axe is clean', async ({
  seed,
  asUser,
}) => {
  const tag = uid();
  await seedTasks(seed, tag);
  const page = await asUser('ke\\kekim');
  await page.setViewportSize({ width: 375, height: 812 });
  await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
  await openPanel(page);
  await expect(page.locator('[data-columns-group]')).toHaveCount(5);
  await expect(page.locator('[data-widths-set]')).toBeHidden();
  await expect(page.locator('[data-widths-reset]')).toBeHidden();
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeVisible();
  await axeClean(page, 'panel open 375');
  await shot(page, 'panel-375x812');
});
