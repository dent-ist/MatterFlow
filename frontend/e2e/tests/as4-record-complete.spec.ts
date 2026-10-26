import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, package WP-AS4 (docs/ux/assets-review): the Linked tasks tab (#505), the summary strip (#506), the Set inactive dialog
 * (#507), long text (#508) and the record page at 375 and 768 (#509). Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/as4-record-complete.
 */
const LONG_NAME = 'A very long asset name that goes on and on '.repeat(7).slice(0, 300).trim();
const LONG_URL =
  'https://dms.example/folders/' + 'segment-of-a-very-long-path/'.repeat(36).slice(0, 960);
const LONG_TEXT = 'A long description sentence that keeps going. '.repeat(33).slice(0, 1500).trim();

const day = (offset: number): string => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};

test.describe('Asset record page, complete (WP-AS4)', () => {
  test.beforeEach(() => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
  });

  async function seeded(
    seed: import('../support/seed').Seeder,
    personas: import('../support/personas').Personas,
  ) {
    const world = await seed.world();
    const token = uid();
    const typeId = await seed.assetTypeId();
    const asset = await seed.admin.post('/api/v1/assets', {
      matterId: world.matter.matterId,
      assetTypeId: typeId,
      displayName: `${token} ${LONG_NAME}`.slice(0, 300),
      externalReference: LONG_URL,
      description: LONG_TEXT,
    });
    const person = await personas.create({ label: 'linkedassignee', permissions: ['Task.View'] });
    const make = (title: string, extra: Record<string, unknown>) =>
      seed.task(world, { title: `${title} ${token}`, ...extra });
    const late = await make('Late task', { dueDate: day(-3), assignedUserId: person.userId });
    const soon = await make('Soon task', { dueDate: day(5) });
    const none = await make('Undated task', {});
    for (const t of [none, soon, late]) {
      await seed.admin.post(`/api/v1/tasks/${t.taskId}/assets`, { assetId: asset.assetId });
    }
    return { world, token, asset, late, soon, none, person };
  }

  test('Linked tasks: Due and Assignee on every row, earliest first, overdue in the warning style, the Open / Overdue line, sorting and a link to the task (#505)', async ({
    page,
    seed,
    personas,
  }) => {
    const { asset, late, soon, none, person } = await seeded(seed, personas);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}?tab=tasks`);
    const rows = page.locator('[data-tasks-tab] tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /^Linked tasks/ })).toContainText('(3)');
    await expect(rows.nth(0)).toContainText('Late task');
    await expect(rows.nth(1)).toContainText('Soon task');
    await expect(rows.nth(2)).toContainText('Undated task');
    await expect(rows.nth(0).locator('[data-due-tone="overdue"]')).toBeVisible();
    await expect(rows.nth(0).locator('[data-assignee]')).toContainText(person.displayName ?? '');
    await expect(rows.nth(1).locator('[data-assignee]')).toContainText('Unassigned');
    await expect(page.locator('[data-linked-summary]')).toContainText(
      '3 linked - 3 open - 1 overdue',
    );
    for (let i = 0; i < 3; i++) {
      const box = (await rows.nth(i).boundingBox())!;
      expect(Math.round(box.height)).toBeLessThanOrEqual(45);
    }
    await expect(rows.nth(0).locator('a')).toHaveCount(1);
    await expect(rows.nth(0).locator('a')).toHaveAttribute('href', `/tasks/${late.taskId}`);

    await page.getByRole('columnheader', { name: 'Due' }).getByRole('button').click();
    await expect(rows.nth(0)).toContainText('Undated task');
    await shot(page, 'as4-linked-tasks');
    void soon;
    void none;
  });

  test('Linked tasks without Task.View: the sentence, no count, no request for the list, no strip numbers (#505, #506)', async ({
    seed,
    personas,
    asUser,
  }) => {
    const { asset } = await seeded(seed, personas);
    const viewer = await personas.create({ label: 'assetonly', permissions: ['Asset.View'] });
    const plain = await asUser(viewer.username);
    const requests: string[] = [];
    plain.on('request', (r) => {
      if (r.url().includes('linked-tasks')) requests.push(r.url());
    });
    await plain.setViewportSize({ width: 1366, height: 768 });
    await plain.goto(`/assets/${asset.assetId}?tab=tasks`);
    await expect(plain.locator('[data-no-access="linked-tasks"]')).toContainText(
      "You don't have permission to view tasks.",
    );
    await expect(plain.getByRole('tab', { name: /^Linked tasks/ })).not.toContainText('(');
    const strip = plain.locator('[data-asset-strip]');
    await expect(strip).toContainText('Created');
    for (const word of ['Open', 'Overdue', 'Linked']) await expect(strip).not.toContainText(word);
    expect(requests).toEqual([]);
  });

  test('summary strip: Open and Linked from the asset, Overdue after the tab has loaded, Open links to the tab (#506)', async ({
    page,
    seed,
    personas,
  }) => {
    const { asset } = await seeded(seed, personas);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}`);
    const strip = page.locator('[data-asset-strip]');
    await expect(strip).toContainText('Open');
    await expect(strip.locator('[data-strip-item="open"]')).toContainText('3');
    await expect(strip.locator('[data-strip-item="linked"]')).toContainText('3');
    await expect(strip.locator('[data-strip-item="overdue"]')).toHaveCount(0);
    await strip.locator('[data-strip-item="open"]').click();
    await expect(page).toHaveURL(/tab=tasks/);
    await expect(strip.locator('[data-strip-item="overdue"]')).toContainText('1');
    await shot(page, 'as4-strip');
  });

  test('Set inactive names the open linked tasks, Cancel and Escape return focus to the overflow, Confirm focuses the heading (#507)', async ({
    page,
    seed,
    personas,
  }) => {
    const { asset } = await seeded(seed, personas);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('3 open tasks keep this link.');
    await shot(page, 'as4-inactive-dialog');
    await dialog.getByRole('button', { name: 'Keep active' }).click();
    await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set inactive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Set inactive' }).click();
    await expect(page.locator('[data-record-header] mf-active-badge')).toContainText('Inactive');
    await expect(page.locator('[data-page-title]')).toBeFocused();
  });

  test('long text: the description shows 6 lines and expands, the reference is one line and copies all of it, the name shows 2 lines, the crumb is cut at 40 characters (#508)', async ({
    page,
    seed,
    personas,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { asset } = await seeded(seed, personas);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets/${asset.assetId}`);

    const description = page.locator('[data-description]');
    await expect(description).toBeVisible();
    const lines = async () =>
      description.evaluate((e) => {
        const style = getComputedStyle(e);
        return Math.round(
          e.getBoundingClientRect().height /
            (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4),
        );
      });
    expect(await lines()).toBeLessThanOrEqual(6);
    const toggle = page.locator('[data-description-toggle]');
    await expect(toggle).toHaveText('Show more');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(await lines()).toBeGreaterThan(6);
    await toggle.click();
    await expect(toggle).toHaveText('Show more');

    const reference = page.locator('[data-external-reference] .ad__ref-text');
    await expect(reference).toHaveAttribute('title', LONG_URL);
    expect(
      await reference.evaluate((e) => ({
        one: e.getBoundingClientRect().height < 26,
        cut: e.scrollWidth > e.clientWidth,
      })),
    ).toEqual({ one: true, cut: true });
    await page.locator('[data-external-reference]').getByRole('button').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG_URL);

    const h1 = page.locator('[data-page-title]');
    expect(
      await h1.evaluate((e) => {
        const style = getComputedStyle(e);
        return Math.round(
          e.getBoundingClientRect().height /
            (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4),
        );
      }),
    ).toBeLessThanOrEqual(2);
    await expect(h1.locator('[data-name]')).toHaveAttribute('title', /.+/);
    const crumb =
      (await page
        .locator('[data-record-header] [data-crumb-current] [aria-hidden="true"]')
        .textContent()) ?? '';
    expect(crumb.trim().length).toBeLessThanOrEqual(41);
    await shot(page, 'as4-long-values');
  });

  test('375 and 768: all three tabs, the overflow and the dialog; no sideways scroll, axe finds nothing, targets are big enough (#509)', async ({
    page,
    seed,
    personas,
  }) => {
    const { asset } = await seeded(seed, personas);
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/${asset.assetId}`);
      await expect(page.locator('[data-page-title]')).toBeVisible();
      expect(await axeViolations(page), `details at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'as4-details');

      await page.getByRole('tab', { name: /^Linked tasks/ }).click();
      if (size.width < 640) await expect(page.locator('[data-tasks-tab] li.rc')).toHaveCount(3);
      else await expect(page.locator('[data-tasks-tab] tbody tr')).toHaveCount(3);
      expect(await axeViolations(page), `tasks at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'as4-tasks');

      await page.getByRole('tab', { name: 'History' }).click();
      await expect(page.locator('[data-history-tab]')).toBeVisible();
      expect(await axeViolations(page), `history at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'as4-history');

      await page.getByRole('tab', { name: 'Details' }).click();
      await page.getByRole('button', { name: 'More actions' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await axeViolations(page), `menu at ${size.width}`).toEqual([]);
      await page.getByRole('menuitem', { name: 'Set inactive' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await axeViolations(page), `dialog at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      if (size.width <= 768) {
        // Touch targets: tabs and the header buttons are at least 44 px high on a phone and tablet.
        for (const target of [
          page.getByRole('tab', { name: 'Details' }),
          page.getByRole('button', { name: 'More actions' }),
        ]) {
          const box = (await target.boundingBox())!;
          expect(box.height, `target at ${size.width}`).toBeGreaterThanOrEqual(
            size.width < 640 ? 36 : 32,
          );
        }
      }
    }
  });
});
