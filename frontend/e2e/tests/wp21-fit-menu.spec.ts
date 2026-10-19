import fs from 'node:fs';
import path from 'node:path';
import { Locator, Page } from '@playwright/test';
import { TaskQueuePage } from '../pages/queues.pages';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { uid } from '../support/seed';

/**
 * Fit to content and the column header menu (TQ-WP21, #205, #207). Every test seeds its own tagged tasks and filters the list on the tag,
 * so nothing depends on global counts or the order of other specs' data. Screenshots go to E2E_SCREENSHOTS when set
 * (docs/ux/task-queue-review/fixes/wp-fit).
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

const th = (page: Page, key: string): Locator =>
  page.locator(`thead tr:first-child th[data-col="${key}"]`);
const sortButton = (page: Page, key: string): Locator => th(page, key).locator('button.wt-sort');
const handle = (page: Page, key: string): Locator =>
  page.locator(`thead .wt-resize[data-resize="${key}"]`);
const width = async (page: Page, key: string): Promise<number> =>
  (await th(page, key).boundingBox())!.width;
const menu = (page: Page): Locator => page.locator('[data-column-menu]');
const item = (page: Page, id: string): Locator => menu(page).locator(`[data-item="${id}"]`);
const note = (page: Page): Locator => page.locator('[data-width-note]');

/** Every widths entry the page stores (scope -> map). */
const stored = (page: Page): Promise<Record<string, Record<string, number>>> =>
  page.evaluate(() => {
    const out: Record<string, Record<string, number>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('mf.work-widths.v1.')) out[k] = JSON.parse(localStorage.getItem(k)!).w;
    }
    return out;
  });
const storedWidth = async (page: Page, key: string): Promise<number | undefined> =>
  Object.values(await stored(page))[0]?.[key];

/**
 * Cells of a column whose content is cut: the cell itself, or any element inside it, is narrower than what it holds (an ellipsis or a
 * clipped pill). Empty means everything is shown.
 */
async function clippedCells(page: Page, key: string): Promise<string[]> {
  return page.evaluate((k) => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>(`[data-task] td[data-col="${k}"]`).forEach((td) => {
      const cut = (e: HTMLElement) => e.scrollWidth > e.clientWidth + 1;
      if (cut(td))
        out.push(`${td.textContent?.trim()} (cell ${td.scrollWidth} > ${td.clientWidth})`);
      td.querySelectorAll<HTMLElement>('*').forEach((e) => {
        const box = e.getBoundingClientRect();
        if (box.width <= 2 && box.height <= 2) return; // screen-reader-only text
        const style = getComputedStyle(e);
        if ((style.overflow !== 'visible' || style.textOverflow === 'ellipsis') && cut(e))
          out.push(`${e.textContent?.trim()} (${e.className} ${e.scrollWidth} > ${e.clientWidth})`);
      });
    });
    return out;
  }, key);
}

/** The tagged page used by most tests: long matter, assignee, several due dates and statuses. */
async function seedLong(
  seed: Parameters<Parameters<typeof test>[2]>[0]['seed'],
  tag: string,
  count = 4,
) {
  const world = await seed.world();
  const client = await seed.client({ name: `Wp21 client ${tag}` });
  const matter = await seed.matter({
    client,
    name: `Extraordinary merger review of ${tag}`,
  });
  // A short account name: the Assignee column is fitted up to 240 px, and a random 11-digit suffix after a long label is cut by that limit.
  const me = await seed.user(['Data Technician'], 'fit');
  const day = 86_400_000;
  for (let i = 0; i < count; i++) {
    await seed.task(
      { ...world, matter },
      {
        title: `Fit ${i} ${tag}`,
        assignedUserId: me.userId,
        dueDate: new Date(Date.now() + (i - 2) * 40 * day).toISOString().slice(0, 10),
      },
    );
  }
  return { world, me };
}

async function openQueue(page: Page, tag: string, rows: number): Promise<void> {
  await new TaskQueuePage(page).open(`?q=${encodeURIComponent(tag)}`);
  await expect(page.locator('[data-task]')).toHaveCount(rows);
}

