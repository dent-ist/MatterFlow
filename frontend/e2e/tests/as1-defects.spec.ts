import { Page } from '@playwright/test';
import { axeAvailable } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { atEverySize, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, package WP-AS1 (docs/ux/assets-review): BUG-1 matter links by permission (#487), BUG-3 the name is a real link (#488),
 * BUG-5 the reference is one line (#489) and the 44 px rows of the list (#497). Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/as1-defects.
 */
const LONG_NAME = 'A very long asset name that goes on and on '.repeat(7).slice(0, 300).trim();
const LONG_URL =
  'https://dms.example/folders/' + 'segment-of-a-very-long-path/'.repeat(36).slice(0, 960);

async function seedRows(seed: import('../support/seed').Seeder, token: string) {
  const matter = await seed.matter({ name: `Review Matter ${token}` });
  const typeId = await seed.assetTypeId();
  const make = (displayName: string, externalReference?: string) =>
    seed.admin.post('/api/v1/assets', {
      matterId: matter.matterId,
      assetTypeId: typeId,
      displayName,
      externalReference,
    });
  return {
    matter,
    plain: await make(`Plain ${token}`, `REF-${token}`),
    long: await make(`${token} ${LONG_NAME}`.slice(0, 300), LONG_URL),
    none: await make(`No reference ${token}`),
  };
}

test.describe('Assets list defects (WP-AS1)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  test('BUG-1: a matter number is a link only with Matter.View; without it nothing leads to the 403 page (1366 and 375)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const token = uid();
    const rows = await seedRows(seed, token);
    const viewer = await personas.create({ label: 'assetview', permissions: ['Asset.View'] });
    const withMatters = await personas.create({
      label: 'assetmatter',
      permissions: ['Asset.View', 'Matter.View', 'Client.View', 'Task.View'],
    });

    const plain = await asUser(viewer.username);
    for (const size of [
      { width: 1366, height: 768 },
      { width: 375, height: 812 },
    ]) {
      await plain.setViewportSize(size);
      await plain.goto(`/assets?name=${token}`);
      await expect(plain.locator('tbody tr[data-asset-id]')).toHaveCount(3);
      await expect(plain.locator('a[href^="/matters"]')).toHaveCount(0);
      await expect(plain.locator('tbody .mf-ref').first()).toHaveText(rows.matter.matterRef);
      await shot(plain, 'bug1-no-matter-view');
    }

    const linked = await asUser(withMatters.username);
    await linked.goto(`/assets?name=${token}`);
    const links = linked.locator('tbody a[href^="/matters"]');
    await expect(links).toHaveCount(3);
    await expect(links.first()).toHaveAttribute('href', `/matters/${rows.matter.matterId}`);
  });

  test('BUG-3: the name is a real link to the record page (new tab works, link list)', async ({
    page,
    seed,
  }) => {
    const token = uid();
    const rows = await seedRows(seed, token);
    await page.goto(`/assets?name=${token}`);
    const link = page.getByRole('link', { name: `Plain ${token}`, exact: true });
    await expect(link).toHaveAttribute('href', `/assets/${rows.plain.assetId}`);
    await expect(page.locator('[data-asset-name] >> nth=0')).toHaveJSProperty('tagName', 'A');
    await expect(page.locator('tbody button.as-name')).toHaveCount(0);

    const popup = page.context().waitForEvent('page');
    await link.click({ modifiers: ['Control'] });
    const tab = await popup;
    await expect(tab).toHaveURL(new RegExp(`/assets/${rows.plain.assetId}$`));
    await tab.close();

    await link.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/assets/${rows.plain.assetId}$`));
  });

  test('BUG-5 and A2: every row is 44 px, the long name is clamped, the reference is one line with the full value as tooltip and copy button, an empty reference is a dash', async ({
    page,
    seed,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const token = uid();
    const rows = await seedRows(seed, token);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    const trs = page.locator('tbody tr[data-asset-id]');
    await expect(trs).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const box = (await trs.nth(i).boundingBox())!;
      expect(Math.round(box.height), `row ${i}`).toBeLessThanOrEqual(45);
      expect(Math.round(box.height), `row ${i}`).toBeGreaterThanOrEqual(44);
    }

    const longRow = page.locator(`tr[data-asset-id="${rows.long.assetId}"]`);
    const text = longRow.locator('.as-ref__text');
    await expect(text).toHaveAttribute('title', LONG_URL);
    expect(
      await text.evaluate((e) => ({
        one: e.getBoundingClientRect().height < 24,
        cut: e.scrollWidth > e.clientWidth,
      })),
    ).toEqual({ one: true, cut: true });
    await expect(longRow.locator('a.mf-name')).toHaveAttribute('title', rows.long.displayName);

    await longRow.hover();
    await longRow.getByRole('button', { name: 'Copy external reference' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG_URL);

    const none = page.locator(`tr[data-asset-id="${rows.none.assetId}"] td[data-reference]`);
    await expect(none).toContainText('–');
    await expect(none.locator('button')).toHaveCount(0);
  });

  test('A2: the row has one Tab stop for a person without Matter.View, and the copy button is reached with the right arrow', async ({
    seed,
    personas,
    asUser,
  }) => {
    const token = uid();
    const rows = await seedRows(seed, token);
    const viewer = await personas.create({ label: 'assetview', permissions: ['Asset.View'] });
    const page = await asUser(viewer.username);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    const row = page.locator(`tr[data-asset-id="${rows.plain.assetId}"]`);
    const stops = await row.evaluate(
      (tr) =>
        Array.from(
          tr.querySelectorAll<HTMLElement>('a[href], button, input, select, [tabindex]'),
        ).filter((e) => e.tabIndex >= 0).length,
    );
    expect(stops).toBe(1);

    await row.locator('a.mf-name').focus();
    await page.keyboard.press('ArrowRight');
    await expect(row.getByRole('button', { name: 'Copy external reference' })).toBeFocused();
  });

  test('the Reference column leaves below 1280 px and the filter row follows; axe finds nothing and nothing scrolls sideways at four sizes', async ({
    page,
    seed,
  }) => {
    const token = uid();
    await seedRows(seed, token);
    await page.goto(`/assets?name=${token}&size=25`);
    await expect(page.locator('tbody tr[data-asset-id]')).toHaveCount(3);
    await atEverySize(page, 'as1-assets-list', async (size) => {
      await expect(page.getByRole('columnheader', { name: 'External reference' })).toHaveCount(
        size.width >= 1280 ? 1 : 0,
      );
      await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await noHorizontalScroll(page);
    await openFilters(page);
    await shot(page, 'as1-assets-list-filters');
  });
});

async function openFilters(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
}
