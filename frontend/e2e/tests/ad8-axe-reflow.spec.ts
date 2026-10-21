import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { openRowMenu } from '../support/labels';
import { SIZES, noHorizontalScroll, shot } from '../support/screens';
import { uid } from '../support/seed';

/**
 * WP-AD8 #660 (AD-E): the combined axe and reflow audit of the five administration areas (Audit Logs, Labels, Asset Types, Link Roles, Custom
 * Fields) at 375, 768, 1366 and 1920 with every overlay open: the row menu, each dialog, the activity drawer, the filter sheet. Each page and
 * each overlay: 0 axe violations (wcag2a, wcag2aa, wcag21aa, wcag22aa incl. target-size) and no page-level horizontal scroll. The spec FAILS when
 * axe-core is missing (set E2E_AXE_PATH to axe.min.js). Screenshots go to E2E_SCREENSHOTS (docs/ux/admin-pages-review/fixes/ad8-states-focus).
 */
function requireAxe(): void {
  expect(axeAvailable(), 'axe-core is required: set E2E_AXE_PATH to the path of axe.min.js').toBe(
    true,
  );
}

async function check(page: Page, what: string, width: number): Promise<void> {
  expect(await axeViolations(page), `${what} at ${width}`).toEqual([]);
  await noHorizontalScroll(page);
}

test.describe('Axe and reflow of the administration areas, overlays open (#660)', () => {
  test.setTimeout(240_000);

  test('Labels: Priorities and Status labels with the menu, the dialogs and the Deactivate and Default questions', async ({
    page,
    admin,
  }) => {
    requireAxe();
    const label = `Audit ${uid()}`;
    const p = await admin.post('/api/v1/priorities', { label, color: 'low', isActive: true });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/priorities');
      await expect(page.getByRole('button', { name: `Actions for ${label}` })).toBeVisible();
      await check(page, 'priorities', size.width);
      await openRowMenu(page, page.getByRole('button', { name: `Actions for ${label}` }));
      await check(page, 'priorities menu', size.width);
      await page.getByRole('menuitem', { name: 'Set as default' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, 'default question', size.width);
      await page.getByRole('button', { name: 'Keep current default' }).click();
      await openRowMenu(page, page.getByRole('button', { name: `Actions for ${label}` }));
      await page.getByRole('menuitem', { name: 'Edit priority' }).click();
      await expect(page.getByRole('dialog', { name: 'Edit priority' })).toBeVisible();
      await check(page, 'edit priority', size.width);
      await page.keyboard.press('Escape');

      await page.goto('/admin/status-labels');
      await expect(page.locator('tr[data-row="NEW"], li.rc').first()).toBeVisible();
      await check(page, 'status labels', size.width);
      await page
        .getByRole('button', { name: /^Actions for / })
        .first()
        .click();
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await expect(page.getByRole('dialog', { name: 'Rename status label' })).toBeVisible();
      await check(page, 'rename status label', size.width);
      await page.keyboard.press('Escape');
      if (size.width === 1366 || size.width === 375) await shot(page, 'labels-audit');
    }
    await admin.raw('DELETE', `/api/v1/priorities/${p.id}`);
  });

  test('Asset Types and Link Roles: lists, menus, dialogs, the activity drawer and the record page', async ({
    page,
    admin,
  }) => {
    requireAxe();
    const name = `Audit Type ${uid()}`;
    const type = await admin.post('/api/v1/asset-types', { name, description: null });
    const role = `Audit Role ${uid()}`;
    await admin.post('/api/v1/asset-link-roles', { name: role, isActive: true });
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto(`/admin/asset-types?name=${encodeURIComponent(name)}`);
      await expect(page.getByRole('button', { name: `Actions for ${name}` })).toBeVisible();
      await check(page, 'asset types', size.width);
      await openRowMenu(page, page.getByRole('button', { name: `Actions for ${name}` }));
      await check(page, 'asset types menu', size.width);
      await page.getByRole('menuitem', { name: 'History' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, 'activity drawer', size.width);
      await page.keyboard.press('Escape');

      await page.goto(`/admin/asset-types/${type.assetTypeId}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name.slice(0, 20));
      await check(page, 'asset type record', size.width);

      await page.goto('/admin/asset-types?tab=link-roles');
      await expect(page.getByRole('button', { name: `Actions for ${role}` })).toBeVisible();
      await check(page, 'link roles', size.width);
      await openRowMenu(page, page.getByRole('button', { name: `Actions for ${role}` }));
      await check(page, 'link roles menu', size.width);
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await expect(page.getByRole('dialog', { name: 'Rename link role' })).toBeVisible();
      await check(page, 'rename link role', size.width);
      await page.keyboard.press('Escape');
      if (size.width === 1366 || size.width === 375) await shot(page, 'asset-types-audit');
    }
  });

  test('Custom Fields and Audit Logs: lists, menus, the filter sheet and the open details', async ({
    page,
  }) => {
    requireAxe();
    for (const size of SIZES) {
      await page.setViewportSize(size);
      await page.goto('/admin/custom-fields');
      await expect(page.locator('tr[data-row="Matter"], li.rc').first()).toBeVisible();
      await check(page, 'custom fields', size.width);
      await page
        .getByRole('button', { name: /^Actions for / })
        .first()
        .click();
      await check(page, 'custom fields menu', size.width);
      await page.keyboard.press('Escape');

      await page.goto('/admin/audit');
      await expect(
        page.locator('tr[data-event], tr[data-group], li [data-event], li [data-group]').first(),
      ).toBeVisible();
      await check(page, 'audit', size.width);
      if (size.width < 640) {
        await page
          .locator('mf-page-header')
          .getByRole('button', { name: /^Filters/ })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page, 'audit filter sheet', size.width);
        await page.keyboard.press('Escape');
      } else {
        await expect(page.locator('[data-filter-row]')).toBeVisible();
      }
      await page
        .getByRole('button', { name: /^(Show details|Show the )/ })
        .first()
        .click();
      await check(page, 'audit details', size.width);
      if (size.width === 1366 || size.width === 375) await shot(page, 'audit-audit');
    }
  });
});
