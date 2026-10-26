import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { delayApi, failApi } from '../support/personas';
import { SIZES, atEverySize, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, package WP-AS3 (docs/ux/assets-review): the Linked tasks column (#498), the list chrome (#499), the loading and state
 * rows (#500), the Matter sort (#501), phone cards and the narrow-window column drop (#502) and Skip to table with one Tab stop per row
 * (#503). Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/as3-list.
 */
test.describe('Assets list contract (WP-AS3)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  async function rows(seed: import('../support/seed').Seeder, token: string, linked = 3) {
    const world = await seed.world();
    const busy = await seed.asset(world.matter, `Busy ${token}`);
    const idle = await seed.asset(world.matter, `Idle ${token}`);
    for (let i = 0; i < linked; i++) {
      const task = await seed.task(world);
      await seed.admin.post(`/api/v1/tasks/${task.taskId}/assets`, { assetId: busy.assetId });
    }
    return { world, busy, idle };
  }

  test('Linked tasks: the open count is a plain number with the total as tooltip, 0 for an idle asset, sortable, and absent without Task.View (#498)', async ({
    page,
    seed,
    personas,
    asUser,
  }) => {
    const token = uid();
    const { busy, idle } = await rows(seed, token, 3);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    const cell = (id: number) => page.locator(`tr[data-asset-id="${id}"] td[data-linked]`);
    await expect(cell(busy.assetId)).toContainText('3 open of 3 linked tasks');
    await expect(cell(busy.assetId).locator('[title]')).toHaveAttribute(
      'title',
      '3 linked in total',
    );
    await expect(cell(idle.assetId)).toContainText('0 open of 0 linked tasks');
    await expect(cell(busy.assetId).locator('a')).toHaveCount(0);
    const box = (await page.locator(`tr[data-asset-id="${busy.assetId}"]`).boundingBox())!;
    expect(Math.round(box.height)).toBeLessThanOrEqual(45);

    await page.getByRole('columnheader', { name: 'Linked tasks' }).getByRole('button').click();
    await expect(page).toHaveURL(/sort=-linkedTaskCount/);
    await expect(page.getByRole('columnheader', { name: 'Linked tasks' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(page.locator('tbody tr[data-asset-id]').first()).toHaveAttribute(
      'data-asset-id',
      String(busy.assetId),
    );
    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'Linked tasks' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    // It leaves below 900 px.
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.getByRole('columnheader', { name: 'Linked tasks' })).toHaveCount(0);

    const viewer = await personas.create({ label: 'assetonly', permissions: ['Asset.View'] });
    const plain = await asUser(viewer.username);
    await plain.setViewportSize({ width: 1366, height: 768 });
    await plain.goto(`/assets?name=${token}`);
    await expect(plain.locator('tbody tr[data-asset-id]')).toHaveCount(2);
    await expect(plain.getByRole('columnheader', { name: 'Linked tasks' })).toHaveCount(0);
    await expect(plain.locator('td[data-linked]')).toHaveCount(0);
  });

  test('chrome: the filter row is open on arrival from 640 px, Filters and Clear sit in the page header, below 640 px the sheet opens (#499)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    await rows(seed, token, 1);
    for (const width of [1366, 768, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/assets?name=${token}`);
      await expect(page.locator('#asset-filter-row')).toBeVisible();
      const toggle = page.getByRole('button', { name: /^Filters/ });
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(await toggle.evaluate((e) => !!e.closest('[data-page-header], mf-page-header'))).toBe(
        true,
      );
      await expect(toggle).toContainText('(1)');
      await expect(page.getByRole('button', { name: 'Clear filters' }).first()).toBeVisible();
      await noHorizontalScroll(page);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('#asset-filter-row')).toHaveCount(0);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('combobox', { name: /Sort by/ })).toBeVisible();
    expect(await axeViolations(page), 'sheet open at 375').toEqual([]);
    await shot(page, 'as3-filter-sheet');
  });

  test('states: the held request shows a skeleton of the real columns, a 500 shows the reference and Retry, an empty filter offers Clear filters (#500)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    await rows(seed, token, 1);
    await page.setViewportSize({ width: 1366, height: 768 });
    const undelay = await delayApi(page, '**/api/v1/assets?*', 3000);
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody [data-skeleton]')).toHaveCount(5);
    const head = (await page.locator('table.mf-grid').boundingBox())!;
    await shot(page, 'as3-loading');
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    const after = (await page.locator('table.mf-grid').boundingBox())!;
    expect(Math.round(after.width)).toBe(Math.round(head.width));
    await undelay();

    const unfail = await failApi(page, '**/api/v1/assets?*', 500, { times: 3 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('[data-error]')).toContainText("Couldn't load assets");
    await expect(page.locator('[data-error]')).toContainText('e2e-500-trace');
    await shot(page, 'as3-error');
    expect(await axeViolations(page), 'error state').toEqual([]);
    await unfail();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();

    await page.goto(`/assets?name=${token}-nothing`);
    await expect(page.locator('[data-empty="filtered"]')).toContainText('No assets match');
    await expect(
      page.locator('[data-empty] ').getByRole('button', { name: 'Clear filters' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-empty] a, [data-empty] button:has-text("New asset")'),
    ).toHaveCount(0);
    await shot(page, 'as3-empty');
    expect(await axeViolations(page), 'empty state').toEqual([]);
  });

  test('sort by Matter number: aria-sort, the URL, a reload, and ties by name (#501)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const { world } = await rows(seed, token, 0);
    await seed.asset(world.matter, `Zeta ${token}`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    const header = page.getByRole('columnheader', { name: 'Matter number' });
    await header.getByRole('button').click();
    await expect(page).toHaveURL(/sort=matter(&|$)/);
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    // One matter: the ties are ordered by name.
    const names = await page.locator('tbody a.mf-name').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    await header.getByRole('button').click();
    await expect(page).toHaveURL(/sort=-matter/);
    await page.reload();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  test('phone: one card per asset instead of the table, no sideways scroll; 768 drops columns instead of scrolling (#502)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const { busy, idle } = await rows(seed, token, 2);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/assets?name=${token}`);
    const cards = page.locator('li.rc');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('table')).toHaveCount(0);
    await expect(cards.filter({ hasText: `Busy ${token}` })).toContainText('2 open tasks');
    await expect(cards.filter({ hasText: `Idle ${token}` })).toContainText('0 open tasks');
    for (let i = 0; i < 2; i++) {
      const box = (await cards.nth(i).boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect(cards.first().locator('a')).toHaveAttribute('href', /\/assets\/\d+$/);
    await noHorizontalScroll(page);
    await shot(page, 'as3-cards');
    await cards
      .filter({ hasText: `Busy ${token}` })
      .locator('a')
      .click();
    await expect(page).toHaveURL(new RegExp(`/assets/${busy.assetId}$`));
    await page.goBack();
    await expect(cards.filter({ hasText: `Busy ${token}` }).locator('a')).toBeFocused();
    void idle;

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(2);
    const wrap = page.locator('.mf-table-wrap .mf-scroll').first();
    expect(await wrap.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByRole('columnheader', { name: 'External reference' })).toHaveCount(0);
    await shot(page, 'as3-768');
  });

  test('keyboard: Skip to table is the first stop and lands on the first name; a row has one Tab stop (two with Matter.View, one more with the select box for bulk disposition) (#503)', async ({
    page,
    seed,
    personas,
    asUser,
  }) => {
    const token = uid();
    const { busy } = await rows(seed, token, 1);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to table' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('tbody a.mf-name').first()).toBeFocused();

    const stops = (p: Page, id: number) =>
      p
        .locator(`tr[data-asset-id="${id}"]`)
        .evaluate(
          (tr) =>
            Array.from(
              tr.querySelectorAll<HTMLElement>('a[href], button, input, select, [tabindex]'),
            ).filter((e) => e.tabIndex >= 0).length,
        );
    expect(await stops(page, busy.assetId)).toBe(3); // admin: the select box, the name and the matter link (the select box is for Asset.Dispose, #866)
    const viewer = await personas.create({ label: 'assetonly', permissions: ['Asset.View'] });
    const plain = await asUser(viewer.username);
    await plain.goto(`/assets?name=${token}`);
    await expect(plain.locator('tr[data-asset-id]').first()).toBeVisible();
    expect(await stops(plain, busy.assetId)).toBe(1);

    // No shortcut was added: a letter typed on a row does nothing.
    await plain.locator('tbody a.mf-name').first().focus();
    const url = plain.url();
    await plain.keyboard.press('e');
    expect(plain.url()).toBe(url);
  });

  test('axe finds nothing and nothing scrolls sideways at four sizes, with the filter row open and a long name', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const world = await seed.world();
    await seed.asset(world.matter, `${token} ${'long name '.repeat(30)}`.slice(0, 300));
    await rows(seed, token, 2);
    await page.goto(`/assets?name=${token}`);
    await atEverySize(page, 'as3-list', async (size) => {
      if (size.width >= 640)
        await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
      else await expect(page.locator('li.rc').first()).toBeVisible();
    });
    for (const size of [SIZES[1], SIZES[3]]) {
      await page.setViewportSize(size);
      await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
      await shot(page, 'as3-list');
    }
    expect(SIZES.length).toBe(4);
  });
});
