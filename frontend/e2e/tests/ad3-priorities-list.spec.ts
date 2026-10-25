import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import {
  SIZES,
  addPriorities,
  noSideScroll,
  openRowMenu,
  priorityRow,
  shot,
} from '../support/labels';
import { uid } from '../support/seed';

/**
 * WP-AD3 #605: the Priorities list on the grid contract: Order, the priority badge with a Default badge, Color, Open tasks (a link to the Task
 * Queue, absent without Task.View), Status and one row menu; 44 px rows, eight rows fully visible at 1366x768 in the one scroll area, two Tab
 * stops per row, cards below 640 px with the same actions, the pointer drag as shipped. Screenshots: E2E_SCREENSHOTS (fixes/ad3-labels).
 */
test.describe.configure({ mode: 'serial' });

test.describe('the Priorities list (#605)', () => {
  let extras: Json[] = [];
  let used: Json;
  let cleanup: () => Promise<void> = async () => undefined;

  test.beforeAll(async ({ admin, seed }) => {
    const added = await addPriorities(admin, 4, `ad3 list ${uid().slice(0, 5)}`);
    extras = added.made;
    cleanup = added.cleanup;
    // One priority that tasks use: its Open tasks cell is a real number.
    const world = await seed.world();
    used = await admin.post('/api/v1/priorities', {
      label: `ad3 used ${uid().slice(0, 5)}`,
      color: 'high',
      isActive: true,
    });
    for (let i = 0; i < 3; i++) await seed.task(world, { priorityId: used.id });
  });

  test.afterAll(async ({ admin }) => {
    await cleanup();
    // A priority that tasks use cannot be deleted: leave it inactive.
    const current = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.id === used.id);
    if (current) {
      await admin.put(`/api/v1/priorities/${used.id}`, {
        label: current.label,
        color: current.color,
        isActive: false,
        rowVersion: current.rowVersion,
      });
    }
  });

  const rows = (page: Page) => page.locator('table.mf-grid tbody tr[data-row]');

  test('rows are 44 px, eight rows are fully visible at 1366x768 in one scroll area, with the columns of the contract', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    await expect(rows(page).first()).toBeVisible();
    expect(await rows(page).count()).toBeGreaterThanOrEqual(9);
    await expect(page.locator('table.mf-grid thead th')).toHaveText([
      'Order',
      'Priority',
      'Color',
      'Open tasks',
      'Status',
      'Actions',
    ]);
    const heights = await rows(page).evaluateAll((trs) =>
      trs.map((tr) => tr.getBoundingClientRect().height),
    );
    // 44 px rows; the collapsed border adds up to a pixel (as in ad2-kit-grid).
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(43);
      expect(h).toBeLessThanOrEqual(45);
    }

    const region = page.getByRole('region', { name: 'Priorities list, scrollable' });
    const regionBox = (await region.boundingBox())!;
    const eighth = (await rows(page).nth(7).boundingBox())!;
    expect(
      eighth.y + eighth.height,
      'the eighth row ends inside the scroll area',
    ).toBeLessThanOrEqual(regionBox.y + regionBox.height + 0.5);
    // One scroll area: no scrolling box inside the table's wrap, and the page itself does not scroll.
    const nested = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('#mf-main *')).filter((el) => {
          const s = getComputedStyle(el);
          return (
            (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight + 1 &&
            !el.hasAttribute('data-scroll-area') &&
            el.getAttribute('role') !== 'region' &&
            !el.matches('mf-fixed-page, .mf-fill, #mf-main')
          );
        }).length,
    );
    expect(nested).toBe(0);
    await noSideScroll(page, 'priorities at 1366');
    await shot(page, 'priorities-list');
  });

  test('the Open tasks number equals the API count and the total behind its Task Queue link', async ({
    page,
    admin,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const row = priorityRow(page, used.label);
    const cell = row.locator('[data-open-tasks]');
    await expect(cell).toHaveText('3');
    const listed = (await admin.get<Json[]>('/api/v1/priorities')).find((p) => p.id === used.id)!;
    expect(listed.openTaskCount).toBe(3);
    const total = await admin.get<Json>(
      `/api/v1/task-queue?pageSize=1&status=NEW&status=IN_PROGRESS&status=ON_HOLD&priority=${used.id}`,
    );
    expect(total.total).toBe(3);
    await cell.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?.*priority=${used.id}`));
    // An unused priority is a plain 0 (no link to an empty list).
    await page.goto('/admin/priorities');
    const unused = priorityRow(page, extras[0].label);
    await expect(unused.locator('[data-open-tasks]')).toHaveText('0');
    await expect(unused.locator('[data-open-tasks] a')).toHaveCount(0);
  });

  test('a row has two Tab stops: the priority link and its menu; the count is reached with the right arrow', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    const row = priorityRow(page, used.label);
    const stops = await row.evaluate((tr) =>
      Array.from(tr.querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]'))
        .filter((el) => el.tabIndex >= 0)
        .map((el) => el.tagName + (el.hasAttribute('data-edit') ? ':edit' : '')),
    );
    expect(stops).toEqual(['A:edit', 'BUTTON']);
    await row.locator('[data-edit]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(row.locator('[data-open-tasks] a')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(row.locator('[data-edit]')).toBeFocused();
  });

  test('the pointer drag still reorders the rows, and the order is saved', async ({
    page,
    admin,
  }) => {
    // Tall enough for every row to be on screen: a drop target outside the scroll area would need the browser's auto-scroll.
    await page.setViewportSize({ width: 1366, height: 2400 });
    await page.goto('/admin/priorities');
    const first = page.locator(`tr[data-row="${extras[0].label}"]`);
    const second = page.locator(`tr[data-row="${extras[1].label}"]`);
    await expect(first).toBeVisible();
    await expect(second).toHaveAttribute('draggable', 'true'); // not while the page is busy
    // By hand with intermediate moves: `dragTo` moves in one jump, and the HTML5 drag needs `dragover` events on the target before the drop;
    // with one jump the drop sometimes arrived before the first `dragover`. The drag is made from where the rows are when they have stopped
    // moving (a load or a toast above the grid shifts them) and a drag the browser did not deliver (no `dragover` yet when the button
    // came up) is made again: the assertion below is the same for every run.
    await page.waitForLoadState('networkidle');
    const settled = async (row: ReturnType<Page['locator']>) => {
      let last = '';
      await expect
        .poll(
          async () => {
            const box = await row.boundingBox();
            const now = box ? `${Math.round(box.x)},${Math.round(box.y)}` : '';
            const same = now !== '' && now === last;
            last = now;
            return same;
          },
          { intervals: [100] },
        )
        .toBe(true);
      return (await row.boundingBox())!;
    };
    const positionOf = async (label: string): Promise<number> =>
      (await admin.get<Json[]>('/api/v1/priorities')).map((p) => p.label).indexOf(label);
    for (let attempt = 1; attempt <= 3; attempt++) {
      if ((await positionOf(extras[1].label)) < (await positionOf(extras[0].label))) break;
      const from = await settled(second);
      const to = await settled(first);
      await page.mouse.move(from.x + 20, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 24, from.y + from.height / 2 - 4, { steps: 4 });
      await page.waitForTimeout(50);
      await page.mouse.move(to.x + 24, to.y + to.height / 2, { steps: 12 });
      await page.waitForTimeout(50);
      const saved = page
        .waitForResponse(
          (r) => r.url().includes('/api/v1/priorities') && r.request().method() !== 'GET',
          { timeout: 3000 },
        )
        .catch(() => undefined);
      await page.mouse.up();
      await saved;
    }
    const order = (await admin.get<Json[]>('/api/v1/priorities')).map((p) => p.label);
    expect(order.indexOf(extras[1].label)).toBeLessThan(order.indexOf(extras[0].label));
    await expect(page.locator('[data-announce]')).toContainText('moved to position');
  });

  test('below 640 px the rows are cards with the same actions; 639 is cards, 640 is the table', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 639, height: 900 });
    await page.goto('/admin/priorities');
    await expect(page.locator('li.rc').first()).toBeVisible();
    await expect(page.locator('table.mf-grid')).toHaveCount(0);
    const all = await page.locator('li.rc').count();
    const rowsAt1366 = await (async () => {
      await page.setViewportSize({ width: 640, height: 900 });
      await expect(page.locator('table.mf-grid tbody tr[data-row]').first()).toBeVisible();
      return page.locator('table.mf-grid tbody tr[data-row]').count();
    })();
    expect(all).toBe(rowsAt1366);

    await page.setViewportSize(SIZES[3]);
    await expect(page.locator('li.rc').first()).toBeVisible();
    const card = priorityRow(page, used.label);
    await expect(card.locator('[data-card-open-tasks]')).toContainText('3 open tasks');
    await openRowMenu(page, card.getByRole('button', { name: /^Actions for / }));
    await expect(page.getByRole('menuitem')).toContainText([
      'Edit priority',
      'Move up',
      'Move down',
      'Set as default',
      'Deactivate',
    ]);
    // The card's link opens the same dialog as the table's.
    await page.keyboard.press('Escape');
    await card.getByRole('link', { name: used.label }).click();
    await expect(page.getByRole('dialog', { name: 'Edit priority' })).toBeVisible();
  });

  test('a person with Priority.Manage but not Task.View has no Open tasks column and no Delete', async ({
    asUser,
    personas,
  }) => {
    const user = await personas.create({ permissions: ['Priority.Manage'], label: 'ad3-nt' });
    const page = await asUser(user.username);
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/priorities');
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator('table.mf-grid thead th')).toHaveText([
      'Order',
      'Priority',
      'Color',
      'Status',
      'Actions',
    ]);
    await expect(page.locator('[data-open-tasks]')).toHaveCount(0);
    const unused = priorityRow(page, extras[2].label);
    await openRowMenu(page, unused.getByRole('button', { name: /^Actions for / }));
    await expect(page.getByRole('menuitem', { name: /^Delete/ })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /^Deactivate/ })).toBeVisible();
    await page.keyboard.press('Escape');
    // The unknown count leaves its number out of the Deactivate sentence.
    await openRowMenu(page, unused.getByRole('button', { name: /^Actions for / }));
    await page.getByRole('menuitem', { name: /^Deactivate/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Deactivate priority?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText(/\d+ open task/);
    await dialog.getByRole('button', { name: 'Keep active' }).click();
  });

  for (const size of SIZES) {
    test(`${size.width}: axe 0 and no sideways scroll, with the row menu open`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize(size);
      await page.goto('/admin/priorities');
      await expect(page.locator('tbody tr[data-row], li.rc').first()).toBeVisible();
      await noSideScroll(page, `priorities at ${size.width}`);
      expect(await axeViolations(page), `priorities at ${size.width}`).toEqual([]);
      const menu = priorityRow(page, used.label).getByRole('button', { name: /^Actions for / });
      await openRowMenu(page, menu);
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await axeViolations(page), `menu open at ${size.width}`).toEqual([]);
      await shot(page, 'priorities-menu');
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
    });
  }
});
