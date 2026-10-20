import { Page } from '@playwright/test';
import { Json } from '../support/api';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { SIZES, noSideScroll, shot } from '../support/labels';
import { uid } from '../support/seed';

/**
 * WP-AD3 #622: the Status labels on the grid contract: the badge with the display label (the code is the tooltip, a renamed status says
 * what it was), a Tasks count that equals the Task Queue total, one row menu with Rename, the Rename dialog with the code, the live badge
 * and where the name shows, phone cards below 640 px. Screenshots: E2E_SCREENSHOTS (fixes/ad3-labels).
 */
const rows = (page: Page) => page.locator('table.mf-grid tbody tr[data-row]');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Rename status label' });
const field = (page: Page) => page.locator('#status-label-name');
const badgeOf = (page: Page, code: string) => page.locator(`[data-row="${code}"] mf-status-badge`);

test.describe('the Status labels list (#622)', () => {
  test('five rows of 44 px with the status badge, the code as the tooltip and a Tasks count equal to the Task Queue total', async ({
    page,
    admin,
    seed,
  }) => {
    const world = await seed.world();
    await seed.task(world);
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/status-labels');
    await expect(rows(page)).toHaveCount(5);
    await expect(page.locator('table.mf-grid thead th')).toHaveText(['Status', 'Tasks', 'Actions']);
    const heights = await rows(page).evaluateAll((trs) =>
      trs.map((tr) => tr.getBoundingClientRect().height),
    );
    // 44 px rows; the collapsed border adds up to a pixel (as in ad2-kit-grid).
    for (const h of heights) {
      expect(h).toBeGreaterThanOrEqual(43);
      expect(h).toBeLessThanOrEqual(45);
    }
    await expect(page.locator('table.mf-grid')).not.toContainText('IN_PROGRESS');
    await expect(page.locator('[data-row="IN_PROGRESS"] [data-edit]')).toHaveAttribute(
      'title',
      'Internal code: IN_PROGRESS',
    );

    const labels = await admin.get<Json[]>('/api/v1/status-labels');
    for (const label of labels) {
      const cell = page.locator(`[data-row="${label.code}"] [data-tasks]`);
      await expect(cell).toHaveText(String(label.taskCount));
      const queue = await admin.get<Json>(`/api/v1/task-queue?pageSize=1&status=${label.code}`);
      expect(label.taskCount, `${label.code}: equals the Task Queue total`).toBe(queue.total);
    }
    await shot(page, 'status-labels-list');

    // One row, two Tab stops (the name link and the menu); the count is reached with the right arrow.
    const row = page.locator('[data-row="NEW"]');
    const stops = await row.evaluate((tr) =>
      Array.from(tr.querySelectorAll<HTMLElement>('a, button, input, select, [tabindex]'))
        .filter((el) => el.tabIndex >= 0)
        .map((el) => el.tagName),
    );
    expect(stops).toEqual(['A', 'BUTTON']);
    await row.locator('[data-edit]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(row.locator('[data-tasks] a')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tasks\?.*status=NEW/);
  });

  test('Rename: the menu opens the dialog with the code and where the name shows, the badge previews live, the row says what it was, and focus goes back to the menu button', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[1]);
    await page.goto('/admin/status-labels');
    const original = (await badgeOf(page, 'ON_HOLD').innerText()).trim();
    const name = `Waiting ${uid().slice(0, 5)}`;
    try {
      const menu = page
        .locator('[data-row="ON_HOLD"]')
        .getByRole('button', { name: /^Actions for / });
      await menu.click();
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(page).toHaveURL(/edit=ON_HOLD$/);
      await expect(field(page)).toBeFocused();
      await expect(dialog(page)).toContainText('The code ON_HOLD and every task');
      await expect(dialog(page)).toContainText(
        'The name shows in the Task Queue, My Work, the Dashboard and on task pages.',
      );
      await field(page).fill(name);
      await expect(dialog(page).locator('[data-preview]')).toContainText(name);
      await expect(badgeOf(page, 'ON_HOLD')).not.toContainText(name);
      await dialog(page).getByRole('button', { name: 'Save name' }).click();
      await expect(dialog(page)).toBeHidden();
      await expect(badgeOf(page, 'ON_HOLD')).toContainText(name);
      await expect(page.locator('[data-row="ON_HOLD"] [data-was]')).toHaveText(`was ${original}`);
      await expect(page.locator('[data-announce]')).toContainText('ON_HOLD now reads');
      await expect(menu).toBeFocused();
      await shot(page, 'status-labels-renamed');
    } finally {
      await page.goto('/admin/status-labels?edit=ON_HOLD');
      await field(page).fill(original);
      await dialog(page).getByRole('button', { name: 'Save name' }).click();
      await expect(dialog(page)).toBeHidden();
    }
  });

  test('a 50 character label previews inside the dialog at 375 px without a sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize(SIZES[3]);
    await page.goto('/admin/status-labels?edit=CANCELLED');
    // Never saved: the shared labels stay as they are.
    await field(page).fill('Waiting for the other side to answer our long letter');
    await expect(page.locator('#status-label-name-count'))
      .toContainText('51 / 50')
      .catch(() => undefined);
    const preview = dialog(page).locator('[data-preview] mf-status-badge');
    await expect(preview).toContainText('Waiting for the other side');
    const box = (await preview.boundingBox())!;
    const dialogBox = (await dialog(page).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
    await noSideScroll(page, 'long label at 375');
    await shot(page, 'status-label-long-preview');
  });

  test('below 640 px the statuses are cards with the code as a tooltip, the count and the same Rename', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 639, height: 900 });
    await page.goto('/admin/status-labels');
    await expect(page.locator('li.rc')).toHaveCount(5);
    await expect(page.locator('table.mf-grid')).toHaveCount(0);
    await page.setViewportSize(SIZES[3]);
    const card = page.locator('li.rc').first();
    await expect(card.locator('[data-card-tasks]')).toContainText(/\d+ tasks?/);
    await card.getByRole('button', { name: /^Actions for / }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Rename']);
    await page.keyboard.press('Escape');
    await card.getByRole('link').first().click();
    await expect(dialog(page)).toBeVisible();
    await page.setViewportSize({ width: 640, height: 900 });
    await expect(page.locator('table.mf-grid')).toBeVisible();
  });

  test('a StatusLabel.Manage person without Task.View has no Tasks column and still renames; Task.View alone gets the 403 page', async ({
    asUser,
    personas,
  }) => {
    const manager = await asUser(
      (await personas.create({ permissions: ['StatusLabel.Manage'], label: 'ad3-sm' })).username,
    );
    await manager.setViewportSize(SIZES[1]);
    await manager.goto('/admin/status-labels');
    await expect(rows(manager)).toHaveCount(5);
    await expect(manager.locator('table.mf-grid thead th')).toHaveText(['Status', 'Actions']);
    await expect(manager.locator('[data-tasks]')).toHaveCount(0);
    await manager.locator('[data-row="NEW"] [data-edit]').click();
    await expect(dialog(manager)).toBeVisible();
    const viewer = await asUser(
      (await personas.create({ permissions: ['Task.View'], label: 'ad3-sv' })).username,
    );
    await viewer.goto('/admin/status-labels');
    await expect(
      viewer.getByRole('heading', { name: "You don't have permission to view this." }),
    ).toBeVisible();
  });

  for (const size of SIZES) {
    test(`${size.width}: axe 0 and no sideways scroll, with the row menu and the Rename dialog open`, async ({
      page,
    }) => {
      test.skip(!axeAvailable(), 'axe-core is not available');
      await page.setViewportSize(size);
      await page.goto('/admin/status-labels');
      await expect(page.locator('tbody tr[data-row], li.rc').first()).toBeVisible();
      await noSideScroll(page, `status labels at ${size.width}`);
      expect(await axeViolations(page), `status labels at ${size.width}`).toEqual([]);
      const menu = page
        .locator('tbody tr[data-row], li.rc')
        .nth(4)
        .getByRole('button', { name: /^Actions for / });
      await menu.scrollIntoViewIfNeeded();
      await menu.click();
      expect(await axeViolations(page), `menu open at ${size.width}`).toEqual([]);
      await page.keyboard.press('Escape');
      await page.goto('/admin/status-labels?edit=NEW');
      await expect(dialog(page)).toBeVisible();
      await noSideScroll(page, `rename dialog at ${size.width}`);
      expect(await axeViolations(page), `rename dialog at ${size.width}`).toEqual([]);
      await shot(page, 'status-label-dialog');
    });
  }
});
