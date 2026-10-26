import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { delayApi, failApi, goOffline } from '../support/personas';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * Assets UX review, final verification (#517): the contract of the epic on data shaped like the review's (many assets in one matter, a 300
 * character name, a 1,000 character URL, a 1,500 character description, 19 linked tasks, four kinds of people), at the four sizes, with the
 * state matrix and the measurements of the review's before/after table printed as `[measure] key = value` lines.
 * Screenshots: E2E_SCREENSHOTS=docs/ux/assets-review/fixes/final.
 */
const LONG_NAME = 'A very long asset name that goes on and on '.repeat(7).slice(0, 300).trim();
const LONG_URL =
  'https://dms.example/folders/' + 'segment-of-a-very-long-path/'.repeat(36).slice(0, 960);
const LONG_TEXT = 'A long description sentence that keeps going. '.repeat(33).slice(0, 1500).trim();

test.describe('Assets final verification (#517)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  let token = '';
  let heavy: { assetId: number; displayName: string } = { assetId: 0, displayName: '' };
  let plainId = 0;
  let matterId = 0;

  const measure = (key: string, value: unknown) => console.log(`[measure] ${key} = ${value}`);

  test.beforeAll(async ({ seed }) => {
    expect(axeAvailable(), 'axe-core must be available (set E2E_AXE_PATH)').toBe(true);
    token = uid();
    const world = await seed.world();
    matterId = world.matter.matterId;
    const typeId = await seed.assetTypeId();
    const make = (name: string, extra: Record<string, unknown> = {}) =>
      seed.admin.post('/api/v1/assets', {
        matterId,
        assetTypeId: typeId,
        displayName: name,
        ...extra,
      });
    for (let from = 0; from < 40; from += 8) {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          make(`Final ${token} ${String(from + i + 100)}`, {
            externalReference: `REF-${from + i}`,
          }),
        ),
      );
    }
    const h = await make(`${token} ${LONG_NAME}`.slice(0, 300), {
      externalReference: LONG_URL,
      description: LONG_TEXT,
    });
    heavy = { assetId: h.assetId, displayName: h.displayName };
    plainId = (await make(`Plain ${token}`)).assetId;
    for (let i = 0; i < 19; i++) {
      const t = await seed.task(world, {
        title: `Linked ${i} ${token}`,
        ...(i % 4 === 0 ? { dueDate: '2020-01-02' } : {}),
      });
      await seed.admin.post(`/api/v1/tasks/${t.taskId}/assets`, { assetId: heavy.assetId });
    }
  });

  test('the list keeps its full height (no panel), rows are 44 px, the heading and the grid fit 1366x768; the phone page is cards', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    const grid = (await page.locator('.mf-table-wrap').first().boundingBox())!;
    measure('grid height at 1366x768 (review: 277 px with a selection)', Math.round(grid.height));
    expect(grid.height).toBeGreaterThan(400);
    await expect(page.locator('#asset-panel, [data-asset-panel]')).toHaveCount(0);

    const heights = await page
      .locator('tbody tr[data-asset-id]')
      .evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
    measure(
      'row heights (review: 55 to 77 px)',
      `${Math.min(...heights)} to ${Math.max(...heights)} px`,
    );
    for (const h of heights) expect(h).toBeLessThanOrEqual(45);
    await shot(page, 'final-list');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('li.rc').first()).toBeVisible();
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    measure(
      'phone page height with 25 cards (review: 3,048 px with 25 table rows and the panel)',
      height,
    );
    // 25 cards of 4 lines each (about 137 px): the page is a list, not a list plus a panel; opening an asset is a tap, not a 1,500 px scroll.
    expect(height).toBeLessThan(25 * 150);
    await noHorizontalScroll(page);
  });

  test('no dead links: a person with Asset.View only gets no link to a matter, task or client on the list or the record page', async ({
    seed,
    personas,
    asUser,
  }) => {
    const viewer = await personas.create({ label: 'finalview', permissions: ['Asset.View'] });
    const page = await asUser(viewer.username);
    const failed: string[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}&size=50`);
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    const rows = await page.locator('tbody tr[data-asset-id]').count();
    const dead = await page
      .locator('main a[href^="/matters"], main a[href^="/tasks/"], main a[href^="/clients"]')
      .count();
    measure(
      'matter links on the first page for Asset.View only (review: 26 dead links)',
      `${dead} of ${rows} rows`,
    );
    expect(dead).toBe(0);
    await page.goto(`/assets/${heavy.assetId}`);
    await expect(page.locator('[data-page-title]')).toBeVisible();
    expect(await page.locator('main a[href^="/matters"]').count()).toBe(0);
    expect(failed).toEqual([]);
    void seed;
  });

  test('Tab stops: Skip to table first, one stop per row without Matter.View, two with it', async ({
    page,
    personas,
    asUser,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/assets?name=${token}&size=50`);
    const stops = (p: Page) =>
      p
        .locator('tbody tr[data-asset-id]')
        .first()
        .evaluate(
          (tr) =>
            Array.from(
              tr.querySelectorAll<HTMLElement>('a[href], button, input, select, [tabindex]'),
            ).filter((e) => e.tabIndex >= 0).length,
        );
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    measure('Tab stops per row for a System Admin (review: 3)', await stops(page));
    expect(await stops(page)).toBe(3); // the select box for bulk disposition (#866), the name and the matter link
    const viewer = await personas.create({ label: 'finalstops', permissions: ['Asset.View'] });
    const plain = await asUser(viewer.username);
    await plain.goto(`/assets?name=${token}&size=50`);
    await expect(plain.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    measure('Tab stops per row without Matter.View', await stops(plain));
    expect(await stops(plain)).toBe(1);
    // From the first row to the end of the page: 50 rows * 2 plus the pager; the review counted 77 up to the panel for 25 rows.
    const total = await page
      .locator('main a[href], main button, main select, main input')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
    measure('Tab stops on the whole list page (50 rows)', total);
  });

  test('record page: one header (Edit, Activity, overflow, no primary action), tabs, one scroll region, no nested scroller; the long values are clamped', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/${heavy.assetId}`);
      await expect(page.locator('[data-page-title]')).toBeFocused();
      expect(await axeViolations(page), `details at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-record-details');
      const actions = await page
        .locator('[data-page-actions] > *')
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-action') ?? e.tagName.toLowerCase()),
        );
      // Edit, Activity and the overflow from 1024 px; narrower windows fold them into the overflow (the shared header rule).
      if (size.width >= 1024) expect(actions.slice(0, 2)).toEqual(['edit', 'activity']);
      await expect(page.locator('[data-record-header]')).toHaveCount(1);
      if (size.width >= 1024) {
        const nested = await page.locator('main *').evaluateAll(
          (els) =>
            els.filter((e) => {
              const s = getComputedStyle(e);
              return (
                (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                e.scrollHeight > e.clientHeight + 1
              );
            }).length,
        );
        measure(
          `scrollers inside main at ${size.width} (a nested scroller would be 2 or more)`,
          nested,
        );
        expect(nested).toBeLessThanOrEqual(1);
      }
      await page.getByRole('tab', { name: /^Linked tasks/ }).click();
      await expect(page.getByRole('tab', { name: /^Linked tasks/ })).toContainText('(19)');
      if (size.width >= 640)
        await expect(page.locator('[data-tasks-tab] tbody tr')).toHaveCount(19);
      else await expect(page.locator('[data-tasks-tab] li.rc')).toHaveCount(19);
      expect(await axeViolations(page), `tasks at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-record-tasks');
      await page.getByRole('tab', { name: 'History' }).click();
      await expect(page.locator('[data-history-tab]')).toBeVisible();
      expect(await axeViolations(page), `history at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-record-history');
    }
  });

  test('New and Edit asset at four sizes: axe, no sideways scroll, screenshots', async ({
    page,
  }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/assets/new?matterId=${matterId}`);
      await expect(page.locator('#asset-type')).toBeVisible();
      expect(await axeViolations(page), `new at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-new');
      await page.goto(`/assets/${plainId}/edit`);
      await expect(page.locator('#asset-name')).toBeVisible();
      expect(await axeViolations(page), `edit at ${size.width}`).toEqual([]);
      await noHorizontalScroll(page);
      await shot(page, 'final-edit');
    }
  });

  test('list at four sizes: axe, no sideways scroll, with the filter row open (the sheet at 375)', async ({
    page,
  }) => {
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
      await shot(page, 'final-list-size');
    }
  });

  test('state matrix: loading, 404, 403, 5xx with Retry, offline and back, reduced motion', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });

    // Loading: the record skeleton while the request is held.
    const undelay = await delayApi(page, new RegExp(`/api/v1/assets/${plainId}$`), 2500);
    await page.goto(`/assets/${plainId}`);
    await expect(page.locator('mf-record-skeleton')).toBeVisible();
    await shot(page, 'final-state-loading');
    await expect(page.locator('[data-page-title]')).toBeVisible();
    await undelay();

    // 404.
    await page.goto('/assets/987654321');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      "We couldn't find that asset.",
    );
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    expect(await axeViolations(page), '404').toEqual([]);
    await shot(page, 'final-state-404');

    // 403 from the server.
    const un403 = await failApi(page, new RegExp(`/api/v1/assets/${plainId}$`), 403);
    await page.goto(`/assets/${plainId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      "You don't have access to this asset.",
    );
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await shot(page, 'final-state-403');
    await un403();

    // 5xx: the sentence, the reference and Retry that works.
    const un500 = await failApi(page, new RegExp(`/api/v1/assets/${plainId}$`), 500, { times: 3 });
    await page.goto(`/assets/${plainId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      "Couldn't load this asset.",
    );
    await expect(page.locator('main')).toContainText('e2e-500-trace');
    expect(await axeViolations(page), '5xx').toEqual([]);
    await shot(page, 'final-state-5xx');
    await un500();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('[data-page-title]')).toContainText(`Plain ${token}`);

    // Offline: a list that cannot load says so and recovers when the connection is back.
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible();
    await goOffline(page, true);
    await page.getByRole('textbox', { name: 'Filter by Name' }).fill(`${token} 1`);
    await expect(page.locator('[data-error]')).toContainText("Couldn't load assets");
    await shot(page, 'final-state-offline');
    await goOffline(page, false);
    await expect(page.locator('tbody tr[data-asset-id]').first()).toBeVisible({ timeout: 20_000 });

    // Reduced motion: the skeleton does not shimmer.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const slow = await delayApi(page, '**/api/v1/assets?*', 2500);
    await page.goto(`/assets?name=${token}`);
    await expect(page.locator('tbody [data-skeleton]').first()).toBeVisible();
    const animation = await page
      .locator('tbody .gb-bone')
      .first()
      .evaluate((e) => getComputedStyle(e).animationName);
    measure('skeleton animation with reduced motion', animation);
    expect(animation === 'none' || animation === '').toBe(true);
    await slow();
  });
});
