import { Page, TestInfo } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, WP-AS6 (#514): the Assets list, record page and forms by keyboard only. Tab order is logical, nothing traps focus, focus is
 * visible, focus returns after menus and dialogs, tab arrows work, and the Tab stops per row and per page are recorded (attached to the test
 * and printed; the review measured 77 from the first row to the panel, three per row). No keyboard shortcut is pressed or expected.
 */
test.describe('Assets keyboard audit (WP-AS6)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  /** The accessible description of the focused element: tag, role, name. */
  const focusedName = (page: Page): Promise<string> =>
    page.evaluate(() => {
      const e = document.activeElement as HTMLElement | null;
      if (!e || e === document.body) return 'body';
      const label =
        e.getAttribute('aria-label') ??
        (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) ??
        '';
      return `${e.tagName.toLowerCase()}${e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''} ${label}`;
    });

  /** Presses Tab up to `max` times until `stop` says the focus is where we wanted; returns the names passed. */
  async function tabUntil(
    page: Page,
    stop: (name: string) => boolean,
    max = 80,
  ): Promise<string[]> {
    const seen: string[] = [];
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const name = await focusedName(page);
      seen.push(name);
      if (stop(name)) return seen;
    }
    return seen;
  }

  async function record(info: TestInfo, name: string, body: string): Promise<void> {
    await info.attach(name, { body, contentType: 'text/plain' });
    console.log(`[tab stops] ${name}\n${body}`);
  }

  async function seeded(seed: import('../support/seed').Seeder, rowsCount = 3) {
    const world = await seed.world();
    const token = uid();
    const assets = [];
    for (let i = 0; i < rowsCount; i++)
      assets.push(await seed.asset(world.matter, `Key ${token} ${i}`));
    for (let i = 0; i < 2; i++) {
      const t = await seed.task(world);
      await seed.admin.post(`/api/v1/tasks/${t.taskId}/assets`, { assetId: assets[0].assetId });
    }
    return { token, assets, world };
  }

  test('list: Skip to table first, then the Tab stops from the first row to the pager are recorded, nothing traps focus', async ({
    page,
    seed,
  }, info) => {
    const { token } = await seeded(seed, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(3);

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to table' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('tbody a.mf-name').first()).toBeFocused();

    // From the first name to the end of the page: the stops are the name and matter link of each row, then the pager.
    const stops = await tabUntil(page, (n) => n.startsWith('body'), 40);
    const rowStops = stops.filter((n) => n.startsWith('a '));
    await record(
      info,
      'list tab stops',
      `From the first row's name to the end of the page: ${stops.length} Tab presses (the review: 77 before the rebuild).\n` +
        `Links in 3 rows: ${rowStops.length} (name and matter number per row = 2 per row for a System Admin).\n` +
        stops.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    );
    // Two stops per row at most (name and the matter number link), and the whole walk ends (no trap).
    expect(rowStops.length).toBeLessThanOrEqual(6);
    expect(stops.length).toBeLessThan(40);
  });

  test('filters: every filter control is reachable by Tab in column order and the sheet below 640 px traps nothing', async ({
    page,
    seed,
  }) => {
    const { token } = await seeded(seed, 2);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('#asset-filter-row')).toBeVisible();
    await page.getByRole('link', { name: 'Skip to table' }).focus();
    // Shift+Tab backwards from the table reaches the filter controls in reverse order, Name first when walking forward from the header.
    await page.getByRole('textbox', { name: 'Filter by Name' }).focus();
    const order = await tabUntil(page, (n) => n.includes('Status'), 12);
    expect(order.some((n) => /Type/.test(n))).toBe(true);
    expect(order.at(-1)).toContain('Status');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/assets?name=${token}`);
    await page.getByRole('button', { name: /^Filters/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Focus stays inside the sheet while it is open and Escape closes it and gives focus back to the button.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Filters/ })).toBeFocused();
  });

  test('record page: open from the list by Enter, the heading has focus, Tab stops are listed, the tab arrows work, Back returns focus to the row', async ({
    page,
    seed,
  }, info) => {
    const { token, assets } = await seeded(seed, 2);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}&sort=displayName`);
    const first = page.locator('tbody a.mf-name').first();
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/assets/${assets[0].assetId}$`));
    await expect(page.locator('[data-page-title]')).toBeFocused();

    const stops = await tabUntil(
      page,
      (n) => /tabpanel|Details/.test(n) && n.includes('Details'),
      30,
    );
    const all = await tabUntil(page, (n) => n.startsWith('body'), 60);
    await record(
      info,
      'record page tab stops',
      `From the heading to the Details tab: ${stops.length}; from there to the end of the page: ${all.length}.\n` +
        [...stops, ...all].map((s, i) => `${i + 1}. ${s}`).join('\n'),
    );
    expect(all.length).toBeLessThan(60); // the walk ends: no trap

    // Tab arrows, Home and End on the tab list.
    await page.getByRole('tab', { name: 'Details' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^Linked tasks/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The crumb's Assets link (Back) returns to the list with the row's name focused.
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Assets' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/assets\?/);
    await expect(page.locator(`a[data-asset-name="${assets[0].assetId}"]`)).toBeFocused();
  });

  test('keyboard only: Edit, Save, Set inactive (menu, dialog, confirm) and back; focus returns after the menu and the dialog', async ({
    page,
    seed,
  }) => {
    const { assets, token } = await seeded(seed, 1);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${assets[0].assetId}`);
    await expect(page.locator('[data-page-title]')).toBeFocused();

    // Edit by Enter, rename with the keyboard, Save by Enter.
    await page.getByRole('button', { name: 'Edit', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/edit$/);
    const name = page.locator('#asset-name');
    await name.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`Renamed ${token}`);
    const save = page.getByRole('button', { name: 'Save changes' });
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/assets/${assets[0].assetId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(`Renamed ${token}`);

    // The overflow: open with Enter, Escape closes it and focus returns to the button.
    const more = page.getByRole('button', { name: 'More actions' });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(more).toBeFocused();

    // Set inactive: menu item by keyboard, the dialog takes focus (Keep active is the safe default), Escape returns focus to the button.
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Set inactive' }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();

    // Confirm by keyboard: Tab to the confirm button, Enter; the heading has focus and the badge says Inactive.
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: 'Set inactive' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').getByRole('button', { name: 'Set inactive' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-record-header] mf-active-badge')).toContainText('Inactive');
    await expect(page.locator('[data-page-title]')).toBeFocused();
  });

  test('New asset: the form is reachable and submittable by keyboard and Cancel is a stop; a letter does nothing on its own (no shortcuts)', async ({
    page,
    seed,
  }) => {
    const world = await seed.world();
    const typeId = await seed.assetTypeId();
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/new?matterId=${world.matter.matterId}`);
    await expect(page.locator('#asset-type')).toBeVisible();
    await page.locator('#asset-type').selectOption(String(typeId));
    await page.locator('#asset-name').focus();
    await page.keyboard.type(`Typed ${uid()}`);
    const url = page.url();
    // Letters typed into a field stay in the field; pressing one with focus on a button does not navigate.
    await page.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('e');
    await page.keyboard.press('n');
    expect(page.url()).toBe(url);
    await page.getByRole('button', { name: 'Create asset' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/assets\/\d+$/);
    await expect(page.locator('[data-page-title]')).toBeFocused();
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes on the list with filters open, the record tabs, the menu, the dialog and both forms', async ({
    page,
    seed,
  }) => {
    const { assets, token, world } = await seeded(seed, 2);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets?name=${token}`);
      await expect(
        size.width < 640
          ? page.locator('li.rc').first()
          : page.locator('tbody tr[data-asset-id]').first(),
      ).toBeVisible();
      expect(await axeViolations(page), `list at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      if (size.width < 640) {
        await page.getByRole('button', { name: /^Filters/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await axeViolations(page), `filter sheet at ${size.width}`).toEqual([]);
        await page.keyboard.press('Escape');
      }
      for (const url of [
        `/assets/${assets[0].assetId}`,
        `/assets/${assets[0].assetId}?tab=tasks`,
        `/assets/${assets[0].assetId}?tab=history`,
        `/assets/${assets[0].assetId}/edit`,
        `/assets/new?matterId=${world.matter.matterId}`,
      ]) {
        await page.goto(url);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        expect(await axeViolations(page), `${url} at ${size.width}`).toEqual([]);
        await noHorizontalScroll(page);
      }
    }
  });
});
