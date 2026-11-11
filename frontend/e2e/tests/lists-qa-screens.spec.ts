import fs from 'node:fs';
import path from 'node:path';
import { Page } from '@playwright/test';
import { axeAvailable, axeViolations } from '../support/axe';
import { expect, test } from '../support/fixtures';
import { failApi } from '../support/personas';
import { SIZES, openRowMenu } from '../support/labels';

/**
 * QA e2e for Administration > Lists (#1320, #1321): every component and state at 1366x768 and 1920x1080, axe on each, pictures into
 * E2E_SCREENSHOTS (unset, no pictures). Run with E2E_WORKERS=1 so the pictures of one state come from one run.
 */
const OUT = process.env['E2E_SCREENSHOTS'];

async function snap(page: Page, name: string): Promise<void> {
  // let finite animations finish, then check axe and photograph
  await page.waitForTimeout(400);
  if (axeAvailable()) expect.soft(await axeViolations(page), `${name} axe`).toEqual([]);
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  const size = page.viewportSize()!;
  await page.screenshot({ path: path.join(OUT, `${name}-${size.width}.png`) });
}

const KEYS = [
  'matter-types',
  'current-states',
  'team-titles',
  'priorities',
  'status-labels',
  'on-hold-reasons',
  'note-tags',
  'link-roles',
];

for (const size of SIZES) {
  test.describe(`Lists screens at ${size.width}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(size);
    });

    test('catalogue, search, no-match and the eight lists', async ({ page }) => {
      for (const key of KEYS) {
        await page.goto(`/admin/lists/${key}`);
        await expect(page.locator('[data-list-body] tbody tr').first()).toBeVisible();
        await expect(page.locator('[data-active-count]')).toBeVisible();
        await expect(page.locator('[data-count]').first()).not.toHaveText('--');
        await snap(page, `list-${key}`);
      }
      await page.goto('/admin/lists/priorities');
      const find = page.getByRole('searchbox', { name: 'Find a list' });
      await find.fill('task');
      await expect(page.getByRole('option')).not.toHaveCount(8);
      await snap(page, 'catalogue-search');
      await find.fill('zzz');
      await expect(page.locator('[data-no-match]')).toBeVisible();
      await snap(page, 'catalogue-no-match');
    });

    test('empty list, load error, dialogs and confirm', async ({ page, admin }) => {
      // empty (the list's own GET answers an empty array)
      await page.route('**/api/v1/on-hold-reasons', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
      );
      await page.goto('/admin/lists/on-hold-reasons');
      await expect(page.getByText('No on-hold reasons yet.')).toBeVisible();
      await snap(page, 'state-empty');
      await page.unroute('**/api/v1/on-hold-reasons');

      // load error
      const restore = await failApi(page, /\/api\/v1\/matter-types$/, 500);
      await page.goto('/admin/lists/matter-types');
      await expect(page.getByText("Couldn't load matter types.")).toBeVisible();
      await snap(page, 'state-error');
      await restore();

      // rename dialog + deactivate confirm (matter types)
      const name = `QA Type ${Date.now() % 100000}`;
      await admin.post('/api/v1/matter-types', { name, isActive: true });
      await page.goto('/admin/lists/matter-types');
      const row = page.locator('tbody tr[data-row]').filter({ hasText: name });
      await expect(row).toBeVisible();
      await openRowMenu(page, row.getByRole('button', { name: /^Actions for/ }));
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await snap(page, 'dialog-rename');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
      await openRowMenu(page, row.getByRole('button', { name: /^Actions for/ }));
      await page.getByRole('menuitem', { name: 'Deactivate' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await snap(page, 'dialog-deactivate');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

      // priority edit dialog (colour)
      await page.goto('/admin/lists/priorities?edit=new');
      await expect(page.getByRole('dialog')).toBeVisible();
      await snap(page, 'dialog-priority-new');
      // The starter configuration seeds no note tags: a fresh database shows the empty state, so the test adds its own tag first.
      await admin.post('/api/v1/note-tags', {
        name: `QA Tag ${Date.now() % 100000}`,
        colourKey: null,
      });
      await page.goto('/admin/lists/note-tags');
      await expect(page.locator('[data-note-tag-row]').first()).toBeVisible();
      await page.getByRole('button', { name: 'New Tag' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await snap(page, 'dialog-note-tag-new');
    });

    test('moved banner, Custom Fields banner, Asset Types, single list, no search', async ({
      page,
      asUser,
      personas,
    }) => {
      await page.goto('/admin/priorities');
      await expect(page.locator('[data-moved-banner]')).toBeVisible();
      await snap(page, 'moved-banner');
      await page.goto('/admin/custom-fields');
      await expect(page.locator('[data-lists-banner]')).toBeVisible();
      await snap(page, 'custom-fields-banner');
      await page.goto('/admin/asset-types');
      await expect(page.locator('tbody tr').first()).toBeVisible();
      await snap(page, 'asset-types-one-tab');

      const one = await asUser(
        (
          await personas.create({
            permissions: ['Priority.Manage', 'CustomField.Manage'],
            label: 'qa-one',
          })
        ).username,
      );
      await one.setViewportSize(size);
      await one.goto('/admin/lists');
      await expect(one.getByRole('heading', { level: 2 })).toHaveText('Priorities');
      await snap(one, 'single-list');
      const three = await asUser(
        (await personas.create({ permissions: ['MatterList.Manage'], label: 'qa-three' })).username,
      );
      await three.setViewportSize(size);
      await three.goto('/admin/lists');
      await expect(three.getByRole('option')).toHaveCount(3);
      await snap(three, 'catalogue-no-search');
    });
  });
}