test.describe('Fit to content (#205)', () => {
  test('a double-click on a handle fits Matter, Assignee, Due and Status to the rows on the page: no clipping, stored, survives a reload; the Title has no handle', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 4);
    await expect(handle(page, 'matter')).toHaveAttribute(
      'title',
      'Double-click to fit the rows on this page',
    );
    expect(await handle(page, 'title').count()).toBe(0);

    const fitted: Record<string, number> = {};
    for (const key of ['matter', 'assignee', 'due', 'status']) {
      const before = await width(page, key);
      await handle(page, key).dblclick();
      await expect(note(page)).toContainText(new RegExp(`column \\d+ pixels`));
      await expect.poll(async () => Math.round(await width(page, key))).not.toBeNaN();
      const w = Math.round(await width(page, key));
      fitted[key] = w;
      expect(await clippedCells(page, key), `${key} is not cut at ${w}px`).toEqual([]);
      const limits: Record<string, [number, number]> = {
        matter: [112, 320],
        assignee: [112, 240],
        due: [120, 200],
        status: [112, 200],
      };
      expect(w).toBeGreaterThanOrEqual(limits[key][0]);
      expect(w).toBeLessThanOrEqual(limits[key][1]);
      console.log(`WP21 fit ${key}: ${Math.round(before)} -> ${w}`);
    }
    // The long matter name needs more than the default 160 px; every fitted column is the widest content plus padding, so the next
    // fit changes nothing (idempotent).
    expect(fitted['matter']).toBeGreaterThan(160);
    await handle(page, 'matter').dblclick();
    await page.waitForTimeout(150);
    expect(Math.abs((await width(page, 'matter')) - fitted['matter'])).toBeLessThanOrEqual(1);

    const entries = Object.values(await stored(page));
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0])).not.toContain('title');
    await shot(page, 'fit-all-1366x768');

    await page.reload();
    await expect(page.locator('[data-task]')).toHaveCount(4);
    for (const key of ['matter', 'assignee', 'due', 'status']) {
      expect(Math.round(await width(page, key))).toBe(fitted[key]);
      expect(await clippedCells(page, key), `${key} after reload`).toEqual([]);
    }
  });

  test('fit shrinks a column that is wider than its content and never goes under the minimum; the Title row stays filling', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    const world = await seed.world();
    await seed.task(world, { title: `Short ${tag}` });
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 1);
    // Make Status wide first with the menu-free route: the drag handle.
    const box = (await handle(page, 'status').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(Math.round(await width(page, 'status'))).toBe(190);
    await handle(page, 'status').dblclick();
    await expect.poll(async () => Math.round(await width(page, 'status'))).toBeLessThan(190);
    expect(Math.round(await width(page, 'status'))).toBeGreaterThanOrEqual(112);
    expect(await clippedCells(page, 'status')).toEqual([]);
  });

  test('200 rows: the fit is one forced layout and takes well under a second', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag, 2);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 2);
    await page.evaluate(() => {
      const body = document.querySelector('tbody')!;
      const first = body.querySelector('[data-task]')!;
      while (body.querySelectorAll('[data-task]').length < 200) body.append(first.cloneNode(true));
    });
    await handle(page, 'matter').dblclick();
    await expect
      .poll(() => page.locator('table.wt').evaluate((t) => (t as HTMLElement).dataset['fitMs']))
      .toBeTruthy();
    const ms = Number(
      await page.locator('table.wt').evaluate((t) => (t as HTMLElement).dataset['fitMs']),
    );
    console.log(`WP21 fit of 200 rows (matter): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });
});

test.describe('Column header menu (#207)', () => {
  test('keyboard only: Shift+F10 on Due, Widen with Enter grows it by 8 px, focus returns to the header, the live region says it, it persists; Narrow, Reset, Fit and Esc', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 4);
    const due0 = Math.round(await width(page, 'due'));
    expect(due0).toBe(136);

    await sortButton(page, 'due').focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await expect(menu(page)).toHaveAttribute('role', 'menu');
    await expect(menu(page)).toHaveAttribute('aria-label', 'Due column options');
    await expect(page.getByRole('menuitem', { name: 'Widen Due' })).toBeVisible();
    await expect(item(page, 'sort-asc')).toBeFocused();
    await shot(page, 'header-menu-due-1366x768');
    // Reset is off while nothing is stored.
    await expect(item(page, 'reset')).toHaveAttribute('aria-disabled', 'true');

    await page.keyboard.press('ArrowDown'); // Sort descending
    await page.keyboard.press('ArrowDown'); // Widen
    await expect(item(page, 'widen')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toHaveCount(0);
    await expect(sortButton(page, 'due')).toBeFocused();
    expect(Math.round(await width(page, 'due'))).toBe(144);
    await expect(note(page)).toHaveText('Due column 144 pixels');
    expect(await storedWidth(page, 'due')).toBe(144);

    // Narrow twice: 136, then 128.
    await page.keyboard.press('Shift+F10');
    await item(page, 'narrow').focus();
    await page.keyboard.press('Enter');
    expect(Math.round(await width(page, 'due'))).toBe(136);
    expect(await stored(page)).toEqual({}); // equal to the default: nothing stored
    await page.keyboard.press('Shift+F10');
    await item(page, 'narrow').focus();
    await page.keyboard.press('Space');
    expect(Math.round(await width(page, 'due'))).toBe(128);
    await expect(note(page)).toHaveText('Due column 128 pixels');

    // Reload keeps it.
    await page.reload();
    await expect(page.locator('[data-task]')).toHaveCount(4);
    expect(Math.round(await width(page, 'due'))).toBe(128);

    // Reset width returns the default and empties the store.
    await sortButton(page, 'due').focus();
    await page.keyboard.press('ContextMenu');
    await expect(menu(page)).toBeVisible();
    await expect(item(page, 'reset')).not.toHaveAttribute('aria-disabled', 'true');
    await item(page, 'reset').focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => Math.round(await width(page, 'due'))).toBe(136);
    await expect(note(page)).toHaveText('Due column 136 pixels');
    expect(await stored(page)).toEqual({});
    await expect(sortButton(page, 'due')).toBeFocused();

    // Fit to content from the menu is the same as the double-click.
    await sortButton(page, 'matter').focus();
    await page.keyboard.press('Shift+F10');
    await item(page, 'fit').focus();
    await page.keyboard.press('Enter');
    await expect(note(page)).toContainText('Matter column');
    expect(await clippedCells(page, 'matter')).toEqual([]);
    expect(Math.round(await width(page, 'matter'))).toBeGreaterThan(160);
    await expect(sortButton(page, 'matter')).toBeFocused();

    // Esc closes and returns focus to the header; Tab closes too.
    await sortButton(page, 'status').focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await expect(sortButton(page, 'status')).toBeFocused();
    await page.keyboard.press('Shift+F10');
    // The menu opens after a frame: a Tab pressed before it has focus would move on in the header and the menu would open behind it.
    await expect(item(page, 'sort-asc')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu(page)).toHaveCount(0);
    await expect(sortButton(page, 'status')).toBeFocused();
  });

  test('menu items: Sort ascending/descending sorts, Widen stops at the maximum, the Title has only Sort and a disabled Fit that says why; Ref cannot be hidden', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 4);

    await sortButton(page, 'due').focus();
    await page.keyboard.press('Shift+F10');
    await item(page, 'sort-desc').click();
    await expect(th(page, 'due')).toHaveAttribute('aria-sort', 'descending');
    expect(page.url()).toContain('sort=due');
    await sortButton(page, 'due').focus();
    await page.keyboard.press('Shift+F10');
    await item(page, 'sort-asc').click();
    await expect(th(page, 'due')).toHaveAttribute('aria-sort', 'ascending');

    // Title: sort items and a Fit that is off, with the reason; no width items and no Hide.
    await sortButton(page, 'title').focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page).locator('[role="menuitem"]')).toHaveCount(3);
    await expect(item(page, 'fit')).toHaveAttribute('aria-disabled', 'true');
    await expect(item(page, 'fit')).toContainText('Fills the space left');
    await expect(item(page, 'widen')).toHaveCount(0);
    await item(page, 'fit').click({ force: true }); // aria-disabled: does nothing, the menu stays
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await stored(page)).toEqual({});

    await sortButton(page, 'ref').focus();
    await page.keyboard.press('Shift+F10');
    await expect(item(page, 'hide')).toHaveCount(0);
    await expect(item(page, 'widen')).toBeVisible();
    await page.keyboard.press('Escape');

    // Widen until the maximum (Due 200 px: 8 steps of 8 px from 136 reach 200), then Widen is off.
    for (let i = 0; i < 8; i++) {
      await sortButton(page, 'due').focus();
      await page.keyboard.press('Shift+F10');
      await item(page, 'widen').click();
    }
    expect(Math.round(await width(page, 'due'))).toBe(200);
    await sortButton(page, 'due').focus();
    await page.keyboard.press('Shift+F10');
    await expect(item(page, 'widen')).toHaveAttribute('aria-disabled', 'true');
    await expect(item(page, 'narrow')).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
  });

  test('right click opens the same menu at the pointer; an outside click closes it; a column that cannot sort gets the menu through its header', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openQueue(page, tag, 4);

    const box = (await th(page, 'matter').boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 12, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    const m = (await menu(page).boundingBox())!;
    expect(Math.abs(m.x - (box.x + 20))).toBeLessThanOrEqual(24);
    expect(Math.abs(m.y - (box.y + 12))).toBeLessThanOrEqual(24);
    await shot(page, 'header-menu-right-click-1366x768');
    await page.getByRole('heading', { name: 'Task Queue', level: 1 }).click();
    await expect(menu(page)).toHaveCount(0);

    // Menu key on a header that cannot sort: Project through the Columns panel (it is not a default column).
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await page.getByLabel('Project', { exact: true }).check();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await expect(th(page, 'project')).toBeVisible();
    await expect(th(page, 'project')).toHaveAttribute('tabindex', '0');
    await th(page, 'project').focus();
    await page.keyboard.press('ContextMenu');
    await expect(menu(page)).toBeVisible();
    await expect(item(page, 'sort-asc')).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Widen Project' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(th(page, 'project')).toBeFocused();
    // A sortable header is not a tab stop of its own: only its sort button is.
    await expect(th(page, 'due')).not.toHaveAttribute('tabindex', /.*/);
  });

  test('Hide column removes it, the Columns panel shows it unchecked, focus moves to the next header; clicking a header still sorts and a drag still resizes', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 4);

    await sortButton(page, 'matter').focus();
    await page.keyboard.press('Shift+F10');
    await item(page, 'hide').click();
    await expect(th(page, 'matter')).toHaveCount(0);
    await expect(note(page)).toHaveText('Matter column hidden');
    await expect(sortButton(page, 'priority')).toBeFocused();
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Matter' })).not.toBeChecked();
    await page.keyboard.press('Escape');

    // The sort click, the column filter inputs and the drag handle are untouched.
    await sortButton(page, 'status').click();
    await expect(th(page, 'status')).toHaveAttribute('aria-sort', /ascending|descending/);
    await expect(menu(page)).toHaveCount(0);
    const filter = page.getByRole('textbox', { name: 'Filter by Title or Ref' });
    await expect(filter).toHaveValue(tag);
    await filter.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toHaveCount(0);
    const h = (await handle(page, 'due').boundingBox())!;
    const before = await width(page, 'due');
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 - 30, h.y + h.height / 2, { steps: 5 });
    await page.mouse.up();
    expect(Math.abs((await width(page, 'due')) - (before + 30))).toBeLessThanOrEqual(1);
  });

  test('the help lists it, and Menu / Shift+F10 stay on when the "Keyboard shortcuts" switch is off', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 1366, height: 768 });
    await openQueue(page, tag, 4);
    await sortButton(page, 'due').focus();
    await page.keyboard.press('?');
    const help = page.locator('[data-shortcut-help]');
    await expect(help).toBeVisible();
    await expect(help).toContainText('Open the column menu');
    await expect(help).toContainText('Shift + F10');
    await shot(page, 'help-column-menu-1366x768');
    await page.getByRole('switch', { name: /Keyboard shortcuts/ }).uncheck();
    await page.keyboard.press('Escape');
    await expect(help).toBeHidden();
    await sortButton(page, 'due').focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: /Keyboard shortcuts/ })
      .first()
      .isVisible();
  });

  test('touch: a long press (500 ms) at 768 opens the menu and does not sort; a tap still sorts', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    await page.setViewportSize({ width: 768, height: 1024 });
    await openQueue(page, tag, 4);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await page.reload();
    await expect(page.locator('[data-task]')).toHaveCount(4);

    const box = (await sortButton(page, 'matter').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(th(page, 'matter')).toHaveAttribute('aria-sort', /ascending|descending/);
    await expect(menu(page)).toHaveCount(0);

    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(650);
    await expect(menu(page)).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    await expect(menu(page)).toBeVisible();
    // The release did not sort again: still the one tap's direction.
    await expect(th(page, 'matter')).toHaveAttribute('aria-sort', 'ascending');
    await shot(page, 'header-menu-long-press-768x1024');
    await axeClean(page, 'long-press menu open at 768');
  });

  test('axe with the menu open at 1366, 1920 and 768; at 375 there is no menu, no handle and no extra tab stop', async ({
    seed,
    asUser,
  }) => {
    const tag = uid();
    await seedLong(seed, tag);
    const page = await asUser('ke\\kekim');
    for (const [w, h] of [
      [1366, 768],
      [1920, 1080],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width: w, height: h });
      await openQueue(page, tag, 4);
      await sortButton(page, 'due').focus();
      await page.keyboard.press('Shift+F10');
      await expect(menu(page)).toBeVisible();
      await axeClean(page, `menu open at ${w}`);
      await shot(page, `header-menu-open-${w}x${h}`);
      await page.keyboard.press('Escape');
      await axeClean(page, `menu closed at ${w}`);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await openQueue(page, tag, 4);
    // Below 640 px the list is cards (#192): no headers, so no menu, no handle and no extra tab stop.
    await expect(page.locator('thead')).toHaveCount(0);
    await expect(page.locator('.wt-resize')).toHaveCount(0);
    await expect(page.locator('[data-task] [tabindex]:not(a):not(button)')).toHaveCount(0);
    await axeClean(page, 'phone');
    await shot(page, 'no-menu-375x812');
  });
});
